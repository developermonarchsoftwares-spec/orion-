/* eslint-disable @typescript-eslint/no-explicit-any -- untyped DB rows and deliberately malformed inputs */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { MAX_PASSWORD_LENGTH, PBKDF2_ITERATIONS, hashPassword, needsRehash, verifyPassword } from '../password.ts';

const legacy = (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')}`;
};

describe('password hashing', () => {
  it('new hashes are self-describing, salted and use the current work factor', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    assert.match(a, /^pbkdf2\$sha512\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(a.split('$')[2], String(PBKDF2_ITERATIONS));
    assert.notEqual(a, b);
    assert.ok(PBKDF2_ITERATIONS >= 210_000);
    assert.equal(await verifyPassword('correct horse battery', a), true);
    assert.equal(await verifyPassword('wrong', a), false);
    assert.equal(needsRehash(a), false);
  });

  it('legacy 1000-iteration hashes still verify (nobody is locked out) and are flagged for upgrade', async () => {
    const stored = legacy('OldPassword1!');
    assert.equal(await verifyPassword('OldPassword1!', stored), true);
    assert.equal(await verifyPassword('OldPassword2!', stored), false);
    assert.equal(needsRehash(stored), true);
  });

  it('a lower work factor of the new format is flagged; bcrypt hashes verify and are left alone', async () => {
    const salt = 'ab'.repeat(16);
    const weak = `pbkdf2$sha512$5000$${salt}$${crypto.pbkdf2Sync('pw-123456', salt, 5000, 64, 'sha512').toString('hex')}`;
    assert.equal(await verifyPassword('pw-123456', weak), true);
    assert.equal(needsRehash(weak), true);
    const bcrypt = (await import('bcrypt')).default;
    const b = await bcrypt.hash('BcryptPass1!', 4);
    assert.equal(await verifyPassword('BcryptPass1!', b), true);
    assert.equal(await verifyPassword('nope', b), false);
    assert.equal(needsRehash(b), false);
  });

  it('malformed, empty, oversized and hostile stored values fail closed', async () => {
    for (const bad of [undefined, null, '', 'garbage', ':', 'a:b', 'pbkdf2$', 'pbkdf2$sha512$x$y$z', 'pbkdf2$sha1$210000$aa$bb', 'pbkdf2$sha512$99999999999$aa$bb', 'pbkdf2$sha512$100$aa$bb']) {
      assert.equal(await verifyPassword('x', bad as any), false, String(bad));
    }
    assert.equal(await verifyPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), await hashPassword('x')), false);
  });
});
