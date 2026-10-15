/**
 * S-16: input validation for the gateway's native handlers. These routes parse raw JSON and never run the
 * NestJS ValidationPipe, so without this they accepted malformed emails, trivial passwords, multi-megabyte
 * avatar blobs, arbitrary external avatar URLs, and unbounded arbitrary keys merged into users.metadata.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH = 254;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email.trim());
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;

// A small block list of the most trivially guessable values; this is a floor, not a full policy.
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'admin123', 'letmein1', 'welcome1',
  'abc12345', '11111111', '00000000', 'aaaaaaaa', 'passw0rd',
]);

/** Returns a human-readable complaint if the password is unacceptable, otherwise null. */
export function passwordComplaint(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  if (password.length > MAX_PASSWORD_LENGTH) return 'Password is too long.';
  if (/^(.)\1+$/.test(password)) return 'Password is too weak. Avoid repeating a single character.';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return 'Password is too common. Please choose a stronger password.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export const MAX_AVATAR_BYTES = 1_500_000; // ~1.5 MB of base64/text
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Accepts only (a) a reasonably-sized base64 data: image, or (b) an https URL whose host is one of our own
 * storage/public hosts. Arbitrary external URLs (tracking pixels) and oversized blobs are rejected.
 */
export function validateAvatar(
  image: unknown,
  env: Record<string, string | undefined> = process.env,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof image !== 'string' || image.length === 0) return { ok: false, error: 'Image data is required.' };
  if (image.length > MAX_AVATAR_BYTES) return { ok: false, error: 'Image is too large. Maximum size is about 1 MB.' };

  if (image.startsWith('data:')) {
    if (!DATA_IMAGE_RE.test(image)) return { ok: false, error: 'Only PNG, JPEG, WEBP or GIF images are allowed.' };
    return { ok: true, value: image };
  }

  if (/^https:\/\//i.test(image)) {
    const allowed = allowedAvatarHosts(env);
    try {
      const host = new URL(image).hostname.toLowerCase();
      if (allowed.some((h) => host === h || host.endsWith(`.${h}`))) return { ok: true, value: image };
    } catch {
      /* fall through */
    }
    return { ok: false, error: 'External image URLs are not allowed. Upload the image instead.' };
  }

  return { ok: false, error: 'Unsupported image format.' };
}

function allowedAvatarHosts(env: Record<string, string | undefined>): string[] {
  const hosts: string[] = [];
  for (const key of ['STORAGE_PUBLIC_URL_PREFIX', 'STORAGE_ENDPOINT', 'NEXT_PUBLIC_APP_URL', 'APP_URL']) {
    const v = env[key];
    if (v) {
      try {
        hosts.push(new URL(v).hostname.toLowerCase());
      } catch {
        /* ignore malformed */
      }
    }
  }
  // Trusted identity-provider avatar CDNs used by the OAuth flows.
  hosts.push('googleusercontent.com', 'graph.microsoft.com');
  return hosts;
}

export const NOTIFICATION_KEYS = [
  'emailNewBusinesses', 'savedSearchAlerts', 'creditLowWarning',
  'weeklyDigest', 'productUpdates', 'marketingEmails',
] as const;

export const PREFERENCE_KEYS: Record<string, 'string' | 'boolean'> = {
  resultsPerPage: 'string',
  defaultView: 'string',
  timezone: 'string',
  dateFormat: 'string',
};

const MAX_PREF_STRING = 120;

/** Keeps only the allow-listed boolean keys; everything else (unknown keys, non-booleans) is dropped. */
export function pickBooleanKeys(input: unknown, allowed: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (input && typeof input === 'object') {
    for (const k of allowed) {
      const v = (input as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/** Keeps only known preference keys, coercing/bounding values; unknown keys are dropped. */
export function pickPreferences(input: unknown): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (input && typeof input === 'object') {
    for (const [k, type] of Object.entries(PREFERENCE_KEYS)) {
      const v = (input as Record<string, unknown>)[k];
      if (type === 'boolean' && typeof v === 'boolean') out[k] = v;
      if (type === 'string' && typeof v === 'string') out[k] = v.slice(0, MAX_PREF_STRING);
    }
  }
  return out;
}
