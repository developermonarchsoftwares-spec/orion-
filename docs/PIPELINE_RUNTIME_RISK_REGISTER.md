# Runtime risk register: Orion and Orion Data Pipeline (static review)

**Status: PROPOSED, static review only.** Date: 2026-10-02 (Stage 2). Nothing here was executed: no database was contacted, no SQL ran, no server, worker, watcher or migration was started. Findings describe what the code does if run; they are not statements about what is deployed or running today.

## 0. How to read this register
- **Pipeline repo:** `D:\datas storing\datas storing` (Python, psycopg, own migration runner), HEAD `518c68f` (2026-10-01).
- **Orion repo:** `D:\ownus` (NestJS + Drizzle API in `apps/api`; Next.js gateway in `ownus/`), HEAD `fe7307f` (2026-09-24).
- **Line numbers refer to the current working tree.** Both repositories contain uncommitted work, so the working tree is **not** a reproducible baseline. Each finding says whether the cited behavior also exists in the **committed** code (HEAD).
  - Pipeline: 27 entries: 15 modified tracked files (including `server.py`, `python_pipeline/migrate.py`, `docker-compose.yml`, `python_pipeline/people/admin_api.py`, `python_pipeline/storage.py`), **1 staged deletion** (`scripts/test_migration_fresh.py`) and 11 untracked files (including **`run.bat`, `setup.bat`** and `scripts/run_fresh_migration_check.py`).
  - Orion: 170 changed or untracked entries; migrations 0004–0017 and their snapshots are untracked.
- **Evidence labels:** `WT` verified in the working tree; `HEAD` verified in committed history; `HIST` historical observation from earlier audits (not current); `INF` inference; `RUNTIME?` cannot be settled without verifying the deployed runtime or the database.
- **Severity:** Critical, High, Medium, Low (by potential harm to data integrity, continuity and customers if the path is reachable).
- **No approvals are granted here.** "Approval required" names who must approve a change before it is implemented.
- Do not read any finding as permission to fix it.

## 1. Summary table
| ID | Sev | Finding | Repo | WT | HEAD | Needs runtime verification |
|---|---|---|---|---|---|---|
| RR-01 | High | Migrations run automatically at server start, default on | Pipeline | Yes | **No (new, uncommitted)** | Yes |
| RR-02 | High | A failed auto-migration only warns; server and worker still start | Pipeline | Yes | No | Yes |
| RR-03 | High | Runner has no lock; replicas can race; filename-only history | Pipeline | Yes | Yes | Yes |
| RR-04 | High | Destructive `DROP VIEW … CASCADE` in five migrations | Pipeline | Yes | Yes | Yes |
| RR-05 | High | `people` / `person_contacts` collision with Orion's migrations | Both | Yes | Yes | Yes |
| RR-06 | High | Embedded worker always starts; no disable switch | Pipeline | Yes | Yes | Yes |
| RR-07 | Medium-High | Competing workers and stale-job recovery can re-run a live job | Pipeline | Yes | Yes | Yes |
| RR-08 | Medium | Compose sets worker tuning variables the code never reads | Pipeline | Yes | Yes | No |
| RR-09 | Medium-High | No graceful shutdown; in-flight jobs are abandoned | Pipeline | Yes | Yes | Yes |
| RR-10 | Medium | Connection per call, no pool, no timeouts; localhost default URL | Pipeline | Yes | Yes | Yes |
| RR-11 | High | Mutating HTTP endpoints without authentication | Pipeline | Yes | Yes | Yes (exposure) |
| RR-12 | High | Self-declared role headers and literal bearer "tokens" grant roles | Pipeline | Yes | Yes | Yes (exposure) |
| RR-13 | High | Customers can add credits to their own account without payment | Pipeline | Yes | Yes | Yes (exposure and use) |
| RR-14 | Medium | CORS wildcard on every response | Pipeline | Yes | Yes | No |
| RR-15 | Medium | Network binding changed to `0.0.0.0` in uncommitted code | Pipeline | Yes | **No** | Yes |
| RR-16 | Medium-High | Tests and benchmarks default to `DATABASE_URL` and delete/insert data | Pipeline | Yes | Yes | No |
| RR-17 | Medium | Folder watcher writes to the database when launched | Pipeline | Yes | Yes | Yes |
| RR-18 | Medium-High | `businesses.status` value domain conflict (`DUPLICATE` vs Orion's enum) | Both | Yes | Yes | Yes |
| RR-19 | High | The pipeline's customer layer writes Orion's `users`, credits and searches tables | Pipeline | Yes | Yes | Yes |
| RR-20 | High | Orion `apps/api/.env` points development tooling at the production host | Orion | Yes | n/a (untracked) | Yes |
| RR-21 | Medium | The Orion gateway writes shared tables with raw SQL | Orion | Yes | Partly | Yes |
| RR-22 | Medium | Orion shutdown/pool-lifecycle fixes are uncommitted | Orion | Yes | **No** | Yes |
| RR-23 | Low-Medium | Orion schedulers and workers run once per instance; serverless entry | Orion | Yes | Yes | Yes |
| RR-24 | Info | Controls that already exist | Both | Yes | Mixed | n/a |
| RR-25 | **Critical** | Database credentials committed to git and on `origin/main` (tracked `ownus/scratch_*.js`) | Orion | Yes | **Yes** | Yes (visibility, validity) |

---

## 2. Pipeline migration and startup paths

### RR-01 · High · Automatic migrations at server start (working tree only)
- **Where:** `server.py:1724-1731` (`start_server`), `docker-compose.yml:44` (`AUTO_MIGRATE: 1`).
- **Evidence:** `if os.environ.get("AUTO_MIGRATE", "1").lower() in ("1", "true", "yes")` then `run_migrations()`. **Unset means on.** The committed `start_server()` does **not** contain this block (`git show HEAD:server.py` has no `AUTO_MIGRATE`); the block, the `HOST` variable and the compose lines are uncommitted additions. At HEAD, no startup path migrates; the only committed way is invoking `python -m python_pipeline.migrate` directly. `run.bat` (which migrates, `run.bat:101`) is **untracked**, so it is not part of committed history either.
- **Impact:** any server start whose `DATABASE_URL` reaches the shared database applies every unrecorded migration file, including DDL and view drops (RR-04), without an approval step. Prior audit (HIST): production recorded a different `013`; the current `013`/`014` are unrecorded there.
- **Status:** WT confirmed; not in HEAD. RUNTIME? Which database a deployed instance targets and whether the uncommitted code is deployed anywhere is unknown.
- **Mitigation:** make migration an explicit, separate deployment step; default `AUTO_MIGRATE` to off; require an explicit target confirmation before any remote migration (compare Orion's `MIGRATION_CONFIRM_HOST` guard, which is also uncommitted).
- **Approval required:** owner of the pipeline code, plus the database owner before any deployment change.

### RR-02 · High · Migration failure does not stop the server (working tree only)
- **Where:** `server.py:1725-1731`, then `1733` (server created), `1737-1739` (worker started).
- **Evidence:** the migration call sits in `try … except Exception as e: print("[Server WARNING] Auto-migration check encountered: …")`; execution continues to start the HTTP server and the embedded worker. By contrast `run.bat:101-107` (an **untracked** file) exits with code 1 on a failed migration (`if errorlevel 1 … exit /b 1`).
- **Impact:** a partially applied or failed migration leaves a running service against an inconsistent schema. `python_pipeline/migrate.py:111-125` rolls back the failing file and re-raises, but the caller swallows it; the same file fails and is retried on every start.
- **Status:** WT confirmed; HEAD has no auto-migration at all. RUNTIME? whether such a start has occurred.
- **Mitigation:** make a failed migration fatal (non-zero exit) wherever migrations are run; fail the deployment, not the log.
- **Approval required:** pipeline owner; deployment owner.

### RR-03 · High · Runner has no lock, no per-file transaction guard beyond commit, filename-only history
- **Where:** `python_pipeline/migrate.py:18-19` (default URL), `:61` (history table created), `:72-75` (baseline bootstrap if `businesses` is absent), `:98-125` (apply loop), no `pg_advisory_lock` anywhere in the file.
- **Evidence:** history is `schema_migrations(version)` by file name; applied files are skipped by name only, so edits to an applied file go unnoticed; two processes starting together can both see a file as unapplied and both run it. Migration `013`/`014` also insert their own history rows (`013_create_people_intelligence_layer.sql` ends with an `INSERT INTO schema_migrations`; `014_create_execution_logs.sql` likewise), duplicating what the runner does.
- **Impact:** concurrent starts (replicas, worker plus server, scripts) can run non-idempotent statements twice (RR-04). Renumbering is possible and has already diverged from the database (HIST: production's `013` name matches no commit).
- **Status:** WT and HEAD confirmed for the missing lock and name-only history (HEAD `migrate.py` lacks the per-file `try/except` shown in the working tree but behaves the same on failure). RUNTIME? replica count unknown.
- **Mitigation:** advisory lock around the whole run; record a checksum with each version; fail on a changed applied file; one migration owner.
- **Approval required:** pipeline owner; separate approval for any change to the shared history table.

### RR-04 · High · Destructive view migration pattern
- **Where:** `migrations/005_create_publishing_layer.sql:53`, `007_create_freshness_and_incremental_layer.sql:34`, `008_enhance_discovery_and_indexing.sql:9`, `010_create_entity_resolution_layer.sql:113` (each `DROP VIEW IF EXISTS orion_published_businesses CASCADE;` then `CREATE VIEW`), `013_create_people_intelligence_layer.sql:188` (`DROP VIEW IF EXISTS orion_published_people CASCADE;`); `schema.sql:127` uses `CREATE OR REPLACE VIEW`. All in committed history (migrations directory is clean at HEAD).
- **Evidence:** `CASCADE` removes every object that depends on the view, silently. The view is public-schema and named for Orion consumption.
- **Impact:** a migration run on a database where Orion (or anything else) built a view on `orion_published_businesses` removes that dependent view without error; read paths can break until it is recreated. A view dropped and recreated also resets its grants. Data rows are not deleted by these statements.
- **Status:** statements confirmed (HEAD). Whether any dependent exists is RUNTIME? (evidence check C12b in the Phase A2 package).
- **Mitigation:** `CREATE OR REPLACE VIEW` with a stable explicit column list; a versioned view name for breaking changes; dependency check before any view change.
- **Approval required:** pipeline owner and Orion owner (consumer); database owner for any change in shared schemas.

### RR-05 · High · Overlapping People tables with different shapes
- **Where:** pipeline `migrations/013_create_people_intelligence_layer.sql` (`CREATE TABLE IF NOT EXISTS people` / `person_contacts`, plus a unique index on `linkedin_url_normalized`); Orion `apps/api/src/database/migrations/0004_decision_maker_people.sql` (same table names, unique index on `normalized_linkedin_url`).
- **Evidence:** both use `IF NOT EXISTS`; the column sets differ (pipeline-only: batch FKs, `location`, `profile_url`, `value`/`raw_value`; Orion-only: `data_status`, enum `verification_status`, `normalized_value`, `contact_value`). The unique indexes reference columns that exist in only one shape.
- **Impact (INF, reasoned from the SQL, not executed):** whichever runs first wins silently; the other's index step then fails and rolls back its whole file or run. Orion's Drizzle run fails loudly and atomically; the pipeline's failure is swallowed by RR-02.
- **Status:** WT and HEAD confirmed for the DDL. HIST: neither table existed in production on 2026-10-01. RUNTIME? current state.
- **Mitigation:** decide ownership; separate schemas (`orion_pipeline`) so names cannot collide; do not run either People migration until decided.
- **Approval required:** database owner and both application owners.

## 3. Workers, schedulers, watchers

### RR-06 · High · Embedded worker always starts with the server
- **Where:** `server.py:1737-1739` (`PipelineWorker(worker_id="server-embedded-worker", …)`, daemon thread, `poll_interval=1.0`).
- **Evidence:** unconditional; no environment variable or flag disables it (env reads in `server.py` and `python_pipeline/**`: `DATABASE_URL`, `AUTO_MIGRATE`, `HOST`, `PORT`, `R2_*`, `STORAGE_LOCAL_DIR`, `RATE_LIMIT_DISABLED`, freshness-day settings, `TESTING`). Present at HEAD.
- **Impact:** every server process is also a job-processing writer; "stopping writers" requires stopping the process. Starting the server to inspect something starts a database-writing worker.
- **Status:** HEAD and WT confirmed. RUNTIME? which instances run.
- **Mitigation:** a configuration switch (default off for web-only instances); separate roles for HTTP and worker processes.
- **Approval required:** pipeline owner; deployment owner.

### RR-07 · Medium-High · Competing workers; stale recovery can re-run a live job
- **Where:** `python_pipeline/queue/backend.py:208-221` (`claim_job … FOR UPDATE SKIP LOCKED`), `:515-570` (`recover_stale_jobs`: RUNNING jobs whose `last_heartbeat_at` is older than the threshold are re-queued, retry count +1); `python_pipeline/queue/worker.py:77` (every `run_once` calls recovery), `:285` (progress and heartbeat updated "every 5 records or at completion"); standalone worker `docker-compose.yml:63-76`, embedded worker RR-06.
- **Evidence:** `SKIP LOCKED` prevents two workers claiming the same QUEUED row. The recovery sweep, however, runs in every worker on every poll with a default 60 s threshold, and the heartbeat advances only per five processed records.
- **Impact (INF):** a slow batch of five records, a long enrichment call or a stalled network can exceed the threshold; another worker re-queues the job and runs it again while the first is still writing. Side effects (inserts, history rows) can duplicate. Idempotency of job handlers was not established.
- **Status:** WT and HEAD (`worker.py`, `backend.py` identical to HEAD). RUNTIME? job duration distribution.
- **Mitigation:** heartbeat on a timer independent of record progress; lease with fencing; idempotent handlers; one recovery sweeper.
- **Approval required:** pipeline owner.

### RR-08 · Medium · Declared configuration the code does not read
- **Where:** `docker-compose.yml:74-75` (`WORKER_HEARTBEAT_INTERVAL`, `WORKER_STALE_THRESHOLD`); `.env.example` lists more (`WORKER_CONCURRENCY`, `MAX_JOB_RETRIES`, etc.).
- **Evidence:** no read of these names exists in `server.py` or `python_pipeline/**` (only the keys listed in RR-06). `PipelineWorker.__init__` takes its own defaults (`worker.py:43-61`).
- **Impact:** an operator may believe heartbeat or stale limits are tuned when they are not; RR-07 timings stay at code defaults.
- **Status:** WT and HEAD. No runtime check needed.
- **Mitigation:** read the variables or remove them; document the defaults.
- **Approval required:** pipeline owner.

### RR-09 · Medium-High · No graceful shutdown
- **Where:** `server.py:1753-1755` (only `except KeyboardInterrupt: print("Shutting down server.")`); the worker has `stop()` (`worker.py:132`) that is never called by the server; the standalone entry `worker.py:397-430` installs no signal handler.
- **Evidence:** a SIGTERM (container stop, process manager) terminates the Python process without stopping the loop; the embedded worker is a daemon thread killed at exit. No connection or transaction cleanup exists beyond the context managers in individual calls.
- **Impact:** an in-flight job stays RUNNING until the stale sweep (RR-07) re-queues it, so it restarts from scratch, possibly after partial writes.
- **Status:** WT and HEAD. RUNTIME? how instances are stopped.
- **Mitigation:** signal handlers that set the worker's stop flag, finish or release the job, then close the server; bounded shutdown timeout; compose `stop_grace_period`.
- **Approval required:** pipeline owner; deployment owner.

### RR-10 · Medium · Connection handling
- **Where:** `python_pipeline/db.py:18-21` (a hard-coded localhost default URL is used when `DATABASE_URL` is unset), `:26,44,62,98,123,217,430,492,509,527` (a new `psycopg.connect` per call), `python_pipeline/queue/backend.py` (new connection per operation), `migrate.py:19`.
- **Evidence:** there is no pool, no `statement_timeout`/`lock_timeout`, and only `is_connected` sets `connect_timeout=3`. Defaults fall back to a localhost URL if `DATABASE_URL` is unset.
- **Impact:** connection churn against a hosted database (and against a pooled Neon endpoint); a long statement or lock wait has no cap; a missing variable silently targets a local default. Pool lifecycle risk is therefore connection-count, not shutdown ordering.
- **Status:** WT and HEAD (`db.py`, `backend.py` identical to HEAD). RUNTIME? load and endpoint type.
- **Mitigation:** a managed pool with limits and timeouts; fail startup if `DATABASE_URL` is missing instead of defaulting.
- **Approval required:** pipeline owner.

### RR-17 · Medium · Folder watcher
- **Where:** `python_pipeline/watch_folder.py:10` (`watch`), `:39` (loop), `:91` (`__main__`).
- **Evidence:** a polling loop over `incoming_csv/*.csv` that runs `pipeline.process_csv(..., auto_approve=False)` and writes to the database; it starts only when launched manually, not from `server.py` or compose.
- **Impact:** when run, it writes to whatever `DATABASE_URL` is set. Whether any watcher is deployed is unknown.
- **Status:** WT and HEAD (identical). RUNTIME? whether a scheduled task or service starts it.
- **Mitigation:** inventory of how it is launched; an explicit target and read-only dry-run mode.
- **Approval required:** pipeline owner.

### RR-16 · Medium-High · Tests, benchmarks and scripts default to `DATABASE_URL`
- **Where:** `scripts/run_people_benchmark.py:80-83` (`run_migrations()` then inserts thousands of `businesses` rows), `scripts/run_source_run_benchmark.py` (same pattern), `scripts/run_background_processing_benchmark.py:25`, `tests/test_background_processing_phase8.py:21,41` (`DELETE FROM businesses WHERE slug LIKE 'test-p8-%'…`), `tests/test_company_reupload_p3.py:90`.
- **Evidence:** they read `DATABASE_URL` with a localhost fallback and perform migrations, inserts and deletes. No guard checks that the target is a disposable database. (`scripts/run_fresh_migration_check.py:21`, an untracked file, correctly uses its own local test database.)
- **Impact:** running these with `DATABASE_URL` pointing at a shared database migrates it and writes or deletes rows.
- **Status:** WT and HEAD. No runtime check needed to see the hazard; whether they were run against production is UNKNOWN.
- **Mitigation:** require a test-only variable and refuse any host not on an allow-list.
- **Approval required:** pipeline owner.

## 4. HTTP ingestion and request-handling paths

### RR-11 · High · Mutating endpoints without authentication
- **Where:** `server.py:1018` (`POST /api/auto-process`: parses uploaded CSV and processes it into the database), `:1215` (`POST /api/delete-records`: deletes businesses by slug), `:1580-1583` (`DELETE /api/businesses`: same), `:1418-1431` (`POST /api/jobs/import`: the role check is `if role and role… not in JOB_AUTHORIZED_ROLES`, so a request with **no** role passes).
- **Evidence:** no call to the authenticated-context helper precedes these handlers (compare `:756-759`, which does require a session). `db_mgr.delete_businesses` performs `DELETE FROM businesses WHERE slug = ANY(...)` (`python_pipeline/db.py:455`).
- **Impact:** anyone who can reach the port can add records, queue import jobs or delete business rows by slug. Exposure depends on network binding (RR-15).
- **Status:** WT; the handlers exist at HEAD (the committed diff hunks do not touch them). RUNTIME? reachability of the deployed port.
- **Mitigation:** require authentication on every mutating route; deny by default.
- **Approval required:** pipeline owner; owner decision if the UI relies on open access.

### RR-12 · High · Self-declared roles
- **Where:** `server.py:1262-1268` and `:1274` (verification review: role from `X-Reviewer-Role`/`X-Role`, a bearer value that is simply one of `admin|reviewer|data_steward|user|viewer`, or the JSON body), `:1354-1367` (publishing: same), `:1418-1427` (jobs), `:482`.
- **Evidence:** the role is taken from request headers or a literal bearer string; no signature or session is checked. A comment at `:1624` states the newer people endpoints do **not** accept such headers.
- **Impact:** any client can claim `admin` and approve, reject or publish businesses and create jobs; publishing feeds `orion_published_businesses`.
- **Status:** WT; present at HEAD. RUNTIME? reachability.
- **Mitigation:** server-side sessions or signed tokens for all roles; remove header trust.
- **Approval required:** pipeline owner.

### RR-13 · High · Self-service credits
- **Where:** `server.py:756-783` (`POST /api/customer/credits/add`).
- **Evidence:** with any valid customer session the handler reads `amount` and `transaction_type` from the request body and calls `credit_svc.add_credits(...)` with `reference_type="PURCHASE"`; no payment verification appears in the handler.
- **Impact:** a customer of the pipeline's own layer can grant themselves credits, writing to `credit_transactions` (a table Orion treats as an authoritative ledger).
- **Status:** WT; present at HEAD. RUNTIME? whether that customer layer is exposed or used (HIST: production holds pipeline-origin columns on `credit_transactions`).
- **Mitigation:** remove or disable the endpoint; credits only through Orion's verified payment flow.
- **Approval required:** owner decision on the pipeline's customer functionality; both application owners.

### RR-14 · Medium · CORS wildcard
- **Where:** `server.py:166, 1681, 1696, 1710` (`Access-Control-Allow-Origin: *`; allowed headers include `X-Reviewer-Role`, `X-Role`).
- **Impact:** with RR-11/RR-12, any web page a reachable user visits can call the API from a browser.
- **Status:** WT and HEAD. **Mitigation:** an origin allow-list. **Approval:** pipeline owner.

### RR-15 · Medium · Network binding
- **Where:** `server.py:47` (`HOST = os.environ.get("HOST", "127.0.0.1")`), `:1733`; `docker-compose.yml:43` (`HOST: 0.0.0.0`), `:50-51` (port 5000 published), `Dockerfile:38` (`EXPOSE 5000`).
- **Evidence:** HEAD binds `127.0.0.1` only (hard-coded in `start_server`). The configurable `HOST` and the compose override to `0.0.0.0` are **uncommitted**.
- **Impact:** if the uncommitted configuration is deployed, RR-11/RR-12/RR-13 become network-reachable.
- **Status:** WT confirmed; not in HEAD. RUNTIME? deployed configuration. **Mitigation:** keep loopback unless an authenticated reverse proxy fronts it. **Approval:** deployment owner.

## 5. Shared-table write paths and contracts

### RR-18 · Medium-High · `businesses.status` value-domain conflict
- **Where:** pipeline `python_pipeline/verification.py:503` (`status = 'DUPLICATE'`), `schema.sql:34` (`status VARCHAR(50) … 'Legacy/Compatibility status flag'`), publishing writes `publishing_status`/`stage` (`python_pipeline/publishing.py:367-368`, `:531-532`), not `status`; Orion `apps/api/src/database/schema/enums.ts:18-25` (`business_status`: DRAFT, PENDING_VALIDATION, VERIFIED, PUBLISHED, ARCHIVED, REJECTED).
- **Evidence:** the pipeline writes a value Orion's enum does not contain, and uses a different column for publication. Its publish and unpublish updates (`publishing.py:365-373`, `:529-536`) set `publishing_status`, `stage`, `dataset_version`, `unpublished_at` and `published_at` but **never `status`**; `published_at` is a column Orion's schema also defines (`apps/api/src/database/schema/businesses.ts`), so a pipeline-published row can carry a `published_at` while Orion's `status` is still `DRAFT`.
- **Impact:** if production's `businesses.status` is the Orion enum, that pipeline update fails and aborts the duplicate-confirmation action; if it is a plain varchar, Orion code meets a status it does not model. Orion's `status` as publication authority is therefore **unverified**: today the pipeline publishes through its own columns.
- **Status:** statements WT and HEAD. RUNTIME? the actual column type (Phase A2 check C05) and the rows (C14).
- **Mitigation:** one documented state machine and mapping; no cross-system writes to the other's status column.
- **Approval required:** owners of both applications.

### RR-19 · High · The pipeline's customer layer writes Orion's shared tables
- **Where:** `python_pipeline/commercial/auth.py:71` (`INSERT INTO users (email, password_hash, role, is_active, …)`), `:96` and `credits.py:65,179` (`INSERT INTO credit_transactions`), `commercial/searches.py:28,75` (`saved_searches`); pipeline migration `011_create_customer_commercial_layer.sql` defines `users`, `user_sessions`, `accounts`, `credit_transactions`, `saved_searches` with shapes that differ from Orion's.
- **Evidence:** Orion's `users.role` is an enum without `customer`, Orion's ledger has different columns (`wallet_id`, `balance_after`, `balance_type`).
- **Impact:** duplicated authentication and credit systems against one database; inserts from either side can fail or write rows the other cannot interpret; two ledgers are not reconcilable by construction.
- **Status:** WT and HEAD. RUNTIME? whether production holds data written this way (Phase A2 checks C13a, C13b, C13c).
- **Mitigation:** an ownership decision, then remove or isolate the non-owner's writer.
- **Approval required:** owner; both application owners.

### RR-21 · Medium · Orion gateway raw-SQL writers
- **Where:** `ownus/src/app/api/v1/[...path]/route.ts` (working tree): `users` (`:234,250,269,1240,1397,1417,1553,1823,1828,2033,2103,2154,2210,2258,2320`), `import_batches` (`:1060` insert with `file_key`, `:3206` delete), `businesses` (`:1096` insert, `:3063,3074` delete, `:3107,3112` `UPDATE businesses SET status`), `business_history` (`:3053` delete), `duplicate_clusters` (`:3058` delete), `credit_transactions` and `user_wallets` (`:1272-1303`; `ownus/src/lib/unlock-business.ts:28-38`).
- **Evidence:** the Next.js gateway writes shared tables directly in addition to the NestJS API. The route file differs from HEAD (uncommitted edits).
- **Impact:** Orion itself has two writers per table, so "the Orion API is the single writer" is false today; deletes from the gateway can cascade into pipeline tables (for example `import_batches` → `import_logs`, `pipeline_jobs` set null; HIST).
- **Status:** WT; partly HEAD. RUNTIME? which gateway paths are live (a fallback path is used when the API is unreachable).
- **Mitigation:** route all writes through one service per table; document the cascade effects.
- **Approval required:** Orion owner.

## 6. Orion runtime paths

### RR-20 · High · Development tooling targets the production database
- **Where:** `apps/api/.env` (gitignored; the owner has stated its `DATABASE_URL` is production); `apps/api/src/database/seed.ts:11,18`, `migrate.ts:8,11`, `scripts/clean-fake-data.ts:3-8` (reads `DATABASE_URL`, then `DELETE FROM lead_unlocks`, `saved_searches`, `saved_leads`, `credit_transactions`, `user_wallets`, `audit_logs` …).
- **Evidence:** every script loads `.env` through `dotenv.config()`; seeds and cleanup default to whatever it holds. Only `migrate.ts` has a guard (`assertMigrationTarget`, uncommitted); `seed.ts` and the cleanup scripts have none. The in-memory test suites never read it.
- **Impact:** `npm run drizzle:seed`, the cleanup scripts and `start:dev` run with production credentials unless the shell overrides them. `drizzle:seed` overwrites package rows (HIST, documented in `docs/MIGRATION_RUNBOOK.md` §4).
- **Status:** WT confirmed. UNKNOWN: whether the owner-stated production target is the only value used. **Mitigation:** development `.env` points at a disposable database; production credentials only in the deployment platform; the same host guard on seed and cleanup scripts. **Approval:** database owner, Orion owner.

### RR-22 · Medium · Orion pool and shutdown fixes are uncommitted
- **Where:** `apps/api/src/database/database.service.ts:36` (`onApplicationShutdown`), `apps/api/src/modules/credit/credit.scheduler.ts` (timer handles and stop flag), `apps/api/src/main.ts:17` (`enableShutdownHooks`).
- **Evidence:** at HEAD the pool is ended in `onModuleDestroy` (`database.service.ts:34`) and the scheduler's startup `setTimeout` (`credit.scheduler.ts:18`) has no cleanup; the working tree fixes both (a Phase 6.28 fix). `enableShutdownHooks` is in HEAD (`main.ts:16`).
- **Impact:** a deployment built from the committed code keeps the pre-fix lifecycle (late rollover writes after the pool closes, as seen in the staging run).
- **Status:** WT; not in HEAD. **Mitigation:** commit with the migration set after review. **Approval:** Orion owner.

### RR-23 · Low-Medium · Per-instance background work and serverless entry
- **Where:** `apps/api/src/modules/credit/credit.scheduler.ts:22-25` (rollover timer per instance), `apps/api/src/modules/queue/queue.service.ts` and `base.worker.ts` (workers per instance), `apps/api/src/main.ts:113` (`listen(port, '0.0.0.0')`), `:126-141` (`bootstrapServerless`), `.vercel/` present.
- **Evidence:** rollover is idempotent per wallet (`FOR UPDATE` in `credit.service.ts` `syncDailyCredits`) and queue claims use `FOR UPDATE SKIP LOCKED`, so duplicate instances do not double-process; there is no leader election. A serverless entry creates a pool per cold start.
- **Impact:** extra load and connection count rather than corruption. The Orion API has **no** startup migration (no migrate call in `main.ts` or `app.module.ts`).
- **Status:** WT/HEAD; RUNTIME? deployed topology and connection limits.
- **Mitigation:** document instance counts and connection budgets; leader election only if load requires it. **Approval:** Orion owner.

## 7. Existing controls (observed, unchanged)
| ID | Control | Where | In HEAD? |
|---|---|---|---|
| RR-24a | Fail-closed migration in the Windows runner | `run.bat:101-107` | **No (untracked file)** |
| RR-24b | Orion's migration host confirmation (`MIGRATION_CONFIRM_HOST`) | `apps/api/src/database/migrate.ts`, `migration-target.ts` | **No (uncommitted)** |
| RR-24c | Orion fails a failed migration run atomically (single transaction) | Drizzle migrator | Yes |
| RR-24d | Queue claim uses `FOR UPDATE SKIP LOCKED` in both systems | `queue/backend.py:208-221`; `queue.service.ts` | Yes |
| RR-24e | Newer pipeline people endpoints refuse self-declared role headers | `server.py:1624` (comment) | Not verified at HEAD |
| RR-24f | Pipeline healthcheck and non-root container user | `Dockerfile:35,41-42` | Yes |
| RR-24g | Orion staging target guard and read-only audit tooling | `apps/api/src/database/staging-guard.ts`, `migration-audit.ts` | **No (uncommitted)** |

## 8. Unverified runtime facts that these findings depend on
1. Which database each deployed pipeline process (server, worker, watcher) points at, and whether the uncommitted `AUTO_MIGRATE`/`HOST` code is deployed.
2. Whether any pipeline process is running now. Historical dated writes (HIST: last on 2026-09-29) are not evidence either way.
3. Replica counts and how processes are stopped (RR-03, RR-07, RR-09).
4. Network exposure of the pipeline port (RR-11 to RR-15).
5. Whether pipeline customer functionality has real users or data (RR-13, RR-19).
6. The real type of `businesses.status` and the contents of shared tables (RR-18).
7. Dependents of `orion_published_businesses` (RR-04).
8. Which Orion gateway fallback paths are live (RR-21).

## 9. Not covered by this static pass
Dynamic behavior, third-party dependencies, secrets handling inside either repository's `.env` files (values were deliberately not read), the contents of the pipeline's `ui/` front end, and anything in a deployment platform's configuration that is not in these repositories.

## 10. Corrections and additions (second pass, 2026-10-02)
These supersede any conflicting statement above.

1. **Pipeline repository state:** 27 entries, not 26 (one staged deletion was missed): 15 modified, 1 staged deletion, 11 untracked. `run.bat` and `setup.bat` are untracked. An earlier statement that `run.bat` was "identical to HEAD" was wrong (an untracked file shows no diff).
2. **HEAD line numbers.** Line numbers in this register are working-tree lines. For `server.py` the same handlers sit about 18 lines earlier at HEAD (verified by string search): `POST /api/customer/credits/add` HEAD:738, `/api/auto-process` HEAD:1000, `/api/delete-records` HEAD:1197, the job-role check HEAD:1410 and HEAD:1472, `do_DELETE` HEAD:1562, the embedded worker HEAD:1690. All the handler behaviors cited in RR-06, RR-11, RR-12, RR-13 and RR-14 exist at HEAD; only the `AUTO_MIGRATE` block, the `HOST` variable and the compose lines (RR-01, RR-02, RR-15) are working-tree additions.
3. **Files verified unchanged against HEAD** (so the cited behavior is committed): `python_pipeline/db.py`, `queue/backend.py`, `queue/worker.py`, `watch_folder.py`, `batch_manager.py`, `publishing.py`, `verification.py`, `commercial/auth.py`, `commercial/credits.py`, `commercial/searches.py`, `people/service.py`, `people/review.py`, `people/sources/run_service.py`, `deduplicator.py`, `freshness/service.py`, `schema.sql`, `Dockerfile`, `migrations/*.sql`, the benchmark scripts and `tests/test_background_processing_phase8.py`. Modified in the working tree: `server.py`, `migrate.py`, `docker-compose.yml`, `storage.py`, `people/admin_api.py`. Not in HEAD: `run.bat`, `setup.bat`, `scripts/run_fresh_migration_check.py`.
4. **Reachability.** Every severity above is a static judgement about the code if a path is reachable. None of these findings is claimed to be exploitable or exposed in any deployment: exposure (network binding, proxy, authentication in front, which instances run) is **unverified** and must not be tested against production.
5. **Publication path (supports RR-18):** Orion customer reads filter on `businesses.status = 'PUBLISHED'` (`apps/api/src/modules/discover/discover.service.ts:197,357,498,509,528,534`, `modules/unlock/unlock.service.ts:37,66`, `modules/search/providers/postgres-search.provider.ts:31`, gateway `route.ts:2536,2896`, which also accept legacy `'active'`). The pipeline's view filters `stage`, `publishing_status`, `verification_status` (`migrations/010_create_entity_resolution_layer.sql:162-164`).
6. **View dependency (supports RR-04):** `orion_published_people` is built on `orion_published_businesses` (`migrations/013_…sql:233`), so a later `DROP VIEW orion_published_businesses CASCADE` would silently drop the People view too. The pipeline reads the businesses view itself in `commercial/credits.py:105-106`, `people/export_service.py:159`, `people/review.py:120`, `publishing.py` and the `/api/orion/*` routes (`server.py:492,586,589`); no Orion code references any pipeline view or table. A drop-and-recreate also resets the view's privileges, which matters for any future read-only grants. Orion's migrations create no views.

## 11. Proposed regression tests per finding (none written, none run)
Tests belong to the repository that owns the code and must run only against disposable local databases (never `DATABASE_URL` as found).

| ID | Regression test | Pass criterion |
|---|---|---|
| RR-01 | Start-up test with `AUTO_MIGRATE` unset | no migration runs; no connection to the database for DDL |
| RR-02 | Migration runner with a deliberately failing disposable file | process exits non-zero; server not started; failure message names the file |
| RR-03 | Two concurrent runner processes on a disposable database; edited applied file | second blocks or refuses; edited file refused; each file applied once |
| RR-04 | Static test over `migrations/*.sql` | no `DROP … CASCADE`; view changes use `CREATE OR REPLACE` with a compatible column list; grants survive |
| RR-05 | Migrations of both systems on a disposable database in both orders | no silent no-op over a differently-shaped table; pipeline objects live only in `orion_pipeline` |
| RR-06 | Server start with the worker switch off | no worker thread; no job claimed |
| RR-07 | Slow job exceeding the stale threshold | not re-run while its lease is live; exactly one execution |
| RR-08 | Config test | each documented variable changes the behavior or is removed |
| RR-09 | Send a stop signal during a job | job finished or released; connections closed within the bound |
| RR-10 | Missing `DATABASE_URL` | startup fails instead of using a localhost default; statement/lock timeouts applied |
| RR-11, RR-12 | Route test for every mutating route without credentials, with a forged `X-Role`/`Bearer admin` | 401/403 and no write |
| RR-13 | Authenticated customer posts to the add-credits route | rejected or route absent; ledger unchanged |
| RR-14, RR-15 | Response header and bind-address tests | origin allow-list; loopback unless configured |
| RR-16 | Test/benchmark entry points with a non-allow-listed host | refuse to run |
| RR-17 | Watcher start with a non-allow-listed target | refuses |
| RR-18 | Contract test over the publication state machine | pipeline never writes `status`; all documented states map to enum values |
| RR-19 | Parity tests of Orion auth/credit/unlock/export vs the retired pipeline routes (before retirement) | equal results for the same inputs; pipeline writes disabled |
| RR-20 | Seed and cleanup scripts with a production-flagged host | refuse without explicit confirmation |
| RR-21 | Gateway write paths | each write goes through the owning service; cascade effects documented and tested |
| RR-22 | Orion pool/scheduler tests (already present in the working tree) | no query after pool close; timers cleared |
| RR-23 | Multi-instance rollover test | no double credit; documented connection budget |


## 12. Stage A verification log and additions (third pass, 2026-10-02)
Findings re-checked against both repositories during the integration-readiness review. Nothing below changes a severity claim about reachability: all remain static judgements.

### 12.1 New finding

### RR-25 · Critical · Database credentials committed to git and present on `origin/main` (Orion)
- **Where (tracked files, working tree and HEAD):** `ownus/scratch_inspect_tables.js:3`, `ownus/scratch_master_e2e_verification.js:3`, `ownus/scratch_test_app_preferences_persistence.js:3`, `ownus/scratch_test_db.js:4,5` (plus local-database lines `:6-8`), `ownus/scratch_test_notifications_integration.js:3`, `ownus/scratch_test_profile_persistence.js:3`, `ownus/scratch_test_single_device_login.js:3`. Eight tracked `scratch_*` files; the first was added in commit `1cdf261` (2026-09-21) and that commit is reachable from `origin/main`.
- **Evidence (values deliberately not shown):** the files contain connection-string literals with an embedded user name and password. Eleven credentialed literals were found; for the remote (Neon-class) ones, a boolean comparison performed in memory found that **8 of the 11 carry the same password as the production-configured role in the gitignored `apps/api/.env`**. Placeholder-style literals exist elsewhere (`.env.production.example`, `docs/ENVIRONMENT_VARIABLES_GUIDE.md`) and are not part of this finding. In the pipeline repository no tracked file contains a remote credentialed URL (only localhost/placeholder defaults).
- **Impact:** if the remote repository is readable by anyone other than the owner (visibility not verified), the production database credentials may be exposed; they also remain in git history even after the files are deleted. Whether the credentials are still valid or still the production ones is **not verified** (no connection was made).
- **Status:** WT and HEAD confirmed for presence; remote reachability of the commit confirmed locally (`git branch -r --contains`); repository visibility and credential validity: RUNTIME?/UNKNOWN.
- **Mitigation (owner decisions; none performed):** treat the credentials as compromised; rotate the database role password(s) through a separately approved production change; stop tracking and delete the scratch files from the working branch; decide whether to purge history (rewriting a shared history is itself a risky, separately approved operation); audit Neon access logs for the exposure window; make the development `.env` point at a disposable database. Note for sequencing: rotation changes the credentials the Phase A2 operator and both applications use, so it must be coordinated with the approval record and the maintenance window.
- **Approval required:** database owner (rotation, access-log review), repository owner (history decision).

### 12.2 Other items re-verified or added
| Topic | Result | Evidence |
|---|---|---|
| Pipeline `storage/` directory | 3,069 local files (CSV/XLSX/JSON uploads) exist in the working directory; **none are tracked** (`git ls-files storage` is empty) and `.gitignore` mentions `storage`. An earlier note that it was "not ignored" was a path-pattern artefact. Treat the files as business data to keep out of any commit | `git ls-files`, `.gitignore` |
| Pipeline `.env` | gitignored; `.env.example` tracked with placeholders | `git check-ignore` |
| Orion `apps/api/.env`, `ownus/.env.local`, `.vercel/` | gitignored | `git check-ignore` |
| Orion loose artefacts `apps/api/before.json`, `before.clean.json`, `after.json` | **untracked and not ignored**; counts-only rehearsal snapshots, but must not be committed | `git status` |
| Tracked scratch scripts | `ownus/scratch_*.js` (8 files) are tracked development scripts; beyond RR-25 they can write to whatever database their literals name | `git ls-files` |
| `imported_businesses.sql` (pipeline, tracked since the initial commit) | 10 lines, 5.4 KB; business sample data; content not read | `wc` |
| Import batches readers (pipeline) | `batch_manager.py:40`, `people/review.py:489,573`, `people/sources/run_service.py:267`, `people/source_runs_api.py:152,194,210`, `verification.py:260` | grep |
| Import batches readers (Orion) | `modules/import/repositories/import.repositories.ts:16-67`, `modules/people/metrics/people-metrics.service.ts` (counts by `status`) | grep |
| Pipeline reads of `businesses.status` | none found as a publication gate; `db.py:128` selects it for display; the pipeline's gating uses `stage`/`publishing_status`/`verification_status`. (`commercial/leads.py:701-705` filters a leads table's own `status`.) | grep |
| Orion `published_at` | written on creation or status change (`business.repository.ts:84`, `business.service.ts:116`, `duplicate-review.repositories.ts:129`); not used as a visibility gate in customer reads | grep |
| People endpoints: Orion | `internal/people-review` (20 routes), `internal/people-verification` (3), `internal/people-metrics` (2), `admin/people/import` (3), `people.controller.ts` (6 routes, no controller prefix) | controllers |
| People endpoints: pipeline | `/api/admin/people/*` via `python_pipeline/people/admin_api.py` (stats, list, quarantine, conflicts, relationships, contacts verify, conflicts resolve, source-runs, export); `server.py:190,706,1533` | WT (`admin_api.py` differs from HEAD) |
| Documents re-read for this pass | matrix, register, target architecture, rehearsal plan, change-request template, Phase A2 approval readiness, evidence template: all exist; no factual error found in their cited line numbers beyond the corrections already recorded in §10 | review |
