# Database ownership matrix (PROPOSED, not authoritative)

**Status: PROPOSED. Not decided, not approved, not authoritative.** Date: 2026-10-02 (Stage 2; second-pass update in Part II and third-pass update in Part III at the end, which adds file and line references, the verified publication path, corrections and the pipeline customer-layer plan). Prepared from static review of both repositories' working trees and committed history. No database was contacted and no SQL was executed. Every ownership entry below is a proposal for the owner to confirm; entries not supported by evidence are labelled `PENDING EVIDENCE`.

## 0. Inputs and rules
**Confirmed owner decisions that frame this matrix (from the owner, as stated):**
1. The pipeline owns People ingestion and the underlying People records.
2. Orion remains customer-facing and consumes published People data through a read-only interface.
3. Orion's `businesses.status` is the *intended* publication authority, **pending contract verification** (not confirmed here).
4. Separate least-privilege application and migration roles are required.
5. `file_key` must not be mapped to `r2_object_key` without proof of semantic equivalence.

**Rules used**
- A table being written by the pipeline does not make the pipeline its owner. Ownership is not inferred from "who writes most" or from the schema name `public`.
- "Current known writers" are code paths found by static search (file and line in the working tree). Whether any path is live is `RUNTIME?` and is not established here.
- Historical production observations (HIST, 2026-10-01) are cited only as pointers to what to verify, never as current facts.
- Orion's committed and uncommitted code differ (Orion: 170 uncommitted entries, migrations 0004–0017 untracked; pipeline: 15 modified tracked files). The working tree is not a reproducible baseline.
- Decision status values: `PROPOSED, NOT DECIDED`, `PENDING EVIDENCE`, `DECIDED BY OWNER (as stated above)`. Nothing in this document is marked confirmed.

## 1. Summary
| Table | Proposed owner | Authority status | Migration owner today | Decision status |
|---|---|---|---|---|
| `users` | Orion | proposal | Orion (`0000`) | PENDING EVIDENCE |
| `credit_transactions` | Orion | proposal | Orion (`0000`) | PENDING EVIDENCE |
| `saved_searches` | Orion | proposal | Orion (`0000`) | PENDING EVIDENCE |
| `businesses` | Split, unresolved: Orion for publication state, pipeline for enrichment attributes | proposal | Orion (`0000`); pipeline `schema.sql` is a second definition | PENDING EVIDENCE |
| `business_history` | PENDING EVIDENCE | none | Orion (`0000`) | PENDING EVIDENCE |
| `duplicate_clusters` | PENDING EVIDENCE | none | Orion (`0000`) | PENDING EVIDENCE |
| `import_batches` | Pipeline for ingestion batches (owner's stated direction) | proposal | Orion (`0000`); pipeline `003` was a no-op | PENDING EVIDENCE |
| `people` (pipeline's) | Pipeline | DECIDED BY OWNER (People records) | Pipeline `013` (not applied in production per HIST) | PROPOSED, NOT DECIDED (schema placement) |
| `company_person_relationships` | Pipeline | same | Pipeline `013` | same |
| `person_contacts` (pipeline's) | Pipeline | same | Pipeline `013` | same |
| `person_import_records` | Pipeline | same | Pipeline `013` | same |
| `person_change_history` | Pipeline | same | Pipeline `013` | same |
| `person_conflicts` | Pipeline | same | Pipeline `013` | same |

Where a column exists in production but in neither repository's migrations (HIST: pipeline columns on `import_batches`, `businesses`, `business_history`, `credit_transactions`, `saved_searches`, `duplicate_clusters`), the **migration owner is currently none**: it is unmanaged drift and must be assigned.

---

## 2. Shared tables

### 2.1 `users`
- **Proposed owner:** Orion. Rationale: customer identity, roles and sessions are customer-facing and Orion defines them (enum role/status, OAuth, admin persisted roles). `PENDING EVIDENCE`: confirm the pipeline's customer layer is not a live system of record.
- **Current known writers**
  - Orion API: `apps/api/src/auth/services/auth.service.ts`, `modules/oauth/oauth.service.ts`, `modules/user/user.repository.ts`, `modules/user/user.service.ts`.
  - Orion gateway raw SQL: `ownus/src/app/api/v1/[...path]/route.ts` lines 234, 250, 269, 1240, 1397, 1417, 1553, 1823, 1828, 2033, 2103, 2154, 2210, 2258, 2320.
  - Pipeline: `python_pipeline/commercial/auth.py:71` (`INSERT INTO users (email, password_hash, role, is_active, …)`).
- **Intended readers:** Orion API and gateway (authentication, RBAC). Pipeline reads (`commercial/analytics.py`, `commercial/auth.py`) should be removed or become read-only on a defined view if the pipeline keeps any user concept.
- **Migration owner:** Orion (`apps/api/src/database/migrations/0000_*.sql`). Pipeline `011_create_customer_commercial_layer.sql` defines a different table with `IF NOT EXISTS`.
- **Data contract and compatibility concerns:** Orion `role` is an enum (SUPER_ADMIN, ADMIN, DATA_MANAGER, MEMBER, USER); the pipeline writes `role` as text defaulting `'customer'` with an `is_active` flag Orion does not define. Password hash formats differ by writer (Orion bcrypt/pbkdf2; pipeline unknown). Admin authorization in Orion depends on the persisted role.
- **Evidence still required:** column types and values in production (Phase A2 C05, C13a); whether pipeline-origin users exist; whether the pipeline's session/`accounts` tables hold live data (C13c).
- **Decision status:** PENDING EVIDENCE.

### 2.2 `credit_transactions`
- **Proposed owner:** Orion (ledger authority). `PENDING EVIDENCE`.
- **Current known writers**
  - Orion API: `auth/services/auth.service.ts`, `modules/credit/credit.service.ts`, `modules/oauth/oauth.service.ts` (all through the credit service/wallet logic).
  - Orion gateway: `route.ts` lines 1281, 1303; `ownus/src/lib/unlock-business.ts:38`.
  - Pipeline: `python_pipeline/commercial/auth.py:96`, `commercial/credits.py:65,179`; reachable from `POST /api/customer/credits/add` (`server.py:756-783`).
- **Intended readers:** Orion (wallet, history); pipeline should not read the ledger.
- **Migration owner:** Orion `0000`. Pipeline `011` defines a different ledger keyed by `account_id`, with `transaction_type`.
- **Contract concerns:** two incompatible ledger models (Orion: wallet-based with `balance_after`, `balance_type`, enum type; pipeline: account-based). HIST: production has pipeline columns `account_id` and `transaction_type` on this table. A ledger with two writers cannot be reconciled by construction, and the pipeline's add-credits endpoint takes the amount from the client without payment verification (see `PIPELINE_RUNTIME_RISK_REGISTER.md` RR-13).
- **Evidence still required:** whether any row carries the pipeline-only columns (C13b); constraints and defaults of those columns (C05); whether the pipeline credit endpoints are reachable and used.
- **Decision status:** PENDING EVIDENCE.

### 2.3 `saved_searches`
- **Proposed owner:** Orion. `PENDING EVIDENCE`.
- **Current known writers:** Orion API `modules/saved-searches/saved-searches.service.ts` (through its repository); pipeline `python_pipeline/commercial/searches.py:28,75`. No gateway raw-SQL writer found.
- **Intended readers:** Orion customers.
- **Migration owner:** Orion `0000`; pipeline `011` defines a different shape.
- **Contract concerns:** pipeline keys rows by `account_id` with `filter_criteria`; Orion keys by `user_id`. HIST: production has `account_id` and `filter_criteria` columns not defined by Orion.
- **Evidence still required:** C05 column comparison; row provenance.
- **Decision status:** PENDING EVIDENCE.

### 2.4 `businesses`
- **Proposed owner:** unresolved. Orion `status` is only the **proposed** publication authority (owner decision, pending verification); enrichment, verification and freshness attributes are written by the pipeline.
- **Current known writers**
  - Orion API: `modules/business/repositories/business.repository.ts`, `modules/business/services/business.service.ts`.
  - Orion gateway: `route.ts` lines 1096 (insert), 3063 and 3074 (delete), 3107 and 3112 (`UPDATE businesses SET status = …`).
  - Pipeline: `python_pipeline/db.py` (4 statements), `enrichment/service.py` (1), `entity_resolution/service.py` (2), `freshness/service.py` (4), `pipeline.py` (1), `publishing.py` (2: `:365-373` publish, `:529-536` unpublish), `verification.py` (5, including `:503` `status = 'DUPLICATE'`).
- **Intended readers:** Orion (discovery, unlock, search), pipeline.
- **Migration owner:** Orion `0000`; pipeline `schema.sql` is a second definition (`status VARCHAR(50)` "legacy/compatibility", `schema.sql:34`).
- **Contract concerns**
  - Orion `status` is the enum `business_status` (DRAFT, PENDING_VALIDATION, VERIFIED, PUBLISHED, ARCHIVED, REJECTED); the pipeline writes `'DUPLICATE'`, a value outside that enum.
  - The pipeline publishes through `publishing_status`/`stage` and does **not** write `status`; it does set `published_at` (also an Orion column), so the two publication models can disagree.
  - HIST: 22 pipeline columns on `businesses` that Orion's schema does not define.
  - The pipeline's `orion_published_businesses` view is built from the pipeline's own columns.
- **Evidence still required:** column type of `status` (C05); cross-tab of `status` against `publishing_status`/`stage` and disagreement counts (C14a, C14b); which system actually changes `status` today; views depending on `orion_published_businesses` (C12b).
- **Decision status:** PENDING EVIDENCE. "Orion `status` is the publication authority" is a proposal and must not be treated as confirmed until the contract is verified against current pipeline behavior.

### 2.5 `business_history`
- **Proposed owner:** PENDING EVIDENCE (an audit trail; ownership follows whoever owns the state transitions it records).
- **Current known writers:** Orion `modules/business/repositories/business-metrics-scores.repository.ts`, `modules/business/services/business.service.ts`; Orion gateway delete (`route.ts:3053`); pipeline `db.py:375`, `freshness/service.py:399,522`, `publishing.py:433,581`, `verification.py:564`.
- **Intended readers:** audit and admin views in both applications.
- **Migration owner:** Orion `0000`; pipeline `schema.sql` defines it too. HIST: 4 pipeline columns not in Orion's schema (`previous_stage`, `diff_data`, `stage`, `raw_original_data`).
- **Contract concerns:** two vocabularies of "change"; the gateway deletes history rows when deleting businesses.
- **Evidence still required:** C05; whether either side reads the other's rows.
- **Decision status:** PENDING EVIDENCE.

### 2.6 `duplicate_clusters`
- **Proposed owner:** PENDING EVIDENCE.
- **Current known writers:** Orion `modules/import/repositories/duplicate-review.repositories.ts`; Orion gateway delete (`route.ts:3058`); pipeline `python_pipeline/deduplicator.py:421`.
- **Intended readers:** duplicate review in each application.
- **Migration owner:** Orion `0000`; pipeline `001_create_deduplication_tables.sql` defines it (and `duplicate_records`, pipeline-only). HIST: 2 extra columns (`cluster_type`, `canonical_business_id`).
- **Contract concerns:** two duplicate-detection engines writing one table.
- **Evidence still required:** C05; whether rows from the two engines coexist.
- **Decision status:** PENDING EVIDENCE.

### 2.7 `import_batches`
- **Proposed owner:** the pipeline, for ingestion batches (the owner's stated direction), with Orion consuming a documented interface. Not confirmed: Orion currently creates its own batches in this table.
- **Current known writers**
  - Orion API: `modules/import/repositories/import.repositories.ts` (`create`, `updateStats`, `addPeopleSummary`), `modules/import/services/import-operations.service.ts`; `admin-import.service.ts:417-419` always sets `fileKey`.
  - Orion gateway: `route.ts:1060` (insert with `file_key`) and `:3206` (delete on rollback).
  - Pipeline: `python_pipeline/batch_manager.py:93` (insert) and `:153` (update); `people/sources/run_service.py:279` (update `processing_status`). The pipeline's insert never sets `file_key` (the string does not occur anywhere in that project).
- **Intended readers:** Orion metrics and admin lists (`status`, counters); pipeline source-run APIs.
- **Migration owner today:** Orion `0000` (created the table). Pipeline `003` used `CREATE TABLE IF NOT EXISTS`, which did nothing on an existing table; columns in production that the pipeline writes (`r2_object_key`, `r2_uri`, `sha256_checksum`, `processing_status`, `content_type`, `source_type`, `total_rows`, `successful_rows`, `failed_rows`, `error_summary`) were added **outside both repositories' migrations** (HIST). Their migration owner is **none**.
- **Contract concerns**
  - **`file_key` versus `r2_object_key` is unresolved.** Orion writes `file_key` (`imports/<ts>-<name>`) and does not know `r2_object_key`; the pipeline writes `r2_object_key` and does not know `file_key`. HIST: 5 rows had both keys equal, 10 had `file_key` NULL; no writer is known for the equal ones. Equality on some rows is not proof of equivalence. **No backfill, rename, constraint or repurposing is proposed.**
  - Two status vocabularies: Orion `status` (enum import_status) and the pipeline's free-text `processing_status`; the pipeline never writes `status`, so its batches look PENDING to Orion's metrics. A value `SUPERSEDED` appears in `processing_status` (HIST) that no code in either repository writes.
  - Two counter sets: `*_records` (Orion) and `*_rows` (pipeline).
  - Delete cascades: removing a batch affects `import_records`, `import_logs` and `pipeline_jobs` (HIST foreign keys).
  - `file_size` is `integer` in Orion's definition and `BIGINT` in the pipeline's.
- **Evidence still required:** C05, C06a-c, C08a-d (key presence and equality, prefix classes, `r2_uri` scheme, checksum shape, status distributions, counters); who writes `SUPERSEDED`; who altered the table; the pipeline's active-checksum unique index (C06a).
- **Decision status:** PENDING EVIDENCE. Legacy-record handling is undecided.

---

## 3. Proposed pipeline-owned People tables
Owner decision (stated): the pipeline owns People ingestion and the underlying People records, and Orion reads published People through a read-only interface. **Proposed, not decided:** these six tables live in a dedicated `orion_pipeline` schema. Nothing has been created; placement requires a separately approved plan and rehearsal.

Common facts
- **Migration owner:** the pipeline (`migrations/013_create_people_intelligence_layer.sql`, committed in `4861c6d`, 2026-10-01). HIST: none of these tables existed in production on 2026-10-01 (re-verify).
- **Orion's own People model is separate** and lives in `public` (`people`, `company_people`, `person_contacts`, `people_evidence`, `people_verifications`, `people_sources`, `people_observations`, … created by Orion migrations 0004–0016, uncommitted). **`public.people` and `public.person_contacts` have the same names as two of the six**, with different columns. What happens to Orion's People tables (replaced, retained, or migrated) is **an open decision**, not assumed here.
- **Intended readers:** Orion, through an explicit-column, versioned, read-only view (`orion_pipeline`-side). No Orion write path to these tables is proposed.
- **Contract concerns in common:** the pipeline's definition of publication (`is_current`, `publishing_status = 'PUBLISHED'`, `verification_status IN ('VERIFIED','PARTIALLY_VERIFIED')`, `freshness_status <> 'STALE'`) is the filter in its `orion_published_people` view (`013_…sql:188`); handling of unpublished, withdrawn, stale and deleted records must be documented in the view contract.

| Table | Current known writers (pipeline) | Compatibility concerns | Evidence still required |
|---|---|---|---|
| `people` | `people/service.py:989,1033`; `people/review.py:251,255,262,345` (including `DELETE FROM people` at `review.py:262` for merges) | Same name as Orion's `public.people`; different columns, 255 vs 200 length names, different unique index (`linkedin_url_normalized` vs `normalized_linkedin_url`) | Does `public.people` exist in production (C04)? Orion data in it? |
| `company_person_relationships` | `people/service.py:992,1008,1019,1029`; `review.py:76,136,148,169,179,221,243,247,291,380` | Analogue of Orion's `company_people`; `confidence_score` `numeric(3,2)` vs integer; different uniqueness rule | Mapping to Orion's `company_people`; none exists today |
| `person_contacts` | `people/service.py:1036`; `review.py:95,239` | Same name as Orion's `public.person_contacts`; `value`/`raw_value` vs `contact_value`/`normalized_value`; extra FKs | As `people` |
| `person_import_records` | `people/sources/run_service.py:379,384`; `review.py:259` | Analogue of Orion's `people_ingestion_quarantine`; keyed by `batch_id` into the shared `import_batches` | Dependency on the `import_batches` contract (2.7) |
| `person_change_history` | `review.py:44` | Analogue of Orion's `people_observations`; different semantics | Mapping and retention |
| `person_conflicts` | `review.py:231,260` | Analogue of Orion's `people_conflicts`; different statuses | Mapping |

- **Data contract still to be defined (not decided here):** column list, types and nullability of the read-only view; unpublished/withdrawn/stale/deleted handling; access control (a read-only role limited to the view).
- **Decision status:** ownership by the pipeline: DECIDED BY OWNER. Schema placement, view contract and treatment of Orion's own People tables: PROPOSED, NOT DECIDED.

---

## 4. Other tables the evidence may add
These were observed or implied but are not part of the requested matrix; ownership is not proposed here.
- Pipeline-only tables found in the pipeline repository and HIST production observations: `pipeline_jobs`, `import_logs`, `execution_logs`, `accounts`, `user_sessions`, `unlocked_leads`, `master_businesses`, `dataset_versions`, `publishing_history`, `enrichment_records`, `entity_relationships`, `entity_conflicts`, `verification_reviews`, `duplicate_records`, `export_history`, `lead_activity_log`, `product_analytics_events`, `deleted_leads` (the last has no migration in either repository). A static search found no reference to any of them in Orion's API, gateway or front end. `PENDING EVIDENCE` for current presence.
- Views: `orion_published_businesses` (pipeline migrations, public schema, rebuilt four times with `DROP VIEW … CASCADE`); `orion_published_people` (pipeline `013`, not applied per HIST).
- Orion-only tables (wallets, packages, queue and OTP tables, and the other People tables above) are Orion-owned by definition of their migrations; not part of this matrix.
- Migration bookkeeping: `drizzle.__drizzle_migrations` (Orion) and `public.schema_migrations` (pipeline) are each owned by their runner.

## 5. Role implications (design input only; nothing created or granted)
- The two applications must not share a role (owner decision). HIST: only `neondb_owner` and `neon_service` were seen, so separation does not exist today (to verify, C11).
- Needed, as a later separately approved proposal: an Orion application role, an Orion migration role, a pipeline application role, a pipeline migration role, and a read-only role limited to the published-People view for Orion.
- Shared tables raise a harder question than schemas: any table both applications write needs either column-level privileges and a documented contract, or a single writer.

## 6. What this matrix does not decide
- Any table's authoritative owner.
- Whether the pipeline's customer, authentication, credit and export functions continue.
- The mapping or retirement of Orion's own People model.
- Whether `file_key` and `r2_object_key` are equivalent.
- Anything about roles, grants, schemas or views to create.

Each of these needs evidence (Phase A2 results) and a separate written decision.


---

# Part II. Second-pass update (2026-10-02): write locations, conflicts, proposed final ownership

**Status: PROPOSED. Nothing in this Part is final or approved.** Part I (above) was reviewed before this update and is kept as written, except for the corrections below. No database was contacted and no SQL was executed.

## II.0 Corrections to Part I and to earlier reports
- Pipeline repository state is **27 entries**, not "15 modified + 11 untracked": 15 modified tracked files, **1 staged deletion** (`scripts/test_migration_fresh.py`) and 11 untracked files. `run.bat` and `setup.bat` are **untracked** (not in HEAD).
- Earlier reports said `run.bat` was "identical to HEAD". That was a mistaken reading (an untracked file shows no diff). It is not part of committed history.
- Pipeline `server.py` line numbers cited in this document are **working tree**. At HEAD the same handlers sit about 18 lines earlier (for example `/api/auto-process` HEAD:1000, `/api/delete-records` HEAD:1197, `/api/customer/credits/add` HEAD:738, `do_DELETE` HEAD:1562, embedded worker HEAD:1690).
- Evidence labels: **WT** working tree; **HEAD** committed (unchanged in the working tree unless stated); **HIST** earlier audit observation (2026-10-01), not current; **RUNTIME?** requires verification of the deployed system or the database.

## II.1 Per-table detail (the seven shared tables)

### `users`
| Item | Detail |
|---|---|
| Proposed final owner | **Orion** (customer identity). PROPOSED, NOT FINAL. |
| Target writers / readers | Writers: Orion only. Readers: Orion; the pipeline needs no user data. |
| Actual write locations | Orion API: `apps/api/src/auth/services/auth.service.ts:62`; `modules/oauth/oauth.service.ts:236`; `modules/user/user.repository.ts:61,83,103`; `modules/user/user.service.ts:106,133`. Orion gateway (`ownus/src/app/api/v1/[...path]/route.ts`, WT): `:234,250,269,1240,1397,1417,1553,1823,1828,2033,2103,2154,2210,2258,2320`. Pipeline: `python_pipeline/commercial/auth.py:71` (HEAD, unchanged). |
| Current schema and migration source | Orion: `apps/api/src/database/schema/users.ts`, migration `0000` (applied in production per HIST). Pipeline: `migrations/011_create_customer_commercial_layer.sql` (`CREATE TABLE IF NOT EXISTS users`, a different shape; it cannot have created the table where Orion's already existed). |
| Conflicts / out-of-band | `role`: Orion enum (SUPER_ADMIN, ADMIN, DATA_MANAGER, MEMBER, USER) vs pipeline text default `'customer'`; pipeline `is_active` and `NOT NULL password_hash`, which Orion models differently (Orion: `status` enum, nullable `password_hash` for OAuth users). HIST: no extra columns were reported on `users`, so pipeline signup cannot have worked against Orion's table unless the columns exist (RUNTIME?). |
| Contract and evidence required | A statement that Orion is the only writer. Evidence: Phase A2 C05 (columns/types) and C13a (role distribution). |
| Unresolved decisions | Do pipeline-origin users or sessions exist; is the pipeline's login in use; who may administer pipeline reviewers if its self-service roles go away. |

### `credit_transactions` (and balances)
| Item | Detail |
|---|---|
| Proposed final owner | **Orion** (credit ledger and wallets). PROPOSED, NOT FINAL. |
| Target writers / readers | Writers: Orion's credit service only (single code path). Readers: Orion; pipeline none. |
| Actual write locations | Orion API: `auth/services/auth.service.ts:94`; `modules/credit/credit.service.ts:51,76,110,267,329,349,403,489`. Orion gateway: `route.ts:1281,1303` (also `user_wallets` at `:1272,1294`); `ownus/src/lib/unlock-business.ts:28,38` (atomic unlock SQL). Pipeline: `commercial/auth.py:96`, `commercial/credits.py:65,179`; reachable through `server.py:756-783` (`POST /api/customer/credits/add`). |
| Current schema and migration source | Orion: `schema/credits.ts` family, migration `0000`; wallet table `user_wallets`. Pipeline: `011` defines an account-based ledger (`accounts.credit_balance INTEGER NOT NULL DEFAULT 50 CHECK >= 0`, `migrations/011_…sql:41`). |
| Conflicts / out-of-band | **Two balance models for one customer:** Orion `user_wallets` (daily + purchased credits) and pipeline `accounts.credit_balance`. HIST: production `credit_transactions` carries pipeline columns `account_id`, `transaction_type` not defined by Orion. The pipeline's add-credits handler trusts the client-supplied amount (no payment verification). |
| Contract and evidence required | An append-only ledger written only by Orion's service; Orion payment verification is the only credit source. Evidence: C05, C13b, C13c. |
| Unresolved decisions | Are there pipeline-origin transactions or balances to reconcile; which balance is authoritative for any customer who exists in both. |

### `saved_searches`
| Item | Detail |
|---|---|
| Proposed final owner | **Orion**. PROPOSED, NOT FINAL. |
| Actual write locations | Orion API: `modules/saved-searches/saved-searches.service.ts:17` (create), `:41` (update), `:54` (delete), through `common/repositories/base.repository.ts:113,129`. Pipeline: `commercial/searches.py:28` (insert), `:75` (delete). No gateway raw-SQL writer found. |
| Schema / migration source | Orion `0000`; pipeline `011` (different keying: `account_id`, `filter_criteria`). HIST: production has `account_id`, `filter_criteria` not defined by Orion. |
| Contract and evidence required | One writer; evidence C05 and row provenance. |
| Unresolved decisions | Whether pipeline-origin rows exist and must be migrated or dropped. |

### `businesses`
| Item | Detail |
|---|---|
| Proposed final owner | **Split by column, not whole table:** Orion owns product-facing identity and publication state; the pipeline owns ingestion/enrichment/verification attributes. PROPOSED, NOT FINAL; a column-level contract is required. |
| Target writers / readers | Orion: customer discovery, unlock, search read; Orion writes publication state. Pipeline: writes its own columns only. |
| Actual write locations | Orion API: `modules/business/repositories/business.repository.ts:81`; `modules/business/services/business.service.ts:110,226`. Gateway: `route.ts:1096,3063,3074,3107,3112`. Pipeline (all HEAD, unchanged): `db.py:273,342,455,552`; `enrichment/service.py:270`; `entity_resolution/service.py:163,613`; `freshness/service.py:356,450,465,615`; `pipeline.py:331`; `publishing.py:366,530`; `verification.py:118,466,481,499,528`. |
| Current schema and migration source | Orion: `schema/businesses.ts`, migration `0000` (`status` enum `business_status`: DRAFT, PENDING_VALIDATION, VERIFIED, PUBLISHED, ARCHIVED, REJECTED). Pipeline: `schema.sql:34` (`status VARCHAR(50)`, "legacy/compatibility") plus its own columns (`stage`, `publishing_status`, `verification_status`, `dataset_version`, `unpublished_at`, …). HIST: 22 pipeline columns on the production table. |
| **Verified publication path (static)** | **Orion's customer-facing reads gate on `businesses.status = 'PUBLISHED'`:** `modules/discover/discover.service.ts:197,357,498,509,528,534`; `modules/unlock/unlock.service.ts:37,66`; `modules/search/providers/postgres-search.provider.ts:31`; gateway `route.ts:2536,2896` (these also accept legacy `'active'`/lower-case values). **The pipeline's publish step does not write `status`:** it sets `publishing_status='PUBLISHED'`, `stage='PUBLISHED'`, `published_at=NOW()` (`publishing.py:365-373`) and unpublishes with `publishing_status='NOT_READY'`, `stage='APPROVAL'` (`:529-536`). The pipeline's own `orion_published_businesses` view filters `stage`, `publishing_status` and `verification_status`, not `status` (`migrations/010_…sql:162-164`). It also writes `status='DUPLICATE'` (`verification.py:503`), a value outside Orion's enum. |
| Interpretation | Statically, **Orion's `status` is what decides visibility to Orion customers today**, so it is the de-facto authority on the read side; the pipeline publishes through different fields and, with an enum column, its `DUPLICATE` write would fail. Which fields production rows actually carry, and whether `status` is an enum in production, are RUNTIME? (Phase A2 C05, C14). |
| Contract required | One documented publication state machine and mapping: who may set `status`, how pipeline `publishing_status`/`stage` map to it, what unpublish/withdraw/stale/duplicate mean, and that the pipeline never writes `status`. Do not change the authority until existing data is verified. |
| Unresolved decisions | Authority confirmation; treatment of rows where the two disagree; the `DUPLICATE` state; the gateway's legacy `'active'` acceptance. |

### `business_history`
| Item | Detail |
|---|---|
| Proposed final owner | Follows the state it records. **PENDING EVIDENCE.** Orion records product-facing changes; pipeline transitions are better kept in a pipeline-owned history table (proposal only). |
| Actual write locations | Orion: `modules/business/repositories/business-metrics-scores.repository.ts:81`; `modules/business/services/business.service.ts:233`; gateway delete `route.ts:3053`. Pipeline: `db.py:375`; `freshness/service.py:399,522`; `publishing.py:433,581`; `verification.py:564`. |
| Schema / migration source | Orion `0000`; pipeline `schema.sql`. HIST: 4 pipeline columns not in Orion's schema (`previous_stage`, `diff_data`, `stage`, `raw_original_data`). |
| Conflicts / unresolved | The gateway deletes history rows when deleting businesses; two vocabularies of "change". Decide retention and which application reads which rows. |

### `duplicate_clusters`
| Item | Detail |
|---|---|
| Proposed final owner | **PENDING EVIDENCE.** Orion runs an admin duplicate-review module; the pipeline runs its own deduplicator. Both create and use clusters. |
| Actual write locations | Orion: `modules/import/repositories/duplicate-review.repositories.ts:15`; gateway delete `route.ts:3058`. Pipeline: `python_pipeline/deduplicator.py:421`. |
| Schema / migration source | Orion `0000`; pipeline `migrations/001_create_deduplication_tables.sql`. HIST: 2 extra columns (`cluster_type`, `canonical_business_id`). |
| Unresolved | Whether the two engines' clusters coexist; which review outcome is authoritative. |

### `import_batches`
| Item | Detail |
|---|---|
| Proposed final owner | **The pipeline for ingestion batches** (owner's stated direction), with Orion's own admin-import batches either separated or marked by a documented contract. PROPOSED, NOT FINAL. |
| Actual write locations | Orion API: `modules/import/repositories/import.repositories.ts:23` (insert), `:40,55` (updates); `modules/import/services/import-operations.service.ts:213`; Orion sets `fileKey` at `admin-import.service.ts:417-419`. Gateway: `route.ts:1060` (insert with `file_key`), `:3206` (delete on rollback). Pipeline (HEAD, unchanged): `batch_manager.py:93` (insert), `:153` (update); `people/sources/run_service.py:279` (update `processing_status`). |
| Current schema and migration source | Orion `schema/imports.ts`, migration `0000` (+ `0006` adds `people_summary`). Pipeline `migrations/003_create_import_batches.sql` (`CREATE TABLE IF NOT EXISTS`, a no-op on the existing table). |
| Conflicts / out-of-band | Orion writes `file_key`, `status`, `total_records`, `successful_records`, `failed_records`, `created_by_id`; the pipeline writes `r2_object_key`, `r2_uri`, `sha256_checksum`, `processing_status`, `content_type`, `source_type`, `total_rows`, `successful_rows`, `failed_rows`, `error_summary`. The ten pipeline columns exist in production but in **neither** repository's migrations (HIST; migration owner: none). The string `file_key` appears nowhere in the pipeline project; Orion does not know `r2_object_key`. |
| **`file_key` semantics** | **Unresolved. Not assumed equal to `r2_object_key`.** No backfill, rename, constraint or repurposing until the semantics and all writers are verified (C08 gives counts and prefix classes only). |
| Proposed versioned contract (`import_batches` v1, for decision) | One write owner per column group, recorded in a column-owner table: *Orion-owned* (`status`, `*_records`, `created_by_id`, `file_key`, `mapping_config`, `options`, `people_summary`); *pipeline-owned* (`r2_*`, `sha256_checksum`, `processing_status`, `*_rows`, `error_summary`, `content_type`, `source_type`); *shared immutable* (`id`, `filename`, `file_size`, `created_at`). A batch declares its origin explicitly (an owner/origin column) instead of inferring it from key prefixes. Consumers (Orion metrics and admin lists) read only declared consumer fields through a view. Legacy rows keep their present values; the origin of existing rows is established from evidence, not guessed. |
| Unresolved decisions | Who altered the table; meaning of `file_key` for the pipeline's rows; `SUPERSEDED` (no writer found in either repository); one table vs two. |

## II.2 Pipeline customer-layer inventory and consolidation proposal
The pipeline ships its own customer product, writing Orion's shared tables. The routes below are in `server.py` (WT lines; HEAD about 18 earlier). Reachability and use are RUNTIME? (Phase A2 C13a/b/c; network exposure is unverified).

| Feature | Pipeline route (WT line) | Tables written | Orion equivalent | Proposed action (analysis only) |
|---|---|---|---|---|
| Signup | `POST /api/auth/signup` (709) | `users`, `accounts`, `credit_transactions` (`auth.py:71,96`) | `apps/api/src/auth` | Retire after confirming no live users |
| Login/logout/me | `POST /api/auth/login` (733), `logout` (748), `GET /api/auth/me` (307) | `user_sessions` | Orion JWT auth | Retire; migrate any live accounts first |
| Dashboard, credits, ledger | `GET /api/customer/dashboard` (314), `/credits` (326), `/credits/ledger` (341) | read | Orion dashboard, credit module | Retire |
| **Add credits** | `POST /api/customer/credits/add` (756) | `credit_transactions` | Orion payment-verified credits only | **Disable first** (self-credit, no payment check) |
| Lead list/detail | `GET /api/customer/leads` (356), `/leads/*` (385) | read | Orion discover | Retire |
| Unlock | `POST /api/customer/leads/unlock` (784) | `unlocked_leads`, `credit_transactions` (`credits.py:105-106` reads `orion_published_businesses`) | Orion unlock service (atomic) | Retire; migrate unlock history if customers exist in both |
| Saved searches | `GET/POST /api/customer/saved-searches` (411, 820), `DELETE` (1603) | `saved_searches` (`searches.py:28,75`) | Orion saved searches | Retire |
| Lead management | bulk status/tag/archive (850, 882, 918), `PATCH /api/customer/leads/*` (1536) | `lead_activity_log` | Orion saved leads | Retire |
| Export | `POST /api/customer/export` (950), `GET` history (423, 438) | `export_history` | Orion exports | Retire; keep the pipeline's admin People export if needed |
| Admin commercial summary | `GET /api/admin/commercial/summary` (480; role from client headers when unauthenticated) | read | Orion admin | Restrict, then retire |

**Order that cannot break existing users or balances**
1. *Evidence:* Phase A2 C13 and any pipeline-side usage logs, to learn whether live pipeline customers or balances exist.
2. *Restrict (needs pipeline code change and separate approval):* put every customer route behind authentication and a feature flag defaulting off; first the add-credits route; no new writes to shared tables.
3. *Reconcile (read-only report, then a reviewed one-off migration):* map any pipeline `users`/`accounts` to Orion users and wallets; present balance discrepancies to the owner; never move a balance without a signed reconciliation.
4. *Retire:* remove routes and table writes after a notice period; keep old data in archive tables. Rollback = re-enable the flag, because nothing is dropped.

## II.3 Proposed final ownership (summary, for decision)
| Table | Proposed final owner | Proposed writers after consolidation | Status |
|---|---|---|---|
| `users` | Orion | Orion API only | PROPOSED, depends on C13a |
| `credit_transactions` (+ wallets) | Orion | Orion credit service only | PROPOSED, depends on C13b/C13c |
| `saved_searches` | Orion | Orion API only | PROPOSED |
| `businesses` | Split by column | Orion: product/publication state; pipeline: pipeline columns | PROPOSED; contract needed |
| `business_history` | Follows state | Orion product history; pipeline history separate | PENDING EVIDENCE |
| `duplicate_clusters` | Undecided | undecided | PENDING EVIDENCE |
| `import_batches` | Pipeline for ingestion batches; column-level contract | per column group (II.1) | PENDING EVIDENCE |
| Pipeline People tables (6) | Pipeline, in `orion_pipeline` | Pipeline only | Ownership decided by owner; placement PROPOSED |

## II.4 Open decisions (all owner-controlled)
1. Confirm or change each proposed owner above, after the Phase A2 evidence.
2. Publication authority and the mapping of pipeline fields to `status`.
3. Fate of the pipeline's customer layer and any live accounts or balances.
4. `import_batches`: one table with a column-owner contract, or two tables; the meaning of `file_key`.
5. Whether Orion's own People tables stay in `public`, are replaced by the published view, or are migrated.
6. Whether Orion's gateway raw-SQL writers move behind the API.


---

# Part III. Third-pass update (2026-10-02): decision statuses, permissions, contract evidence

**Status: PROPOSED.** Part I and Part II are kept. This Part adds explicit decision statuses, the proposed permissions, and the contract evidence for import batches, business publication, People and customer accounts. No database was contacted and no SQL executed.

Status vocabulary: **VERIFIED (static)** means confirmed by reading source in the stated state (WT or HEAD), not confirmed in any deployment or database; **PROPOSED** a design proposal; **PENDING EVIDENCE** needs runtime or database evidence (Phase A2) or an owner decision. Nothing is labelled verified merely because a design document says so.

## III.1 Decision status per shared table
| Table | Statement | Status |
|---|---|---|
| `users` | Orion code is the only writer designed for this table; the pipeline also writes it (`commercial/auth.py:71`) | VERIFIED (static) |
| `users` | Orion should own it exclusively | PROPOSED |
| `users` | Pipeline-origin users exist in production | PENDING EVIDENCE |
| `credit_transactions` | Orion has one service path for the ledger; the pipeline has three further writers (`auth.py:96`, `credits.py:65,179`) | VERIFIED (static) |
| `credit_transactions` | Orion should own ledger and wallets | PROPOSED |
| `credit_transactions` | Production holds pipeline-written rows and the extra columns | PENDING EVIDENCE |
| `saved_searches` | Orion and the pipeline each write it with different keys (`user_id` vs `account_id`) | VERIFIED (static) |
| `saved_searches` | Orion should own it | PROPOSED |
| `businesses` | Orion customer reads gate on `status = 'PUBLISHED'`; the pipeline's publish does not write `status` | VERIFIED (static) |
| `businesses` | Orion `status` is the publication authority | PROPOSED (not verified against data or against the allowed values in production) |
| `businesses` | Production `status` is the enum | PENDING EVIDENCE |
| `business_history` | Both write it; semantics differ | VERIFIED (static); ownership PENDING EVIDENCE |
| `duplicate_clusters` | Both write it; two engines | VERIFIED (static); ownership PENDING EVIDENCE |
| `import_batches` | The two writers use disjoint column groups; `file_key` is unknown to the pipeline and `r2_object_key` unknown to Orion | VERIFIED (static) |
| `import_batches` | The pipeline should own ingestion batches under a column-owner contract | PROPOSED |
| `import_batches` | `file_key` and `r2_object_key` are equivalent | **NOT ASSUMED**, PENDING EVIDENCE |
| Pipeline People tables | The pipeline owns People ingestion and records | Decided by the owner (as stated) |
| Pipeline People tables | They live in `orion_pipeline` | PROPOSED |

## III.2 Proposed read/write permissions (design only; nothing created or granted)
Roles are those in `TARGET_ARCHITECTURE.md` §8. "—" means no access. Column grants are required wherever a table is shared.

| Table | `orion_app` | `pipeline_app` | Notes |
|---|---|---|---|
| `users` | SELECT, INSERT, UPDATE (no DELETE unless the account-deletion flow needs it) | — | Pipeline needs no user data |
| `credit_transactions`, wallets | SELECT, INSERT (append-only; no UPDATE/DELETE of ledger rows) | — | single writer: the credit service |
| `saved_searches` | SELECT, INSERT, UPDATE, DELETE | — | |
| `businesses` | SELECT, INSERT, UPDATE on Orion-owned columns (including `status`, `published_at`) | SELECT; `UPDATE` on pipeline-owned columns only (column grant); no write to `status`; no DELETE | `DELETE FROM businesses` (pipeline `db.py:455`, gateway `route.ts:3063,3074`) needs an explicit decision |
| `business_history` | SELECT, INSERT (Orion rows) | SELECT; INSERT of its own rows only if the contract allows | undecided |
| `duplicate_clusters` | undecided | undecided | PENDING EVIDENCE |
| `import_batches` | SELECT; INSERT/UPDATE on Orion-owned column group | SELECT; INSERT/UPDATE on pipeline-owned column group | enforced by column grants plus an origin column |
| `orion_pipeline.*` base tables | — | full DML | |
| `orion_pipeline.published_people_v1` and tombstone view | SELECT | owner (via migrator) | read-only for Orion |

Sequence privileges follow the tables each role may insert into. Neither application role owns any object or may run DDL.

## III.3 C1: `import_batches` writers and consumers
| Group | Locations |
|---|---|
| Orion writers | `modules/import/repositories/import.repositories.ts:23` (insert), `:40,55` (updates); `modules/import/services/import-operations.service.ts:213`; `modules/import/services/admin-import.service.ts:417-419` (sets `fileKey`, `status`, `totalRecords`); gateway `route.ts:1060,3206` |
| Pipeline writers | `python_pipeline/batch_manager.py:93` (insert), `:153`; `python_pipeline/people/sources/run_service.py:279` |
| Orion consumers | `import.repositories.ts:16-67`; `modules/people/metrics/people-metrics.service.ts` (counts by `status`, durations from `started_at`/`completed_at`); admin batch list in the gateway |
| Pipeline consumers | `batch_manager.py:40` (checksum lookup), `people/review.py:489,573`, `people/sources/run_service.py:267`, `people/source_runs_api.py:152,194,210`, `verification.py:260` |
| Observed field distinction | Orion: `file_key`, `status`, `total_records`, `successful_records`, `failed_records`. Pipeline: `r2_object_key`, `r2_uri`, `sha256_checksum`, `processing_status`, `total_rows`, `successful_rows`, `failed_rows`. Neither side reads the other's fields |
Recommendation (PROPOSED): one write owner per column group with a column-owner contract and an explicit origin discriminator (Part II); Orion consumers read declared consumer fields through a view; no rename, backfill, constraint or equating of `file_key` and `r2_object_key` until the semantics of all writers are verified. Legacy rows are classified from Phase A2 evidence (C08), not assumed.

## III.4 C2: business publication fields
| Field | Writers | Readers |
|---|---|---|
| `status` (Orion enum `business_status`) | Orion: `business.repository.ts:81`, `business.service.ts:110,226`; gateway `route.ts:3107,3112`; pipeline: `verification.py:503` (`'DUPLICATE'`), and the default `'DRAFT'` of its own definition (`schema.sql:34`) | Orion customer reads: `discover.service.ts:197,357,498,509,528,534`, `unlock.service.ts:37,66`, `postgres-search.provider.ts:31`, gateway `route.ts:2536,2896` (also accepts legacy `'active'`) |
| `publishing_status`, `stage` (pipeline-only columns) | pipeline: `publishing.py:365-373,529-536`, `verification.py:484,502`, `db.py:342`, `freshness/service.py`, `entity_resolution/service.py` | pipeline: `orion_published_businesses` (`migrations/010_…sql:162-164`), publishing queue (`publishing.py:210-220`), `db.py:128`; Orion: none |
| `published_at` (Orion column also written by the pipeline) | Orion: `business.repository.ts:84`, `business.service.ts:116`; pipeline: `publishing.py:365-373` | no customer-visibility gate in Orion reads found |
`DUPLICATE` conflict: the pipeline assigns `status = 'DUPLICATE'` when it confirms a duplicate; Orion's enum has no such value. If the production column is the Orion enum, that statement raises and the verification action fails; if it is a plain varchar, Orion code receives a value it does not model. Which applies is PENDING EVIDENCE (C05 reports the column type; C14 reports the value distribution).
Intended direction (PROPOSED, not implemented): Orion owns the customer-facing publication decision through `businesses.status`; the pipeline expresses readiness in its own fields and never writes `status`; a documented mapping and a hand-off mechanism are defined in `TARGET_ARCHITECTURE.md` §6. The authority is not declared verified until the actual column type, allowed values, writers, and the behavior of both sides on real rows are established.

## III.5 C3: People inventory (no existing People table is dropped, renamed, moved or synchronised)
| Item | Orion | Pipeline |
|---|---|---|
| Tables | `people`, `company_people`, `person_contacts`, `person_unlocks`, `people_evidence`, `people_verifications`, `people_sources`, `people_observations`, `people_suppressions`, `people_conflicts`, `people_ingestion_quarantine`, `people_acquisition_runs`, … (migrations 0004–0016, uncommitted, not in production per HIST) | `people`, `company_person_relationships`, `person_contacts`, `person_import_records`, `person_change_history`, `person_conflicts` (migration 013, committed) |
| Endpoints | `internal/people-review` (20 routes), `internal/people-verification` (3), `internal/people-metrics` (2), `admin/people/import` (3), customer routes in `people.controller.ts` (6) | `/api/admin/people/*` via `python_pipeline/people/admin_api.py` (`server.py:190,706,1533`) |
| Consumers | gateway `route.ts:2669-2690`; front end `company-people-section.tsx`, admin People views, `lib/people-import.ts`, `lib/api-client.ts` | pipeline review/export (`people/review.py`, `export_service.py`) |
| Views | none | `orion_published_people` (013, depends on `orion_published_businesses`) |
Proposal (unchanged): pipeline-owned People tables in `orion_pipeline`; a versioned, explicit-column, read-only `published_people_v1` plus a tombstone view for removals; private contact values never exposed through it. Orion's own People tables stay untouched until their purpose and consumers are reviewed (`TARGET_ARCHITECTURE.md` §5.4, options A/B/C, undecided).

## III.6 C4: customer accounts and credits: reconciliation before any retirement
1. **Verify use** (read-only evidence, Phase A2 C13a-c): do pipeline-origin users, sessions, accounts or ledger rows exist; are the routes reachable and used. Until verified, no route is disabled and no balance is touched.
2. **Inventory and match:** list pipeline `users`/`accounts` and Orion `users`/`user_wallets` by a stable key chosen by the owner (never silently by e-mail alone); classify each person as Orion-only, pipeline-only, or both.
3. **Reconcile balances:** produce a signed reconciliation report (pipeline `accounts.credit_balance` and ledger vs Orion wallet and ledger). Discrepancies are resolved by the owner; no balance moves without that report. Existing Orion balances are never reduced.
4. **Preserve history:** pipeline ledger rows are archived (copied, not deleted) before any change.
5. **Restrict, then retire** (separate approvals; pipeline code change): authentication on all customer routes, add-credits disabled first, feature flag off, observation period, removal. Rollback = flag back on.
Existing accounts and credits stay intact at every step; no step is taken in this task.
