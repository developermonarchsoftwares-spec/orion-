# Customer People contract (Phase 6.11)

Customer-facing People endpoints: `GET companies/:id/people`, `GET people/:personId`, `POST people/:personId/unlock`, `GET people/unlocked`, `POST people/export`, `GET people/taxonomy`; plus person summaries in saved leads and the people filters of discover search. All require a customer login; data is scoped to the caller (`person_unlocks`, `saved_leads` by user id).

## Visibility
A role is visible only when it is `is_published` **and** `review_status = 'APPROVED'`, its person is `PUBLISHED` (never draft, suppressed or hidden) and its company is `PUBLISHED`. One definition (`CUSTOMER_VISIBLE_ROLE`) is used by the list, detail, unlock, unlocked list and export; the search predicate, the web route's search predicate and saved leads apply the same approval rule. Hidden people, unpublished companies and missing ids return the same 404 shape.

## Contacts
Only reviewer-published contacts exist for customers. Values are `null` until the caller unlocked the person (credits, idempotent); then only published values are returned, only to that caller. Another customer still sees them locked. Export includes only the caller's own unlocked, still-visible people; other ids are counted as skipped, never revealed.

## Contacts belong to a company on a company card (Phase 10B)
Contacts are stored per person, but a card is for one company, so it shows only contacts that company's relationship reported (`people-contact-attribution.ts`, from the import's observation claims; no schema change).
* A contact reported for a company may show on that company's cards; reported by several companies, on each of them.
* A contact reported only for other companies never shows there, and there is no fallback: a company that reported no contact shows none.
* A contact with no attribution (reviewer-added, or from a source that records no observation) is never guessed into a company. Exception: a person with exactly one company (any role state) keeps it, since it cannot belong to anyone else; it stops showing the moment the person gets a second company.
* Existing primary / confidence selection applies only within the eligible contacts. Applies to the company list, `roles[]` of person detail, the unlock response, the unlocked list and export (one row per company role).
* Person detail's top-level `contacts` stay person-level: the best contact among those eligible at some visible company. Unlock stays per person and never charges when no visible company can show a contact or LinkedIn. Discover's "decision-maker contact" filter uses the same rule. LinkedIn is unchanged.
* "One company" counts distinct companies the person has a role at, in ANY state (pending, rejected, quarantined, unpublished, former, company not published). Only removing that relationship returns the person to the single-company case; a second role at the same company is not a second company. This is deliberately fail-closed.
* Person detail's top-level `contacts` stay person-level, but only over contacts eligible at a company that is visible to the customer: a contact belonging only to a hidden (unpublished, rejected or unpublished-business) company never appears there. When no company is visible the person is a 404.
* Unlock never charges unless a visible company can show a contact (or LinkedIn); the same rule is re-checked inside the unlock transaction. The discover decision-maker-contact filter is the same rule in SQL (parity tested).
* LinkedIn stays person-level and is not attributed to a company.
* Limits: manual contacts on multi-company people are hidden until a future attribution mechanism exists; contacts imported before observations were recorded behave as unattributed (shown only for one-company people, hidden for multi-company people, never assigned to a company).

## The card (one shape everywhere)
`id` (public person id), `businessId`, `fullName`, `jobTitle`, `additionalRoles`, `department`, `seniority`, `decisionMaker`, `isCurrent`, `startDate`, `endDate`, `location`, `verification` (`status`, `assertion`, `lastVerifiedAt`, `confidence`), `evidence` (**counts only**: `count`, `verifiedCount`), `relevance`, `contacts` (`isUnlocked` + per type `available`, `verificationStatus`, `value`), `isSaved`, `unlockCostCredits`. Person detail adds `roles[]` (cards + `business`), `contacts`, `location`.

Removed in 6.11 because they are internal: `companyPersonId` (role row id), `evidence.sourceTypes` (source provenance) and the person detail's `evidence[]` list (source type, evidence type, observed / verified dates). The web UI no longer shows source names.

Never exposed: source key / version / URL / reference, evidence rows, observation or claim ids, reviewer or audit data, review state, conflict / quarantine / suppression data, digests, classification version / rule ids, freshness internals, contact or evidence ids.

## Verification
Unchanged semantics (`effectiveVerification`): status, assertion level, last verified date and confidence only. A `CONFLICTED` status is shown as that status with no reason or conflict data.

## Errors
Customer errors are generic. The global filter now returns the raw text of an unexpected error only when `NODE_ENV` is `development` or `test` (previously anything but `production`, so an unset value leaked); 5xx details are removed otherwise; the echoed `path` no longer includes the query string.

## Tests
`people-customer-contract.integration.spec.ts`: positive and negative visibility, locked / unlocked values, tenant isolation, export scope, exact response keys, deep scan of every response for forbidden keys, values and internal ids, verification semantics, error shapes and filter hardening.

## Known limits
LinkedIn is a person attribute: it is offered (and revealed on unlock) whenever the person is visible, without a separate publish step. Contacts published after a customer unlocked a person become visible to that customer without a new charge. Both are existing behaviours, left unchanged.
