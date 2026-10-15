import * as crypto from 'crypto';

/**
 * AES-256-GCM envelope for secrets stored at rest (the MFA TOTP seed). The key is MFA_ENCRYPTION_KEY, or, when
 * unset, derived from JWT_ACCESS_SECRET with a purpose label. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export type SecretScope = 'mfa' | 'integrations';

/** Each scope has its own key (MFA_ENCRYPTION_KEY / INTEGRATIONS_ENCRYPTION_KEY, else derived from JWT_ACCESS_SECRET with a scope label), so rotating one does not break the other. */
function key(env: NodeJS.ProcessEnv = process.env, scope: SecretScope = 'mfa'): Buffer {
  const explicit = scope === 'integrations' ? env.INTEGRATIONS_ENCRYPTION_KEY : env.MFA_ENCRYPTION_KEY;
  const base = (explicit || env.JWT_ACCESS_SECRET || '').trim();
  return crypto.createHmac('sha256', base || `orion-${scope}`).update(scope === 'mfa' ? 'orion:mfa-secret' : `orion:${scope}-secret`).digest();
}

export function sealSecret(plain: string, env: NodeJS.ProcessEnv = process.env, scope: SecretScope = 'mfa'): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(env, scope), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function openSecret(sealed: string, env: NodeJS.ProcessEnv = process.env, scope: SecretScope = 'mfa'): string {
  const [v, iv, tag, enc] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unrecognised sealed secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(env, scope), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
}
