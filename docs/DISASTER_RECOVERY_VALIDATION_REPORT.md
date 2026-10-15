# Disaster recovery and business continuity validation report (Phase 30)

Date: 2026-10-13. Every restore, failure and recovery below was run for real on one developer machine (Windows 11, PostgreSQL 18.3, Node 24) against disposable local databases (`orion_scratch_phase30_src`, `_restored`, `_inplace`, `_phase30c`) built from synthetic data. No production or Neon database was contacted, restored, written or read; no real customer data was used; nothing was committed, pushed or deployed; no credential, token or key is printed here (the test passphrase and test JWT secrets were generated for the exercise and live only in the scratch area).

**Verdict: recovery readiness is PARTIALLY VERIFIED.** The database restore procedure, the migration failure behaviour, application reconnection and the post-restore privacy reconciliation were exercised end to end and work. Phase 30 also found and fixed four gaps that would have made a real recovery unsafe (section 7). Production-scale timing, provider point-in-time recovery, search and object-storage recovery, and payment-provider reconciliation are **not tested** (no such environment exists here). The proposed RTO and RPO have **not been approved** and the measured numbers do not demonstrate them.

## 1. Existing recovery architecture (verified in the repository, not assumed)

| Piece | Where | What it does |
|---|---|---|
| Logical backup | `ops/backup/backup.sh` | `pg_dump` custom format, optional GPG AES-256 encryption (`BACKUP_PASSPHRASE_FILE`), SHA-256 file, daily/weekly/monthly folders with pruning, optional upload, structural check with `pg_restore --list`, a manifest log. Phase 30 added `LEDGER_ONLY=true` (ledger without a dump). |
| Restore | `ops/backup/restore.sh` | verifies the checksum, decrypts, refuses a non-empty target without `--force`, runs `pg_restore --exit-on-error`, then prints the manual next steps. |
| Restore drill | `ops/backup/verify-restore.sh` | restores the newest backup into a throwaway database and checks tables and migrations. It says itself that it does not apply the ledger. |
| Deletion ledger | `apps/api` `npm run db:ledger -- export / reapply` | digests and opaque ids of every suppression, suppressed person and erased account, kept outside the database so a restore can redo deletions. Phase 30 extended it (section 7). |
| Local backup tool | `npm run db:backup` | writes a verified backup with a manifest; the destructive-operation guard (`db-guard.ts`) requires such a backup of the target database, no older than 24 h, before `--apply`. |
| Reconciliation | `npm run db:reconcile-credits`, `npm run db:audit` | read-only checks of wallets, ledger, payments and of migration drift. |
| Migrations | `src/database/migrate.ts`, Drizzle journal | one transaction for all pending migrations. |
| Documents | `BACKUP_AND_DISASTER_RECOVERY.md`, `INCIDENT_RESPONSE_RUNBOOK.md`, `MIGRATION_RUNBOOK.md`, `PRODUCTION_DEPLOYMENT_RUNBOOK.md` | procedures A (new database), B (in place), C (single table). |
| Targets | `BACKUP_AND_DISASTER_RECOVERY.md` section 2 | **proposed, not approved**: PostgreSQL RPO 15 min with provider point-in-time recovery or 24 h with the daily dump; RTO 4 h. |

Not present in the repository: a restore-mode switch (added now), a scheduled ledger job, an automated payment-provider reconciliation, a search re-index test, an object-storage restore test.

## 2. Scenarios selected, and why

Selected because the repository's tooling supports them: restore into a new database; restore in place over damage; restore refusal rules; interrupted migration; database outage and reconnection; database unreachable at boot; interrupted import; relationships, publication states, duplicates, unlocks and credits after restore; privacy and session state after restore; background jobs at boot; replay of an unlock after recovery; configuration without secrets. Not selected, because nothing in the repository supports a test: provider PITR, Typesense rebuild (the default provider is PostgreSQL), object-storage versions, payment-provider replay.

## 3. Environment and prerequisites

Source database `orion_scratch_phase30_src`: a copy of the Phase 29 dataset (100,000 companies, 160,000 contacts, 5,000 customers, 88,650 unlocks, 49,876 ledger rows, 30,000 people; 68 tables, 1,068,850 rows, 249 MB) plus scenario fixtures made with the application's own services: companies in every publication state (500 archived, 300 pending, 200 rejected, 100 verified, 10,000 draft), 3 suppressed people, 2 suppressed contact values, 1 erased account, a duplicate cluster with a candidate, a purchase with its ledger row, and a registered customer holding a live refresh token. Tools: `pg_dump`/`pg_restore`/`psql` 18.3, GnuPG 2.4.9, a generated test passphrase. The backup was taken with the repository's own script and the source was quiet during it (fingerprints before and after were identical).

## 4. Exercises performed and outcomes

| # | Exercise | Outcome | Evidence |
|---|---|---|---|
| 1 | `backup.sh` with encryption, checksum and ledger | **PASS** | 21 s, 49 MB encrypted dump for a 249 MB database, ledger written, manifest lines `CREATED`, `LEDGER`, `OK` |
| 2 | Restore into a new empty database (`restore.sh`) | **PASS** | 20.9 to 21.6 s |
| 3 | Integrity of the restored copy (`verify.ts`, section 5) | **PASS** | identical table set, row counts and primary-key hashes in all 68 tables (1,068,850 rows); 0 unvalidated constraints; 0 orphans over 95 foreign keys; 274 indexes (113 unique), 9 triggers, 9 functions; 26 migrations recorded |
| 4 | `restore.sh` onto a non-empty database without `--force` | **PASS** (refused: "Target has 67 public tables") | message observed |
| 5 | In-place restore (`--force`) over a database with a dropped table and 10,000 deleted companies | **PASS** | 24 s; same full verification passed |
| 6 | The repository's `verify-restore.sh` drill | **PASS** | 23 s, 26 migrations |
| 7 | Failing migration on a database holding data | **PASS** | real database and in-memory test: no table, no column, no journal entry left; data intact; corrected migration then applies once; a rerun changes nothing. (Statements that cannot run in a transaction, such as `CREATE INDEX CONCURRENTLY`, are outside this guarantee and were not tested.) |
| 8 | All database sessions terminated twice under load (Phase 29) | **PASS** | 10 in-flight requests failed, service continued without restart |
| 9 | Database closed to connections for several seconds while serving | **PASS after a fix** | liveness stayed 200; readiness turned 503 after its 2 s cache; customer requests answered **503** in about 34 ms (they answered a 500 before the fix); the first request succeeded 46 ms after the database reopened; the process stayed up |
| 10 | API started with the database unreachable | **PASS** | starts, liveness 200, readiness 503, requests 503 |
| 11 | Production start with no secrets configured | **PASS** | refuses to start; the message names the missing variables and prints no value |
| 12 | Interrupted import (process killed 3.5 s into a 5,000-row upload) | **PASS after a fix** (Phase 29) | batch left `PROCESSING`; no partial business data; no connection left open; now finished by `retry-failed` after 15 minutes (5 calls reached all 5,000 rows) |
| 13 | Publication states after restore (customer API, restored database) | **PASS** | archived, draft and rejected companies answer 404; published control 200; person suppressed before the backup answers 404; contacts with values suppressed before the backup: 0 |
| 14 | Things changed AFTER the backup, seen in the restored database | **FAIL (before the fix), exposure confirmed** | account erased after the backup: restored with its e-mail; contact opted out after the backup: value present again; company withdrawn after the backup: **published again (HTTP 200)**; account suspended after the backup: active again; refresh token revoked after the backup: **valid again (HTTP 200)** and an access token issued before the restore still accepted |
| 15 | Same, after re-applying the ledger written just before the disaster (extended in Phase 30) | **PASS** | suppression re-added and value removed; account erased; privacy request reconciled; company 404 again; account suspended again; revoked token 401; pre-restore access token 401; a second apply changed nothing |
| 16 | Re-applying only the ledger written together with the backup | **No effect on 5 of 5 exposures** | it reported 0 changes: everything it contains is already in the backup. Its value is purely for deletions made between a ledger and the restore point, so how often it is written is the privacy RPO (R-071) |
| 17 | Authentication and authorization after recovery | **PASS** | registration 201, login 200, `/auth/me` 200, wallet 200, a customer on an administrator route 403, anonymous on a customer route 401, readiness 200 |
| 18 | Background jobs on first start of a restored database | **FAIL, fixed** | schedulers and workers started by themselves (webhook dispatcher every 5 s, credit rollover 10 s after boot, queue workers, export, retention, token clean-up), before any reconciliation. `RESTORE_MODE=true` now starts the API without any of them (verified: no job started, the credit rollover wrote nothing) |
| 19 | Credits and unlocks after recovery | **PASS** | wallet totals and ledger totals equal the source at backup time; a customer whose post-backup unlock was lost retried it: charged once (105 → 104, the same as the live system), the same request again charged nothing; `db:reconcile-credits` output is identical on the source and the restored copy (its FAIL for 88,650 unlock rows without a charge row comes from the synthetic seed and is the same on both) |
| 20 | Full recovery drill, stopwatch (section 8) | **PASS** | 71 s of machine time |
| 21 | Backup tampering | **See section 11** | covered by Phase 19; re-run result in section 11 |
| 22 | A due scheduled export on the restored database | **Inconclusive** | the scheduler ran its purge step but did not pick up the inserted schedule within 150 s; not pursued, because the restore-mode switch makes the question moot for the first start |

## 5. Data-integrity verification (what the check compares)

For every table: row count and an MD5 of the ordered primary keys, against a manifest captured from the source immediately before the dump. Plus: all constraints validated; every single-column foreign key has no orphan row; wallet totals, ledger totals and unlock counts; company and people status distributions; every wallet equals its parts and none is negative. **Result: all pass.** Limitation, stated plainly: the key hash proves the same rows exist, not that every column of every row is equal; changed values (a status, a balance) are covered only through the totals and distributions above and the targeted checks in rows 13 to 15. The first run of the verifier reported two failures for the status distributions; both were a bug in the comparison (object key order), the counts were equal; the verifier was corrected and the whole check rerun.

Missing, duplicated or inconsistent records found in the restore: **none**. The restore reproduced the state at backup time exactly; everything that differs from the live system at the time of the disaster is data written after the backup (section 6).

## 6. Data-loss window observed

Backup snapshot started 07:16:10Z (finished 07:16:31Z); the last transaction committed on the source before the disaster was 07:17:09Z. Five tables changed in between (`audit_logs` +3, `business_contacts` -1, `contact_suppressions` +1, `credit_transactions` +1, `lead_unlocks` +1) plus status changes in `businesses` and `users`. All were absent from the restored database. In a real incident the window is the time since the last backup (24 h for the daily dump, unless provider point-in-time recovery exists and is proven).

## 7. Security and privacy risks found, and what was done

| ID | Finding | Status |
|---|---|---|
| R-071 | A restore undoes every deletion, suppression, withdrawal and suspension made after the backup, and the deletion ledger was only written together with the dump, so it could not help (row 16). Privacy RPO equals backup frequency. | **Mitigated in code, not scheduled:** the ledger now also carries withdrawn companies and suspended accounts, and `LEDGER_ONLY=true backup.sh` writes it alone. Someone must schedule it (suggested every 15 minutes) and keep it as protected as the backups. |
| R-072 | After a restore, every session remembered by the backup comes back: tokens revoked later are valid, passwords changed later revert. | **Fixed:** `reapply --apply` revokes every refresh token and replaces every account's session identifier once per ledger; rotating the JWT secrets (a manual step) ends the access tokens that remain. |
| R-073 | The API ran all its background jobs (webhook deliveries, credit allocation, queue workers, retention) the moment a restored database was connected, before reconciliation; the runbook's "do not start the API yet" had no software behind it. | **Fixed:** `RESTORE_MODE=true`. |
| R-074 | The destructive-operation guard refuses `reapply --apply` unless a verified backup of the target database exists, and refuses remote databases. Restoring into a new database therefore needs an extra backup of the freshly restored copy first (28.8 s here), and **applying the ledger to a restored remote database is impossible with the tool**. | Open. Needs an approved change request or a deliberate guard exception for the restore case. |
| R-075 | MFA secrets and integration credentials are encrypted with a key that falls back to `JWT_ACCESS_SECRET` when `MFA_ENCRYPTION_KEY` / `INTEGRATIONS_ENCRYPTION_KEY` are empty (they are empty in `.env.production.example`, are not validated and are not mentioned in the backup document). Rotating the JWT secret after a restore, as R-072 recommends, would make every stored MFA secret and integration credential unreadable (verified with the real functions). | Open decision. Set explicit keys, keep them in the secret store with the backups' key escrow, and do not rely on the JWT secret. Documented in the guide and runbook. |
| R-076 | Payments and purchases made after the backup exist at the payment provider but not in the restored database. | Open, manual: reconcile against the provider's records for the window (no tool; not testable here). |
| R-077 | Old backups keep deleted data until they expire (known from Phase 16). The ledger keeps a restore from putting it back into service, not out of the backup files. | Accepted, documented. |
| R-078 | Search index, object storage, provider point-in-time recovery and production-scale timing were not tested. | Open. |

## 8. Measured recovery time (this machine, 249 MB, synthetic data)

| Step | Seconds |
|---|---|
| create empty database | 2.6 |
| `restore.sh` (checksum, decrypt, `pg_restore`) | 20.9 |
| `npm run db:backup` of the restored database (required by the apply guard) | 28.8 |
| ledger re-apply (`--apply`) | 6.1 |
| start the API in `RESTORE_MODE` | 2.1 |
| verification (counts, hashes, foreign keys, statuses) | 7.2 |
| restart without `RESTORE_MODE`, liveness 200 | 3.7 |
| **total machine time** | **71.3** |

Plus: backup 21 s; in-place restore 24 s; reconnection after a database outage 46 to 150 ms. **These are tested numbers for this dataset and this machine only.** They exclude the time to decide, to provision a database, to fetch the backup, to rotate secrets, to reconcile payments and to re-index search. They cannot be scaled to production, so **no RTO is claimed**. The proposed targets (RTO 4 h; RPO 15 min with provider PITR or 24 h with the daily dump) remain unapproved; the observed exposure supports treating the real RPO as the backup interval, and the real privacy RPO as the ledger interval.

## 9. Remaining manual recovery steps (updated in `BACKUP_AND_DISASTER_RECOVERY.md` section 5)

Declare the incident; provision an empty database; `restore.sh`; confirm migrations; **start nothing**; take the guard's verified backup of the restored copy (local databases only); re-apply the newest ledger (dry run, then apply); rotate the JWT secrets (and only then, if explicit encryption keys are set); start the API with `RESTORE_MODE=true`; run the verification and `db:reconcile-credits`; reconcile payments against the provider for the data-loss window; restart without `RESTORE_MODE`; re-index search; check uploads; lift the freeze and record the timeline.

## 10. Prioritized recommendations

1. **Schedule the ledger** (`LEDGER_ONLY=true`, every 15 minutes, to the protected store) and decide the restore-case exception for the apply guard (R-071, R-074). Owner action.
2. **Set explicit `MFA_ENCRYPTION_KEY` and `INTEGRATIONS_ENCRYPTION_KEY`** in production, escrow them separately from the backups, and consider making them required at start-up (R-075). Owner decision.
3. **Run one production-size drill** on staging with a real backup, provider PITR if used, and a stopwatch; then approve RTO/RPO (R-078).
4. **Write the payment reconciliation procedure** for the data-loss window (R-076).
5. Rehearse the search re-index and object-storage restore.
6. Keep `RESTORE_MODE` in the runbook's first-start step and alert if it is still set a day after a restore.

## 11. Evidence and reproducible commands (no secrets)

Run from `apps/api` with a scratch database URL in `DATABASE_URL`/`BACKUP_DATABASE_URL` (local only; names `orion_scratch_*`):

```bash
BACKUP_DATABASE_URL=$SRC BACKUP_DIR=$DIR BACKUP_PASSPHRASE_FILE=$PASS bash ops/backup/backup.sh
LEDGER_ONLY=true BACKUP_DATABASE_URL=$SRC BACKUP_DIR=$DIR BACKUP_PASSPHRASE_FILE=$PASS bash ops/backup/backup.sh
BACKUP_PASSPHRASE_FILE=$PASS bash ops/backup/restore.sh $DIR/daily/<file>.dump.gpg $RESTORED
ORION_BACKUP_DIR=$LOCAL DATABASE_URL=$RESTORED npm run db:backup
CONFIRM_DESTRUCTIVE_DATABASE=<restored name> DATABASE_URL=$RESTORED npm run db:ledger -- reapply --in <ledger.json> --apply
RESTORE_MODE=true node dist/main.js
DATABASE_URL=$RESTORED npm run db:reconcile-credits
```

The verification, fixture and measurement scripts were kept outside the repository (scratch area); their logic is described in sections 3 to 8. Automated regression tests added to the repository: `restore-mode.spec.ts`, `restore-recovery.integration.spec.ts`, `migration-recovery.spec.ts`, additions to `all-exceptions.filter.spec.ts`.

## Regression results (working tree, 2026-10-13; commands from `apps/api`)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `node ops/security/scan-secrets.mjs` (root) / `npm run test:inventory -- --check` | 0 findings / passed |
| `npm run test:unit` | 46 suites, 861 tests passed |
| `npm run test:integration` | 43 of 44 suites passed, 1 skipped; 978 passed, 13 skipped, 0 failed (includes `restore-recovery`, `migration-recovery`) |
| `npm run test:security` / `npm run test:perf` | 9 passed / 3 passed |
| `npm run test:e2e` with `CONCURRENCY_DATABASE_URL` set to the empty scratch database `orion_scratch_phase30c` (real-PostgreSQL suite included) | 42 of 43 suites passed; 666 passed, 3 todo, **1 failed**: `health-probes` "reports every dependency ..." (timing-sensitive; known). Re-run alone: first batch 19 of 20, 20 of 20, 20 of 20; second batch 20 of 20 three times. It failed once in six solo runs this phase; not changed |
| Row 21 of section 4, backup tampering | **PASS**: one byte of the encrypted dump was altered; `restore.sh` printed `FAILED`, exited 1 and restored nothing (0 tables in the target) |

Not run: Playwright, lint, Docker, CI, the web app tests (no web code changed), any production or Neon database.

## 12. Limitations and outstanding risks

One machine, one 249 MB synthetic dataset, one operator; the load generator, the API and PostgreSQL competed for the same CPU. No provider-managed database, no point-in-time recovery, no remote object storage, no search index, no payment provider and no browser were involved. The key-hash comparison does not prove column-level equality. Scheduled-export behaviour on a restored database was inconclusive. The two scratch databases and the temporary verification database created by `db:backup` remain on the local server and can be dropped. Recovery readiness is therefore **partially verified**, and a production release still depends on items 1 to 3 in section 10.
