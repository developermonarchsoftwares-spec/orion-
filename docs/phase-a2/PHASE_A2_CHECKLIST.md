# Phase A2: execution checklist for the read-only evidence checks

Companion to `PHASE_A2_READONLY_EVIDENCE_CHECKS.sql` (same folder). **Status: prepared for human approval; nothing has been executed, no database was contacted, no existing file was modified.**

## 0. Fact classes used in this document
- **CONFIRMED (this phase)**: read directly from the two repositories' files today (static reading).
- **PRIOR EVIDENCE**: observed in earlier read-only database checks (Phases 6.22–6.30, 2026-10-01). It describes the database at that time. **It must not be treated as the current state or as proof of any runtime.**
- **UNRESOLVED**: nobody has established it; the checks exist to find out, or an owner must answer.

## 1. Owner decisions this package serves
| Decision | Check(s) that produce evidence | Not decidable from the database |
|---|---|---|
| The pipeline owns People ingestion and records | C04, C03, C11 | the ownership itself |
| Orion reads published People through a read-only interface | C04, C11, C12 | the interface design |
| Orion's `businesses.status` is the publication authority (pending contract verification) | C05 (extra columns), **C14** (cross-tab of `status` vs the pipeline's `publishing_status`) | which system writes which flag |
| Separate least-privilege application and migration roles | C03, C11 (roles, owners, grants, default privileges) | the target design |
| Do not map `file_key` to `r2_object_key` without proof | **C08** (key presence, equality, URI scheme, checksum shape, counters) | semantic equivalence: equality of values on some rows is not a contract |

## 2. Repository-side migration history (CONFIRMED, verified this phase)
**Orion (`apps/api/src/database/migrations`)**
- `meta/_journal.json`: 18 entries, `idx` 0–17 equal to the file numbers, `when` strictly increasing from 1789041177967 (0000) to 1796500000000 (0017). Drizzle runs an entry only if its `when` is **greater than the newest `created_at` recorded in `drizzle.__drizzle_migrations`**; it never compares hashes.
- Tracking table (from drizzle-orm source): `drizzle.__drizzle_migrations(id serial, hash text, created_at bigint)`; `created_at` stores the journal `when`, `hash` stores `sha256(file bytes)` (line endings matter).
- First-8-hex-of-sha256 of each current file are embedded in C01. Prior evidence: the three rows recorded for 0000–0002 had the same 8-hex values as the files have today.
- Git state: 0000–0002 are committed; **0003 is journaled but 0004–0017 and their snapshots are untracked (28 untracked files, 2 modified)**: the history that production would be compared with is not in version control yet.

**Orion Data Pipeline (`D:\datas storing\datas storing`)**
- `migrations/` has 14 files, `001`–`014`, directory clean at HEAD `518c68f`. `001`–`012` come from the initial commit (2026-09-27); `013_create_people_intelligence_layer.sql` and `014_create_execution_logs.sql` were added by commit `4861c6d` (2026-10-01).
- Tracking table: `schema_migrations(version varchar(255) PK, applied_at)`; the runner records **file names only** (no hashes) and runs every file not yet recorded, one `execute` per file, committing after each. Applying a file the database already recorded never happens, so an edited applied file is invisible from the database.
- **Working-tree caveat:** `server.py` and `python_pipeline/migrate.py` have uncommitted modifications. The behaviour described in Phase A was read from the working tree; the committed versions may differ.
- `AUTO_MIGRATE` is read only in `server.py:start_server()` and defaults to on when unset.

## 3. PRIOR EVIDENCE (dated 2026-10-01; not current)
- Orion history table: 3 rows, equal to journal entries 0000–0002 (newest applied `when` 1789061231383).
- Pipeline `schema_migrations`: 13 versions, 2026-09-28 06:42–07:16 UTC, including `013_create_deleted_leads_and_execution_logs.sql` (no such file in the pipeline repository history) and duplicate rows for 004, 005 and 011 without the `.sql` suffix.
- `import_batches`: 19 rows in three groups (4 Orion-written with `imports/…` keys; 5 pipeline-written with `file_key` equal to `r2_object_key`; 10 pipeline-written with `file_key` NULL); `processing_status` values COMPLETED, SUPERSEDED, STORED, PARTIAL, FAILED; no code in either repository writes `SUPERSEDED`.
- 20 tables and many columns in `public` that Orion's schema does not define; Orion code never references the pipeline-only tables.
- Roles seen: `neondb_owner`, `neon_service`; only the inspecting connection was visible.
- `people` and `person_contacts` and the other People tables did not exist yet.

## 4. UNRESOLVED (what this package tries to settle or hand to owners)
Is any pipeline process connected or writing now; who created the out-of-band columns; what writes `SUPERSEDED` and `file_key` on five rows; whether `r2_uri` values carry the live or the mock scheme; which view/object dependencies exist on `orion_published_businesses`; which roles exist and what they may do; whether publication flags agree between the two systems.

## 5. Review log: corrections made to the checks proposed in Phase A
| # | Defect in the earlier approach | Fix in the SQL file |
|---|---|---|
| 1 | `split_part(r2_uri, '://', 1)` returns the **whole URI (including the object key)** when a value has no `://` | C08b extracts only a matched scheme via a guarded regex; anything else prints `<other>` |
| 2 | `pg_views.definition` / `pg_get_viewdef` / `pg_get_functiondef` expose SQL text | C12 selects view names, owners and dependents only; no definitions anywhere |
| 3 | `pg_stat_activity` filtered by `datname = current_database()` **shows nothing for other roles' sessions without `pg_read_all_stats`**, which reads as "no other connections" | C00 reports the privilege; C10a counts blanked sessions; C10 states the stop rule |
| 4 | `query`, `client_addr`, `client_hostname` could be selected by habit | never selected |
| 5 | `information_schema.table_privileges` only lists grants the current role may see | C11c/C11d use `pg_class.relacl` + `aclexplode` and count NULL-ACL relations separately |
| 6 | `GROUP BY 1, 11` style positional grouping broke once (Phase 6.30) | explicit expressions or positions that are verified against the select list |
| 7 | `pg_get_functiondef` on aggregates raised 42809 | no function definitions are read at all |
| 8 | `created_at::date` converts in the session time zone | all timestamps use `AT TIME ZONE 'UTC'` |
| 9 | A failed statement inside one transaction aborts everything after it | every check is its own `BEGIN READ ONLY … ROLLBACK` block |
| 10 | Pooled (`-pooler`) endpoints hide sessions and do not keep `SET LOCAL` reliably | run on the direct endpoint |
| 11 | Exact `count(*)` of large tables | activity uses `pg_stat_user_tables` estimates; exact counts only on the small batch/ledger/aggregate checks |
| 12 | Missing check for the publication-authority decision | **C14** added |
| 13 | Drizzle history compared by name | C01 compares by `created_at` (the value Drizzle actually uses) and flags unknown rows both ways |

Static review limits: no SQL parser was available and nothing may be executed, so the file was checked by inspection plus mechanical tests only (no write keywords outside comments and literals; 20 `BEGIN READ ONLY` matched by 20 `ROLLBACK`; balanced parentheses in all 95+ statements; no placeholders left; no `pg_authid`, query text, definitions or addresses selected). Syntax and column existence against the live catalogue are **not verified**; the first execution is the real test, and a 42601/42703/42P01 error must be recorded, not patched on the spot.

## 6. Before running (all required)
- [ ] Written approval from the owner for a read-only run, naming the database and the time window.
- [ ] The target is the intended Neon database and endpoint is the **direct** one (no `-pooler`). Verify by comparing `database_name`/server version in C00 with what the owner expects (host names are not secrets; connection strings are never pasted anywhere).
- [ ] The connection string is held only in the operator's own shell environment; it is never printed, logged, committed or sent to the assistant.
- [ ] Client: `psql -X` (no `.psqlrc`), default error behaviour (**no** `ON_ERROR_STOP`). Optional extra belt: `PGOPTIONS="-c default_transaction_read_only=on"` (direct endpoint only).
- [ ] Output goes to a local file readable only by the operator; it will be reviewed before sharing (section 9).
- [ ] No worker, server or watcher is started, stopped or reconfigured for this run.
- [ ] Decide which role connects. Today the only roles seen were `neondb_owner` and `neon_service` (PRIOR); using the owner role is acceptable **only** because the blocks are read-only and each is time-capped. Record which role was used (C00).

## 7. Checks: purpose, permissions, exposure, expected evidence, interpretation, limits, stop conditions
Legend: **Elev** = needs more than ordinary catalogue read access. **Data** = reads table contents (aggregates only), so the role needs SELECT on those tables. Exposure: none / low / medium.

| ID | Purpose | Elev / Data | Exposure | Expected evidence (not a prediction of the current state) | Interpretation | Limitations | Stop conditions |
|---|---|---|---|---|---|---|---|
| C00 | Server enforces read-only; which DB/version/role; can the role see other sessions | no / no | low: role and DB name | `read_only = on` | `can_read_all_stats` decides whether C10 can be read | none | **`read_only <> on`**: stop everything |
| C01, C01s | Orion history vs the 18-entry journal, by `created_at`, with hash prefix | no / no | none | PRIOR: 3 matching rows, 15 pending | `in_journal=false` rows ⇒ different journal; newest applied > 1796500000000 ⇒ newer journal. Hash mismatch ⇒ edited file *or* line endings | cannot show what a run would do beyond the `when` rule | unknown rows or a newer timestamp: stop and escalate; do not migrate |
| C02 | Pipeline history vs the repository's 14 file names | no / no | none | PRIOR: 13 recorded names with a different 013 and duplicates without `.sql` | recorded-but-not-in-repo ⇒ history diverged; in-repo-but-unrecorded ⇒ would run at next auto-migrate | names only (no hashes) | table not found (42P01): record it, the table may live elsewhere |
| C03a/b | Schemas, relation counts by owner/kind | no / no | low: role names | public tables, `drizzle` schema; PRIOR: owner role owns everything | one owner for both apps ⇒ no privilege separation today | counts, not names | none |
| C04 | Existence of the boundary objects | no / no | none | PRIOR: People tables absent; `orion_pipeline.*` absent | any People object present ⇒ one side's DDL already ran: stop and re-plan | existence only, not shape | `public.people` present: do not run any People migration |
| C05, C05b | Column-level comparison of 7 shared tables vs Orion snapshot 0017 | no / no | none | PRIOR: extra pipeline columns on `import_batches`, `businesses`, `business_history`, `credit_transactions`, `saved_searches`, `duplicate_clusters` | `EXTRA_IN_DB` + NOT NULL + no default ⇒ Orion inserts fail; `TYPE_DIFFERS` on enum columns may be schema-qualification noise (read the row) | the snapshot is Orion's view of truth, not a verdict on ownership | an unexpected NOT NULL extra column on a table Orion inserts into |
| C06a/b/c | `import_batches` indexes, constraints, inbound foreign keys | no / no | low: index predicates contain status literals | PRIOR: FKs from `import_records`, `import_logs`, `pipeline_jobs` | missing `idx_import_batches_active_checksum` ⇒ pipeline's duplicate guard is not in force; cascade FKs show cross-system delete effects | structure only | none |
| C07 | Enum labels (`import_status`, role/status/verification/source enums) | no / no | none | Orion enum values | compares Orion's batch `status` vocabulary with the pipeline's free `processing_status` | none | none |
| C08a | `status` × `processing_status`; key presence, equality, URI/key consistency | no / **data** | none (counts, UTC timestamps) | PRIOR: 19 rows, 3 groups | `keys_equal` on some rows does **not** establish equivalence; `keys_differ > 0` would refute it | aggregates; groups of 1 describe a batch | 42703: the pipeline columns are absent: record, skip rest of C08 |
| C08b | Key prefix classes and `r2_uri` scheme | no / data | none (guarded extraction) | scheme is `r2`, `local-r2`, other or NULL | `local-r2` would mean mock storage wrote production rows; `r2` live | prefix classes only | any `<other>` class: report, do not extract more |
| C08c, C08c2 | Checksum shape and duplicate groups | no / data | none | 64-hex shaped | duplicate groups bear on the unique-active-checksum rule | counts only | none |
| C08d | `*_rows` vs `*_records` counters on pipeline-origin batches | no / data | none | pipeline writes only `*_rows` | large differences confirm the two counter sets are not synchronised | none | none |
| C09a | Table activity counters (estimates) | no / no | none | PRIOR: pipeline tables with inserts/updates | non-zero counters show past writes since the last reset; **zero is not proof of inactivity** (Neon compute restarts reset stats) | estimates, resets | none |
| C09b | `pipeline_jobs` by type/status, newest timestamps, distinct worker count | no / data | none (no payloads, no worker ids) | PRIOR: last job 2026-09-29 | newest heartbeat/update date the last activity; says nothing about a process now | dates a write, not a process | none |
| C09c | `execution_logs` by level and newest time | no / data | none (messages, entity and file names are **not** selected) | PRIOR: 119 rows, last 2026-09-29 | dating only | none | none |
| C09d | Newest timestamps on `businesses`, `users`, `credit_transactions` | no / data | low: counts and dates of customer-adjacent tables | recent writes expected from Orion | dates the last write, not the writer | cannot attribute | none |
| C10a/b | Who is connected now (role, application name, state, counts) | **yes: `pg_read_all_stats` / `pg_monitor`** / no | medium: role names, application names, session start times; **never** query text, addresses | PRIOR: only the inspecting session | readable only if `can_read_all_stats` and `hidden_client_sessions = 0` | one-second snapshot; a periodic worker may connect briefly; pooled endpoints blur it | **`hidden_client_sessions > 0`: do not conclude anything**; report incomplete visibility |
| C11a–g | Roles, memberships, grants, default privileges, schema and database ACLs | no (world-readable catalogues; `pg_authid` is deliberately not used) / no | low: role names, ACL strings (no credentials) | PRIOR: `neondb_owner`, `neon_service` | shows what a least-privilege split must change | Neon-managed roles need not be application roles; NULL ACL = owner-only defaults (C11d counts them) | none |
| C12a/b | Views and views that depend on `orion_published_businesses` | no / no | none (no definitions) | pipeline-owned view, possibly no dependents | a dependent view owned by Orion ⇒ a pipeline `DROP VIEW … CASCADE` would remove it silently | C12b is empty if the view does not exist (see C04) | none |
| C13a | `users.role` distribution and date range | no / **data** | low: counts only, no identities | Orion enum roles only | a value outside Orion's enum is impossible in an enum column; `'customer'`-style rows would indicate another writer | counts of small groups | stop if the role column is not an enum and unfamiliar values appear: report counts only |
| C13b | Ledger rows with the pipeline-only columns | no / data | low: counts only, no amounts or ids | PRIOR: such columns exist | non-zero ⇒ the pipeline writes the credits ledger | 42703 ⇒ columns absent | none |
| C13c | Size of the pipeline `accounts` table | no / data | none | unknown | non-zero ⇒ the pipeline's customer layer has data | none | none |
| C14a/b | `businesses.status` vs `publishing_status`/`stage`; disagreement counts | no / **data** | none (counts only) | unknown | disagreement ⇒ two publication authorities in practice; agreement does not prove which system writes which flag | cannot attribute writers | 42703 ⇒ pipeline columns absent: record |

### Which checks need elevated catalogue permissions
- **Only C10 (`pg_stat_activity` details)** needs `pg_read_all_stats` (or `pg_monitor`/superuser). Without it the check is still safe to run but cannot support a "no other connections" statement.
- Nothing needs superuser. `pg_authid` (password hashes, superuser-only) is not used; `pg_roles` is.
- **Data-reading blocks (aggregates only) need SELECT on the tables they read:** C08, C09b, C09c, C09d, C13, C14. They touch tables that sit next to customer data (`users`, `credit_transactions`, `businesses`); the approval should name them explicitly. A role without SELECT gets 42501: record it.

## 8. Queries or columns flagged for exposure review
- **C08b** URI/key handling (guarded; a naive version leaks object keys).
- **C09c** `execution_logs` (messages, `entity_name`, `batch_filename` can hold file names and business names): **deliberately excluded**.
- **C10** query text, client addresses: **deliberately excluded**; role and application names are included.
- **C12** view bodies: **deliberately excluded**.
- **C11e–g** ACL strings name roles; no credentials.
- **C13/C09d** touch `users` and `credit_transactions`: counts and ranges only, no ids, emails, amounts or names.
- **C06** index predicates contain status literals (not data).
- Not in the file on purpose: any `SELECT *`, any use of `pg_authid`, `pg_shadow`, `pg_stat_statements`, `pg_get_functiondef`, `pg_get_viewdef`, `pg_stat_ssl`, or row-level reads of `import_batches`, `users`, `credit_transactions`, `execution_logs`.

## 9. Running and handling the output
1. Run the file top to bottom in one `psql -X` session on the direct endpoint. Expect roughly 40 result sets and a few seconds of runtime; each block is capped at 15 s (`57014` = timeout: record and continue).
2. Keep errors in the output: `42P01`, `42703`, `42501` are evidence.
3. Before sharing: scan the saved output for anything that looks like an email, token, URL or file name; there should be none by design. Redact and tell the reviewer if anything is found, and stop using that check.
4. Return the result sets (not the connection details) together with the exact time of the run and the role used.
5. Do not act on the results in the same session: no repairs, no grants, no migrations.

## 10. Global stop conditions
Stop the run and escalate if: C00 does not show `read_only = on`; the endpoint or database name is not the one the owner approved; a statement other than a SELECT is about to execute; any output unexpectedly contains personal data, a secret or a connection string; the run is slow enough to risk interfering with production (more than two `57014` timeouts); C10a shows hidden sessions and anyone proposes to treat the database as quiet.

## 11. What this package does not do
It does not prove the current runtime state of any process, does not attribute writes to a system, does not validate the owner's decisions (it only gathers evidence for them), and does not create roles, grants, schemas or views. Writing the `orion_pipeline` boundary, the read-only published-People view and any grants remains for a later, separately approved phase.
