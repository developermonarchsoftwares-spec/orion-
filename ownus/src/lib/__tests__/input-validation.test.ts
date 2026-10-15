import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isValidEmail,
  passwordComplaint,
  validateAvatar,
  pickBooleanKeys,
  pickPreferences,
  NOTIFICATION_KEYS,
} from '../input-validation.ts';

// S-16 proof: the gateway-native validation rejects the exact inputs that were accepted before.
describe('S-16 input validation', () => {
  it('rejects malformed emails and accepts valid ones', () => {
    assert.equal(isValidEmail('not-an-email'), false);
    assert.equal(isValidEmail('a@b'), false);
    assert.equal(isValidEmail('a@b@c.com'), false);
    assert.equal(isValidEmail('x'.repeat(300) + '@e.com'), false);
    assert.equal(isValidEmail('user@example.com'), true);
  });

  it('rejects trivially weak passwords', () => {
    assert.ok(passwordComplaint('aaaaaaaa'), 'repeated char must be rejected');
    assert.ok(passwordComplaint('password123'), 'common password must be rejected');
    assert.ok(passwordComplaint('short'), 'too short must be rejected');
    assert.ok(passwordComplaint('alllettersonly'), 'letters-only must be rejected');
    assert.equal(passwordComplaint('Str0ngPass9'), null, 'a strong password passes');
  });

  it('accepts only bounded data: images or own-host https URLs for avatars', () => {
    assert.equal(validateAvatar('data:image/png;base64,' + 'A'.repeat(2_000_000)).ok, false); // oversized
    assert.equal(validateAvatar('https://tracker.evil.example/pixel.gif').ok, false); // external host
    assert.equal(validateAvatar('javascript:alert(1)').ok, false);
    assert.equal(validateAvatar('data:text/html;base64,AAAA').ok, false); // not an image
    assert.equal(validateAvatar('data:image/png;base64,iVBORw0KGgo=').ok, true);
    assert.equal(
      validateAvatar('https://cdn.example.com/a.png', { STORAGE_PUBLIC_URL_PREFIX: 'https://cdn.example.com' }).ok,
      true,
    );
  });

  it('keeps only known boolean notification keys', () => {
    const out = pickBooleanKeys(
      { weeklyDigest: true, evil: { a: 1 }, ['x'.repeat(40000)]: 'y', marketingEmails: 'yes' },
      NOTIFICATION_KEYS as unknown as string[],
    );
    assert.deepEqual(out, { weeklyDigest: true });
  });

  it('keeps only known, bounded preference keys', () => {
    const out = pickPreferences({ resultsPerPage: 'z'.repeat(500), junk: 'drop', timezone: 'IST' });
    assert.equal(out.junk, undefined);
    assert.equal((out.resultsPerPage as string).length, 120);
    assert.equal(out.timezone, 'IST');
  });
});
