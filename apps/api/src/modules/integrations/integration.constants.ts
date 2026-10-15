import * as crypto from 'crypto';

/** Events a webhook can subscribe to. Payloads carry ids and counts, never contact details. */
export const WEBHOOK_EVENTS = ['lead.unlocked', 'person.unlocked', 'export.completed', 'credits.low', 'credits.empty', 'integration.test'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** What a customer can subscribe to (the test ping is sent on demand to any endpoint). */
export const SUBSCRIBABLE_EVENTS = WEBHOOK_EVENTS.filter((e) => e !== 'integration.test');

export const INTEGRATION_TYPES = ['WEBHOOK', 'HUBSPOT'] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const MAX_INTEGRATIONS_PER_USER = 10;
/** A delivery is tried this many times, with these waits in between, then it is DEAD (it can be redelivered by hand). */
export const MAX_DELIVERY_ATTEMPTS = 6;
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
/** An integration that fails this many attempts in a row is switched off and its owner told. */
export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 10;
export const DELIVERY_RETENTION_DAYS = 14;
/** Inbound callbacks older (or newer) than this are rejected, which bounds replay of a captured request. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * `X-Orion-Signature: t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${body}`). The timestamp is inside the signed
 * text, so a receiver can refuse old requests without the signature being reusable at a later time.
 */
export function signPayload(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${nowSeconds}.${body}`).digest('hex');
  return `t=${nowSeconds},v1=${v1}`;
}

export function verifySignature(secret: string, body: string | Buffer, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(String(header ?? '').trim());
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${Buffer.isBuffer(body) ? body.toString('utf8') : body}`).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export const newSigningSecret = () => `whsec_${crypto.randomBytes(24).toString('base64url')}`;
