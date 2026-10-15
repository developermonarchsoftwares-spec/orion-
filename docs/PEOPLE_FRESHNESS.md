# People freshness (Phase 6.7)

Freshness timestamps are kept separate, each on the thing the fact belongs to. None of them is verification.

| Timestamp | Where | Meaning |
| --- | --- | --- |
| `acquired_at` | `people_observations` (existing) | when Orion received the source record |
| `observed_at` | `people_observations` (existing) | when the **source says** the fact was true. Only what the source supplied; never invented; absent = NULL; a future date refuses the record (`INVALID_OBSERVED_AT`, Phase 6.2) |
| `last_seen_at` | `company_people` (existing), `person_contacts` (new) | when Orion last saw **this claim** again |
| `last_confirmed_at` | `company_people`, `person_contacts` (new) | when a reviewer last accepted it (role approved / contact published) |
| `verified_at` | verification ledger (existing, `last_verified_at` is derived from it) | owned by the Phase 5 ledger; untouched here |

## Update rules

* Observation rows are immutable; a new acquisition adds a new observation and never rewrites an old `acquired_at` / `observed_at`.
* `last_seen_at` moves only for the role and the contacts actually present in the record. A contact missing from a later record is not touched; a changed title is a different role (old role not touched); a changed email is a new contact (old contact not touched). It is monotonic (`GREATEST`), so a slower concurrent writer cannot move it backwards, and seeing a claim again is not counted as a change to it.
* A second source seeing the same fact refreshes the one canonical contact; provenance (Phase 6.6) records the second source.
* `last_confirmed_at` is set only by the existing reviewer confirmation events (`publishRoleTx`, `publishContactTx`). Ordinary ingestion never sets it, and the legacy trusted-caller publish path does not either (it is not a review). Confirming writes nothing to the verification ledger and changes no verification status.
* Contacts that predate this phase have `last_seen_at = NULL` (unknown, not back-filled) until they are seen again.

## Staleness: deferred

The only existing threshold is the verification-staleness rule, which is about verification, not about being seen. No TTL exists for seen / observed freshness and none was invented, so there is no FRESH / STALE helper yet; the timestamps are stored for a later policy. Nothing is deleted, unpublished or downgraded because a timestamp is old (tested).

## Exposure and migration

Customer responses contain none of these fields (the existing customer evidence `observedAt` is unchanged); a test scans customer-facing code. Migration `0014_people_freshness`: three nullable `ADD COLUMN IF NOT EXISTS`, no back-fill.

## Non-goals

Conflict detection, source ranking, TTL / stale policy, automatic deletion or unpublish, verification changes, orchestration, cost controls, review triage, customer contract changes, external acquisition.
