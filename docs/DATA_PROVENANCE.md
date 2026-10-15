# Data provenance, source trust and data quality (Phase 15)

**Status: engineering description of what the code does. Not a statement about the lawfulness of any source.** Whether Orion may collect, keep, enrich or resell data from a given source is a legal and business decision made by the people who register and approve sources; the code records that decision and enforces it. Nothing here says the data is accurate.

## 1. The lifecycle, and where each control sits

`Import data → validation → duplicate manager → publish queue → explicit administrator publish → published business → customer page`

| Step | What happens | Control added or verified in Phase 15 |
|---|---|---|
| Submit (`POST admin/import/submit`, `csv/submit`) | A batch and its rows are stored. The batch may name a registered source (`sourceId`). | The source must exist. The default is **no automatic publication**. Untrusted columns in the file cannot set status, verification, source, timestamps or audit values: the normaliser has a closed output shape and the publisher builds the business from it plus server-side values |
| Normalise and validate | Required fields and formats are checked; failures are recorded per row. | Validation log messages no longer copy e-mail or phone values (the value stays in the import record) |
| Duplicate manager | Identifier, website-domain and name-plus-location matches become reviewable candidates. | An identifier only matches an identifier of the **same kind**; a blank or very short value matches nothing |
| Publish queue | An approved row has a queue item (`PENDING`). | Nothing is published here unless the batch asked for it **and** its source is approved |
| Explicit publish (`POST admin/import/publish-batch/:id`) | An administrator publishes the batch's approved rows. | Checks the source, re-validates every record, records the actor, audits refusals and overrides |
| Published business | Created in one transaction with locations, contacts, websites, identifiers, scores and history. | Provenance and verification levels are written; values that failed their format check are not published |
| Customer page, search, unlock, export | Read only published businesses. | Unchanged; a revoked source's businesses are held back (section 5) |

No other route publishes. The queue worker that used to call the publisher with only a queue id now passes no authority and is refused.

## 2. Source trust model

A **source** is a row in `data_sources` (the register already existed; Phase 15 added the trust columns, additive migration `0025_source_trust`).

| Trust status | Meaning | Publication |
|---|---|---|
| `UNREVIEWED` | Registered but never assessed. The default for every source, including all that existed before | Not published automatically. An administrator may publish with an explicit, audited override |
| `APPROVED` | An administrator assessed the source and its terms and recorded why | Published automatically if the batch asks for it; always publishable by an administrator |
| `RESTRICTED` | Usable only within the recorded restrictions (`usage_restrictions`) | Never automatic. An administrator may publish with a recorded override |
| `REVOKED` | No longer usable | **Refused, even with an override.** What it already published is held back (section 5) |
| none | The batch named no source: unknown provenance | Treated like `UNREVIEWED`; stored as unknown, never invented |

Rules:
- Only `ADMIN` and `SUPER_ADMIN` can register a source or change its trust (`/admin/import/sources`); the body is whitelisted, a reason of 10 to 500 characters is required, and restricting needs the restriction text.
- Registering a source does not approve it.
- Every registration, approval, restriction, revocation, reset and release is an audit event with actor, old and new status and reason: `SOURCE_REGISTERED`, `SOURCE_APPROVED`, `SOURCE_RESTRICTED`, `SOURCE_REVOKED`, `SOURCE_TRUST_RESET`, `SOURCE_HELD_RELEASED`.
- Registration records what the administrator **states** (collection method, reference, restrictions). Orion does not verify those statements. A public web page is not recorded as permission; only the administrator's decision is.
- A batch's source cannot be changed by the file it carries.

## 3. What is recorded about a published business

No new table. `businesses.source_id` (now indexed), `businesses.metadata` (internal, never returned to customers; verified by test), `business_history.source_batch_id` and `business_contacts.metadata` carry it.

| Where | What |
|---|---|
| `businesses.source_id` | The registered source of the batch, or null when none was named |
| `businesses.metadata.provenance.origin` | source id and name, **source trust at the time of publication**, collection method (as stated), batch id, import record id, row number, import time, publication time, the publishing administrator, publish mode, and whether an override was used |
| `businesses.metadata.provenance.history` | One entry per later merge: time, batch, record, source, administrator, fields added, fields in conflict. The first origin is never rewritten |
| `businesses.metadata.verification` | Level per identifier and website, business level `UNVERIFIED`, check time |
| `businesses.metadata.quality` | `droppedValues` (field names of values not published because their format was invalid), `conflicts`, `needsReview` |
| `business_contacts.metadata` | Source ids and the verification level of that contact's e-mail and phone, with the highest level an import can reach |
| `business_history` | `INITIAL_CREATION` with `source_batch_id`; `IMPORT_MERGE` with field names only |
| `import_records` | The raw and normalised row, the status and the validation log: the trace back to the file row |

Provenance is per business, with per-contact detail. Field-level provenance for company facts (name, description, founding year) is **not** kept beyond the origin and merge history. Businesses published before Phase 15 have **unknown provenance** (null source, no origin): they are reported as such in the quality overview and are not touched by a revocation, because they cannot be attributed.

## 4. Verification: what each word means

| Level | Meaning | What it does NOT mean |
|---|---|---|
| `UNVERIFIED` | Not checked, or failed its format rule | |
| `FORMAT_VALID` | The value has a valid shape | Not deliverable, reachable, owned by the business or listed anywhere |
| `STRUCTURE_VALID` | Satisfies the known structural rules of its kind. GSTIN: state code in range, embedded PAN structure with a valid entity letter, and the check character. PAN: shape and a known entity letter | Not confirmed against the government register |
| `SOURCE_SUPPORTED` | A named, approved source states the value | Not produced by imports in this phase |
| `CONTROL_VERIFIED` | The party demonstrated control (for example by answering a message) | Orion has no such flow; no message is sent |

- An import can record at most `STRUCTURE_VALID` (`capImportLevel`). `businesses.is_verified`, `business_contacts.is_email_verified` and `is_phone_verified` are **never** set by an import and stay false.
- CIN has a shape only (no published check character), so it is at most `FORMAT_VALID`.
- Freshness is reported (`CURRENT` within 365 days of the check, `STALE` after, `UNKNOWN` without a check). It never deletes or hides anything.
- Business contacts and personal contact information stay distinct under `DATA_CLASSIFICATION.md`; verification evidence is internal and never shown to customers.
- A real finding: the second sample GSTIN in the repository fixtures and in the import template (`29AAACI4397H1Z5`) has a wrong check character. It is accepted as `FORMAT_VALID` and flagged in the tests; the sample should be replaced with a value known to be valid.

## 5. Publication rules for quality states

| State | Rule | Why |
|---|---|---|
| Source revoked | **Blocks** publication and holds back what the source published | The permission is gone |
| Source unreviewed, restricted or unnamed | **Blocks automatic** publication; an administrator may override, recorded | An accountable human decides |
| Required field missing (name, location, state) | **Blocks**: the row fails validation and is re-checked at publication | A record without them is not usable |
| Malformed e-mail, phone, GSTIN, PAN, CIN | The **value is not published**; the record continues, flagged `needsReview`; the field name is recorded | Do not present a malformed value as data, but do not lose the company |
| Duplicate candidate | **Blocks automatic** publication; a reviewer merges, creates or rejects | Merging is a judgment, never automatic |
| Differing public fact or identifier on a merge | The **published value is kept**; the difference is recorded as a conflict; the business is flagged `needsReview`; no block | Conflicts are reviewed, never silently resolved |
| Verification older than 365 days | **Disclosed** in the quality overview; no block, no deletion | Retention and correction follow their own policies |
| Missing contact details | Disclosed; no block | |
| Suppressed or removed contact | People: enforced. **Company contacts: not enforced** (SG-05; Phase 11 is incomplete) | See the gap list |

Reversible hold on revocation: businesses with that source are set to `PENDING_VALIDATION` (not visible in search, detail, unlock or export), the previous state and reason go into their metadata, and their search entries are queued for removal. A database trigger also refuses to turn a revoked source's business back to `PUBLISHED` from any code path (including the web gateway's status screen). Re-approving the source and calling `release-held` puts them back. Unlock records, saved leads and history are untouched.

## 6. Merges

A reviewer's `MERGE` decision (previously recorded but never executed) now runs at publication: the business keeps its id; missing facts, contacts (matched by e-mail or phone, never by name alone), identifiers, websites and an address are **added**; a differing value is **never written over** the published one; everything is one transaction; a provenance history entry and a field-name-only history row are written. Unlocks, credits, saved leads and audit history are unaffected. There is no bulk merge and no automatic merge.

## 7. Authorization and audit

Source management, publication, the quality overview and review decisions are `ADMIN` / `SUPER_ADMIN` only. Audit events: `SOURCE_*`, `IMPORT_BATCH_SUBMITTED`, `IMPORT_BATCH_PUBLISH_RUN`, `IMPORT_RECORD_PUBLISHED`, `PUBLISH_OVERRIDE_USED`, `PUBLISH_REFUSED` (with the reason code and the route used), `PUBLISH_FAILED`, `IMPORT_REVIEW_DECISION`, `IMPORT_REVIEW_REFUSED`. No password, token or contact value is written to an audit entry.

## 8. Manual review requirements

- Register each real source and decide its trust before relying on automatic publication. Until then every batch needs the explicit publish step.
- Review businesses flagged `needsReview` (conflicts, dropped values) from the quality overview.
- Decide what to do with businesses of unknown provenance (all published before this phase).
- Replace the invalid sample GSTIN in the fixtures and the import template.

## 9. Known gaps (not fixed here)

1. **Admin UI.** The import screen submits with `autoPublish: false` and has no control that calls the publish step. After this phase an import waits in the publish queue until `admin/import/publish-batch/:id` is called; a "publish batch" control (and a source picker) must be added to the UI. The screen's explanatory text still describes automatic publication. This needs approval as a UI change.
2. **Web gateway status screen** (`admin/businesses`) sets business status directly in SQL. It cannot publish a revoked source's business (database guard) but can publish an unreviewed one; it writes its own audit entries.
3. **Company-contact suppression** does not exist (SG-05, Phase 11 incomplete): a removed contact can be re-imported and published.
4. **Raw rows are retained.** `import_records.raw_payload` and `normalized_payload`, and `business_history.full_snapshot` of creations, contain the contact values of the row; there is no retention job for them.
5. **People provenance** is separate (`PEOPLE_CONTACT_PROVENANCE.md`) and was not changed.
6. **Source statements are unverified.** collection method, reference and restrictions are what an administrator typed.
7. **Duplicate detection** has no e-mail or phone signal and uses a name-similarity threshold; shared domains of hosting platforms create review work, not merges. Concurrent imports are protected by the unique `(type, normalized value)` index on identifiers (a collision makes the second publish fail cleanly), not by locking.
8. **Stale checks** are counted by an on-demand report that scans the businesses table; there is no scheduled job.
9. **Search index** removal on revocation is queued; if the search service is down the entries remain until the queue runs (the database search is immediate).
