# Manual acquisition (Phase 6.12)

Orion acquires People data **only** from manual uploads (CSV / JSON / XLSX rows parsed by the admin upload) through the existing path. No provider, API, scraper or enrichment exists, and no parallel ingestion path was added.

`upload → import pipeline (company import, independent) → ImportPeopleBridge → people_sources 'company-upload' → observation / idempotency → company (the uploaded company's id; a person can never create or redirect a company) → suppression → normalisation → classification (versioned) → contacts / evidence / provenance → conflict detection → quarantine → review → verification → publishing → customer (Phase 6.11 contract)`

## Guarantees (all tested end to end in `import-people.integration.spec.ts`)
* **Source identity.** Each person is one source record: `<batchId>|<filename>#row:<n>` (person 1) and `…:person-<2..5>`. Deterministic; long references are hashed. Up to five people per row (`contact_person`/`person_*` and `person_2_*`…`person_5_*`); anything beyond is ignored. Company-level `email`/`phone` are never attached to a person; a person is never fabricated from them or from a lone title.
* **Idempotency.** The same import record processed again changes nothing. Re-uploading an identical file is flagged a duplicate by the company pipeline, so the People layer sees nothing new. A later upload of the same data adds one observation (history) and provenance but no new person, role or contact; changed data adds observations and follows the existing semantics (changed title = new role, new e-mail = new contact, nothing overwritten). Earlier observations are never touched.
* **Traceability.** Invalid, missing-title, suppressed and ambiguous records each leave a quarantine row **and** a `QUARANTINED` observation with reason codes; the batch report carries counts and codes only, never names or contact values. Contacts shared by two people are held back and recorded as a conflict (no winner).
* **DRAFT only.** An upload cannot verify or publish: people/roles/contacts stay `DRAFT`/`PENDING`/unpublished/`UNVERIFIED`, even if a row carries columns such as `verification_status`, `is_verified`, `publish` (they are never read). Review approval publishes the role only; verification is a separate reviewer decision; contacts are published and unlocked separately. Customers see only the Phase 6.11 card.
* **Failure isolation.** A People failure never rolls back the company import; one bad person or row never stops the others; batch counters keep their meaning.

## Input validation (new, before anything is stored or processed)
`assertUploadRows` (`import/services/upload-validation.ts`) runs on preview and submit. It rejects with 400 and **row numbers + problem codes only** (never content): rows must be a non-empty array of plain objects (≤ 5 000 rows); ≤ 200 columns per row; column names ≤ 200 characters and never `__proto__` / `constructor` / `prototype`; cells must be strings, numbers, booleans or empty (no nested objects/arrays), ≤ 5 000 characters, no control characters (tab / line breaks allowed); total ≤ 10 million characters (`UPLOAD_TOO_LARGE`). A refused upload creates no batch and no records. Oversized or odd *person* fields that pass these limits are isolated by ingestion (quarantine), not by failing the batch.

## Findings and limits
* The `company-upload` source keeps the legacy permissive policy (migration 0009); safety comes from the bridge, which builds only identity/title/contact/LinkedIn fields and never a `verification` block. Tightening the stored policy would need a data migration and was not done.
* The bridge records the batch's linked data-source type as evidence provenance (existing behaviour); it is internal and never shown to customers.
* The Nest JSON body limit is the Express default (100 kB); very large uploads need a deliberately raised, route-scoped limit at deployment. Not changed here.
* Same-source disagreements are not conflicts by design (conflict detection compares different sources); all uploads share one source key.
