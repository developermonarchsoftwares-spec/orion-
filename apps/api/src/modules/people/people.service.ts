import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BusinessException } from '../../common/errors/business.exception';
import {
  DECISION_MAKER_TYPE_LABELS,
  DEPARTMENT_LABELS,
  SENIORITY_LABELS,
  SENIORITY_RANK,
} from './classification/role-taxonomy.config';
import {
  DECISION_MAKER_TYPES,
  DEPARTMENTS,
  PERSON_UNLOCK_COST_CREDITS,
  SENIORITY_LEVELS,
  VERIFICATION_STATUSES,
  type AssertionLevel,
  type ConfidenceLevel,
  type ContactType,
  type DecisionMakerType,
  type Department,
  type SeniorityLevel,
  type VerificationStatus,
} from './people.constants';
import {
  assertionLevel,
  confidenceLevel,
  decisionMakerClaimLabel,
  effectiveVerification,
} from './policies/verification.policy';
import { CompanyPeopleQueryDto } from './dto/people.dto';
import { contactsForAnyCompany, contactsForCompany, loadContactAttribution } from './people-contact-attribution';

type PersonRow = typeof schema.people.$inferSelect;
type RoleRow = typeof schema.companyPeople.$inferSelect;
type ContactRow = typeof schema.personContacts.$inferSelect;
type EvidenceRow = typeof schema.peopleEvidence.$inferSelect;

export interface IContactField {
  /** A published contact point of this type exists. */
  available: boolean;
  verificationStatus: VerificationStatus | null;
  /** The actual value. ONLY populated after the caller has unlocked this person; otherwise null. */
  value: string | null;
}

/**
 * THE customer-safe People contract (Phase 6.11). Every customer-facing People response (company list, person detail, unlocked
 * list, unlock, export) is built from this shape only. It deliberately has NO internal ids (role / contact / evidence),
 * no source or provenance details, no evidence rows, no reviewer or audit data and no internal review, conflict or
 * classification data. `id` is the person's public id, `businessId` the public company id.
 * Verification is exposed only as status, assertion level, last verified date and confidence.
 */
export interface IPersonCard {
  id: string;
  businessId: string;
  fullName: string;
  jobTitle: string;
  department: { key: Department; label: string };
  seniority: { key: SeniorityLevel; label: string };
  decisionMaker: {
    type: DecisionMakerType;
    label: string;
    assertion: AssertionLevel;
    claim: string;
  } | null;
  isCurrent: boolean;
  startDate: string | null;
  endDate: string | null;
  location: { city: string | null; state: string | null; country: string | null };
  verification: {
    status: VerificationStatus;
    assertion: AssertionLevel;
    lastVerifiedAt: Date | null;
    confidence: { score: number; level: ConfidenceLevel };
  };
  /** Counts only: how many sources back this role and how many of them are verified. No source names, types or URLs. */
  evidence: { count: number; verifiedCount: number };
  /** Plain-language reason this person is shown, derived only from stored data. */
  relevance: string;
  contacts: {
    isUnlocked: boolean;
    email: IContactField;
    phone: IContactField;
    mobile: IContactField;
    linkedin: IContactField;
  };
  /** Other roles this person holds at the same company (the card shows the strongest matching one). */
  additionalRoles: string[];
  isSaved: boolean;
  unlockCostCredits: number;
}

/**
 * The one definition of "a role a customer may see": published AND approved by a reviewer, and the person is PUBLISHED (so never
 * hidden, draft or hidden). The database also enforces published => approved; this keeps the rule explicit at every read path.
 */
export const CUSTOMER_VISIBLE_ROLE = () => [
  eq(schema.companyPeople.isPublished, true),
  eq(schema.companyPeople.reviewStatus, 'APPROVED'),
  eq(schema.people.dataStatus, 'PUBLISHED'),
];

const ASSERTION_RANK: Record<AssertionLevel, number> = { KNOWN: 2, LIKELY: 1, UNVERIFIED: 0 };
const MAX_ROLES_PER_COMPANY = 500;

export const parseList = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PeopleService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  getTaxonomy() {
    const entries = <T extends string>(keys: readonly T[], labels: Record<T, string>) =>
      keys.map((key) => ({ key, label: labels[key] }));
    return {
      departments: entries(DEPARTMENTS, DEPARTMENT_LABELS),
      seniorityLevels: entries(SENIORITY_LEVELS, SENIORITY_LABELS),
      decisionMakerTypes: entries(DECISION_MAKER_TYPES, DECISION_MAKER_TYPE_LABELS),
      verificationStatuses: VERIFICATION_STATUSES.map((key) => ({ key })),
      unlockCostCredits: PERSON_UNLOCK_COST_CREDITS,
    };
  }

  /** People at a PUBLISHED company, with contact values withheld unless the caller unlocked the person. */
  async listCompanyPeople(identifier: string, userId: string, query: CompanyPeopleQueryDto) {
    const business = await this.resolvePublishedBusiness(identifier);
    this.assertKnownFilters(query);

    const rows = await this.db
      .select({ role: schema.companyPeople, person: schema.people })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .where(
        and(
          eq(schema.companyPeople.businessId, business.id),
          ...CUSTOMER_VISIBLE_ROLE(),
        ),
      )
      .limit(MAX_ROLES_PER_COMPANY);

    const status = query.status ?? 'current';
    const scoped = rows.filter(
      (r) => status === 'all' || (status === 'current' ? r.role.isCurrent : !r.role.isCurrent),
    );
    const cards = await this.buildCards(scoped, userId);

    const departments = new Set(parseList(query.department));
    const seniorities = new Set(parseList(query.seniority));
    const dmTypes = new Set(parseList(query.decisionMakerType));
    const verifications = new Set(parseList(query.verification));
    const needle = query.q?.trim().toLowerCase();
    const loc = query.location?.trim().toLowerCase();

    const filtered = cards.filter((c) => {
      if (departments.size && !departments.has(c.department.key)) return false;
      if (seniorities.size && !seniorities.has(c.seniority.key)) return false;
      if (dmTypes.size && !(c.decisionMaker && dmTypes.has(c.decisionMaker.type))) return false;
      if (query.decisionMakersOnly && !c.decisionMaker) return false;
      if (verifications.size && !verifications.has(c.verification.status)) return false;
      if (query.hasContact && !this.hasAnyContact(c)) return false;
      if (needle && !`${c.fullName} ${c.jobTitle}`.toLowerCase().includes(needle)) return false;
      if (loc && !`${c.location.city ?? ''} ${c.location.state ?? ''}`.toLowerCase().includes(loc)) return false;
      return true;
    });

    const people = this.groupByPerson([...filtered].sort(this.compareCards));
    const everyone = this.groupByPerson([...cards].sort(this.compareCards));

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = people.length;

    return {
      business: { id: business.id, slug: business.slug, name: business.name },
      summary: {
        total: everyone.length,
        decisionMakers: everyone.filter((c) => c.decisionMaker).length,
        verified: everyone.filter((c) => c.verification.status === 'VERIFIED').length,
        withContact: everyone.filter((c) => this.hasAnyContact(c)).length,
      },
      facets: {
        decisionMakerTypes: this.countBy(everyone.filter((c) => c.decisionMaker), (c) => c.decisionMaker!.type),
        departments: this.countBy(everyone, (c) => c.department.key),
        seniority: this.countBy(everyone, (c) => c.seniority.key),
      },
      people: people.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /** One person across every PUBLISHED company they hold a published role at. */
  async getPersonDetail(personId: string, userId: string) {
    const rows = await this.loadPublishedRolesForPerson(personId);
    if (rows.length === 0) {
      throw new BusinessException('Person not found', 'PERSON_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const cards = (await this.buildCards(rows, userId)).sort(this.compareCards);
    const businesses = await this.db
      .select({ id: schema.businesses.id, name: schema.businesses.name, slug: schema.businesses.slug })
      .from(schema.businesses)
      .where(inArray(schema.businesses.id, [...new Set(cards.map((c) => c.businessId))]));
    const nameById = new Map(businesses.map((b) => [b.id, b]));

    return {
      id: personId,
      fullName: cards[0].fullName,
      location: cards[0].location,
      // Person-level view of the whole person (this endpoint spans every visible company): the best contact among those eligible on at
      // least one visible role. Each roles[] card carries only its own company's contacts.
      contacts: await this.buildPersonContacts(rows, userId),
      isSaved: cards.some((c) => c.isSaved),
      roles: cards.map((c) => ({ ...c, business: nameById.get(c.businessId) ?? null })),
      unlockCostCredits: PERSON_UNLOCK_COST_CREDITS,
    };
  }

  /** Cards for a person's published roles; used by unlock and export flows. */
  async loadPublishedRolesForPerson(personId: string) {
    return this.db
      .select({ role: schema.companyPeople, person: schema.people })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.companyPeople.businessId))
      .where(
        and(
          eq(schema.people.id, personId),
          ...CUSTOMER_VISIBLE_ROLE(),
          eq(schema.businesses.status, 'PUBLISHED'),
        ),
      );
  }

  async buildCards(rows: Array<{ role: RoleRow; person: PersonRow }>, userId: string): Promise<IPersonCard[]> {
    if (rows.length === 0) return [];
    const personIds = [...new Set(rows.map((r) => r.person.id))];

    const [contacts, evidence, unlocks, saved, attribution] = await Promise.all([
      this.db
        .select()
        .from(schema.personContacts)
        .where(and(inArray(schema.personContacts.personId, personIds), eq(schema.personContacts.isPublished, true))),
      this.db.select().from(schema.peopleEvidence).where(inArray(schema.peopleEvidence.personId, personIds)),
      this.db
        .select({ personId: schema.personUnlocks.personId })
        .from(schema.personUnlocks)
        .where(and(eq(schema.personUnlocks.userId, userId), inArray(schema.personUnlocks.personId, personIds))),
      this.db
        .select({ personId: schema.savedLeads.personId, businessId: schema.savedLeads.businessId })
        .from(schema.savedLeads)
        .where(
          and(
            eq(schema.savedLeads.userId, userId),
            isNotNull(schema.savedLeads.personId),
            inArray(schema.savedLeads.personId, personIds),
          ),
        ),
      loadContactAttribution(this.db, personIds),
    ]);

    const unlocked = new Set(unlocks.map((u) => u.personId));
    const savedKeys = new Set(saved.map((s) => `${s.businessId}:${s.personId}`));

    return rows.map(({ role, person }) =>
      this.toCard(
        role,
        person,
        // company context: only the contacts that may be shown at THIS role's company (people-contact-attribution.ts)
        contactsForCompany(contacts.filter((c) => c.personId === person.id), role.businessId, attribution),
        evidence.filter((e) => e.personId === person.id),
        unlocked.has(person.id),
        savedKeys.has(`${role.businessId}:${person.id}`),
      ),
    );
  }

  /** The contacts object of a card, from the contacts already eligible for the card's role (or, person-level, for any visible role). */
  private contactBlock(person: PersonRow, contacts: ContactRow[], evidence: EvidenceRow[], isUnlocked: boolean): IPersonCard['contacts'] {
    const contactField = (type: ContactType): IContactField => {
      const best = contacts
        .filter((c) => c.contactType === type)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.confidenceScore - a.confidenceScore)[0];
      if (!best) return { available: false, verificationStatus: null, value: null };
      const contactVerified = evidence.filter((e) => e.contactId === best.id && !!e.verifiedAt).length;
      return {
        available: true,
        verificationStatus: effectiveVerification({
          status: best.verificationStatus,
          lastVerifiedAt: best.lastVerifiedAt,
          verifiedEvidenceCount: contactVerified,
        }),
        value: isUnlocked ? best.contactValue : null,
      };
    };

    const linkedinVerified = evidence.some((e) => e.evidenceType === 'PROFESSIONAL_PROFILE' && !!e.verifiedAt);
    const linkedin: IContactField = person.linkedinUrl
      ? {
          available: true,
          verificationStatus: linkedinVerified ? 'VERIFIED' : 'UNVERIFIED',
          value: isUnlocked ? person.linkedinUrl : null,
        }
      : { available: false, verificationStatus: null, value: null };

    return {
      isUnlocked,
      email: contactField('WORK_EMAIL'),
      phone: contactField('PHONE'),
      mobile: contactField('MOBILE'),
      linkedin,
    };
  }

  /** Person detail's top-level contacts: person-level, over the contacts eligible on at least one of the person's visible roles. */
  private async buildPersonContacts(rows: Array<{ role: RoleRow; person: PersonRow }>, userId: string): Promise<IPersonCard['contacts']> {
    const person = rows[0].person;
    const [contacts, evidence, unlocks, attribution] = await Promise.all([
      this.db
        .select()
        .from(schema.personContacts)
        .where(and(eq(schema.personContacts.personId, person.id), eq(schema.personContacts.isPublished, true))),
      this.db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, person.id)),
      this.db
        .select({ personId: schema.personUnlocks.personId })
        .from(schema.personUnlocks)
        .where(and(eq(schema.personUnlocks.userId, userId), eq(schema.personUnlocks.personId, person.id))),
      loadContactAttribution(this.db, [person.id]),
    ]);
    const eligible = contactsForAnyCompany(contacts, rows.map((r) => r.role.businessId), attribution);
    return this.contactBlock(person, eligible, evidence, unlocks.length > 0);
  }

  private toCard(
    role: RoleRow,
    person: PersonRow,
    contacts: ContactRow[],
    evidence: EvidenceRow[],
    isUnlocked: boolean,
    isSaved: boolean,
  ): IPersonCard {
    // Only evidence attached to THIS role can verify it. Person-level evidence (e.g. a profile
    // page) says the person exists, not that they hold this role at this company.
    const roleEvidence = evidence.filter((e) => e.companyPersonId === role.id);
    const verifiedCount = roleEvidence.filter((e) => !!e.verifiedAt).length;
    const status = effectiveVerification({
      status: role.verificationStatus,
      lastVerifiedAt: role.lastVerifiedAt,
      verifiedEvidenceCount: verifiedCount,
    });
    const assertion = assertionLevel(status);
    const dmType = role.decisionMakerType as DecisionMakerType | null;
    const dmLabel = dmType ? (DECISION_MAKER_TYPE_LABELS[dmType] ?? dmType) : null;
    const department = role.department as Department;
    const seniority = role.seniorityLevel as SeniorityLevel;

    const contactBlock = this.contactBlock(person, contacts, evidence, isUnlocked);

    const relevance = dmType
      ? assertion === 'KNOWN'
        ? `Verified ${role.jobTitleAtCompany}: ${dmLabel}.`
        : assertion === 'LIKELY'
          ? `Listed as ${role.jobTitleAtCompany}; likely ${dmLabel}, partially verified.`
          : `Listed as ${role.jobTitleAtCompany}. Title suggests ${dmLabel}, but this is not verified.`
      : `Listed as ${role.jobTitleAtCompany}. Not classified as a decision-making role.`;

    return {
      id: person.id,
      businessId: role.businessId,
      fullName: person.fullName,
      jobTitle: role.jobTitleAtCompany,
      department: { key: department, label: DEPARTMENT_LABELS[department] ?? department },
      seniority: { key: seniority, label: SENIORITY_LABELS[seniority] ?? seniority },
      decisionMaker: dmType
        ? {
            type: dmType,
            label: dmLabel!,
            assertion,
            claim: decisionMakerClaimLabel(dmLabel!, assertion),
          }
        : null,
      isCurrent: role.isCurrent,
      startDate: role.startDate,
      endDate: role.endDate,
      location: { city: person.city, state: person.state, country: person.country },
      verification: {
        status,
        assertion,
        lastVerifiedAt: role.lastVerifiedAt,
        confidence: { score: role.confidenceScore, level: confidenceLevel(role.confidenceScore, status) },
      },
      evidence: {
        count: roleEvidence.length,
        verifiedCount,
      },
      relevance,
      contacts: contactBlock,
      additionalRoles: [],
      isSaved,
      unlockCostCredits: PERSON_UNLOCK_COST_CREDITS,
    };
  }

  /** One card per person: keeps the strongest role (input must be sorted) and lists the rest. */
  private groupByPerson(sorted: IPersonCard[]): IPersonCard[] {
    const byPerson = new Map<string, IPersonCard>();
    for (const card of sorted) {
      const first = byPerson.get(card.id);
      if (!first) byPerson.set(card.id, { ...card, additionalRoles: [] });
      else first.additionalRoles.push(card.jobTitle);
    }
    return [...byPerson.values()];
  }

  /** An unknown filter value is refused (400) instead of silently returning nothing or everything. */
  private assertKnownFilters(query: CompanyPeopleQueryDto) {
    const check = (value: string | undefined, allowed: readonly string[], name: string) => {
      const given = parseList(value);
      // refused only when NO value is known (such a filter would silently match nothing); unknown extras next to known values are ignored as before
      if (given.length > 0 && !given.some((v) => allowed.includes(v))) throw new BusinessException(`Unknown ${name}. See GET /people/taxonomy for the allowed values`, 'INVALID_FILTER', HttpStatus.BAD_REQUEST);
    };
    check(query.department, DEPARTMENTS, 'department');
    check(query.seniority, SENIORITY_LEVELS, 'seniority');
    check(query.decisionMakerType, DECISION_MAKER_TYPES, 'decisionMakerType');
    check(query.verification, VERIFICATION_STATUSES, 'verification');
  }

  private hasAnyContact(c: IPersonCard): boolean {
    return c.contacts.email.available || c.contacts.phone.available || c.contacts.mobile.available;
  }

  private compareCards = (a: IPersonCard, b: IPersonCard): number => {
    const dmA = a.decisionMaker ? DECISION_MAKER_TYPES.indexOf(a.decisionMaker.type) : 99;
    const dmB = b.decisionMaker ? DECISION_MAKER_TYPES.indexOf(b.decisionMaker.type) : 99;
    return (
      dmA - dmB ||
      SENIORITY_RANK[b.seniority.key] - SENIORITY_RANK[a.seniority.key] ||
      ASSERTION_RANK[b.verification.assertion] - ASSERTION_RANK[a.verification.assertion] ||
      a.fullName.localeCompare(b.fullName) ||
      // total order: equal names never fall back to database row order, so pages are stable
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
      (a.businessId < b.businessId ? -1 : a.businessId > b.businessId ? 1 : 0) ||
      (a.jobTitle < b.jobTitle ? -1 : a.jobTitle > b.jobTitle ? 1 : 0)
    );
  };

  private countBy<T>(items: T[], key: (t: T) => string): Array<{ key: string; count: number }> {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
  }

  private async resolvePublishedBusiness(identifier: string) {
    const business = await this.db.query.businesses.findFirst({
      where: UUID_RE.test(identifier)
        ? eq(schema.businesses.id, identifier)
        : eq(schema.businesses.slug, identifier),
      columns: { id: true, slug: true, name: true, status: true },
    });
    if (!business || business.status !== 'PUBLISHED') {
      throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return business;
  }
}
