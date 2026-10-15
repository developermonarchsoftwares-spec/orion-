# Production readiness report (Phase 19)

**Date:** 2026-10-12 · **Scope:** the working tree on branch `chore/neon-removal-prep` (HEAD `3cf08b3`) plus its uncommitted changes · **Nothing was deployed, committed, pushed, rotated or changed in any live environment.**

## 1. Classification

# BLOCKED

The code and the database tooling pass everything that can be checked on this machine. The release is blocked because there is **no deployable release candidate in version control** and because several operator-controlled gates are still open. This is stricter than the "conditionally ready" wording of `SECURITY_FINAL_REVIEW.md`, which judged the source code; the deployment evidence gathered in this phase adds blockers that review did not cover (B1, B5, B6 below).

### Release blockers

| # | Blocker | Why it blocks | Owner |
|---|---|---|---|
| B1 | **The hardened code is not committed.** 144 tracked files are modified and about 499 source, test, ops, CI and doc files are untracked. 22 of the 26 migrations are untracked (HEAD journals 3 entries, 4 SQL files). `.github/workflows/test.yml` is untracked and has never run. The branch is unpushed and two commits on `origin/main` are not in it. | A build from any commit would lack the security work and the schema it depends on. Vercel and CI build from Git. | Release owner (commit approval) |
| B2 | Credentials exposed in Git history are not rotated (SG-02 / SG-02b): `npm run test:secrets:history` still reports 3 distinct values. | Public-repository exposure of a database owner credential and signing secrets. | Operator |
| B3 | Production environment values on the hosts are unverified (GATE-02). The pulled Vercel file has the JWT secrets empty; the API refuses to start on missing or placeholder secrets, so a wrong value means an outage, not a silent weakness. | Cannot be checked from the repository. | Operator + security approver |
| B4 | Live payment keys and server-side order synchronisation (CR-03/05). Payments must stay disabled until done. | Feature gate, not a launch gate if payments are off. | Engineering / operator |
| B5 | **No production database and no production API host is identified.** Neon is being removed; the replacement is not chosen; no rehearsal has run on it. `TARGET_ARCHITECTURE.md` lists the API runtime as unknown. | The deployment sequence has no target. | Operator |
| B6 | **No alert has ever been shown to fire**, and no backup has been scheduled, completed and restored at production scale. | Failures would go unnoticed (see §7). | Operator |

## 2. Commands run and actual results

All "clean copy" runs used a copy of the working tree **without** `node_modules`, build output and every `.env*` file (the copy contained only `*.example` templates), installed from the lockfiles. That checks reproducibility and that nothing depends on a developer's local environment. Machine: Windows 11, Node 24.11.1, npm 11.6.2, PostgreSQL 18.3 client and server.

| Command | Where | Result |
|---|---|---|
| `npm ci` (root, 32 s) | clean copy | exit 0; 25 moderate advisories reported by npm in the full tree |
| `npm --prefix ownus ci` | clean copy | exit 0. **Not in CI before this phase** (fixed, P19-03) |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | clean copy, before building `packages/shared` | **exit 2** (`@orion/shared` not found): the CI order was wrong (fixed, P19-03) |
| `npm --prefix packages/shared run build` | clean copy | exit 0 |
| `npx tsc --noEmit -p apps/api/tsconfig.json`, `-p ownus/tsconfig.json` | clean copy | exit 0, exit 0 |
| `npm --prefix apps/api run build` (`nest build`) | clean copy | exit 0 |
| `npm --prefix ownus run build` (Next.js 16.3.8 Turbopack) | clean copy | exit 0; 21 routes (19 static, 2 dynamic) |
| `npx eslint "{src,apps,libs,test}/**/*.ts"` (without the script's `--fix`) | clean copy, API | exit 0: 0 errors, 5 warnings |
| `npm run lint` | clean copy, web | **exit 1: 352 errors, 450 warnings** (290 `no-explicit-any`, 17 `no-require-imports`, 15 `no-unescaped-entities`, 6 `prefer-const`, 1 `react-hooks/rules-of-hooks`, others). Pre-existing, not part of CI (P19-08) |
| `npm run test:unit` (API) | clean copy | 41 suites, 802 passed, 1 skipped, 0 failed |
| `npm test --prefix ownus` | working tree | 258 passed, 0 failed (in the clean copy 256 passed and 1 failed only because my copy omitted the `scratch/` folder that test inspects) |
| `npm run test:integration` | clean copy | 39 suites passed, 1 skipped; 945 passed, 13 skipped, 0 failed |
| `npm run test:e2e` | clean copy | 33 suites passed, 1 skipped; 581 passed, 7 skipped, 4 todo, 0 failed (the timing-sensitive `health-probes` passed this time; it has failed on some earlier loaded runs) |
| `npm run test:security` | working tree | 9 of 9 passed (the suite lists files with `git ls-files`, so it cannot run in a copy without `.git`) |
| `npm run test:perf` | working tree | 3 of 3 passed |
| `npm run test:secrets` / `npm run test:inventory -- --check` | working tree | 0 findings / check passed |
| `npm run test:secrets:history` | working tree | 3 distinct secret values in history (open, B2) |
| `npm audit --omit=dev --audit-level=high` (root; `ownus`) | clean copy | root: 2 moderate (`@nestjs/swagger`, `js-yaml`), 0 high, 0 critical; web: 0 |
| `npm run db:migration:check` | working tree and clean copy | journal consistent: 26 entries, newest `when` 1799500000002 |
| Playwright browser suite (`npm run test:browser`) | **not run** | needs a running app and browsers; not exercised in this phase |
| Docker image builds | **not run** | Docker daemon is not running; images are unverified |

## 3. Build reproducibility and artifacts

- Both applications build from the lockfiles with no environment files present. Nothing in the build reads a secret.
- Build output inspected in the clean copy: no `.env`, `.pem` or `.key` files in `apps/api/dist` or `ownus/.next`; no spec files in `dist`; no private-key blocks, live payment keys or server variable names in the client bundle. The only credential-shaped strings are the **local-development default** `postgresql://postgres:postgres@localhost…` and the development-key strings the production validators *refuse* (5, 3 and 3 files). The API `dist` contains 353 source maps and the migration CLI and `seed.js` (the seed installs taxonomies, pricing, packages and the administrator; it contains no sample businesses and refuses non-Orion local databases).
- **Runtime mismatch (P19-07):** CI uses Node 22, the Dockerfiles Node 20, the Vercel project Node 24.x, this machine Node 24.11. No `engines` field exists. Everything above was verified on 24 only.
- **Docker (unverified):** the API Dockerfile copies no lockfile and runs `npm install`; the web Dockerfile also runs `npm install`. Images therefore resolve versions from ranges and are not reproducible from the audited lockfile. Not changed, because it cannot be tested here.

## 4. Environment separation (verified by running the compiled API with `NODE_ENV=production`)

| Check | Result |
|---|---|
| Nothing configured | refuses to start: names `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`; no values printed; exit 1 |
| No JWT secrets / placeholder secrets / 5-character secret | each refused with a message naming the variable; exit 1 |
| `CORS_ORIGINS=http://localhost:3000` | refused ("not https"); exit 1 |
| Valid configuration against a scratch database | starts; logs are structured JSON |
| Swagger | `/docs`, `/docs-json`, `/api/docs` return 404 in production. The startup log still prints a "Swagger Docs" line (cosmetic, P19-10) |
| Unauthenticated `user/profile`, `admin/import/batches`, `monitoring/errors`, `monitoring/test-error` | 401 |
| Foreign-origin CORS preflight | no `Access-Control-Allow-Origin` |
| Headers | HSTS, CSP `default-src 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy present |
| Error bodies | generic message and request id; no SQL, stack or host |
| Seed / fixtures in production | `seed.ts` has no sample businesses and refuses a non-Orion local database; it is a manual script, not run at start. Test credential shortcuts are limited to `NODE_ENV=test`/local database (Phase 3, tests) |
| Public environment variables | only `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` exist in the code |
| Gateway with `BACKEND_API_URL` unset | the gateway contains native handlers; behaviour in the deployed environment is **unverified** (B3/B5) |

Not verified (needs the hosts): the actual Vercel and API environment variable values, cookie `Secure`/domain behaviour behind the real domain, CORS against the real web origin.

## 5. Database migration assessment (disposable local databases only)

| Test | Result |
|---|---|
| Fresh database built from the 26 migrations by the **compiled** migrator | **Failed before Phase 19's fix** ("Can't find meta/_journal.json": the build looks in `dist/database/migrations`, the Dockerfile copies the SQL to `src/database/migrations`). Fixed in `migrate.ts` (checks both, and `MIGRATIONS_FOLDER`); then 26 applied, 68 tables, re-run idempotent |
| `db:audit` on that database | no findings, 0 missing tables, **0 schema drift** against the ORM, no hash mismatches |
| Upgrade: database at migrations 0000 to 0003 holding users, business, contact, source, wallet, unlock and audit rows, then all 26 applied | 339 ms; no row lost (all counts equal); contact data intact; new triggers present; publishing from a `REVOKED` source blocked by the database (SQLSTATE 23514) |
| Destructive statements | none: no `DROP TABLE/COLUMN`, `TRUNCATE`, `DELETE` or `UPDATE` in `0004` to `0025`; the only `ALTER TYPE … ADD VALUE` are in the already-applied `0001` |
| Locks | `0025` (index on `businesses`) and `0004` (index on `saved_leads`) are not `CONCURRENTLY` and block writes while building; `0025`'s new columns have defaults (no table rewrite); `0024` adds per-row triggers on `business_contacts`. **Lock time and import throughput on production-sized tables are unmeasured.** |
| Behaviour change | existing data sources become `UNREVIEWED`; imports from them wait for an administrator (Phase 15) |
| Failure behaviour | the runner exits 1 and stops; Drizzle has no down-migrations. Recovery is forward-fix or restore (runbook §10) |
| Journal ordering | `when` ordering enforced by `db:migration:check`; entries 8 to 23 carry future dates by history and must not be edited |

**Not verified:** the state of the real production database (which migrations it has applied), a rehearsal on the chosen provider, and migration time at production size.

## 6. Deployment configuration

| Item | Finding |
|---|---|
| Vercel | `.vercel/project.json`: framework nextjs, root `ownus`, Node 24.x, default install/build. No `vercel.json`: headers come from `next.config.ts`. The pulled `.vercel/.env*.local` files are git-ignored |
| API start | `node dist/main.js` (Dockerfile `CMD`); build `nest build`. The compiled migrator works from the image layout after the P19-02 fix |
| CI (`.github/workflows/test.yml`) | corrected in Phase 19 (shared build before type-check; web install). Never run; untracked |
| Compose | development stack (`postgres:16`, Typesense, MinIO, `minio/latest`); healthcheck path `/api/v1/health/liveness` exists. Not a production definition |
| Background jobs | all in-process; safe to repeat by design (row locks, claim updates, `SKIP LOCKED`, idempotent retention) but untested with more than one instance; switches documented in the runbook |
| Private files | `.dockerignore` excludes `.env*`, keys and `.vercel` (Phase 14); API docs not served; `docs/` and `ops/` are not under the web `public/` folder |
| TLS to the database | verified connection for remote hosts (Phase 14); not exercised against a real remote database |

## 7. Operational monitoring

| Capability | Evidence | Status |
|---|---|---|
| Liveness / readiness | `GET /api/v1/health/live` 200; `/health/ready` 200 `degraded` with database up, optional search/redis skipped, storage down; per-dependency routes | **Verified** (local) |
| Information disclosure | public bodies list status, latency, `required` flag, uptime and a reason code; no hosts, credentials, versions or customer data | **Verified** |
| `/health` (comprehensive) | returns 503 when *optional* storage is down | **Misleading for a monitor** (P19-09) |
| Structured logs | JSON in production; scrubber unit-tested; test runs use the plain Nest logger and print fixture secrets by design | Verified (format), scrubbing by unit tests |
| Metrics, tracing, error summaries | modules and admin routes exist | Not exercised |
| Alerting | threshold evaluation exists; **no destination configured or ever fired** | **Unverified** |
| Backup completion | manifest lines and fail/OK pings exist; ping URLs unset; dead-man not configured | Manifest **verified**; alerting **unverified** |
| Incident response | `INCIDENT_RESPONSE.md`, `INCIDENT_RESPONSE_RUNBOOK.md`; contacts "NOT SET" | Documented only |

## 8. Backup and recovery validation (real tools, test data only)

Test data only (`example.test` addresses) in disposable databases `orion_scratch_phase19_*`. Sequence and results:

1. `ops/backup/backup.sh` (real `pg_dump`, AES-256 `gpg`, checksum, ledger): **first run exposed two defects** and was fixed: (a) the ledger CLI still used a field renamed in Phase 16, so the ledger was not written (the CLI is outside the type-checked project), (b) the prune step failed on empty weekly/monthly folders, so the script would report FAILED on most days. After the fix: exit 0, encrypted dump 40 KB, `CREATED`, `LEDGER`, `OK` lines in the manifest, files mode 600.
2. Post-backup deletions applied to the live test database (erased account, suppressed contact, suppressed person, completed request), then backup #2 (its ledger contains them).
3. `restore.sh` of backup #1 into a new database: checksum verified, decrypted, restored; **a tampered copy was refused** (`FAILED`, exit 1). Structure: 68 tables, 26 migrations.
4. **Before** the ledger the restored database showed the erased user's e-mail, the suppressed contact, the opt-out person `PUBLISHED`, and no suppression rows: restoring alone resurrects deleted data.
5. `db:ledger reapply` dry run (accurate, wrote nothing); `--apply` refused until a verified backup of the target existed (`db:backup` made one: row counts, schema fingerprint and journal all equal); apply: account anonymised, contact removed, person `SUPPRESSED`, request `COMPLETED`, `POST_RESTORE_RECONCILED` audit entry with counts; a re-import of the suppressed e-mail (different case) inserted nothing; a second apply changed nothing.
6. `verify-restore.sh`: PASS (after fixing its stale `packages` table name, P19-06). It does not apply the ledger and now says so.

**Limits:** the whole test used a 40 KB database, so the "2 seconds" measured is **not** a recovery-time estimate and no RTO/RPO can be claimed from it. Not tested: S3 upload (no `aws` client), lifecycle expiry, production-scale restore, restore on the real provider, remote ledger apply (the script refuses non-local databases by design, D-RET-9), backup encryption key custody.

## 9. Smoke tests and end-to-end readiness

Covered by the passing automated suites, all run **locally** against in-memory or disposable PostgreSQL (not preview, not production): authentication and sessions, authorisation and cross-user isolation, discovery and search, import → validation → duplicates → explicit publication, unlock and credit accounting, CSV/JSON export authorisation, privacy requests, suppression and retention, health probes. A live production-mode API was also exercised for health, 401 on protected routes, CORS and headers. **Not exercised:** the web UI end to end (Playwright), a preview deployment, anything on the real domain, any real payment, any real customer export.

## 10. Defects found and fixed in this phase

| ID | Defect | Fix |
|---|---|---|
| P19-02 | Compiled/Docker migrator could not find its SQL | `migrate.ts` looks in both layouts; `MIGRATIONS_FOLDER` override; verified from the compiled build |
| P19-03 | CI would fail on a clean checkout (type-check before building `@orion/shared`; web dependencies never installed) | two CI steps added/ordered |
| P19-04 | `backup.sh` failed whenever the weekly or monthly folder was empty (also in the original script) | prune tolerates empty folders |
| P19-05 | Ledger CLI broken by a Phase 16 field rename; the `scripts/` folder is not type-checked by `tsc` or CI | CLI fixed; **type-checking `scripts/` is still open** |
| P19-06 | `verify-restore.sh` checked a table that does not exist and passed anyway | checks `credit_packages`, fails on a missing core table, reminds about the ledger |

Files changed: `apps/api/src/database/migrate.ts`, `apps/api/scripts/deletion-ledger.ts`, `ops/backup/backup.sh`, `ops/backup/verify-restore.sh`, `.github/workflows/test.yml`, and the two new documents. Re-run after the changes: both type checks clean, migration check consistent; suites in §2 ran on the changed tree.

## 11. Open risks and required approvals

Open (not fixed): B1 to B6 above; P19-07 Dockerfiles not reproducible and Node versions differ; P19-08 web lint debt; P19-09 `/health` semantics; P19-10 source maps shipped and a misleading Swagger log line; migration lock times and import throughput unmeasured; existing sources become `UNREVIEWED`; the gateway/API split (a second backend in the web app, SG-06) is an accepted risk; the two moderate dependency advisories; Phase 11 intake still missing (operator-run suppression); the retention decisions D-RET-1..9; `origin/main` divergence (five files will conflict).

**Approvals required before any deployment:** commit of the release candidate and review; rotation of exposed credentials; production secret verification; choice and rehearsal of the production database; identification of the API host; written decisions for the items in `DATA_RETENTION_POLICY.md` §6; approval of the behaviour changes (§5); a first alert test and a production-scale restore drill.

## 12. Path to READY FOR DEPLOYMENT REVIEW

1. Commit and review the release candidate (the checkpoint's commit plan), merge `origin/main`, push a branch, run CI to green.
2. Rotate the exposed credentials and verify host secrets (B2, B3).
3. Provision the production database and API host; run §4 of the runbook on a production-size copy, recording lock times; time a restore.
4. Run the Playwright suite and the runbook §6 smoke tests on a Vercel preview.
5. Prove one alert fires and one scheduled backup completes with a ledger.
6. Align Node versions and make the Docker builds use the lockfiles.

## 13. Phase 26 update: pipeline and supply chain (2026-10-13)

Classification unchanged: **BLOCKED**. The CI workflow was invalid YAML and had never run (fixed; still unexecuted on GitHub). Actions are pinned to commit SHAs, the checkout keeps no token, and signature, critical-level audit and migration-journal checks were added. New blockers/open items: R-042 (CI not a proven release gate; branch protection and Vercel check settings unverified), R-043 (Docker unpinned, no lockfile), R-047 (CODEOWNERS and Dependabot inert until enabled), R-048 (first real run pending). Added to the path to READY FOR DEPLOYMENT REVIEW: protect `main` and require the `fast` check; run the workflow once on a branch and fix what it reveals. Details: `CI_CD_SECURITY_REVIEW.md`.

## 14. Phase 27 update: database security (2026-10-13)

Classification unchanged: **BLOCKED**. Fixed: duplicate saved leads and first-wallet races (proved on a real PostgreSQL server), 500 responses for bad paging and unknown companies, unbounded bulk lists, missing connection limits, bound values in the error log. New open items: R-049 and R-050 (no restricted application role, no separate migration role: needs the production database and approval), R-051 (cascade deletes), R-055 (company-level saved-lead unique index needs a data check and a rehearsed migration). Added to the path to READY FOR DEPLOYMENT REVIEW: create the application and migration roles and re-run the e2e suite and `pg-concurrency` with the application role. Details: `DATABASE_SECURITY_REVIEW.md`.

## 15. Phase 28 update: API contract (2026-10-13)

Classification unchanged: **BLOCKED**. Fixed: validation of five API bodies, 54 gateway server errors, gateway false-success answers, gateway error logging. A hostile-request sweep of every API route and of the built gateway now shows 0 server errors and no internal detail in any response. New open items: R-060 (remaining gateway call sites that hide database failures), R-063 (two implementations of the same routes), R-058/R-059/R-062 (low). Added to the path to READY FOR DEPLOYMENT REVIEW: decide whether the gateway's offline mode is supported, and run the Playwright suite against a preview to confirm the browser pages with the 400/409/503 answers that replace former false successes. Details: `API_CONTRACT_REVIEW.md`.

## 16. Phase 29 update: performance and resilience (2026-10-13)

Classification unchanged: **BLOCKED**. Fixed: a pool self-deadlock at the daily wallet rollover, a row lock on every wallet read, 30 s lock waits answered as 500, imports stranded after a process kill. Verified under controlled load: unlock integrity under 300 simultaneous requests, recovery after all database connections were killed twice, export concurrency gate, bounded imports and exports. New open items: R-069 (no production-class measurement; a staging run is now a release step), R-064 (retention cap), R-065 (trigram index decision), R-068 (distributed clients vs per-address limits). Details: `PERFORMANCE_RESILIENCE_REVIEW.md`.

## 17. Phase 30 update: disaster recovery (2026-10-13)

Classification unchanged: **BLOCKED**. Recovery readiness is **partially verified**: a real restore, in-place restore, migration failure, outage and reconnection, and post-restore reconciliation were exercised and pass; production-scale timing, provider PITR, search, object storage and payment reconciliation are untested. Fixed: background jobs starting on a restored database, a ledger that could not redo later deletions, revoked sessions coming back, database outages answered as 500. New open items: R-071 (schedule the ledger), R-074 (apply guard for a restored remote database), R-075 (explicit encryption keys), R-076 (payment reconciliation), R-078 (untested layers). RTO and RPO remain unapproved proposals. Details: `DISASTER_RECOVERY_VALIDATION_REPORT.md`.

## 18. Phase 31 update: incident response (2026-10-13)

Classification unchanged: **BLOCKED**. Incident-response readiness is **partially verified**: detection, recording, local-receiver alert delivery, containment and evidence reconstruction work on synthetic scenarios; four defects were fixed (R-079 to R-082). Not in place: a real alert destination and roster (R-085), tamper-evident off-host audit logs (R-012), a role-change audit (G-2), a one-step publication freeze (R-084). Added to the path to READY FOR DEPLOYMENT REVIEW: name roles and on-call, configure and test a real alert destination, apply the role-change trigger. Details: `SECURITY_INCIDENT_SIMULATION_REPORT.md`.
