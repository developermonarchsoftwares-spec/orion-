import { createHash, randomBytes } from 'crypto';

/**
 * Signing secrets come from the environment and nowhere else. There is no built-in value: a well-known default would let anyone
 * mint valid tokens. In production a missing or too-short secret stops the application from starting. In development and tests
 * (only) a random per-process secret is generated, so tokens simply do not survive a restart.
 */
export const MIN_SECRET_LENGTH = 16;

/**
 * Shapes of the example and placeholder values shipped in `.env.example` files and documentation. They are long enough to pass the
 * length check and are public (committed), so production refuses them: a copied example file must never become the signing key.
 */
export const PLACEHOLDER_SECRET_PATTERN = /^(orion_|your[_-]|change[_-]?me|generate|example|placeholder|replace[_-]|xyz123)/i;

/**
 * SHA-256 digests (never the values) of signing secrets published in the repository's docker-compose development setup. They are long
 * enough to pass the length check and are public, so production refuses them. Moving real deployments off them is the operator's job;
 * this is the backstop.
 */
const KNOWN_PUBLIC_SECRET_SHA256 = new Set<string>([
  '694d62f43cc94705bb5b68d065501cd00e76017c3c92ccc8721a7b67a8e0c2bc',
  '301b7918a05559e399a15a7dd75522aa77720076698685a7266b032df93cb13b',
]);

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim();
  return PLACEHOLDER_SECRET_PATTERN.test(v) || KNOWN_PUBLIC_SECRET_SHA256.has(createHash('sha256').update(v).digest('hex'));
}

const generated = new Map<string, string>();

export function resolveSecret(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = (env[name] ?? '').trim();
  if (env.NODE_ENV === 'production' && value.length >= MIN_SECRET_LENGTH && isPlaceholderSecret(value)) {
    throw new Error(`${name} looks like an example or placeholder value; set a real random secret in production`);
  }
  if (value.length >= MIN_SECRET_LENGTH) return value;
  if (env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to a secret of at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  let secret = generated.get(name);
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    generated.set(name, secret);
  }
  return secret;
}

/** A configured secret only (no generated stand-in): used where "not configured" must mean "feature unavailable", e.g. payments. */
export function configuredSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env[name] ?? '').trim();
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

/** Local-development convenience values (the docker-compose services). Never accepted in production. */
export const DEV_ONLY_DEFAULTS = Object.freeze({
  typesenseApiKey: 'xyz123_orion_typesense_master_key',
  storageAccessKey: 'minioadmin',
  storageSecretKey: 'minioadmin',
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/orion_db',
});

/**
 * An infrastructure credential that must be explicit in production. Outside production the local-development value is used so
 * `docker compose up` keeps working; in production a missing value, or the well-known development value, stops the application.
 */
export function productionRequired(name: string, devValue: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = (env[name] ?? '').trim();
  if (env.NODE_ENV === 'production') {
    if (!value) throw new Error(`${name} must be set in production`);
    if (value === devValue) throw new Error(`${name} must not use the local-development value in production`);
    return value;
  }
  return value || devValue;
}

/**
 * Like productionRequired, but a missing value in production yields `undefined` (the feature that needs it, e.g. object storage,
 * reports itself unconfigured when used) instead of stopping the whole application. The well-known development value is still refused.
 */
export function productionOptional(name: string, devValue: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = (env[name] ?? '').trim();
  if (env.NODE_ENV === 'production') {
    if (value === devValue) throw new Error(`${name} must not use the local-development value in production`);
    return value || undefined;
  }
  return value || devValue;
}
