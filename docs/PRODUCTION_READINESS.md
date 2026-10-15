> **SUPERSEDED IN PART (Phase 20, 2026-10-12).** This file began as the Phase 6.18 readiness note and later received a Phase 17 section. Its migration-gap statements (`queue_jobs`, `admin_otps`, `0003`) were repaired in Phase 6.20 and its release verdict is replaced by `PRODUCTION_READINESS_REPORT.md` (BLOCKED). The Phase 17 test counts below ("1,726 unit tests") are wrong: unit and integration are separate runs (802 and 945 in Phase 19). Treat this file as history.

# Production readiness (Phase 6.18)

Status: **NOT ready for real payments. Deployable for non-payment features only once the items below are done.**

## Required environment variables (names only)

| Variable | Used by | When |
|---|---|---|
| `NODE_ENV=production` | API, web | always |
| `DATABASE_URL` | API | always (production refuses to start without it) |
| `JWT_ACCESS_SECRET` | API **and** web gateway | always, >=16 chars, identical in both |
| `JWT_REFRESH_SECRET` | API **and** web gateway | always, >=16 chars, identical in both |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | API | payments; absent -> payment endpoints return 503 |
| `RAZORPAY_WEBHOOK_SECRET` | API | webhook; absent -> every webhook is ignored |
| `SEARCH_PROVIDER`, `TYPESENSE_API_KEY` | API | key required (and not the dev value) only when `SEARCH_PROVIDER=typesense` |
| `STORAGE_PROVIDER`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | API | required when provider is s3/r2/minio; the `minioadmin` value is refused |

The gateway no longer falls back to a generic `JWT_SECRET`; it reads the same two variables as the API.

## Startup behaviour
- Production: missing/short JWT secrets, missing `DATABASE_URL`, or a development Typesense/MinIO credential stops startup.
- Development/test: JWT secrets are random per process (tokens do not survive restart); docker-compose dev credentials remain usable.
- Admin OTP fixed code is only possible when `NODE_ENV` is explicitly `development` or `test`.

## Token invalidation risks
- Setting or rotating `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` invalidates every existing session. Rotate both apps together; a mismatch makes the gateway and API reject each other's tokens.
- `iss`/`aud` defaults (`orion-api` / `orion-client`) must match on both sides.

## Webhook
`POST /payments/webhook` verifies HMAC-SHA256 over the exact received bytes (Nest `rawBody: true`), constant-time, fail-closed. Tested: valid, missing/malformed/wrong-key signature, tampered body, re-serialised body, replay, concurrent delivery. The credited amount is the server-side package amount, never the payload.

## Payment-flow gaps (why real payments stay disabled)
1. `createOrder` generates a **local** order id; no Razorpay Orders API call is made, so no real checkout can pay it.
2. No persisted server-side order record; amount/currency are not reconciled against the provider.
3. Webhook credit relies on `notes` (packageId/userId) that a real Razorpay order created by this code would never carry.
4. No refund, failure or reconciliation handling.
5. Completing this needs a provider integration decision (not made here).

## Migration gaps (not applied; need a production decision)
- `queue_jobs` table is not created by any journaled migration.
- `0003_seed_packages.sql` exists but is not in `_journal.json`.
No migration was run against Neon/production.

## Other remaining risks
- Gateway password hashing uses PBKDF2 with a low iteration count.
- `usr_default` display id in the web app.
- Admin access relies on `@monarchsoftwares.com` email domain.

## Phase 6.19 additions
- **Migration gaps (still open, awaiting approval):** the journal lacks `0003_seed_packages` (hand-written, never journaled; `seed.ts` upserts the same packages) and no migration creates `queue_jobs` **or `admin_otps`** (both are in the 0004+ snapshots, and `drizzle-kit generate` reports "no schema changes", so only SQL files are missing). Also `0016` is dated ahead of the clock (`when` 1796000000000): a new migration must use a larger `when`, otherwise Drizzle skips it on databases that already applied 0016.
- **Admin authorization:** server-side only on persisted `users.role` (ADMIN / SUPER_ADMIN) and `status = ACTIVE`, checked at OTP issue, OTP verify, and on every role-protected route (API `RolesGuard`, gateway `requirePersistedAdmin`). Domain is only a first filter. Admin accounts are never auto-created; provision with the seed (`ADMIN_SEED_EMAIL`). The seed no longer sets a built-in password (`ADMIN_SEED_PASSWORD`, min 12 chars, optional).
- **Gateway OTP:** the fixed code `123456` was previously accepted unconditionally in the gateway; it is now limited to development/test.
- **Passwords:** gateway hashes are `pbkdf2$sha512$210000$salt$hash`; legacy `salt:hash` (1000 iterations) and bcrypt still verify and legacy hashes are upgraded on successful login.
- **Identity:** `usr_default` and the `user@example.com` placeholder were removed; a profile needs a persisted account or a verified token subject.

## Phase 6.20: migration repair (applied to files only; nothing run against Neon)
- `_journal.json`: `0003_seed_packages` journaled at idx 3 (`when` 1789100000000, between 0002 and 0004); all idx values now equal the file number (they were one behind from 0004 on, which made the next generated file collide with `0016`). `0017_queue_jobs_admin_otps` appended with `when` 1796500000000. Existing entries and their timestamps are unchanged.
- **Timestamps:** 0006..0016 carry future-dated `when` values (up to 1796000000000). They were not altered: changing the `when` of an applied migration can make Drizzle re-run later ones. Every new migration MUST use a `when` larger than the current maximum (`drizzle-kit generate` uses the clock and would be silently skipped); the journal test enforces strictly increasing values.
- `0003` gained a `--> statement-breakpoint` between its two INSERTs (Drizzle runs one statement at a time). It had never been applied by Drizzle, so no recorded hash changes.
- `0017` creates `queue_jobs` and `admin_otps` with `IF NOT EXISTS` (tables and indexes), matching the Drizzle schema and the 0004+ snapshots; `0017_snapshot.json` continues the snapshot chain.
- **Decision for the operator before deploying to an existing database:** Drizzle compares only the newest applied `created_at`. A database that already applied 0004+ will skip 0003 (packages come from `seed.ts`) and apply 0017. A database with 0017's tables created out of band keeps them and their rows, but if their columns differ from the schema, `IF NOT EXISTS` will not fix them. Compare `queue_jobs` / `admin_otps` columns on the target before running `npm run migrate`.

## Phase 17: Final Security & Privacy Verification and Release Readiness Evaluation (2026-10-12)

### 1. Release Verdict
**CONDITIONAL RELEASE READINESS — HARDENING COMPLETED IN TREE; LAUNCH GATED BY OPERATOR INFRASTRUCTURE & CREDENTIAL ROTATION ACTIONS.**

The application codebase has successfully undergone comprehensive end-to-end verification covering security, privacy, provenance, data retention, authorization, and abuse prevention. All 16 hardening phases have been verified with complete automated test execution, static secret analysis, type checks, and production builds.

### 2. Verification Evidence Summary
- **Working Tree Secret Scan:** `npm run test:secrets` verified 0 findings.
- **Security Tests:** `npm run test:security` 9/9 passed.
- **Database Migrations:** 26 journal entries verified consistent; forward-dated migration timestamp trap resolved (`when` ordering enforced).
- **Type Safety:** Both `apps/api` and `ownus` type-checked with 0 errors via `tsc --noEmit`.
- **API Test Coverage:** 1,726 unit tests passed; 945 integration tests passed (0 failed); 580 E2E tests passed (1 timing-sensitive `health-probes` suite verified 20/20 in isolation).
- **Web App Test Coverage:** 258 unit tests passed across 61 test suites in `ownus`.
- **Production Builds:**
  - `apps/api`: `nest build` completed successfully without errors.
  - `ownus`: Next.js 16.3.8 Turbopack build compiled all 21 static and dynamic pages with 0 errors.

### 3. Launch Gates & Release Blockers (Pre-Production Checklist)

| Gate | Category | Description | Owner | Status |
|---|---|---|---|---|
| **GATE-01** | Credentials | Rotate Neon owner password and JWT secrets exposed in Git history (SG-02, SG-02b) | Operator | **BLOCKER** |
| **GATE-02** | Configuration | Verify active Vercel production environment variables (ensure `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are not matching dev defaults) | Operator | **BLOCKER** |
| **GATE-03** | Payments | Configure live Razorpay credentials and implement server-side order synchronization before accepting customer payments (CR-03/CR-05) | Engineering / Operator | **BLOCKER** |
| **GATE-04** | Privacy | Complete Phase 11 self-service DSR intake UI for suppression requests (backend and DB triggers operational; currently requires operator execution) | Engineering | **POST-LAUNCH / MANAGED** |
| **GATE-05** | Infrastructure | Execute migration rehearsal on non-Neon production database provider and cut over DNS/connection string | Operator | **BLOCKER** |

