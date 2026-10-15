# Orion security test results (Step 1, audit only)

**Date:** 2026-10-09 · Every result below was observed in this session. Nothing is inferred. Where a command was run on 2026-10-08 (earlier in the same session, before the audit phase was requested) that is stated. Finding ids (SG-nn) refer to `SECURITY_GAP_REPORT.md`.

## 1. Environment and safety

- Machine: Windows 11, Node via npm workspaces, working tree at `D:\Monarch Project\Own product\ownus\ownus` (358 files modified or untracked on top of `fe7307f`).
- **API unit, integration and security tests** run in Jest with in-process fixtures; **API e2e tests** use an in-memory PGlite database and force `DATABASE_URL` to an address that cannot connect (`apps/api/test/setup-env.ts`). None of these can reach the local PostgreSQL, Neon or production.
- The local development API (port 4000) and web app (port 3000) were already running; I sent only unauthenticated `GET` requests to them.
- The only database I read was the **local development PostgreSQL** (`localhost:5432`), with `SELECT` counts. I did not read personal values.
- No production system, external service or credential was contacted, except `npm audit` (read-only query to the npm registry).

### Working-tree provenance (important)

Before this audit phase, in the same session, I changed the following at your request. The audit reviewed the tree **as it is now**, including these changes. They were not made during the audit:

- `ownus/src/app/api/v1/[...path]/route.ts` (admin import submit now forwards to the API), `ownus/src/components/admin/views/upload-operations-view.tsx` (Business column).
- `apps/api/src/modules/import/services/{admin-import,import-pipeline,batch-integrity(new)}.ts`, `repositories/import.repositories.ts`, `__tests__/import-operations.integration.spec.ts` (one test added), `services/batch-integrity.spec.ts` (new), `apps/api/scripts/backfill-import-records.{sql,ts}` (new).
- `apps/api/src/config/__tests__/config-hardening.spec.ts` (one stale assertion updated to the current stricter rule).
- A one-time backfill inserted 58 `import_records` rows into the **local development** database.

The test file edit in `config-hardening.spec.ts` is the only change to an existing test; it is disclosed here because this phase's rules forbid editing tests.

## 2. Tests inspected (not all executed)

| Class | Inspected | Executed |
|---|---|---|
| API unit (`apps/api`, `npm run test:unit`) | 21 suites (config, secrets, OTP, password, CSV, SSRF client, OAuth state, migrations, traffic, people normalisers, batch integrity) | Yes |
| API integration (`test:integration`) | 37 suites (import, People, payments, privacy, discover, company resolution) | Yes |
| API security (`test:security`) | 1 suite, 9 tests | Yes |
| API performance (`test:perf`) | CIDR window budgets | **No** |
| API e2e (`test:e2e:all`) | 23 suites in `apps/api/test` | Yes |
| API staging e2e (`test:e2e:staging`) | `jest-staging.json` | **No**, it targets a staging environment |
| Web unit (`ownus`, `npm test`) | 22 files in `ownus/src/lib/__tests__` | Yes |
| Playwright UI (`tests/01-auth` to `10-negative`, `playwright.config.ts`) | 10 spec files | **No** |
| Load test (`ops/testing/load-test.mjs`) | not opened | **No** |

## 3. Commands and results (exact)

All API commands were run from `apps/api`; the web command from `ownus`.

| # | Command | When | Result |
|---|---|---|---|
| 1 | `npm run test:unit` | 2026-10-08 | 21 suites, 374 passed, **1 failed** (`config-hardening.spec.ts`, "admin OTP fixed code": expected the pattern `['development','test'].includes` twice, found 0; the controller now uses `fixedOtpAllowed()`) |
| 2 | `npm run test:unit -- config-hardening` | 2026-10-08, after the assertion update | 1 suite, 7 passed |
| 3 | `npm run test:unit` | **2026-10-09** (this audit) | 21 suites passed, **375 of 375 passed** |
| 4 | `npm run test:integration` | 2026-10-08 | 37 suites: 36 passed, 1 skipped; **895 passed, 13 skipped**, 908 total |
| 5 | `npm run test:security` | 2026-10-08 and **2026-10-09** | 1 suite, **9 of 9 passed** (both runs) |
| 6 | `npm run test:e2e:all` | 2026-10-08 | 23 suites: 22 passed, **1 failed** (`health-probes.e2e-spec.ts`, "reports every dependency including Redis"); **398 passed, 1 failed**, 399 total |
| 7 | `npm test` (web) | 2026-10-08 and **2026-10-09** | **220 of 220 passed**, 52 suites, 0 failed |
| 8 | `npx tsc --noEmit` for API and web | 2026-10-08 | clean (no output) |
| 9 | `npm run test:integration -- import-operations` | 2026-10-08, after one test was added | 1 suite, 14 passed |
| 10 | `npm audit --omit=dev` (API workspace, web app) | **2026-10-09** | API: 2 moderate (`@nestjs/swagger`, `js-yaml`), 0 high, 0 critical. Web: 0 |

Failures and flakes:
- `health-probes` (#6) fails on the Redis-absent case; the 7 Oct assessment recorded the same test as flaky. I did not investigate or rerun it. It is not a vulnerability.
- The stale assertion (#1) was a test problem, not a product problem: the code is stricter than the test expected.

Logged errors in the integration output (People import job retries, "Source company-upload is disabled") come from negative-path tests and did not fail any test.

## 4. Read-only checks that are not part of the suites

| Check | How | Result |
|---|---|---|
| OAuth simulation path | A throwaway script (kept outside the repository, in the session scratch folder) constructed the real `GoogleOAuthProvider` and `MicrosoftOAuthProvider` with `NODE_ENV=production` and placeholder credentials, then called `exchangeCode('sim_google_someone@example.org')` and `getUserProfile`. No database, no network. | Both providers returned the supplied address with `isEmailVerified: true`. **Confirms SG-01 at the provider level.** The full request chain was **not** run. |
| Unauthenticated smoke test | `curl` GET against `127.0.0.1:4000/api/v1` and `localhost:3000/api/v1` | Public routes `/health/live`, `/health/ready`, `/discover/search`, `/credit/packages` returned 200. Protected admin and customer routes (`/user/profile`, `/saved-leads`, `/saved-searches`, `/unlock/status/x`, `/admin/import/batches`, `/admin/import/operations/batches`, `/internal/people-review/stats`; through the gateway also `/admin/businesses`, `/admin/users`) returned 401. `/health` returned 503 because the storage dependency was down (Docker not running). Several paths I guessed returned 404 and are not evidence of anything. |
| Secret and credential scan | `git grep` over HEAD and the working tree for password-bearing database URLs and well-known key prefixes; `git log -S` for the database host; masked output | Seven tracked scratch files at HEAD contain a password-bearing remote database URL; values not recorded (SG-02). |
| Local data counts | `SELECT count(*)` on `businesses`, `business_contacts`, `users`, `audit_logs`, `consent_records`, `privacy_requests`, `user_wallets`, People tables | 58 businesses (1 published, 57 draft); 23 company contacts, all flagged verified, 1 with an e-mail; 63 users (61 customers, 1 ADMIN, 1 SUPER_ADMIN; 5 e-mail verified); 83 audit rows; 0 consents; 0 privacy requests; 58 wallets; all People tables empty. |

## 5. Tests not executed, and why

- Playwright UI suite, load test, performance budgets, staging e2e: not needed for the audit questions and they drive a browser, a deployed target or timing.
- Any signed-in test against the running app: admin sign-in is an e-mailed code and no test credentials exist; creating accounts or minting tokens in your development database was outside this phase.
- Dynamic exploitation of SG-01 through HTTP: would create or link accounts in the development database.
- Concurrency and load testing of unlock and payment: relied on the existing tests (below) rather than new ones.

## 6. Existing coverage by area (by file name; assertions were not all read)

| Area | Present | Notes |
|---|---|---|
| Authentication | `auth.e2e-spec`, `auth-identity.e2e-spec`, `admin-auth.e2e-spec`, `oauth.e2e-spec`, `password.service.spec`, `admin-otp.util.spec`, `oauth-state.service.spec`, web `gateway-auth.test` | OAuth e2e uses **mock providers** (`test/mocks/mock-oauth-providers.ts`) |
| Authorization and isolation | `access-model.e2e-spec`, `admin-authorization.e2e-spec`, `account-integrity.e2e-spec`, `saved-leads-searches.e2e-spec`, `malformed-ids.e2e-spec` | Cross-user assertions exist; each not read |
| Credits and unlock concurrency | `credit-wallet.e2e-spec`, `lead-discovery-unlock.e2e-spec`, `people-unlock-hardening`, `people-review-concurrency` | Concurrency cases present by name |
| Payments and webhooks | `billing.e2e-spec`, `payment-hardening`, `payment-live-mode`, `payment-webhook-rawbody` | Signature, replay, amount mismatch covered by name |
| Exports | `import-export.e2e-spec`, `people-export-import`, `csv-xlsx.spec`, web `csv-security.test` | Formula guard covered |
| SSRF and webhooks | `safe-http.spec`, `integrations.e2e-spec` | Webhook client only |
| Secrets and config | `config-hardening.spec`, `release-config-secrets.spec`, `source-secrets.security.spec`, web `scratch-scripts.test` | Scan the **working tree**, not history |
| Privacy and suppression | `privacy.integration.spec`, `people-suppression.integration.spec`, `people-customer-contract`, `people-contact-provenance` | People strong; no test for company contacts |
| Security headers, hardening | `security-hardening.e2e-spec`, `security` suite | |
| Traffic and rate limiting | `traffic-control.e2e-spec`, `cidr-window.spec` | |

## 7. Coverage gaps and potentially misleading tests

1. **No test of the real OAuth providers.** Mocks replace them, so the simulation path (SG-01) and the e-mail-linking rule (SG-03) are untested. The OAuth suite passing says nothing about them.
2. **Working-tree-only secret scans.** `source-secrets.security.spec` and `scratch-scripts.test` pass while credentials sit in history and in committed scratch files at HEAD (SG-02). CI has no history scan, dependency audit or image scan (SG-14).
3. **No automated test of the gateway's native routes** beyond the route-policy table and the unlock SQL helper. Nothing asserts that each native `fullPath ===` branch has a policy; nothing tests native export, admin delete or admin user list (SG-06, SG-13, SG-15, SG-17).
4. **Hermetic e2e database.** PGlite has one superuser, so database role privileges, TLS and owner-role exposure are never exercised.
5. **Suppression for company contacts and for caches or the search index** has no test, because the feature does not exist (SG-05, PR-06).
6. **Import moderation:** no test that `autoPublish: false` prevents publication (the option is ignored, SG-04).
7. **Admin session lifetime and storage** are untested (SG-07).
8. **Typesense filter escaping** is untested (SG-09).
9. **Pagination bounds** on `unlock/history` and `exports/history` are untested (SG-20).
10. **Enumeration and timing** of login and registration are untested (SG-10).
11. The `health-probes` e2e test is flaky and should be stabilised so a red run always means something.

## 8. Conclusion on testing

All executed suites pass except one flaky health test. That is evidence the code does what its tests say, and the tests are broad in the API. They do not cover the highest-severity findings above (SG-01, SG-02, SG-03, SG-06). A green run must not be read as security or production readiness.
