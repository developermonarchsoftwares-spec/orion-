import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as path from 'path';
import { AuditLogService } from '../../../common/services/audit-log.service';
import * as schema from '../../../database/schema';
import { ContactSuppressionService, contactDigest } from '../contact-suppression.service';
import { buildDeletionLedger, reapplyDeletionLedger, verifyDeletionLedger } from '../deletion-ledger';
import { RETENTION_RUN, optionalRetentionDays } from '../privacy.config';
import { PrivacyService } from '../privacy.service';

/**
 * Phase 16: retention enforcement, deletion completeness, suppression that survives re-import, and restore reconciliation.
 * Real migrations on in-memory PGlite (the database triggers are part of what is tested).
 */
const MIGRATIONS = path.resolve(__dirname, '../../../database/migrations');
const passwords = { compare: async () => true } as any;

async function freshDb() {
  const client = new PGlite();
  const db: any = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { client, db };
}
const actions = async (db: any, action: string) => (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action))) as any[];

describe('retention enforcement', () => {
  let client: PGlite;
  let db: any;
  let svc: PrivacyService;
  const originalRun = { ...RETENTION_RUN };

  beforeAll(async () => {
    ({ client, db } = await freshDb());
    svc = new PrivacyService(db, passwords, new AuditLogService(db));
  });
  afterAll(async () => client.close());
  afterEach(() => Object.assign(RETENTION_RUN, originalRun));
  beforeEach(async () => {
    await client.exec('TRUNCATE users, audit_logs, queue_jobs, privacy_requests, admin_otps CASCADE');
  });

  it('a dry run counts what is eligible and changes nothing', async () => {
    await db.insert(schema.auditLogs).values({ action: 'OLD', entityType: 'x', ipAddress: '1.1.1.1', userAgent: 'ua' });
    await client.exec(`UPDATE audit_logs SET created_at = now() - interval '400 days'`);
    const r = await svc.runRetention({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.counts.auditLogIps).toBe(1);
    const [row] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'OLD'));
    expect(row.ipAddress).toBe('1.1.1.1'); // untouched
  });

  it('RETENTION_DRY_RUN=true turns the scheduled entry point into a preview', async () => {
    await db.insert(schema.auditLogs).values({ action: 'OLD', entityType: 'x', ipAddress: '1.1.1.1' });
    await client.exec(`UPDATE audit_logs SET created_at = now() - interval '400 days'`);
    process.env.RETENTION_DRY_RUN = 'true';
    try {
      expect((await svc.enforceRetention()).auditLogIps).toBe(1);
    } finally {
      delete process.env.RETENTION_DRY_RUN;
    }
    expect((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'OLD')))[0].ipAddress).toBe('1.1.1.1');
  });

  it('works in bounded batches, reports the cap, and a retry finishes the job without touching anything else', async () => {
    Object.assign(RETENTION_RUN, { batchSize: 50, maxBatches: 2 });
    await client.exec(`INSERT INTO audit_logs (action, entity_type, ip_address) SELECT 'OLD', 'x', '2.2.2.2' FROM generate_series(1, 130)`);
    await client.exec(`UPDATE audit_logs SET created_at = now() - interval '400 days'`);
    await db.insert(schema.auditLogs).values({ action: 'RECENT', entityType: 'x', ipAddress: '9.9.9.9' });

    const first = await svc.runRetention({});
    expect(first.counts.auditLogIps).toBe(100);
    expect(first.capped).toContain('auditLogIps');
    const second = await svc.runRetention({});
    expect(second.counts.auditLogIps).toBe(30);
    expect(second.capped).not.toContain('auditLogIps');
    const third = await svc.runRetention({});
    expect(third.counts.auditLogIps).toBe(0); // retry safe: nothing left, nothing repeated
    expect((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'RECENT')))[0].ipAddress).toBe('9.9.9.9');
  });

  it('exclusions: recent rows, jobs still waiting or running, and requests still pending are never removed', async () => {
    await client.exec(`INSERT INTO queue_jobs (queue_name, job_name, data, status, created_at) VALUES
      ('q','done','{}','COMPLETED', now() - interval '40 days'),
      ('q','failed','{}','FAILED', now() - interval '40 days'),
      ('q','waiting','{}','WAITING', now() - interval '40 days'),
      ('q','active','{}','ACTIVE', now() - interval '40 days'),
      ('q','recent','{}','COMPLETED', now() - interval '1 day')`);
    await client.exec(`INSERT INTO privacy_requests (email_hash, type, status, due_at, completed_at) VALUES
      ('a','DELETE','PENDING', now(), NULL),
      ('b','EXPORT','COMPLETED', now(), now() - interval '4 years'),
      ('c','EXPORT','COMPLETED', now(), now() - interval '1 year')`);
    const r = await svc.runRetention({});
    expect(r.counts.queueJobs).toBe(2);
    expect(r.counts.privacyRequests).toBe(1);
    const names = ((await db.select().from(schema.queueJobs)) as any[]).map((j) => j.jobName).sort();
    expect(names).toEqual(['active', 'recent', 'waiting']);
    expect(((await db.select().from(schema.privacyRequests)) as any[]).map((q) => q.emailHash).sort()).toEqual(['a', 'c']);
  });

  it('import raw payloads: not enforced unless a period is approved, and then only rows that no longer drive anything', async () => {
    const [src] = await db.insert(schema.dataSources).values({ name: 'src', type: 'MANUAL_IMPORT' } as any).returning();
    const mk = async (status: string) =>
      (await db.insert(schema.importBatches).values({ sourceId: src.id, filename: 'f.csv', fileKey: 'k', fileSize: 1, status } as any).returning())[0];
    const done = await mk('COMPLETED');
    const failed = await mk('FAILED');
    const rec = (batchId: string, rowNumber: number, isPublished: boolean) =>
      db.insert(schema.importRecords).values({ batchId, rowNumber, rawPayload: { email: 'x@y.z' }, normalizedPayload: { email: 'x@y.z' }, isPublished } as any);
    await rec(done.id, 1, true); // published: scrubbed
    await rec(done.id, 2, false); // awaiting an administrator: kept
    await rec(failed.id, 1, false); // batch ended without publishing: scrubbed
    await client.exec(`UPDATE import_records SET created_at = now() - interval '100 days'`);

    expect((await svc.runRetention({})).counts.importRawPayloads).toBeUndefined(); // off by default
    expect(optionalRetentionDays('RETENTION_IMPORT_RAW_PAYLOAD_DAYS', { RETENTION_IMPORT_RAW_PAYLOAD_DAYS: '0' } as any)).toBeNull();
    expect(optionalRetentionDays('RETENTION_IMPORT_RAW_PAYLOAD_DAYS', { RETENTION_IMPORT_RAW_PAYLOAD_DAYS: 'abc' } as any)).toBeNull();
    expect(optionalRetentionDays('RETENTION_IMPORT_RAW_PAYLOAD_DAYS', { RETENTION_IMPORT_RAW_PAYLOAD_DAYS: '90' } as any)).toBe(90);

    process.env.RETENTION_IMPORT_RAW_PAYLOAD_DAYS = '90';
    try {
      const r = await svc.runRetention({});
      expect(r.counts.importRawPayloads).toBe(2);
    } finally {
      delete process.env.RETENTION_IMPORT_RAW_PAYLOAD_DAYS;
    }
    const rows = (await db.select().from(schema.importRecords)) as any[];
    const kept = rows.filter((x) => x.rawPayload && Object.keys(x.rawPayload).length > 0);
    expect(kept).toHaveLength(1);
    expect(kept[0].isPublished).toBe(false);
  });

  it('records start and completion of a manual run as counts only', async () => {
    await svc.runRetention({ trigger: 'MANUAL', dryRun: true });
    expect(await actions(db, 'RETENTION_JOB_STARTED')).toHaveLength(1);
    const [done] = await actions(db, 'RETENTION_JOB_COMPLETED');
    expect(done.newValues.dryRun).toBe(true);
    expect(typeof done.newValues.counts.auditLogIps).toBe('number');
  });
});

describe('retention failure handling', () => {
  it('one failing rule is reported by error code only; the other rules still run; the failure is audited', async () => {
    const { client, db } = await freshDb();
    try {
      const svc = new PrivacyService(db, passwords, new AuditLogService(db));
      await client.exec(`INSERT INTO queue_jobs (queue_name, job_name, data, status, created_at) VALUES ('q','secret-marker-job','{}','COMPLETED', now() - interval '40 days')`);
      await client.exec('DROP TABLE integration_deliveries CASCADE');
      const r = await svc.runRetention({});
      expect(r.failed.integrationDeliveries).toBe('42P01'); // undefined_table, no SQL text
      expect(r.counts.queueJobs).toBe(1);
      const [fail] = await actions(db, 'RETENTION_JOB_FAILED');
      expect(JSON.stringify(fail)).not.toMatch(/relation|does not exist|SELECT|DELETE/i);
    } finally {
      await client.close();
    }
  });
});

describe('account erasure completeness', () => {
  it('removes old/new values of the account entity from the audit trail and keeps the event itself', async () => {
    const { client, db } = await freshDb();
    try {
      const svc = new PrivacyService(db, passwords, new AuditLogService(db));
      const [u] = await db.insert(schema.users).values({ email: 'grace@example.com', passwordHash: 'x', firstName: 'Grace', lastName: 'H' }).returning();
      await db.insert(schema.auditLogs).values({ userId: u.id, action: 'PROFILE_UPDATED', entityType: 'user', entityId: u.id, oldValues: { email: 'grace@example.com' }, newValues: { email: 'g2@example.com' } });
      await db.insert(schema.auditLogs).values({ userId: u.id, action: 'OTHER_ENTITY', entityType: 'saved_search', entityId: 'abc', newValues: { name: 'keep' } });
      const req = await svc.requestDeletion(u.id, 'grace@example.com', 'x', { ip: null, userAgent: null });
      await db.update(schema.privacyRequests).set({ executeAfter: new Date(Date.now() - 1000) }).where(eq(schema.privacyRequests.id, req.id));
      expect(await svc.runDueDeletions()).toBe(1);
      const [profile] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'PROFILE_UPDATED'));
      expect(profile.oldValues).toBeNull();
      expect(profile.newValues).toBeNull();
      const [other] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'OTHER_ENTITY'));
      expect(other.newValues).toEqual({ name: 'keep' });
      expect(JSON.stringify(await db.select().from(schema.auditLogs))).not.toContain('grace@example.com');
    } finally {
      await client.close();
    }
  });
});

describe('contact suppression', () => {
  let client: PGlite;
  let db: any;
  let svc: ContactSuppressionService;
  let businessId: string;

  beforeAll(async () => {
    ({ client, db } = await freshDb());
    svc = new ContactSuppressionService(db, new AuditLogService(db));
  });
  afterAll(async () => client.close());
  beforeEach(async () => {
    await client.exec('TRUNCATE businesses CASCADE; DELETE FROM audit_logs');
    const [b] = await db.insert(schema.businesses).values({ slug: `b-${Math.random().toString(36).slice(2)}`, name: 'Acme Traders', status: 'PUBLISHED', publishedAt: new Date() }).returning();
    businessId = b.id;
  });

  const contact = (v: Partial<typeof schema.businessContacts.$inferInsert>) => db.insert(schema.businessContacts).values({ businessId, fullName: 'Person', ...v }).returning();

  it('normalises so formatting changes do not bypass it, without blocking unrelated values', async () => {
    const d = (k: any, v: string) => contactDigest(db, k, v);
    const email = await d('EMAIL', 'ada@example.com');
    expect(await d('EMAIL', '  ADA@Example.COM ')).toBe(email);
    expect(await d('EMAIL', 'ada2@example.com')).not.toBe(email);
    const phone = await d('PHONE', '9876543210');
    expect(await d('PHONE', '+91 98765-43210')).toBe(phone);
    expect(await d('PHONE', '09876543210')).toBe(phone);
    expect(await d('PHONE', '9876543211')).not.toBe(phone);
    const li = await d('LINKEDIN', 'https://www.linkedin.com/in/ada');
    expect(await d('LINKEDIN', 'http://in.linkedin.com/in/ada/?utm=1#x')).toBe(li);
    expect(await d('LINKEDIN', 'https://www.linkedin.com/in/ada-other')).not.toBe(li);
    expect(await d('EMAIL', 'not-an-email')).toBeNull();
    expect(await d('PHONE', '123')).toBeNull();
  });

  it('removes existing rows for a CONTACT suppression and re-import cannot bring them back (any writer)', async () => {
    await contact({ email: 'Ada@Example.com', phone: '9876543210' });
    const keep = (await contact({ email: 'other@example.com' }))[0];
    const r = await svc.suppress({ kind: 'EMAIL', value: ' ada@example.COM', reasonCode: 'REMOVAL' });
    expect(r).toMatchObject({ created: true, scope: 'CONTACT', contactsRemoved: 1 });
    expect(((await db.select().from(schema.businessContacts)) as any[]).map((c) => c.id)).toEqual([keep.id]);

    // re-import: a plain insert, an update that sets the value, with different formatting
    expect(await contact({ email: 'ADA@example.com ' })).toHaveLength(0); // the guard drops the whole row
    const [other] = await contact({ email: null });
    await db.update(schema.businessContacts).set({ email: 'ada@example.com' }).where(eq(schema.businessContacts.id, other.id));
    expect(((await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.id, other.id))) as any[])[0].email).toBeNull();
  });

  it('a phone suppression clears only that number and keeps the contact; an unrelated number is untouched', async () => {
    const [a] = await contact({ fullName: 'A', email: 'a@example.com', phone: '+91 98765 43210', isPhoneVerified: true });
    const [b] = await contact({ fullName: 'B', phone: '9000000000' });
    const r = await svc.suppress({ kind: 'PHONE', value: '09876543210', scope: 'CONTACT', reasonCode: 'SUPPRESSION' });
    expect(r.scope).toBe('FIELD'); // phones are never whole-contact
    const rows = (await db.select().from(schema.businessContacts)) as any[];
    const ra = rows.find((x) => x.id === a.id);
    expect(ra).toMatchObject({ phone: null, isPhoneVerified: false, email: 'a@example.com' });
    expect(rows.find((x) => x.id === b.id).phone).toBe('9000000000');
    expect(await contact({ fullName: 'C', phone: '9876543210' }).then((x: any[]) => x[0].phone)).toBeNull();
  });

  it('is idempotent, can be widened but never narrowed or deleted, and stores no raw value', async () => {
    await svc.suppress({ kind: 'LINKEDIN', value: 'https://linkedin.com/in/ada', scope: 'FIELD', reasonCode: 'SUPPRESSION' });
    const again = await svc.suppress({ kind: 'LINKEDIN', value: 'https://www.linkedin.com/in/ada/', scope: 'CONTACT', reasonCode: 'SUPPRESSION' });
    expect(again).toMatchObject({ created: false, scope: 'CONTACT' });
    expect(((await db.select().from(schema.contactSuppressions)) as any[]).filter((c) => c.identityKind === 'LINKEDIN')).toHaveLength(1);
    await expect(client.exec(`DELETE FROM contact_suppressions`)).rejects.toThrow(/cannot be deleted/);
    await expect(client.exec(`UPDATE contact_suppressions SET scope = 'FIELD'`)).rejects.toThrow(/cannot be edited/);
    await expect(client.exec(`UPDATE contact_suppressions SET identity_digest = repeat('0', 64)`)).rejects.toThrow(/cannot be edited/);
    const dump = JSON.stringify(await db.select().from(schema.contactSuppressions)) + JSON.stringify(await db.select().from(schema.auditLogs));
    expect(dump).not.toContain('linkedin.com/in/ada');
    expect(await svc.isSuppressed('LINKEDIN', 'https://LINKEDIN.com/in/ada')).toBe(true);
    expect(await svc.isSuppressed('LINKEDIN', 'https://linkedin.com/in/someone-else')).toBe(false);
  });

  it('audits the decision with counts only, and refuses a value that cannot be normalised', async () => {
    await contact({ email: 'z@example.com' });
    await svc.suppress({ kind: 'EMAIL', value: 'z@example.com', reasonCode: 'REMOVAL' });
    const [a] = await actions(db, 'CONTACT_SUPPRESSION_ADDED');
    expect(a.newValues).toMatchObject({ kind: 'EMAIL', scope: 'CONTACT', reasonCode: 'REMOVAL', contactsRemoved: 1 });
    expect(JSON.stringify(a)).not.toContain('z@example.com');
    await expect(svc.suppress({ kind: 'EMAIL', value: 'nope', reasonCode: 'REMOVAL' })).rejects.toThrow(/valid/);
    await expect(svc.suppress({ kind: 'EMAIL', value: 'a@b.co', reasonCode: 'WHATEVER' as any })).rejects.toThrow(/reason/i);
  });
});

describe('deletion ledger and restore', () => {
  /** Live database: suppressions and an erasure exist. Backup database: the same schema, snapshot taken BEFORE they existed. */
  async function scenario() {
    const live = await freshDb();
    const backup = await freshDb();
    const seed = async (db: any) => {
      const [u] = await db.insert(schema.users).values({ email: 'erased@example.com', firstName: 'Eve', lastName: 'E', phoneNumber: '+100' }).returning();
      const [b] = await db.insert(schema.businesses).values({ slug: 'acme', name: 'Acme', status: 'PUBLISHED', publishedAt: new Date() }).returning();
      await db.insert(schema.businessContacts).values({ businessId: b.id, fullName: 'Removed Person', email: 'gone@example.com', phone: '9876543210' });
      await db.insert(schema.businessContacts).values({ businessId: b.id, fullName: 'Stays', email: 'stays@example.com' });
      const [p] = await db.insert(schema.people).values({ fullName: 'Opt Out', normalizedName: 'opt out', dataStatus: 'PUBLISHED' } as any).returning();
      return { userId: u.id as string, personId: p.id as string };
    };
    const liveIds = await seed(live.db);
    // the snapshot is a copy of the live rows taken before the deletions (same ids)
    await backup.db.insert(schema.users).values({ id: liveIds.userId, email: 'erased@example.com', firstName: 'Eve', lastName: 'E', phoneNumber: '+100' });
    const [b] = await backup.db.insert(schema.businesses).values({ slug: 'acme', name: 'Acme', status: 'PUBLISHED', publishedAt: new Date() }).returning();
    await backup.db.insert(schema.businessContacts).values({ businessId: b.id, fullName: 'Removed Person', email: 'gone@example.com', phone: '9876543210' });
    await backup.db.insert(schema.businessContacts).values({ businessId: b.id, fullName: 'Stays', email: 'stays@example.com' });
    await backup.db.insert(schema.people).values({ id: liveIds.personId, fullName: 'Opt Out', normalizedName: 'opt out', dataStatus: 'PUBLISHED' } as any);
    await backup.db.insert(schema.privacyRequests).values({ userId: liveIds.userId, emailHash: 'h', type: 'DELETE', status: 'PENDING', dueAt: new Date() });

    // after the backup: erase the account, suppress the contact, suppress the person
    const privacy = new PrivacyService(live.db, passwords, new AuditLogService(live.db));
    const req = await privacy.requestDeletion(liveIds.userId, 'erased@example.com', undefined, { ip: null, userAgent: null });
    await live.db.update(schema.privacyRequests).set({ executeAfter: new Date(Date.now() - 1000) }).where(eq(schema.privacyRequests.id, req.id));
    await privacy.runDueDeletions();
    await new ContactSuppressionService(live.db).suppress({ kind: 'EMAIL', value: 'gone@example.com', reasonCode: 'REMOVAL' });
    await live.db.update(schema.people).set({ dataStatus: 'SUPPRESSED' }).where(eq(schema.people.id, liveIds.personId));
    await live.db.insert(schema.peopleSuppressions).values({ personId: liveIds.personId, identityKind: 'WORK_EMAIL', identityDigest: `h:${'a'.repeat(64)}`, origin: 'REVIEWER_ACTION', suppressedByKind: 'REVIEWER' } as any);
    return { live, backup, ...liveIds };
  }

  it('the ledger holds digests and ids only', async () => {
    const { live, userId } = await scenario();
    try {
      const ledger = await buildDeletionLedger(live.db);
      const text = JSON.stringify(ledger);
      for (const raw of ['gone@example.com', 'erased@example.com', 'Eve', '9876543210', 'Opt Out', 'Acme']) expect(text).not.toContain(raw);
      expect(ledger.erasedAccounts.map((a) => a.userId)).toEqual([userId]);
      expect(ledger.contactSuppressions).toHaveLength(1);
      expect(ledger.suppressedPeople).toHaveLength(1);
      expect(verifyDeletionLedger(JSON.parse(text)).checksum).toBe(ledger.checksum);
    } finally {
      await live.client.close();
    }
  });

  it('refuses a damaged or foreign ledger before writing anything', async () => {
    const { live } = await scenario();
    try {
      const ledger = await buildDeletionLedger(live.db);
      expect(() => verifyDeletionLedger({ ...ledger, erasedAccounts: [] })).toThrow(/checksum/);
      expect(() => verifyDeletionLedger({ ...ledger, format: 'other' })).toThrow(/unknown format/);
      expect(() => verifyDeletionLedger(null)).toThrow();
      const bad = { ...ledger, contactSuppressions: [{ kind: 'EMAIL', digest: 'not-a-digest', scope: 'CONTACT', reasonCode: 'REMOVAL', createdAt: '' }] };
      const { checksum: _c, ...body } = bad as any;
      const forged = { ...body, checksum: require('crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex') };
      expect(() => verifyDeletionLedger(forged)).toThrow(/invalid contact suppression/);
    } finally {
      await live.client.close();
    }
  });

  it('after a restore, a dry run reports the changes and writes nothing; applying brings the deletions back; a second apply changes nothing', async () => {
    const { live, backup, userId, personId } = await scenario();
    try {
      const ledger = await buildDeletionLedger(live.db);
      const db = backup.db;

      const dry = await reapplyDeletionLedger(db, ledger, { dryRun: true });
      expect(dry).toMatchObject({ dryRun: true, contactSuppressionsAdded: 1, contactsRemoved: 1, accountsErased: 1, peopleReSuppressed: 1 });
      const [stillThere] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(stillThere.email).toBe('erased@example.com'); // rolled back
      expect(await db.select().from(schema.contactSuppressions)).toHaveLength(0);

      const done = await reapplyDeletionLedger(db, ledger, { dryRun: false });
      expect(done).toMatchObject({ contactSuppressionsAdded: 1, contactsRemoved: 1, accountsErased: 1, peopleReSuppressed: 1, peopleRegistryAdded: 1 });

      // account anonymised, request state consistent
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(u).toMatchObject({ firstName: 'Deleted', passwordHash: null, phoneNumber: null });
      expect(u.deletedAt).not.toBeNull();
      const reqs = (await db.select().from(schema.privacyRequests).where(eq(schema.privacyRequests.userId, userId))) as any[];
      expect(reqs.every((r) => r.status === 'COMPLETED')).toBe(true);
      // suppressed contact gone, unrelated contact kept; and it cannot be written again
      const contacts = (await db.select().from(schema.businessContacts)) as any[];
      expect(contacts.map((c) => c.fullName)).toEqual(['Stays']);
      const [biz] = await db.select().from(schema.businesses);
      expect(await db.insert(schema.businessContacts).values({ businessId: biz.id, fullName: 'Again', email: 'GONE@example.com' }).returning()).toHaveLength(0);
      // person hidden
      const [p] = await db.select().from(schema.people).where(eq(schema.people.id, personId));
      expect(p.dataStatus).toBe('SUPPRESSED');
      // audited with counts only
      const [audit] = await actions(db, 'POST_RESTORE_RECONCILED');
      expect(audit.newValues).toMatchObject({ accountsErased: 1 });
      expect(JSON.stringify(audit)).not.toContain('@');

      const again = await reapplyDeletionLedger(db, ledger, { dryRun: false });
      expect(again).toMatchObject({ contactSuppressionsAdded: 0, contactsRemoved: 0, accountsErased: 0, accountsAlreadyErased: 1, peopleReSuppressed: 0, peopleRegistryAdded: 0 });
    } finally {
      await live.client.close();
      await backup.client.close();
    }
  });

  it('a failure in the middle rolls everything back (all or nothing)', async () => {
    const { live, backup, userId } = await scenario();
    try {
      const ledger = await buildDeletionLedger(live.db);
      // make the account step fail after the suppression steps ran
      await backup.client.exec(`CREATE OR REPLACE FUNCTION fail_erase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
        CREATE TRIGGER fail_erase BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fail_erase();`);
      await expect(reapplyDeletionLedger(backup.db, ledger, { dryRun: false })).rejects.toThrow();
      expect(await backup.db.select().from(schema.contactSuppressions)).toHaveLength(0);
      expect(((await backup.db.select().from(schema.businessContacts)) as any[]).length).toBe(2);
      expect(((await backup.db.select().from(schema.users).where(eq(schema.users.id, userId))) as any[])[0].deletedAt).toBeNull();
      expect(await actions(backup.db, 'POST_RESTORE_RECONCILED')).toHaveLength(0);
    } finally {
      await live.client.close();
      await backup.client.close();
    }
  });
});

describe('production safety of the tooling', () => {
  const guard = require('../../../database/db-guard') as typeof import('../../../database/db-guard');

  it('the manual retention and ledger scripts refuse a remote database, even for a dry run', () => {
    for (const label of ['retention-run', 'deletion-ledger reapply']) {
      expect(() => guard.assertDestructiveAllowed({ label, url: 'postgresql://u:p@db.example.com:5432/orion_db', argv: [] })).toThrow(/local database/);
    }
  });

  it('without --apply a local run is a dry run; with --apply it still needs the confirmation and a fresh backup', () => {
    const url = 'postgresql://u:p@localhost:5432/orion_db';
    expect(guard.assertDestructiveAllowed({ label: 'retention-run', url, argv: [], env: {} as any }).apply).toBe(false);
    expect(() => guard.assertDestructiveAllowed({ label: 'retention-run', url, argv: ['--apply'], env: {} as any })).toThrow(/CONFIRM_DESTRUCTIVE_DATABASE/);
    expect(() => guard.assertDestructiveAllowed({ label: 'retention-run', url, argv: ['--apply'], env: { CONFIRM_DESTRUCTIVE_DATABASE: 'orion_db' } as any, backupDir: path.join(__dirname, 'no-such-dir') })).toThrow(/backup/i);
  });
});

describe('stored export files and suppression (Phase 22)', () => {
  const stored = (db: any, userId: string, label: string) =>
    db.insert(schema.exportJobs).values({ userId, dataset: 'saved-leads', format: 'csv', source: 'SCHEDULED', status: 'COMPLETED', rowCount: 1, fileName: `${label}.csv`, sizeBytes: 3, content: Buffer.from('abc') }).returning();
  const seed = async (db: any) => {
    const [u] = await db.insert(schema.users).values({ email: `owner-${Math.random().toString(36).slice(2)}@example.test`, firstName: 'O', lastName: 'W' }).returning();
    const [b] = await db.insert(schema.businesses).values({ slug: `exp-${Math.random().toString(36).slice(2)}`, name: 'Export Co', status: 'PUBLISHED', publishedAt: new Date() }).returning();
    await db.insert(schema.businessContacts).values({ businessId: b.id, fullName: 'Held', email: 'held@example.test' });
    return { userId: u.id as string, businessId: b.id as string };
  };

  it('a suppression that removes a value expires the stored files; one that removes nothing leaves them', async () => {
    const { client, db } = await freshDb();
    try {
      const { userId } = await seed(db);
      await stored(db, userId, 'before');
      const svc = new ContactSuppressionService(db, new AuditLogService(db));

      const none = await svc.suppress({ kind: 'EMAIL', value: 'nobody@example.test', reasonCode: 'REMOVAL' });
      expect(none.contactsRemoved + none.fieldsCleared).toBe(0);
      expect(none.storedExportsExpired).toBe(0);
      expect(((await db.select().from(schema.exportJobs)) as any[])[0].content).not.toBeNull();

      const hit = await svc.suppress({ kind: 'EMAIL', value: 'HELD@example.test', reasonCode: 'REMOVAL' });
      expect(hit.contactsRemoved).toBe(1);
      expect(hit.storedExportsExpired).toBe(1);
      const [job] = (await db.select().from(schema.exportJobs)) as any[];
      expect(job.content).toBeNull();
      expect(job.status).toBe('EXPIRED');
      expect(job.fileName).toBe('before.csv'); // the history row stays
      const [audit] = (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'CONTACT_SUPPRESSION_ADDED')).orderBy(schema.auditLogs.createdAt).limit(5)) as any[];
      expect(JSON.stringify(audit)).not.toContain('held@example.test');
    } finally {
      await client.close();
    }
  });

  it('a restore brings stored files back; re-applying the ledger expires them when it removes a value', async () => {
    const live = await freshDb();
    const backup = await freshDb();
    try {
      const l = await seed(live.db);
      await new ContactSuppressionService(live.db, new AuditLogService(live.db)).suppress({ kind: 'EMAIL', value: 'held@example.test', reasonCode: 'REMOVAL' });
      const ledger = await buildDeletionLedger(live.db);

      const b = await seed(backup.db); // the snapshot taken before the suppression: the contact and a stored file are both there
      await stored(backup.db, b.userId, 'restored');
      const dry = await reapplyDeletionLedger(backup.db, ledger, { dryRun: true });
      expect(dry.storedExportsExpired).toBe(1);
      expect(((await backup.db.select().from(schema.exportJobs)) as any[])[0].content).not.toBeNull(); // dry run wrote nothing

      const done = await reapplyDeletionLedger(backup.db, ledger, { dryRun: false });
      expect(done).toMatchObject({ contactsRemoved: 1, storedExportsExpired: 1 });
      expect(((await backup.db.select().from(schema.exportJobs)) as any[])[0]).toMatchObject({ content: null, status: 'EXPIRED' });
      expect(l.userId).toBeTruthy();
    } finally {
      await live.client.close();
      await backup.client.close();
    }
  });
});

describe('privacy-processing failures are recorded for the monitoring rules (Phase 24)', () => {
  it('a failed scheduled deletion is audited with the error code only, the account stays pending for the next hourly run, and other deletions still run', async () => {
    const { client, db } = await freshDb();
    try {
      const svc = new PrivacyService(db, passwords, new AuditLogService(db));
      const mk = async (email: string) => (await db.insert(schema.users).values({ email, firstName: 'U', lastName: 'S' }).returning())[0];
      const bad = await mk('bad@example.test');
      const good = await mk('good@example.test');
      for (const u of [bad, good]) {
        const req = await svc.requestDeletion(u.id, u.email, undefined, { ip: null, userAgent: null });
        await db.update(schema.privacyRequests).set({ executeAfter: new Date(Date.now() - 1000) }).where(eq(schema.privacyRequests.id, req.id));
      }
      // make the anonymising update fail for one account only
      await client.exec(`CREATE FUNCTION fail_bad() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.first_name = 'Deleted' AND OLD.email = 'bad@example.test' THEN RAISE EXCEPTION 'boom-secret-detail'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_bad BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fail_bad();`);
      expect(await svc.runDueDeletions()).toBe(1); // the good one ran
      const failed = (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'PRIVACY_DELETE_FAILED'))) as any[];
      expect(failed).toHaveLength(1);
      expect(failed[0].newValues.code).toBeTruthy();
      expect(JSON.stringify(failed[0])).not.toMatch(/boom-secret-detail|bad@example|good@example/);
      const pending = (await db.select().from(schema.privacyRequests).where(eq(schema.privacyRequests.userId, bad.id))) as any[];
      expect(pending[0].status).toBe('PENDING'); // retried by the next run, not lost
    } finally {
      await client.close();
    }
  });
});
