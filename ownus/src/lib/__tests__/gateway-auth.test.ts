/* eslint-disable @typescript-eslint/no-explicit-any -- decoded payloads are untyped */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  accessSecret,
  authenticate,
  decideAccess,
  isUuid,
  otpSecret,
  refreshSecret,
  resetSecret,
  routePolicy,
  signToken,
  verifyToken,
} from '../gateway-auth.ts';

const SECRET = 'a-test-secret-of-sufficient-length-0123456789';
const OTHER = 'another-secret-of-sufficient-length-9876543210';
const ENV = { JWT_ACCESS_SECRET: SECRET, JWT_REFRESH_SECRET: OTHER } as any;
const NO_ENV = {} as any;
const UID = '8f3c1a52-7d54-4c3e-9b0a-1f2e3d4c5b6a';
const NOW = 1_800_000_000;
const headers = (token?: string, scheme = 'Bearer') => ({ get: (n: string) => (n.toLowerCase() === 'authorization' && token ? `${scheme} ${token}` : null) });
const sign = (payload: Record<string, unknown>, secret = SECRET, ttl = 600) => signToken(payload, secret, ttl, ENV, NOW);
const forge = (payload: Record<string, unknown>, alg = 'HS256', secret = SECRET) => {
  const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};

describe('secrets: environment only, never a built-in default', () => {
  it('a missing, blank or too-short secret means "not configured"', () => {
    assert.equal(accessSecret(NO_ENV), null);
    assert.equal(accessSecret({ JWT_ACCESS_SECRET: '' } as any), null);
    assert.equal(accessSecret({ JWT_ACCESS_SECRET: 'short' } as any), null);
    assert.equal(refreshSecret(NO_ENV), null);
    assert.equal(resetSecret(NO_ENV), null);
    assert.equal(otpSecret(NO_ENV), null);
    assert.equal(accessSecret(ENV), SECRET);
    assert.equal(accessSecret({ JWT_SECRET: SECRET } as any), null); // no generic fallback: same variables as the API
    assert.equal(refreshSecret({ JWT_SECRET: SECRET } as any), null);
  });

  it('a public example or placeholder value is not a secret in production (but is left alone outside it)', () => {
    for (const example of ['orion_example_value_long_enough_0123456789', 'your_secret_value_long_enough_here', 'generate_a_random_value_here_0123']) {
      assert.equal(accessSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: example } as any), null);
      assert.equal(refreshSecret({ NODE_ENV: 'production', JWT_REFRESH_SECRET: example } as any), null);
      assert.equal(accessSecret({ NODE_ENV: 'development', JWT_ACCESS_SECRET: example } as any), example);
    }
    assert.equal(accessSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: SECRET } as any), SECRET);
  });

  it('the signing secrets once committed in docker-compose.yml are not secrets in production', (t) => {
    let compose: string;
    try {
      compose = execSync('git show 03075bd:docker-compose.yml', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      t.skip('git history unavailable');
      return;
    }
    const values = compose
      .split(/\r?\n/)
      .filter((l) => /^\s+JWT_(ACCESS|REFRESH)_SECRET:/.test(l))
      .map((l) => l.replace(/^[^:]+:\s*/, '').replace(/^['"]|['"]$/g, '').trim());
    assert.ok(values.length > 0);
    for (const v of values) {
      assert.equal(accessSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: v } as any), null);
      assert.equal(refreshSecret({ NODE_ENV: 'production', JWT_REFRESH_SECRET: v } as any), null);
    }
  });

  it('reset and OTP keys are derived per purpose and never equal the access secret', () => {
    const r = resetSecret(ENV);
    const o = otpSecret(ENV);
    assert.ok(r && o);
    assert.notEqual(r, SECRET);
    assert.notEqual(o, SECRET);
    assert.notEqual(r, o);
    assert.notEqual(resetSecret({ JWT_ACCESS_SECRET: OTHER } as any), r);
  });
});

describe('token verification', () => {
  it('accepts a correctly signed, unexpired access token with a subject', () => {
    const t = sign({ sub: UID, role: 'USER', email: 'a@b.co' });
    assert.equal(verifyToken(t, SECRET, 'access', ENV, NOW + 10)?.sub, UID);
  });

  it('rejects forged, tampered, expired, unsigned and malformed tokens', () => {
    const good = sign({ sub: UID });
    assert.equal(verifyToken(good, OTHER, 'access', ENV, NOW + 10), null); // wrong key
    assert.equal(verifyToken(good, null, 'access', ENV, NOW + 10), null); // no secret configured
    assert.equal(verifyToken(good, SECRET, 'access', ENV, NOW + 601), null); // expired
    assert.equal(verifyToken(forge({ sub: UID }), SECRET, 'access', ENV, NOW), null); // no exp
    assert.equal(verifyToken(forge({ sub: UID, exp: NOW + 60 }, 'none'), SECRET, 'access', ENV, NOW), null); // alg none
    assert.equal(verifyToken(forge({ sub: UID, exp: NOW + 60 }, 'HS512'), SECRET, 'access', ENV, NOW), null);
    assert.equal(verifyToken(forge({ exp: NOW + 60 }), SECRET, 'access', ENV, NOW), null); // no subject
    assert.equal(verifyToken(forge({ sub: '', exp: NOW + 60 }), SECRET, 'access', ENV, NOW), null);
    const [h, , s] = good.split('.');
    const swapped = `${h}.${Buffer.from(JSON.stringify({ sub: 'victim', role: 'SUPER_ADMIN', exp: NOW + 600 })).toString('base64url')}.${s}`;
    assert.equal(verifyToken(swapped, SECRET, 'access', ENV, NOW), null); // payload swapped, signature kept
    const unsigned = `${h}.${Buffer.from(JSON.stringify({ sub: UID, exp: NOW + 600 })).toString('base64url')}.`;
    assert.equal(verifyToken(unsigned, SECRET, 'access', ENV, NOW), null);
    for (const junk of ['', 'abc', 'a.b', 'a.b.c', 'x.y.z.w', '....']) assert.equal(verifyToken(junk, SECRET, 'access', ENV, NOW), null);
    assert.equal(verifyToken(undefined as any, SECRET, 'access', ENV, NOW), null);
  });

  it('checks issuer and audience when present, and the token purpose always', () => {
    assert.equal(verifyToken(forge({ sub: UID, exp: NOW + 60, iss: 'someone-else' }), SECRET, 'access', ENV, NOW), null);
    assert.equal(verifyToken(forge({ sub: UID, exp: NOW + 60, aud: 'other-audience' }), SECRET, 'access', ENV, NOW), null);
    const refresh = sign({ sub: UID, type: 'refresh' }, OTHER);
    assert.equal(verifyToken(refresh, OTHER, 'refresh', ENV, NOW + 1)?.sub, UID);
    assert.equal(verifyToken(refresh, OTHER, 'access', ENV, NOW + 1), null); // a refresh token is not an access token
    const access = sign({ sub: UID });
    assert.equal(verifyToken(access, SECRET, 'refresh', ENV, NOW + 1), null);
    const reset = sign({ sub: UID, type: 'password_reset' }, resetSecret(ENV)!);
    assert.equal(verifyToken(reset, resetSecret(ENV), 'password_reset', ENV, NOW + 1)?.sub, UID);
    assert.equal(verifyToken(reset, SECRET, 'access', ENV, NOW + 1), null); // different key AND purpose
    assert.equal(verifyToken(sign({ sub: UID, type: 'password_reset' }, SECRET), SECRET, 'access', ENV, NOW + 1), null); // even with the right key
    // a reset token forged with a guessed / built-in key does not verify against the real derived key
    for (const guess of ['orion-fallback-secret-2026', 'orion-jwt-access-secret-production-fallback', 'orion-admin-auth-hmac-secret-fallback']) {
      assert.equal(verifyToken(forge({ sub: UID, type: 'password_reset', exp: NOW + 600 }, 'HS256', guess), resetSecret(ENV), 'password_reset', ENV, NOW), null);
      assert.equal(verifyToken(forge({ sub: UID, role: 'SUPER_ADMIN', exp: NOW + 600 }, 'HS256', guess), SECRET, 'access', ENV, NOW), null);
      assert.equal(verifyToken(forge({ sub: UID, type: 'refresh', exp: NOW + 600 }, 'HS256', guess), OTHER, 'refresh', ENV, NOW), null);
    }
  });
});

describe('request authentication and access decisions', () => {
  it('identity comes only from a verified Authorization header', () => {
    assert.deepEqual(authenticate(headers(), ENV, NOW), { ok: false, reason: 'MISSING' });
    assert.deepEqual(authenticate(headers('x', 'Basic'), ENV, NOW), { ok: false, reason: 'MISSING' });
    assert.deepEqual(authenticate(headers(sign({ sub: UID }, OTHER)), ENV, NOW + 1), { ok: false, reason: 'INVALID' });
    assert.deepEqual(authenticate(headers(sign({ sub: UID })), NO_ENV, NOW + 1), { ok: false, reason: 'NOT_CONFIGURED' }); // no secret: fail closed
    const ok: any = authenticate(headers(sign({ sub: UID, role: 'USER', email: 'u@x.co' })), ENV, NOW + 1);
    assert.equal(ok.ok, true);
    assert.deepEqual([ok.auth.sub, ok.auth.role, ok.auth.email], [UID, 'USER', 'u@x.co']);
    assert.equal(isUuid(UID), true);
    assert.equal(isUuid('usr_adm_1234'), false);
  });

  it('customer routes: missing / forged / expired / unconfigured are refused; an admin-session token is not a customer', () => {
    const user = sign({ sub: UID, role: 'USER' });
    const decide = (h: any, env: any = ENV, at = NOW + 1) => decideAccess('USER', h, env, at);
    assert.equal((decide(headers(user)) as any).allow, true);
    assert.equal((decide(headers()) as any).status, 401);
    assert.equal((decide(headers(sign({ sub: UID }, OTHER))) as any).status, 401); // forged
    assert.equal((decide(headers(user), ENV, NOW + 9999) as any).status, 401); // expired
    assert.equal((decide(headers(user), NO_ENV) as any).errorCode, 'AUTH_NOT_CONFIGURED'); // missing secret
    assert.equal((decide(headers(sign({ sub: 'usr_adm_abc', role: 'SUPER_ADMIN' }))) as any).status, 403); // OTP admin has no wallet
  });

  it('admin routes need a verified admin role; a customer or a forged admin claim is refused', () => {
    const decide = (h: any) => decideAccess('ADMIN', h, ENV, NOW + 1);
    assert.equal((decide(headers(sign({ sub: 'usr_adm_abc', role: 'SUPER_ADMIN' }))) as any).allow, true);
    assert.equal((decide(headers(sign({ sub: UID, role: 'ADMIN' }))) as any).allow, true);
    assert.equal((decide(headers(sign({ sub: UID, role: 'USER' }))) as any).status, 403);
    assert.equal((decide(headers(sign({ sub: UID, role: 'DATA_MANAGER' }))) as any).status, 403);
    assert.equal((decide(headers(forge({ sub: 'x', role: 'SUPER_ADMIN', exp: NOW + 60 }, 'HS256', 'guessed-secret-guessed-secret'))) as any).status, 401);
    assert.equal((decide(headers()) as any).status, 401);
  });

  it('public routes never trust anything but a verified token for the optional identity', () => {
    const forged = sign({ sub: UID }, OTHER);
    assert.deepEqual(decideAccess('PUBLIC', headers(forged), ENV, NOW + 1), { allow: true, auth: null });
    assert.equal((decideAccess('PUBLIC', headers(sign({ sub: UID })), ENV, NOW + 1) as any).auth.sub, UID);
    assert.deepEqual(decideAccess('UPSTREAM', headers(), NO_ENV), { allow: true, auth: null }); // proxied routes are the upstream's business
  });
});

describe('route policy', () => {
  it('every natively handled admin, customer and payment route is classified; the two phases never block a proxied route', () => {
    for (const p of ['admin/users', 'admin/businesses', 'admin/transactions', 'admin/activity-logs', 'admin/import/preview', 'admin/import/submit', 'admin/import/batches', 'admin/filter-options']) assert.equal(routePolicy(p, 'GET'), 'ADMIN', p);
    assert.equal(routePolicy('discover/filter-options', 'POST'), 'ADMIN');
    assert.equal(routePolicy('discover/filter-options', 'GET'), 'PUBLIC');
    for (const p of ['auth/me', 'user/profile', 'settings', 'settings/preferences', 'discover/export']) assert.equal(routePolicy(p, 'GET'), 'USER', p);
    for (const p of ['auth/login', 'auth/refresh', 'auth/reset-password', 'admin/auth/verify-otp', 'admin/import/template', 'discover/search']) assert.equal(routePolicy(p, 'POST'), 'PUBLIC', p);
    // fallback-only routes are checked only after the upstream failed
    for (const p of ['credit/wallet', 'payments/verify', 'payments/create-order', 'unlock/business', 'unlock/status/abc', 'saved-leads', 'invoices/download', 'dashboard/summary']) {
      assert.equal(routePolicy(p, 'POST', 'pre'), 'UPSTREAM', p);
      assert.equal(routePolicy(p, 'POST', 'fallback'), 'USER', p);
    }
    assert.equal(routePolicy('admin/duplicates', 'GET', 'pre'), 'UPSTREAM');
    assert.equal(routePolicy('admin/duplicates', 'GET', 'fallback'), 'ADMIN');
    assert.equal(routePolicy('admin/invoices/download', 'GET', 'fallback'), 'ADMIN');
    assert.equal(routePolicy('something/else', 'GET', 'fallback'), 'UPSTREAM');
  });
});

describe('the gateway source', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/api/v1/[...path]/route.ts'), 'utf8');

  it('has no built-in secret, default account or unsigned-token decoding', () => {
    assert.doesNotMatch(src, /production-fallback|orion-fallback-secret|hmac-secret-fallback|rzp_test_orion_demo|orion_secret_demo/);
    assert.doesNotMatch(src, /kathirrajput@gmail\.com/);
    assert.doesNotMatch(src, /Buffer\.from\(parts\[1\]/); // the old unsigned decode
    assert.doesNotMatch(src, /parsedBody\.userId|parsedBody\.email|body\?\.userId/); // identity never from a request body
    assert.doesNotMatch(src, /process\.env\.JWT_(ACCESS_|REFRESH_)?SECRET\b/); // secrets only through gateway-auth.ts
  });

  it('never grants credits from a client amount or an unverified payment, and never forges a receipt', () => {
    assert.doesNotMatch(src, /creditsToAdd|parsedBody\.credits|SET\s+purchased_credits|lifetime_purchased\s*=\s*\$/);
    const verify = /fullPath === 'payments\/create-order' \|\| fullPath === 'payments\/verify'\) \{\s*return paymentsUnavailable\(\);/;
    assert.match(src, verify);
    assert.doesNotMatch(src, /generateInvoicePdfBuffer\(tx\)/); // no receipt rendered from query-string values
  });

  it('applies the access gate before native handlers and again before fallback handlers', () => {
    assert.match(src, /routePolicy\(fullPath, req\.method\);\s*\n\s*const gate = decideAccess\(gatePolicy, req\.headers\)/);
    assert.match(src, /routePolicy\(fullPath, req\.method, 'fallback'\);\s*\n\s*const fallbackGate = decideAccess\(fallbackPolicy, req\.headers\)/);
    assert.ok(src.indexOf("routePolicy(fullPath, req.method)") < src.indexOf("if (fullPath === 'auth/me' || fullPath === 'user/profile')"));
  });

  it('refresh and password reset verify their own token with its own key', () => {
    assert.match(src, /verifyToken\(refreshToken, refreshSecret, 'refresh'\)/);
    assert.match(src, /verifyToken\(token, resetKey, 'password_reset'\)/);
  });
});
