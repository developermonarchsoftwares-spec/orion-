# Migration compatibility & deployment runbook (Phase 6.21)

Nothing in this repository has been run against the real database. The applied history of that database is unknown; this document lists
what to check, read-only, before the first migration run, and what each outcome means.

## 1. How Drizzle decides what to apply

`drizzle-orm` (`pg-core/dialect.js`, `migrator.js`) does exactly this:

1. Read `meta/_journal.json`; for every entry read `<tag>.sql`, split it on `--> statement-breakpoint`, and compute `sha256(file text)`.
2. `CREATE SCHEMA IF NOT EXISTS drizzle` and `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id, hash, created_at bigint)`.
3. `SELECT ... ORDER BY created_at DESC LIMIT 1` → **only the single newest `created_at`** is considered.
4. In **one transaction**, for each journal entry **in journal order**: run it if `newest.created_at < entry.when`, then insert `(hash, when)`.

Consequences, all verified by `src/database/__tests__/migration-audit.spec.ts`:

- The tag / file name / `idx` are irrelevant to the decision; only `when` matters. Hashes are **never compared** (an edited, already-applied file goes unnoticed).
- An entry whose `when` is **not newer than the newest applied** one is skipped forever, even if it was never applied. This is what happens to the inserted
  `0003_seed_packages` (`when` 1789100000000) on any database that already recorded 0004 or later.
- Future-dated `when` values (0006..0016 up to 1796000000000, 0017 = 1796500000000) are legitimate for Drizzle but mean any new migration must have a larger `when`.
  `drizzle-kit generate` stamps the clock, which is smaller, so its output would be skipped on databases that already applied 0016/0017. Edit the new journal entry's `when`
  to exceed the maximum; `migrations-fresh-db.spec.ts` fails if timestamps stop increasing.
- The whole run is one transaction: a failing statement rolls back every migration of that run (tested), so a failed run leaves the database as it was.
- A database with tables but an empty `__drizzle_migrations` (schema created by `drizzle-kit push`) would try `CREATE TABLE` on existing tables and fail (nothing changes).

## 2. Compatibility matrix (disposable PGlite databases)

| Starting point | Audit verdict | `npm run drizzle:migrate` does | Manual work |
|---|---|---|---|
| Applied through 0002 | SAFE | applies 0003 (seed, once), 0004–0017 | none |
| Applied through 0016, no 0003/0017 | SAFE (+ note: 0003 skipped for good) | applies only 0017; packages are **not** seeded | seed packages deliberately (§4) |
| Fully applied | SAFE | nothing | none |
| `queue_jobs`/`admin_otps` already exist, identical | SAFE | 0017 no-op, rows kept | none |
| Exist, columns right, indexes missing | SAFE | 0017 adds only the indexes | none |
| Exist, wrong column type / nullable / extra NOT NULL w/o default / lost default / no PK | **BLOCKED** | 0017 **succeeds silently** and leaves the table wrong | repair by hand *before* (§5) |
| Exist, a column missing | **BLOCKED** | 0017 **fails** (index on missing column), whole run rolled back | add column by hand |
| Index of the expected name on other columns | **BLOCKED** | `IF NOT EXISTS` keeps the wrong index | drop/recreate by hand |
| Tables exist, no migration history | **BLOCKED** | fails on `CREATE TABLE`, rolled back | decide how to baseline |
| History rows that match no journal entry, or newer than the journal | **BLOCKED** | unpredictable skip decision | establish the real history |
| Existing package already holds one of 0003's fixed ids under another slug | not visible to the audit | 0003 fails, run rolled back (only DBs still at ≤0002) | run the §3 query, rename/remove first |

## 3. Preflight (read-only)

`npm run db:audit` (from `apps/api`, with `DATABASE_URL` pointing at the **target**):

- one READ ONLY transaction, SELECTs on `pg_catalog` / `information_schema` / `drizzle.__drizzle_migrations`; no application row is read;
  the connection string is never printed;
- exit code `0` safe, `2` review required, `3` blocked, `1` could not audit; the JSON report holds only migration tags/timestamps, table/column/index names, types, counts.

```bash
npm run db:audit
```

Extra read-only check for databases still at or before 0002 (the only ones that will run 0003):

```sql
SELECT id, slug FROM credit_packages
 WHERE id IN ('5b11b41d-4451-4ea3-9ace-be33b7a18ad4','30ad3ee3-f861-4a59-b374-5af11f820194','cdcc091d-282c-4bd6-93d2-2f5aa1955110',
              'b8dfcad5-f348-40b7-801d-38124b909425','c31b8ca8-a484-46cb-b30d-675acfaefdb8')
   AND slug NOT IN ('free','starter','growth','agency','enterprise');
```
Expected: zero rows.

Read-only checks that cannot be answered from this repository and that decide production compatibility:
1. `SELECT created_at, left(hash, 8) FROM drizzle.__drizzle_migrations ORDER BY created_at;` — do the timestamps match the journal's `when` values (the audit reports unknown rows)?
2. Do `queue_jobs` and `admin_otps` exist, and with which columns (the audit's `hardenedTables`)?
3. `SELECT slug, price_inr, credits, is_active FROM credit_packages;` — which package rows exist and are they the intended ones?

## 4. Package seeding on an existing installation

- **Migration 0003** (`INSERT ... ON CONFLICT (slug|key) DO NOTHING`): adds missing plans/settings only; **never updates** an existing row (tested: an edited price/name/inactive flag survives).
  It runs only on databases whose newest applied migration is older than 0003 (≤ 0002). The fixed ids are not covered by `ON CONFLICT (slug)`: see the matrix.
- **`npm run drizzle:seed`** (`src/database/seed.ts`) is different and **overwrites**: for each of the five slugs it runs an `UPDATE` setting name, description, price, credits,
  user limit, billing type, popular flag, badge, features, active flag and sort order to the canonical values (pricing settings are insert-if-missing only). On a live installation
  it **resets any admin-changed pricing**. Do not run it against an existing database without reviewing the diff. Its feature text also differs slightly from 0003 ("&" vs "and").
  It also seeds taxonomies and the Super Admin (no built-in password; `ADMIN_SEED_PASSWORD` optional), and talks to Typesense if configured.

## 5. Manual repair of mismatched `queue_jobs` / `admin_otps` (only if the audit says BLOCKED)

Both tables hold transient data (jobs, OTP codes). The least risky repair is usually, in a maintenance window with a backup: if the contents are disposable, rename the old table
(`ALTER TABLE queue_jobs RENAME TO queue_jobs_old_<date>`), then run the migration (0017 recreates it); otherwise write targeted `ALTER TABLE` statements from the audit's drift list.
Do not run either without a human decision; they are not scripted here on purpose.

## 6. Deployment checklist

1. Backup / snapshot of the target (verify it restores); note the Postgres version.
2. Maintenance window; stop writers (API instances, queue workers) so the queue and OTP tables are quiescent.
3. `npm run db:audit` against the target → must be exit 0 (or exit 2 with each finding understood and signed off). Exit 3 stops the deployment.
4. Run the §3 SQL checks; confirm package rows.
5. Confirm the artifact is the same commit that passed `migrations-fresh-db.spec.ts` and `migration-audit.spec.ts`.
6. `MIGRATION_CONFIRM_HOST=<target host> npm run drizzle:migrate` (the runner uses the direct, non-pooler endpoint and, for any non-local database, refuses to start unless that variable names exactly the host it is about to migrate; it prints host and database name, never credentials). Do **not** run `drizzle:seed` as part of the migration.
7. Post-migration: `npm run db:audit` → exit 0, `willApply` empty; `SELECT count(*) FROM drizzle.__drizzle_migrations` equals the number of applied entries plus any skipped ones;
   `queue_jobs` / `admin_otps` report COMPATIBLE; start one API instance and check `/health`, an admin OTP round trip, and enqueue/complete one job.
8. Start the remaining instances.

## 7. Recovery limitations

- A failed run rolls back completely (single transaction), so the usual failure needs no recovery. A run that **succeeded** but produced wrong results (e.g. 0017 kept a mismatched table) is only fixed by hand.
- There are no down-migrations. After a successful run the only way back is the backup (losing writes made since) or hand-written reversal; 0017 can be undone by dropping the two tables
  (transient data) and deleting its `__drizzle_migrations` row, but doing so is a manual decision.
- DDL in PostgreSQL is transactional, so the above holds for these migrations; any future migration using `CREATE INDEX CONCURRENTLY` or similar would not roll back.
- The audit cannot see row-level problems (e.g. the fixed package ids) or anything outside the catalogue it reads.

## 8. Preflight result for the Neon database configured in `apps/api/.env` (Phase 6.22, read-only, 2026-10-01)

Nothing was written. `db:audit` exit code **0** (SAFE_TO_MIGRATE); the documented SQL checks ran in a READ ONLY transaction (`transaction_read_only = on`).

- Migration history: 3 rows, `created_at` equal to the journal's 0000, 0001 and 0002; hashes match the files; no unknown rows; newest applied = 0002. Pending: 0003–0017 (15 entries).
- `queue_jobs` and `admin_otps` already exist, are COMPATIBLE with the schema (columns, types, defaults, primary keys, indexes) and are empty. 0017 will be a no-op for them.
- 15 people-related tables (0004–0016) do not exist yet; `saved_leads.person_id`, `import_batches.people_summary` and `import_records.people_result` are missing: all are created by the pending migrations.
- Drift the migrations will **not** fix: `import_batches.file_key` is nullable in the database but NOT NULL in the schema/0000 (10 of 19 rows are NULL). A later `drizzle-kit push` would fail on it.
- Packages: all five plans exist with the exact ids and canonical values of 0003 (free 0/5, starter 99/100, growth 299/350, agency 999/1500, enterprise custom); all active; no fixed-id conflict. The three pricing settings exist. 0003 is therefore a pure no-op there.
- Server: PostgreSQL 18.

### Package seeding plan (preserve admin-edited prices, names, active flags)
1. For this database: do nothing beyond the migration. 0003 inserts only missing plans (`ON CONFLICT (slug) DO NOTHING`) and the fixed ids already match. Never run `drizzle:seed`.
2. For any other / future installation: rely on 0003 for the first seed and on the same insert-if-missing semantics afterwards. If a script is wanted, use `INSERT ... ON CONFLICT (slug) DO NOTHING`
   for packages and `ON CONFLICT (key) DO NOTHING` for settings (what 0003 does), and expose any overwrite only behind an explicit `--reset-packages` flag that prints the diff first.
   `seed.ts` currently overwrites; changing it is a code change that needs approval and was not made.
3. After the migration, re-run the package-state query and compare with the snapshot above; any difference means something other than 0003 wrote to the table.

### Remaining uncertainty
Pending migrations 0004–0016 were only ever executed on empty in-memory databases. 0008, 0009 and 0011 contain data `INSERT`s that read from the new (empty) people tables, so they are expected to be no-ops, but this was not rehearsed on a copy of the real data. Rehearse on a Neon branch/restore of the target before the real run.

## 9. Rehearsal procedure for migrations 0003–0017 (Phase 6.23)

Status: **prepared, not executed.** Every step marked (REMOTE WRITE) creates or changes something on Neon and needs explicit approval first. Nothing in this repository
assumes the database configured in `apps/api/.env` is production or development; the operator must state which it is (decision D1).

### 9.1 Roles and safeguards
- Never export or paste a connection string into a chat, ticket or log. Pass it through the shell environment only: `export DATABASE_URL=...` (dotenv never overrides an already exported variable).
- `db:audit` and `db:rehearsal snapshot` are read-only. `drizzle:migrate` is the only writing command and is guarded by `MIGRATION_CONFIRM_HOST`.
- The rehearsal target is a **copy**, never the source: its host must differ from the source's host. The host name is not a secret and may be compared; the full URL is.

### 9.2 Steps
1. (REMOTE WRITE, approval) Create a Neon branch from the source database's current state (or restore the latest backup into a new project). A branch gets its own endpoint and connection string; record only the branch name and host.
   Confirm the branch is detached from any application: no API instance, worker or cron points at it.
2. Export the branch's connection string in your shell (`DATABASE_URL`), pointing at the **branch**. Check the host differs from the source.
3. Evidence before: `npm run db:audit` (expect exit 0) and `npm run db:rehearsal -- snapshot > before.json` (counts, history, package rows, NULL `file_key` count only).
4. (REMOTE WRITE on the branch only) `MIGRATION_CONFIRM_HOST=<branch host> npm run drizzle:migrate`. Time it. Expect "All database migrations applied". A failure rolls back entirely: record the error line, change nothing, report.
5. Evidence after: `npm run db:rehearsal -- snapshot > after.json`; `npm run db:rehearsal -- compare before.json after.json` must exit 0 (existing table row counts, earlier history rows, package rows, pricing keys and NULL `file_key` count unchanged).
   `npm run db:audit` must show `willApply: []`, no missing tables, `queue_jobs` / `admin_otps` COMPATIBLE; the only remaining drift allowed is `import_batches.file_key` (exit 2 for exactly that reason, see 9.3).
6. Application smoke tests against the **branch** (a staging API instance with the branch URL; use staging secrets, not production ones):
   - `/health` OK and no startup error about missing tables;
   - admin OTP round trip: request a code for a provisioned admin, a row appears in `admin_otps`, verify succeeds, the row is consumed;
   - enqueue and complete one job (any import preview): the `queue_jobs` row reaches COMPLETED;
   - the packages endpoint returns the five plans with the same prices as in `before.json`;
   - search / discover returns results; an import preview plus People ingestion on a tiny CSV works (writes to the branch only);
   - a customer unlock decrements credits exactly once;
   - People review / metrics admin endpoints respond (the new tables are readable).
7. Rollback drill on the branch: confirm you can discard it (delete the branch) and that the source is untouched (`db:audit` against the source still reports 0002 + pending, unchanged).
8. Record duration, lock waits, failed statements and deviations. Delete the branch only after the report is signed off.

The same sequence is rehearsed automatically on a production-shaped disposable database by `src/database/__tests__/migration-rehearsal.spec.ts` (history at 0002, out-of-band tables, edited packages, NULL `file_key` rows).

### 9.3 `import_batches.file_key` (nullable in the database, NOT NULL in the schema; 10 of 19 rows NULL)
Evidence from the code: only two writers exist (`admin-import.service.ts` and the gateway's native import in `route.ts`) and **both always supply** `file_key`; **nothing reads it** (no
SELECT of the column in the API, gateway or frontend). The NULL rows therefore come from older code, a manual insert or a constraint relaxed out of band, and they are harmless to the running application today. The pending migrations do not touch the column.

| Option | What it does | Risk | Verdict |
|---|---|---|---|
| A. Leave as is, record as accepted drift | Nothing changes | Schema and database disagree; `drizzle-kit push` would fail; types claim a string that may be null | Acceptable short term |
| B. Relax the schema (`file_key` nullable + a `DROP NOT NULL` migration) | Makes the schema match reality | Legitimises missing keys for new rows; changes the contract; needs a migration and snapshot | Not recommended |
| C. Backfill then enforce (new migration 0018, separate approval, after 0003–0017) | `UPDATE import_batches SET file_key = 'legacy/unknown/' \|\| id WHERE file_key IS NULL;` then `ALTER COLUMN file_key SET NOT NULL` (both idempotent; no-ops on fresh installs) | Writes 10 rows; brief lock on a 19-row table; the sentinel is not a storage object (nothing reads it); unknown external consumers | **Recommended**, rehearsed first |
| D. Delete the legacy batches | Removes rows | Destroys import history; other tables may reference them | Rejected |

Before choosing C, inspect the 10 rows read-only (structure only): `SELECT id, status, created_at, source_id IS NULL AS no_source, created_by_id IS NULL AS no_creator FROM import_batches WHERE file_key IS NULL ORDER BY created_at;` to see when they were created and whether another system wrote them.
0018 must carry a `when` greater than 1796500000000. It is **not created** in this phase.

### 9.4 Backup requirements (before the real run)
- A restorable copy taken **immediately** before the run, after writers are stopped: a Neon branch / point-in-time restore point (confirm your plan's history window covers the run) **and** a logical dump (`pg_dump`, version at least the server's major, 18, custom format) stored encrypted outside the project.
- Restore verification (on a throw-away database or branch, never on the source): restore the dump, then `db:audit` shows the same history and tables as the source, and `db:rehearsal snapshot` of the restore equals the source snapshot taken at backup time (`compare` exit 0).
- Record the backup timestamp, how it was verified, who can restore and the expected restore time. A backup that has not been restore-tested does not count.

### 9.5 Post-migration checks on the real database (after approval and the run)
`db:audit` exit 0 or only the accepted `file_key` drift; `db:rehearsal compare` against the pre-run snapshot exit 0; migration history rows = 18; the 15 People tables present with their indexes (the audit reports none missing);
`credit_packages` identical to before; `queue_jobs` and `admin_otps` COMPATIBLE and writable; the smoke tests of 9.2 step 6 against the real API; error rate and logs watched for 30 minutes.

### 9.6 Compatibility and rollback limits
- Migration files and `when` values are unchanged; 0003 is a no-op on the target (packages exist with matching ids); 0017 is a no-op for the existing tables.
- Pending migrations are additive (new tables, nullable columns, indexes, inserts into new tables); no drop, rename or type change. The code that needs them (People features) must not be deployed before the migration, and the migration is safe to run before the code (old code ignores new tables and columns).
- No down-migrations. A successful run can only be reverted from the backup (losing writes made after it) or by hand-written reversal (drop the new tables and columns, delete history rows 0003–0017); that is a manual, data-losing decision.
- Single transaction: a failing run leaves the database as it was. Non-concurrent `CREATE INDEX` takes brief write locks on the affected tables; with small tables this is expected to be short, which the rehearsal measures.

### 9.7 Decision points and go / no-go
| # | Decision | Owner |
|---|---|---|
| D1 | Is the configured Neon database production, staging or development? | operator |
| D2 | Approve creating the rehearsal branch / restore (REMOTE WRITE) | operator |
| D3 | `file_key`: A, B or C (C needs 0018 and its own approval) | operator |
| D4 | Maintenance window and who stops writers | operator |
| D5 | Approve the real run after a green rehearsal | operator |

**Go** for the real run only if all hold: D1 answered; the rehearsal was executed on a copy of the same data with `compare` exit 0, the audit as in step 5 and every smoke test passing; a restore-tested backup exists; `db:audit` against the real target immediately before the run reports exit 0 (or exit 2 solely for the accepted `file_key` drift) with no unknown history rows; `MIGRATION_CONFIRM_HOST` is set to the intended host; `drizzle:seed` is not part of the plan.

**No-go** on any of: audit exit 3; history differs from the rehearsed state; rehearsal not run or failed; backup unverified; a package or pricing difference after the rehearsal; the target host cannot be confirmed.

## 10. Phase 6.24 rehearsal attempt: BLOCKED before any write
- Goal: create an isolated Neon branch of the production database and rehearse 0003–0017 on it.
- Blocker: this environment has no way to create a Neon branch. There is no Neon CLI, no `NEON_API_KEY` / project id in the shell or in `apps/api/.env`, and no Neon connector. Installing a tool and authenticating would need credentials that were not provided; creating the branch from the console is a step for the operator.
- Consequently no branch exists, no migration was run anywhere, and the smoke tests could not be isolated from production (they require a staging API pointed at a branch), so they were not run.
- Read-only inspection of the production source continued (`import_batches.file_key`): see `docs/FILE_KEY_MIGRATION_PROPOSAL.md`.
- What the operator must supply to proceed: either create the branch in the Neon console (from the production branch, current head) and export its connection string as `DATABASE_URL` in the shell that runs the steps in §9.2,
  or provide a Neon API key and project id through the environment (never in chat) so the branch can be created from the command line.

## 11. Phase 6.25 setup check: still BLOCKED (no rehearsal-branch URL)
- Checked, without printing any value: no `DATABASE_URL`, `NEON_*`, `REHEARSAL_*` or `MIGRATION_*` variable exists in the Bash or PowerShell environment. The only database configuration is `apps/api/.env`, whose host is the production pooler endpoint (the same one audited in Phase 6.22). It was **not** used as a fallback.
- Consequently: no isolation check, audit or snapshot could be run against a rehearsal branch, and nothing was migrated anywhere.
- Consistency check of `docs/FILE_KEY_MIGRATION_PROPOSAL.md` against the Phase 6.24 evidence: consistent (10 NULL rows, all PENDING, zero records and dependents; `file_key` is `notNull` in the 0017 snapshot so 0018 needs no snapshot content change; no 0018 file exists).
- Exact setup needed (operator): create the branch in the Neon console from the production branch head, then in the shell that will run the steps export its connection string:
  PowerShell: `$env:DATABASE_URL = "<branch connection string>"` (paste it there, never into a chat or file); optionally `$env:REHEARSAL_BRANCH_HOST = "<branch host>"`.
- Isolation proof the next phase will require before running anything (all read-only, nothing printed except host names): the exported host differs from production's host (`ep-weathered-surf-…`); `SELECT current_database(), inet_server_addr()` plus the Neon endpoint host identify a different compute; the branch is detached from every application; the `drizzle.__drizzle_migrations` rows and table counts equal the production snapshot taken at branch time (a branch is a copy, so they must match exactly). If the host equals production's, or any doubt remains, stop.

## 12. Phase 6.27 staging smoke tests on the migrated rehearsal branch

Rehearsal migration result (reported by the operator): `compare` ok, 15 migrations recorded, 15 tables added; final audit 18 history rows, 69 public tables, no missing tables, no unknown rows or hash mismatches, one known drift (`import_batches.file_key`).

### 12.1 Status: tooling ready, **suite not yet run** (blocked)
The rehearsal `DATABASE_URL` exists only in the operator's own PowerShell window and is not visible to the assistant's tool processes (checked: not in the process environment, not at Windows user scope). `apps/api/.env` is production and was not used. Nothing was run against any database in this phase.

### 12.2 How the API is run against the branch (existing setup, adapted)
- The Nest API takes its database from `DATABASE_URL` through `ConfigModule`, which also reads `apps/api/.env` from the working directory. That file holds production-grade values for object storage, Resend, OAuth and Typesense, so a plain `npm run start` with the branch URL would still carry those: **not acceptable for smoke tests**.
- The existing E2E suites (`test/*.e2e-spec.ts`) boot the real `AppModule` in-process with disposable identities, mocked OAuth providers and test-only payment secrets, and exercise authentication, admin OTP and RBAC, credits and payments (signature verification only), discovery, unlock, saved leads, admin import and People import. They normally use an in-memory database.
- New staging mode (same specs, real pool on the branch): `npm run test:e2e:staging` (`test/jest-staging.json` + `test/setup-staging-env.ts`).
  - The target is taken **only** from `STAGING_DATABASE_URL` (never `DATABASE_URL`, never `.env`), `STAGING_CONFIRM_HOST` must equal its host, and the host must not be a production host (the host of `apps/api/.env`'s `DATABASE_URL` is read only to be refused; extra hosts via `STAGING_FORBIDDEN_HOSTS`). Without a known production host to compare against, it refuses.
  - Before any request the helper proves the connection positively: the database must record exactly as many migrations as the journal (18). Production currently records 3, so a production connection fails here. Output: `[staging] target host <host>, database <name>, 18 migrations recorded (isolation proof passed)`.
  - Side effects are switched off with explicit empty values: `SEARCH_PROVIDER=postgres`, `STORAGE_PROVIDER=local`, no storage keys, no Resend, no OAuth credentials, test-only Razorpay secrets (no real provider is reachable). The Nest API sends no e-mail. NODE_ENV=test (fixed admin OTP code and `previewOtp` exist only for such environments).
  - Verified without any database: with no variables, or with the production host and fake credentials, the command refuses before connecting (`src/database/__tests__/staging-guard.spec.ts`, 7 tests, plus both refusals run by hand).
- What the suites write: disposable test users (`@test`-style emails, `*@monarchsoftwares.com` test admins), their wallets, unlocks, saved items, audit rows, test businesses and import batches **on the branch only**. They delete only the test emails they create. The branch holds a copy of production customer data: the suites do not read or modify other users, but treat the branch as sensitive and delete it after sign-off.

### 12.3 Commands (operator's PowerShell, same window that holds the branch URL)
```powershell
cd D:\ownus\apps\api
$h = ([Uri]$env:DATABASE_URL).Host
if ($h -like "ep-weathered-surf-aefvqpls*") { throw "STOP: production endpoint" }
$env:STAGING_DATABASE_URL = $env:DATABASE_URL
$env:STAGING_CONFIRM_HOST = $h
npm run test:e2e:staging 2>&1 | Tee-Object -FilePath staging-e2e.log
"exit: $LASTEXITCODE"
Remove-Item Env:STAGING_DATABASE_URL, Env:STAGING_CONFIRM_HOST
```
The log contains test names and the proof line (host and database name), no credentials. Failures that come from real data rather than defects (for example a test that assumes an empty table) must be analysed, not hidden.

### 12.4 Smoke coverage map
| Area | Covered by the staging E2E run | Not covered (manual, branch-only) |
|---|---|---|
| Health | `health.e2e-spec` | `/health` of a deployed staging instance |
| Auth / OTP / RBAC | `auth`, `admin-auth`, `admin-authorization`, `account-integrity`, `security-hardening` | gateway (Next.js) login and admin pages |
| Customer visibility, discovery, unlock, credits, saved leads | `lead-discovery-unlock`, `credit-wallet`, `saved-leads-searches` | export download in the UI |
| Payments | `credit-wallet` (signature verification and replay, no provider) | any real checkout (disabled by design) |
| Upload / import | `admin-import-pipeline`, `admin-people-import` | S3/R2 upload (storage is local-only here by design) |
| People review / verification | People import e2e; review, verification and metrics are covered by the PGlite integration specs | admin People review UI against branch data |

### 12.5 Go / no-go input
The rehearsal is **not yet** ready for a production go/no-go review: the migration itself is validated (compare, audit), but the application has not been exercised against the migrated schema. Required first: a green `test:e2e:staging` run (exit 0, proof line present) and the manual items above for any feature release that depends on them.

## 13. Phase 6.28 staging E2E: first run analysed and lifecycle fixed

### 13.1 What the first run (`staging-e2e.log`, 00:46–00:47) showed
- Isolation proof appeared for every suite that started: `[staging] target host ep-patient-mouse-aeklhgtl-pooler… (not the production host), database neondb, 18 migrations recorded (isolation proof passed)`.
- `saved-leads-searches.e2e-spec` PASS (41 s) and `oauth.e2e-spec` PASS (29 s). The third suite started and the run ended at `Terminate batch job (Y/N)? ^C`: **interrupted by the operator, not a failure and not proven to be a hang**. No Jest summary was printed, so no totals exist for that run and it must not be counted as a result. Suites take 30–40 s each against the remote branch (app boot plus network round trips), so the full run needs roughly 8–10 minutes: do not interrupt it.
- 37 `CreditScheduler` errors `Failed to rollover daily credits for wallet <id>: Cannot use a pool after calling end on the pool`.
- Harmless warning from `pg`: SSL mode aliases (`sslmode=require` is treated as `verify-full`); add `sslmode=verify-full` to the URL to silence it.

### 13.2 Root cause
1. `CreditScheduler.onModuleInit` started `setTimeout(..., 10000)` and **never kept its handle**; `onModuleDestroy` cleared only the hourly interval. On the fast in-memory test database a suite usually ended before the 10 s mark; on the branch suites last 30–40 s, so the timer fired while tests ran, found real wallets needing rollover (the branch is a copy of production) and was still looping over them when the suite called `app.close()`.
2. A running rollover had no stop condition between wallets, and nothing waited for it.
3. `DatabaseService` ended the pool in `onModuleDestroy`, the same phase in which the scheduler stops, so the order was not guaranteed; the test helper then ended the pool a second time and swallowed the error.
This is a genuine shutdown-ordering defect of the scheduler (it also affects a production shutdown or hot reload), not only a test problem.

### 13.3 Fix (lifecycle only; business behaviour unchanged)
- `credit.scheduler.ts`: keeps both timer handles, clears them on destroy, a `stopped` flag ends a running rollover between wallets, and destroy awaits the wallet in progress.
- `database.service.ts`: the pool is ended in `onApplicationShutdown` (Nest runs it after every module's `onModuleDestroy`) and only once.
- `test-app.helper.ts`: `close()` is idempotent and no longer ends the pool a second time; it closes only the in-memory database it owns. In staging mode the daily-rollover worker is replaced by a no-op so the suites never modify wallets of real users in the branch copy.
- Regression tests: `credit-scheduler-lifecycle.spec.ts` (timer cleared; rollover stops between wallets and destroy waits for the in-flight wallet; no work after destroy; the pool ends once and only after a slow `onModuleDestroy`).
- Nothing was skipped or weakened; the staging target guard is unchanged.

### 13.4 Status
Regression: API unit/integration 40 suites / 1004 tests, in-memory E2E 12 suites / 116 tests (no pool errors), `tsc` and eslint clean. **The complete staging run is still to be repeated** by the operator (the branch URL is not visible to the assistant) with the command of §12.3, using `cmd /c "... > staging-e2e.log 2>&1"` so Jest's output is captured, and without interrupting it.

## 14. Phase 6.30: `file_key` investigation result (supersedes §9.3 and the Phase 6.24 sentinel idea)
Staging E2E on the migrated rehearsal branch passed (12 suites, 116 tests, exit 0). Read-only inspection of production (READ ONLY transactions, aggregates only) shows the 10 NULL `file_key` rows are **not stubs**: they belong to an R2 upload pipeline outside this repository, which wrote `r2_object_key`, `r2_uri` and `sha256_checksum` for them (production `import_batches` has 10 columns the repository schema does not define). The `legacy/unkeyed/<id>` sentinel is therefore rejected; the true location is `r2_object_key` (5 newer rows of the same pipeline have `file_key = r2_object_key`).
Recommended: a guarded, data-only migration 0018 copying `r2_object_key` into `file_key` (no DDL, reversible by recorded ids), keep the column nullable, and decide NOT NULL only after the pipeline's owner confirms it always sets `file_key`. Details, validation queries, rollback, risks and the approval gates are in `docs/FILE_KEY_MIGRATION_PROPOSAL.md`. Migration 0018 does not exist yet and nothing was written.
`db:audit` now lists database columns the schema does not define as informational notes (verdict unchanged).

## 15. Phase 6.30b: the external writer and a new production blocker
Identified (high confidence): the `import_batches` R2 columns and 20 other tables/columns in production belong to a **second application sharing the same Neon database**, the "Orion Data Pipeline" (separate git repository on the operator's machine, own migration table `schema_migrations`, `AUTO_MIGRATE` on by default). Full evidence in `docs/FILE_KEY_MIGRATION_PROPOSAL.md` §10.
Effects on this runbook:
1. **Go/no-go: NO-GO for the production migration until table ownership is settled.** Both applications define `people` and `person_contacts` with different columns, both via `CREATE TABLE IF NOT EXISTS`; production has neither yet. Whoever runs first wins silently. The rehearsal on the branch cannot detect this (the branch is a copy of production, which lacks the tables, and this repository's migrations ran first).
2. Add to the preflight (§3, §9): the pipeline must be stopped or `AUTO_MIGRATE=0` during the window; compare `schema_migrations` against that project's current migration directory (production recorded an older `013`); check the pipeline's tables (`people`, `person_contacts`, `person_*`, `company_person_relationships`) against this repository's pending ones for name clashes (the `db:audit` notes now list foreign tables/columns informationally; table-name clashes need a manual comparison).
3. `file_key`: the pipeline's code never writes `file_key`, so NOT NULL enforcement is unsafe and 0018 stays uncreated; the backfill alone is not durable.
4. This repository's migrations would also need to coexist with the pipeline's `schema_migrations`-based runner (different journals, same schema); an ownership decision (one system owns each table, or distinct names/schemas) is required first.
