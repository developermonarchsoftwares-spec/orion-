import { Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import { SEARCH_ROLE_PHRASES } from './classification/role-taxonomy.config';
import { contactEligibleForRoleSql } from './people-contact-attribution';
import { VERIFICATION_STALE_AFTER_DAYS, type DecisionMakerType } from './people.constants';

export interface IPeopleSearchFilters {
  /** Company must have a current, published person of one of these decision-maker types. */
  decisionMakerTypes?: DecisionMakerType[];
  /** Company must have at least one current, published decision maker. */
  hasDecisionMaker?: boolean;
  /** ...whose role is VERIFIED with evidence and a recent verification. */
  hasVerifiedDecisionMaker?: boolean;
  /** ...who has at least one published contact point. */
  hasDecisionMakerContact?: boolean;
}

export interface IParsedSearchIntent extends IPeopleSearchFilters {
  /** Free text left over after role / location phrases were consumed. */
  remainingQuery: string;
  city?: string;
}

export const hasPeopleFilters = (f: IPeopleSearchFilters): boolean =>
  !!(f.decisionMakerTypes?.length || f.hasDecisionMaker || f.hasVerifiedDecisionMaker || f.hasDecisionMakerContact);

/**
 * Turns phrases such as "Companies in Coimbatore with a Founder/CEO" or "verified decision
 * makers" into structured filters, using the same role vocabulary as the classifier.
 * Pure: unit-testable without a database. Role words only count as intent when the query
 * asks for companies WITH such a person (or is a bare role phrase), so a company called
 * "Partners Logistics" is not misread.
 */
export function parseSearchIntent(rawQuery: string | undefined): IParsedSearchIntent {
  const original = (rawQuery ?? '').trim();
  const intent: IParsedSearchIntent = { remainingQuery: original };
  if (!original) return intent;

  let work = original;
  const wantsPerson = /\b(with|having|where|who|has|have)\b/i.test(original) || /\bdecision[\s-]?makers?\b/i.test(original);
  if (!wantsPerson) return intent;

  // Location: "in <city>" up to the next connector word or end of text.
  const cityRe = /\bin\s+([A-Za-z][A-Za-z .-]{1,40}?)(?=\s+(?:with|having|where|who)\b|$)/i;
  const cityMatch = work.match(cityRe);
  if (cityMatch) {
    intent.city = cityMatch[1].trim();
    work = work.replace(cityRe, ' ');
  }

  const types = new Set<DecisionMakerType>();
  for (const { type, phrases } of SEARCH_ROLE_PHRASES) {
    const pattern = `\\b(?:${phrases.source})\\b`;
    if (new RegExp(pattern, 'i').test(work)) {
      types.add(type);
      work = work.replace(new RegExp(pattern, 'gi'), ' ');
    }
  }
  if (types.size) intent.decisionMakerTypes = [...types];

  if (/\bverified\s+decision[\s-]?makers?\b/i.test(work)) {
    intent.hasVerifiedDecisionMaker = true;
    work = work.replace(/\bverified\b/gi, ' ');
  }
  if (/\bdecision[\s-]?makers?\b/i.test(work)) {
    intent.hasDecisionMaker = true;
    work = work.replace(/\bdecision[\s-]?makers?\b/gi, ' ');
    if (/\b(contactable|reachable|contact (details )?available|contacts? available)\b/i.test(work)) {
      intent.hasDecisionMakerContact = true;
      work = work.replace(/\b(contactable|reachable|contact (details )?available|contacts? available)\b/gi, ' ');
    }
  }

  if (!hasPeopleFilters(intent)) return { remainingQuery: original };

  intent.remainingQuery = work
    .replace(/\b(companies|company|businesses|with|having|where|who|has|have|a|an|the|and|or)\b/gi, ' ')
    .replace(/[/&,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return intent;
}

/**
 * SQL predicate ("this business has a people-match") for discover search. Only PUBLISHED people
 * with current roles count. Verification is the same rule as PeopleService: VERIFIED + verified
 * evidence + verification not older than the stale window.
 */
@Injectable()
export class PeopleSearchService {
  buildBusinessPredicate(f: IPeopleSearchFilters, businessIdColumn: SQL): SQL | undefined {
    if (!hasPeopleFilters(f)) return undefined;

    const parts: SQL[] = [
      sql`cp.business_id = ${businessIdColumn}`,
      sql`cp.is_current = true`,
      sql`cp.is_published = true`,
      sql`cp.review_status = 'APPROVED'`,
      sql`p.data_status = 'PUBLISHED'`,
    ];
    if (f.decisionMakerTypes?.length) {
      parts.push(sql`cp.decision_maker_type IN (${sql.join(f.decisionMakerTypes.map((t) => sql`${t}`), sql`, `)})`);
    } else if (f.hasDecisionMaker || f.hasVerifiedDecisionMaker || f.hasDecisionMakerContact) {
      parts.push(sql`cp.decision_maker_type IS NOT NULL`);
    }
    if (f.hasVerifiedDecisionMaker) {
      parts.push(sql`cp.verification_status = 'VERIFIED'`);
      parts.push(sql`cp.last_verified_at > now() - make_interval(days => ${VERIFICATION_STALE_AFTER_DAYS})`);
      parts.push(
        sql`EXISTS (SELECT 1 FROM people_evidence ev WHERE ev.verified_at IS NOT NULL AND ev.person_id = cp.person_id AND ev.company_person_id = cp.id)`,
      );
    }
    if (f.hasDecisionMakerContact) {
      parts.push(
        sql`EXISTS (SELECT 1 FROM person_contacts pc WHERE pc.person_id = cp.person_id AND pc.is_published = true AND ${contactEligibleForRoleSql('pc', 'cp')})`,
      );
    }
    return sql`EXISTS (SELECT 1 FROM company_people cp JOIN people p ON p.id = cp.person_id WHERE ${sql.join(parts, sql` AND `)})`;
  }
}
