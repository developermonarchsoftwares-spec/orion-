import { createHash } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { DrizzleDb } from '../../database/database.provider';
import * as s from '../../database/schema';
import { listRegistryForLedger, restoreRegistryEntry } from '../people/suppression/people-suppression';
import { applySuppressionsToContacts, expireStoredExports } from './contact-suppression.service';
import { eraseAccountData } from './privacy.service';

/**
 * DELETION LEDGER (Phase 16) - a small file kept OUTSIDE the database backups.
 *
 * A backup is a snapshot: restore it and every deletion and suppression made after it is silently undone. The ledger carries exactly the
 * facts needed to redo them, and nothing else: one-way digests of suppressed e-mails / phones / LinkedIn URLs, the opaque ids of people
 * who were suppressed and of accounts that were erased. It holds no name, no e-mail, no phone and no company. It is produced by every
 * backup run (ops/backup/backup.sh) and applied right after a restore, before the API, the queue workers or the search re-index start.
 *
 * Limits, stated plainly: the ledger cannot scrub the OLD backups themselves (they keep the deleted data until they expire under the backup
 * retention schedule); it only makes sure that a restore does not bring that data back into service. It is an integrity checksum, not a
 * signature: whoever can write the ledger store can alter it, so keep it as protected as the backups.
 */
export const LEDGER_FORMAT = 'orion-deletion-ledger/1';

export interface IDeletionLedger {
  format: typeof LEDGER_FORMAT;
  generatedAt: string;
  contactSuppressions: { kind: string; digest: string; scope: string; reasonCode: string; createdAt: string }[];
  peopleRegistry: { kind: string; digest: string; personId: string | null; origin: string }[];
  /** People whose data_status is SUPPRESSED. */
  suppressedPeople: string[];
  /** Accounts that were erased (anonymised shell with deleted_at set). */
  erasedAccounts: { userId: string; deletedAt: string }[];
  /** Companies withdrawn from customers (ARCHIVED or REJECTED), ids only. Added in Phase 30; ledgers written before it do not have the field. */
  withdrawnBusinesses?: string[];
  /** Accounts that were suspended, ids only. Added in Phase 30. */
  suspendedUsers?: string[];
  checksum: string;
}

type Body = Omit<IDeletionLedger, 'checksum'>;
const checksumOf = (body: Body) => createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

/** Reads the current deletion state. Read-only. Rows are ordered so the same state always yields the same file. */
export async function buildDeletionLedger(db: DrizzleDb, now = new Date()): Promise<IDeletionLedger> {
  const contacts = await db.select().from(s.contactSuppressions).orderBy(s.contactSuppressions.identityKind, s.contactSuppressions.identityDigest);
  const people = await listRegistryForLedger(db);
  const suppressed = rowsOf(await db.execute(sql`SELECT id FROM people WHERE data_status = 'SUPPRESSED' ORDER BY id`));
  const erased = rowsOf(await db.execute(sql`SELECT id, deleted_at FROM users WHERE deleted_at IS NOT NULL ORDER BY id`));
  const body: Body = {
    format: LEDGER_FORMAT,
    generatedAt: now.toISOString(),
    contactSuppressions: contacts.map((c) => ({ kind: c.identityKind, digest: c.identityDigest, scope: c.scope, reasonCode: c.reasonCode, createdAt: iso(c.createdAt) })),
    peopleRegistry: people,
    suppressedPeople: suppressed.map((r) => String(r.id)),
    erasedAccounts: erased.map((r) => ({ userId: String(r.id), deletedAt: iso(r.deleted_at) })),
    withdrawnBusinesses: rowsOf(await db.execute(sql`SELECT id FROM businesses WHERE status::text IN ('ARCHIVED', 'REJECTED') ORDER BY id`)).map((r) => String(r.id)),
    suspendedUsers: rowsOf(await db.execute(sql`SELECT id FROM users WHERE status::text = 'SUSPENDED' AND deleted_at IS NULL ORDER BY id`)).map((r) => String(r.id)),
  };
  return { ...body, checksum: checksumOf(body) };
}

/** Throws unless the object is a well-formed ledger whose checksum matches. Called before anything is written. */
export function verifyDeletionLedger(input: unknown): IDeletionLedger {
  const l = input as IDeletionLedger;
  if (!l || l.format !== LEDGER_FORMAT) throw new Error('Not an Orion deletion ledger (unknown format)');
  const lists = [l.contactSuppressions, l.peopleRegistry, l.suppressedPeople, l.erasedAccounts];
  if (!lists.every(Array.isArray) || typeof l.checksum !== 'string') throw new Error('Deletion ledger is malformed');
  const { checksum, ...body } = l;
  if (checksumOf(body as Body) !== checksum) throw new Error('Deletion ledger checksum does not match: the file is damaged or was changed');
  const digestOk = (d: unknown) => typeof d === 'string' && /^(h:)?[0-9a-f]{64}$/.test(d);
  const uuidOk = (u: unknown) => typeof u === 'string' && /^[0-9a-f-]{36}$/i.test(u);
  if (!l.contactSuppressions.every((c) => digestOk(c.digest) && ['EMAIL', 'PHONE', 'LINKEDIN'].includes(c.kind) && ['CONTACT', 'FIELD'].includes(c.scope))) throw new Error('Deletion ledger has an invalid contact suppression');
  if (!l.peopleRegistry.every((p) => digestOk(p.digest) && ['LINKEDIN', 'WORK_EMAIL', 'PHONE'].includes(p.kind))) throw new Error('Deletion ledger has an invalid people suppression');
  if (!l.suppressedPeople.every(uuidOk) || !l.erasedAccounts.every((a) => uuidOk(a.userId))) throw new Error('Deletion ledger has an invalid id');
  for (const extra of [l.withdrawnBusinesses, l.suspendedUsers]) {
    if (extra !== undefined && (!Array.isArray(extra) || !extra.every(uuidOk))) throw new Error('Deletion ledger has an invalid id');
  }
  return l;
}

export interface IReapplyReport {
  dryRun: boolean;
  contactSuppressionsAdded: number;
  contactsRemoved: number;
  contactFieldsCleared: number;
  storedExportsExpired: number;
  peopleRegistryAdded: number;
  peopleReSuppressed: number;
  accountsErased: number;
  accountsAlreadyErased: number;
  accountsNotInDatabase: number;
  privacyRequestsReconciled: number;
  /** Companies withdrawn after the backup that the restore had published again. */
  companiesReWithdrawn: number;
  /** Accounts suspended after the backup that the restore had reactivated. */
  accountsReSuspended: number;
  /** Refresh tokens revoked: after a restore, which sessions are still valid is unknown, so none is. */
  sessionsRevoked: number;
  /** Accounts whose session identifier was replaced, ending every access token issued before the restore. */
  sessionIdsRotated: number;
}

class DryRunRollback extends Error {}

/**
 * Re-applies the ledger to a (restored) database in ONE transaction: all of it or none of it. Idempotent: running it twice changes nothing
 * the second time. `dryRun` runs the same statements and rolls back, so the counts are exactly what an apply would change.
 * Order matters and is fixed: suppressions first (so nothing suppressed can be re-published), then people, then accounts.
 * Writes one POST_RESTORE_RECONCILED audit entry (counts only) when applied.
 */
export async function reapplyDeletionLedger(db: DrizzleDb, ledgerInput: unknown, options: { dryRun: boolean }): Promise<IReapplyReport> {
  const ledger = verifyDeletionLedger(ledgerInput);
  const report: IReapplyReport = {
    dryRun: options.dryRun,
    contactSuppressionsAdded: 0,
    contactsRemoved: 0,
    contactFieldsCleared: 0,
    storedExportsExpired: 0,
    peopleRegistryAdded: 0,
    peopleReSuppressed: 0,
    accountsErased: 0,
    accountsAlreadyErased: 0,
    accountsNotInDatabase: 0,
    privacyRequestsReconciled: 0,
    companiesReWithdrawn: 0,
    accountsReSuspended: 0,
    sessionsRevoked: 0,
    sessionIdsRotated: 0,
  };
  try {
    await db.transaction(async (tx) => {
      // 1. company-contact suppressions (widening FIELD -> CONTACT is the one change the immutability trigger allows)
      for (const c of ledger.contactSuppressions) {
        const ins = await tx
          .insert(s.contactSuppressions)
          .values({ identityKind: c.kind, identityDigest: c.digest, scope: c.scope, reasonCode: c.reasonCode })
          .onConflictDoNothing({ target: [s.contactSuppressions.identityKind, s.contactSuppressions.identityDigest] })
          .returning({ id: s.contactSuppressions.id });
        report.contactSuppressionsAdded += ins.length;
        if (!ins.length && c.scope === 'CONTACT') {
          await tx.execute(sql`UPDATE contact_suppressions SET scope = 'CONTACT' WHERE identity_kind = ${c.kind} AND identity_digest = ${c.digest} AND scope = 'FIELD'`);
        }
      }
      const applied = await applySuppressionsToContacts(tx as any);
      report.contactsRemoved = applied.contactsRemoved;
      report.contactFieldsCleared = applied.fieldsCleared;
      // a restore also brings back stored export files taken before the suppression; they may hold the values just removed
      if (applied.contactsRemoved + applied.fieldsCleared > 0) report.storedExportsExpired = await expireStoredExports(tx as any);

      // 2. People registry and status
      const existingPeople = new Set<string>();
      const ids = [...new Set([...ledger.suppressedPeople, ...ledger.peopleRegistry.map((p) => p.personId).filter((x): x is string => !!x)])];
      if (ids.length) for (const r of await tx.select({ id: s.people.id }).from(s.people).where(inArray(s.people.id, ids))) existingPeople.add(r.id);
      for (const p of ledger.peopleRegistry) {
        if (await restoreRegistryEntry(tx as any, p, !!p.personId && existingPeople.has(p.personId))) report.peopleRegistryAdded++;
      }
      const toSuppress = ledger.suppressedPeople.filter((id) => existingPeople.has(id));
      if (toSuppress.length) {
        // same effect as PeoplePublishingService.suppressPerson, for the rows a restore brought back: hidden, roles closed, contacts unpublished
        const hit = await tx.execute(sql`UPDATE people SET data_status = 'SUPPRESSED', updated_at = now() WHERE id IN (${sql.join(toSuppress.map((id) => sql`${id}::uuid`), sql`, `)}) AND data_status <> 'SUPPRESSED'`);
        report.peopleReSuppressed = (hit as any).rowCount ?? 0;
        const list = sql.join(toSuppress.map((id) => sql`${id}::uuid`), sql`, `);
        await tx.execute(sql`UPDATE person_contacts SET is_published = false, updated_at = now() WHERE person_id IN (${list}) AND is_published = true`);
        await tx.execute(sql`UPDATE company_people SET review_status = 'REJECTED', is_published = false, updated_at = now() WHERE person_id IN (${list}) AND (is_published = true OR review_status <> 'REJECTED')`);
      }

      // 3. erased accounts
      for (const a of ledger.erasedAccounts) {
        const [u] = await tx.select({ id: s.users.id, email: s.users.email, deletedAt: s.users.deletedAt }).from(s.users).where(eq(s.users.id, a.userId));
        if (!u) {
          report.accountsNotInDatabase++;
          continue;
        }
        if (u.deletedAt) {
          report.accountsAlreadyErased++;
          continue;
        }
        const emailHash = createHash('sha256').update(u.email.trim().toLowerCase()).digest('hex');
        await eraseAccountData(tx as any, a.userId);
        report.accountsErased++;
        // privacy-request status must agree with what happened: no request may still say PENDING for an account that is gone
        const done = await tx.execute(sql`UPDATE privacy_requests SET status = 'COMPLETED', completed_at = COALESCE(completed_at, now()) WHERE user_id = ${a.userId} AND type = 'DELETE' AND status <> 'COMPLETED'`);
        let reconciled = (done as any).rowCount ?? 0;
        const has = rowsOf(await tx.execute(sql`SELECT 1 AS x FROM privacy_requests WHERE user_id = ${a.userId} AND type = 'DELETE' AND status = 'COMPLETED' LIMIT 1`));
        if (!has.length) {
          const dueAt = new Date(Date.parse(a.deletedAt) + 30 * 86400000);
          await tx.insert(s.privacyRequests).values({ userId: a.userId, emailHash, type: 'DELETE', status: 'COMPLETED', note: 'Re-applied after restore', completedAt: new Date(a.deletedAt), dueAt });
          reconciled++;
        }
        report.privacyRequestsReconciled += reconciled;
      }

      // 4. companies withdrawn and accounts suspended after the backup (ledgers written before Phase 30 do not carry them)
      const withdrawn = ledger.withdrawnBusinesses ?? [];
      if (withdrawn.length) {
        const hit = await tx.execute(sql`UPDATE businesses SET status = 'ARCHIVED', updated_at = now() WHERE id IN (${sql.join(withdrawn.map((id) => sql`${id}::uuid`), sql`, `)}) AND status::text IN ('PUBLISHED', 'VERIFIED')`);
        report.companiesReWithdrawn = (hit as any).rowCount ?? 0;
      }
      const suspended = ledger.suspendedUsers ?? [];
      if (suspended.length) {
        const hit = await tx.execute(sql`UPDATE users SET status = 'SUSPENDED', updated_at = now() WHERE id IN (${sql.join(suspended.map((id) => sql`${id}::uuid`), sql`, `)}) AND status::text = 'ACTIVE'`);
        report.accountsReSuspended = (hit as any).rowCount ?? 0;
      }

      // 5. sessions: a restored database remembers sessions that were revoked and passwords that were changed after the backup, and
      //    forgets sessions opened since. Nothing can say which are still legitimate, so every refresh token is revoked and every
      //    account's session identifier is replaced (once per ledger: repeating the apply does not sign anyone out again).
      const marker = ledger.checksum.slice(0, 16);
      const revoked = await tx.execute(sql`UPDATE refresh_tokens SET is_revoked = true, revoked_at = now(), revoked_reason = 'RESTORE' WHERE is_revoked = false`);
      report.sessionsRevoked = (revoked as any).rowCount ?? 0;
      const rotated = await tx.execute(sql`UPDATE users SET metadata = jsonb_set(jsonb_set(metadata, '{activeSessionId}', to_jsonb(gen_random_uuid()::text)), '{sessionsResetBy}', to_jsonb(${marker}::text)) WHERE metadata ? 'activeSessionId' AND (metadata->>'sessionsResetBy') IS DISTINCT FROM ${marker}`);
      report.sessionIdsRotated = (rotated as any).rowCount ?? 0;

      if (!options.dryRun) {
        await tx.insert(s.auditLogs).values({
          action: 'POST_RESTORE_RECONCILED',
          entityType: 'deletion_ledger',
          entityId: ledger.checksum.slice(0, 16),
          newValues: { ledgerGeneratedAt: ledger.generatedAt, ...report },
        });
      } else {
        throw new DryRunRollback();
      }
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}
