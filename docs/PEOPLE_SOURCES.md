# People sources (Phase 6.1): source registry + source contract

Phase 6.1 is the foundation every future acquisition source must use. It adds **no acquisition**: no scraper, no external provider, no enrichment.

```
SOURCE REGISTRY (describes the source)
        |
SOURCE ADAPTER (supplies records)      <- cannot write People data, holds no DB access
        |
IRawPersonRecord                        <- the existing canonical raw shape
        |
PeopleIngestionService                  <- the ONLY canonical writer
        |
existing People pipeline (normalise -> resolve -> classify -> evidence -> attestation -> review -> verification -> approval -> publishing)
```

## 1. Roles, stated plainly

| Layer | Responsibility |
| --- | --- |
| **Source** | provides observations / data. Nothing else. |
| **Ingestion** | normalises, resolves the company and the person, classifies the role. |
| **Evidence** | records provenance (what, where from, when). |
| **System attestation** | relays a source's verification claim as a SYSTEM event, **only when the source's policy allows it** and only up to its maximum level. Never human verification. |
| **Review** | the human workflow (edit, approve, reject, quarantine, suppress). |
| **Verification** | the evidence-backed decision (reviewer, or SYSTEM attestation), field by field. |
| **Publishing** | customer visibility. |

A source never sets `verification_status`, `review_status` or `is_published`, and nothing it sends can.

## 2. The source registry (`people_sources`, migration `0009_people_sources`)

| Column | Meaning |
| --- | --- |
| `key` (unique, stable) | lower-case identifier `^[a-z0-9][a-z0-9._-]{1,58}$`; never renamed or reused |
| `display_name` | human name (used as the default source label) |
| `source_type` | the **existing** data-source categories: GOVERNMENT_REGISTRY, WEB_SCRAPING, MANUAL_IMPORT, API_INTEGRATION, USER_SUBMISSION, PARTNER_FEED. No new taxonomy |
| `version` | registry version, recorded on each ingestion report |
| `enabled` | a source is usable only when enabled **and** its terms are acknowledged (DB check: enabled => terms acknowledged) |
| `terms_reference`, `terms_acknowledged_at` | licence / terms acknowledgement; NULL = not acknowledged |
| `cost_class` | NONE / LOW / MEDIUM / HIGH (informational now; for later cost control) |
| `freshness_ttl_days` | how long an observation from this source stays fresh (informational now) |
| `max_attestation` | NONE / PARTIAL / FULL: the most the source may attest |
| `allowed_evidence_types` | evidence types the source may emit; NULL = unrestricted, **allowed only for MANUAL_IMPORT / USER_SUBMISSION** (DB check) |
| `policy` (jsonb) | `{ permissions: {...}, enforceSourceType }` |
| `created_at`, `updated_at` | timestamps |

**No secrets.** The table has no credential columns, and the service refuses any key or value that looks like a credential (`apiKey`, `secret`, `token`, `password`, `Bearer ...`, `sk-...`, JWT-shaped strings) in the name, terms reference or policy. API keys belong in the adapter's runtime environment and never in rows, evidence, audit entries or logs.

`SourceRegistryService` (internal; no HTTP surface in 6.1): `get`, `list`, `register` (deny by default; duplicate key => `SOURCE_EXISTS`), `acknowledgeTerms`, `setEnabled`, `assertUsable` (registered, terms acknowledged, enabled).

## 3. Source policy

Explicit and deny-by-default. `permissions`: `identity`, `title`, `email`, `phone` (phone and mobile), `linkedin`, `evidence` (url / reference / evidence type / observed date), `attestation`. Anything not `true` is not permitted; a stored policy that is malformed grants nothing.

Applied to every record of a **keyed** source before normalisation (`applySourcePolicy`, pure):

| Situation | Result |
| --- | --- |
| a forbidden field (`isPublished`, `reviewStatus`, `verificationStatus`, `dataStatus`, `reviewedBy`, `classificationSource`, ... in any spelling, also nested in `source` / `verification`) | **violation**: the whole record is quarantined (`SOURCE_FORBIDDEN_FIELD`); nothing is written |
| person name / job title not permitted | violation (`SOURCE_NOT_PERMITTED`) |
| email / phone / mobile / LinkedIn not permitted | field dropped + warning |
| evidence details not permitted | dropped + warning |
| evidence type not in `allowed_evidence_types` (the default `ROLE_CLAIM` is checked too) | violation (`SOURCE_EVIDENCE_TYPE_NOT_ALLOWED`) |
| `enforceSourceType` | the registered type replaces the claimed one (`SOURCE_TYPE_OVERRIDDEN`): a source cannot pose as a registry |
| `verification` claim above `max_attestation` | **capped down**, never up (`SOURCE_ATTESTATION_CAPPED`): FULL relays VERIFIED; PARTIAL turns VERIFIED into PARTIALLY_VERIFIED; NONE (or no attestation permission) drops it |

Whatever survives then goes through the unchanged pipeline. Even a fully permitted source only ever produces DRAFT / PENDING data; an attestation is a SYSTEM ledger event with `attested_by` = the source type, never a reviewer.

## 4. Adapter contract (`modules/people/sources/source.types.ts`)

There is one source abstraction, the existing `IPeopleSource`, extended minimally:

* `IPeopleSource.sourceKey?` / `sourceVersion?`: a source that declares a key is resolved against the registry and constrained by policy on every run. A source without a key behaves exactly as before.
* `IPeopleSourceAdapter extends IPeopleSource` with a **required** `sourceKey`, and an optional `fetch(cursor?) => ISourceBatch` (declared for later phases; ingestion does not consume it yet).
* `ISourceRecord { sourceRecordId?, observedAt?, payload?, mapped: IRawPersonRecord }` and `ISourceBatch { acquiredAt, records, cursor? }`: **types only**. Observation storage arrived in Phase 6.2 (`PEOPLE_OBSERVATIONS.md`): records carry `source.recordId` and are observed per source record.
* `IIngestionOptions.sourceKey` lets a caller that does not use `ingestFromSource` (the upload bridge) identify its registered source. `IIngestionReport.source` = `{ key, version }` for keyed runs.

An adapter has no database, no People service and no publication capability by construction: it can only **return records**. If the source is unregistered, disabled or has unacknowledged terms, the **whole run is refused** (`SOURCE_NOT_REGISTERED`, `SOURCE_DISABLED`, `SOURCE_TERMS_NOT_ACKNOWLEDGED`); nothing is written or quarantined. If the registry is unavailable a keyed run is refused, never silently unenforced.

### Allowed / forbidden

| Allowed | Forbidden |
| --- | --- |
| return `IRawPersonRecord`s with provenance | write people, company_people, person_contacts, evidence, the ledger |
| claim verification within its registered maximum | set verification, review or publication state (in any field spelling) |
| do its own I/O outside ingestion | call the DB / People services (structural test), hold or store credentials |
| be disabled, re-versioned, re-policied by registry data | widen its own policy or type at runtime |

## 5. Registered sources (seeded by migration 0009; deterministic, idempotent)

Only sources that already exist in the codebase; **no external provider is registered**.

| Key | Name | Type | Used by |
| --- | --- | --- | --- |
| `people-csv` | People CSV import | MANUAL_IMPORT | `CsvPeopleSource` |
| `people-json` | People JSON ingestion | MANUAL_IMPORT | `JsonPeopleSource` |
| `company-upload` | Company upload (People bridge) | MANUAL_IMPORT | `ImportPeopleBridge` (`UPLOAD_SOURCE_KEY`) |

All three carry **today's behaviour as policy**: every permission granted, unrestricted evidence types, source type not overridden, attestation up to FULL, enabled, terms "internal: built-in source". Ids and timestamps are fixed, the insert is `ON CONFLICT (key) DO NOTHING`, and a test runs the migration twice and compares the rows and the code-side list. Customer-visible source terminology (`sourceType` categories) is unchanged.

## 6. Relationship to the rest of People

* **Ingestion**: `ingestFromSource` passes the source's key; `ingest(records, { sourceKey })` does the same for other callers. Normalisation, deduplication, quarantine, evidence, review, verification and publishing are unchanged (the full pre-existing suite passes unmodified apart from wiring the registry into tests).
* **Evidence**: policy runs first, so evidence is recorded with the policy-adjusted provenance (for example, the enforced source type).
* **System attestation**: a source may only ever cause a SYSTEM ledger event, only when its policy permits attestation, and never above `max_attestation`.
* **Quarantine**: policy violations are quarantined like any other rejected record (internal only). A keyed run also labels quarantine rows with the source's display name.

## 7. Out of scope (later Phase 6 sub-phases)

The suppression registry (the shared company resolver is done: see `PEOPLE_COMPANY_RESOLUTION.md`), classification versioning, contact provenance, freshness, conflict detection, queue orchestration, cost control, and any real acquisition source or provider.
