# Target architecture: Orion and Orion Data Pipeline on one Neon database

**Status: PROPOSAL for owner review. Not approved, not implemented.** Date: 2026-10-02. Nothing in this document creates, alters, grants or migrates anything. It was prepared from static review of both repositories (working trees and committed history); no database was contacted and no SQL was executed. Production facts are cited only as historical observations (HIST, 2026-10-01) and must be re-verified (Phase A2 evidence run) before any decision depends on them.

Companion documents: `DATABASE_OWNERSHIP_MATRIX.md`, `PIPELINE_RUNTIME_RISK_REGISTER.md`, `MIGRATION_REHEARSAL_PLAN.md`, `PRODUCTION_CHANGE_REQUEST_TEMPLATE.md`, `PHASE_A2_APPROVAL_READINESS.md`, `MIGRATION_RUNBOOK.md`.

## 0. Evidence labels
**WT** verified in a working tree; **HEAD** verified in committed history; **HIST** earlier audit observation, not current; **RUNTIME?** needs verification of the deployed system or the database; **DECIDED** stated by the owner; **PROPOSED** this document's proposal.

## 1. Goals and constraints
- Orion owns the customer-facing product: accounts, lead discovery, credits, saved searches, exports. The pipeline owns ingestion, cleaning, enrichment, validation and pipeline-owned People records. (DECIDED direction)
- PostgreSQL provides explicit schema boundaries, permissions and documented contracts, not shared unrestricted tables.
- Existing production data, uncommitted code, migration histories and user accounts are preserved. No destructive consolidation is proposed.
- Keep the current production schema unchanged during the initial architecture phase; every step is separately approved, rehearsed and recoverable.

## 2. Current state in one page (static, partly HIST)
| Topic | Finding | Evidence |
|---|---|---|
| Shared tables | Both systems write `users`, `credit_transactions`, `saved_searches`, `businesses`, `business_history`, `duplicate_clusters`, `import_batches` | Ownership matrix Part II |
| Migration systems | Orion: Drizzle journal (`drizzle.__drizzle_migrations`, by timestamp). Pipeline: `schema_migrations` by file name. Independent and unaware of each other | `apps/api/src/database/migrate.ts`; `python_pipeline/migrate.py:98-125` |
| Startup migration | Orion: none (no migrate call in `main.ts`/`app.module.ts`, HEAD and WT). Pipeline: auto-migrate at server start, default on, **uncommitted** (WT `server.py:1724-1731`; absent at HEAD) | Risk register RR-01 |
| Out-of-band schema | Pipeline columns exist on six shared tables in production but in neither repository's migrations | HIST |
| People | Both define `people`, `person_contacts` with different columns, both `IF NOT EXISTS`; production had neither | Risk register RR-05; HIST |
| Publication | Orion customer reads gate on `businesses.status = 'PUBLISHED'`; pipeline publishes via `publishing_status`/`stage`/`published_at` and never writes `status` | Matrix II.1 `businesses` |
| Roles | One owner role appears shared (`neondb_owner`, `neon_service`) | HIST; verify with Phase A2 C11 |
| Runtime | Which processes run, where, against which database: unknown | RUNTIME? |

## 3. Ownership model (PROPOSED)
| Area | Owner | Notes |
|---|---|---|
| Customer identity, credits, wallets, saved searches, exports | Orion | pipeline writers retired or restricted (matrix II.2) |
| Product-facing publication state of a business | Orion (`businesses.status`) | proposed authority; verify against data first |
| Ingestion batches, raw-file provenance, enrichment, verification, freshness attributes | Pipeline | by column group where the table is shared |
| People records and People pipeline state | Pipeline | DECIDED; placed in schema `orion_pipeline` (PROPOSED) |
| Orion-side customer state on People (unlocks, saved items, credit charges) | Orion | references pipeline records by stable id (see §5.4) |
| Migration bookkeeping | Each runner owns its own table, in its own schema | §4 |

No table is declared finally owned until Phase A2 evidence and the owner's written decision exist.

## 4. Schema boundaries (PROPOSED)
```
public                 Orion application tables (Drizzle), unchanged during the initial phase
drizzle                Orion migration history (exists)
orion_pipeline         NEW, pipeline-owned: the six People tables first, later other pipeline-only tables
                       and the pipeline's migration history (schema_migrations moves here in a later, separate step)
```
- Initial pipeline-owned set in `orion_pipeline`: `people`, `company_person_relationships`, `person_contacts`, `person_import_records`, `person_change_history`, `person_conflicts`. Because the schema differs from `public`, the names cannot collide with Orion's existing `public.people` and `public.person_contacts`.
- Existing tables stay where they are. The shared tables stay in `public` until their ownership and dependencies are mapped; they are not moved in one large migration.
- The pipeline's other tables in `public` (HIST: `pipeline_jobs`, `import_logs`, `execution_logs`, `master_businesses`, …) are moved, if ever, one group at a time under their own change requests.
- Nothing is dropped, renamed or relocated as part of this proposal.

## 5. People integration

### 5.1 Principle
Orion reads **published** People data through an explicit, versioned, read-only view. Orion has no write path to pipeline People tables, and the pipeline has none to Orion's customer-state tables.

### 5.2 Proposed view contract: `orion_pipeline.published_people_v1` (PROPOSED)
Explicit column list (no `SELECT *`); based on the pipeline's existing `orion_published_people` view (`migrations/013_create_people_intelligence_layer.sql:188-243`), which already lists columns explicitly and exposes contact **status**, never contact values. Types/nullability below follow the pipeline's table definitions and must be re-confirmed against the real tables in rehearsal.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `relationship_id` | uuid | no | stable id of the person-company relationship (primary reference for Orion) |
| `person_id` | uuid | no | stable person id |
| `business_id` | uuid | no | `businesses.id` (shared table) |
| `business_slug` | varchar | no | convenience; not a key |
| `master_business_id` | uuid | yes | canonical company id when resolved |
| `full_name`, `first_name`, `middle_name`, `last_name` | varchar(255/100) | name: no; parts: yes | |
| `job_title`, `normalized_job_title` | varchar(255) | yes | |
| `department`, `seniority_level`, `decision_maker_type` | varchar | yes | |
| `city`, `state`, `country` | varchar(100) | yes | |
| `verification_status` | varchar(30) | no | `VERIFIED` or `PARTIALLY_VERIFIED` in the view |
| `confidence_level` | varchar(10) | no | |
| `freshness_status` | varchar(30) | no | never `STALE` in the view |
| `first_seen_at`, `last_seen_at`, `last_changed_at` | timestamptz | no | |
| `last_verified_at`, `published_at` | timestamptz | yes | |
| `has_email`, `has_phone`, `has_linkedin` | boolean | no | availability only |
| `email_verification_status`, `phone_verification_status`, `linkedin_verification_status` | text | yes | `VERIFIED` / `UNVERIFIED` / null |
| `contract_version` | smallint | no | constant `1`; lets consumers detect a breaking successor |

Deliberately excluded: contact values (`value`, `raw_value`), `verified_by`, `published_by`, `profile_url`, `linkedin_url`, any evidence text, internal ids of imports. Revealing a contact stays a credit-gated Orion action reading values through a separate approved path (open decision, §5.5).

### 5.3 Publication-state rules (PROPOSED; the owner must approve each)
| State | Handling in the view |
|---|---|
| Not published / `NOT_READY` / `UNPUBLISHED` | absent |
| Verification below `PARTIALLY_VERIFIED` (unverified, conflicted) | absent |
| Stale (`freshness_status = 'STALE'`) | absent |
| Relationship ended (`is_current = false`) | absent |
| Suppressed or withdrawn (person asked to be removed) | absent immediately, and recorded in a tombstone view `orion_pipeline.published_people_removed_v1` (`person_id`, `relationship_id`, `removed_at`, `reason_code`) so Orion can purge caches and customer-visible copies |
| Record deleted | absent; tombstone as above |
| Company no longer published | absent (join to the published company) |

The company-publication join currently depends on the pipeline's `orion_published_businesses` view; whether the filter should instead use Orion's `businesses.status` follows the publication decision (§6) and must not be changed before that is verified.

### 5.4 Orion's existing People model (open decision)
Orion already has its own People tables in `public` (`people`, `company_people`, `person_contacts`, `person_unlocks`, `people_evidence`, `people_verifications`, `people_sources`, `people_observations`, … created by uncommitted migrations 0004–0016; HIST: not in production). Code consumers: `apps/api/src/modules/people/*` (5 controllers), the gateway (`route.ts:2669-2690` reads `company_people`, `person_contacts`, `people_evidence`), and front-end components (`ownus/src/components/people/company-people-section.tsx`, admin People views). `person_unlocks.person_id` references `public.people`.

Options (none chosen):
- **A. Orion keeps its own People model** and ingests from the published view through a reviewed sync; two copies, with clear direction of flow.
- **B. Orion reads the view directly**; Orion keeps only customer state (unlocks, saved items) in a thin reference table keyed by the pipeline's `person_id`/`relationship_id`; Orion's People tables are retired.
- **C. Hybrid**: B for reading, A for fields Orion must edit locally.
The choice decides whether Orion's migrations 0004–0016 should ever run in production. They must not run in production until this is decided.

### 5.5 Access control
Orion's application role gets `USAGE` on `orion_pipeline` and `SELECT` on the published views only, never on base tables. Contact-value retrieval, if kept in Orion, needs its own separately approved view or function and an audit trail.

### 5.6 View evolution rules
- Never `DROP VIEW … CASCADE` (RR-04). Changes use `CREATE OR REPLACE VIEW` with a compatible column list (new columns appended); breaking changes create `…_v2` and keep `…_v1` until consumers move.
- A drop-and-recreate resets a view's privileges; grants are therefore part of the migration that creates the view and are verified by a test.
- Every change to a published view requires a dependency check and a contract test (§9.5).

## 6. Business publication contract (PROPOSED; do not change authority before verification)
Verified statically: Orion's customer-facing reads require `status = 'PUBLISHED'` (`discover.service.ts:197,357,498,509,528,534`, `unlock.service.ts:37,66`, `postgres-search.provider.ts:31`, gateway `route.ts:2536,2896`), while the pipeline's publish step sets `publishing_status`, `stage` and `published_at` and never `status` (`publishing.py:365-373`, `:529-536`). Unverified (RUNTIME?): the production column type of `status`, the data in both flag sets, and which system is meant to flip `status`.

Proposed contract once data is verified:
1. Orion's `status` is the single customer-visibility authority.
2. The pipeline never writes `status`. It records readiness in its own fields (`publishing_status`, `stage`, `verification_status`).
3. A defined hand-off sets Orion's `status`: for example a reviewed Orion operation (admin action or an API Orion exposes) driven by the pipeline's "ready to publish" signal. The mechanism (pull via view, push via API) is an open decision.
4. Documented mapping of pipeline states to Orion states, including duplicate (`DUPLICATE` is currently written by `verification.py:503` and does not exist in Orion's enum), rejected, archived and withdrawn.
5. Rows where the two disagree are reported, not silently reconciled.

## 7. Import batch contract v1 (PROPOSED)
Column-level ownership on `import_batches` (matrix II.1): Orion-owned (`status`, `*_records`, `file_key`, `created_by_id`, `mapping_config`, `options`, `people_summary`), pipeline-owned (`r2_object_key`, `r2_uri`, `sha256_checksum`, `processing_status`, `*_rows`, `error_summary`, `content_type`, `source_type`), shared-immutable (`id`, `filename`, `file_size`, `created_at`). Add an explicit origin discriminator rather than inferring origin from key prefixes. Consumers read declared consumer fields through a view. **`file_key` is not defined as `r2_object_key`.** No backfill, rename, constraint or repurposing occurs until the semantics and all writers are verified. The pipeline owns ingestion batches; handling of legacy rows is decided from evidence (Phase A2 C08), row by row group, not by assumption.

## 8. Roles and privileges (design only; no role is created)
Neon note: roles are managed through the Neon console/API. Creating them is a separate, separately approved production action. Connection strings per role live in each platform's secret store and are never committed.

| Role (proposed name) | Purpose | Schema usage | Table privileges | Sequences | View access | Notes |
|---|---|---|---|---|---|---|
| `orion_app` | Orion API/gateway runtime | `USAGE` on `public`; `USAGE` on `orion_pipeline` | `public`: `SELECT/INSERT/UPDATE/DELETE` on Orion-owned tables only; shared tables by column grants per the contract; **no** DDL | `USAGE, SELECT` on Orion sequences | `SELECT` on `orion_pipeline.published_people_v1` and tombstone view | not owner of any object; no `CREATE` |
| `orion_migrator` | Orion migrations | `CREATE, USAGE` on `public`, `drizzle` | owns Orion-created objects; may alter them | all Orion sequences | defines views it owns | used only by the explicit deployment step; never by the running app |
| `pipeline_app` | pipeline runtime (HTTP, workers) | `USAGE` on `orion_pipeline` and the `public` objects it must touch | `orion_pipeline`: DML; `public`: only pipeline-owned columns/tables (column grants on shared tables); **no** `DELETE` on `businesses` unless the contract grants it | its sequences | none on Orion-owned tables | `UPDATE (…)` column grants on `businesses`/`import_batches` limited to pipeline columns |
| `pipeline_migrator` | pipeline migrations | `CREATE, USAGE` on `orion_pipeline`; **no `CREATE` on `public`** | owns `orion_pipeline` objects; DDL on pipeline-owned `public` tables only if separately approved | its sequences | owns the published views | `schema_migrations` lives here |
| `orion_people_reader` (optional) | tighter read-only identity for the Orion read path | `USAGE` on `orion_pipeline` | none on base tables | none | `SELECT` on the published views only | can be the same grant on `orion_app` if separation is not wanted |
| break-glass owner (existing `neondb_owner`) | emergencies | all | all | all | all | credentials sealed; use is logged; not used by any application |

Rules: default privileges are set for each migrator so new objects do not inherit `PUBLIC` access; `PUBLIC` is revoked on both application schemas; no application role is superuser, `CREATEROLE` or `BYPASSRLS`; each application uses its own connection string; Orion never connects as the pipeline's roles and vice versa. Verification: Phase A2 C11 first records the existing roles and grants; a separate role-change proposal is written from that evidence.

## 9. Migration controls

### 9.1 Execution paths today (WT unless stated)
| Path | System | Behavior | Notes |
|---|---|---|---|
| `npm run drizzle:migrate` | Orion | explicit command; exits 1 on failure; remote targets need `MIGRATION_CONFIRM_HOST` | the guard is uncommitted |
| Orion app startup | Orion | no migration | verified (no migrate call) |
| `server.py` start | Pipeline | auto-migrates, default on; failure only warns | **uncommitted**; absent at HEAD (RR-01, RR-02) |
| `python -m python_pipeline.migrate` | Pipeline | explicit | HEAD |
| `run.bat:101` | Pipeline | migrate, abort on failure, then start server | **untracked** file |
| benchmarks/tests/fresh-migration check | Pipeline | `scripts/run_people_benchmark.py`, `run_source_run_benchmark.py` migrate and insert using `DATABASE_URL`; `run_fresh_migration_check.py` uses its own local database | RR-16 |

### 9.2 Desired behavior (PROPOSED)
1. Production migrations run only through an explicit, reviewed deployment step, by the migrator role.
2. Normal application startup never applies migrations; `AUTO_MIGRATE` defaults off in the pipeline and the committed code carries no automatic path.
3. A migration failure exits non-zero and fails the deployment; the application never starts in an inconsistent state because a migration warning was ignored.
4. Both runners take an advisory lock; the pipeline records a checksum per file and refuses an edited applied file.
5. Each runner refuses a remote target unless the host is explicitly confirmed and is not on a production deny-list for rehearsal runs (compare Orion's `staging-guard`).
6. Destructive migrations (drops, type changes, `DROP VIEW`) require explicit review, a dependency report and a tested recovery plan; `DROP … CASCADE` is not allowed in migrations.
7. Cross-system changes to shared tables require a joint change record referencing both journals.
8. Tests, benchmarks and scripts refuse any `DATABASE_URL` not on a disposable-database allow-list.

## 10. Worker and runtime controls (PROPOSED; see risk register for evidence)
- Separate roles for HTTP, worker and migration processes; a switch to run the HTTP server without the embedded worker.
- Heartbeat on its own timer, independent of record progress; stale recovery in one sweeper; idempotent job handlers; lease fencing.
- Signal handlers: stop claiming, finish or release the current job, close connections within a bounded time.
- A connection pool with limits and timeouts; fail startup when `DATABASE_URL` is missing instead of defaulting to localhost.
- Authentication on every mutating route; no client-declared roles; no unauthenticated delete or ingestion; an origin allow-list instead of CORS `*`; the self-service credits route removed.
- Orion: ship the already-written lifecycle fixes (pool ended in `onApplicationShutdown`, scheduler timers cleared); keep `enableShutdownHooks`.

## 11. Phased roadmap
Each phase needs its own approval. "Rollback" means returning to the pre-phase state without data loss.

| Phase | Work | Depends on | Acceptance criteria | Regression tests | Rollback requirement |
|---|---|---|---|---|---|
| P0 Baseline | Owner decides how to commit/stash/branch the uncommitted work in both repositories (owner action; not done by this task) | none | both repositories reproducible from a commit; migration journals committed | `npm test`, `npm run test:e2e` (hermetic) in Orion; pipeline unit tests only against a local disposable database | git history |
| P0a Secret exposure (owner decision, before any push or branch work) | Treat the database credentials found in tracked `ownus/scratch_*.js` files on `origin/main` (RR-25) as compromised: rotate through a separately approved production change, stop tracking the files, decide on history cleanup, review access logs | owner | credentials rotated and both applications and the Phase A2 operator use the new ones; scratch files no longer tracked; history decision recorded | secret scan of both repositories finds no credentialed remote URL | restore previous credentials only if the new ones fail, then retry; the exposed ones stay revoked |
| P1 Evidence | Phase A2 read-only run by the named operator; evidence report | signed approval record | all approved checks recorded; findings classified | n/a (read-only) | none needed |
| P2 Decisions | Owner decisions: ownership per table, publication authority, People option A/B/C, customer-layer fate, `import_batches` contract | P1 | written decisions in the ownership matrix | n/a | n/a |
| P3 Safety hardening (code, no schema) | Pipeline: auth on mutating routes, remove role-header trust, disable self-credits, `AUTO_MIGRATE` default off and fatal failures, advisory lock, signal handling, pool and timeouts, test/benchmark guards. Orion: commit lifecycle fixes, host guards on seed/cleanup scripts | P0, P2 | each risk-register item closed with a test | route-level auth tests (401/403 without credentials); a migration-failure test (non-zero exit); stale-recovery duplicate-run test; guard tests (refuses non-allow-listed host) | revert commit; flags default to the old behaviour only if approved |
| P4 Contracts | Written column-owner contract for `import_batches`; publication state machine; `published_people_v1` and tombstone view definitions (as files, not applied) | P2 | contracts reviewed; contract tests written | contract tests: view column list/types stable; no `SELECT *`; publication filter tests | files only |
| P5 Rehearsal | Isolated Neon branch per `MIGRATION_REHEARSAL_PLAN.md`: schema `orion_pipeline`, roles, views, both applications together | P3, P4, a verified branch | rehearsal success criteria met; evidence stored | both applications' suites against the branch; People view behaviour; role-permission matrix tests | delete the branch |
| P6 Production change | One reviewed production change request (`PRODUCTION_CHANGE_REQUEST_TEMPLATE.md`) per step, smallest first: roles, then schema, then views, then application switch | P5 accepted | verification steps pass; no customer-visible regression | smoke tests from the rehearsal | tested recovery/forward-fix per request |
| P7 Customer-layer retirement | restrict, reconcile, retire the pipeline's customer routes (matrix II.2) | P3, owner decision | no writes by the pipeline to `users`, `credit_transactions`, `saved_searches`; balances reconciled | credit-ledger reconciliation report; unlock/export parity tests | feature flag back on |
| P8 Consolidation | Move remaining pipeline-only tables to `orion_pipeline` in small steps; move `schema_migrations` | P6 | each group moved under its own request | per-group contract tests | per request |

## 12. Highest-risk unresolved conflicts
1. Two migration systems on one database, the pipeline's auto-migrate (uncommitted today) and non-fatal failure handling.
2. The `people`/`person_contacts` collision and the open decision on Orion's own People model.
3. Two credit/identity systems writing the same tables, including a self-service credit route.
4. Publication authority (`status` vs the pipeline's fields) and the `DUPLICATE` value.
5. Unmanaged production columns and the `import_batches` field semantics.
6. A shared owner role and tooling that defaults to production.
7. Unknown deployed runtime for both applications.

## 13. What is not decided here
Final ownership of any table; People option A/B/C; the fate of the pipeline's customer functions; whether `file_key` and `r2_object_key` are equivalent; any role, grant, schema, view or data change; any deployment or migration. Each requires evidence and written approval.
