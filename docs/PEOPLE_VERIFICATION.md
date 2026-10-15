# People verification (Phase 5)

> **APPROVAL != VERIFICATION.**
> *Approval* means an internal reviewer has reviewed a role and permits publication (`company_people.review_status`,
> `is_published`). *Verification* means a specific claim is supported by specific evidence, decided by a named reviewer - or relayed
> by the system from a source - at a known time. They are separate decisions with separate audit entries. Verifying never
> publishes anything; approving never verifies anything.

**How to read this document.** Sections marked *TECHNICAL GUARANTEE* describe behaviour the code and tests enforce regardless of any number. Section 8 is
**PROVISIONAL BUSINESS POLICY**: engineering placeholders that need product / data-quality sign-off and must not be treated as permanently approved.

Related: `PEOPLE_INGESTION.md` (acquisition), `PEOPLE_REVIEW_WORKFLOW.md` (approval), `DECISION_MAKER_INTELLIGENCE.md` (customer contract).

## 0. Technical guarantees (independent of the policy numbers)

| Guarantee | Enforced by |
| --- | --- |
| **Evidence-backed**: a claim is verified only with cited evidence of an accepted type for that claim; format validity (regex, E.164, URL shape) verifies nothing; a claim's own upload evidence never verifies it | `resolveEvidence`, `ACCEPTED_EVIDENCE`, 12+ rejection tests |
| **Attributable**: every ledger row says what, who (reviewer, or SYSTEM with `attested_by`), when, why (required note) and on which evidence row; SYSTEM rows can never carry a human id (DB check) | ledger columns + `people_verifications_system_no_human_chk` |
| **No downgrade**: ingestion never removes or weakens a ledger decision; weaker/equal evidence never replaces stronger; a dispute is not cleared by a re-upload; only an explicit reviewer action, a change of the verified value, or age moves a claim off *Verified* | `recordSystemAttestation`, `verify`, transition tests |
| **Single source of truth**: status columns are derived from the ledger and written only by `reconcileRole` / `reconcileContact` / `rollupPersonVerification` | structural writer test + invariant checker in 4 suites |
| **Auditability**: verify / dispute / needs-review are audited in the same transaction, without contact values | `writeAudit`, audit tests |
| **Concurrency safety**: per-claim advisory lock + `ON CONFLICT DO NOTHING`; one creator, others `ALREADY_VERIFIED`, no 500 | concurrency tests |
| **Role / title history**: the role keeps its id across title edits; earlier titles resolve to it via `title_aliases`; a changed verified value becomes *Needs review* and the old decision stays as history | review + verification tests |
| **Customer isolation**: customers get 403 on every verification route and never receive verifier identity, evidence references, notes, dispute reasons, fingerprints, attestation metadata or contact digests; a verified-but-unapproved role stays invisible | RBAC + leakage tests, and the live checks in section 12 |
| **Approval != verification**: verification never writes publication columns; approval never verifies | structural test + tests |

## 1. Existing model (audited before Phase 5)

| Concept | Where |
| --- | --- |
| Person | `people`: identity (`normalized_name`, `name_aliases`, `normalized_linkedin_url`), `data_status` DRAFT/PUBLISHED/SUPPRESSED, and a status/confidence roll-up |
| Company-person relationship + role | `company_people` (one row per company + person + current title; stable id) |
| Role title / aliases | `job_title_at_company` (display), `normalized_job_title` (identity key), `title_aliases` (earlier titles, so re-ingesting an old title resolves to the same role) |
| Contact | `person_contacts` (WORK_EMAIL / PHONE / MOBILE), own status and `is_published` |
| Evidence | `people_evidence` (scoped to person / role / contact; `verified_at` = "counts as verified"; deduplicated by fingerprint) |
| Review state | `company_people.review_status` + `is_published` (published => APPROVED) |
| Quarantine | `people_ingestion_quarantine` |

## 2. Source of truth (one rule, no divergence)

| Column | Kind | Rule |
| --- | --- | --- |
| `people_verifications` (ledger) | **authoritative** | Evidence-backed history: what, who, when, why, on which evidence. Only reviewer verification/dispute and system attestation write it. |
| `company_people.verification_status` | **derived** | Written only by `reconcileRole()` from the TITLE and RELATIONSHIP ledger rows for the role's *current* values. |
| `person_contacts.verification_status` | **derived** | Written only by `reconcileContact()` from the contact's EMAIL/PHONE row for its *current* value. |
| `people.verification_status`, `confidence_score`, `last_verified_at` | **derived roll-up** | `rollupPersonVerification()` (CONFLICTED if any role is, else the strongest role). |
| `company_people.confidence_score`, `person_contacts.confidence_score` | operational, monotonic | Source-supplied score, raised to the policy floors (section 8) by verification; never lowered by it. |
| `last_verified_at` (role/contact) | operational, monotonic | Latest supporting ledger verification time (or a source-supplied date); required whenever the status is VERIFIED/PARTIALLY_VERIFIED. |
| `people_evidence.verified_at` | evidence fact | "This evidence counts": set when a reviewer cites it, or by the source. |
| `review_status`, `is_published`, `people.data_status`, `person_contacts.is_published` | **publication / approval** | Owned by `PeoplePublishingService`; verification never writes them. |
| `verification_status` inside customer responses | derived at read time | `effectiveVerification()` (needs verified evidence + date; STALE after 365 days). |

Derivation (`policies/claim-verification.policy.ts`, time-independent because a column cannot age by itself):

* Role: any of TITLE/RELATIONSHIP **disputed** => `CONFLICTED`; both verified => `VERIFIED`; one => `PARTIALLY_VERIFIED`; else `UNVERIFIED`.
* Contact: verified => `VERIFIED`; disputed => `CONFLICTED`; else `UNVERIFIED`.

Every code path that changes a ledger row, or a value a ledger row is about (ingestion, reviewer verify/dispute, reviewer edit of a title, name or contact
value), ends by calling `reconcile*`. Legacy columns are not deleted; a legacy status with no ledger backing is normalised to what the ledger supports the
next time the role is touched. Tests: an independent invariant checker (`__tests__/ledger-invariants.ts`) runs after the verification, review, ingestion
and upload suites; a structural test asserts that only `verification-state.ts` and `people-rollup.ts` write `verificationStatus`.

## 3. Ingestion-attested verification

Roles/contacts that a **source** reports as verified (Phase 2 `verification` block with verified evidence) are recorded in the ledger as **SYSTEM** events:

| Field | Value |
| --- | --- |
| `verified_by_kind` | `SYSTEM` (DB check: a SYSTEM row can never carry `verified_by_id`) |
| `method` | `INGESTION_ATTESTED` (or `LEGACY_BACKFILL` for the migration) |
| `verified_by_label` | `system:ingestion` / `system:legacy-backfill` (never a person) |
| `attested_by` | the source type that attested it (e.g. `GOVERNMENT_REGISTRY`) |
| `verified_at`, `evidence_id`, `note` | the evidence's verification time, the evidence row, and a note saying *no reviewer involved* |

Mapping (explicit policy): role `VERIFIED` => TITLE + RELATIONSHIP claims; role `PARTIALLY_VERIFIED` => RELATIONSHIP only; contact `VERIFIED` (with verified
contact evidence) => EMAIL/PHONE; contact `PARTIALLY_VERIFIED` has no claim to map to and is reported (`CONTACT_PARTIAL_VERIFICATION_NOT_RECORDED`), not invented.
`CONFLICTED` from a source => SYSTEM `DISPUTED`. `STALE` input is ignored (staleness is computed from dates). A claim with no verified evidence is refused
(`VERIFICATION_CLAIM_WITHOUT_EVIDENCE`, `CONTACT_VERIFICATION_WITHOUT_EVIDENCE`).

Rules: a system attestation **never overwrites** an existing decision; a source conflict report may flip an earlier SYSTEM attestation but is **ignored with a warning**
(`CONFLICT_REPORT_IGNORED_REVIEWER_DECISION`) against a reviewer's decision; a reviewer can take over a system attestation with evidence at least as strong
(outcome `UPGRADED`, row becomes REVIEWER). The customer API returns none of `verified_by_kind`, `method`, `attested_by`, labels or notes, and its copy
("Verified against evidence") never claims a human review (tested).

Migration `0008` backfills the same kind of SYSTEM events for verifications already stored (only those backed by verified evidence), so ledger and columns agree from day one.

## 4. Claim storage model and privacy analysis

`people_verifications`: one row per (`target_key`, `claimed_value`); a changed value adds a row and the old one stays as history.

| Claim | Current value lives in | Verification state lives in | `claimed_value` stored | Why | Deletion / cascade | Customer exposure risk |
| --- | --- | --- | --- | --- | --- | --- |
| Identity | `people.normalized_name` | ledger `IDENTITY:<person>` | normalised name (cleartext) | needed to show "was X" after a correction; already the public role identity | cascades with the person | none: ledger never returned |
| Company relationship | `company_people.business_id` | ledger `RELATIONSHIP:<role>`; derives role status | company id | change detection only | cascades with role/person | none |
| Title | `company_people.normalized_job_title` | ledger `TITLE:<role>`; derives role status | normalised title (cleartext) | shows previous title; not sensitive | cascades with role/person | none |
| Email | `person_contacts` row | ledger `EMAIL:<contact>`; derives contact status | **digest only** (`h:` + sha256) | value stays only in `person_contacts`; digest detects in-place edits | cascades with contact/person | none: no value, and values are never in audit rows either |
| Phone | `person_contacts` row | ledger `PHONE:<contact>` | **digest only** | same | same | same |
| LinkedIn | `people.linkedin_url` | ledger `LINKEDIN:<person>`; the customer "LinkedIn verified" flag reads PROFESSIONAL_PROFILE evidence | **digest only** | same | cascades with person | same |

The digest is a change detector, not a secret (low-entropy phone numbers can be guessed), but it adds no information beyond the contact row it points to and keeps
cleartext contact data out of a second table, exports and audit logs. No encryption or new infrastructure was needed. Reviewer edits of a contact value in place
now go through `reconcileContact`, so an edited (previously verified) contact is immediately *Needs review* / UNVERIFIED.

## 5. Evidence rules

Format checks are validation, not verification. Accepted evidence types per claim are in `ACCEPTED_EVIDENCE` (identity/relationship/title: registry filing, document,
direct confirmation, company website, professional profile; email: direct confirmation, delivery check, website, registry, document; phone: direct confirmation, website,
registry, document; LinkedIn: professional profile). Ingestion-created types (`UPLOAD_ROW`, `ROLE_CLAIM`, `IDENTITY_CLAIM`, `CONTACT_CLAIM`) never verify what they claim.
Reviewers supply exactly one of `evidenceId` (same subject) or new `evidence` (with a reference or URL, not in the future) plus a note. Evidence is fingerprint-deduplicated.

## 6. State transitions (deterministic)

States are computed from the ledger (`claimState`); `Stale` only at read time.

| From | Event | To |
| --- | --- | --- |
| Unverified | valid evidence + note | **Verified** |
| Unverified | invalid / missing evidence | Unverified (4xx, nothing written) |
| Verified | value edited (title, name, contact value) | **Needs review** (audited `PEOPLE_CLAIM_NEEDS_REVIEW`; role status recomputed) |
| Needs review | value edited back to the verified one | **Verified** (the earlier evidence still stands) |
| Needs review | verify the new value | **Verified** (old row kept as history) |
| Verified | 365+ days pass | **Stale** (columns keep the last derived status; customers see STALE via `effectiveVerification`) |
| Stale | fresh valid evidence | **Verified** (`REFRESHED`) |
| Verified | weaker/equal evidence | Verified, unchanged (`ALREADY_VERIFIED`) |
| Verified | stronger evidence | Verified, basis upgraded (`UPGRADED`), earlier evidence kept |
| Verified (system) | reviewer evidence >= strength | Verified by reviewer (`UPGRADED`) |
| Verified / Unverified | reviewer dispute | **Disputed** (role/contact => CONFLICTED) |
| Disputed | re-upload / source re-report | **Disputed** (ingestion cannot clear it) |
| Disputed | verify with invalid evidence | Disputed (400) |
| Disputed | verify with valid evidence | **Verified** (`DISPUTE_RESOLVED`) |
| Verified (system) | source conflict report | Disputed |
| Verified (reviewer) | source conflict report | Verified + warning |

## 7. Concurrency

Verification, dispute and system attestation take a per-claim transaction advisory lock (`pg_advisory_xact_lock(hashtext(target_key))`) and insert with
`ON CONFLICT (target_key, claimed_value) DO NOTHING`; on a lost race they re-read the winner and continue as `ALREADY_VERIFIED` (or upgrade). Evidence rows use the
fingerprint unique index the same way. Result: one creator, others `ALREADY_VERIFIED`, one audit row, one evidence row, no 500, no partial transaction. Tests: two
simultaneous requests, and the exact failure window (the existence check sees nothing while the row exists). Note: PGlite serialises transactions, so the parallel
test cannot exhibit true parallelism; the window test reproduces the failure deterministically and the locking is standard PostgreSQL behaviour.

## 8. PROVISIONAL BUSINESS POLICY (all values in `policies/claim-verification.policy.ts` / `people.constants.ts`)

> **These values are provisional.** They are engineering placeholders chosen to make the model work and testable. They require product / data-quality
> sign-off before being treated as approved business policy, and may change without affecting any technical guarantee in section 0.
> Provisional today: confidence floors 70 / 85 / 80; evidence strengths 3 / 2 / 0; the 365-day freshness period; the ingestion-attestation mapping
> (VERIFIED => TITLE + RELATIONSHIP, PARTIALLY_VERIFIED => RELATIONSHIP only).


| Value | Meaning | Used by | Nature |
| --- | --- | --- | --- |
| `CONFIDENCE_FLOOR.ROLE_ONE_CLAIM = 70` | a role with exactly one of TITLE/RELATIONSHIP verified is at least this confident | `reconcileRole` | **business policy** (needs sign-off) |
| `CONFIDENCE_FLOOR.ROLE_BOTH_CLAIMS = 85` | both verified | `reconcileRole` | business policy |
| `CONFIDENCE_FLOOR.CONTACT = 80` | a contact with a verified EMAIL/PHONE claim | `reconcileContact` | business policy |
| (identity, LinkedIn) | raise no score | - | by design |
| `EVIDENCE_STRENGTH` (registry/document/direct = 3; website/profile/delivery check = 2; anything else 0) | ranking used only to stop weaker evidence replacing stronger; decides `UPGRADED` vs `ALREADY_VERIFIED` | `verify` | business ranking |
| `VERIFICATION_STALE_AFTER_DAYS = 365` | age after which a claim is Stale (reviewers) / STALE (customers) | `claimState`, `effectiveVerification`, search | business freshness rule |
| `CONFIDENCE_MEDIUM_MIN = 40`, `CONFIDENCE_HIGH_MIN = 75` | display bands | `confidenceLevel` | business policy, not part of verification |
| `ATTESTED_ROLE_CLAIMS` | how a source-attested role status maps to claims | ingestion | business policy (provisional) |

Below a floor nothing happens: confidence keeps whatever the source supplied (it is never lowered or invented). Unverified/conflicted data is capped by `confidenceLevel` for display.

## 9. Reviewer workflow, RBAC, audit, customers

Unchanged from the earlier Phase 5 core: `GET/POST internal/people-verification/roles/:id[/verify|/dispute]`, panel embedded in the review detail; SUPER_ADMIN/ADMIN write,
DATA_MANAGER read-only (403 on write, explicit), customers 403, anonymous 401, nothing on customer controllers. Audit actions `PEOPLE_CLAIM_VERIFIED`, `PEOPLE_CLAIM_DISPUTED`,
`PEOPLE_CLAIM_NEEDS_REVIEW` in the same transaction, with reviewer, previous/new state, evidence reference and ids - and **no contact values** (ids only). The Admin People Review drawer
keeps its Verification section (it now also receives `verifiedByKind`, `method`, `attestedBy`; the UI is unchanged and browser-untested).

## 10. Migration `0008_people_verification`

Additive and idempotent; `0004`-`0007` are untouched (a test asserts they do not mention Phase 5). Contents: `company_people.title_aliases` (moved here from `0007`), the
`people_verifications` table (5 checks, 5 foreign keys, 1 unique + 2 lookup indexes), and the SYSTEM backfill described above (insert-only, `ON CONFLICT DO NOTHING`).
Validated on disposable PGlite: clean database -> all migrations; database at 0007 with people -> 0008 (existing rows unchanged, backfill correct); second run applies nothing;
SQL re-executes safely. Not applied to Neon/production. Deploy 0004-0008 before the API.

## 11. Known limits

* Provider enrichment, scraping, government APIs and automated discovery are out of scope; evidence is entered by reviewers or relayed by sources.
* A source-provided `verifiedBy` name is validated by ingestion but not stored (the source *type* is recorded as `attested_by`).
* Source-attested evidence typed as a plain claim (`ROLE_CLAIM`) has strength 0, so any reviewer evidence can supersede it.
* Bulk verification, notifications, per-claim expiry overrides: not built.

## 12. Final validation record (Phase 5)

Environment: disposable only. A Nest process running the real People controllers and guards on an in-process PGlite database built from migrations 0000-0008, with the Next
dev server pointed at it; the gateway's database URL was a dummy address, so nothing could reach Neon. PGlite is the real PostgreSQL engine; a server-based or SSL-enabled
staging PostgreSQL could not be provisioned here (no PostgreSQL install, container runtime not running), and the gateway's database helper always uses SSL, so the real
customer *pages* (which load company data through the gateway's own database connection) were not used. The rig and its tokens were deleted afterwards.

* **Reviewer UI (real Admin People Review, real browser):** opened a role, inspected the claims, verified a claim with a filing reference and note (state, verifier, date, evidence and note shown),
  disputed it (a reason is required; role became CONFLICTED), resolved the dispute (empty citation refused; valid evidence => Verified), edited the verified title (=> Needs review, role
  status recomputed, "was ..." shown), and verified the new title. Seeded roles showed every state: Unverified, Verified, Needs review, Stale, Disputed, plus a system-attested claim shown as
  "Verified by system:ingestion". Finding fixed: the company-relationship row showed the raw company id; it now shows the company name (API-level test).
* **Admin authentication:** the real OTP login was **not** performed (it needs a mailbox on the admin domain). The rig placed a locally minted token, signed with a throw-away secret, in the
  browser; the API enforced its real guards on every call. Treat admin login as an external validation dependency.
* **Customer UI (existing `CompanyPeopleSection` component, temporary isolated page, real API contract):** only the approved role was visible; pending, rejected, quarantined and suppressed people
  were hidden; the unpublished mobile number was "Not available"; the published email was "Locked" until the confirmed unlock, which then revealed only the published email (existing credit behaviour).
  Scans of the customer list and detail responses (also after a dispute with a private reason) found no verifier identity, evidence references, notes, dispute reason, fingerprints,
  ledger fields, system-attestation metadata or unpublished contact values.
* **Security (live, through the gateway):** ADMIN and SUPER_ADMIN: read/verify/dispute 200. DATA_MANAGER: read 200, verify/dispute 403. CUSTOMER: 403 on all (and on the review API). Anonymous: 401. Malformed id: 400.
