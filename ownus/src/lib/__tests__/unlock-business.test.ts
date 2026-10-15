/* eslint-disable @typescript-eslint/no-explicit-any -- raw SQL rows and decoded JWT payloads are untyped by nature */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { UNLOCK_BUSINESS_SQL, interpretUnlockRow } from '../unlock-business.ts';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../../../apps/api/src/database/migrations');

async function freshDb() {
  const db = new PGlite();
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const e of journal.entries) await db.exec(fs.readFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), 'utf8'));
  return db;
}

describe('gateway fallback: atomic business unlock (real SQL on a real schema)', () => {
  async function setup(daily: number, purchased: number) {
    const db = await freshDb();
    const user = (await db.query<{ id: string }>(`INSERT INTO users (email, first_name, last_name) VALUES ('u@test.dev', 'T', 'U') RETURNING id`)).rows[0].id;
    const wallet = (await db.query<{ id: string }>(
      `INSERT INTO user_wallets (user_id, daily_credits, purchased_credits, balance, last_daily_credit_date) VALUES ($1, $2, $3, $4, CURRENT_DATE::text) RETURNING id`,
      [user, daily, purchased, daily + purchased],
    )).rows[0].id;
    const biz = async (slug: string, status: string) => (await db.query<{ id: string }>(`INSERT INTO businesses (slug, name, status) VALUES ($1, $1, $2) RETURNING id`, [slug, status])).rows[0].id;
    const run = async (businessId: string) => {
      const already = (await db.query(`SELECT 1 FROM lead_unlocks WHERE user_id = $1 AND business_id = $2::uuid`, [user, businessId])).rows.length > 0;
      const row = (await db.query<any>(UNLOCK_BUSINESS_SQL, [wallet, user, businessId])).rows[0];
      return interpretUnlockRow(row, already);
    };
    const state = async () => {
      const w = (await db.query<any>(`SELECT daily_credits, purchased_credits, balance, lifetime_used FROM user_wallets WHERE id = $1`, [wallet])).rows[0];
      const unlocks = (await db.query(`SELECT 1 FROM lead_unlocks WHERE user_id = $1`, [user])).rows.length;
      const ledger = (await db.query(`SELECT 1 FROM credit_transactions WHERE user_id = $1 AND type = 'UNLOCK_LEAD'`, [user])).rows.length;
      return { daily: w.daily_credits, purchased: w.purchased_credits, balance: w.balance, used: w.lifetime_used, unlocks, ledger };
    };
    return { db, user, wallet, biz, run, state };
  }

  it('unlocks once, deducting daily credits first, with a ledger row; repeating is free', async () => {
    const t = await setup(2, 3);
    const b = await t.biz('pub-1', 'PUBLISHED');
    const a = await t.run(b);
    assert.deepEqual(a, { kind: 'UNLOCKED', balance: 4, dailyCredits: 1, purchasedCredits: 3 });
    assert.deepEqual(await t.state(), { daily: 1, purchased: 3, balance: 4, used: 1, unlocks: 1, ledger: 1 });
    assert.deepEqual(await t.run(b), { kind: 'ALREADY_UNLOCKED' });
    assert.deepEqual(await t.state(), { daily: 1, purchased: 3, balance: 4, used: 1, unlocks: 1, ledger: 1 });
    await t.db.close();
  });

  it('concurrent requests charge exactly once', async () => {
    const t = await setup(5, 0);
    const b = await t.biz('pub-2', 'PUBLISHED');
    const results = await Promise.all(Array.from({ length: 8 }, () => t.run(b)));
    assert.equal(results.filter((r) => r.kind === 'UNLOCKED').length, 1);
    assert.deepEqual(await t.state(), { daily: 4, purchased: 0, balance: 4, used: 1, unlocks: 1, ledger: 1 });
    await t.db.close();
  });

  it('falls back to purchased credits when the daily credits are used up', async () => {
    const t = await setup(0, 2);
    assert.equal((await t.run(await t.biz('pub-3', 'PUBLISHED'))).kind, 'UNLOCKED');
    assert.deepEqual(await t.state(), { daily: 0, purchased: 1, balance: 1, used: 1, unlocks: 1, ledger: 1 });
    await t.db.close();
  });

  it('never charges for an unpublished or unknown company, or without credits', async () => {
    const t = await setup(1, 0);
    for (const id of [await t.biz('draft-1', 'DRAFT'), await t.biz('arch-1', 'ARCHIVED'), '00000000-0000-4000-8000-0000000000aa']) {
      assert.deepEqual(await t.run(id), { kind: 'NOT_FOUND' });
    }
    assert.deepEqual(await t.state(), { daily: 1, purchased: 0, balance: 1, used: 0, unlocks: 0, ledger: 0 });
    const t2 = await setup(0, 0);
    assert.deepEqual(await t2.run(await t2.biz('pub-4', 'PUBLISHED')), { kind: 'INSUFFICIENT_CREDITS' });
    assert.deepEqual(await t2.state(), { daily: 0, purchased: 0, balance: 0, used: 0, unlocks: 0, ledger: 0 });
    await t.db.close();
    await t2.db.close();
  });

  it('a spent wallet stops exactly at zero under concurrent unlocks of different companies', async () => {
    const t = await setup(2, 0);
    const ids = await Promise.all(['c1', 'c2', 'c3', 'c4'].map((s) => t.biz(s, 'PUBLISHED')));
    const results = await Promise.all(ids.map((id) => t.run(id)));
    assert.equal(results.filter((r) => r.kind === 'UNLOCKED').length, 2);
    assert.equal(results.filter((r) => r.kind === 'INSUFFICIENT_CREDITS').length, 2);
    assert.deepEqual(await t.state(), { daily: 0, purchased: 0, balance: 0, used: 2, unlocks: 2, ledger: 2 });
    await t.db.close();
  });
});
