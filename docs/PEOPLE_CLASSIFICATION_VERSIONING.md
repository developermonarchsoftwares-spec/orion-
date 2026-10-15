# People classification versioning (Phase 6.5)

**Boundary:** *every automatic role classification is attributable to one immutable taxonomy version, so "why was this role classified this way?" can be answered, and replayed, without relying on today's configuration.*

Classification is not verification and not approval. A title that classifies as a decision maker publishes nothing and verifies nothing; the role stays `PENDING` / `UNVERIFIED` until the existing review and verification flows say otherwise.

## 1. Taxonomy concept

A **taxonomy** is one immutable ruleset: title aliases, seniority patterns, department keywords, executive abbreviations, executive and functional decision-maker rules, relationship rules. It lives in `apps/api/src/modules/people/classification/taxonomies/vN.ts` and is registered in `taxonomies/index.ts`. The engine (`role-classifier.ts`) interprets whichever taxonomy it is given; no production rule exists anywhere else (`role-taxonomy.config.ts` keeps only labels and customer search phrases, which are presentation, not classification).

The classification boundary is `RoleClassificationService` (`classify(title)`, `replay(title, version)`): pure, stateless, no I/O. It does not publish, verify, suppress, create companies, fetch data or write anything. Callers persist its result.

## 2. Versions

* Format: `v1`, `v2`, … an explicit human-assigned label. Not the package version, not a deploy id, not a code hash.
* `CURRENT_TAXONOMY_VERSION` (currently `v1`) is what new classifications use.
* **Immutable once used.** `v1.ts` reproduces the exact pre-versioning behaviour. A test pins a content fingerprint (sha256 of every rule id, pattern, replacement and order) so editing `v1.ts` fails the build. To change interpretation: add `v2.ts`, register it, add golden tests, then move `CURRENT_TAXONOMY_VERSION`.
* Changing the **engine** in a way that alters any result of an existing version is equally forbidden (golden corpus tests cover v1); it needs a new version.
* Versions are only ever added. A version that produced stored results is never removed from the registry.

## 3. Rule IDs

Every rule has a stable id, taken from the taxonomy itself: `ALIAS-CEO`, `SEN-EXEC-FOUNDER`, `DEP-EXEC-OWNER`, `DEP-KW-MARKETING`, `DEP-ABBR-CFO`, `DM-EXEC-FOUNDER-CEO`, `DM-FUNC-SALES`, `REL-OWNER`, … plus engine defaults (`SEN-UNMATCHED`, `DEP-OTHER-DEFAULT`, `DM-NONE-BELOW-MINIMUM`, …). Ids are unique within a taxonomy (tested). A rule whose meaning changes gets a new id in a new version; an id is never reused for a different meaning inside a version.

A result carries `ruleTrace {aliases[], seniority, department, decisionMaker, relationship}` and the compact `ruleId` `SEN…|DEP…|DM…|REL…`, e.g. `CEO` → `SEN-EXEC-C-SUITE-ABBR|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-EXECUTIVE`.

## 4. Strength (the "confidence" of a classification)

The classifier has no probabilities, so none are invented. Deterministic categories only:

| Strength | Meaning |
| --- | --- |
| `EXACT_RULE` | matched on the title as written |
| `NORMALIZED_RULE` | matched after title aliases rewrote it (e.g. "Chief Executive Officer" → `ceo`) |
| `FALLBACK` | department came from a generic fallback (general GM / director / partner / chief rule, or the `OTHER` default) |
| `UNCLASSIFIED` | no seniority rule matched; seniority and department stay `UNKNOWN`, no decision-maker type |

## 5. What is stored

`company_people` (the classification **in force**; migration `0012`): `classification_version`, `classification_strength`, `classified_at`. `NULL` = classified before versioning (nothing was back-filled) or never auto-classified. For a reviewer-owned role they describe the underlying system result; `classification_source` says who is authoritative. `department`, `seniority_level`, `decision_maker_type`, `normalized_job_title` keep their existing meaning.

`company_people_classifications` (append-only history): one row per decision.

| Column | Meaning |
| --- | --- |
| `kind` | `SYSTEM_CLASSIFICATION` or `REVIEWER_OVERRIDE` |
| `taxonomy_version` | version of a system result (`unversioned` snapshots a legacy value a reviewer overrode); `NULL` for an override |
| `normalized_title`, `seniority_level`, `department`, `decision_maker_type`, `relationship_type` | the classified values |
| `rule_id`, `rule_trace`, `strength` | how a system result was reached (`NULL` for overrides and legacy snapshots) |
| `actor_kind/id/label` | `SYSTEM`, or the reviewer who overrode (internal only) |

A unique index on `(role, taxonomy_version, normalized_title)` for system rows makes re-classification idempotent in the database itself. A trigger forbids updates (except the database nulling `actor_id` when the account is deleted). Rows go only with their role (cascade).

Not stored: a numeric confidence, the raw title again (it is on the role/observation), or anything about the source.

## 6. Reviewer overrides

* An override sets `classification_source = 'REVIEWER'`, writes a `REVIEWER_OVERRIDE` history row, and snapshots the automatic value it replaces (`SYSTEM_CLASSIFICATION`, version of the role or `unversioned`) so the original system classification is never lost.
* Automatic classification never overwrites an override: not re-ingestion under the same version, not under a newer version, and not a later reviewer **title** edit (which previously reset the override to AUTO; fixed in this phase). The new title's system result is recorded in history only.
* Limitation: overrides made before this phase have no recorded original system value.

## 7. Re-ingestion semantics

| Case | Behaviour |
| --- | --- |
| A. same title, same version | no new role, no new history row, `classified_at` not re-stamped |
| B. newer version | AUTO unreviewed role: takes the new result (stamped, history row added; the old row stays). **Approved/published role: the new result is recorded in history but customers keep the existing values**; a reviewer sees `outdated`. Reviewer override: untouched, new result recorded only |
| C. override exists | stays authoritative |
| D. title changed | by ingestion a new title is a new role identity (Phase 4.1) and is classified on its own; the old role and history stay. By reviewer edit the new title is reclassified (AUTO) with history; observations are never rewritten |
| E. alias | a title reaching a role through `title_aliases` resolves to the same role and no longer reclassifies it from the incoming wording (the role's own normalized title decides) |

Classification never changes an approved or published role's customer-visible values without a reviewer.

## 8. Historical reproducibility

`RoleClassificationService.replay(title, 'v1')` re-runs a title under a registered version and reproduces what that version said, whatever is current. Tests prove a v1 result is unchanged after a different v2 exists (and that building v2 does not touch v1). A stored row names the version and the rule ids, so the explanation never needs current configuration. Current vs historical: compare `classification_version` with `CURRENT_TAXONOMY_VERSION` (reviewer detail exposes `outdated`).

## 9. Observations (Phase 6.2)

`people_observations` gained `normalized_title` and `classification_version`: what the observed title normalised to and under which version, written in the same transaction as the observation. Rows stay immutable (the append-only trigger rejects the new columns being edited); earlier observations are never rewritten.

## 10. Suppression and quarantine compatibility

Suppression (Phase 6.4) runs before classification can create a publishable role: a suppressed identity is refused (`SUPPRESSED_PERSON`) with no role and no classification history (tested). Unclassifiable titles keep their existing semantics: stored with `UNKNOWN`, flagged by the existing `UNCLASSIFIED_TITLE` warning, strength `UNCLASSIFIED`, no invented classification. No new quarantine reason code was added.

## 11. Security and exposure

Version, strength, rule ids and history are **internal**: only the reviewer role detail (`classification` block) returns them. No customer endpoint, search, export, or `GET /people/taxonomy` response contains them (a test scans customer-facing code). Reviewer identity appears only in the reviewer view. No source credentials, URLs or evidence are involved.

## 12. Determinism

Same title + same version → same result regardless of call order, repetition, instance, process restart, clock, database content, source or ingestion order (rules are explicit ordered arrays; ties between department keywords resolve to the first listed). Tested.

## 13. Migration `0012_people_classification_versioning`

Additive and idempotent (`IF NOT EXISTS`, guarded constraints, `CREATE OR REPLACE`): three nullable columns on `company_people`, two nullable columns on `people_observations`, the new history table with its constraints, index and trigger. No data is changed or back-filled; existing roles keep every value and every reviewer override. Validated on PGlite only (clean install, upgrade from 0011 with populated data, second run); **not run against Neon/production**.

## 14. Non-goals

Contact provenance, freshness, conflict detection, orchestration, cost controls, review triage, customer contract changes, any real acquisition source, any LLM/ML classification, a version-bump workflow beyond "add `vN.ts`", backfilling versions onto legacy roles, and an admin UI for history.
