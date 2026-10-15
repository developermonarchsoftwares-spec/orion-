import crypto from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(crypto.pbkdf2);

/** PBKDF2-HMAC-SHA512, OWASP's recommended work factor for this construction. Raise it over time; stored hashes carry their own. */
export const PBKDF2_ITERATIONS = 210_000;
const KEY_LENGTH = 64;
export const MAX_PASSWORD_LENGTH = 1024; // bounds the cost of a single attempt

/** Self-describing format: `pbkdf2$sha512$<iterations>$<salt hex>$<hash hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')).toString('hex');
  return `pbkdf2$sha512$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Verifies against every format already stored, so nobody is locked out:
 *  - current   `pbkdf2$sha512$<iterations>$<salt>$<hash>`
 *  - legacy    `<salt>:<hash>` (PBKDF2-SHA512, 1000 iterations, written by earlier gateway versions)
 *  - bcrypt    `$2a$ / $2b$ / $2y$` (written by the API)
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    if (stored.startsWith('$2')) {
      const bcrypt = await import('bcrypt'); // native module, loaded only when a bcrypt hash is actually seen
      return await (bcrypt.default ?? bcrypt).compare(password, stored);
    }
    if (stored.startsWith('pbkdf2$')) {
      const [, digest, iterations, salt, hash] = stored.split('$');
      const n = Number(iterations);
      if (digest !== 'sha512' || !Number.isInteger(n) || n < 1000 || n > 5_000_000 || !salt || !hash) return false;
      return safeEqual(hash, (await pbkdf2(password, salt, n, KEY_LENGTH, 'sha512')).toString('hex'));
    }
    if (stored.includes(':')) {
      const [salt, hash] = stored.split(':');
      return safeEqual(hash, (await pbkdf2(password, salt, 1000, KEY_LENGTH, 'sha512')).toString('hex'));
    }
  } catch {
    return false;
  }
  return false;
}

/** True when a successfully verified hash should be replaced by a current one (legacy format or lower work factor). */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored || stored.startsWith('$2')) return false; // bcrypt (cost 12 from the API) is left as is
  if (!stored.startsWith('pbkdf2$')) return true;
  return Number(stored.split('$')[2]) < PBKDF2_ITERATIONS;
}

/**
 * Spends the same work as a real verification when there is no hash to check (unknown e-mail, social-only account), so the response
 * time does not reveal whether an account exists. The result is meaningless and discarded.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return;
  await pbkdf2(password, 'orion-timing-equaliser-salt', PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}
