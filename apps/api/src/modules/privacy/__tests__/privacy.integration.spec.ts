import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as path from 'path';
import * as schema from '../../../database/schema';
import { PrivacyService } from '../privacy.service';

/** Real migrations on in-memory PGlite: export, consent ledger, scheduled erasure, retention. */
const MIGRATIONS = path.resolve(__dirname, '../../../database/migrations');
const ctx = { ip: '203.0.113.9', userAgent: 'jest' };

describe('privacy (GDPR / CCPA)', () => {
  let client: PGlite;
  let db: any;
  let svc: PrivacyService;
  let userId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const passwords = { compare: async (plain: string, hash: string) => hash === `h:${plain}` } as any;
    svc = new PrivacyService(db, passwords);
  });
  afterAll(async () => client.close());

  beforeEach(async () => {
    await client.exec('TRUNCATE users CASCADE');
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'Ada@Example.com', passwordHash: 'h:secret', firstName: 'Ada', lastName: 'L', phoneNumber: '+100', twoFactorSecret: 'TOTPSECRET' })
      .returning();
    userId = u.id;
    await db.insert(schema.savedSearches).values({ userId, name: 'mine', filters: {} } as any);
    await db.insert(schema.auditLogs).values({ userId, action: 'LOGIN', entityType: 'user', ipAddress: '1.2.3.4', userAgent: 'ua' });
  });

  it('consent defaults to not granted, records changes, and the latest choice wins', async () => {
    expect((await svc.getConsents(userId)).consents.MARKETING.granted).toBe(false);
    await svc.setConsent(userId, 'MARKETING', true, ctx);
    await svc.setConsent(userId, 'MARKETING', false, ctx);
    const c = await svc.getConsents(userId);
    expect(c.consents.MARKETING.granted).toBe(false);
    expect(c.consents.MARKETING.policyVersion).toBeTruthy();
    expect((await db.select().from(schema.consentRecords)).length).toBe(2); // append-only history
  });

  it('export contains the user data and never the secrets', async () => {
    const out = await svc.exportData(userId, ctx);
    const json = JSON.stringify(out);
    expect(out.profile.email).toBe('Ada@Example.com');
    expect(out.savedSearches).toHaveLength(1);
    expect(json).not.toContain('h:secret');
    expect(json).not.toContain('TOTPSECRET');
    expect(json).not.toContain('passwordHash');
    expect((await svc.listRequests(userId))[0]).toMatchObject({ type: 'EXPORT', status: 'COMPLETED' });
  });

  it('export lists export jobs as metadata only, never the stored file bytes (Phase 9)', async () => {
    const marker = 'STORED-EXPORT-BYTES-MARKER';
    await db.insert(schema.exportJobs).values({ userId, dataset: 'saved-leads', format: 'csv', source: 'SCHEDULED', status: 'COMPLETED', rowCount: 1, fileName: 'orion-x.csv', sizeBytes: marker.length, content: Buffer.from(marker) });
    const out: any = await svc.exportData(userId, ctx);
    expect(out.exportJobs).toHaveLength(1);
    expect(out.exportJobs[0].fileName).toBe('orion-x.csv');
    expect(Object.keys(out.exportJobs[0])).not.toContain('content');
    expect(JSON.stringify(out)).not.toContain(Buffer.from(marker).toString('base64'));
    expect(JSON.stringify(out)).not.toContain(String(Buffer.from(marker)[0]) + ',' + String(Buffer.from(marker)[1]));
  });

  it('deletion needs the right e-mail and password, waits out the cooling-off period, and can be cancelled', async () => {
    await expect(svc.requestDeletion(userId, 'other@example.com', 'secret', ctx)).rejects.toThrow('does not match');
    await expect(svc.requestDeletion(userId, 'ada@example.com', 'wrong', ctx)).rejects.toThrow('Password');
    const req = await svc.requestDeletion(userId, 'ada@example.com', 'secret', ctx);
    expect(req.status).toBe('PENDING');
    expect((await svc.requestDeletion(userId, 'ada@example.com', 'secret', ctx)).id).toBe(req.id); // idempotent
    expect(await svc.runDueDeletions()).toBe(0); // grace period not over
    expect((await svc.cancelDeletion(userId, ctx)).cancelled).toBe(1);
    expect(await svc.runDueDeletions()).toBe(0);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u.deletedAt).toBeNull();
  });

  it('erasure anonymises the account, removes personal data, and keeps financial rows', async () => {
    const req = await svc.requestDeletion(userId, 'ada@example.com', 'secret', ctx);
    await db.update(schema.privacyRequests).set({ executeAfter: new Date(Date.now() - 1000) }).where(eq(schema.privacyRequests.id, req.id));
    expect(await svc.runDueDeletions()).toBe(1);

    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u.email).toBe(`deleted-${userId}@deleted.invalid`);
    expect(u).toMatchObject({ firstName: 'Deleted', passwordHash: null, phoneNumber: null, twoFactorSecret: null, status: 'INACTIVE' });
    expect(u.deletedAt).not.toBeNull();
    expect(await db.select().from(schema.savedSearches).where(eq(schema.savedSearches.userId, userId))).toHaveLength(0);
    const [audit] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'LOGIN'));
    expect(audit.ipAddress).toBeNull();
    expect(await svc.executeDeletion(req.id)).toBe(false); // already done
    await expect(svc.exportData(userId, ctx)).rejects.toThrow('not found');
  });

  it('retention blanks old audit-log IPs and keeps recent ones', async () => {
    await client.exec(`UPDATE audit_logs SET created_at = now() - interval '400 days'`);
    await db.insert(schema.auditLogs).values({ userId, action: 'RECENT', entityType: 'user', ipAddress: '9.9.9.9' });
    const out = await svc.enforceRetention();
    expect(out.auditLogIps).toBe(1);
    const rows = await db.select().from(schema.auditLogs);
    expect(rows.find((r: any) => r.action === 'LOGIN').ipAddress).toBeNull();
    expect(rows.find((r: any) => r.action === 'RECENT').ipAddress).toBe('9.9.9.9');
  });
});
