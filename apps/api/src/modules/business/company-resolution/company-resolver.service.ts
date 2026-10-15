import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import {
  IDENTIFYING_IDENTIFIER_TYPES,
  MIN_NAME_LENGTH,
  isNonIdentifyingDomain,
  normalizeCompanyName,
  normalizeDomain,
  normalizeIdentifierValue,
  normalizePincode,
  normalizeText,
  normalizedNameSql,
} from './company-matching';
import {
  COMPANY_REASON as R,
  CompanyMatchMethod,
  ICompanyCandidate,
  ICompanyMatch,
  ICompanyResolution,
  MAX_CANDIDATES,
} from './company-resolution.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a company candidate to exactly one EXISTING company (MATCHED), several plausible ones (AMBIGUOUS) or none
 * (NOT_FOUND). READ-ONLY: it only ever SELECTs, so it cannot create or modify companies, people or anything else, and it
 * makes no network calls. It never chooses between plausible companies.
 *
 * Hierarchy, strongest first; a lower tier is only consulted when no stronger signal resolved the company:
 *   0. Orion's own id / slug (internal references)
 *   1. exact statutory identifiers (CIN, GSTIN, PAN, UDYAM, LEI, TAN, REG_NO), compared by type
 *   2. exact company website domain (public platforms and e-mail domains never count)
 *   3. exact normalised company name (legal name or name) CORROBORATED by location (city or pincode)
 * Conflicting strong signals, shared domains, duplicate names and uncorroborated names are AMBIGUOUS, never guessed.
 */
@Injectable()
export class CompanyResolverService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  async resolve(candidate: ICompanyCandidate): Promise<ICompanyResolution> {
    const notes: string[] = [];
    const strong = new Map<string, ICompanyMatch>(); // tiers 0 and 1, by company id
    const addStrong = (companyId: string, matchedBy: CompanyMatchMethod, reasonCodes: string[] = []) => {
      const prev = strong.get(companyId);
      if (prev) prev.reasonCodes.push(...reasonCodes, matchedBy);
      else strong.set(companyId, { companyId, matchedBy, reasonCodes: [...reasonCodes, matchedBy] });
    };

    // ------------------------------------------------------------------ tier 0: internal references
    const id = candidate.id?.trim();
    if (id) {
      if (UUID.test(id)) {
        const [b] = await this.db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, id));
        if (b) addStrong(b.id, 'INTERNAL_ID');
        else notes.push('INTERNAL_ID_NOT_FOUND');
      } else notes.push('INTERNAL_ID_INVALID');
    }
    const slug = candidate.slug?.trim().toLowerCase();
    if (slug) {
      const [b] = await this.db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.slug, slug));
      if (b) addStrong(b.id, 'INTERNAL_SLUG');
      else notes.push('INTERNAL_SLUG_NOT_FOUND');
    }

    // ------------------------------------------------------------------ tier 1: statutory identifiers
    const supplied = new Map<string, string>(); // type -> normalised value (for conflict checks)
    for (const ident of candidate.identifiers ?? []) {
      const type = String(ident?.type ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const value = normalizeIdentifierValue(ident?.value);
      if (!value) continue;
      if (!(IDENTIFYING_IDENTIFIER_TYPES as readonly string[]).includes(type)) {
        notes.push(`${R.IDENTIFIER_IGNORED}:${type || 'UNKNOWN'}`);
        continue;
      }
      if (supplied.has(type) && supplied.get(type) !== value) {
        // the caller itself supplied two different values for one identifier type: nothing can be trusted
        return this.ambiguous([], [R.CONFLICTING_IDENTIFIER, `${R.CONFLICTING_IDENTIFIER}:${type}`]);
      }
      supplied.set(type, value);
      const rows = await this.db
        .select({ businessId: schema.businessIdentifiers.businessId })
        .from(schema.businessIdentifiers)
        .where(and(eq(schema.businessIdentifiers.type, type as never), eq(schema.businessIdentifiers.normalizedValue, value)));
      if (rows.length === 0) notes.push(`${R.IDENTIFIER_NOT_FOUND}:${type}`);
      for (const r of rows) addStrong(r.businessId, `IDENTIFIER:${type}`);
    }

    // ------------------------------------------------------------------ the domain (computed once; used by tier 2 and as a cross-check)
    let domainOwners: string[] | null = null; // null = no usable domain supplied
    const domain = normalizeDomain(candidate.domain) ?? normalizeDomain(candidate.website);
    if (candidate.domain || candidate.website) {
      if (!domain) notes.push('DOMAIN_INVALID');
      else if (isNonIdentifyingDomain(domain)) notes.push(R.DOMAIN_NOT_IDENTIFYING);
      else domainOwners = await this.domainOwners(domain);
    }

    // ------------------------------------------------------------------ tiers 0/1 decide when they produced a signal
    if (strong.size > 1) return this.ambiguous([...strong.values()], [R.CONFLICTING_REFERENCES, ...notes]);
    if (strong.size === 1) {
      const only = [...strong.values()][0];
      if (domainOwners && domainOwners.length > 0 && !domainOwners.includes(only.companyId)) {
        // an identifier / reference says one company, the company website says another: do not guess
        const others = domainOwners.map((companyId): ICompanyMatch => ({ companyId, matchedBy: 'DOMAIN', reasonCodes: ['DOMAIN'] }));
        return this.ambiguous([only, ...others], [R.CONFLICTING_DOMAIN, ...notes]);
      }
      const conflict = await this.identifierConflict(only.companyId, supplied);
      if (conflict) return this.ambiguous([only], [R.CONFLICTING_IDENTIFIER, conflict, ...notes]);
      return { status: 'MATCHED', companyId: only.companyId, matchedBy: only.matchedBy as CompanyMatchMethod, reasonCodes: [...new Set([...only.reasonCodes, ...notes])] };
    }

    // ------------------------------------------------------------------ tier 2: company website domain
    if (domainOwners) {
      if (domainOwners.length > 1) {
        return this.ambiguous(domainOwners.map((companyId): ICompanyMatch => ({ companyId, matchedBy: 'DOMAIN', reasonCodes: ['DOMAIN', R.SHARED_DOMAIN] })), [R.SHARED_DOMAIN, ...notes]);
      }
      if (domainOwners.length === 1) {
        const companyId = domainOwners[0];
        const conflict = await this.identifierConflict(companyId, supplied);
        if (conflict) return this.ambiguous([{ companyId, matchedBy: 'DOMAIN', reasonCodes: ['DOMAIN'] }], [R.CONFLICTING_IDENTIFIER, conflict, ...notes]);
        const reasonCodes = ['DOMAIN', ...notes];
        if (await this.nameDiffers(companyId, candidate)) reasonCodes.push(R.NAME_DIFFERS_FROM_DOMAIN_OWNER);
        return { status: 'MATCHED', companyId, matchedBy: 'DOMAIN', reasonCodes };
      }
      notes.push('DOMAIN_NOT_FOUND');
    }

    // ------------------------------------------------------------------ tier 3: normalised name, corroborated by location
    const names = [...new Set([candidate.legalName, candidate.name].map((n) => normalizeCompanyName(n)).filter((n) => n.length >= MIN_NAME_LENGTH))];
    if (names.length === 0) {
      const hadName = !!(candidate.name?.trim() || candidate.legalName?.trim());
      return { status: 'NOT_FOUND', reasonCodes: [hadName ? R.NAME_NOT_USABLE : R.NO_SIGNAL, ...notes] };
    }
    const named = await this.businessesNamed(names);
    if (named.length === 0) return { status: 'NOT_FOUND', reasonCodes: [R.NAME_NOT_FOUND, ...notes] };

    const city = normalizeText(candidate.city);
    const state = normalizeText(candidate.state);
    const pin = normalizePincode(candidate.pincode);
    const locations = await this.locationsOf(named.map((b) => b.id));
    const corroborated: ICompanyMatch[] = [];
    const uncorroborable: ICompanyMatch[] = []; // same name, but we hold no location to compare with
    for (const b of named) {
      const locs = locations.get(b.id) ?? [];
      if (locs.length === 0) {
        uncorroborable.push({ companyId: b.id, matchedBy: 'NAME', reasonCodes: ['NAME', R.NAME_NEEDS_CORROBORATION] });
        continue;
      }
      const agrees = locs.some((l) => {
        const cityOk = city !== '' && normalizeText(l.city) === city;
        const pinOk = pin !== null && normalizePincode(l.pincode) === pin;
        if (!cityOk && !pinOk) return false;
        return state === '' || normalizeText(l.state) === state; // a stated state that disagrees vetoes the match
      });
      if (agrees) corroborated.push({ companyId: b.id, matchedBy: 'NAME_AND_LOCATION', reasonCodes: ['NAME', 'LOCATION'] });
    }
    if (corroborated.length === 1 && uncorroborable.length > 0) {
      // another company with the same name has no location on file, so it cannot be ruled out: do not pick
      return this.ambiguous([...corroborated, ...uncorroborable], [R.NAME_NEEDS_CORROBORATION, R.DUPLICATE_NAME_SAME_LOCATION, ...notes]);
    }
    if (corroborated.length === 1) {
      const companyId = corroborated[0].companyId;
      const conflict = await this.identifierConflict(companyId, supplied);
      if (conflict) return this.ambiguous(corroborated, [R.CONFLICTING_IDENTIFIER, conflict, ...notes]);
      return { status: 'MATCHED', companyId, matchedBy: 'NAME_AND_LOCATION', reasonCodes: ['NAME', 'LOCATION', ...notes] };
    }
    if (corroborated.length > 1) {
      return this.ambiguous(corroborated.map((c) => ({ ...c, reasonCodes: [...c.reasonCodes, R.DUPLICATE_NAME_SAME_LOCATION] })), [R.DUPLICATE_NAME_SAME_LOCATION, ...notes]);
    }
    const hasLocation = city !== '' || pin !== null;
    if (!hasLocation) {
      // the name exists but nothing corroborates it: precision over recall, a reviewer decides
      return this.ambiguous(named.map((b): ICompanyMatch => ({ companyId: b.id, matchedBy: 'NAME', reasonCodes: ['NAME', R.NAME_NEEDS_CORROBORATION] })), [R.NAME_NEEDS_CORROBORATION, ...notes]);
    }
    if (uncorroborable.length > 0) {
      return this.ambiguous(uncorroborable, [R.NAME_NEEDS_CORROBORATION, ...notes]);
    }
    return { status: 'NOT_FOUND', reasonCodes: [R.NAME_DIFFERENT_LOCATION, ...notes] };
  }

  // ------------------------------------------------------------------ helpers (all read-only)

  private ambiguous(candidates: ICompanyMatch[], reasonCodes: string[]): ICompanyResolution {
    const byId = new Map<string, ICompanyMatch>();
    for (const c of candidates) {
      const prev = byId.get(c.companyId);
      if (prev) prev.reasonCodes = [...new Set([...prev.reasonCodes, ...c.reasonCodes])];
      else byId.set(c.companyId, { ...c, reasonCodes: [...new Set(c.reasonCodes)] });
    }
    // a stable order: the same inputs always give the same candidate list
    const all = [...byId.values()].sort((a, b) => a.companyId.localeCompare(b.companyId));
    const codes = [...new Set(reasonCodes)];
    if (all.length > MAX_CANDIDATES) codes.push(R.CANDIDATES_TRUNCATED);
    return { status: 'AMBIGUOUS', candidates: all.slice(0, MAX_CANDIDATES), reasonCodes: codes };
  }

  /** Businesses whose company WEBSITE has exactly this domain (stored with or without a leading www). */
  private async domainOwners(domain: string): Promise<string[]> {
    const rows = await this.db
      .select({ businessId: schema.digitalPresences.businessId })
      .from(schema.digitalPresences)
      .where(
        and(
          eq(schema.digitalPresences.platform, 'WEBSITE'),
          eq(schema.digitalPresences.isActive, true),
          inArray(schema.digitalPresences.domain, [domain, `www.${domain}`]),
        ),
      );
    return [...new Set(rows.map((r) => r.businessId))].sort();
  }

  /** The company has an identifier of a supplied type with a DIFFERENT value: the record is about something else. */
  private async identifierConflict(companyId: string, supplied: Map<string, string>): Promise<string | null> {
    if (supplied.size === 0) return null;
    const rows = await this.db
      .select({ type: schema.businessIdentifiers.type, value: schema.businessIdentifiers.normalizedValue })
      .from(schema.businessIdentifiers)
      .where(and(eq(schema.businessIdentifiers.businessId, companyId), inArray(schema.businessIdentifiers.type, [...supplied.keys()] as never[])));
    for (const r of rows) {
      const want = supplied.get(r.type);
      if (want && want !== r.value) return `${R.CONFLICTING_IDENTIFIER}:${r.type}`;
    }
    return null;
  }

  private async nameDiffers(companyId: string, c: ICompanyCandidate): Promise<boolean> {
    const given = [c.name, c.legalName].map(normalizeCompanyName).filter((n) => n.length >= MIN_NAME_LENGTH);
    if (given.length === 0) return false;
    const [b] = await this.db.select({ name: schema.businesses.name, legalName: schema.businesses.legalName }).from(schema.businesses).where(eq(schema.businesses.id, companyId));
    const stored = [b?.name, b?.legalName].map(normalizeCompanyName);
    return !given.some((g) => stored.includes(g));
  }

  /** Companies whose name or legal name equals one of the normalised names. */
  private async businessesNamed(names: string[]): Promise<Array<{ id: string }>> {
    const list = sql.join(names.map((n) => sql`${n}`), sql`, `);
    const rows = await this.db
      .select({ id: schema.businesses.id })
      .from(schema.businesses)
      .where(sql`(${sql.raw(normalizedNameSql('"businesses"."name"'))} IN (${list}) OR ${sql.raw(normalizedNameSql('"businesses"."legal_name"'))} IN (${list}))`)
      .orderBy(schema.businesses.id)
      .limit(MAX_CANDIDATES + 1);
    return rows;
  }

  private async locationsOf(ids: string[]) {
    const rows = await this.db
      .select({ businessId: schema.businessLocations.businessId, city: schema.businessLocations.city, state: schema.businessLocations.state, pincode: schema.businessLocations.pincode })
      .from(schema.businessLocations)
      .where(inArray(schema.businessLocations.businessId, ids));
    const map = new Map<string, Array<{ city: string; state: string; pincode: string }>>();
    for (const r of rows) map.set(r.businessId, [...(map.get(r.businessId) ?? []), r]);
    return map;
  }
}
