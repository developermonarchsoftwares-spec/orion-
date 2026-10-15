/* eslint-disable @typescript-eslint/no-explicit-any -- raw SQL rows are untyped by nature */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CLAIM_OTP_ATTEMPT_SQL, claimOtpAttempt, redeemOtp, type OtpQuery } from '../admin-otp-store.ts';
import { adminSessionTtlSeconds, isDefinitiveUpstream } from '../gateway-auth.ts';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../password.ts';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../../../apps/api/src/database/migrations');

async function freshDb() {
  const db = new PGlite();
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const e of journal.entries) await db.exec(fs.readFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), 'utf8'));
  return db;
}

async function withOtp(maxAttempts = 5, fn: (ctx: { query: OtpQuery; id: string; attempts: () => Promise<number>; exists: () => Promise<boolean> }) => Promise<void>) {
  const db = await freshDb();
  const query: OtpQuery = async (text, params) => (await db.query<any>(text, params as any[])).rows;
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO admin_otps (email, otp, attempts, max_attempts, expires_at) VALUES ('a@monarchsoftwares.com', 'hash', 0, $1, NOW() + interval '5 minutes') RETURNING id`,
      [maxAttempts],
    )
  ).rows[0].id;
  try {
    await fn({
      query,
      id,
      attempts: async () => Number((await db.query<any>(`SELECT attempts FROM admin_otps WHERE id = $1`, [id])).rows[0]?.attempts),
      exists: async () => (await db.query(`SELECT 1 FROM admin_otps WHERE id = $1`, [id])).rows.length > 0,
    });
  } finally {
    await db.close();
  }
}

describe('admin one-time code bookkeeping (real SQL on a real schema)', () => {
  it('parallel guesses can never claim more attempts than the code allows', async () => {
    await withOtp(5, async ({ query, id, attempts }) => {
      const results = await Promise.all(Array.from({ length: 25 }, () => claimOtpAttempt(query, id)));
      assert.equal(results.filter(Boolean).length, 5);
      assert.equal(await attempts(), 5);
      assert.equal(await claimOtpAttempt(query, id), false); // locked
    });
  });

  it('a code is redeemed exactly once, even by parallel requests', async () => {
    await withOtp(5, async ({ query, id, exists }) => {
      const results = await Promise.all(Array.from({ length: 12 }, () => redeemOtp(query, id)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await exists(), false);
      assert.equal(await redeemOtp(query, id), false); // replay
    });
  });

  it('refuses (fails closed) when the database answers nothing', async () => {
    const down: OtpQuery = async () => [];
    assert.equal(await claimOtpAttempt(down, 'x'), false);
    assert.equal(await redeemOtp(down, 'x'), false);
  });

  it('the claim statement is a single conditional UPDATE (no read-then-write)', () => {
    assert.match(CLAIM_OTP_ATTEMPT_SQL, /^UPDATE admin_otps SET attempts = attempts \+ 1 WHERE id = \$1 AND attempts < max_attempts RETURNING id$/);
  });
});

describe('gateway credential endpoints: when the native fallback may run', () => {
  it('a definitive API answer is returned as is; only an outage or a missing route falls back', () => {
    for (const s of [200, 201, 400, 401, 403, 409, 422, 429]) assert.equal(isDefinitiveUpstream(s), true, `status ${s}`);
    for (const s of [404, 500, 502, 503, 504]) assert.equal(isDefinitiveUpstream(s), false, `status ${s}`);
  });
});

describe('administrator session lifetime', () => {
  it('defaults to 12 hours (was 7 days) and is bounded between 15 minutes and 7 days', () => {
    assert.equal(adminSessionTtlSeconds({} as NodeJS.ProcessEnv), 12 * 3600);
    assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '3600' } as any), 3600);
    assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '5' } as any), 15 * 60);
    assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '99999999' } as any), 7 * 24 * 3600);
    assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: 'abc' } as any), 12 * 3600);
    assert.equal(adminSessionTtlSeconds({ ADMIN_SESSION_TTL_SECONDS: '-10' } as any), 12 * 3600);
  });
});

describe('password checks', () => {
  it('the timing equaliser does real work and never throws, and real verification is unchanged', async () => {
    const t0 = Date.now();
    await burnPasswordCheck('anything');
    assert.ok(Date.now() - t0 >= 5, 'burnPasswordCheck should cost real time like a verification');
    await burnPasswordCheck('x'.repeat(5000)); // over the length bound: returns without work
    const hash = await hashPassword('Correct-Horse-1');
    assert.equal(await verifyPassword('Correct-Horse-1', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('Correct-Horse-1', null), false);
  });
});
