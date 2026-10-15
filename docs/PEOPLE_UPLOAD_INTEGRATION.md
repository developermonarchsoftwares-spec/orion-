# Company Upload → People Ingestion (Phase 3)

Connects the existing company upload/import pipeline to the Phase 2 People ingestion layer. The
People layer stays independent and independently testable; the upload pipeline stays the source of
truth for companies and is not made to depend on it.

Government portal API integration is **not** part of Orion's architecture and nothing here adds it.
Uploaded rows are manual data; the People stage only reads them.

## Where it plugs in

```
admin upload ─▶ AdminImportService.submitBatch ─▶ ImportPipelineService.processBatch
   per record: normalise ─▶ validate ─▶ duplicate check ─▶ (clean) PublishingService.publishRecord
                                                              │
        1. BusinessService.createBusinessAggregate   ← its own transaction, COMMITTED here
        2. publish_queue = PUBLISHED, import_record = PUBLISHED
        3. search-index job enqueued
        4. ImportPeopleBridge.ingestForPublishedRecord(...)   ← NEW, best-effort, never throws
                 │  PEOPLE_INGESTION_SERVICE.ingest(records, { batchRef, sourceLabel })
                 ▼
           PeopleIngestionService (Phase 2, unchanged): normalise · classify · resolve company ·
           dedupe · contacts · evidence · quarantine · no-downgrade  ─▶ DRAFT
```

Only rows that actually create a business reach step 4. Rows flagged as duplicates go to manual
review as before and do not feed people (see Limitations).

## Files

| File | Change |
|---|---|
| `import/people/import-people.bridge.ts` | **New.** Extracts people from the raw row and calls the People service; records the outcome. |
| `import/people/import-people.types.ts` | **New.** Report shapes. |
| `import/services/publishing.service.ts` | +1 optional constructor dependency, +1 call after the business is committed. |
| `import/repositories/import.repositories.ts` | +2 small methods that write the report. |
| `import/services/import-pipeline.service.ts` | `processBatch` also returns the batch's people summary. |
| `import/services/admin-import.service.ts` | `submitBatch` response includes `people`. |
| `import/import.module.ts` | imports `PeopleModule`, provides the bridge. |
| `database/schema/imports.ts` + migration `0006` | two nullable JSON report columns. |

The normaliser, validator, duplicate detection, review, publishing logic, transaction handling and
the admin controller are unchanged.

## What is read from a row

People are read from the **raw uploaded row**, never from the normalised record: the normaliser
fabricates a placeholder contact (`Primary Contact`, title `Director/Owner`) whenever a row has only
an email/phone, and that must not become a person.

| Column(s) | Meaning |
|---|---|
| `contact_person` (or `director_name`) + `contact_title` (or `title`, `designation`) | person 1 |
| `person_email`, `person_phone`, `person_mobile`, `person_linkedin` | person 1's own contact details |
| `person_<n>_name`, `_title`, `_email`, `_phone`, `_mobile`, `_linkedin` (n = 2..5) | additional people |

* The row-level `email` / `phone` are **company** contact details and are never attached to a person
  (that would be a guess). Person contact data must be supplied in the `person_*` columns.
* A missing title is not defaulted: the entry is rejected (`MISSING_TITLE`) and quarantined.
* Classification (seniority, department, decision-maker type) comes only from the shared
  `classifyRole()`, never from the upload.
* Up to five people per row.

Provenance passed through: source type = the batch's linked data source type if there is one, else
`MANUAL_IMPORT`; source label `import-batch:<batchId>`; reference `<filename>#row:<n>[:person-<k>]`;
evidence type `UPLOAD_ROW`; observed time = when the row was received (`import_records.created_at`).
Nothing is marked verified.

## Transaction behaviour

* The business is created inside `TransactionService.runInTransaction` and committed before the
  People stage starts. The People stage runs in **separate** transactions (one per person, inside
  `PeopleWriteService`). Nothing wraps the two together, so a People failure cannot roll back or
  taint a company. No transaction architecture was changed.
* `import_records` is already `PUBLISHED` and the publish-queue item already `PUBLISHED` when
  People ingestion begins.

## Failure isolation

`ImportPeopleBridge` catches everything, including failure to read its own inputs and failure to
write its own report. Outcomes:

| People outcome | Company | Recorded as |
|---|---|---|
| All accepted | imported | `created` / `updated` / `unchanged` |
| Some invalid | imported | `rejected` (+ quarantine rows) |
| Ambiguous / suppressed / company not found | imported | `quarantined` |
| Some people fail while others succeed | imported | mix of the above |
| People service throws / tables unavailable | imported | `errors` = number of entries, `people_result.error` |

Verified by tests, including a database with no People tables and a People service that always throws.

Operational controls: `PEOPLE_UPLOAD_INGESTION=false` disables the stage entirely (kill switch, no redeploy of code).
If `PeopleModule` is not wired in, the bridge is absent (`@Optional`) and the import behaves exactly as before.

## Reporting (extends the existing structures)

* `import_batches.people_summary` (jsonb): running totals for the batch, updated with one atomic
  SQL statement per record.
* `import_records.people_result` (jsonb): the row's counts plus per-person outcome codes. It
  contains no names, emails or phone numbers.
* `submitBatch` returns `people: { received, accepted, created, updated, unchanged, quarantined, rejected, errors }`;
  `getBatches` returns `peopleSummary` on each batch.

Invariants: `received = accepted + rejected + quarantined + errors`, `accepted = created + updated + unchanged`.
`rejected` = the person data is invalid; `quarantined` = held for identity/company reasons. Both also have a row in
`people_ingestion_quarantine` (with `batch_ref = import-batch:<id>`) for a reviewer. The summary is cumulative per
attempt: re-processing a record adds another attempt's counts.

## Idempotency

* Re-processing the same record (e.g. a retried job) adds no people, roles, contacts, evidence or
  quarantine rows: `unchanged`. A *different* upload row for the same person adds one more evidence
  row (extra provenance) and reports `updated`.
* Uploading the identical file again: the pipeline flags the company as a duplicate, publishes
  nothing, and the People layer sees nothing.
* Covered: three consecutive re-runs with exact table-count equality.

## Visibility and no-downgrade

Everything ingested from an upload is DRAFT: person `DRAFT`, role `is_published = false`, contacts
`is_published = false`. The bridge has no publishing capability (a test asserts it never references
publishing or business creation). A person who is already published and appears in a new upload under
another company gets a new **unpublished** role there. A weaker upload never lowers an existing
verification status, confidence or verification date (Phase 2 rules, exercised through the upload path).

## Deployment

1. Run migration `0006_import_people_report` (and `0004`, `0005` if not yet applied) **before** deploying the API:
   the import repositories now read the two new columns. Not run against any shared database by this change.
2. Optionally set `PEOPLE_UPLOAD_INGESTION=false` to deploy the code with the stage switched off.

## Limitations

* Duplicate-flagged rows do not feed people. When a reviewer resolves a duplicate, `publishRecord`
  currently creates a new business regardless of `MERGE` (existing behaviour), so a MERGE target
  is never a place people are attached to. Ingesting people into a reviewer-confirmed `targetBusinessId` is a
  natural follow-up once MERGE publishing exists.
* `publishBatch` in `AdminImportService` passes a record id to `publishRecord` where a queue id is
  expected (existing behaviour, untouched); it would also carry the People stage if it worked.
* People columns must be present in the file. Existing company files with only `contact_person` +
  `contact_title` produce a person with no contact details.
* At most five people per row; the template lists people 1-3 (see `docs/ORION_IMPORT_TEMPLATE.csv`), people 4 and 5 follow the same `person_<n>_*` pattern.

## Fallback (degraded-mode) importer

The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) forwards admin import preview/submit to Nest when
`BACKEND_API_URL` is remote. Only when Nest is local/unreachable does it run its own direct-SQL importer. That importer is
a **company-only degraded mode**; it is not duplicated into a second People pipeline.

Guarantees (tested in `ownus/src/lib/__tests__/import-people-columns.test.ts`):

* `person_*` / `person_<2-5>_*` columns are recognised by the same contract as the primary importer
  (`ownus/src/lib/import-people-columns.ts` mirrors `PEOPLE_TEMPLATE_COLUMNS`) and are **never** mapped to company fields.
  Before this fix a substring header match turned `person_email` / `person_phone` into the company `email` / `phone`, and
  the "any value that looks like an email" scan could pick a person's email as the company email. Both are closed.
* The fallback never writes People tables, never creates a person, never converts company email/phone into a person
  contact, never bypasses validation, quarantine or review.
* The response carries `peopleColumns: { processed: false, mode: 'FALLBACK', rowsWithPeopleData, notice }` so the operator is
  told plainly that people columns were not processed and the file should be re-uploaded when the API is available.
* Like the primary path, the legacy company contact card (`business_contacts`) is company-level data and is not a person.

Primary path: people columns -> `extractPeopleFromRow` -> `PeopleIngestionService` (DRAFT, PENDING review, evidence).
