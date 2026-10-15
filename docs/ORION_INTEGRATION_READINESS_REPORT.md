# Orion integration readiness report

**Status: READINESS REVIEW, static only.** Date: 2026-10-02. No database was contacted, no SQL executed, no test run, no code, migration, configuration or deployment changed, and no Git state altered (nothing staged, committed, stashed or reset). Everything below is a proposal or a finding for the owner; nothing is approved.

Source documents (all read for this review): `DATABASE_OWNERSHIP_MATRIX.md`, `PIPELINE_RUNTIME_RISK_REGISTER.md`, `TARGET_ARCHITECTURE.md`, `MIGRATION_REHEARSAL_PLAN.md`, `PRODUCTION_CHANGE_REQUEST_TEMPLATE.md`, `PHASE_A2_APPROVAL_READINESS.md`, `PRODUCTION_EVIDENCE_REPORT_TEMPLATE.md`. All exist.

Evidence labels: **VERIFIED (static)** read in source in the stated state; **WT** working tree; **HEAD** committed; **HIST** earlier audit observation (2026-10-01), not current; **PENDING EVIDENCE** needs the Phase A2 run or an owner decision; **UNKNOWN** deployed behavior.

## 1. Executive summary
- The two applications share one Neon database and write the same seven tables with different, partly incompatible models (identity, credits, saved searches, businesses, history, duplicates, import batches). There is no single owner, no schema boundary and, apparently, one shared owner role (HIST).
- The proposed direction is sound but unverified against production: Orion owns the customer product and publication visibility; the pipeline owns ingestion and People records in a separate `orion_pipeline` schema; Orion reads published People through a versioned, explicit-column, read-only view; migrations run only as an explicit, approved deployment step.
- **Nothing can safely proceed to implementation yet.** Five blockers: (1) database credentials were found committed on `origin/main` (RR-25, Critical); (2) neither repository is a reproducible baseline; (3) the Phase A2 approval record is entirely unfilled; (4) the deployed runtime of both applications is unknown; (5) key ownership decisions (People option A/B/C, publication authority, fate of the pipeline's customer layer, `import_batches` contract) are not made.
- Evidence gathering (Phase A2, read-only, by an authorized operator) is the correct next production-facing step once the approval record is signed. Everything after it is gated by that evidence.

## 2. Recommended ownership decisions (PROPOSED, for the owner)
| Area | Recommendation | Status |
|---|---|---|
| `users`, `credit_transactions` and wallets, `saved_searches` | Orion owns and is the only writer | PROPOSED; depends on usage evidence for the pipeline's customer layer |
| `businesses` | Split by column: Orion owns product-facing identity and publication state (`status`); pipeline owns its enrichment and verification columns | PROPOSED; contract needed |
| `business_history`, `duplicate_clusters` | undecided | PENDING EVIDENCE |
| `import_batches` | Pipeline owns ingestion batches; column-owner contract and an origin column; `file_key` not equated with `r2_object_key` | PROPOSED, PENDING EVIDENCE |
| Pipeline People tables (six) | Pipeline-owned in `orion_pipeline` | Ownership decided by the owner; placement PROPOSED |
| Orion's own People tables | untouched until purpose and consumers are reviewed; option A/B/C undecided | PENDING DECISION |
| Pipeline customer routes (signup, login, credits, unlock, saved searches, export) | restrict, reconcile, then retire, only after usage and balance evidence | PROPOSED |
| Roles | `orion_app`, `orion_migrator`, `pipeline_app`, `pipeline_migrator`, optional read-only role; existing owner for emergencies only | PROPOSED; nothing created |

## 3. Verified facts versus pending evidence
**Verified statically (cited in the documents with file and line)**
- Orion customer reads gate on `businesses.status = 'PUBLISHED'`; the pipeline's publish step writes `publishing_status`, `stage` and `published_at`, never `status`; the pipeline also writes `status = 'DUPLICATE'` (not in Orion's enum).
- `import_batches`: Orion writes `file_key`, `status`, `*_records`; the pipeline writes `r2_object_key`, `r2_uri`, `sha256_checksum`, `processing_status`, `*_rows`; neither side reads the other's fields. `file_key` appears nowhere in the pipeline project.
- The pipeline's customer layer writes `users`, `credit_transactions`, `saved_searches`; its add-credits route takes the amount from the client.
- Pipeline mutating routes without authentication, client-declared roles, wildcard CORS, always-on embedded worker, no graceful shutdown, no migration lock, five `DROP VIEW … CASCADE` statements (HEAD).
- Auto-migration at pipeline start, `HOST` override and compose changes exist only in the working tree; Orion has no startup migration.
- The Orion gateway writes shared tables with raw SQL in addition to the NestJS API.
- Eight tracked `ownus/scratch_*.js` files contain credentialed database URLs; they are reachable from `origin/main`.

**Pending evidence (cannot be settled from source)**
- What is deployed and running for each application; which database each process targets; whether pipeline routes are reachable or used.
- The production types and values of `businesses.status` and the publication flags; pipeline-origin users/credits; the contents and writers behind the ten unmanaged `import_batches` columns, `SUPERSEDED`, and the five rows with equal keys.
- Roles, grants, and dependents of `orion_published_businesses`.
- Whether the exposed credentials are valid, current, and the production ones; repository visibility.

## 4. Critical schema and security conflicts
| # | Conflict | Severity | Where |
|---|---|---|---|
| 1 | **Credentials in git on the remote** | Critical | RR-25 |
| 2 | Two migration systems on one database; pipeline auto-migrate (uncommitted, default on) with non-fatal failures | High | RR-01..03 |
| 3 | `people` / `person_contacts` collision (same names, different columns, both `IF NOT EXISTS`) | High | RR-05 |
| 4 | Two credit and identity systems; self-service credit route; unauthenticated delete/ingest routes; forged-role acceptance | High | RR-11..13, RR-19 |
| 5 | Publication state: two models, `DUPLICATE` outside Orion's enum | Medium-High | RR-18 |
| 6 | Ten unmanaged production columns; meaning of `file_key` | High | matrix II.1 |
| 7 | `DROP VIEW … CASCADE` pattern; People view depends on the businesses view; recreation resets grants | High | RR-04 |
| 8 | Shared owner role; development tooling defaults to the production host | High | RR-20, matrix |
| 9 | Embedded worker cannot be disabled; stale-job recovery can re-run a live job; no graceful shutdown | Medium-High | RR-06, 07, 09 |
No item is claimed exploitable in any deployment; reachability is unverified.

## 5. Git baseline
### 5.1 State captured (read-only)
| | Orion `D:\ownus` | Pipeline `D:\datas storing\datas storing` |
|---|---|---|
| Branch / HEAD | `main` / `fe7307f` (2026-09-24) | `main` / `518c68f` (2026-10-01) |
| Staged | 0 | 1 (deletion of `scripts/test_migration_fresh.py`) |
| Modified tracked | 59 | 15 |
| Untracked | 118 | 11 |
| Stashes | 0 | 0 |
| Migration files | `0000`-`0002` and `0003` (modified, journaled) committed; `0004`-`0017` SQL (14) and snapshots (14) untracked; `_journal.json` modified | `001`-`014` committed, directory clean |
| Remote | `origin`; includes the commit that added the credentialed scratch files | `origin` |

Orion changes by area (modified / untracked): `apps/api/src/database` (9 / 36: migrations, schema, audit and rehearsal tooling), `apps/api/test` (6 / 7), `apps/api/src/modules/*` (import, credit, payment, discover, saved-leads, unlock, oauth, queue, typesense, people), `apps/api/src/{auth,config,common,main.ts,app.module.ts}`, `ownus/src` gateway and admin UI (including 15 untracked `lib/` files), `docs` (1 / 34), `package.json` and `package-lock.json`, plus unrelated media/tooling (`showreel/`, `showreel2/`, `brag-output/`, `.claude/`).
Pipeline changes: startup/migration/deployment: `server.py`, `python_pipeline/migrate.py`, `docker-compose.yml`, `.gitignore`, untracked `run.bat`, `setup.bat`, `scripts/run_fresh_migration_check.py`, staged deletion of the old fresh-migration test; People export feature: `python_pipeline/people/export_service.py` (new), `people/admin_api.py`, three new tests, `ui/index.html`; storage diagnostics: `python_pipeline/storage.py`, `r2_diagnostics.py`; others: `requirements.txt`, `.env.example`, `README.md`, `ARCHITECTURE.md`, `scripts/backup_restore.py`, two test edits, `pytest.ini`, `.python-version`, `scripts/check_portability.py`.

### 5.2 Items affecting migrations, startup, workers, database access or deployment
Orion: `migrate.ts` (host-confirmation guard), `database.service.ts` and `credit.scheduler.ts` (shutdown ordering), `main.ts`, `config/*`, schema and migrations, `package.json` scripts. Pipeline: `server.py` (auto-migrate, `HOST`), `migrate.py` (rollback handling, dotenv), `docker-compose.yml` (`HOST`, `AUTO_MIGRATE`), `run.bat`/`setup.bat`.

### 5.3 Secrets and unsafe defaults flagged for manual review (values not printed)
1. **Eight tracked `ownus/scratch_*.js` files with credentialed database URLs, on `origin/main`** (RR-25).
2. `apps/api/.env` (gitignored) holds the production-configured URL; seeds, cleanup scripts and dev commands default to it.
3. Untracked, **not ignored** artefacts `apps/api/before.json`, `before.clean.json`, `after.json` (counts only) must not be committed.
4. Pipeline code defaults to a localhost URL with default credentials in at least nine places (`db.py`, `migrate.py`, `batch_manager.py`, `commercial/*`), and compose falls back to a default database password; harmless locally, unsafe if a real `DATABASE_URL` is ever missing or if the compose file is used on a shared host.
5. Pipeline `AUTO_MIGRATE` defaults on and `HOST` can be `0.0.0.0` in uncommitted code.
6. Tracked `imported_businesses.sql` (10 lines, business sample data) and 3,069 local files under the pipeline's ignored `storage/` hold business data: keep out of commits.
7. Untracked `.claude/` (tooling state) in Orion: review before any add.

### 5.4 Minimum files for a reproducible rehearsal baseline
Orion (all must be committed together, tests green at the commit):
- `apps/api/src/database/migrations/_journal.json`, `0003_seed_packages.sql`, `0004`-`0017` SQL, `meta/0004`-`0017_snapshot.json`.
- `apps/api/src/database/schema/{people.ts,engagement.ts,enums.ts,imports.ts,index.ts}`, `seed.ts`, `migrate.ts`, `migration-target.ts`, `database.service.ts`, and the audit/rehearsal/guard tooling (`migration-audit.ts`, `audit-migrations.ts`, `rehearsal-checks.ts`, `rehearsal-cli.ts`, `staging-guard.ts`) with their `__tests__`.
- The application code the schema and tests depend on (people, import, credit, payment, discover, saved-leads, unlock, oauth, auth, config, `main.ts`, `app.module.ts`, `common/http`) and the gateway files under `ownus/src/app/api/v1/[...path]/route.ts` and `ownus/src/lib`.
- `apps/api/test/{setup-env.ts,setup-staging-env.ts,jest-e2e.json,jest-staging.json}`, `test/helpers/*`, the e2e specs, `package.json`, `package-lock.json`.
Pipeline: HEAD plus the reviewed migration/startup changes only after the P3 hardening decisions (auto-migrate default off, fatal failures, lock, staging guard); the People export feature is independent and can be committed separately.

### 5.5 Proposed commit and branch plan (nothing executed)
Order matters; every step needs the owner's decision first and is performed by the owner or with explicit approval.
1. **Before any commit or push:** resolve RR-25 (rotate credentials, stop tracking the scratch files, decide on history cleanup); exclude artefacts listed in 5.3 (add to ignore rules only with approval).
2. **Safety net:** create a backup copy of both working trees (or a safety branch per repository) so nothing is lost; no stash, reset or clean.
3. **Orion branch `integration/baseline`, commits in this order:**
   - (a) *Unrelated existing work* (landing page, media, tooling): separate commits or left uncommitted; not part of the baseline.
   - (b) *Reviewed application changes* (security/hardening, auth, config, credit, payment, gateway libs, People modules), each tied to its tests.
   - (c) *Migrations and schema* (journal, 0003 breakpoint, 0017 and snapshots, schema files, `seed.ts`, `migrate.ts`, `migration-target.ts`).
   - (d) *Rehearsal-only tooling and configuration* (audit/rehearsal tooling, staging guard, staging jest config, test helpers).
   - (e) *Documentation* (`docs/`).
4. **Pipeline branch `integration/baseline`:** (a) the People export feature and its tests; (b) storage diagnostics; (c) startup/migration/deployment changes only after P3 (auto-migrate default off, fatal failure, lock, staging guard); (d) docs; keep `run.bat`/`setup.bat` as a separate decision.
5. Tag the final commit of each repository; the rehearsal record cites both IDs.

### 5.6 Git baseline blockers
RR-25 unresolved; uncommitted migrations (Orion 0004-0017) and uncommitted runner/startup changes (pipeline); no decision on how to separate unrelated work; artefacts and `.claude/` undecided.

## 6. Phase A2 approval blockers
The record (`PHASE_A2_APPROVAL_READINESS.md`) is `DRAFT — NOT APPROVED` and its file hashes are intact (SQL `aba19a76…c195f82`, checklist `88654eb9…90637af`). No field is completed:
- Scope baseline (§2), decisions for C01/C01s, C02, C13c (§3) and the metadata class (§4B).
- Maintenance window (date, start, end, time zone), named operator, Neon role, abort authority and contact.
- Verified direct production host, database name, full rehearsal host to refuse.
- Output location, viewers, retention, sharing decision.
- Acknowledgements A1-A6 (including the unreliable C10a counter and its compensating rule), owner name, record ID, signature and date.
C00 is mandatory (any failure, timeout, no result, wrong database or `read_only` not `on` stops the run). If credentials are rotated for RR-25, the role and password used by the operator change; settle the sequence with the approval record. Phase A2 has not been run and must not be run before sign-off.

## 7. Rehearsal prerequisites
From `MIGRATION_REHEARSAL_PLAN.md` (including the third-pass gap closures G1-G9): reproducible baselines for both repositories; accepted Phase A2 evidence; written ownership decisions; contracts as files; a pipeline staging guard equivalent to Orion's; process-level proof of the target database; migration-history reconciliation step; pre-migration review of every `DROP VIEW … CASCADE` and view dependents; independent console verification of the branch and its parent; explicit staging variables with fail-closed guards; branch credentials treated as production-equivalent until shown otherwise; neutral external configuration; named operator, verifier, abort authority and window; recoverability of the parent confirmed by a restore test.

## 8. Ordered implementation roadmap
(Full table with dependencies, tests and rollback: `TARGET_ARCHITECTURE.md` §11.)
1. **P0a** resolve RR-25. 2. **P0** commit baselines per §5.5. 3. **P1** Phase A2 evidence (after sign-off). 4. **P2** owner decisions (ownership, publication authority, People A/B/C, customer layer, `import_batches` contract). 5. **P3** safety hardening, code only (pipeline route authentication, role-header removal, self-credit route off, `AUTO_MIGRATE` off, fatal migration failure, lock and checksums, signal handling, pool/timeouts, test/benchmark guards; Orion: commit lifecycle fixes, seed/cleanup host guards). 6. **P4** contracts as reviewed files and contract tests. 7. **P5** rehearsal on a verified Neon branch. 8. **P6** production change requests, smallest step first (roles, schema, views, application switch). 9. **P7** retire or restrict the pipeline customer layer after reconciliation. 10. **P8** move remaining pipeline-only tables, in small groups.

## 9. Acceptance criteria and rollback requirements
| Phase | Acceptance | Rollback |
|---|---|---|
| P0a | credentials rotated and in use; no credentialed remote URL tracked; history decision recorded | previous credentials remain revoked |
| P0 | both repos reproducible from commits; suites green at the commit | git history; safety branch |
| P1 | all approved checks recorded; errors recorded as findings | none (read-only) |
| P2 | decisions written into the ownership matrix | n/a |
| P3 | each risk-register item closed by a test; no schema change | revert the commit |
| P4 | contracts reviewed; contract tests pass | files only |
| P5 | success criteria of the rehearsal plan met on the branch, V1 and V2 | discard the branch (separately confirmed) |
| P6 | per-request verification passes; no customer-visible regression | restore-tested recovery or forward fix per request |
| P7 | no pipeline writes to Orion-owned tables; balances reconciled | feature flag back on; archives retained |
| P8 | each group moved with its contract tests | per request |
No phase begins without the previous one reported and the owner's written go-ahead. No production change is authorized by any document in this set.

## 10. Remaining decisions and evidence gaps
Decisions: RR-25 handling; how to commit/separate work in both repositories; ownership per table; publication authority and the `DUPLICATE` state; People option A/B/C; fate of the pipeline's customer layer and any live accounts/balances; the `import_batches` contract and the meaning of `file_key`; whether Orion's gateway writers move behind the API.
Evidence gaps: all items in §3 "pending evidence", obtainable by the signed Phase A2 run, repository-visibility and credential-validity checks by the owner, and a deployment inventory for both applications.
