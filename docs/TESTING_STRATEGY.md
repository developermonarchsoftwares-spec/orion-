# Testing strategy and classification

**Status: PROPOSED — NOT APPROVED.** Created 2026-10-07. Thresholds below are starting values; the owner adjusts them after real measurements.

Every test belongs to exactly one class, decided by **file name**, so the class is visible in the path and a runner can select it. `npm run test:inventory` prints the count per class and `-- --check` fails if a test file matches none.

| Class | What it proves | Where / naming | Run | Needs |
|---|---|---|---|---|
| **Unit** | One function or class, no I/O | `apps/api/src/**/*.spec.ts`, `ownus/src/lib/__tests__/*.test.ts` | `npm run test:unit` | nothing |
| **Integration** | Services against a real database built from the real migrations | `*.integration.spec.ts`, `apps/api/src/database/__tests__/*.spec.ts` (in-memory PGlite) | `npm run test:integration` | nothing |
| **End-to-end (API)** | The running Nest app over HTTP, all modules wired | `apps/api/test/*.e2e-spec.ts` | `npm run test:e2e` | nothing (PGlite) |
| **End-to-end (browser)** | User journeys in Chromium | `tests/01-auth … 11-responsive` (Playwright) | `npm run test:browser` | web + API running (`PLAYWRIGHT_BASE_URL`) |
| **Security** | Secrets, authorisation, injection, replay | `*.security.spec.ts`, plus `test/security-hardening`, `admin-authorization`, `access-model` e2e specs | `npm run test:security` | nothing |
| **Performance** | Time / memory budgets on hot code paths | `*.perf.spec.ts` | `npm run test:perf` | nothing |
| **Load / stress** | A running server under concurrent traffic | `ops/testing/load-test.mjs` | `npm run test:load -- --url …` | a **non-production** server you own |
| **Regression** | A bug that was fixed stays fixed; the full deterministic suite still passes | `*.regression.spec.ts` (one per fixed bug) + the run of everything above | `npm run test:regression` | nothing |
| **User acceptance (UAT)** | The business accepts the release | `docs/UAT_TEST_PLAN.md` + `UAT_RELEASE_RUNBOOK.md` | manual, on staging | approved staging environment |

## Rules
1. **Pick the cheapest class that can catch the bug.** A pure function gets a unit test, not a browser test.
2. **Unit tests touch no database or network.** If it needs PGlite it is an integration test (`*.integration.spec.ts`).
3. **Fixing a bug adds a `*.regression.spec.ts`** named after the bug (`<area>-<what>.regression.spec.ts`) that fails without the fix. Do not delete it later.
4. **Performance budgets are loose** (about 20× typical) so they catch complexity regressions, not noise. If one fails, find out why before raising it.
5. **Security tests never print secret values**, only file names and rule names.
6. **Never run load tests against production or a shared database.** `load-test.mjs` refuses non-local targets without `--allow-remote`; the app's rate limiter (`API_PROTECTION.md`) answers 429 on purpose, so test with an allowance raised for the test user or from an exempt admin token.
7. A new database column or table must keep `database/__tests__` and `test/helpers/pglite-db.ts` green; the helper in `modules/people/__tests__/pglite-test-db.ts` replays only a subset of migrations and needs any new column added (as `users.deleted_at` was).

## When each class runs

| Trigger | Classes |
|---|---|
| Every commit / pull request (CI `.github/workflows/test.yml`) | unit, integration, security, performance, API e2e, type-check |
| Before merge to main / release candidate | the above (= `test:regression`) + browser e2e on staging |
| Before UAT | load test on staging (targets below) |
| UAT | `UAT_TEST_PLAN.md` sign-off |
| After any production incident | add a regression test, then run `test:regression` |

## Load and performance targets (proposed)

| Endpoint group | Concurrency | Duration | p95 | Error rate |
|---|---|---|---|---|
| `GET /api/v1/health`, `/health/ready` | 50 | 30 s | ≤ 300 ms | ≤ 0.5 % |
| Authenticated search / discover | 20 | 60 s | ≤ 800 ms | ≤ 1 % |
| Dashboard / credits reads | 20 | 60 s | ≤ 600 ms | ≤ 1 % |
| Stress: ramp 0→100 workers | 100 | 120 s, `--ramp 60` | record the knee where p95 or errors breach; no crash, recovers after | — |
| Soak (before major releases) | 10 | 60 min | p95 flat, memory flat | ≤ 0.5 % |

Example (PowerShell or `MSYS_NO_PATHCONV=1` in Git Bash):

```bash
npm run test:load -- --url http://localhost:4000 --paths /api/v1/health,/api/v1/health/ready --concurrency 50 --duration 30 --p95 300 --max-error-rate 0.5
```

Record results in the table in `UAT_TEST_PLAN.md` §4.

## Known state when this was written (2026-10-07)
- Unit: 370 tests, 1 failing: `config-hardening.spec.ts` "admin OTP fixed code" counts two `['development','test'].includes(process.env.NODE_ENV…)` occurrences in `auth/admin-auth.controller.ts` and finds none. It fails because of the uncommitted edits to that controller; fix the controller or the test.
- Integration: 894 passed, 13 skipped. API e2e: 356 passed; `health-probes` failed once in a full run and passed alone (flaky; investigate).
- Browser e2e and load tests were not run (they need running servers).
- No code-coverage threshold is enforced yet; add one once the unit failures are cleared.

## Measured baselines (Phase 29, 2026-10-13; one developer machine, not production-class)

Dataset 100,000 synthetic companies. Search sequential p50/p95: 12/23 ms (no filter), 99/162 ms (free text), 65/170 ms (city + contact filters). 20 workers: wallet p95 47 ms, dashboard p95 95 ms, unlock history p95 99 ms. Free-text search under a 40-client burst: p50 993 ms, p95 1,691 ms (above the 800 ms target; bounded by the 60-per-minute route limit). Re-run these on staging before release; record results in `UAT_TEST_PLAN.md` section 4. Method and scripts: `PERFORMANCE_RESILIENCE_REVIEW.md`.
