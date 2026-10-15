# People observations (Phase 6.2): observation log + source-record idempotency

Phase 6.2 adds an **append-only history of what registered sources handed Orion**, and gives a source record a stable identity so the same record is never ingested twice. It adds no acquisition, resolver, conflict logic, freshness engine or UI.

```
SOURCE (registered, Phase 6.1)
   |  source record (source.recordId)
   v
PeopleIngestionService --- measure / validate / policy ---> OBSERVATION  (one row per handover, never edited)
   |                                                            |  evidence_id
   v                                                            v
PeopleWriteService  (person, role, contacts, evidence, attestation)  <-- people_evidence stays the single evidence system
```

## 1. Observation vs evidence

| | Observation (`people_observations`) | Evidence (`people_evidence`) |
| --- | --- | --- |
| Question | *When, from which source record, in which run did Orion receive this, and what came of it?* | *What supports this fact, and how strongly?* |
| Shape | append-only **history**; one row per handover (record x content x run) | **deduplicated** by fingerprint (target, source type, evidence type, locator) |
| Repeats | a new acquisition adds a row | a repeat re-confirms the same row |
| Customers | never | only coarse, existing fields (unchanged) |

Relationship: `observation -> evidence` (many observations may point at one evidence row through `evidence_id`, the role-scoped evidence the record produced or re-confirmed). Evidence is **not** duplicated by repeated observation, and the evidence table is unchanged.

## 2. The four timestamps (plus one)

| Timestamp | Meaning | Where |
| --- | --- | --- |
| **acquired_at** | when Orion obtained the record (start of the ingestion run unless the caller says otherwise) | `people_observations.acquired_at` |
| **observed_at** | when the **source** says the information was true / current. `NULL` when the source did not say: it is never defaulted to "now" or to `acquired_at`, and a date in the future is not believed | `people_observations.observed_at`; also the existing `people_evidence.observed_at` (source-reported, advanced to the latest) |
| **verified_at** | when a verification decision was made (reviewer, or a capped SYSTEM attestation) | `people_verifications.verified_at`, `people_evidence.verified_at` |
| **updated_at** | when Orion's own record changed | `updated_at` on the People tables |
| (created_at) | when the observation row itself was written; rows are immutable, so it is also its last change | `people_observations.created_at` |

`people.last_seen_at` / `company_people.last_seen_at` are unchanged in 6.2; splitting "we saw it again" from "the source confirms it is still current" is the later freshness phase.

## 3. Source-record identity and idempotency

* Identity of a source record = **(`source_key`, `source_record_id`)**. The key is the registered source (Phase 6.1); the record id is the source's own identifier, supplied as `source.recordId` (≤ 200 printable characters; CSV column `source_record_id`).
* **Orion never invents record ids.** A record without an id is still ingested (as before) but is **not observed**, and says so: `observation: { status: 'NOT_RECORDED', reason: 'NO_SOURCE_RECORD_ID' }`. Unkeyed legacy callers get `reason: 'UNKEYED_SOURCE'`. The upload bridge derives an id only from stable parts (`<import batch id>|<file#row:n[:person-k]>`), so re-processing the same import record is recognised while a new upload is a new source record.
* One observation is unique per **(source_key, source_record_id, content_fingerprint, batch_ref, outcome)**:

| Case | Behaviour |
| --- | --- |
| **A** same record, same content, **same run** | recognised (`DUPLICATE`); nothing written: no observation, person, role, contact or evidence |
| **B** same record, same content, **new run / acquisition** | a new observation is kept (it records another confirmation, with its own `acquired_at`); People data and evidence are **not** duplicated |
| **C** same record, **changed** content (e.g. title) | a new observation is kept; the existing People rules decide what happens (a new title is a second role awaiting its own review). No winner is chosen here |
| **D** different source, same fact | separate observations (separate provenance); evidence deduplicates where type and locator match |
| **E** different source, different title | both observations kept; both roles PENDING; nothing decided, published or verified |

`content_fingerprint` = sha256 of the canonical, policy-adjusted record **excluding** the source-reported observed date: re-seeing the same content later gives the same fingerprint, changing any claimed value gives a different one. The fingerprint is a one-way hash, so the observation holds no readable copy of the record.

## 4. History and what an observation stores

Kept: source key and **source version at that time**, record id, run id (`batch_ref`), acquired / observed times, content fingerprint, outcome (`INGESTED` or `QUARANTINED`), the role-level facts the source stated (`observed_name`, `observed_title`, `observed_is_current`), links to the person / role / business / evidence it produced, `payload_bytes`, optional `payload_ref`, and, for quarantined records, machine **reason codes only**.

Not kept: contact data (email, phone, mobile, LinkedIn), the raw payload, credentials. The record itself lives in the People tables (or in quarantine when refused).

**Source versions.** `source_version` is a snapshot of the registry version when the record was observed; changing the registry version later never rewrites earlier rows (tested).

**Run id.** The existing `batchRef` is the run / acquisition identifier (the upload bridge uses `import-batch:<batch id>`); there is no job system.

## 5. Transactions and failure behaviour

* An `INGESTED` observation is written **inside the same transaction** as the person / role / contacts / evidence (`PeopleWriteService`). Either all of it commits or none: there is no person write without its observation, and no observation for a write that rolled back.
* A record the People layer refuses (invalid, ambiguous identity, unknown company, policy violation) is quarantined **and** recorded as a `QUARANTINED` observation, so the source record stays traceable even though no person exists. A repeated identical refusal in the same run adds nothing; if the record is later fixed and ingested in the same run, both facts are kept.
* Recording a quarantined observation can never mask the quarantine itself (a failure there is logged).
* Company-import failure isolation is unchanged: a People failure (including a disabled upload source) never fails the company import.
* Reviewer **retry** of a quarantined record re-ingests the corrected record through the legacy unkeyed path: it is a human-edited record under reviewer audit, while the source's original refusal stays as the `QUARANTINED` observation. Linking the two is a later phase.

## 6. Payload limits and safety (technical safety boundaries)

For **keyed** sources (legacy unkeyed callers keep their behaviour):

* one mapped record ≤ **16 KiB** serialised; ≤ **10,000 records** per run (whole run refused with `BATCH_TOO_LARGE`);
* plain JSON-like values only: depth ≤ 8, ≤ 100 keys per object, ≤ 100 items per list; functions, symbols, bigint, non-plain objects, cycles, invalid dates and NUL characters are refused (`MALFORMED_RECORD` / `RECORD_TOO_LARGE`) and quarantined without crashing the run; nothing is ever evaluated;
* `source.recordId` and `source.payloadRef` must be printable, bounded and whitespace-free (payloadRef); provenance fields (`url`, `reference`, `label`, ids) are refused if they carry credentials (API keys in URL queries, URL userinfo, bearer / `sk-` / JWT-shaped values).

For **all** callers: a quarantined record that is oversized or unserialisable is stored as a small **stub** (size + hash), and a cyclic record can no longer throw out of the quarantine step. (Previously quarantine stored any raw record unbounded.)

Observations are never returned to customers and no controller reads them (structural tests). Raw payloads are never rendered. Two internal readers exist: the reviewer dossier (read-only import provenance of a role, and the per-contact attribution status) and `people-contact-attribution.ts`, which customer cards, unlock and discover use to ask a yes / no question ("may this contact be shown for this company?") and which returns no observation data.

## 7. Privacy and retention assumptions

* Duplication of personal data is minimised: contacts and raw payloads are not copied; the name and title are already role-level data held in the People tables.
* `payload_ref` is a pointer to where an adapter keeps the full payload, if it keeps one; **that store, its encryption and its retention are the adapter owner's responsibility and are not part of Orion's database in this phase**. No encryption infrastructure was added.
* Observations follow the person: deleting a person cascades to their observations (takedown leaves no history behind). Retention pruning of old observations is permitted by the schema (deletes are allowed; updates are not) but no retention job exists yet. Because every new acquisition adds a small row, retention policy needs a decision before high-volume sources are connected. That decision must also account for contact attribution: customer cards, discover and the reviewer dossier read which company reported a contact from these rows and their claims, so pruning them turns attributed contacts into unattributed ones (hidden for a multi-company person).
* A source cannot be deleted while observations reference it (`ON DELETE RESTRICT`); disable it instead.

## 8. Append-only guarantee

A trigger rejects any `UPDATE` of an observation, except the database nulling `evidence_id` / `business_id` when the referenced row is deleted. Application code only inserts (a structural test forbids updates and limits writers to the People write service and the observation service).

## 9. Legacy and unkeyed sources

Unkeyed ingestion (`ingest(records)` without a source key) works exactly as before, records no observation, and is marked `NOT_RECORDED / UNKEYED_SOURCE` on each record result. The built-in `people-csv`, `people-json` and `company-upload` sources are keyed; they are observed only for records that carry a `source.recordId` (the upload bridge always supplies one; CSV/JSON rows opt in with `source_record_id` / `source.recordId`).

## 10. Migration `0010_people_observations`

Additive and idempotent: one table (3 checks, 5 foreign keys, 1 unique and 4 lookup indexes), one trigger function and trigger. No backfill (earlier ingestions had no source record ids, and none are invented). Validated on disposable PGlite: clean database through 0010; 0009 database with existing people -> 0010 with everything untouched; second run changes nothing; SQL re-executes safely. Not applied to Neon. Deploy 0004-0010 before the API.

## 11. Not in this phase

Company resolver, suppression registry, classification versioning, contact provenance, freshness engine, conflict detection, orchestration / scheduling, retention job, reviewer UI for observations, any real acquisition source.
