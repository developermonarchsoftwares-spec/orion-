# Upload operations (Phase 6.13)

Admin-only view over the existing manual upload pipeline. No provider, no parallel ingestion, no new queue, no migration.

## API (SUPER_ADMIN, ADMIN only; customers 403, anonymous 401, data managers 403)
* `GET /admin/import/operations/batches`: newest first (ties by id), page/limit (≤100). Filters: `status`, `from`/`to` (created), `q` (file name, literal), `sourceId`, `hasIssues`. Each batch: status, outcome (`COMPLETED`, `COMPLETED_WITH_ISSUES`, `FAILED`, `IN_PROGRESS`), created / started / completed times, source (name + type; configuration is never selected), file size, `rows` (total, processed, **accepted**, **rejected**, **duplicate**, per-status breakdown) and `people` (received, **created**, **updated**, **skipped** = already known, accepted, **quarantined**, **rejected**, **errors**).
* `GET /admin/import/operations/batches/:id`: reason-code totals (People outcome codes; failed validation rule / field / severity) and row-level outcomes (row number, company name, status, duplicate flag, publish state, validation failures, per-person outcome + codes), paginated and filterable by row status.
* `POST /admin/import/operations/batches/:id/reprocess-people`: see below.

Never returned: raw or normalised payloads, person names, contacts, LinkedIn, mapping / options, file key, source configuration, error text, creator id.

## Safe reprocessing
Only the People stage of already **published** company rows whose People result is missing or errored (ingestion failed as a whole). It calls the existing bridge and ingestion, so observation / writer idempotency makes a repeat a no-op; at most 500 rows per call (`moreRemaining` says so). Rejected and quarantined people are decisions and are never retried here (People Review / quarantine workflows); failed company rows use the existing publish-batch action. After a run the batch's People summary is recomputed as the sum of its rows (no double counting), and the action is audited (`IMPORT_PEOPLE_REPROCESSED`, counts only).

## Upload body limit
`applyUploadBodyLimit` (called from `main.ts`) gives only `POST …/admin/import/submit` and `…/preview` a 20 MB JSON limit, sized for the documented maximum (5 000 rows, 10 million characters of cell and column text). Every other route keeps the default 100 kB; the global limit is unchanged. The large limit is offered only to requests carrying a Bearer token (the body is read before the guard runs). Over the limit → 413 `PAYLOAD_TOO_LARGE`; the global filter now maps body-parser client errors (413 / malformed JSON) to their 4xx status instead of 500.

## UI
Admin sidebar → **Upload Operations**: filters (status, outcome, file name, dates), batch table with counts, drawer with reason codes, row outcomes and the reprocess action.

## Non-goals
Provider integration, a second ingestion path or queue, editing or deleting batches, retrying rejected / quarantined people, exposing row payloads.
