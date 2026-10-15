# Decision Maker Intelligence (People layer): Phase 1

Customer-facing foundation: **Company → Relevant People → Decision Maker → Contact → Evidence**.

This phase adds the data model, read APIs, unlock/credits, save, export, search filters and UI.
It does **not** collect people data. There is no scraping, enrichment, government-API or upload
integration; the upload pipeline is untouched and will feed this layer in Phase 2.

> Phase 2 (ingestion, quarantine, role-level publishing) is documented in `PEOPLE_INGESTION.md`.

## 1. Architecture at a glance

```
Phase 2 pipeline (not built)                      Customer-facing (this phase)
────────────────────────────                      ─────────────────────────────────────────
upload → clean → dedupe → resolve                 Next.js gateway  ──proxy──▶  NestJS API
   → people enrichment → verify → publish              (unknown routes fall through)   │
            │                                                                          ▼
            ▼  IPeopleIngestionPort                     GET  /companies/:id/people   PeopleService
   PeopleWriteService  ───────────▶  people ◀───────    GET  /people/:id             PeopleUnlockService
   (classify · dedupe · clamp)       company_people     POST /people/:id/unlock      PeopleExportService
                                     person_contacts    POST /people/export          PeopleSearchService
                                     people_evidence    GET  /people/taxonomy
                                     person_unlocks     GET  /people/unlocked
```

Everything reuses existing infrastructure: JWT auth guard, `CreditService.deductCredits` and the
`credit_transactions` ledger (type `UNLOCK_LEAD`), `saved_leads`, `businesses`, the
`data_source_type` enum, `CsvSecurityUtil`, and the discover search.

## 2. Database (migration `0004_decision_maker_people`)

| Table | Purpose |
|---|---|
| `people` | A real-world person, independent of any company. Name, normalised name, LinkedIn (+ canonical form, unique), location, `data_status` (`DRAFT`/`PUBLISHED`/`SUPPRESSED`), verification status, confidence 0–100, seen/verified timestamps. |
| `company_people` | The role: person ↔ business. Raw title, normalised title, `department`, `seniority_level`, `decision_maker_type`, `is_current`, dates, verification, confidence. Unique `(business, person, normalized_job_title)`. |
| `person_contacts` | Contact points (`WORK_EMAIL`, `PHONE`, `MOBILE`) with normalised value, `is_published`, verification, confidence, source. Unique `(person, type, normalized_value)`. |
| `people_evidence` | Evidence for a role, a contact, or the person: `source_type` (existing enum), `evidence_type`, internal `source_url`, `observed_at`, `verified_at`, confidence. |
| `person_unlocks` | `(user, person)` unlock ledger, unique per pair. Credits are charged in the normal wallet. |
| `saved_leads.person_id` | New nullable column: a person-at-company lead is a `saved_leads` row with `person_id` set. No second lead concept. |
| enum `person_verification_status` | `UNVERIFIED`, `PARTIALLY_VERIFIED`, `VERIFIED`, `STALE`, `CONFLICTED`. |

Design decisions:

* Job title, seniority, department and decision-maker type live on the **role**, not the person,
  because a person can hold different roles at different companies.
* Contacts are their own table (a person can have several; each has its own verification).
* Personal email is deliberately **not modelled**.
* Confidence is stored as a score; the LOW/MEDIUM/HIGH level is derived, not duplicated.
* Taxonomy columns are `varchar` (not pg enums) so the mapping can evolve without `ALTER TYPE`.
* Migration is additive and idempotent (`IF NOT EXISTS`, guarded FK/type creation), has FKs with
  `ON DELETE CASCADE`, check constraints, and partial unique indexes.
  `saved_leads` only gains a nullable column, so existing rows and code paths are unaffected.
  Numbering: `0003_seed_packages.sql` is a manual seed that is not in Drizzle's journal, so the
  new file is `0004` at journal index 3, with snapshot `meta/0004_snapshot.json`.

**Deploy order:** run the migration *before* deploying the API. `saved_leads` queries now select
`person_id`.

## 3. Role classification

`modules/people/classification/`

* `taxonomies/v1.ts` – the rules as data (aliases, department keywords, seniority patterns, functional decision-maker rules:
  department + minimum seniority), **versioned and immutable** (Phase 6.5, see `PEOPLE_CLASSIFICATION_VERSIONING.md`).
  To change how titles are interpreted add `v2.ts`; never edit `v1.ts`.
* `role-taxonomy.config.ts` – labels and customer search phrases (presentation, unversioned) plus read-only views of v1.
* `role-classifier.ts` – pure `classifyRole(rawTitle)` → `{ normalizedTitle, seniorityLevel, department, decisionMakerType, relationshipType, taxonomyVersion, ruleTrace, ruleId, strength }`.
* `role-classification.service.ts` – `RoleClassificationService`, the injectable boundary used by the writer and the review service.

| Raw title | Seniority | Department | Decision-maker type |
|---|---|---|---|
| Founder & CEO | EXECUTIVE | EXECUTIVE | FOUNDER_CEO |
| Head of Procurement | HEAD | PROCUREMENT | PROCUREMENT_DECISION_MAKER |
| Sales Director | DIRECTOR | SALES | SALES_DECISION_MAKER |
| Purchase Manager / HR Manager | MANAGER | PROCUREMENT / HR | (decision maker: these functions own buying/hiring) |
| Sales Manager, Software Engineer | MANAGER / STAFF | – | none |

Not every company has the same structure: a role is a decision maker only if the taxonomy says
that department + seniority qualifies. To change behaviour, add a new taxonomy version (data), not code paths.
The Phase 2 pipeline must call the same classifier (`PeopleWriteService` uses `RoleClassificationService`).

## 4. Verification, confidence, evidence

* Stored status is never trusted on its own. `effectiveVerification()` (`policies/verification.policy.ts`):
  * `VERIFIED` / `PARTIALLY_VERIFIED` count only with **role-scoped evidence that has `verified_at`** and a
    `last_verified_at`; otherwise they are reported as `UNVERIFIED`.
  * A verification older than 365 days is reported `STALE`.
  * `CONFLICTED` stays `CONFLICTED`.
* `PeopleWriteService` also clamps at write time (a claimed `VERIFIED` without verified evidence is stored `UNVERIFIED`).
* Person-level evidence (e.g. a profile page) does **not** verify a role at a company.
* UI wording: **Known** (verified), **Likely** (partially verified), **Unverified** (everything else).
  Decision-maker claims read “Decision maker · …”, “Likely decision maker · …”, “Unverified role · …”.
* Confidence level: score < 40 LOW, < 75 MEDIUM, otherwise HIGH; capped at MEDIUM for
  unverified/stale data and LOW for conflicted data.
* Evidence `source_url` is internal and never returned to customers.

## 5. Contact visibility and credits

* A role is visible only when the company is `PUBLISHED`, `people.data_status = 'PUBLISHED'` **and** `company_people.is_published = true` (added in Phase 2, see `PEOPLE_INGESTION.md`).
  A contact point is ever revealed only when `person_contacts.is_published = true`.
* **Locked** response: for each of email / phone / mobile / LinkedIn the API returns
  `{ available, verificationStatus, value: null }`. There is no masked string; the value is not in
  the payload at all. Enforcement is in `PeopleService.toCard`, not the frontend.
* **Unlock** `POST /people/:id/unlock`: 1 credit (`PERSON_UNLOCK_COST_CREDITS`) through
  `CreditService.deductCredits` in one transaction with the `person_unlocks` insert
  (ledger type `UNLOCK_LEAD`, `reference_id` = person id, description “Unlocked contact: …”).
  * Repeat unlock: free, returns `alreadyUnlocked: true`. Concurrent requests: charged once
    (unique index + rollback on conflict).
  * Insufficient credits: `402`, nothing created.
  * No published contact data: `409 NO_CONTACT_AVAILABLE`, not charged.
* Unlocking a *company* (`lead_unlocks`) does **not** unlock its people; the two are separate purchases.
* Unlocks are per user. Suppressing a person hides them everywhere, including for past buyers.

## 6. API

All require a valid JWT.

| Method & path | Notes |
|---|---|
| `GET /companies/:businessIdOrSlug/people` (alias `/company/...`) | Filters: `q`, `department`, `seniority`, `decisionMakerType` (comma lists), `decisionMakersOnly`, `status=current\|former\|all` (default current), `verification` (effective status list), `location`, `hasContact`, `page`, `limit`. Returns `{ business, summary, facets, people, pagination }`, decision makers first. A person with several roles at a company appears once (`additionalRoles`). |
| `GET /people/:id` | Person across all published companies, contacts locked unless unlocked, sanitised evidence. |
| `POST /people/:id/unlock` | See §5. |
| `GET /people/unlocked` | The caller’s unlocked people. |
| `POST /people/export` | Body `{ personIds? }` → CSV. Only people the caller unlocked; others are silently dropped (`X-Export-Skipped-Locked`). Fields: Company, Person, Job Title, Department, Seniority, Decision Maker Type, Role Status, Email, Phone, Mobile, LinkedIn, Location, Verification Status, Confidence, Last Verified. Formula-injection safe. No credits charged (consistent with the existing unlocked-lead export). |
| `GET /people/taxonomy` | Departments, seniority levels, decision-maker types (labels for filter UIs). |
| `POST /saved-leads` | Now accepts `personId` (with `businessId`) to save a person-at-company. Company and person leads coexist. |

## 7. Search

`/discover/search` accepts `decisionMakerType`, `hasDecisionMaker`, `hasVerifiedDecisionMaker`,
`hasDecisionMakerContact`, and understands phrases in `q`, e.g. “Companies in Coimbatore with a
Founder/CEO”, “Companies with a Head of Procurement”, “Companies with Sales Directors”,
“Companies with verified decision makers”. People-filtered searches run on PostgreSQL
(the Typesense index has no people data). The Postgres search path now also honours
`state/district/city/pincode`, which it previously ignored.

The customer UI is served by the Next.js gateway (`app/api/v1/[...path]/route.ts`, `handleDiscoverSearch`),
which builds its own SQL and returns a different item shape. It therefore accepts the **structured**
params above (same rules, same SQL semantics). Phrase parsing lives only in the NestJS endpoint.
The discover page sends the params when chips with values `has_decision_maker`,
`verified_decision_maker` or `decision_maker_contact` are enabled in the admin quick-filter config.
They are not enabled by default because there is no people data yet.

## 8. UI

Company detail page (`discover/[id]`) now has **Overview | People** tabs. The People tab
(`components/people/company-people-section.tsx`) has search, department / seniority / decision-maker
type / verification / role-status filters, “Contact available” and “Decision makers only”,
summary tiles, person cards (title, department, seniority, Known/Likely/Unverified claim,
per-channel lock + verification, confidence, last verified, relevance line), expandable profile,
Save, Unlock (confirm dialog showing cost and balance), and “Export unlocked”. Existing design
tokens and patterns are reused. Empty states never imply data exists.

## 9. Phase 2 contract

`modules/people/contracts/people-ingestion.contract.ts` – `IPeopleIngestionPort` (Nest token
`PEOPLE_INGESTION_PORT`, exported by `PeopleModule`):

```ts
upsertPersonForBusiness({
  businessId,
  person: { fullName, linkedinUrl?, city?, state?, country?, photoUrl? },
  role:   { jobTitle, isCurrent?, startDate?, endDate?, relationshipType? },
  contacts?: [{ type: 'WORK_EMAIL'|'PHONE'|'MOBILE', value, isPublished?, verificationStatus?, lastVerifiedAt?, ... }],
  evidence?: [{ sourceType, evidenceType, verifiedAt?, sourceUrl?, scope?: 'ROLE'|'PERSON'|'CONTACT', contact? }],
  verificationStatus?, confidenceScore?, lastVerifiedAt?,
  dataStatus?: 'DRAFT'|'PUBLISHED'   // default DRAFT: invisible to customers
}) → { personId, companyPersonId, personCreated, roleCreated, contactsCreated, evidenceCreated, storedVerificationStatus }
setDataStatus(personId, 'DRAFT'|'PUBLISHED'|'SUPPRESSED')
```

It classifies the title, resolves the person (LinkedIn → shared contact **and** same name → same name at
the same company), dedupes roles and contacts, and clamps unbacked verification claims. Mapping to the
pipeline stages: cleaning/normalisation → `person`/`role` fields; dedup/entity resolution → handled here;
enrichment → `contacts`/`evidence`; verification → `verificationStatus` + `evidence.verifiedAt`;
publishing → `dataStatus: 'PUBLISHED'` and `contacts[].isPublished`.

## 10. Testing

* `apps/api`: `npm test` (Jest). The people suites include a real-database suite that builds an
  in-process PostgreSQL (PGlite) **from the actual migration files**, so constraints, partial unique
  indexes, cascades and idempotency are exercised without touching any shared database.
  The script runs Jest with `--experimental-vm-modules` (required by PGlite).
* `ownus`: `npm test` (Node test runner) covers the UI helpers.
* The existing `test:e2e*` specs require the configured database and were **not** run in this phase.

## 11. Known limitations

* No people data exists until Phase 2; the tab shows an honest empty state.
* NL phrase parsing exists only on the NestJS search endpoint, not the gateway search.
* People-filtered search does not use Typesense or the Orion score ordering.
* Company list holds at most 500 roles per company in memory (filters/grouping are applied in code).
* `admin_otps` and `queue_jobs` tables exist in the Drizzle schema but were never in any migration or
  snapshot (pre-existing); the generated 0004 snapshot therefore includes them. Fresh databases built
  purely from migrations will lack those two tables.
