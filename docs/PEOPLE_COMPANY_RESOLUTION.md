# Company resolution (Phase 6.3)

A shared, **read-only** resolver that decides which *existing* company a piece of external data is about, or that it cannot tell. It exists so that larger external People sources can never attach a person to the wrong company: **precision over recall**. A missed company is reviewable; a person on the wrong company contaminates the dataset.

```
raw record --> normaliser --> company reference / hints --> CompanyResolverService --> MATCHED | AMBIGUOUS | NOT_FOUND
                                                                                          |         |            |
                                                                                   continue   quarantine    quarantine
                                                                                   ingestion  (candidates)  (reason)
```

Code: `modules/business/company-resolution/` (`company-resolver.service.ts`, `company-matching.ts`, `company-resolution.types.ts`, `company-resolution.module.ts`). No migration was needed.

## 1. What it is (and is not)

* Generic and **read-only**: it only `SELECT`s. It cannot create or edit a company, person, role or identifier, makes no network call and holds no credentials (a test scans the source for writes, transactions, fetch-like calls and People services).
* Used today by People ingestion; usable by future source adapters and enrichment. The company **import** keeps its own duplicate detector (section 7).
* Never creates a company. Never selects one of several plausible companies. Never uses fuzzy/approximate matching (no Levenshtein, n-grams, phonetics, geocoding, ML/LLM, website scraping or domain guessing; a test asserts these are absent).

## 2. Input and output

Input, `ICompanyCandidate` (all optional): `id`, `slug`, `identifiers[] {type, value}`, `website`/`domain`, `name`, `legalName`, `city`, `state`, `pincode`. A People record supplies these through the existing `businessId` / `businessSlug` / `businessIdentifier` fields and the new optional `company { name, legalName, website, domain, city, state, pincode, identifiers }` block (normalised and length-bounded by the normaliser; unknown shapes are ignored).

Output, `ICompanyResolution`:

| Status | Meaning | Fields |
| --- | --- | --- |
| **MATCHED** | exactly one company, deterministically | `companyId`, `matchedBy` (`INTERNAL_ID`, `INTERNAL_SLUG`, `IDENTIFIER:<TYPE>`, `DOMAIN`, `NAME_AND_LOCATION`), `reasonCodes` (informational notes) |
| **AMBIGUOUS** | several plausible companies, or strong signals disagree; **no winner is ever chosen** | `candidates[]` (`companyId`, `matchedBy`, `reasonCodes`; sorted by id, at most 20, `CANDIDATES_TRUNCATED` when cut), `reasonCodes` |
| **NOT_FOUND** | nothing identifies a company | no company id, no candidates; `reasonCodes` |

Reason codes are stable and machine-readable (`CONFLICTING_COMPANY_REFERENCES`, `CONFLICTING_IDENTIFIER[:TYPE]`, `CONFLICTING_DOMAIN`, `SHARED_DOMAIN`, `DOMAIN_NOT_IDENTIFYING`, `DOMAIN_INVALID`, `IDENTIFIER_NOT_FOUND:<TYPE>`, `IDENTIFIER_TYPE_NOT_USED:<TYPE>`, `NAME_NOT_USABLE`, `NAME_NOT_FOUND`, `NAME_MATCH_NEEDS_CORROBORATION`, `NAME_MATCH_DIFFERENT_LOCATION`, `DUPLICATE_COMPANY_NAME_SAME_LOCATION`, `NAME_DIFFERS_FROM_DOMAIN_OWNER`, `NO_COMPANY_SIGNAL`, ...). Nothing here is exposed through any customer API (no controller or customer service uses the resolver; a test enforces the list of users).

## 3. Matching hierarchy

A lower tier is consulted only when no stronger signal resolved the company.

| Tier | Signal | Rule |
| --- | --- | --- |
| 0 | Orion id / slug | exists => candidate. An id and a slug that point at different companies => AMBIGUOUS |
| 1 | statutory identifier: CIN, GSTIN, PAN, UDYAM, LEI, TAN, REG_NO (type `OTHER` is ignored) | compared **by type** on the normalised value (upper case, letters and digits, the form the import stores). One company => MATCHED. Identifiers that point at different companies => AMBIGUOUS. The caller supplying two different values for one type => AMBIGUOUS |
| 2 | the company's **own website** domain | normalised: lower case, scheme, `www.`, port, path, query, fragment and trailing dot removed. Only active `WEBSITE` presences count (stored with or without `www.`). One company => MATCHED (notes `NAME_DIFFERS_FROM_DOMAIN_OWNER` if a given name disagrees). Several => AMBIGUOUS (`SHARED_DOMAIN`). Public platforms and mail providers (gmail, linkedin, facebook, wixsite, directory sites ...) and e-mail addresses **never** identify a company; an **e-mail domain is never an input** |
| 3 | exact **normalised** name (name or legal name) **corroborated by location** | see below |

**Cross-checks (never guess):**

* a tier 0/1 company whose website domain belongs to a *different* company => AMBIGUOUS (`CONFLICTING_DOMAIN`);
* a matched company that already holds an identifier of a supplied type with a **different** value => AMBIGUOUS (`CONFLICTING_IDENTIFIER:<TYPE>`), at any tier.

**Tier 3 in detail.** Name normalisation is formatting only: lower case, `&` -> `and`, punctuation/spacing collapsed, `pvt` -> `private`, `ltd` -> `limited`. The same function exists in JavaScript and SQL (stored names are not normalised in the database) and a test proves they agree. Names shorter than 3 characters are unusable. Location **corroborates, it never identifies**:

| Situation | Result |
| --- | --- |
| exactly one same-name company has a location with the same city (or the same 6-digit pincode), and a stated state agrees | MATCHED (`NAME_AND_LOCATION`) |
| several same-name companies agree on location | AMBIGUOUS (`DUPLICATE_COMPANY_NAME_SAME_LOCATION`) |
| one agrees, but another same-name company has no location on file (so it cannot be ruled out) | AMBIGUOUS |
| the name exists but no usable location was given (even a single match) | AMBIGUOUS (`NAME_MATCH_NEEDS_CORROBORATION`) |
| same name only in other cities | NOT_FOUND (`NAME_MATCH_DIFFERENT_LOCATION`) |
| no company has that name | NOT_FOUND (`NAME_NOT_FOUND`) |

Examples: `ABC Technologies` in Chennai and in Pune + `city: Pune` => the Pune company. Two `ABC Technologies` in Chennai + `city: Chennai` => AMBIGUOUS with both ids. `ABC Technologies` + no city => AMBIGUOUS, one candidate, a reviewer confirms. `ABC Technologyes` => NOT_FOUND (no fuzzy matching).

## 4. False-positive protection (why these choices)

* Name alone never attaches a person. Location alone never identifies a company.
* Two strong signals that disagree are a conflict, not a vote.
* Shared domains, duplicate names and uncorroborated names are AMBIGUOUS by construction.
* Public-platform and e-mail domains are excluded, so a person's Gmail or a company's LinkedIn page cannot decide a company.
* No approximation can ever produce a MATCHED.

## 5. People ingestion behaviour

`PeopleIngestionService` uses the shared resolver in place of its former private lookup (same explicit references as before: id, slug, `businessIdentifier`).

| Result | Behaviour |
| --- | --- |
| MATCHED | normal ingestion continues (everything still lands DRAFT / PENDING) |
| AMBIGUOUS | the record is **quarantined whole** with reason `AMBIGUOUS_COMPANY_MATCH`; `reasons[0].details.companyMatch` carries `{status, candidates[{companyId, matchedBy, reasonCodes}], reasonCodes}` (ids and machine codes only, never source payload or contact data); the reviewer's quarantine detail also shows candidate names |
| NOT_FOUND | quarantined with the existing `BUSINESS_NOT_FOUND` (the ingestion contract has no other safe company path); `details.companyMatch` carries the reason codes. **No company is ever created** |

`AMBIGUOUS_COMPANY_MATCH` replaces the former `AMBIGUOUS_BUSINESS` for a conflict between explicit references (the one test that asserted the old code was updated; the upload bridge treats both codes as "held for review"). A record with only a person's e-mail and no company hint is still rejected as `MISSING_BUSINESS`.

## 6. Observation behaviour (Phase 6.2 preserved)

A refused company resolution is a `QUARANTINED` observation with reason codes (`AMBIGUOUS_COMPANY_MATCH` / `BUSINESS_NOT_FOUND`), traceable to the source record. Observations are append-only: if a later run resolves the company (for example the source now supplies a disambiguating city), a **new** `INGESTED` observation is written in the new run, and the earlier `QUARANTINED` one is untouched (tested byte-for-byte). Re-ingesting a resolved record creates no duplicate people, roles or evidence.

## 7. Relationship with the import duplicate detector

| | `DuplicateDetectionService` (company import) | `CompanyResolverService` (shared) |
| --- | --- | --- |
| Question | "is this uploaded company probably a duplicate of one we hold?" | "which existing company is this external data about?" |
| Outcome | candidates flagged for a human, with scores | exactly one company, several candidates, or none |
| Matching | identifiers, domain, **fuzzy name + location** (bigram similarity) | exact identifiers, exact domain, exact **normalised** name + location; no similarity scoring |
| Used for | deciding whether a new company record is a duplicate | attaching external People data to a company |

The import detector is **unchanged** and stays import-specific (its fuzzy similarity and cross-type identifier check must not become attachment rules). The resolver reuses the deterministic building blocks: `StringUtil.extractDomain` for domains and the import's identifier normalisation (upper case, letters and digits).

## 8. Security and privacy

Read-only SQL with bound parameters (the only raw SQL fragment is a fixed name-normalisation expression over trusted column names); no network, no credentials, no payload persistence; candidates and reason codes contain ids and codes only; not reachable from any controller or customer service.

## 9. Non-goals and known limits

* No fuzzy matching, geocoding, ML/LLM, scraping, domain guessing, or company creation.
* **Performance:** names are not stored normalised, so the name tier compares a normalising SQL expression and cannot use the existing btree on `businesses.name`. Tiers 0-2 are indexed lookups. Today's callers reach tier 3 only for records that carry no id / slug / identifier / known domain, so this is acceptable; before a high-volume source uses name matching, add functional indexes on the normalised name expression (a small additive migration, deliberately not done here because nothing needs it yet).
* Unicode-only (non-Latin) names normalise to nothing and are `NAME_NOT_USABLE`.
* Domain matching relies on `digital_presences.domain` being a clean host (the importers store it that way); unusual stored casing is not matched.
* Not in this phase: suppression registry, classification versioning, contact provenance, freshness, conflict detection, orchestration, review triage.
