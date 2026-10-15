import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHash } from 'crypto';
import * as path from 'path';
import * as schema from '../../../database/schema';
import { buildDeletionLedger, reapplyDeletionLedger, verifyDeletionLedger } from '../deletion-ledger';

/**
 * Phase 30: what a restore must NOT bring back. Two in-memory databases with the same ids stand for "live, after the backup" and
 * "restored from the backup". The ledger written from the live one is applied to the restored one.
 */
const MIGRATIONS = path.resolve(__dirname, '../../../database/migrations');
const ids = {
  company: '11111111-1111-4111-8111-111111111111',
  keptCompany: '22222222-2222-4222-8222-222222222222',
  suspended: '33333333-3333-4333-8333-333333333333',
  active: '44444444-4444-4444-8444-444444444444',
  token: '55555555-5555-4555-8555-555555555555',
  token2: '66666666-6666-4666-8666-666666666666',
};

async function freshDb() {
  const client = new PGlite();
  const db: any = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { client, db };
}

/** The state at backup time. */
async function seedBackupState(db: any) {
  await db.insert(schema.businesses).values([
    { id: ids.company, slug: 'p30-company', name: 'Withdrawn Later', status: 'PUBLISHED' },
    { id: ids.keptCompany, slug: 'p30-kept', name: 'Stays Published', status: 'PUBLISHED' },
  ]);
  await db.insert(schema.users).values([
    { id: ids.suspended, email: 'suspended-later@example.test', firstName: 'S', lastName: 'L', status: 'ACTIVE', metadata: { activeSessionId: 'old-session-a' } },
    { id: ids.active, email: 'active@example.test', firstName: 'A', lastName: 'C', status: 'ACTIVE', metadata: { activeSessionId: 'old-session-b' } },
  ]);
  await db.insert(schema.refreshTokens).values([
    { id: ids.token, userId: ids.active, tokenHash: 'hash-a', expiresAt: new Date(Date.now() + 86_400_000) },
    { id: ids.token2, userId: ids.suspended, tokenHash: 'hash-b', expiresAt: new Date(Date.now() + 86_400_000) },
  ]);
}

describe('restoring a backup does not undo withdrawals, suspensions or session revocations (Phase 30)', () => {
  let live: { client: PGlite; db: any };
  let restored: { client: PGlite; db: any };
  let ledger: any;

  beforeAll(async () => {
    live = await freshDb();
    restored = await freshDb();
    await seedBackupState(live.db);
    await seedBackupState(restored.db);
    // after the backup, on the live system:
    await live.db.update(schema.businesses).set({ status: 'ARCHIVED' }).where(eq(schema.businesses.id, ids.company));
    await live.db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.id, ids.suspended));
    await live.db.update(schema.refreshTokens).set({ isRevoked: true }).where(eq(schema.refreshTokens.id, ids.token));
    ledger = await buildDeletionLedger(live.db);
  }, 60_000);

  afterAll(async () => {
    await live.client.close();
    await restored.client.close();
  });

  it('the ledger carries the withdrawn companies and suspended accounts as ids only', () => {
    expect(ledger.withdrawnBusinesses).toEqual([ids.company]);
    expect(ledger.suspendedUsers).toEqual([ids.suspended]);
    expect(JSON.stringify(ledger)).not.toMatch(/Withdrawn Later|example\.test|p30-company/);
    expect(verifyDeletionLedger(JSON.parse(JSON.stringify(ledger))).checksum).toBe(ledger.checksum);
  });

  it('the new lists are covered by the checksum and must be ids', () => {
    expect(() => verifyDeletionLedger({ ...ledger, withdrawnBusinesses: [] })).toThrow(/checksum/);
    expect(() => verifyDeletionLedger({ ...ledger, suspendedUsers: [ids.suspended, ids.active] })).toThrow(/checksum/);
    expect(() => verifyDeletionLedger({ ...ledger, withdrawnBusinesses: ['not-an-id'] })).toThrow();
  });

  it('before the ledger is applied the restored database has all three undone (this is the exposure)', async () => {
    const [c] = await restored.db.select().from(schema.businesses).where(eq(schema.businesses.id, ids.company));
    const [u] = await restored.db.select().from(schema.users).where(eq(schema.users.id, ids.suspended));
    const [t] = await restored.db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.id, ids.token));
    expect([c.status, u.status, t.isRevoked]).toEqual(['PUBLISHED', 'ACTIVE', false]);
  });

  it('a dry run reports the changes and writes nothing', async () => {
    const dry = await reapplyDeletionLedger(restored.db, ledger, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, companiesReWithdrawn: 1, accountsReSuspended: 1, sessionsRevoked: 2, sessionIdsRotated: 2 });
    const [c] = await restored.db.select().from(schema.businesses).where(eq(schema.businesses.id, ids.company));
    expect(c.status).toBe('PUBLISHED');
  });

  it('applying it withdraws the company, suspends the account, revokes every session and ends every earlier access token; other companies are untouched', async () => {
    const done = await reapplyDeletionLedger(restored.db, ledger, { dryRun: false });
    expect(done).toMatchObject({ companiesReWithdrawn: 1, accountsReSuspended: 1, sessionsRevoked: 2, sessionIdsRotated: 2 });
    const [c] = await restored.db.select().from(schema.businesses).where(eq(schema.businesses.id, ids.company));
    const [kept] = await restored.db.select().from(schema.businesses).where(eq(schema.businesses.id, ids.keptCompany));
    const [u] = await restored.db.select().from(schema.users).where(eq(schema.users.id, ids.suspended));
    const tokens = await restored.db.select().from(schema.refreshTokens);
    const [a] = await restored.db.select().from(schema.users).where(eq(schema.users.id, ids.active));
    expect([c.status, kept.status, u.status]).toEqual(['ARCHIVED', 'PUBLISHED', 'SUSPENDED']);
    expect(tokens.every((t: any) => t.isRevoked && t.revokedReason === 'RESTORE')).toBe(true);
    expect((a.metadata as any).activeSessionId).not.toBe('old-session-b');
    expect((a.metadata as any).sessionsResetBy).toBe(ledger.checksum.slice(0, 16));
  });

  it('applying it again changes nothing and signs nobody out a second time', async () => {
    const [before] = await restored.db.select().from(schema.users).where(eq(schema.users.id, ids.active));
    const again = await reapplyDeletionLedger(restored.db, ledger, { dryRun: false });
    expect(again).toMatchObject({ companiesReWithdrawn: 0, accountsReSuspended: 0, sessionsRevoked: 0, sessionIdsRotated: 0 });
    const [after] = await restored.db.select().from(schema.users).where(eq(schema.users.id, ids.active));
    expect((after.metadata as any).activeSessionId).toBe((before.metadata as any).activeSessionId);
  });

  it('a ledger written before these lists existed is still accepted and does not touch companies or accounts', async () => {
    const { withdrawnBusinesses, suspendedUsers, checksum, ...old } = ledger;
    void withdrawnBusinesses;
    void suspendedUsers;
    void checksum;
    const legacy = { ...old, checksum: createHash('sha256').update(JSON.stringify(old), 'utf8').digest('hex') };
    const fresh = await freshDb();
    try {
      await seedBackupState(fresh.db);
      const r = await reapplyDeletionLedger(fresh.db, legacy, { dryRun: false });
      expect(r).toMatchObject({ companiesReWithdrawn: 0, accountsReSuspended: 0 });
      const [c] = await fresh.db.select().from(schema.businesses).where(eq(schema.businesses.id, ids.company));
      expect(c.status).toBe('PUBLISHED');
    } finally {
      await fresh.client.close();
    }
  });
});
