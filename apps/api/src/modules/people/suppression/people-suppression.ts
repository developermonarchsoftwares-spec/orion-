import { createHash } from 'crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import type { IPersonUpsertInput } from '../contracts/people-ingestion.contract';
import { normalizeContactValue, normalizeLinkedinUrl, normalizePersonName } from '../people.utils';

/**
 * PEOPLE SUPPRESSION REGISTRY (Phase 6.4) - plain functions over a query handle, so they run inside the caller's transaction.
 *
 * Boundary: the registry answers one question, "does this record carry a deterministic identity signal of a person who was
 * suppressed?". Deterministic signals are ONLY a normalised LinkedIn URL, a work e-mail and a phone number. Names, titles, company
 * names, cities and similarity never suppress anyone. Signals are stored as digests ('h:' + sha256), never as readable values.
 * Rejection, quarantine and deletion are not suppression and never write here.
 */

export type SuppressionKind = 'LINKEDIN' | 'WORK_EMAIL' | 'PHONE';
export type SuppressionOrigin = 'REVIEWER_ACTION' | 'QUARANTINE_ACTION' | 'LEGACY_SET_STATUS' | 'LEGACY_BACKFILL';

/** Anything that can run SELECT / INSERT / EXECUTE: the database or a transaction. */
export type Q = Pick<DrizzleDb, 'select' | 'insert' | 'execute'>;

/** The same digest form as the Phase 5 verification ledger: 'h:' + sha256(normalised value). */
export const suppressionDigest = (normalizedValue: string): string => `h:${createHash('sha256').update(normalizedValue, 'utf8').digest('hex')}`;

export interface IRecordIdentity {
  linkedinNorm: string | null;
  emails: string[];
  phones: string[];
  /** Only used to apply the same determinism rule the People resolver uses for a phone number (see findSuppressionMatch). */
  normalizedName: string;
}

/** The deterministic identity signals of an incoming (already validated) upsert input. */
export function identityOfUpsert(input: Pick<IPersonUpsertInput, 'person' | 'contacts'>): IRecordIdentity {
  const contacts = input.contacts ?? [];
  const norm = (c: { type: 'WORK_EMAIL' | 'PHONE' | 'MOBILE'; value: string }) => normalizeContactValue(c.type, c.value);
  return {
    linkedinNorm: normalizeLinkedinUrl(input.person.linkedinUrl),
    emails: [...new Set(contacts.filter((c) => c.type === 'WORK_EMAIL').map(norm))],
    phones: [...new Set(contacts.filter((c) => c.type !== 'WORK_EMAIL').map(norm))],
    normalizedName: normalizePersonName(input.person.fullName ?? ''),
  };
}

export interface ISuppressionMeta {
  reason?: string;
  origin: SuppressionOrigin;
  /** A pointer such as 'quarantine:<id>'. Never personal data. */
  sourceReference?: string;
  byKind: 'REVIEWER' | 'SYSTEM';
  byId?: string | null;
  byLabel?: string | null;
}

/** Serialises anything that changes or depends on one person's suppression state. */
export async function lockPerson(tx: Q, personId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`people:person:${personId}`}))`);
}

/**
 * Takes the person lock for the person who owns a role, and returns that person's id (null when the role does not exist: the caller
 * answers 404). A review action calls this FIRST and reads the role / person only afterwards, so what it validates is the state it then
 * writes: it serialises with suppression, import writes, unlock and every other review action on the same person. The lock is
 * transaction-scoped (released at commit / rollback) and never held across a network call.
 */
export async function lockPersonOfRole(tx: Q, companyPersonId: string): Promise<string | null> {
  const [row] = await tx.select({ personId: schema.companyPeople.personId }).from(schema.companyPeople).where(eq(schema.companyPeople.id, companyPersonId));
  if (!row) return null;
  await lockPerson(tx, row.personId);
  return row.personId;
}

/** Same for the person who owns a contact. */
export async function lockPersonOfContact(tx: Q, contactId: string): Promise<string | null> {
  const [row] = await tx.select({ personId: schema.personContacts.personId }).from(schema.personContacts).where(eq(schema.personContacts.id, contactId));
  if (!row) return null;
  await lockPerson(tx, row.personId);
  return row.personId;
}

/**
 * Registers every deterministic identity the person holds RIGHT NOW (LinkedIn, work e-mails, phones). Idempotent: an identity
 * already in the registry (for this or any other suppressed person) is left as it is; the unique index makes concurrent calls
 * safe. A person with no such identifier yields no rows (a legacy case: nothing is invented).
 */
export async function registerSuppressedIdentities(tx: Q, personId: string, meta: ISuppressionMeta): Promise<{ registered: number; already: number }> {
  const [person] = await tx
    .select({ linkedin: schema.people.normalizedLinkedinUrl })
    .from(schema.people)
    .where(eq(schema.people.id, personId));
  if (!person) return { registered: 0, already: 0 };
  const contacts = await tx
    .select({ type: schema.personContacts.contactType, value: schema.personContacts.normalizedValue })
    .from(schema.personContacts)
    .where(eq(schema.personContacts.personId, personId));

  const wanted = new Map<string, { kind: SuppressionKind; digest: string }>();
  const add = (kind: SuppressionKind, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (!v) return;
    const digest = suppressionDigest(v);
    wanted.set(`${kind}:${digest}`, { kind, digest });
  };
  add('LINKEDIN', person.linkedin);
  for (const c of contacts) add(c.type === 'WORK_EMAIL' ? 'WORK_EMAIL' : 'PHONE', c.value);
  if (wanted.size === 0) return { registered: 0, already: 0 };

  const inserted = await tx
    .insert(schema.peopleSuppressions)
    .values(
      [...wanted.values()].map((w) => ({
        personId,
        identityKind: w.kind,
        identityDigest: w.digest,
        reason: meta.reason?.trim().slice(0, 1000) || null,
        origin: meta.origin,
        sourceReference: meta.sourceReference?.slice(0, 255) ?? null,
        suppressedByKind: meta.byKind,
        suppressedById: meta.byKind === 'SYSTEM' ? null : (meta.byId ?? null),
        suppressedByLabel: meta.byLabel?.slice(0, 255) ?? null,
      })),
    )
    .onConflictDoNothing({ target: [schema.peopleSuppressions.identityKind, schema.peopleSuppressions.identityDigest] })
    .returning({ id: schema.peopleSuppressions.id });
  return { registered: inserted.length, already: wanted.size - inserted.length };
}

export interface ISuppressionMatch {
  kind: SuppressionKind;
  personId: string | null;
}

const PRECEDENCE: SuppressionKind[] = ['LINKEDIN', 'WORK_EMAIL', 'PHONE'];

/**
 * Finds a suppressed identity carried by the record, by deterministic signals only, in the order LinkedIn, work e-mail, phone.
 *  - LinkedIn and work e-mail are unique to one person in Orion's model, so an exact digest match is enough.
 *  - A phone number is shared more easily, so (exactly like the People resolver) it only counts together with the suppressed
 *    person's own name (current or an earlier spelling). If that person row no longer exists the phone entry is inert.
 * Names, titles, companies and similarity are never consulted on their own. The same person matched through several signals is
 * still one suppressed identity.
 */
export async function findSuppressionMatch(q: Q, identity: IRecordIdentity): Promise<ISuppressionMatch | null> {
  const parts = [];
  if (identity.linkedinNorm) parts.push(and(eq(schema.peopleSuppressions.identityKind, 'LINKEDIN'), eq(schema.peopleSuppressions.identityDigest, suppressionDigest(identity.linkedinNorm))));
  if (identity.emails.length) {
    parts.push(and(eq(schema.peopleSuppressions.identityKind, 'WORK_EMAIL'), inArray(schema.peopleSuppressions.identityDigest, identity.emails.map(suppressionDigest))));
  }
  if (identity.phones.length) {
    parts.push(and(eq(schema.peopleSuppressions.identityKind, 'PHONE'), inArray(schema.peopleSuppressions.identityDigest, identity.phones.map(suppressionDigest))));
  }
  if (parts.length === 0) return null;
  const rows = await q
    .select({
      kind: schema.peopleSuppressions.identityKind,
      personId: schema.peopleSuppressions.personId,
      name: schema.people.normalizedName,
      aliases: schema.people.nameAliases,
    })
    .from(schema.peopleSuppressions)
    .leftJoin(schema.people, eq(schema.people.id, schema.peopleSuppressions.personId))
    .where(or(...parts));

  const eligible = rows.filter((r) => {
    if (r.kind !== 'PHONE') return true;
    if (!r.personId || !r.name) return false; // the suppressed person is gone: a bare phone number is not a deterministic identity
    return r.name === identity.normalizedName || (r.aliases ?? []).includes(identity.normalizedName);
  });
  eligible.sort((a, b) => PRECEDENCE.indexOf(a.kind as SuppressionKind) - PRECEDENCE.indexOf(b.kind as SuppressionKind) || String(a.personId).localeCompare(String(b.personId)));
  const hit = eligible[0];
  return hit ? { kind: hit.kind as SuppressionKind, personId: hit.personId } : null;
}

/** Digest rows of the registry for the deletion ledger (digests and ids only). Read-only. */
export async function listRegistryForLedger(q: Pick<DrizzleDb, 'select'>): Promise<{ kind: string; digest: string; personId: string | null; origin: string }[]> {
  const rows = await q.select().from(schema.peopleSuppressions).orderBy(schema.peopleSuppressions.identityKind, schema.peopleSuppressions.identityDigest);
  return rows.map((p) => ({ kind: p.identityKind, digest: p.identityDigest, personId: p.personId ?? null, origin: p.origin }));
}

/**
 * Re-inserts a registry entry that a restore lost (deletion ledger). Idempotent. The person link is kept only when that person exists in
 * the restored database. Returns whether a row was added.
 */
export async function restoreRegistryEntry(tx: Q, entry: { kind: string; digest: string; personId: string | null }, personExists: boolean): Promise<boolean> {
  const ins = await tx
    .insert(schema.peopleSuppressions)
    .values({
      personId: entry.personId && personExists ? entry.personId : null,
      identityKind: entry.kind,
      identityDigest: entry.digest,
      origin: 'LEGACY_BACKFILL',
      sourceReference: 'deletion-ledger',
      suppressedByKind: 'SYSTEM',
    })
    .onConflictDoNothing({ target: [schema.peopleSuppressions.identityKind, schema.peopleSuppressions.identityDigest] })
    .returning({ id: schema.peopleSuppressions.id });
  return ins.length > 0;
}
