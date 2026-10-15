# People conflict detection (Phase 6.8)

**Detection, not resolution.** A conflict says "these claims disagree, a reviewer should look". It never picks a winner ("newest wins" does not exist), deletes nothing, and changes no verification, publication or suppression. Nothing in this phase sets `RESOLVED`; resolution is a later, explicit reviewer workflow.

## Audit
Before this phase disagreements were only transient: ingestion warnings (`IDENTITY_CONFLICT:EMAIL_OWNED_BY_OTHER_PERSON`, `CONTACT_BELONGS_TO_ANOTHER_PERSON`), `AMBIGUOUS_IDENTITY` quarantine, and verification `CONFLICTED` / ledger `DISPUTED` (source- or reviewer-asserted). None was stored, so a small dedicated table was required (migration `0015_people_conflicts`). Those existing behaviours are unchanged.

## Representation
`people_conflicts`: one row per `(conflict_type, subject_key)` (unique, so detection is idempotent in the database), `status` OPEN | RESOLVED, `first_detected_at`, `last_detected_at`, machine-only `details`. `people_conflict_links` (append-only): the claims behind it, by reference to existing `people_observations` / `people_observation_claims` / `people_evidence` / person / role / contact rows. No payload, no contact value, no credential: subject keys hold digests (`h:` + sha256) and ids only.

## Types and rules
A source's **current** statement is the latest observation of each `(source_key, source_record_id)`. Earlier observations of the same record are history.

| Type | Detected when |
| --- | --- |
| `CONTACT_MULTIPLE_PEOPLE` | the same work e-mail is held by another person, or the same MOBILE by a person with an incompatible name. Landline `PHONE` is not flagged (offices share lines) |
| `IDENTITY_LINKEDIN` | the record resolved to a person through LinkedIn but its name is not compatible with that person's (initials / aliases are compatible) |
| `CONTACT_CONFLICTING_VALUES` | two different sources currently claim different work e-mails for one person |
| `ROLE_TITLE` | two different sources currently put one person in different *current, non-rejected* roles at the same company |
| `ROLE_CURRENCY` | two different sources currently disagree whether the same role is current or former |
| `COMPANY_RELATIONSHIP` | two different sources currently put one person in employment-like (`EMPLOYEE`/`EXECUTIVE`) roles at different companies (owner / director / partner / advisor roles may legitimately span companies) |

## False-positive rules
Not a conflict: different title casing, a source changing its own title or e-mail (history), a source omitting a field or contact, a former role beside a current one, one source's own records, different dates, two people sharing a company name, the same fact from several sources. Freshness (Phase 6.7) is used only through "latest observation per record"; no new threshold exists and "newer wins" is never applied.

## Detection
Runs inside the writer's transaction after the observation and its claims exist, using indexed lookups on the contact value, LinkedIn, person and role this record touches (never a table scan, no network). Role / e-mail / currency / company checks need an observation (keyed runs); contact and LinkedIn checks run for every write.

## Review and exposure
Reviewer role detail now includes `conflicts` (type, status, times, claims with source key / version, observation, claim, evidence ids). No customer endpoint, search or export reads conflicts (a test scans customer code). No automatic quarantine was added.

## Verification boundary
Verification, the ledger, publication and suppression are untouched; existing `CONFLICTED`/`DISPUTED` semantics are unchanged and not driven by this feature.

## Non-goals
Resolution, trust/ranking, newest-wins, automatic winner, freshness policy, orchestration, cost controls, triage, customer contract changes, external acquisition. Links keep the first observation per side as the trace (bounded growth); later re-affirmations only move `last_detected_at`.
