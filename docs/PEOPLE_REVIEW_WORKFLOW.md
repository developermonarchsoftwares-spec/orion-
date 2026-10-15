# People Review & Publishing Workflow (Phase 4)

**Orion separates data acquisition from data trust.**

```
Ingestion discovers candidates  ─▶  Evidence supports claims  ─▶  Review validates them  ─▶  Publishing exposes them
(Phases 2-3, automatic, DRAFT)      (people_evidence)             (this phase, human)         (role by role)
```

Customers only ever see information that a reviewer approved. Ingestion can never publish.

## 1. Architecture

```
upload / import / future providers
        │  IPeopleIngestionService (unchanged)
        ▼
people, company_people (PENDING), person_contacts (hidden), people_evidence, people_ingestion_quarantine
        │
        ▼                      INTERNAL ONLY  /internal/people-review/*   (JwtAuthGuard + RolesGuard + @Roles)
PeopleReviewController ─▶ PeopleReviewService ──▶ PeoplePublishingService  ◀── the ONLY place visibility changes
                      └─▶ PeopleQuarantineService ─┘        │ audit row in the SAME transaction (audit_logs)
                                                             ▼
                                        customer-facing People API (Phase 1, read-only, published only)
```

* `PeoplePublishingService` is the single publishing gate. The review service and the controller add no
  publishing logic; a test asserts nothing else sets `is_published` / `APPROVED`.
* The import module has no access to People tables or review services (asserted by a test); it only
  reaches ingestion through the Phase 3 bridge.
* No new auth system and no new audit system: existing JWT + `RolesGuard`, existing `audit_logs`.

## 2. The unit of review is a role

A *role* is a person at a company (`company_people`). Publishing is **role-level**:

```
Person
├── CEO at Company A       → APPROVED  (customers see it)
├── Director at Company B  → PENDING   (hidden)
└── Former role            → REJECTED  (hidden)
```

Approving a role never publishes another role of the same person, and never publishes any contact unless
that contact is named in the request. A new role discovered for an already-published person is created
`PENDING` and stays hidden until it is reviewed on its own.

### 2a. Role identity and title changes

Three things are kept apart:

| Concept | Stored as | Stable across title edits? |
| --- | --- | --- |
| Person identity | `people` (name, LinkedIn, contacts, `name_aliases`) | yes |
| Company-person relationship | one `company_people` row per (company, person, current title) | yes: the row id never changes |
| Title history | the row's current `job_title_at_company` + `title_aliases` (earlier normalised titles) | n/a |

* Ingestion resolves a role by the **normalised** title (`CEO` and `Chief Executive Officer` normalise to the same key,
  so they are the same role), and if there is no exact match, by `title_aliases` of that person's roles at that company.
* When a reviewer changes a title, the previous normalised title is appended to `title_aliases`. Re-uploading the old
  wording (`CEO` after the reviewer set `Managing Director`) resolves to the same role: no second role, no second
  review item, the reviewer's wording and classification are kept, verification is never downgraded, evidence is
  de-duplicated by fingerprint.
* A title that is genuinely different (`CEO` vs `Head of Sales`) is a different role and is reviewed independently.
  A title that is neither the current title nor a known former title of the person at that company also creates a new
  `PENDING` role (a person can legitimately hold two roles).
* A reviewer cannot rename a role onto another role's current **or former** title (409 `ROLE_EXISTS`).
* Ingestion never changes a role's title; only a reviewer does (audited: previous/new title, reason).

## 3. States

`company_people.review_status` (with `is_published`, `reviewed_at`, `reviewed_by_id`, `review_note`):

| State | Meaning | Customer-visible |
|---|---|---|
| `PENDING` | Ingested, awaiting review (the queue) | no |
| `APPROVED` | Reviewed and published (`is_published = true`) | yes, if the company and person are also published |
| `REJECTED` | Reviewer said no; stays hidden and out of the queue | no |
| `QUARANTINED` | Held for a data fix; a snapshot is also in the quarantine queue | no |

DB invariant (check constraint): `is_published = true ⇒ review_status = 'APPROVED'`. Person-level
`people.data_status` (`DRAFT`, `PUBLISHED`, `SUPPRESSED`) and contact-level `is_published` remain as before.
Customer visibility needs **all** of: company `PUBLISHED`, person `PUBLISHED` (not suppressed), role `APPROVED`
+ `is_published`, and, to see a contact value after unlock, that contact `is_published`.

Transitions (all through `PeoplePublishingService`, each audited, reasons required where noted):

```
PENDING ──approve──▶ APPROVED ──unpublish (reason)──▶ PENDING
PENDING ──reject (reason)──▶ REJECTED ──reopen──▶ PENDING
PENDING ──quarantine (reason)──▶ QUARANTINED ──reopen / resolve──▶ PENDING
any ──suppress person (reason)──▶ REJECTED + person SUPPRESSED (terminal; blocks re-ingestion)
```
A rejected or quarantined role cannot be approved until it is reopened.

## 4. Reviewer actions

| Action | Endpoint | Effect |
|---|---|---|
| Queue | `GET /internal/people-review/queue` | Pending roles by default. Filters: `status`, `businessId`, `company`, `q`, `decisionMakerType` (`NONE` = unclassified), `verification`, `source`, `minConfidence`/`maxConfidence`, `createdFrom/To`, `updatedFrom/To`, `hasEvidence`; `sort`, `page`, `limit`. |
| Detail | `GET …/roles/:id` | Identity, contacts (internal values, each with its attribution to this company), quality, **all evidence**, import provenance, other roles, readiness/blockers, audit trail. |
| Approve | `POST …/roles/:id/approve` `{reason?, publishContactIds?}` | Publishes this role and only the named contacts *of this person* (atomic). Needs a valid person, an unsuppressed identity, ≥ 1 evidence row on the role. |
| Edit | `PATCH …/roles/:id` | Audited correction (below). |
| Edit & approve | `POST …/roles/:id/edit-and-approve` | Edit + approve in one transaction; if approval fails the edit is rolled back. |
| Reject | `POST …/roles/:id/reject` `{reason}` | Hidden, out of the queue. From PENDING, APPROVED, REJECTED (a no-op with an audit row) or QUARANTINED (closes the role's queue item). |
| Quarantine | `POST …/roles/:id/quarantine` `{reason}` | Hidden; a snapshot is added to the existing quarantine queue. A REJECTED role is refused (409 `REVIEW_STATE_INVALID`): reopen it first. |
| Reopen | `POST …/roles/:id/reopen` | Rejected/quarantined → pending (closes the role's queue item). Refused for a suppressed person (409 `PERSON_SUPPRESSED`). |
| Unpublish | `POST …/roles/:id/unpublish` `{reason}` | Approved → pending (offline immediately). |
| Suppress person | `POST …/people/:personId/suppress` `{reason}` | Hides every role, unpublishes contacts, blocks re-ingestion. |
| Contacts | `POST …/contacts/:id/publish` / `unpublish` | Publishing needs contact-level evidence and a non-conflicted contact. |

Approval does **not** verify anything: a published role keeps whatever verification it has (usually
`UNVERIFIED`), and customers see the Known/Likely/Unverified label derived from the evidence. Reviewers cannot
mark data verified in this phase.

## 5. Editing rules

A reviewer may correct: name, job title, classification (department / seniority / decision-maker type),
current/former + dates, contact values, and add supporting evidence metadata. Rules:

* A **reason is mandatory** and every material change is audited with previous and new values.
* Contact values must **cite a source** (type + reference or URL). An edited or added contact is stored
  `UNVERIFIED` and **unpublished**, with a contact-scoped `REVIEWER_EDIT` evidence row that says who supplied
  what. Reviewers cannot enter unsourced data, and shared mailboxes / another person's email / duplicates are refused.
* Added evidence is always unverified.
* Classification overrides are validated against the taxonomy (`checkRoleCombination`) and marked
  `classification_source = REVIEWER`, so re-ingestion no longer overwrites them.
* A corrected name keeps the old normalised spelling in `people.name_aliases`, so re-uploading the old spelling
  still resolves to the same person (no duplicate).
* A title change that would collide with another role of the same person is refused. A suppressed person cannot be edited.

## 6. Quarantine workflow

`people_ingestion_quarantine` holds records ingestion refused (invalid data, unknown/ambiguous company,
ambiguous identity, suppressed person) **and** roles a reviewer put on hold.

| Action | Endpoint | Effect |
|---|---|---|
| List / detail | `GET …/quarantine`, `GET …/quarantine/:id` | Raw payload, normalised payload, reasons, validation errors, company match (`MATCHED`/`NOT_FOUND`/`AMBIGUOUS`), identity candidates (same-name people at that company), source, resolution. |
| Retry | `POST …/quarantine/:id/retry` `{reason, patch?}` | Explicit only. Optional corrections to identifying fields (`personName, jobTitle, email, phone, mobile, linkedinUrl, businessId/Slug/Identifier, isCurrent, dates, location`). **Provenance, verification and confidence cannot be patched.** Success creates/updates a DRAFT role that enters the normal queue (nothing is published); failure keeps the item pending with fresh reasons and creates no duplicate row. |
| Resolve | `POST …/quarantine/:id/resolve` `{reason}` | Closes as handled; for a reviewer-held role, reopens it. |
| Reject | `POST …/quarantine/:id/reject` `{reason}` | Discards the record. |
| Suppress | `POST …/quarantine/:id/suppress` `{reason, personId?}` | Suppresses the person (existing `personId`, the held role's person, or a suppressed stub created from a valid record) so future ingestion is refused. If the record cannot be tied to a person you get `PERSON_REQUIRED`. |

Ambiguous identities are never retried automatically: re-ingesting the same file keeps a single pending item;
only a reviewer supplying an identifier (for example the LinkedIn URL) and pressing Retry can resolve it.

## 7. RBAC

Existing roles, existing guards (`JwtAuthGuard`, `RolesGuard`, `@Roles`), same convention as the admin import routes.

| Role | Read queue / detail / quarantine | Approve, edit, reject, quarantine, reopen, unpublish, suppress, contacts, retry, resolve |
|---|---|---|
| `SUPER_ADMIN`, `ADMIN` | yes | yes |
| `DATA_MANAGER` | yes | no |
| `USER`, `MEMBER` (customers), anonymous | **no (403 / 401)** | **no** |

Every handler of the review controller carries an explicit `@Roles`; a test enumerates them and asserts no
customer role appears. All ids are UUID-validated; contact ids named in a request must belong to the role's
person (otherwise `404`), so ids cannot be used to touch other people's data.

## 8. Audit trail

Every state change writes an `audit_logs` row **in the same transaction** as the change, so an action and its
audit record succeed or fail together (a failed audit write rolls the action back).

`action` ∈ `PEOPLE_ROLE_PUBLISHED | _UNPUBLISHED | _REJECTED | _QUARANTINED | _REOPENED | _EDITED`,
`PEOPLE_CONTACT_PUBLISHED | _UNPUBLISHED`, `PEOPLE_PERSON_SUPPRESSED`,
`PEOPLE_QUARANTINE_RETRIED | _RETRY_FAILED | _RESOLVED_MANUALLY | _REJECTED | _SUPPRESSED`.
Each row: `user_id` (reviewer), `entity_type`/`entity_id` (role, person, contact or quarantine item),
`old_values` (previous state / field values), `new_values` (new state, `personId`, `companyId`, `reviewedBy`, `reason`),
`created_at`. The role detail returns the recent trail with reviewer emails.

## 9. Evidence handling

Reviewers see all evidence for the person, marked as applying to this role / another role / a contact / the person:
source type and friendly label, source reference, **internal** source URL, evidence type, observed time, status
(`VERIFIED`, `STALE` when verified > 365 days ago, or `UNVERIFIED`) and confidence. Nothing is fabricated: the view is
the stored rows. The customer API never returns source URLs, references, review notes, reviewer identities, audit
data or fingerprints (asserted by a test).

## 10. CSV upload template

The template (`docs/ORION_IMPORT_TEMPLATE.csv`, the backend `getCanonicalTemplateCsv()` and the file the Admin UI
downloads via the gateway) is now one identical canonical template; a test enforces it. Columns:

**Company-level** (describe the company; never attributed to a person): `business_name, legal_name, gstin, cin, pan,
address_line1, city, district, state, pincode, phone, email, website, business_type, msme_category, industry, category,
description, founding_year`.

**Person-level**:

| Person | Name / title | Contact details |
|---|---|---|
| 1 | `contact_person`, `contact_title` | `person_email`, `person_phone`, `person_mobile`, `person_linkedin` |
| 2 | `person_2_name`, `person_2_title` | `person_2_email`, `person_2_phone`, `person_2_mobile`, `person_2_linkedin` |
| 3 | `person_3_name`, `person_3_title` | `person_3_email`, `person_3_phone`, `person_3_mobile`, `person_3_linkedin` |
| 4, 5 | `person_4_*`, `person_5_*` (same pattern; not listed in the template) | |

Rules: a person needs a name **and** a title (no default title is applied); `email`/`phone` are company contacts and
are not copied to a person; the normaliser's placeholder contact ("Primary Contact") never becomes a person; up to
five people per row; everything imported is DRAFT and appears in the review queue. The sample rows leave the
person-contact cells blank so nothing is invented for real people.
When the gateway falls back to its built-in importer (backend unreachable, local development), people columns are
ignored, since only the backend pipeline ingests people.

## 11. Customer visibility (verified by tests)

DRAFT person, DRAFT role, published person + pending role, published role + unpublished contact, quarantined role,
rejected role and suppressed person are all invisible through the company list, person detail, unlock, export and
search predicate. Approving a role makes exactly that role visible. A customer cannot reach any internal route
(anonymous → 401, customer → 403) even with guessed ids.

## 12. Database changes (migration `0007_people_review`)

Additive and idempotent. Existing published roles are backfilled to `APPROVED` exactly once (guarded, so a re-run never
overwrites later decisions).

* `company_people`: `review_status`, `reviewed_at`, `reviewed_by_id` (→ users), `review_note`, `classification_source`,
  three check constraints (incl. published ⇒ approved), index `company_people_review_idx (review_status, created_at)`.
* `people.name_aliases text[]`.
* (`company_people.title_aliases` is added by migration `0008_people_verification`; see `PEOPLE_VERIFICATION.md`.)
* `people_ingestion_quarantine.resolution jsonb`.

## 13. Performance

The queue is two statements per request (page + total) regardless of page size: evidence/contact aggregates are
correlated sub-selects on existing indexes (`people_evidence_company_person_idx`, `person_contacts_person_idx`); the
new index serves the default `review_status` + `created_at` ordering (verified with `EXPLAIN` with sequential scans
disabled; the tiny test tables would otherwise not use it). Detail is a fixed handful of queries.

## 14. Operating notes

* Deploy order: migrations `0004`–`0007`, then the API. Not applied to any shared database by this work. Validated on a clean disposable database with Drizzle's own migrator: first run applies all journal entries, a second run applies 0, and re-executing each People migration's SQL is a no-op.
* The Admin console has a **People Review** tab (queue, detail drawer with actions, quarantine).
* Not built: automatic discovery/enrichment providers, reviewer-side verification, bulk actions, notifications.

## 15. Validation results (stabilisation pass)

* **Automated:** `npm test` (API) and `npm test` (web) - see the final report for counts. Role-identity regression tests
  cover CEO -> Chief Executive Officer, CEO -> Managing Director, reviewer-corrected title -> original upload, repeated
  upload after a reviewer edit, and one person with different titles. A full-chain test drives a CSV row through the real
  import pipeline -> DRAFT -> queue -> evidence -> edit -> approve -> customer list, then repeats the identical upload.
* **Browser (real Admin UI):** validated against a **disposable rig** (Nest People controllers + real guards on an
  in-process PGlite database built from the migrations, Next dev server pointed at it). No Neon/production connection was
  made. Verified in the browser: People Review queue and counts, opening a role (identity, company, role, evidence, contact
  shown as hidden), edit + save (audit row), approve (audit row, state flips to unpublish), reject (reason required,
  audit row), reviewer quarantine, suppress person, and in the quarantine tab: retry with corrections (ambiguous identity
  resolved by a reviewer-supplied LinkedIn URL -> new PENDING role), resolve, reject and the suppress guard ("supply
  personId": a record that cannot be tied to a person is never suppressed by guess).
* **Not validated in a browser:** the real Admin OTP login (needs a `@monarchsoftwares.com` mailbox; the rig injected a
  locally minted token signed with a throw-away secret, while the API still enforced its real guards), and the customer
  discovery *pages* (the gateway serves discovery from its own database connection, which the rig deliberately did not
  provide). Customer visibility was verified through the customer API (`/companies/:id/people`) with a customer token.

## Suppression registry (Phase 6.4)

Suppressing a person (reviewer action or quarantine "suppress") now also writes the durable, digest-only suppression registry in the same transaction, so the person cannot be reintroduced by any source, record id, title or company while a deterministic identity signal matches. See `PEOPLE_SUPPRESSION.md`. There is still no unsuppress operation.

## Lifecycle audit (Phase 10): verified behaviour and known edges

Verified end to end on the real application (`test/people-lifecycle.e2e-spec.ts`, a real Pipeline ZIP from `test/fixtures/pipeline-split-bundle.zip`), reading the database after every action.

* **States.** Role: `review_status` PENDING -> APPROVED (and published) | REJECTED | QUARANTINED; reject / quarantine need a reason; reopen (REJECTED / QUARANTINED only) -> PENDING; unpublish (APPROVED + published only) -> PENDING; reject on a REJECTED role is a no-op and on a QUARANTINED role it also closes the queue item; quarantine is refused for a REJECTED role (reopen first); approve is refused for REJECTED / QUARANTINED, a SUPPRESSED person, or a role with no evidence. Person: `data_status` DRAFT -> PUBLISHED (with the first approved role) | SUPPRESSED (terminal, blocks re-ingestion). Contact: `is_published` set and cleared independently, needs contact evidence. Verification (UNVERIFIED / PARTIALLY_VERIFIED / VERIFIED / CONFLICTED, derived from the claim ledger) is separate: it never changes review state or publication, and approval never changes verification. The customer sees a role when `is_published` AND APPROVED AND the person is PUBLISHED AND the company is PUBLISHED; there is no cache, so publishing and taking down are visible at once.
* **Import never downgrades.** A later weaker export (UNVERIFIED / LOW) leaves a VERIFIED, published role, its published contacts, its evidence and the ledger unchanged; weaker evidence cannot replace stronger evidence (`ALREADY_VERIFIED`); only an explicit dispute lowers a claim.
* **Odd but accepted transitions** (safe: the role ends hidden; Phase 10A made unpublish of a PENDING, REJECTED or QUARANTINED role a 409 `REVIEW_STATE_INVALID`, see below): approving an approved role again is a no-op with a second audit row; rejecting twice likewise; a role of an unpublished company can be approved and goes live the moment the company is published; verification of a rejected role is allowed and does not reopen it; editing the title of a verified role makes the title claim need review again (PARTIALLY_VERIFIED) and the role stays published.
* **Multi-company people.** One person can hold roles at several companies (and more than one at the same company); approving, rejecting or verifying one role never changes the other. Person-level facts are shared: identity and LinkedIn claims, and **contacts, which are stored on the person, not on a company relationship**. Which company a contact belongs to is read from the import's observation claims, and since Phase 10B a customer card shows only the contacts attributed to its own company (a contact reported by several companies shows on each; an unattributed one is shown only when the person has exactly one company). The customer rule is in `PEOPLE_CUSTOMER_CONTRACT.md` and has not changed since; the reviewer dossier now shows the same reading beside each contact (Phase 15, below). Earlier text that said every company card shows the same e-mail is obsolete.
* **Reviewer dossier.** Shows evidence (source type, reference, URL), contacts with values, the verification panel, the audit trail and, since Phase 11, the import provenance of the role (see "Import provenance" below). It shows the run reference and source record of the observations behind the role, not the Pipeline bundle id (see "Import provenance" below).
* **Review screen.** Approve takes no reason (the API also accepts none); once a role is published Approve is disabled, so a contact published later goes through **Edit & approve**; the queue defaults to PENDING, so a published role disappears from it (set Status to APPROVED or ALL to see it with the live marker); the sub-tab, filters, page and the open dossier or quarantine drawer live in the URL (see "Review screen navigation and deep links" and "Review screen drawers" below), so a reload, a link and a new tab restore them.

## Phase 10A: lifecycle correction and the multi-company contact decision

**Unpublish is only the way down from APPROVED + published.** `PeoplePublishingService.unpublishRole` now refuses any other state with 409 `REVIEW_STATE_INVALID` (a REJECTED / QUARANTINED role: "is reopened, not unpublished"; a PENDING role: "Only a published role can be unpublished"). Reopen stays the single explicit transition from REJECTED / QUARANTINED to PENDING, and it is what closes a reviewer-quarantine item. Before the fix, unpublish moved those roles to PENDING with no reopen and left the quarantine item PENDING. No state machine was added; the existing audit row is unchanged for the legal transition.

**Decided in Phase 10B (Option C, no schema change; the section below it describes the earlier state): which work e-mail / phone a customer sees on a multi-company person.** See the contract doc, "Contacts belong to a company on a company card".

**Earlier state:** Contacts are person-level (`person_contacts` has no company reference), and the customer card, detail, unlock and export each pick one contact per type for the whole person (primary, then confidence), so the same address appears on every company card. The data to attribute a contact to the role that reported it exists (`people_observations.company_person_id` joined to `people_observation_claims.contact_id`) but the customer path does not read it. Options (A relationship-level contacts, B company-specific primary, C presentation filter over observation claims) and their tradeoffs are in the Phase 10A report; no option is chosen here. Pinned by `people-lifecycle.e2e-spec.ts` (card shows the same email at both companies; observation claims attribute each email to its own role).

**LinkedIn** is a person attribute (`people.linkedin_url`), shown after unlock with no separate publish gate, unlike e-mail / phone which have a per-contact publish step. This is existing policy, unchanged.

**Reviewer dossier and import runs.** `getRoleDetail` does not show which run introduced a role. What exists: `people_observations` (batch_ref `people-export-v1-<hash>`, acquired_at, observed_at, source_key, source_record_id = Pipeline relationship id, company_person_id, business_id) outlives the 7-day queue job. The smallest future change is a read-only query of the role's latest observations in `getRoleDetail` plus a dossier panel; no migration.

## Import provenance in the dossier (Phase 11)

`GET /internal/people-review/roles/:id` returns a read-only `provenance` block, and the review drawer shows it as "Import provenance" above the evidence list. It is read from the role's import observations (`people_observations` rows of outcome INGESTED whose `company_person_id` is this role), newest first, at most 20 (`truncated: true` says there are more). Per observation:

| Field | Meaning |
|---|---|
| `source` | the source's display name, key and registry version (for the Pipeline export: `people-json`) |
| `batchRef` | the run reference, `people-export-v1-<hash>`, identifying the export file the row came from |
| `sourceRecordId` | the source's own id of the record; for the Pipeline export this is the relationship id, the key to look the row up in the Pipeline |
| `acquiredAt` / `observedAt` | when Orion obtained it (the export's `exported_at`) / when the source says it was true (null: the source did not say, shown as such) |
| `observedTitle` / `observedIsCurrent` | what the source said about the role at that time |

* **Several observations** (several runs, or a later export of the same relationship) are all listed; an identical re-run adds no row (the observation log is idempotent).
* **Bundle id.** The Pipeline bundle id and part number live only in the import job's metadata (kept 7 days) and are not stored with the observation, so the dossier shows the run's `batchRef`, not the bundle. Showing the bundle would need a stored link, which this phase deliberately does not add.
* **No provenance** is an explicit empty state ("No import provenance available"): roles or contacts created by hand, and records imported before observations were recorded, have none. Nothing is guessed or back-filled. Quarantined records belong to no role and never appear here. Contact-level provenance is not shown.
* **Reviewer-only.** It follows the dossier's existing read policy (ADMIN, SUPER_ADMIN and the read-only DATA_MANAGER); customers get 403, anonymous 401, and no customer response (cards, detail, unlock, unlocked list, export, discover) carries it. Observation ids are never returned.
* It is display only: it does not affect deduplication, contact attribution, verification, review state or publishing.

## Review screen navigation and deep links (Phase 12)

The admin console is one client page (`/admin/monarch`) whose section is React state; nothing else in it is addressable by URL. People Review keeps its own navigation state in that page's query string (`ownus/src/lib/people-review-url.ts`, used only by the review view and the page's first render). No backend change, no storage (no localStorage / sessionStorage), no new endpoint: a dossier link only calls the existing `GET /internal/people-review/roles/:id`, which does the authorization.

**URL contract.** `/admin/monarch?section=people_review[&pr=roles|quarantine][&filters][&page=N][&role=<role id>]`
* `section=people_review` opens the section (it is the only section the page reads from the URL). `pr` is the sub-tab (omitted = Triage).
* Only values that differ from the defaults are written, and only the active sub-tab's filters: Roles `status, company, q, dm, verification, source, minConfidence, hasEvidence, sort, page`; Triage `category, priority, status, q, since, page`; Quarantine `status, code, page`. Switching sub-tab resets the filters, as before.
* `role` is the existing role id (a UUID) and nothing else; it opens the dossier from any sub-tab (Triage role items included). The quarantine drawer stays local state.
* Everything read from a URL is validated (whitelisted values, UUID, bounded page number, 100-character text); anything invalid falls back to the default, so a hand-edited URL cannot put the screen in an impossible state. A `role` that is not a UUID is ignored, never sent to the API, and the reviewer sees "That role link is not valid."

**History.** Opening, closing and switching a dossier and switching sub-tab are navigation (`pushState`); filter, search and page edits `replaceState` (no entry per keystroke). So A, then (close) B, Back, Back returns to A, Forward returns to B; closing keeps the filters and page; Back after a close reopens the dossier. A dossier is keyed by its role id, so Back / Forward never shows the previous role's data while loading.

**Reload, deep link, new tab.** The first render reads the URL, so a reload, a pasted link or a new tab opens the same sub-tab, filters, page and dossier with one set of requests (React's dev-mode double mount aside). The dossier is independent of the queue: a role that is not on the visible page opens by id; changing page, filter or search never closes or replaces it, and nothing selects another role. A page number past the last page falls back to the last page. A dossier that cannot be loaded (unknown id, or 403 from the API) shows "Role unavailable" and the API's message with Close, never an endless spinner; a link to a role the reviewer may not read gives the same result as before (the API refuses). A link opened while signed out shows the sign-in gate and keeps the URL.

**Leaving the section.** Choosing another admin section removes this screen's parameters and unmounts it, so coming back starts from the defaults (the console has never kept section state). Section changes do not add history entries, so browser Back after returning steps through the earlier People Review entries of that page.

**Limits (Phase 12; superseded where noted by the Phase 13 section below).** Quarantine drawers were not deep-linkable and the dossier had no Escape-to-close or focus management.

## Review screen drawers: keyboard, states and quarantine links (Phase 13)

**Quarantine items are deep-linkable.** `qitem=<quarantine item id>` (a UUID, validated like `role`) opens the existing quarantine drawer from the Quarantine list or from a Triage item, using the existing `GET /internal/people-review/quarantine/:id`; no backend change. Only one drawer is open at a time: if a URL carries both `role` and `qitem`, the role wins. Opening, switching and closing it push history entries like the role dossier; filters and pages keep replacing. A triage item has no detail of its own: it opens a quarantine drawer (`qitem`) or a role dossier (`role`), so the triage filters and page stay in the URL beside it. An unknown or forbidden id gives the same unavailable state as a role.

**Drawer states.** The role dossier and the quarantine drawer share the rules in `ownus/src/lib/people-review-drawer.ts`. Loading ("Loading...", a status spinner, `aria-busy`) is distinct from unavailable: 404 "... not found", 403 "... unavailable" with the permission message, 401 "session expired", any other failure shows its message with Retry. None of them can leave a spinner. A failed reload after an action keeps the loaded data and shows the message above it, as before.

**Keyboard and focus.** Escape closes a drawer (same convention as the other admin drawers) unless another handler already used the key. Focus moves into the drawer when it opens, Tab and Shift+Tab stay inside it, and focus returns to the row that opened it when it closes (a deep link has no opener, so nothing is restored). Queue rows are keyboard-reachable: Tab to a row, Enter or Space opens it. No layout, wording or information architecture of the dossier changed.

## Concurrency, state guards and contact attribution in the dossier (Phase 15)

**Review actions serialize per person.** Publish (approve), reject, quarantine, reopen, unpublish, contact publish / unpublish, edit and edit-and-approve each take the person's transaction-scoped advisory lock (`lockPerson`, the same lock suppression, import writes and unlock already use) BEFORE reading the role or person, through `lockPersonOfRole` / `lockPersonOfContact`. What an action validates (suppressed? rejected? published?) is therefore the state it then writes, and its audit row commits with the change. A suppression and any review action on the same person run one after the other, in the order they reach the lock; actions on other people are not delayed. Before this, an action that had read "not suppressed" could finish after a suppression and re-publish the person.

**Source states.** REJECTED -> quarantine is refused (409 `REVIEW_STATE_INVALID`: reopen first), like publishing a rejected role. QUARANTINED -> reject is kept, because discarding a held role is a real decision (the quarantine queue's own Reject does it), and it now closes the role's reviewer-quarantine item (DISCARDED) in the same transaction. Repeating the same action (reject a rejected role, quarantine a quarantined one) is accepted as before. Reopen closes the item (RESOLVED), and suppressing a person closes the items of its roles (DISCARDED); a suppressed person's role cannot be reopened (409 `PERSON_SUPPRESSED`). The queue therefore never holds an open item for a role that is no longer QUARANTINED. The dossier does not offer Quarantine on a rejected role.

**Contact attribution in the dossier.** Each contact in `GET …/roles/:id` carries `attribution: { status, eligibleForThisCompany }`, the existing customer decision read against this dossier's company: `THIS_COMPANY` ("Reported by this company"), `SHARED` ("Shared with this company"), `OTHER_COMPANY` ("Reported by another company": never shown on this company's cards), `UNATTRIBUTED` ("Unattributed (shown)" when the person has one company, "Unattributed (not shown)" when it has several). Only the recorded observation claims count: nothing is inferred from the value, the domain, the name, the title or the company name. It is reviewer information only: it changes nothing for customers (visibility, unlock, discover and export are untouched, and none of them carries it), contains no ids or observation rows, and follows the dossier's existing read policy (admin, super admin, read-only data manager). So a reviewer can see before publishing that a contact will not appear on a company's card, and why.

**Attribution depends on retained observations.** Customer cards, discover and this dossier all read the same observation claims. Deleting observations (a retention job, which does not exist yet, or removing a role) turns the contacts they attributed into unattributed ones, which a multi-company person then stops showing. Any retention policy for observations must account for that.

**Running the concurrency tests.** `people-review-concurrency.integration.spec.ts` needs a real PostgreSQL (the hermetic suite's PGlite runs one transaction at a time) and is skipped unless `ORION_TEST_PG_ADMIN_URL` is set to a LOCAL server URL without a database name (for example `postgres://user:pass@localhost:5432`). It creates and drops its own `orion_p15_*` database and refuses non-local hosts. It holds the person lock from a side connection, waits (by polling `pg_locks`, not by sleeping) until each action is queued on it, then releases it, so each pair of actions runs in a known order; an action that does not take the lock never queues and fails the test.
