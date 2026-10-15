# Production deployment and rollback runbook

**Status: DRAFT FOR REVIEW. Not approved. Nothing in it has been executed against production.** Written in Phase 19 (2026-10-12). Every command below exists in the repository and was run against a disposable local database where stated in `PRODUCTION_READINESS_REPORT.md`; steps that depend on a host the repository does not identify are marked **[HOST-SPECIFIC]** and must be filled in by the operator, not guessed.

Never put connection strings, passwords, keys or tokens in this document, in a change request or in a chat message.

## 0. What is deployed, from repository evidence

| Part | Evidence | Deployment target |
|---|---|---|
| Web app and gateway (`ownus`, Next.js 16) | `.vercel/project.json`: framework nextjs, root `ownus`, Node 24.x, default build and install commands | Vercel (project name `orion-api`) |
| API (`apps/api`, NestJS) | `apps/api/Dockerfile`, `docker-compose.yml`; `TARGET_ARCHITECTURE.md` says the runtime is **unknown** | **[HOST-SPECIFIC]** not identified by the repository |
| Database | `DATABASE_URL`; production provider not yet chosen (Neon is being removed) | **[HOST-SPECIFIC]** |
| Search | Typesense optional; `SEARCH_PROVIDER=postgres` works without it | optional |
| Object storage | optional; `/health` reports it down when absent | optional |

The gateway (`ownus/src/app/api/v1/[...path]/route.ts`) proxies to the API through `BACKEND_API_URL` and also contains native handlers. **If `BACKEND_API_URL` is unset or points at localhost in production the gateway can serve requests itself.** Confirm it is set to the real API before cut-over.

## 1. Roles and approvals

| Role | Responsibility | Name |
|---|---|---|
| Release owner | Final go / no-go; owns the change request | NOT SET |
| Database operator | Backup, migration, restore | NOT SET |
| Security approver | Confirms gates 1 to 3 below | NOT SET |
| On-call engineer | Monitors for 24 h after release | NOT SET |
| Business owner | Approves behaviour changes (§7) and retention decisions (D-RET-1..9) | NOT SET |

No deployment starts without a written approval from the release owner and the security approver in the change request (`PRODUCTION_CHANGE_REQUEST_TEMPLATE.md`).

## 2. Pre-deployment checklist (all must be YES; any NO = stop)

### 2.1 The release candidate exists
- [ ] The work is **committed on a branch and reviewed** (at the time of writing it is not: 144 modified and about 499 untracked source files, 22 of the 26 migrations untracked). A deployment from the current commit would not contain the hardened code or the migrations.
- [ ] The branch is merged with `origin/main` (two commits on `origin/main` are not in the branch; five files will conflict, see the checkpoint).
- [ ] CI has run on the branch and is green. (The workflow was never run; it was corrected in Phase 19. Expect to fix first-run problems.)

### 2.2 Operator gates (Phase 17/18 release gates)
- [ ] GATE-01: database owner password and JWT secrets exposed in Git history are **rotated** (SG-02 / SG-02b). `npm run test:secrets:history` still reports 3 distinct values until they are.
- [ ] GATE-02: production environment variables verified (§3).
- [ ] GATE-03: if payments are enabled, live Razorpay keys are set and order synchronisation exists (CR-03/05). Otherwise payments stay disabled.
- [ ] GATE-05: non-Neon database provisioned; migration rehearsal completed on it (§4).
- [ ] The privacy notice states that deleted data remains in backups until they expire (`DATA_RETENTION_POLICY.md` §5), and decisions D-RET-1..9 are recorded.

### 2.3 Build evidence on the release commit (run on a clean checkout)
```bash
npm ci
npm --prefix ownus ci                 # ownus is not a workspace; it has its own lockfile
npm --prefix packages/shared run build
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p ownus/tsconfig.json
npm --prefix apps/api run build
npm --prefix ownus run build
npm run test:secrets
npm run test:inventory -- --check
npm run test:unit && npm run test:integration && npm run test:security && npm run test:e2e
npm --prefix ownus test
```
Expected on the verified tree: all pass except the timing-sensitive `health-probes` e2e (re-run it alone before treating it as a failure). Paste the summary lines into the change request.

## 3. Configuration and secret readiness (names only)

Check each exists in the **intended secret store** (Vercel project settings for the web app; the API host's secret mechanism for the API). Never `echo` a value; check presence and length only.

| Variable | Where | Rule |
|---|---|---|
| `NODE_ENV=production` | API, web | exactly this |
| `DATABASE_URL` | API (and web if its native handlers use the database) | the new production database, direct (non-pooled) endpoint |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | API **and** web | at least 16 characters, freshly generated, **not** the values in `docker-compose.yml` or Git history, identical in API and web. The API refuses to start otherwise. |
| `CORS_ORIGINS` | API | exact `https://` origins of the web app; no localhost, no wildcard. The API refuses to start otherwise. |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` | web (public by design) | public URLs only. These are the only `NEXT_PUBLIC_` names in the code. |
| `BACKEND_API_URL` | web | the production API URL (not localhost) |
| `APP_URL` | API | public web URL (reset and verification links) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | API | live keys only; a test-mode key makes payments fail closed |
| `TYPESENSE_API_KEY` | API | required only with `SEARCH_PROVIDER=typesense`; the development key is refused |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | API | `minioadmin` is refused |
| `MIGRATION_CONFIRM_HOST` | migration step only | the exact database host; never set permanently |
| `DISABLE_*` job switches | API | see §5.4 |

A missing or unsafe required value stops the API at start with a message that names the variable and never prints its value (checked in Phase 19: nothing configured; no JWT secrets; placeholder secrets; short secret; localhost CORS).

## 4. Database backup and migration

### 4.1 Backup (before every production migration)
1. Take a provider snapshot or run `bash ops/backup/backup.sh` against the production database with an encrypted passphrase file. Confirm the manifest line `CREATED …` and `LEDGER …` in `backup-manifest.log`.
2. Record the file name and checksum in the change request.
3. Confirm the backup restores: restore it into a **separate empty database** with `ops/backup/restore.sh` and run `ops/backup/verify-restore.sh`. A backup that has not been restored is not a backup.

### 4.2 Pre-flight (read-only)
```bash
npm run db:migration:check --prefix apps/api         # journal consistent, newest "when" ordering
npm run db:rehearsal --prefix apps/api -- snapshot > before.json     # read-only counts and structure
npm run db:audit --prefix apps/api                   # history vs journal vs schema; expect no findings
```
Stop if `db:audit` reports hash mismatches, unknown rows or `skippedNeverApplied` entries; that means the database history differs from the journal and needs a human decision (`MIGRATION_RUNBOOK.md`).

### 4.3 Apply
- Migrations are **not** run on application start. They are an explicit step by the database operator:
```bash
MIGRATION_CONFIRM_HOST=<exact db host> npm run drizzle:migrate --prefix apps/api     # from source, or:
MIGRATION_CONFIRM_HOST=<exact db host> node dist/database/migrate.js                  # from the compiled build / image
```
  Use the **direct** endpoint (not a pooler): migrations take advisory locks.
- A failed migration exits non-zero and stops. Drizzle applies each file in one transaction per statement batch; a failure leaves the files already applied in place. Do not start the new application version.
- After applying: `npm run db:rehearsal --prefix apps/api -- snapshot > after.json` then `npm run db:rehearsal --prefix apps/api -- compare before.json after.json` (no row count may go down) and `npm run db:audit --prefix apps/api` (expect no findings).

### 4.4 What the migrations do (assessed in Phase 19)
No migration drops a table or column or deletes data. Locking: `0025` creates an index on `businesses` and `0004` one on `saved_leads` without `CONCURRENTLY`, which blocks writes to that table while it builds (instant on small tables; minutes on millions of rows: rehearse on a production-size copy and schedule a quiet window). `0024` adds triggers on `business_contacts` that run on every insert/update (import throughput must be measured on the production copy). `0025` gives **every existing data source `trust_status = UNREVIEWED`**, so imports from existing sources will no longer publish automatically until an administrator approves the source and publishes the batch (behaviour change, §7).

## 5. Deployment sequence

1. Announce the window; freeze other deploys.
2. §4.1 backup, §4.2 pre-flight, §4.3 migrate (database first: the new code expects the new schema; the old code tolerates the added columns, tables and triggers except the source-trust rule in §4.4).
3. Deploy the API **[HOST-SPECIFIC]**: build the artifact from the release commit (`npm --prefix packages/shared run build`, `npm --prefix apps/api run build`, or the Docker image) and start it with the §3 variables. Wait for `GET /api/v1/health/ready` to return `ready: true` before routing traffic.
4. Deploy the web app: merge/push the release branch so Vercel builds it (Vercel deploys on push; do **not** push `main` casually). Use the preview deployment first and run §6 against it. Promote only after the preview passes.
5. Confirm the §5.4 job settings, then run §6 again against production.

### 5.4 Scheduled jobs
The API runs its schedulers inside the process (credit rollover, privacy and retention, export schedules, webhook dispatch, queue workers, traffic pruning). With more than one API instance they run in each instance. They are designed to be safe to repeat (row locks, compare-and-set claims, `FOR UPDATE SKIP LOCKED`, idempotent retention), but run one instance until a load test says otherwise. Switches: `DISABLE_PRIVACY_JOBS`, `DISABLE_EXPORT_SCHEDULER`, `DISABLE_INTEGRATION_DISPATCHER`, `RETENTION_DRY_RUN=true` (preview only). There is no switch for the credit rollover.

## 6. Post-deployment smoke tests (production, read-only or test-account only)

Replace `$API` with the production API base. No purchases, no real customer exports, no destructive calls.

| # | Check | Pass |
|---|---|---|
| 1 | `GET $API/api/v1/health/live` | 200, `status: ok` |
| 2 | `GET $API/api/v1/health/ready` | 200, `database.status: up`; the body lists status and latency only (no hosts, versions or credentials) |
| 3 | `GET $API/api/v1/user/profile` with no token | 401 |
| 4 | `GET $API/api/v1/admin/import/batches` with no token | 401 |
| 5 | `GET $API/docs` | 404 (documentation is not served in production) |
| 6 | Preflight with a foreign `Origin` | no `Access-Control-Allow-Origin` header |
| 7 | Response headers on any route | `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` present |
| 8 | Web app: load `/`, `/login`, `/discover`; sign in with a **test account**; run a search | pages render; search returns published businesses only |
| 9 | Test account: unlock one test business; wallet balance drops by the configured cost and a ledger row exists | consistent |
| 10 | Test account: export CSV of the unlocked lead | contains only that lead |
| 11 | Second test account cannot read the first one's unlocked lead, saved items or exports | 403/404 |
| 12 | Admin test account: sign in (one-time code), open the import screen, upload a **test CSV**, confirm it waits for publication | batch not published automatically |
| 13 | `npm run db:reconcile-credits --prefix apps/api` against the production database (read-only) | no hard failures |

The same sequence ran in Phase 19 against a locally built production-mode API (items 1 to 7 only), see the readiness report.

## 7. Monitoring and escalation

- Watch for 24 h: `/api/v1/health/ready`, error rate and latency (the API exposes metrics and error summaries to administrators under `/api/v1/monitoring`), failed logins, 5xx, `RETENTION_JOB_FAILED`, `ABUSE_SIGNAL`, `TOKEN_REUSE_DETECTED`, payment webhook failures, backup manifest lines.
- **Alerting is not verified.** The monitoring module evaluates thresholds and can notify, but no destination is configured or tested in the repository; the dead-man ping for backups needs `BACKUP_PING_*` set. Until an alert has been seen to fire in a test, treat monitoring as manual.
- Escalation: on-call engineer, then release owner; security events follow `INCIDENT_RESPONSE.md`.

## 8. Rollback decision criteria

Roll back (application) when any of: sustained 5xx above the agreed threshold; authentication or authorisation failing for valid users; any smoke test in §6 items 3, 4, 10 or 11 failing (a security failure is an immediate rollback); wallet or ledger inconsistency; health `ready: false` for more than 5 minutes.
Do **not** roll back when the problem is data, not code: a wrong import, a mistaken suppression or a billing discrepancy needs a targeted fix (§10), not a redeploy.

## 9. Application rollback

- **Web (Vercel):** promote the previous production deployment in Vercel ("Promote previous deployment", as written in `BACKUP_AND_DISASTER_RECOVERY.md` §6). No data action is needed by itself.
- **API [HOST-SPECIFIC]:** redeploy the previous image or build. Start it with the same environment.
- The previous application version must tolerate the new schema. In this release it does for additive changes (new tables, columns and triggers), with these exceptions: the previous version knows nothing about `trust_status`, so it would publish imports from `UNREVIEWED` sources (the `REVOKED` guard still applies in the database), and it does not write the new audit and suppression records. Confirm with the release owner that this is acceptable before relying on a code-only rollback.

## 10. Database rollback and forward recovery

**Drizzle has no down-migrations. Reverting application code does not reverse a migration.** The options, in order of preference:

1. **Forward fix.** Write a new migration (`npm run db:migration:new --prefix apps/api -- <name>`; never edit an applied file and never use a lower `when` than the newest) that corrects the problem. Preferred for every additive change in this release.
2. **Targeted repair.** Restore the affected table(s) from the pre-deploy backup into a scratch database and copy the rows back inside a transaction (`BACKUP_AND_DISASTER_RECOVERY.md` §5C).
3. **Full restore** (last resort, data loss back to the backup): §11.

The migrations in this release are not reversible by a script: `0024`/`0025` add triggers and columns that a manual `DROP TRIGGER` / `DROP COLUMN` could remove, but that is a new, reviewed change, not a rollback, and `contact_suppressions` rows can never be deleted (by design). Treat the release as forward-only once users have written data.

## 11. Backup restoration (summary; the full procedure is `BACKUP_AND_DISASTER_RECOVERY.md` §5)

1. Declare the incident, freeze deploys, **stop the API and queue workers**.
2. Restore the chosen backup into a **new** database with `ops/backup/restore.sh <file> <new database url>`; it verifies the checksum first and refuses a non-empty target.
3. **Re-apply the deletion ledger before anything can read the data:** `npm run db:ledger --prefix apps/api -- reapply --in <ledger>` (dry run), then with `--apply` (needs the local-database safeguards, so a remote production target currently needs an approved exception, decision D-RET-9). Check the `POST_RESTORE_RECONCILED` audit entry.
4. Point `DATABASE_URL` at the restored database, start the API, check `/api/v1/health/ready`, re-index search if used, run §6.
5. Reconcile credits and payments since the backup against the payment provider (`npm run db:reconcile-credits`).

Without step 3 a restore silently brings back erased accounts, suppressed contacts and suppressed people (demonstrated in Phase 19 on a scratch database).

## 12. Post-incident and post-release evidence

Keep, in the change record: commit hash; CI run link; the §2.3 outputs; backup file name and checksum; `before.json`/`after.json` comparison result; `db:audit` output; timestamps of each step; smoke-test results; any rollback decision with the criterion that triggered it; the audit entries `POST_RESTORE_RECONCILED`, `RETENTION_JOB_*`; the privacy-incident assessment (`INCIDENT_RESPONSE.md` §5) if a restored database was ever served before the ledger was applied.

## 13. Known limitations of this runbook
- API hosting, database provider and alert destinations are not identified in the repository; those steps are marked **[HOST-SPECIFIC]**.
- Docker images could not be built or run (Docker daemon not available); the Dockerfiles use `npm install` without the root lockfile, so image builds are not reproducible from the lockfile (see the readiness report).
- The recovery objectives in `BACKUP_AND_DISASTER_RECOVERY.md` §2 are proposals. The only measured restore (2 seconds) was a 40 KB test database and says nothing about production recovery time. No restore of a production-sized backup has been timed.
- Migration lock durations on production-sized tables are unmeasured.

## 14. Related documents and handover (added in Phase 20)
- Release-readiness assessment and evidence: `PRODUCTION_READINESS_REPORT.md` (BLOCKED).
- What is verified and how: `SECURITY_REQUIREMENTS_TRACEABILITY.md`; open risks and owners: `SECURITY_RISK_REGISTER.md`; privacy mapping and legal questions: `PRIVACY_COMPLIANCE_TRACEABILITY.md`; maintainer checklist: `ORION_SECURITY_PRIVACY_HANDOVER.md` section 12.
- The git-ignored files `.vercel/.env.development.local`, `.vercel/.env.production.local` and `apps/api/.env` hold real values. Never copy them into a build context, a ticket or a chat; rotate any value that is.
- The deletion ledger and the backup manifest are produced by `ops/backup/backup.sh`; the ledger must be re-applied after any restore (section 11) before any service starts.

## 15. Release pipeline (added in Phase 26)

Before any release: confirm `main` is protected and the `fast` check is required (the repository cannot show this; look in GitHub), that the run for the exact commit is green, and that Vercel production is set to deploy from `main` only with Preview variables free of production values. Vercel rebuilds from source, so the tested and the deployed artifact are different builds: confirm the deployed commit with `/api/monitoring` (`GIT_SHA` or `VERCEL_GIT_COMMIT_SHA`). Build the API image with `docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -f apps/api/Dockerfile .` so it reports its revision; the image build itself is not yet from the lockfile (R-043). Do not trigger a production deployment to test a pipeline change. Full list: `CI_CD_SECURITY_REVIEW.md` s9.

## 16. Database access and limits (added in Phase 27)

- Create, with approval, an application role (SELECT, INSERT, UPDATE, DELETE on the application tables and usage on their sequences; no DDL, not the owner) and a separate migration role; give the API only the application URL. Until then the API's role can change the schema (R-049, R-050).
- The API sets `statement_timeout` 60 s, `idle_in_transaction_session_timeout` 60 s and `lock_timeout` 5 s (30 s before Phase 29) on every pooled connection (`DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, 0 = off). After the first release watch the logs for `canceling statement due to statement timeout` (code `57014`) and raise the value only for a proven legitimate case.
- Never delete rows from `users` or `businesses` with SQL: foreign keys cascade to payments, invoices, the credit ledger and unlocks. Use the privacy erasure and archive routes.
- Before adding the saved-lead unique index (R-055) count duplicates with the query in `DATABASE_SECURITY_REVIEW.md` section 5 and rehearse the migration on a copy.

## 17. Capacity and failure behaviour (added in Phase 29)

- Before release run the proposed targets (`TESTING_STRATEGY.md`) on staging with production-class hardware and a production-size dataset; the Phase 29 numbers are from one developer machine.
- The API answers `503` with code `DATABASE_BUSY` and `Retry-After: 2` for lock timeouts, statement timeouts, deadlocks and server-closed connections; a load balancer or client may retry those. A `500` is a bug.
- An upload whose process died stays `PROCESSING`. After 15 minutes `POST admin/import/operations/batches/:id/retry-failed` finishes it, 1,000 rows per call, repeating while `moreRemaining` is true.
- At the UTC day change every active customer's first wallet read allocates the daily credits; this was a pool deadlock risk and is fixed, but watch pool utilisation at that hour.
- Retention removes at most 20,000 rows per rule per run: check audit-table growth against that cap.
- Alerts to create are listed in `PERFORMANCE_RESILIENCE_REVIEW.md` section 10.

## 18. Recovery start-up checklist (added in Phase 30)

1. Restore into a new database; do not point any service at it yet.
2. Apply the newest ledger (`BACKUP_AND_DISASTER_RECOVERY.md` section 10), then rotate the JWT secrets only if explicit `MFA_ENCRYPTION_KEY` and `INTEGRATIONS_ENCRYPTION_KEY` are set.
3. Start the API with `RESTORE_MODE=true` (the log prints a warning; nothing runs in the background).
4. Check `/health/readiness`, sign in, read a wallet, confirm a company withdrawn after the backup answers 404, run `npm run db:reconcile-credits`.
5. Reconcile payments for the data-loss window with the provider.
6. Unset `RESTORE_MODE`, restart, confirm queue workers and schedulers log their start-up lines, re-index search.
7. Alert if `RESTORE_MODE` is still set a day later.
