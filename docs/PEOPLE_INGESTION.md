# People Ingestion & Enrichment (Phase 2)

An **independent, internal, source-agnostic** backend capability that turns raw person information
about an *existing* Orion company into structured decision-maker records for the People layer
described in `DECISION_MAKER_INTELLIGENCE.md`.

Scope boundaries:

* It does **not** touch the company upload/import pipeline, CSV company ingestion, company
  deduplication/normalisation, or the government data acquisition process.
* It has **no HTTP endpoint** and is not customer-facing. Callers are services (tests today; the
  upload pipeline and enrichment providers later).
* **Government-portal API integration is not part of Orion's architecture** and is not built here.
  There are no MCA, Udyam, Startup India, FSSAI (or similar) clients. Government/registry data
  reaches Orion through the existing manual upload flow; a person record may *cite* such a source
  (`GOVERNMENT_REGISTRY` is just a provenance label) but nothing here fetches from one.
* Everything ingested is **DRAFT and invisible to customers** until a reviewer publishes it.

## 1. Architecture

```
PeopleSource (CSV · JSON · admin entry · provider result · future upload pipeline)
      │  IRawPersonRecord
      ▼
PeopleIngestionService                         modules/people/ingestion/
  1. normalizeRawPerson()   validate + normalise (pure)      ─── reject ──▶ people_ingestion_quarantine
  2. resolve company        EXISTING businesses only          ─── reject ──▶ quarantine
  3. PeopleWriteService.upsertPersonForBusiness()
       a. classifyRole()            (the one shared role taxonomy)
       b. identity resolution       (deterministic, conservative)  ─ ambiguous/suppressed ─▶ quarantine
       c. person + company_people   (no-downgrade merge)
       d. person_contacts           (deduped, unpublished)
       e. people_evidence           (fingerprinted, idempotent)
       f. verification rules        (existing policy)
      ▼
people · company_people · person_contacts · people_evidence     (all DRAFT)
      │
      ▼  human review (future)      PeoplePublishingService.publishRole / publishContact
customer-facing People layer (unchanged from Phase 1)
```

Nothing new duplicates Phase 1: same tables, same `classifyRole`, same verification policy
(`effectiveVerification`), same publishing flags, same unlock/credit code.

## 2. Input contract

`IRawPersonRecord` (`ingestion/ingestion.types.ts`). Everything is optional at the type level;
the normalizer decides what is usable.

```ts
{
  // company association: one of these is required, resolved against existing businesses
  businessId | businessSlug | businessIdentifier: { type: 'CIN'|'GSTIN'|'PAN'|..., value },

  personName, jobTitle,
  department?, seniority?, decisionMakerType?,      // hints only, see §4
  email?, phone?, mobile?, linkedinUrl?,
  location? | city?, state?, country?,
  isCurrent?, startDate?, endDate?,
  confidenceScore?,                                  // only if the source truly provides one

  source: { type, label?, url?, reference?, evidenceType?, observedAt? },   // provenance is mandatory
  verification?: { status, verifiedAt, verifiedBy }                          // only if it really happened
}
```

Entry points (`IPeopleIngestionService`, DI token `PEOPLE_INGESTION_SERVICE`):

```ts
ingest(records, { batchRef?, sourceLabel?, dryRun? }) → IIngestionReport
ingestFromSource(source: IPeopleSource, options?)      → IIngestionReport
```

The report has counts (`created`, `updated`, `unchanged`, `quarantined`, and `valid` for dry runs)
and a per-record result (`outcome`, `personId`, `companyPersonId`, `reasons`, `warnings`).

Sources: implement `IPeopleSource { name; records() }`. Provided: `JsonPeopleSource`,
`CsvPeopleSource` (RFC 4180 parser, aliased headers such as `company_slug`, `full_name`,
`designation`, `work_email`, `mobile`, `linkedin_url`, `source_type`, `verified_by`, `cin`...).
Adding an enrichment provider means writing a source that maps its output to `IRawPersonRecord`;
nothing in the People domain changes.

## 3. Normalisation (`person-record.normalizer.ts`, `people.utils.ts`)

| Field | Rules |
|---|---|
| Name | Honorifics stripped (`Mr.`, `Dr.`, `Shri`...), spaced-dash/comma suffix split off (`Mr. Arun Kumar - CEO` → name `Arun Kumar`, title `CEO`; `, CA` qualifications dropped), all-caps/all-lower fixed to Title Case. Needs ≥ 2 name tokens; digits/emails/URLs/placeholders rejected. Dedupe key = lower-cased, punctuation-free. |
| Title | Required. Placeholders (`n/a`, `tbd`...) rejected. First-seen wording is kept; `normalizedJobTitle` is the role key. |
| Phone | `parsePhone`: E.164 output. Accepts `+`/`00` international (8–15 digits), Indian 10-digit (starts 2–9), `0`+10, `91`+10, strips extensions. `+91` must have 10 national digits. Rejects placeholders (`0000000000`, `1234567890`), letters, and bare numbers it cannot place (`14155552671` without `+`): ambiguous is rejected, never guessed. |
| Email | Trim, lower-case, strict validation (no `..`, valid domain/TLD, length limits). Shared mailboxes (`info@`, `sales@`, `hr@`...) are dropped: they identify a team, not a person. |
| LinkedIn | Personal `/in/` profiles only, canonicalised to `https://www.linkedin.com/in/<slug>`. Company pages/malformed URLs dropped with a warning. |
| Location | `city/state/country` or `"City, State[, Country]"`. Nothing is inferred. |
| Dates | Valid dates only; `end < start`, start > 1 year ahead, or `isCurrent: true` with a past end date are rejected. A past `endDate` alone marks the role former. |
| Source | `source.type` required and validated; `source.url` must be http(s); `observedAt` valid and not in the future. `observedAt` is **not** defaulted (so re-runs are detectable as unchanged). |

Invalid **contacts** (bad phone/email/LinkedIn) are dropped with a warning and the person is still
ingested. Invalid **identity, company association, provenance or role combinations** quarantine the whole record.

## 4. Role classification

Uses the existing `classifyRole()` and taxonomy (`classification/role-taxonomy.config.ts`) —
there is no second classifier. It yields seniority, department and decision-maker type.
Caller hints (`department`, `seniority`, `decisionMakerType`) are only validated: unknown values or
impossible combinations (e.g. a `STAFF` who is a `FOUNDER_CEO`, or `SALES_DECISION_MAKER` in `FINANCE`)
are rejected; hints that merely disagree with the classifier produce a `HINT_CONFLICT_*` warning and the
classifier wins. Titles the classifier cannot place are stored with `UNKNOWN` seniority/department and no
decision-maker type, plus an `UNCLASSIFIED_TITLE` warning. Nothing is guessed upward.

> **Role identity (stabilisation):** a company-person relationship is resolved by the normalised title, then by the
> role's `title_aliases` (earlier titles replaced by a reviewer). Editing a title therefore never causes the original
> wording to create a second role on re-ingestion. See `PEOPLE_REVIEW_WORKFLOW.md` section 2a.
>
> **Placeholder names:** names made only of filler words (`Unknown Person`, `Test User`, `Contact Name`, `N/A N/A`)
> are rejected as `INVALID_NAME` and quarantined; nothing is invented.

> **Suppression (Phase 6.4):** ingestion also consults the durable suppression registry (`PEOPLE_SUPPRESSION.md`). A record carrying a deterministic identity signal of a suppressed person (LinkedIn, work e-mail, or phone with the person's name) is quarantined as `SUPPRESSED_PERSON` and creates nothing.

## 5. Person deduplication

Deterministic, in `PeopleWriteService.resolvePerson` (priority order):

1. **Normalised LinkedIn URL** (unique index).
2. **Work email** (non-shared mailbox) *and* a compatible name (same, or same surname with matching initial/prefix: `A. Kumar` ≈ `Arun Kumar`, but never `Varun Kumar`).
3. **Phone/mobile** *and* an identical normalised name.
4. **Identical normalised name at the same company.**

Safeguards:

* Similar names never merge (`Arun Kumar` ≠ `Arun Kumaran` ≠ `Varun Kumar`). Same name at *different* companies is a different person unless 1–3 tie them.
* Two records with different LinkedIn profiles are never merged, whatever else matches.
* Ambiguity (several candidates) → quarantine `AMBIGUOUS_IDENTITY` rather than a guess. Several same-named people at a company resolve only to the one already holding that exact role.
* A work email owned by a different person is not attached to the new one (`CONTACT_BELONGS_TO_ANOTHER_PERSON`); LinkedIn beats a conflicting email (`IDENTITY_CONFLICT` warning).
* A **suppressed** person is never resurrected or duplicated: the record is quarantined (`PERSON_SUPPRESSED`).
* Existing people are never merged into each other automatically.

Merging is non-destructive:

| Data | Rule |
|---|---|
| Person fields | Fill gaps only; first-seen values win. |
| Role title | First-seen wording kept. Classification refreshed from the (identical) normalised title. |
| Verification | Stronger stored status survives weaker input; only an explicit `CONFLICTED`/`STALE` lowers it. |
| Confidence / `last_verified_at` | Maximum of stored and incoming. |
| `is_current`, dates, relationship | Changed only when the input states them; silence never flips a former role to current. |
| Contacts | Deduped per person by `(type, normalised value)`; verification only ever upgraded; a new primary demotes the old primary but old contacts are kept. |
| Evidence | Never removed; see §7. |

A person may hold several roles at one company (different titles) and at several companies; each is a
`company_people` row. Title changes are recorded as additional roles; the older role is not
automatically ended (a source must say so with `isCurrent: false`/`endDate`).

## 6. Contacts

Work email, phone and mobile only; LinkedIn is a person field. **No personal-email support** (Phase 1
excludes it deliberately). Nothing is fabricated or guessed. Every contact enters as `UNVERIFIED`,
`is_published = false` (never customer-visible, even after the person is published, until
`publishContact`), and contact verification requires contact-scoped evidence.

## 7. Evidence

Each ingested record writes, all unverified unless a real verification is supplied:

| Evidence | Scope | Supports |
|---|---|---|
| `ROLE_CLAIM` (or the source's `evidenceType`) | role | identity of the holder at this company, the job title, the decision-maker classification |
| `IDENTITY_CLAIM` | person | the person exists / LinkedIn (does **not** verify any role) |
| `CONTACT_CLAIM` | contact | that source asserted this contact |
| `MANUAL_VERIFICATION` | role | a verification event (`verifiedAt`, `verifiedBy`) — only if supplied |

Reviewers see the source type, internal URL/reference, `observed_at`, `verified_at`, and confidence.
`source_url` remains internal: the customer API never returns it.

Idempotency: each row has `fingerprint = sha256(person, target(role|contact|person), sourceType, evidenceType, source locator)` with a unique index.
Re-observing the same source updates it (later `observed_at`, newly gained `verified_at`, higher confidence)
instead of adding a row; a different source adds a row, so provenance accumulates.

## 8. Verification and confidence

Unchanged: the Phase 1 policy decides what customers see. Newly ingested people are
`UNVERIFIED`, confidence `0` unless the source supplied one. `VERIFIED`/`PARTIALLY_VERIFIED` need a
`verification` block with `verifiedAt` **and** `verifiedBy` (else the record is rejected), which becomes
role-scoped verified evidence. A claim reaching `PeopleWriteService` without verified evidence is stored
`UNVERIFIED` (`VERIFICATION_CLAIM_WITHOUT_EVIDENCE`). Verifications older than 365 days are reported
`STALE` and never show high confidence.

## 9. DRAFT → PUBLISHED lifecycle

```
ingest ─▶ DRAFT (person DRAFT, role unpublished, contacts unpublished)   ← invisible to customers
                │  PeoplePublishingService (internal; reviewer name recorded in the audit log)
                ├─ publishRole(companyPersonId)   needs ≥ 1 evidence row; sets role published + person PUBLISHED
                ├─ publishContact(contactId)      needs contact evidence, not CONFLICTED
                ├─ unpublishRole / unpublishContact
                └─ suppressPerson(personId)       hides everywhere, unpublishes all roles, blocks re-ingestion
```

Visibility now needs **all** of: business `PUBLISHED`, person `PUBLISHED`, **role `is_published`**, and (to
see a value after unlock) contact `is_published`. The role flag (new in migration `0005`) closes a leak: a new
role discovered for an already-published person stays hidden until reviewed. Existing Phase 1 roles were
backfilled to published once, at migration time, so nothing customers already see disappears.
The legacy `dataStatus: 'PUBLISHED'` argument of `upsertPersonForBusiness` still publishes person+role in one
step for trusted callers; the ingestion service never uses it.

## 10. Quarantine

`people_ingestion_quarantine` holds the raw payload, reasons (`code`, `message`), `batch_ref`, source label,
and status (`PENDING`/`RESOLVED`/`DISCARDED`). It is unique on the payload fingerprint, so re-running a bad file
does not multiply rows, and a record that later ingests cleanly (e.g. its company was added) flips to `RESOLVED`.
Reason codes include `MISSING_NAME`, `NAME_INCOMPLETE`, `MISSING_TITLE`, `MISSING_BUSINESS`, `BUSINESS_NOT_FOUND`,
`AMBIGUOUS_BUSINESS`, `MISSING_SOURCE`, `INVALID_SOURCE_TYPE`, `INVALID_SOURCE_URL`, `INVALID_DATES`,
`CONFLICTING_CURRENT_FLAG`, `INVALID_HINT`, `INVALID_ROLE_COMBINATION`, `INVALID_VERIFICATION`, `AMBIGUOUS_IDENTITY`,
`PERSON_SUPPRESSED`, `PROCESSING_ERROR`. One bad record never blocks the rest of a batch. `dryRun: true`
validates and resolves companies without writing anything (including quarantine).

## 11. Idempotency

Running the same ingestion twice (or concurrently) creates no new people, roles, contacts, evidence or
quarantine rows, and the second report shows `unchanged`. This holds because of: deterministic identity
resolution, unique `(business, person, normalised title)`, unique `(person, type, normalised value)`, unique
evidence fingerprints, and update-if-stronger merges. Verified by the test suite for JSON and CSV input.

## 12. Database changes (migration `0005_people_ingestion`)

* `company_people.is_published boolean not null default false` (backfilled `true` once for pre-existing rows, guarded so re-running never re-backfills).
* `people_evidence.fingerprint varchar(64)` + partial unique index.
* `people_ingestion_quarantine` table (+ unique fingerprint, batch and status indexes, status check).

Additive and idempotent; no company/upload tables are touched. **Run it before deploying** the API that reads
`is_published`. It has not been run against any shared database.

> Phase 4 adds the internal review and publishing workflow (`PEOPLE_REVIEW_WORKFLOW.md`). Ingested roles are
> `review_status = PENDING`; only a reviewer's approval publishes a role.

## 13. Connecting the upload pipeline (Phase 3 - done)

See `PEOPLE_UPLOAD_INTEGRATION.md`. The pipeline reaches this layer only through `ImportPeopleBridge` and the
`PEOPLE_INGESTION_SERVICE` token, after a business has been committed, best-effort.

## 14. Future enrichment providers

Write an `IPeopleSource` that maps a provider's response to `IRawPersonRecord` with honest provenance
(`source.type = 'API_INTEGRATION'`, `label`, `url`/`reference`, real `observedAt`). Do not set
`verification` unless a human or a real check verified the claim. Providers add evidence; they never publish.

## 15. Testing

`npm test` in `apps/api`: `person-record.normalizer.spec.ts` (pure normalisation, CSV) and
`people-ingestion.integration.spec.ts` (real Postgres schema built from the actual migration files with PGlite:
identity, companies, roles, contacts, evidence, idempotency, quarantine, lifecycle/visibility, isolation,
migration behaviour). No shared or production database is used or modified.
