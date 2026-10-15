# Local database protection (Step 2A)

**Date:** 2026-10-09 · **Scope:** protect the existing local PostgreSQL database `orion_db` before Neon is removed. Nothing here connects to Neon, migrates data, drops or truncates anything in `orion_db`, changes production environment variables, deploys, commits or pushes.

## 1. Backup (verified)

| Item | Value |
|---|---|
| Location (outside the repository, on the `C:` drive; the project is on `D:`) | `C:\Users\kathir\orion-db-backups\orion_db_20261009T064531\` |
| Files | `orion_db.dump` (custom format, 5,006,462 bytes), `manifest.json` (counts, checksum, verification record), `globals_no_passwords.sql` (role names only, no password hashes) |
| Source | `localhost:5432`, database `orion_db`, PostgreSQL 18.3 |
| Method | `pg_dump` custom format, **snapshot-consistent**: the row counts and the dump share one exported snapshot, so they describe identical data even while the application is running |
| Checksum (SHA-256) | `64400a62…06ac80` (full value in `manifest.json`) |
| A second, independent backup made by the new `npm run db:backup` tool | `C:\Users\kathir\orion-db-backups\orion_db_20261009T065335\`, same size and counts, also verified |

**Restore verification (both backups): PASSED**

1. File checksum matches the manifest.
2. `pg_restore --list` reads the archive (709 entries).
3. Restored with `--exit-on-error` into a **new** temporary database (never into `orion_db`): `orion_db_restore_verify_20261009t064531` (first backup) and `orion_db_restore_verify_20261009t065335` (second).
4. Same 86 tables; **every table's row count equals the snapshot** (1,754 rows in total).
5. Schema fingerprint equals the source: 1,090 columns, 377 indexes, 933 constraints, 1 sequence.
6. Migration journal restored: 24 applied migrations.

The two temporary verification databases were **kept** (nothing was dropped). Remove them whenever you like (they are ordinary databases on your server):

```sql
DROP DATABASE orion_db_restore_verify_20261009t064531;
DROP DATABASE orion_db_restore_verify_20261009t065335;
```

**To restore into a new database** (never restore over `orion_db` without a fresh backup first):

```bash
createdb -h localhost -U postgres orion_db_restored
pg_restore -h localhost -U postgres --no-owner -d orion_db_restored "C:/Users/kathir/orion-db-backups/orion_db_20261009T064531/orion_db.dump"
```

## 2. Row-count snapshot (taken at the moment of the first backup)

86 tables, 1,754 rows. Non-empty tables (22):

| Table | Rows |
|---|---|
| credit_transactions | 1047 |
| execution_logs | 119 |
| deleted_leads | 97 |
| audit_logs | 83 |
| users | 63 |
| business_locations | 58 |
| businesses | 58 |
| import_records | 58 |
| user_wallets | 58 |
| drizzle.__drizzle_migrations | 24 |
| business_contacts | 23 |
| schema_migrations | 16 |
| pipeline_jobs | 15 |
| industries | 8 |
| saved_searches | 6 |
| credit_packages | 5 |
| product_analytics_events | 5 |
| people_sources | 3 |
| pricing_settings | 3 |
| refresh_tokens | 3 |
| import_batches | 1 |
| lead_unlocks | 1 |

Empty tables (64): accounts, admin_otps, api_keys, auth_action_tokens, business_history, business_identifiers, business_metrics, business_refresh_history, business_scores, business_types, categories, company_people, company_people_classifications, consent_records, data_sources, dataset_versions, digital_presences, duplicate_candidates, duplicate_clusters, duplicate_records, enrichment_records, entity_conflicts, entity_relationships, export_history, export_jobs, export_schedules, import_logs, integration_deliveries, integrations, invoices, ip_rules, lead_activity_log, master_businesses, msme_categories, payment_orders, people, people_acquisition_runs, people_conflict_links, people_conflicts, people_evidence, people_ingestion_quarantine, people_observation_claims, people_observations, people_suppressions, people_verifications, person_contacts, person_unlocks, privacy_requests, publish_queue, publishing_history, queue_jobs, refunds, review_queue, saved_leads, search_sync_logs, sync_records, traffic_blocks, unlocked_leads, user_rate_overrides, user_recovery_codes, user_sessions, user_subscriptions, validation_logs, verification_reviews.

The complete machine-readable list is in each backup's `manifest.json` (`snapshot_counts`). The live database keeps changing while the application runs (the credit ledger grows, for example); the snapshot is exact for the moment of the dump.

## 3. Safeguards added

All of them are local-only checks in the project's own tooling. None of them changes data on its own.

| Safeguard | Where | What it does |
|---|---|---|
| **Database allow-list** | `apps/api/src/database/db-guard.ts` | On a local server, tooling may only connect to `orion_db` or a disposable Orion database (`orion_scratch`, `orion_test_*`, `orion_verify_*`, `orion_..._scratch`). Anything else (`auth_db`, `hrm_db`, `water_utility`, ...) is refused before a connection is opened. Extra names need an explicit `ORION_ALLOWED_LOCAL_DATABASES`. Error messages never contain credentials. |
| **Destructive scripts: dry run by default** | `scripts/clear-temporary-data.ts`, `scripts/clean-fake-data.ts` | Without `--apply` they only read and print what *would* be emptied or deleted. |
| **Destructive scripts: three gates to apply** | same | `--apply` **and** `CONFIRM_DESTRUCTIVE_DATABASE=<database name>` **and** a **verified backup of that database no older than 24 hours** (`ORION_BACKUP_MAX_AGE_HOURS` can change the limit). Local `orion_db` only; a remote database is refused outright. |
| **Schema push pre-flight** | `npm run drizzle:push` | Runs `scripts/require-safe-database.ts` first (confirmation, allowed local database, recent verified backup); `drizzle-kit push` does not start if it fails. |
| **Backup tool** | `npm run db:backup` (`scripts/backup-local-db.ts`) | Produces and verifies a backup like the one above, outside the repository (refuses a folder inside it). Keeps the temporary verification database unless `--drop-verify-db` is given. |
| **Allow-list in the other tooling** | `seed.ts`, `migrate.ts`, `audit-migrations.ts`, `rehearsal-cli.ts`, `scripts/audit-tables.ts`, `check-leads.ts`, `inspect-db.ts`, `verify-postgres-search.ts`, `backfill-import-records.ts` | Same database allow-list before connecting. Refusals now exit with a non-zero code. |
| **Scratch scripts cannot touch real data** | `ownus/scratch_target.js` and the 15 scratch writers | `SCRATCH_DATABASE_URL` must be a local **disposable** Orion database; `orion_db` and other applications' databases are refused. The 8 older writers in `scratch/` and `ownus/scratch/` call the guard first, no longer read `DATABASE_URL` from a file, and no longer disable certificate verification. |
| **Tests** | `src/database/__tests__/db-guard.spec.ts` (17 tests), `ownus/src/lib/__tests__/scratch-scripts.test.ts` (extended) | Cover the allow-list, the confirmation, the backup requirement and age limit, remote refusal, no credential in messages, the scratch rule, and that the TypeScript guard and the JavaScript helper agree. |

**How to run a destructive script deliberately (example, PowerShell):**

```powershell
cd apps/api
npm run db:backup                                          # fresh verified backup (needed within 24 h)
npx ts-node -r tsconfig-paths/register scripts/clean-fake-data.ts          # dry run: read the counts
$env:CONFIRM_DESTRUCTIVE_DATABASE = "orion_db"
npx ts-node -r tsconfig-paths/register scripts/clean-fake-data.ts --apply  # only now does it delete
```

**Dry-run results observed today (read-only, no data changed; counts before and after were identical):** `clear-temporary-data` would empty 33 tables (140 rows: 58 businesses, 58 business locations, 23 contacts, 1 unlock, ...); `clean-fake-data` would delete 61 of the 63 users and 975 credit-ledger rows, 56 wallets, 49 audit rows, 6 saved searches and 1 unlock, keeping the two protected accounts.

## 4. Can scripts reach the other databases on the server?

- **Through this repository's tooling: no.** Every script that opens a connection, and the migration and seed runners, checks the database name first. The refusals were exercised for `hrm_db`, `auth_db`, `data_db`, `water_utility`.
- **Not at the database level yet.** Orion connects as the PostgreSQL superuser `postgres`. Any code, or any other tool, that has that password can still connect to every database on the server. Closing that needs a **dedicated least-privilege role**, which is a credential change and therefore **not done** (pending your approval). Proposed (not executed; replace the placeholder with a password you generate and keep it out of the repository):

```sql
-- run as postgres
CREATE ROLE orion_app LOGIN PASSWORD :'new_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE orion_db TO orion_app;
\c orion_db
GRANT USAGE ON SCHEMA public, drizzle TO orion_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orion_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA drizzle TO orion_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orion_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app;
```

  Note: by default every role may connect to every database (`PUBLIC` has `CONNECT`); the `orion_app` role would still have **no privileges on the tables** of the other databases, so it could not read them. Revoking `CONNECT` from `PUBLIC` on the other databases would block even the connection, but that changes **other applications'** databases and was deliberately not proposed. The migrations would keep using `postgres` (or a separate migration role) because they change the schema.

## 5. Remaining risks

1. **Superuser connection** (section 4): database-level isolation depends on the dedicated-role step.
2. **The guards protect this repository's tooling only.** Any other tool (pgAdmin, psql, other projects, the external data pipeline) is not covered. The running API and web app still connect with the same role; the API's runtime pool was deliberately not given the allow-list, because tests connect to a placeholder database and a mistake there would stop the API from starting. It can be added when you approve.
3. **`drizzle:push` and `drizzle:studio`**: push is now gated; Studio can edit rows and is not gated.
4. **Migration journal timestamps** are in the future (migrations 0012 to 0023, dated up to 2027-01-09). A new migration generated with today's date would be **skipped** by Drizzle on this database. Not changed in this step; it needs a decision before the next migration is created.
5. **42 migration-folder entries are uncommitted** (migrations 0004 to 0023 are untracked in Git). They are in the backups, but not in version control.
6. **The backup is one point in time** and lives on this machine. Copy `C:\Users\kathir\orion-db-backups` to another disk or cloud storage you control. Backups contain real user data (including password hashes): protect them accordingly.
7. **The 24-hour rule is a speed bump, not a lock.** A person with the password can bypass the tooling entirely.
8. **Two temporary verification databases** now exist on your server (section 1).
9. **Nothing in this step changes Neon, Vercel or production.** The Vercel production site still depends on whatever its environment points to; that is the next steps' subject.

## 6. Files changed in this step

New: `apps/api/src/database/db-guard.ts`, `apps/api/src/database/__tests__/db-guard.spec.ts`, `apps/api/scripts/backup-local-db.ts`, `apps/api/scripts/require-safe-database.ts`, this document.
Modified: `apps/api/scripts/clear-temporary-data.ts`, `clean-fake-data.ts`, `audit-tables.ts`, `check-leads.ts`, `inspect-db.ts`, `verify-postgres-search.ts`, `backfill-import-records.ts`; `apps/api/src/database/seed.ts`, `migrate.ts`, `audit-migrations.ts`, `rehearsal-cli.ts`; `apps/api/package.json` (scripts `db:backup`, `drizzle:push`); `ownus/scratch_target.js`; `ownus/src/lib/__tests__/scratch-scripts.test.ts`; `scratch/backfill_locations.js`, `scratch/sync_user_unlocks.js`, `scratch/test_e2e_customer_filters.js`, `scratch/test_unlocked_export_query.js`, `ownus/scratch/test_account_settings_persistence.js`, `test_google_auth_email_matching.js`, `test_insert_location.js`, `test_production_login.js`.
Outside the repository: the two backup folders under `C:\Users\kathir\orion-db-backups\` and two temporary databases on the local server.
