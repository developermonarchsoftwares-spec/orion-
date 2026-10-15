# People export import (Phase 8A, background since Phase 8B)

Admin-only, People-only import of the **Published People export** of the separate People Pipeline (export_version `"1"`, CSV or JSON). Backend only: no UI, no schema change, no new table.

```
People Pipeline export (CSV / JSON) -> POST /admin/people/import
   parse + validate the FILE  ->  mapper (people-export.mapper.ts)  ->  IRawPersonRecord
   -> PeopleIngestionService.ingest(records, { sourceKey, batchRef, acquiredAt, dryRun })     (unchanged)
   -> CompanyResolverService (existing companies only) -> identity resolution -> role classification -> contacts -> evidence
   -> the existing review flow (everything is DRAFT / PENDING / unpublished / unverified)
```

Nothing in `PeopleIngestionService`, `CompanyResolverService`, the classifier or the source registry was changed. The import never creates a company.

## Background job (Phase 8B)

The import runs as a job on the **existing** Postgres queue (`queue_jobs`; queue name `people-import`); there is no second queue and no migration.

```
POST /admin/people/import   validate the file exactly as in 8A (400 / 413 before anything is staged)
                            -> stage the file in private object storage (StorageService, key people-imports/<uuid>.<ext>)
                            -> queue job { storageKey, format, dryRun, contentSha256, totalRows, batchRef, requestedBy }  (references only)
                            -> 202 { jobId, status: QUEUED, dryRun, totalRows, batchRef, exportVersion }
worker                      read the staged file, verify its SHA-256, PeopleExportImportService.run (slices of 250 records),
                            checkpoint after each slice, final result, discard the staged file
GET  /admin/people/import/:jobId   safe status view (admin only)
```

* **Status view** (`QUEUED`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_ISSUES`, `DRY_RUN`, `FAILED`): `totalRows`, `processedRows`, `imported`, `updated`, `unchanged`, `valid`, `quarantined`, `failed`, `matched`, `unmatched`, `ambiguous`, `reasonCounts`, `rejectedRows` (row + code), `observations`, `source`, `batchRef`, `errorSummary` (a fixed sentence), timestamps. Never names, contacts, company names, internal ids, storage keys or error text.
* **Progress and the final summary** live in `queue_jobs.result` (counts and codes only). The queue payload never holds file content or personal data.
* **Retry:** a transient failure makes the queue retry (3 attempts). The retry resumes from the last checkpoint, and is idempotent anyway (same run id, observation layer), so People are never duplicated and counts are not doubled. A crash between a slice and its checkpoint re-runs that slice: its rows are then reported as `unchanged`.
* **Terminal failure** (attempts exhausted, a payload that does not match its hash, or a payload that no longer validates): `FAILED` with a fixed `errorSummary`; nothing from the file or the database is recorded (`queue_jobs.error` holds only `PEOPLE_IMPORT_ATTEMPT_FAILED`); the staged file is deleted.
* **Redelivery:** a job whose stored result is final is never processed again.
* **Dry run** stays zero-write for People, contacts, roles, evidence, observations, quarantine and companies (the job row and the staged file are operational data, removed or final when the job ends).
* **Unavailable storage or queue:** a safe 503 (`IMPORT_STORAGE_UNAVAILABLE` / `IMPORT_QUEUE_UNAVAILABLE`); nothing is left staged or queued.

Limits of the existing queue that this inherits: no backoff between attempts, and a job whose process dies while `ACTIVE` is not re-claimed automatically.

## Admin screen and history (Phase 8C)

Admin sidebar -> **People Import** (`ownus`: `components/admin/views/people-import-view.tsx`, logic in `lib/people-import.ts`).

* **Flow:** choose a CSV or JSON file (up to 15 MB / 10,000 rows) -> optional **dry run** (default on) -> start -> the file is sent once to `POST /admin/people/import` -> the screen follows `GET /admin/people/import/:jobId` (1 s, then up to every 5 s) until a terminal status -> counts, reason codes and rejected row numbers -> history. A reload resumes an active job (only its reference is kept, in session storage).
* **Shows:** status, a progress bar, rows processed, imported (or "would be imported" for a dry run), updated, unchanged, matched, company not found, company ambiguous, quarantined, rejected rows, reason codes, and the fixed error summary of a failed job (with the progress it reached). **Never shows** names, contact details, rows, file contents, hashes, storage keys, queue payloads or internal ids: `toImportJob` keeps an allow-list of counts, codes and timestamps, so nothing else can reach the screen.
* **Errors:** 400 (by machine code: missing columns, wrong version, malformed file ...), 401 / 403, 413 (more than 10,000 rows), 503 (storage or queue unavailable; nothing imported), network failures, vanished jobs and failed jobs each get a fixed sentence derived from the status and code, never from the response text.
* **History:** `GET /admin/people/import?page=&limit=` (admin only, `limit` <= 100) lists the People import jobs of the existing queue (`queue_jobs`), newest first, in the same safe view as a single job. Nothing new is stored, so it keeps what the queue keeps: finished jobs older than 7 days are pruned by the existing queue maintenance.
* The gateway forwards both endpoints to the API unchanged (no native handler).

## Handoff hardening (Phase 9A)

Orion stays file-based: the admin downloads the Pipeline's published export and imports it. No machine authentication, outbound client or service-to-service API exists or is planned for this path.

* **Reconciliation.** Every job view (`GET /admin/people/import/:jobId`, history, and the synchronous result) carries a `reconciliation` block derived from counts the job already keeps; nothing new is stored. `rowsInFile = rejectedBeforeIngestion + receivedByIngestion` and `receivedByIngestion = accepted + quarantined + unaccounted`, where `accepted = imported + updated + unchanged` (`valid` in a dry run). `unaccounted` is 0 for a finished job; for a failed or running job it is the rows not yet processed, and `balanced` is false.
* **Several files for one large export.** Idempotency is per record (source key + `relationship_id`, within a run id derived from each file's content and `exported_at`). So a large export delivered as several files needs no Orion change: every file is its own run (`batchRef`), files that share no `relationship_id` never overlap, a file that fails is visible as FAILED / unbalanced and can be re-imported alone (same run id, idempotent), and importing the whole afterwards changes no People data. The 10,000-row limit per file is unchanged. Producing the parts is a Pipeline-side change that has not been made (see the Phase 9A report).
* **Source identification.** Pipeline exports use the existing `people-json` source (enabled, terms acknowledged). They are told apart by the run id (`people-export-v1-<hash>`), the observation `source_record_id` (= `relationship_id`) and, on held rows, the source label `people-pipeline-export[:provider]` in the quarantine record. A dedicated source row would need a data step plus a terms acknowledgement that has no admin surface today, and would stop imports until acknowledged, so none was added.
* **Unmatched companies.** Held rows are found through `GET /internal/people-review/quarantine?batchRef=<run id>` with the code `BUSINESS_NOT_FOUND`, and can be retried once the company exists (through the normal company flow), rejected or suppressed. A People export never creates a company.
* **Verification.** The Pipeline's verification and confidence are not imported and a later export can never lower what a Orion reviewer verified.

## Pipeline bundle import (Phase 9D)

The People Pipeline's Phase 9B split export is a ZIP: `manifest.json` first, then its parts (`orion_published_people_<ts>_<8 hex>_part-000N-of-000M.csv|json`) in order. An admin can upload that ZIP directly instead of extracting and uploading each part. **Orchestration only**: every part becomes an ordinary People import job (`PeopleImportJobService.enqueue`), so company matching, identity resolution, deduplication, quarantine, evidence, review state, verification protection and record-level idempotency are exactly those of a single-file import. No table, queue, migration or ingestion change.

```
POST /admin/people/import/bundle/validate   { content: <ZIP, base64> }            200 metadata only; nothing is queued or written
POST /admin/people/import/bundle            { content: <ZIP, base64>, dryRun? }   202 { bundleImportId, bundleId, parts: [{ partNumber, filename, jobId, batchRef, totalRows }] }
GET  /admin/people/import/bundle/:bundleImportId                                  aggregate status, per-part results, reconciliation
```
Admin only (`SUPER_ADMIN`, `ADMIN`).

**How an admin uses it:** the Pipeline exports `format=csv|json&split=<n>` and downloads the ZIP; in People Import, *Pipeline bundle* -> choose the ZIP -> **Validate bundle** (nothing is imported) -> tick or untick *Dry run* -> **Import bundle**; the result card shows the parts, the counts and the manifest-vs-Orion reconciliation. If a part failed or was never queued the bundle is shown as failed with the part numbers: import the **same ZIP again** (people already imported are unchanged, nothing is duplicated). Quarantined people are resolved in People Review; nothing is verified or published by an import.

**Limits (all layers).** A request passes: browser -> Next.js gateway -> API (Express body parser, route-scoped 20 MB, token-gated) -> service.

| Limit | Value | Enforced by |
| --- | --- | --- |
| Request body through the web gateway | **10 MiB** ("Payload too large. Maximum request body size is 10MB.", Next.js `proxyClientMaxBodySize`; measured: 10,485,760 bytes pass, one more is refused) | gateway, before Orion sees the request |
| API body | 20 MB | `applyUploadBodyLimit` |
| ZIP, accepted by the API | 11 MiB (decoded) | `BUNDLE_LIMITS.MAX_ZIP_BYTES` |
| ZIP, accepted by the screen | 7 MiB (a ZIP travels as base64 inside JSON, 4/3 larger, so only about 7.5 MiB can pass the gateway) | `BUNDLE_MAX_ZIP_BYTES` in `lib/people-import.ts` |
| One part | 15 MiB and 10,000 rows | Pipeline `MAX_PART_BYTES` / `MAX_PART_ROWS`; Orion `BUNDLE_LIMITS`, `OBSERVATION_LIMITS` |
| Parts, rows | 500 parts, 50,000 rows | Pipeline `MAX_PARTS` / `MAX_EXPORT_ROWS`; Orion `BUNDLE_LIMITS` |
| Extracted total / manifest | 64 MiB / 1 MiB | Orion `BUNDLE_LIMITS` |

A real 50,000-row export is about 41 MB extracted and a 5.4 MB ZIP, inside every limit. The single-file import has the same gateway cap: a CSV or JSON of more than about 10 MiB (as JSON text) cannot reach the API through the web gateway, although the screen and the API allow more. Raising `experimental.proxyClientMaxBodySize` in `ownus/next.config.ts` is the fix if larger uploads are wanted; it has not been changed.

* **Validation, all before anything is queued; any failure refuses the whole bundle (400, or 413 for size) with a machine code.** ZIP: central directory read directly (so duplicate members and the real member order are visible), single disk, no ZIP64, no encryption, stored or deflated only, flat plain file names (traversal, absolute and drive paths, backslashes, control characters, case-only duplicates refused), at most 501 entries, declared sizes checked before any inflating (manifest 1 MiB, part 15 MiB, total 64 MiB, ZIP 11 MiB) and enforced again while inflating (`maxOutputLength`), CRC-32 verified. Nothing is ever written to disk. Manifest: exactly the Phase 9B fields (a missing or extra field is refused), `export_version` "1", format `csv`/`json`, `bundle_id` form, `max_part_rows` 1..10,000, at most 500 parts, parts numbered 1..N with filenames that belong to the bundle, row counts, byte counts and SHA-256 well formed, `total_rows` equals the sum. Members: `manifest.json` first, then exactly the listed parts in the listed order, nothing else. Each part: exact byte length, exact SHA-256, valid UTF-8, then the existing People export validation (`prepare`: columns, version, row limit), the manifest's row count, `exported_at` equal to the manifest's.
* **Import.** Parts are queued in manifest order on the existing queue (first in, first out inside one process). Execution is also **one People import at a time across all API instances** (Phase 9E): each run holds a transaction-scoped Postgres advisory lock (`orion:people-import-run`) on its own connection. Without it, a second instance claiming waiting jobs ran two parts at once, and on real Postgres people met by work e-mail or phone in both parts were created twice (8 to 40 duplicates per 40) while a LinkedIn match failed on the unique index (whole parts quarantined as `PROCESSING_ERROR`); one at a time the same files give exactly the right people. A retried attempt resumes from its checkpoint and a failed part does not stop the next part. Each part job carries a small `bundle` reference in its payload (`bundleImportId`, `bundleId`, part number and count, filename, manifest totals): metadata only, no schema change. A storage or queue outage part-way gives 503 `BUNDLE_ENQUEUE_INCOMPLETE`: parts already queued still import and the rest are reported as "not imported".
* **Result.** `GET .../bundle/:id` returns, per part: number, filename, status (a normal job status, or `NOT_QUEUED`), run id (`batchRef`), imported, updated, unchanged, quarantined, rejected, rows not processed. Overall status: `QUEUED`/`RUNNING` while any part is unfinished, then `FAILED` if any part failed or was never queued, else `COMPLETED_WITH_ISSUES` if any part had quarantined or rejected rows, else `COMPLETED` (`DRY_RUN` for a dry run). The reconciliation sets the manifest's total rows and part count against Orion's totals; `failed` counts rows of failed parts that were not processed plus all rows of parts never queued, and `balanced` is true only when every part finished and every manifest row has exactly one outcome.
* **Idempotency.** The same ZIP twice gives the same part run ids and 12 of 12 unchanged: nothing blocks a re-import by `bundle_id`, because a bundle may legitimately be imported again after a partial failure. A later export of the same people (a different bundle) creates no duplicates; rows of a person who holds roles at several companies report as `updated`, not `unchanged`, on a later export. Cause (traced on real Postgres): each such row names that company's work e-mail as the person's primary e-mail, so processing the rows one after the other flips `is_primary` between the person's e-mails and then back (the last row processed wins), and each flip counts as an update. Nothing else changes except freshness timestamps (`last_seen_at`, `updated_at`): no new person, role, contact or evidence, and the state after the whole export equals the state before. The same file imported twice reports everything unchanged. It is cosmetic and nothing customer-facing reads it (contacts stay unpublished until a reviewer publishes them), so it is not changed.
* **Contacts on a row are company-scoped (Phase 17).** The Pipeline People export selects contacts only from the relationship's own company. It does not fall back to contacts belonging to another company: a company with no contact of its own gets an empty email / phone / mobile, never the person's contact from elsewhere (and a contact with no recorded company is exported only for a one-company person). Orion's contact attribution relies on this: a contact that arrives on a company's row is recorded as reported for that company, and Orion cannot tell a fallback contact from a genuine one. Exports produced before the Phase 17 Pipeline change can carry such fallback contacts. Limit: the Pipeline stores one company per contact (the first that reported it), so a value later seen for a second company is exported for the first only.
* **Provenance.** Preserved today: `relationship_id` (observation `source_record_id`), the part's run id (`people-export-v1-<hash>`), the export time as the acquisition time, `last_seen_at` as the observed time, and the Pipeline `bundle_id` / part number in the part job's payload (kept for as long as the queue keeps finished jobs: 7 days). **Not preserved on accepted records: `source_provider` and `source_acquired_at`**, and the `bundle_id` beyond the queue's retention. Preserving them durably needs an additive migration. Decision (Phase 9E): keep the current model. Nothing customer-facing needs them (the reviewer dossier, since Phase 11, shows the run reference and source record, which is enough to find a row in the Pipeline; the bundle id is still not shown), only one provider exists, they take no part in deduplication or evidence fingerprints today, and the cost is a production migration plus ingestion changes with no consumer; revisit when a second provider, a compliance requirement or provider-level quality reporting appears.

**Release check on a real Postgres** (not part of the normal test run, which is hermetic on an in-process database): before a release that touches People import, run the disposable-Postgres check. On a developer machine with a local PostgreSQL, create a throwaway database, apply the Orion migrations (`0000`..`0017`, the list in `__tests__/pglite-test-db.ts`), start the real queue and People import over a `pg` pool, upload the Pipeline's real ZIPs through `POST /admin/people/import/bundle` and confirm: every part completes, people and roles match the Pipeline data, companies are unchanged, nothing is published, the same ZIP again is all `unchanged`, a tampered ZIP is refused with no job queued, a failed part is reported FAILED and a re-upload completes it, and two parts run at the same time give no duplicate people. Drop the database afterwards. It needs a PostgreSQL server and create-database rights, which the normal suite and CI must not assume, so it is a documented procedure and not a committed test.

## Endpoint

`POST /admin/people/import` (`SUPER_ADMIN`, `ADMIN`; anonymous 401, everyone else 403) returns **202**. JSON body:

| Field | Meaning |
| --- | --- |
| `format` | `csv` or `json` |
| `content` | the export file as text (the CSV, or the JSON envelope `{export_version, exported_at, record_count, people[]}`) |
| `dryRun` | optional real boolean. Parses, validates and resolves companies, writes nothing (no People, contacts, roles, companies, quarantine rows or observations). Dry-run outcomes are `VALID` or `QUARANTINED`; whether a valid row would be created, updated or unchanged cannot be known without writing. |

The route has the same token-gated, route-scoped 20 MB JSON body limit as the company upload routes (`common/http/upload-body-limit.ts`); every other route keeps the default.

## File contract

Exactly the frozen 38 fields. CSV needs every column in the header (extra columns are ignored); JSON needs every per-person key. `export_version` must be `"1"`; `exported_at` must be a valid, non-future date (CSV: identical on every row); JSON `record_count` must equal the number of people. A file with a wrong version, missing columns/keys, malformed CSV/JSON, an invalid `exported_at`, or no rows is refused with a **400** and a machine code (never any row content), and nothing is imported.

**Row ceiling:** at most 10,000 rows, the existing keyed-run limit (`OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN`). A larger file is refused whole (**413** `BATCH_TOO_LARGE`); nothing is split or partially imported. The People Pipeline's 50,000-row maximum needs chunking in a later phase.

## Mapping

| Export field | Goes to |
| --- | --- |
| `company_name`, `company_city`, `company_state` | `company.name / city / state` (shared resolver, exact normalised name + corroborating location) |
| `gstin`, `cin`, `pan` | `company.identifiers[]` (format-checked; a malformed one fails that row) |
| `full_name`, `job_title` | `personName`, `jobTitle` |
| `email`, `phone`, `mobile`, `linkedin_url` | `email`, `phone`, `mobile`, `linkedinUrl` |
| `person_city`, `person_state`, `person_country` | `city`, `state`, `country` |
| `relationship_id` | `source.recordId` (the idempotency key together with the source key) |
| `last_seen_at` (else `source_acquired_at`) | `source.observedAt` |
| `exported_at` | the run's `acquiredAt` |
| `source_provider` | `source.label` (`people-pipeline-export[:provider]`) |

Source key: the existing seeded `people-json` MANUAL_IMPORT source (structured, already-mapped records). A dedicated registry row would be a data step needing a terms acknowledgement, so it is deferred.

**Never sent / never imported:** `business_id`, `business_slug`, `master_business_id`, `person_id` (they belong to the source database); `department`, `seniority_level`, `decision_maker_type` (the vocabularies differ; Orion derives them from `job_title`); `first_name`, `last_name` (derived from `full_name`); the five `*verification_status` fields, `confidence_level`, `published_at`, `last_verified_at` (nothing is verified or published by this import).

## Behaviour

* **Company outcomes** are the existing ones: `MATCHED` continues; `AMBIGUOUS` (`AMBIGUOUS_COMPANY_MATCH`, including conflicting identifiers) and not found (`BUSINESS_NOT_FOUND`) go to `people_ingestion_quarantine`.
* **Rows rejected before ingestion** (`failed`): no/invalid `relationship_id`, a repeated `relationship_id`, a malformed GSTIN / CIN / PAN. Reported by row number and code only.
* **Idempotency:** the run id (`batchRef`) is derived from the file's content and `exported_at`, so importing the same file again is recognised by the observation layer (`UNCHANGED`, nothing recorded twice). A later export of the same data adds one observation per record and changes no People data.
* **Response:** counts and codes only (`batchRef`, `status`, `totalRows`, `matched`, `unmatched`, `ambiguous`, `imported`, `updated`, `unchanged`, `valid`, `quarantined`, `failed`, `reasonCounts`, `rejectedRows`, `observations`). No names, contacts, company names, ids, paths, SQL or stack traces. `matched` = rows whose company was identified and that were accepted; `quarantined` includes `unmatched` and `ambiguous`.

## Limitations

10,000 rows per import; no UI or import history; a dedicated source registration is deferred; per-row `source_acquired_at` has no per-row destination (`acquiredAt` is per run) and is used only as the `observedAt` fallback; contacts enter UNVERIFIED and unpublished, and exported verification statuses have no destination.

Code: `modules/people/ingestion/sources/people-export.mapper.ts`, `ingestion/people-export-import.service.ts`, `ingestion/people-export-import.controller.ts`, `dto/people-export-import.dto.ts`. Tests: `people-export.mapper.spec.ts`, `people-export-import.integration.spec.ts`.
