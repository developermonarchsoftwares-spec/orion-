import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { namesCompatible } from '../people.utils';
import { suppressionDigest } from '../suppression/people-suppression';

type Tx = Pick<DrizzleDb, 'select' | 'insert' | 'execute'>;

export type ConflictType =
  | 'CONTACT_MULTIPLE_PEOPLE'
  | 'IDENTITY_LINKEDIN'
  | 'CONTACT_CONFLICTING_VALUES'
  | 'ROLE_TITLE'
  | 'ROLE_CURRENCY'
  | 'COMPANY_RELATIONSHIP';

interface ILink {
  key: string;
  observationId?: string | null;
  observationClaimId?: string | null;
  evidenceId?: string | null;
  personId?: string | null;
  companyPersonId?: string | null;
  contactId?: string | null;
}

export interface IConflictDetectionInput {
  personId: string;
  businessId: string;
  companyPersonId: string;
  normalizedName: string;
  linkedinNorm: string | null;
  /** Contacts present in THIS record (type + normalised value), whether or not they were stored. */
  contacts: Array<{ type: 'WORK_EMAIL' | 'PHONE' | 'MOBILE'; norm: string }>;
  /** The observation written for this record (keyed runs only). */
  observationId: string | null;
  now: Date;
}

/**
 * Conflict DETECTION for one freshly written record (Phase 6.8). It runs inside the writer's transaction, after the
 * observation and its contact claims exist, and only looks at the rows this record touches (indexed lookups by contact value,
 * LinkedIn, person, role); it never scans the table. It records "these claims disagree" and nothing else: it picks no winner,
 * deletes nothing, and never touches verification, publication or suppression.
 *
 * A source's CURRENT statement is the latest observation of each (source_key, source_record_id). Earlier observations of the
 * same record are history, so a source that changed its mind never conflicts with itself, a source that later omits a field
 * says nothing about it, and a historical role next to a current one is not a conflict.
 */
export async function detectConflicts(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  let found = 0;
  found += await contactSharedByPeople(tx, i);
  found += await linkedinIdentity(tx, i);
  if (i.observationId) {
    found += await conflictingEmails(tx, i);
    found += await roleTitleConflict(tx, i);
    found += await roleCurrencyConflict(tx, i);
    found += await companyRelationshipConflict(tx, i);
  }
  return found;
}

async function record(
  tx: Tx,
  c: { type: ConflictType; subjectKey: string; personId?: string | null; businessId?: string | null; details: Record<string, unknown>; links: ILink[]; now: Date },
): Promise<void> {
  const [row] = await tx
    .insert(schema.peopleConflicts)
    .values({ conflictType: c.type, subjectKey: c.subjectKey, personId: c.personId ?? null, businessId: c.businessId ?? null, details: c.details, firstDetectedAt: c.now, lastDetectedAt: c.now })
    .onConflictDoUpdate({
      target: [schema.peopleConflicts.conflictType, schema.peopleConflicts.subjectKey],
      // re-detection never creates a second conflict and never moves the first-detected time or the status
      set: { lastDetectedAt: sql`GREATEST(${schema.peopleConflicts.lastDetectedAt}, ${c.now.toISOString()}::timestamptz)`, details: c.details },
    })
    .returning({ id: schema.peopleConflicts.id });
  const links = c.links.map((l) => ({
    conflictId: row.id,
    linkKey: l.key,
    observationId: l.observationId ?? null,
    observationClaimId: l.observationClaimId ?? null,
    evidenceId: l.evidenceId ?? null,
    personId: l.personId ?? null,
    companyPersonId: l.companyPersonId ?? null,
    contactId: l.contactId ?? null,
  }));
  if (links.length) await tx.insert(schema.peopleConflictLinks).values(links).onConflictDoNothing();
}

/** The most recent claim row behind a contact (for the provenance link). */
async function latestClaim(tx: Tx, contactId: string) {
  const [row] = await tx
    .select({ claimId: schema.peopleObservationClaims.id, observationId: schema.peopleObservationClaims.observationId, evidenceId: schema.peopleObservationClaims.evidenceId })
    .from(schema.peopleObservationClaims)
    .innerJoin(schema.peopleObservations, eq(schema.peopleObservations.id, schema.peopleObservationClaims.observationId))
    .where(eq(schema.peopleObservationClaims.contactId, contactId))
    .orderBy(desc(schema.peopleObservations.acquiredAt), desc(schema.peopleObservationClaims.createdAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------- contact shared by people
/**
 * A work e-mail belongs to one person; a MOBILE number is personal. The same value held by a person whose name is not
 * compatible is a conflict. Landline PHONE values are deliberately NOT flagged: offices share lines.
 */
async function contactSharedByPeople(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  let found = 0;
  const [self] = await tx.select({ nameAliases: schema.people.nameAliases, normalizedName: schema.people.normalizedName }).from(schema.people).where(eq(schema.people.id, i.personId));
  const myNames = [i.normalizedName, self?.normalizedName, ...(self?.nameAliases ?? [])].filter((x): x is string => !!x);
  for (const c of i.contacts) {
    if (c.type === 'PHONE') continue;
    const others = await tx
      .select({ contact: schema.personContacts, person: schema.people })
      .from(schema.personContacts)
      .innerJoin(schema.people, eq(schema.people.id, schema.personContacts.personId))
      .where(and(eq(schema.personContacts.contactType, c.type), eq(schema.personContacts.normalizedValue, c.norm), ne(schema.personContacts.personId, i.personId)));
    const real = others.filter(
      (o) => c.type === 'WORK_EMAIL' || ![o.person.normalizedName, ...(o.person.nameAliases ?? [])].some((n) => myNames.some((m) => namesCompatible(n, m))),
    );
    if (!real.length) continue;
    const links: ILink[] = [{ key: `record-of:${i.personId}`, observationId: i.observationId, personId: i.personId }];
    const [mine] = await tx
      .select({ id: schema.personContacts.id })
      .from(schema.personContacts)
      .where(and(eq(schema.personContacts.personId, i.personId), eq(schema.personContacts.contactType, c.type), eq(schema.personContacts.normalizedValue, c.norm)));
    if (mine) {
      const cl = await latestClaim(tx, mine.id);
      links.push({ key: `contact:${mine.id}`, personId: i.personId, contactId: mine.id, observationId: cl?.observationId, observationClaimId: cl?.claimId, evidenceId: cl?.evidenceId });
    }
    for (const o of real) {
      const cl = await latestClaim(tx, o.contact.id);
      links.push({ key: `contact:${o.contact.id}`, personId: o.person.id, contactId: o.contact.id, observationId: cl?.observationId, observationClaimId: cl?.claimId, evidenceId: cl?.evidenceId });
    }
    await record(tx, {
      type: 'CONTACT_MULTIPLE_PEOPLE',
      subjectKey: `${c.type}:${suppressionDigest(c.norm)}`,
      details: { contactType: c.type, people: real.length + 1 },
      links,
      now: i.now,
    });
    found++;
  }
  return found;
}

// ---------------------------------------------------------------------------------------------- LinkedIn identity
/** The record resolved to a person through LinkedIn, but its name is not compatible with that person's name. */
async function linkedinIdentity(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  if (!i.linkedinNorm) return 0;
  const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, i.personId));
  if (!p || p.normalizedLinkedinUrl !== i.linkedinNorm) return 0;
  const names = [p.normalizedName, ...(p.nameAliases ?? [])];
  if (names.some((n) => namesCompatible(n, i.normalizedName))) return 0; // same person under another spelling: not a conflict
  const links: ILink[] = [{ key: `person:${p.id}`, personId: p.id }];
  if (i.observationId) links.push({ key: `record-name:${i.normalizedName}`, observationId: i.observationId, personId: p.id });
  const [first] = await tx
    .select({ id: schema.peopleObservations.id, evidenceId: schema.peopleObservations.evidenceId })
    .from(schema.peopleObservations)
    .where(and(eq(schema.peopleObservations.personId, p.id), eq(schema.peopleObservations.outcome, 'INGESTED'), i.observationId ? ne(schema.peopleObservations.id, i.observationId) : sql`true`))
    .orderBy(schema.peopleObservations.acquiredAt)
    .limit(1);
  if (first) links.push({ key: `first-observation:${p.id}`, observationId: first.id, evidenceId: first.evidenceId, personId: p.id });
  await record(tx, { type: 'IDENTITY_LINKEDIN', subjectKey: `LINKEDIN:${suppressionDigest(i.linkedinNorm)}`, personId: p.id, details: { observedNameDiffers: true }, links, now: i.now });
  return 1;
}

// ---------------------------------------------------------------------------------------------- shared SQL helpers
interface ILatestRow {
  obs_id: string;
  source_key: string;
  company_person_id: string | null;
  business_id: string | null;
  evidence_id: string | null;
  observed_is_current: boolean | null;
}

/** The current statement of every (source_key, source_record_id) about this person: its latest INGESTED observation. */
async function latestObservationsOfPerson(tx: Tx, personId: string): Promise<ILatestRow[]> {
  const res: any = await tx.execute(sql`
    SELECT DISTINCT ON (o.source_key, o.source_record_id)
      o.id AS obs_id, o.source_key, o.company_person_id, o.business_id, o.evidence_id, o.observed_is_current
    FROM people_observations o
    WHERE o.person_id = ${personId} AND o.outcome = 'INGESTED'
    ORDER BY o.source_key, o.source_record_id, o.acquired_at DESC, o.created_at DESC, o.id DESC`);
  return (res.rows ?? res) as ILatestRow[];
}

// ---------------------------------------------------------------------------------------------- conflicting emails
/** Two different sources currently claim different work e-mails for the same person. */
async function conflictingEmails(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  if (!i.contacts.some((c) => c.type === 'WORK_EMAIL')) return 0;
  const res: any = await tx.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (o.source_key, o.source_record_id) o.id AS obs_id
      FROM people_observation_claims c
      JOIN people_observations o ON o.id = c.observation_id
      JOIN person_contacts pc ON pc.id = c.contact_id
      WHERE pc.person_id = ${i.personId} AND c.claim_type = 'WORK_EMAIL'
      ORDER BY o.source_key, o.source_record_id, o.acquired_at DESC, o.created_at DESC, o.id DESC)
    SELECT c.id AS claim_id, c.contact_id, c.value_digest, c.evidence_id, o.id AS obs_id, o.source_key, pc.last_seen_at
    FROM people_observation_claims c
    JOIN people_observations o ON o.id = c.observation_id
    JOIN person_contacts pc ON pc.id = c.contact_id
    WHERE c.observation_id IN (SELECT obs_id FROM latest) AND c.claim_type = 'WORK_EMAIL' AND pc.person_id = ${i.personId}`);
  const rows = (res.rows ?? res) as Array<{ claim_id: string; contact_id: string; value_digest: string; evidence_id: string | null; obs_id: string; source_key: string; last_seen_at: Date | null }>;
  const disagree = rows.some((a) => rows.some((b) => a.source_key !== b.source_key && a.value_digest !== b.value_digest));
  if (!disagree) return 0;
  await record(tx, {
    type: 'CONTACT_CONFLICTING_VALUES',
    subjectKey: `WORK_EMAIL:person:${i.personId}`,
    personId: i.personId,
    details: { contactType: 'WORK_EMAIL', sources: [...new Set(rows.map((r) => r.source_key))].sort(), distinctValues: new Set(rows.map((r) => r.value_digest)).size },
    links: rows.map((r) => ({ key: `source:${r.source_key}:${r.value_digest}`, observationClaimId: r.claim_id, observationId: r.obs_id, evidenceId: r.evidence_id, personId: i.personId, contactId: r.contact_id })),
    now: i.now,
  });
  return 1;
}

// ---------------------------------------------------------------------------------------------- role title
/**
 * Two different sources currently put the same person in DIFFERENT current roles at the same company (e.g. "CEO" vs
 * "Managing Director"). A former role next to a current one, or one source's own earlier title, is history, not a conflict.
 */
async function roleTitleConflict(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  const latest = (await latestObservationsOfPerson(tx, i.personId)).filter((r) => r.business_id === i.businessId && r.company_person_id);
  if (latest.length < 2) return 0;
  const roleIds = [...new Set(latest.map((r) => r.company_person_id!))];
  if (roleIds.length < 2) return 0;
  const roles = await tx.select().from(schema.companyPeople).where(inArray(schema.companyPeople.id, roleIds));
  const live = new Set(roles.filter((r) => r.isCurrent && r.reviewStatus !== 'REJECTED').map((r) => r.id));
  const sides = latest.filter((r) => live.has(r.company_person_id!));
  const disagree = sides.some((a) => sides.some((b) => a.source_key !== b.source_key && a.company_person_id !== b.company_person_id));
  if (!disagree) return 0;
  await record(tx, {
    type: 'ROLE_TITLE',
    subjectKey: `person:${i.personId}:business:${i.businessId}`,
    personId: i.personId,
    businessId: i.businessId,
    details: { roles: [...new Set(sides.map((s) => s.company_person_id))].length, sources: [...new Set(sides.map((s) => s.source_key))].sort() },
    links: sides.map((s) => ({ key: `source:${s.source_key}:role:${s.company_person_id}`, observationId: s.obs_id, evidenceId: s.evidence_id, personId: i.personId, companyPersonId: s.company_person_id })),
    now: i.now,
  });
  return 1;
}

// ---------------------------------------------------------------------------------------------- current / former
/** Two different sources currently disagree on whether the SAME role is current or former. */
async function roleCurrencyConflict(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  const sides = (await latestObservationsOfPerson(tx, i.personId)).filter((r) => r.company_person_id === i.companyPersonId && r.observed_is_current !== null);
  const disagree = sides.some((a) => sides.some((b) => a.source_key !== b.source_key && a.observed_is_current !== b.observed_is_current));
  if (!disagree) return 0;
  await record(tx, {
    type: 'ROLE_CURRENCY',
    subjectKey: `role:${i.companyPersonId}`,
    personId: i.personId,
    businessId: i.businessId,
    details: { sources: [...new Set(sides.map((s) => s.source_key))].sort() },
    links: sides.map((s) => ({ key: `source:${s.source_key}:current:${s.observed_is_current}`, observationId: s.obs_id, evidenceId: s.evidence_id, personId: i.personId, companyPersonId: i.companyPersonId })),
    now: i.now,
  });
  return 1;
}

// ---------------------------------------------------------------------------------------------- company relationship
/** Relationship types that mean full-time employment-like attachment to ONE company at a time (owner / director / partner / advisor may span several). */
const SINGLE_COMPANY_RELATIONSHIPS = ['EMPLOYEE', 'EXECUTIVE'];

/** Two different sources currently put the same person in employment-like roles at DIFFERENT companies. */
async function companyRelationshipConflict(tx: Tx, i: IConflictDetectionInput): Promise<number> {
  const latest = (await latestObservationsOfPerson(tx, i.personId)).filter((r) => r.company_person_id && r.business_id);
  if (new Set(latest.map((r) => r.business_id)).size < 2) return 0;
  const roles = await tx.select().from(schema.companyPeople).where(inArray(schema.companyPeople.id, [...new Set(latest.map((r) => r.company_person_id!))]));
  const live = new Set(roles.filter((r) => r.isCurrent && r.reviewStatus !== 'REJECTED' && SINGLE_COMPANY_RELATIONSHIPS.includes(r.relationshipType)).map((r) => r.id));
  const sides = latest.filter((r) => live.has(r.company_person_id!));
  const disagree = sides.some((a) => sides.some((b) => a.source_key !== b.source_key && a.business_id !== b.business_id));
  if (!disagree) return 0;
  await record(tx, {
    type: 'COMPANY_RELATIONSHIP',
    subjectKey: `person:${i.personId}`,
    personId: i.personId,
    details: { companies: new Set(sides.map((s) => s.business_id)).size, sources: [...new Set(sides.map((s) => s.source_key))].sort() },
    links: sides.map((s) => ({ key: `source:${s.source_key}:business:${s.business_id}`, observationId: s.obs_id, evidenceId: s.evidence_id, personId: i.personId, companyPersonId: s.company_person_id })),
    now: i.now,
  });
  return 1;
}
