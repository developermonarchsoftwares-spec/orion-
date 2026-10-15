# Import and export (Orion API)

Applies to `apps/api`. Migration: `0020_exports`. Related: `PEOPLE_EXPORT_IMPORT.md`, `PEOPLE_UPLOAD_OPERATIONS.md`.

## 1. Bulk CSV import (administrators)

| Endpoint | Purpose |
|---|---|
| `POST /admin/import/csv/preview {csv, mapping?}` | Parses the file and returns a **parse report** plus the usual validation / duplicate preview. Writes nothing |
| `POST /admin/import/csv/submit {filename?, csv, mapping?, autoPublish?}` | Imports through the existing pipeline. The response links to the batch report and, when rows failed, to the failed-rows CSV |
| `POST /admin/import/preview`, `/submit` | Unchanged: rows already parsed by a client (also how XLSX uploads arrive) |

The parser handles quoted fields, doubled quotes, embedded commas and line breaks, CRLF, a UTF-8 BOM, and comma / semicolon / tab delimiters. Structural problems are reported by **row number and code only** (`DUPLICATE_HEADER`, `EMPTY_HEADER`, `FEWER_CELLS_THAN_HEADERS`, `MORE_CELLS_THAN_HEADERS`; fatal: `EMPTY_FILE`, `UNTERMINATED_QUOTE`, `TOO_MANY_ROWS`, `TOO_MANY_COLUMNS`, which answer 400 `INVALID_CSV` with the issue list). Limits are the existing upload limits (5000 rows, 200 columns, 5000 characters per cell). Columns whose name starts with `_` are ignored (they are the bookkeeping columns of the failed-rows download).

## 2. Validation reports and failed-import recovery (administrators)

All under `/admin/import/operations/`:

| Endpoint | Purpose |
|---|---|
| `GET batches/:id/report` | Row statuses, failures by rule / field / severity, and every failed row with its reasons (up to 1000) |
| `GET batches/:id/report.csv` | The same as a CSV, one line per issue |
| `GET batches/:id/failed.csv` | The failed rows as stored, plus `_row_number` and `_errors`. Correct the cells and upload the file again (the `_` columns are ignored) |
| `POST batches/:id/retry-failed` | Re-runs every failed row (up to 1000 per call). Rows that now pass are published; the rest stay failed with fresh reasons. Refused with 409 while the batch is being processed (a run that crashed more than 15 minutes ago can be taken over) |
| `PATCH records/:recordId {fields}` | Corrects fields of one **failed** row (an empty value removes the field) and re-runs it. Batch counters are recounted |

Re-running a row clears its earlier validation results first, so they are not counted twice. A row that now matches an existing company becomes `FLAGGED_DUPLICATE` and goes to the normal duplicate review; that is an outcome, not a failure. Reports include cell text (a validation message names the bad value), so they are administrator-only; the existing operations view still shows codes only. Corrections are audited with **field names only, never values**.

## 3. Export (all signed-in users)

| Endpoint | Purpose |
|---|---|
| `GET /exports/datasets` | `unlocked-leads`, `unlocked-people`, `saved-leads` |
| `POST /exports {dataset, format}` | `format` is `csv` or `xlsx`. The file is the response; headers `X-Export-Id`, `X-Export-Row-Count`, `X-Export-Truncated` |
| `GET /exports/history` | Your exports: when, what, rows, whether the file is still downloadable |

Every dataset is derived from the caller's own data, and contact details appear only for what they have unlocked (saved leads carry none). At most 5000 rows per export; a longer result is cut and flagged `truncated`. Exporting unlocked data costs no credits (as before). CSV cells go through the formula-injection guard (a leading `=`, `+`, `-`, `@` gets a `'` prefix); in `.xlsx` every value is a text cell, so nothing can run as a formula. The `.xlsx` writer has no external dependency and was checked with openpyxl.

## 4. Scheduled exports

`POST /exports/schedules {dataset, format, frequency: DAILY|WEEKLY|MONTHLY, hourUtc?}`, `GET /exports/schedules`, `PATCH /exports/schedules/:id {enabled?, format?, frequency?, hourUtc?}`, `DELETE /exports/schedules/:id`. At most 10 per user.

- A scheduler in the API process checks every minute (`DISABLE_EXPORT_SCHEDULER=true` turns it off). Each due schedule is **claimed** by moving its next run time, so several API instances still run it once. Missed runs are skipped, not replayed.
- The file of a scheduled export is stored in the database for **7 days** and fetched with `GET /exports/:id/download` (owner only; 410 afterwards). The history row stays, marked `EXPIRED`. The owner is e-mailed when it is ready.
- Three failed runs in a row switch the schedule off, record each failure, and e-mail the owner. Switching it back on resets the count.
- Times are UTC; a monthly schedule keeps its day of month clamped to the 28th.

## 5. Export audit logs

Every export writes an `audit_logs` entry and an `export_jobs` row: `EXPORT_CREATED`, `EXPORT_FAILED`, `EXPORT_DOWNLOADED`, `EXPORT_SCHEDULE_CREATED / UPDATED / DELETED / DISABLED`, each with user, dataset, format, rows, source, IP and user agent (never file content). The legacy people CSV download and the admin report / failed-rows downloads are audited the same way. Administrators read the trail with `GET /exports/admin/audit?userId=&action=&from=&to=&limit=&offset=`.

## 6. Limits

- Scheduled files are kept in the database (about the size of the file, at most a few MB each, for 7 days). Moving them to object storage is a later step if volumes grow.
- Not built: exports of the admin catalogue, XLSX *import* on the server (clients parse XLSX and send rows), per-account export quotas, delivery by e-mail attachment or webhook, a frontend for any of this.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) was not changed; paths it does not handle itself reach these endpoints through its proxy.



## Phase 15: provenance, source trust and explicit publication
- **Publishing is explicit.** An import stores and validates rows and queues the clean ones. They reach customers when an administrator calls `POST /admin/import/publish-batch/:batchId`, or automatically when the batch was submitted with `autoPublish: true` **and** a `sourceId` whose trust status is APPROVED.
- **Name the source.** Register it with `POST /admin/import/sources`, assess it with `PATCH /admin/import/sources/:id/trust` (reason required), and send its id as `sourceId` when submitting. A batch with no source is published only with `allowUnreviewedSource: true` on the publish call, which is audited as an override. A revoked source is never published.
- **What is published.** Values with a valid shape; a malformed e-mail, phone, GSTIN, PAN or CIN is left out, listed by field name in the business's internal quality notes, and the business is flagged for review. Nothing from the file can set status, verification, source or timestamps.
- **Duplicates and merges.** A flagged duplicate waits for a reviewer. A MERGE decision adds missing information to the existing business at publication, never overwrites published values, and records any disagreement. See `DATA_PROVENANCE.md`.
