# Proposal (not implemented): `import_batches.file_key` (revised in Phase 6.30)

Status: **proposal only.** No migration file exists, nothing was backfilled or altered, the production database was only read (READ ONLY transactions, aggregates only, no names/keys/hashes/credentials printed).

## 1. Correction of the Phase 6.24 proposal
The earlier proposal assumed the 10 NULL rows were abandoned upload stubs and backfilled them with a sentinel (`legacy/unkeyed/<id>`). **That was wrong and must not be used.** Deeper read-only inspection shows the rows are real records of an R2 upload pipeline that is not in this repository; each already holds the true object location in another column.

## 2. Evidence (production source, read-only)
- `file_key` is nullable with no default and no index or constraint mentions it. This repository's schema and migration 0000 say NOT NULL, so the constraint was dropped out of band.
- `import_batches` has **10 columns that this repository's schema and migrations do not define**, all nullable or defaulted: `r2_object_key`, `r2_uri`, `sha256_checksum`, `content_type` (default `text/csv`), `source_type` (default `CSV`), `processing_status` (default `STORED`), `total_rows`, `successful_rows`, `failed_rows`, `error_summary`. None of these names appears anywhere in this repository or its git history (all branches). They belong to another writer.
- 19 rows fall into three groups:

| Group | Rows | `file_key` | R2 columns | `status` / `processing_status` | Written by |
|---|---|---|---|---|---|
| A | 4 | `imports/<ts>-<name>` | none | COMPLETED / STORED | this repository (`submitBatch`, gateway import) |
| B | 5 | = `r2_object_key` (identical) | set (key, uri, sha256) | PENDING / COMPLETED, PARTIAL, SUPERSEDED | the external R2 pipeline |
| C | **10** | **NULL** | **all set** (`raw/<yyyy>/<mm>/<dd>/<uuid>/<name>`, 64-hex sha256) | PENDING / COMPLETED 4, SUPERSEDED 3, FAILED 2, PARTIAL 1 | the external R2 pipeline (earlier behaviour) |

- Group C has 10 distinct `r2_object_key` values (max length 79), **no collision** with any existing `file_key`, `total_rows` 1–5, no dependent `import_records` or `import_logs`, no source or creator. Created over two days (27 and 28 Sept, 943 s and 9890 s spreads).
- ~~Interpretation: the pipeline first wrote only `r2_object_key` and later also fills `file_key`~~ **Superseded by §10:** the groups are interleaved in time (C, C, C, B×5, C×7; the last row written is group C), and the writer's code never references `file_key`. `status` stays PENDING because the pipeline tracks its own `processing_status`.
- Application dependencies in this repository: only two writers (`admin-import.service.ts` `submitBatch`, which always sets `file_key`, and the gateway import in `route.ts`, which always sets it). **Nothing reads `file_key`** (no SELECT of it in the API, gateway, frontend, scripts, views or functions). The admin batch list does not select it.
- The Drizzle schema also differs from production in the opposite direction: the ORM cannot see the 10 extra columns, so any code that rewrites a row through Drizzle leaves them untouched but cannot inspect them.

## 3. Options (re-evaluated)
| Option | Verdict |
|---|---|
| A. Leave as is (accepted drift) | Safe today; the drift stays, `drizzle-kit push` would fail on it, and the contract is unclear. |
| B. Sentinel backfill + NOT NULL (the old proposal) | **Rejected**: discards the real object location that is available, and NOT NULL could break the external writer. |
| C. Backfill from `r2_object_key`, keep the column nullable for now | **Recommended first step** (data-only, reversible, no contract change). |
| D. C, then enforce NOT NULL | Only after the external writer is identified and confirmed to set `file_key` on every insert (see §6). |
| E. Make the schema honest: nullable `file_key` plus the 10 columns in Drizzle | Possible end state if the R2 pipeline is permanent; needs the owner's decision and its own migration (`ADD COLUMN IF NOT EXISTS`). |

## 4. Recommended migration (draft, do not add until approved and rehearsed)
Migration `0018_file_key_from_r2_key` (`when` > 1796500000000), **data only**; no DDL:

```sql
-- Group C rows carry the true object location in r2_object_key; copy it, as the pipeline already does for newer rows.
UPDATE "import_batches" SET "file_key" = "r2_object_key"
 WHERE "file_key" IS NULL AND "r2_object_key" IS NOT NULL;
```
- **Fresh installs and the rehearsal:** the column `r2_object_key` does not exist on a fresh database built from the migrations, so the statement would fail there. The migration must therefore be guarded, for example inside `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='r2_object_key') THEN EXECUTE '...'; END IF; END $$;` (no-op everywhere the column is absent). Add a PGlite test for both situations (column present with NULL rows; column absent).
- Rows with `file_key IS NULL AND r2_object_key IS NULL` (none today) are left alone and reported by the validation below.
- No snapshot content change is needed (no DDL); add `0018_snapshot.json` as a copy with a new id/prevId to keep the chain.
- Idempotent: a second run updates nothing.

## 5. Validation queries (read-only)
Before (record the output next to the backup): 
```sql
SELECT count(*) FILTER (WHERE file_key IS NULL) AS null_file_key,
       count(*) FILTER (WHERE file_key IS NULL AND r2_object_key IS NOT NULL) AS backfillable,
       count(*) FILTER (WHERE file_key IS NULL AND r2_object_key IS NULL) AS unfillable
  FROM import_batches;                                   -- expected 10 / 10 / 0
SELECT id FROM import_batches WHERE file_key IS NULL ORDER BY id;   -- keep this id list (ids are not secrets) for rollback
SELECT count(*) FROM import_batches k WHERE k.file_key IS NOT NULL
   AND k.file_key IN (SELECT r2_object_key FROM import_batches WHERE file_key IS NULL);   -- expected 0 (no collision)
```
After: `null_file_key` = 0; `SELECT count(*) FROM import_batches WHERE file_key IS DISTINCT FROM r2_object_key AND r2_object_key IS NOT NULL` = 0 (all R2 rows consistent); row counts of `import_batches`, `import_records`, `import_logs` unchanged; no other column of any row changed (compare `updated_at`: the statement should not touch it); `npm run db:rehearsal compare` must be given a one-field exception for `importBatchesNullFileKey` 10 -> 0 (update its rule together with the migration); the application smoke test of an admin import still creates a batch.

## 6. Rollback and recovery
- Rollback of the backfill uses the id list captured before: `UPDATE import_batches SET file_key = NULL WHERE id IN (<the 10 ids>)`. **Do not roll back by the condition `file_key = r2_object_key`**, which would also null the 5 group-B rows that legitimately have it.
- The backup/branch taken before the run is the authoritative recovery.
- No lock beyond a 10-row row update.

## 7. Risks
- Enforcing NOT NULL (option D) can break the external R2 pipeline if any code path still omits `file_key`. Group B suggests it now sets it, but that is an inference from five rows, not proof.
- Unknown owner/location of the R2 pipeline (and of the 10 extra columns): another service, a manual process, or an unreleased branch. It may also be writing other tables outside this repository's knowledge; the audit now lists database columns the schema does not define (informational note) to make such drift visible.
- Fresh installs lack the 10 columns, so that pipeline cannot run against a fresh install of this repository.
- The backfill assumes `r2_object_key` is the right value for `file_key`; group B (5 of 5 identical) supports it.

## 8. Unresolved questions (for the operator)
1. What writes `r2_object_key` / `r2_uri` / `sha256_checksum` / `processing_status`? Is it still running, and where does its code live?
2. Is `file_key` meant to equal `r2_object_key` for those rows (group B suggests yes)?
3. Should the schema adopt the 10 columns (option E), or should the pipeline be changed to stop using this table?
4. Is NOT NULL on `file_key` still wanted, or should the schema be relaxed to match production (nullable)?

## 9. Approval gates
1. Operator answers questions 1 and 2 (read-only confirmation is enough).
2. Approve implementing migration 0018 (data-only backfill, guarded) with its tests.
3. Rehearse 0018 on the rehearsal branch (remote write on the branch only) with the validation queries.
4. Separate approval for the production run (together with the already pending 0003–0017 decision).
5. NOT NULL enforcement is a separate later decision (option D), only after question 1 is answered.

## 10. The external writer: identified (Phase 6.30b, read-only)

### 10.1 Who writes `r2_object_key` and friends
**The "Orion Data Pipeline", a separate project with its own git repository on the same machine** (`D:\datas storing\datas storing`, Python `python_pipeline/` plus `server.py`; not part of this repository). Confidence: **high**.
Evidence (no object keys, file names, hashes or secrets were read or printed):
1. Its migration `003_create_import_batches.sql` defines `import_batches` with exactly the extra columns found in production (`sha256_checksum`, `r2_object_key`, `r2_uri`, `content_type`, `source_type`, `processing_status`, `total_rows`, `successful_rows`, `failed_rows`, `error_summary`), and its code (`python_pipeline/batch_manager.py`, `create_batch`) inserts `filename, sha256_checksum, r2_object_key, r2_uri, file_size, content_type, source_type, processing_status`.
2. Production has a table `schema_migrations` (a migration tool this repository does not use) with 13 versions whose names match that project's migration files (`001_create_deduplication_tables.sql` … `013_create_deleted_leads_and_execution_logs.sql`), applied 2026-09-28 06:42–07:16 UTC.
3. Production holds 20 tables and many columns that this repository does not define (`pipeline_jobs`, `execution_logs`, `import_logs`, `master_businesses`, `dataset_versions`, …); `pipeline_jobs` has exactly **15 rows**, linked to exactly the **15 R2-origin batches** (10 group C + 5 group B), 13 COMPLETED and 2 FAILED, with 119 `execution_logs` rows.
4. Its environment variable names (`R2_*`, `DATABASE_URL`, `AUTO_MIGRATE`, `WORKER_*`) match the behaviour; this repository's own code never writes those columns or the `raw/` key shape.
Other repository material checked: this repository has no CI/CD files, no `vercel.json`, no job definitions, no logs other than `staging-e2e.log`, and no mention of these columns in code, docs, configuration or git history of any branch.

### 10.2 Is it still active?
- Last database writes: `pipeline_jobs` 2026-09-29 12:31 UTC, `execution_logs` 12:31 UTC, `import_batches` 12:31 UTC. **Nothing since** (server time at the check: 2026-10-01 20:11 UTC, about 2.3 days later). The only connection to the database during the check was the inspection itself.
- The project's repository is under active development: last commits 2026-10-01 12:59 and 13:44 IST (a "People manual source pipeline" and a migration-runner "baseline bootstrap" fix), 2026-09-27 initial commit.
- `server.py` runs its own migrations at start unless `AUTO_MIGRATE` is disabled (default **on**).
- Conclusion: actively developed (high confidence); **whether a worker or server is currently running against production cannot be confirmed** from the database (no recent activity, no distinguishable connection) or from this repository.

### 10.3 Does its code always populate `file_key`?
**No, it never does.** The string `file_key` does not occur anywhere in that project (code, SQL, tests, documents, git history of all branches); its `create_batch` INSERT omits it, and its own definition of `import_batches` has no `file_key` column. It writes only `r2_object_key`.
Consequences:
- Setting `NOT NULL` on `file_key` would make that INSERT fail, so **enforcement (option D) is unsafe** while that code writes to this table.
- The 5 group-B rows where `file_key = r2_object_key` are **unexplained**: not produced by the pipeline code (no reference), not by this repository (different key shape), interleaved in time with group C rows, and no trigger or default exists in the database. Most likely a manual or one-off update. It is evidence of intent, not of a mechanism.
- Group A (4 rows, 25 Sept) predates the pipeline's migration run (28 Sept).
- Also unexplained: the pipeline's migration uses `CREATE TABLE IF NOT EXISTS import_batches`, which does nothing on a table that already exists, yet production has the pipeline's columns (all nullable, unlike its definition) and a nullable `file_key`. Someone added the columns and dropped the constraint by hand or with a script that is in neither project.

### 10.4 Is `file_key` defined as equivalent to `r2_object_key`?
**Not documented anywhere available.** No column or table comments exist in the database, no constraint relates them, neither project's documents define the mapping, and the pipeline does not know `file_key`. In this repository `file_key` means "storage object key of the uploaded file" (written as `imports/<ts>-<name>`), which is semantically what `r2_object_key` is, and 5 of 5 rows that have both are identical. Equivalence is therefore **plausible and data-consistent, but an assumption, not a contract**; it needs the owner's confirmation.

### 10.5 Consequences for the plan
- A one-off backfill (option C) would only fix existing rows: any further pipeline run would add new NULLs. It is safe data-wise but not a durable fix.
- NOT NULL enforcement (option D) must **not** happen until the pipeline stops omitting `file_key` (a change in the other project) or the schema is changed to accommodate it.
- Durable choices (operator and owner decision): (E) declare the shared columns in this repository's schema and keep `file_key` nullable; (F) have the pipeline write `file_key` too; (G) a database-side `COALESCE(file_key, r2_object_key)` default via trigger. None is implemented.
- **New blocker found while identifying the writer (more serious than `file_key`):** both projects define `people` and `person_contacts` with **different columns**, both with `CREATE TABLE IF NOT EXISTS`. Production has neither table yet. Whichever system creates them first silently wins and the other's `IF NOT EXISTS` becomes a no-op, leaving that system's code facing the wrong columns. This repository's pending migrations (0004–0016) create `people`, `person_contacts` and 13 other People tables; the pipeline's own `013_create_people_intelligence_layer.sql` (and its auto-migration at start, default on) creates its own `people` and `person_contacts`. Production's `schema_migrations` lists a different `013` (`…deleted_leads_and_execution_logs`), so the pipeline's local migration set has since diverged from what production recorded.
  The rehearsal branch passed because this repository's migrations ran first on a database where those tables did not exist; that proves nothing about coexistence. See the runbook (§15).

### 10.6 Unresolved and safest next step
Unresolved: (1) is the pipeline process running now; (2) who dropped `file_key` NOT NULL and added the columns, and who set `file_key` on the 5 rows; (3) which system is meant to own `people` / `person_contacts`; (4) is `import_batches` meant to be shared long term.
Safest next step (no database access needed): **ask the owner of the Orion Data Pipeline** (and decide ownership of the shared tables) before any production migration: confirm (a) the pipeline is stopped or `AUTO_MIGRATE=0` for the migration window, (b) which system owns `people` / `person_contacts`, (c) whether it can write `file_key`. Until then keep `file_key` untouched, do not create migration 0018, and do not run the pending migrations on production.
