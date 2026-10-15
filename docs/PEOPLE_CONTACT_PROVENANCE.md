# People contact provenance (Phase 6.6)

**Boundary:** *which source claimed this contact point, when, in which run.* Provenance is **not** verification: "source reported it" never means "verified". Verification stays in the Phase 5 ledger.

## Model

`Source → Observation → Person/Role → Contact → Evidence` is built from existing records. The only addition is the link that was missing: `people_observation_claims` (migration `0013_people_contact_provenance`), one row per contact claim an observation carried.

| Column | Meaning |
| --- | --- |
| `observation_id` | the observation, and through it `source_key`, `source_version`, source record id, run (`batch_ref`), acquired / observed times |
| `claim_type` | `WORK_EMAIL`, `PHONE`, `MOBILE`, `LINKEDIN` (existing semantics; no new type) |
| `contact_id` | the canonical `person_contacts` row (NULL for LinkedIn, which lives on the person) |
| `value_digest` | `'h:' + sha256(normalised value)`, the Phase 5 / 6.4 convention |
| `evidence_id` | the existing `people_evidence` row (`CONTACT_CLAIM`, or `IDENTITY_CLAIM` for LinkedIn) this observation produced or re-confirmed |

No second evidence system, no raw payload, no credentials, no cleartext value. Rows are written in the same transaction as the observation, are append-only (trigger), and unique per `(observation, type, digest)`.

## Behaviour

* Same source + record + contact + run: no duplicate contact or claim (duplicate observation writes no claims).
* Later acquisition of the same record: one canonical contact (existing `person_contacts_uq`); one new claim per new observation; earlier claims are never touched.
* Different source, same contact: one contact, claims and evidence rows from both sources.
* Different source, different contact: both contacts and both claims are kept. No conflict is resolved.
* Changed contact: existing contact semantics apply (a new value is a new contact); the old contact and its provenance remain.
* Suppressed person, invalid contact, blocked (other person's) contact: existing refusal/warning behaviour, no claim written.
* Concurrency relies on the existing unique indexes plus `ON CONFLICT DO NOTHING`.

## Exposure

Internal only. `ObservationService.contactProvenance(contactId)` / `linkedinProvenance(personId)` return ids and digests; no controller or customer response uses them (a test scans customer-facing code).

Since Phase 10B the claims also decide which company a customer card may show a contact for. That reading lives in ONE module (`people-contact-attribution.ts`), is the only customer-path access to claims, and returns yes / no decisions only: no claim, observation or id reaches a customer response. The reviewer dossier (Phase 15) shows the same decision per contact as a read-only status (reported by this company / shared / reported by another company / unattributed). The attribution is only as good as the source data: it assumes a contact on a company's row was reported for that company, which holds because the Pipeline People export selects contacts only from the relationship's own company and never falls back to another company's (Phase 17; see `PEOPLE_EXPORT_IMPORT.md`). Contacts with no claims (reviewer-added, or imported before claims existed) are unattributed: shown only for a one-company person, hidden for a multi-company person, never assigned to a company.

## Limits / non-goals

Claims exist only for keyed (observation-producing) runs; unkeyed writes keep their evidence rows as before. Legacy contacts have no claims (nothing is back-filled). Not done: freshness, conflict resolution, deliverability or phone checks, source trust ranking, enrichment, orchestration, customer contract changes.
