/* eslint-disable @typescript-eslint/no-explicit-any -- untyped DB rows and deliberately malformed inputs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fixedOtpAllowed, toAdminAccount } from '../admin-role.ts';

const row = (over: Record<string, unknown> = {}) => ({ id: '3f1c1a52-6f0f-4e0b-9d3a-0a6f2f6b7c11', email: 'a@monarchsoftwares.com', role: 'ADMIN', status: 'ACTIVE', first_name: 'A', last_name: 'B', ...over });

describe('admin authorization is a persisted role', () => {
  it('only an ACTIVE ADMIN / SUPER_ADMIN row is an admin account, and the role comes from the row', () => {
    assert.equal(toAdminAccount(row())?.role, 'ADMIN');
    assert.equal(toAdminAccount(row({ role: 'SUPER_ADMIN' }))?.role, 'SUPER_ADMIN');
    for (const bad of [row({ role: 'USER' }), row({ role: 'MEMBER' }), row({ role: 'DATA_MANAGER' }), row({ status: 'SUSPENDED' }), row({ status: 'INACTIVE' }), row({ role: undefined }), null, undefined]) {
      assert.equal(toAdminAccount(bad as any), null);
    }
  });

  it('a company e-mail domain alone confers nothing', () => {
    assert.equal(toAdminAccount(row({ email: 'anyone@monarchsoftwares.com', role: 'USER' })), null);
  });

  it('the fixed OTP is honoured only under automated tests against a LOCAL database (S-03)', () => {
    const localDb = 'postgresql://postgres:postgres@127.0.0.1:5432/orion_db';
    // Only NODE_ENV=test AND a local database enables the deterministic code.
    assert.equal(fixedOtpAllowed({ NODE_ENV: 'test', DATABASE_URL: localDb } as any), true);
    assert.equal(fixedOtpAllowed({ NODE_ENV: 'test', GATEWAY_DATABASE_URL: localDb } as any), true);
    // Everything else — including plain `development`, and `test` against a remote DB — is refused.
    for (const env of [
      { NODE_ENV: 'development', DATABASE_URL: localDb },
      { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@ep-weathered-surf.neon.tech/db' },
      { NODE_ENV: 'test' },
      { NODE_ENV: 'production', DATABASE_URL: localDb },
      {},
      { NODE_ENV: 'staging' },
      { NODE_ENV: '' },
    ]) assert.equal(fixedOtpAllowed(env as any), false);
  });
});

describe('gateway source guards', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/api/v1/[...path]/route.ts'), 'utf8');
  it('has no placeholder identity, no synthetic admin id and never honours the fixed OTP ungated (S-03)', () => {
    assert.ok(!src.includes('usr_default'));
    assert.ok(!src.includes('usr_adm_'));
    assert.ok(!src.includes("'user@example.com'"));
    assert.ok(!/if \(!isValid && otp === '123456'\)/.test(src));
    // Every use of the deterministic code in the gateway is gated by fixedOtpAllowed().
    const fixedOtpLines = src.split('\n').filter((l) => l.includes("=== '123456'"));
    assert.ok(fixedOtpLines.length >= 1, 'expected at least one gated fixed-OTP reference');
    for (const l of fixedOtpLines) {
      assert.ok(l.includes('fixedOtpAllowed()'), `ungated fixed OTP: ${l.trim()}`);
    }
  });
  it('re-checks the persisted admin role on both gates and no longer hard-codes SUPER_ADMIN into admin tokens', () => {
    assert.equal((src.match(/requirePersistedAdmin\(/g) ?? []).length, 3); // definition + two gates
    assert.ok(!/role: 'SUPER_ADMIN',\s*\n\s*status: 'ACTIVE'/.test(src));
  });
  it('uses the shared password module (no inline pbkdf2)', () => {
    assert.ok(!/pbkdf2Sync/.test(src));
  });
});
