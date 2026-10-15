# UAT and release runbook (Orion + Data Pipeline)

**Status: `NOT READY FOR UAT`.** Dated 2026-10-05. This file supports the implementation work; it approves nothing, authorizes no database access and no change, and does not mark any gate (G-1 to G-10) passed. It points to the existing records instead of repeating them: `CREDENTIAL_ROTATION_EXECUTION_PLAN.md`, `MIGRATION_RUNBOOK.md` §9, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`, `CREDENTIAL_INCIDENT_OWNER_ACTION_TRACKER.md`.

Evidence below marked **(verified)** was produced on 2026-10-05 against a throwaway PostgreSQL started on loopback in the session scratch folder (own data directory, port 54330, destroyed afterwards) or against in-memory databases. It involved no Neon, production, or local-service database.

---

## 1. Obtaining and verifying an isolated, disposable UAT database

Do not connect to any UAT target until every box in 1.2 is ticked and a named approver has authorized the connection in writing.

### 1.1 Choose the type (decision for the owner)
| Option | Customer data? | Notes |
|---|---|---|
| A. Local throwaway PostgreSQL (container or embedded binaries), synthetic data | none | Fully isolated; cannot test Neon-specific behaviour (pooler, branches) |
| B. New empty Neon project or a branch created without production data, synthetic data | none | Recommended for UAT |
| C. Branch of `production` (as `orion-migration-rehearsal` is) | **copy of customer data** | Needs written data-handling approval; the branch inherits the exposed role password until it is changed (IA-08, CR-2) |

The PostgreSQL service already listening on this machine's port 5432 is **not** a candidate: its contents and owner are unknown.

### 1.2 Verification checklist (for the human who owns the console)
- [ ] Neon console (option B/C): note project name and ID, branch name, **parent branch**, creation time, and the full list of branches. Record only names and IDs.
- [ ] Console shows the target endpoint ID under the intended branch (endpoint-to-branch mapping; this is SV-1 evidence, still `IN PROGRESS`).
- [ ] The target host differs from every production host (`STAGING_FORBIDDEN_HOSTS`) and is not a `-pooler` host when running migrations (the runner switches to the direct host automatically).
- [ ] No application, worker or scheduled job points at the target (check hosting environment variable *names* per environment, and any scheduler).
- [ ] A dedicated least-privilege role exists for the tests (creating it is a G-1 act: needs its own approval); the exposed `neondb_owner` credential is **not** used.
- [ ] The connection string reaches the shell only through the environment (never a file in the repo, a message or a log). Names used by the repository guards: `STAGING_DATABASE_URL`, `STAGING_CONFIRM_HOST`, `STAGING_FORBIDDEN_HOSTS`, `STAGING_TARGET_HOST`, `MIGRATION_CONFIRM_HOST`.
- [ ] Written authorization names the approver, the target (project, branch, endpoint ID), the role, the permitted operations (migrations, synthetic writes) and an end date.
- [ ] Read-only first: `npm --prefix apps/api run db:audit` (expect exit 0, or exit 2 only for the accepted `import_batches.file_key` drift) and `db:rehearsal -- snapshot > before.json`.
- [ ] After use: delete the branch/project or reset it (G-1; deletion is confirmed separately) and record that it was done.

### 1.3 Local throwaway server for concurrent-connection tests (option A, reproducible)
Run outside the repositories (for example in a temporary folder):
```bash
npm init -y && npm i embedded-postgres
```
`server.mjs`:
```js
import EmbeddedPostgres from 'embedded-postgres';
const pg = new EmbeddedPostgres({ databaseDir: './data', user: 'postgres', password: 'postgres', port: 54330, persistent: false,
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=60'] });
await pg.initialise(); await pg.start(); console.log('ready'); setInterval(() => {}, 1 << 30);
```
Create databases as `UTF8` (`CREATE DATABASE x TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`): the default Windows encoding rejects characters used in the migrations. In-memory PGlite (the API's hermetic tests) serves one connection at a time and is not enough for the pipeline's publishing tests.

---

## 2. Credential-remediation sequence (nothing is rotated or revoked by this document)

Authoritative detail: `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` §4 (Neon steps N-0 to N-11) and §7 (waves). Summary of the order and of what each step affects:

| Order | Credential | Prerequisite | Effect when done | Gate |
|---|---|---|---|---|
| 0 | Evidence: console role/ownership, which branch each endpoint is, consumers, logs preserved, approvers named | SV-1, SV-5, SV-7 evidence | none | none |
| 1 | **Database.** Create `orion_app` (least privilege) on a rehearsal branch, run the application suite there, then on the target; move each consumer (API, gateway, workers, pipeline) one by one | wave 0; Phase A2 / IA-25 decision | consumers stop using the owner role | G-1, G-2 |
| 2 | Observation period; provider view shows no session left on the owner role | order 1 | none | none |
| 3 | **Separate approval**, then change the owner password; refusal check that the exposed credential no longer works | order 2 | the exposed credential is dead | G-1 (revocation) |
| 4 | Reset/delete branches that inherited the credential (`orion-migration-rehearsal` / `S1`) | order 3 | | G-1, deletion confirmed separately |
| 5 | **JWT pair.** New `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` in every environment (API and gateway share them) | hosting environments prepared | **all users are signed out** (access 15 min / 24 h gateway, refresh 7 d). Do it with a planned move to avoid a second sign-out | G-6, G-2 |
| 6 | **Typesense key.** Only matters if `SEARCH_PROVIDER=typesense` is deployed. Generate a new admin key on that server, set `TYPESENSE_API_KEY`, re-sync the index | server access | the old committed key stops working | G-7 |
| 7 | Repository: the literals are already removed from `docker-compose.yml` and the scratch scripts in the working tree; untracking, ignore rules and the optional history rewrite follow rotation | orders 1 to 6 | the old values are inert once rotated | G-4, G-5, G-8, G-9 |

Until order 3, 5 and 6 are done the values already in the repository history **remain valid**. Editing a file does not rotate anything.

---

## 3. Publication and ownership contract: decisions required (not implemented)

### 3.1 Evidence (verified, real PostgreSQL)
- Orion's 18 Drizzle migrations apply cleanly to an empty database (50 public tables). The pipeline's 15 migrations (000-014) apply cleanly to an empty database (33 tables). **Neither applies onto a database the other initialized**: the pipeline stops at `001` (`duplicate_clusters.canonical_business_id` missing); Orion stops at its first `CREATE TABLE` (relation exists).
- 9 table names exist in both: `business_history`, `businesses`, `credit_transactions`, `duplicate_clusters`, `import_batches`, `people`, `person_contacts`, `saved_searches`, `users` (the pipeline's own migration runner also creates a `schema_migrations` tracking table that Orion does not have). Column sets differ for all 9 (for example `businesses`: 27 vs 41 columns, `users`: 26 vs 7); `businesses.status`, `business_type`, `msme_category`, `opportunity_tier`, `users.role` and others have different types (Orion enums, pipeline `varchar`).
- Publication state is kept twice: Orion reads `businesses.status = 'PUBLISHED'` and `published_at`; the pipeline uses `stage`, `verification_status`, `publishing_status`, `dataset_version`, `unpublished_at`, and its view `orion_published_businesses` filters on those. Orion's publish does not set the pipeline columns; the pipeline's publish does not set `status`.
- Implemented so far in the pipeline (tested): a confirmed duplicate is written as `status = 'REJECTED'` (no `DUPLICATE` in Orion's enum); re-ingestion no longer overwrites a `PUBLISHED` status.

### 3.2 Decisions (owners: Orion and Pipeline owners; People owners where marked)
| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Topology | one shared database / two databases with an explicit export | Two databases, or separate schemas, until D2 to D6 are settled; the shared `public` schema cannot currently host both |
| D2 | If shared: namespace | pipeline tables move to their own schema (for example `orion_pipeline`) / prefixes | A separate schema; no table name in `public` owned by both |
| D3 | Single source of truth for "published" | Orion `status` / pipeline `publishing_status` / a mapping | Pipeline decides "approved for publication"; **Orion alone** sets `status` and `published_at` through its review/publish workflow |
| D4 | Handoff mechanism | view, publish queue table, API call | A queue or view the pipeline writes and Orion reads; the pipeline never writes Orion-owned columns |
| D5 | `businesses.status` values | add `DUPLICATE` to the enum / keep the mapping to `REJECTED` | Keep the mapping (no shared enum change) unless Orion needs the distinction |
| D6 | Identity | pipeline `accounts` vs Orion `users` | **Unresolved by evidence**: no mapping is assumed; needs the owners' written definition and column mapping |
| D7 | Migrations | who runs which, one journal or two, numbering | Each system migrates only objects it owns; one reviewed order for any shared object |
| D8 | `credit_transactions` provenance columns | keep pipeline-only columns / split ledger | Owners decide; the A2 C13b check exists for this |
| D9 | `people`, `person_contacts` (both sides define them) | | **People owners decide; not touched here** |

No shared migration, enum or People file was modified.

---

## 4. Deferred dependency advisory (`@nestjs/swagger` → `js-yaml`)
- Advisory: `js-yaml` 5.0.0-5.4.0, CPU use with empty merge sources (moderate). Installed: `@nestjs/swagger` 11.4.7, which pins `js-yaml` 5.3.0 exactly. The package parses its own generated document, not user input, so exploitability is low (unverified).
- Fix candidates: (a) `@nestjs/swagger` 12.0.2 (pins `js-yaml` 5.4.2) **requires `@nestjs/core`/`@nestjs/common` 12**: a major upgrade of the framework, not done. (b) An npm `overrides` entry: tried today on a copy of the tree; npm left `@nestjs/swagger` without any `js-yaml` installed while `npm audit` still reported 0 findings, which would break API startup. **Reverted; do not use.** (c) Wait for a 11.x release with the patched pin and re-run `npm audit fix`.
- Report before any major upgrade: Nest 12 migration, TypeScript/ts-jest compatibility, all e2e suites.

---

## 5. UAT commands, expected results, rollback

### 5.1 Hermetic (no database; safe now)
| Step | Command | Expected |
|---|---|---|
| API type check and build | `npm --prefix apps/api run build` | exit 0 |
| API unit | `NODE_ENV=test npm --prefix apps/api test` | all pass (1,131 pass, 13 skipped on 2026-10-05) |
| API e2e (in-memory) | `npm --prefix apps/api run test:e2e -- --testPathIgnorePatterns people` | 12 suites, 138 pass |
| Web | with `DATABASE_URL`, `JWT_*`, `RESEND_API_KEY` set to unusable test values: `npm --prefix ownus run build`, then `node --experimental-strip-types --test src/lib/__tests__/*.test.ts` (People files excluded) | build succeeds; tests pass |
| Pipeline guards | `python -m pytest tests/test_db_target_guard.py tests/test_shared_contract_guards.py` | pass; the session aborts when `DATABASE_URL` is not local |

### 5.2 Pipeline against a throwaway local PostgreSQL (section 1.3)
```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:54330/<utf8-db>?sslmode=disable'   # local only; the conftest guard refuses anything else
export R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_ENDPOINT_URL= R2_INTEGRATION_TEST=0 REDIS_URL=
python -m python_pipeline.migrate          # expect: 15 migrations applied
python -m pytest tests --ignore-glob='tests/test_people_*' --ignore=tests/test_disaster_recovery_phase10.py   # 214 passed, 1 skipped (2026-10-05)
```
`tests/test_company_reupload_p3.py` needs the host name `localhost` in the URL and creates temporary databases (6 passed, about 4 minutes). `test_disaster_recovery_phase10.py` needs `pg_dump` and was not run.

### 5.3 UAT environment (only after section 1.2 is complete and authorized)
Follow `MIGRATION_RUNBOOK.md` §9.2 for the migration rehearsal (steps 3 to 6), then start the API with UAT secrets from the environment (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`; names only), the web app with `BACKEND_API_URL`, and check `/api/v1/health`. Smoke list: `MIGRATION_RUNBOOK.md` §9.2 step 6. Mock or disable email, payment and enrichment.

### 5.4 Rollback and recovery requirements
- The UAT database is disposable: rollback is to discard or reset it. Never restore onto the source.
- Migrations are forward-only; a failed Drizzle run rolls back entirely. Keep `before.json`, run `db:rehearsal -- compare before.json after.json` (exit 0).
- Application rollback: redeploy the previous build with the previous environment values. A JWT rotation cannot be rolled back without signing users out again.
- Record who ran what, against which target, and when.

---

## 6. Release checklist (all unchecked)
- [ ] Isolated UAT database verified and authorized (section 1.2)
- [ ] Phase A2 decision (IA-25) and read-only scope authorization, if the evidence run is still wanted
- [ ] SV-1, SV-5, SV-7 evidence; approval record signed (`DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`)
- [ ] Credential sequence in section 2 completed and the exposed values refused
- [ ] Contract decisions D1 to D9 recorded, then migrations rehearsed on the UAT database
- [ ] Gateway runs with its own least-privilege role (`GATEWAY_DATABASE_URL`)
- [ ] Dependency findings reviewed (section 4)
- [ ] Hermetic suites, pipeline suite on a real PostgreSQL, and UAT smoke tests pass
- [ ] Secrets scan of the proposed release is clean; People-import owners have reviewed their own files
- [ ] Rollback verified on the UAT database
