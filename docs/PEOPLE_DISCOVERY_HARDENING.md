# Customer discovery & search hardening (Phase 6.15)

Audit of every customer discovery path and what changed. Built on the Phase 6.11 contract; no provider, scoring or ranking was added.

## Paths audited
Discover search (`GET discover/search`: search index first, PostgreSQL when the index is unavailable **or any decision-maker filter is used**), business detail, related companies, suggestions, company People list, person detail, unlock, unlocked list, People export, saved leads, and the web route's search predicate.

## Visibility (one rule)
A role is searchable / listable only when it is published **and** approved, its person is `PUBLISHED`, and its company is `PUBLISHED`. People filters, counts, facets, summaries, pagination, export and saved-lead person summaries all use it. Hidden, rejected, pending and suppressed roles and draft companies cannot be reached through any filter combination, count, page or export (tested, including a role that is unpublished / suppressed and then disappears).

## Filters (PostgreSQL path)
decision-maker type / has decision maker / verified decision maker (customer-safe verification: `VERIFIED`, verified evidence, inside the existing staleness window) / decision maker with a **published** contact; state, district, city, pincode (case-insensitive); name; industry, category, type, MSME category, tier. **New:** `hasEmail`, `hasPhone`, `hasWebsite`, `hasGstin`, `minOrionScore`, `maxOrionScore` were silently ignored on this path (the index supports them); they are now applied, and `contactAvailability` is computed from data (website, GSTIN were constants). Company People list: department, seniority, decision-maker type, verification, location, title/name text, current/former, has contact.

## Changes
* **Deterministic order:** the PostgreSQL search had no ORDER BY (LIMIT/OFFSET unstable). Now `sortBy` (`name:asc|desc`, `created_at:asc|desc`; anything else = default), then name, then id. People list order gained id / company / title tie-breaks; saved leads and suggestions are ordered with an id tie-break.
* **Invalid filters:** a decision-maker (Discover) or department / seniority / decision-maker / verification (People) filter whose values are **all** unknown is a 400 `INVALID_FILTER` (before, Discover silently returned every company). Unknown extras beside known values are ignored, as before. Unknown companies and hidden companies are the same 404; empty results and out-of-range pages return empty lists with the normal pagination envelope.
* **Literal search text:** `%` and `_` in `q` / suggestions are ordinary characters (a bare `%` matched every company).
* **Suggestions** no longer offer cities of unpublished companies; **related companies** returns nothing for an unpublished company; **business detail** no longer returns row ids of nested contacts, locations and digital presence.
* **Saved leads** no longer show a company (or its person) that is no longer published; they stay private to their owner.
* Locked contacts, unlock ownership (per customer) and credit rules are unchanged and re-verified.

## Performance
Discover's PostgreSQL path uses `businesses_status_idx`, `businesses_name_idx`, the existing `company_people_business_current_idx` and the per-person indexes. Findings, not applied (no profiling data, and they would need a migration): location filters compare `LOWER(state|city)` so they cannot use a plain index (expression indexes on `lower(state)`, `lower(city)` would help); `ILIKE '%term%'` on names needs a trigram index for large data. Both matter only when the search index is down or people filters are used on a very large catalogue.

## Not changed
Review, verification, publishing and ingestion semantics; the search index path; customer response contracts beyond removing internal row ids.
