/**
 * Jest setup for the STAGING suite: the E2E specs against the migrated Neon rehearsal branch. Runs before any application module loads.
 *
 * - The target comes only from STAGING_DATABASE_URL and is verified by assertStagingTarget (confirmed host, not a production host).
 *   apps/api/.env is NEVER used as a source for the database; it is only read to learn the production HOST to refuse.
 * - Every external side effect is switched off with explicit values (an empty value stops .env from filling it in):
 *   no search server, no object storage, no e-mail, no OAuth, test-only payment secrets (no real provider is ever called).
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { assertStagingTarget, hostOf } from '../src/database/staging-guard';
import { TEST_SECRETS } from './helpers/test-secrets';

const envFile = path.resolve(__dirname, '../.env');
const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const productionHosts = [hostOf(parsed.DATABASE_URL), hostOf(parsed.DB_HOST ? `postgresql://${parsed.DB_HOST}/x` : undefined)].filter((h): h is string => !!h);

const target = assertStagingTarget(process.env, productionHosts);

process.env.NODE_ENV = 'test';
process.env.E2E_TARGET = 'staging';
process.env.DATABASE_URL = process.env.STAGING_DATABASE_URL as string;
for (const k of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) process.env[k] = '';
process.env.JWT_ACCESS_SECRET = TEST_SECRETS.jwtAccess;
process.env.JWT_REFRESH_SECRET = TEST_SECRETS.jwtRefresh;
process.env.RAZORPAY_KEY_ID = TEST_SECRETS.razorpayKeyId;
process.env.RAZORPAY_KEY_SECRET = TEST_SECRETS.razorpayKeySecret;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRETS.razorpayWebhookSecret;
process.env.SEARCH_PROVIDER = 'postgres';
process.env.STORAGE_PROVIDER = 'local';
for (const k of ['STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'STORAGE_ENDPOINT', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'TYPESENSE_API_KEY']) {
  process.env[k] = '';
}
process.env.STAGING_TARGET_HOST = target.host; // host only, for the self-check output
