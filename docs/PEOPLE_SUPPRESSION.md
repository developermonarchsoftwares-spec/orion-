# People suppression registry (Phase 6.4)

**Boundary:** *this identity must not be reintroduced or published as a person by future ingestion.*

Suppression is an intentional takedown / opt-out. It is **not** a rejected role, **not** a quarantined record, and **not** a deleted person. The operational state `people.data_status = 'SUPPRESSED'` stays (everything that already reads it keeps working); the registry `people_suppressions` (migration `0011_people_suppression`) is the **durable anti-resurrection mechanism** that protects the *identity* even when the person row changes, is erased, or the same person arrives again under new identifiers, sources or titles.

## 1. What is stored

One row per deterministic identity signal the suppressed person held at suppression time:

| Column | Meaning |
| --- | --- |
| `identity_kind` | `LINKEDIN`, `WORK_EMAIL`, `PHONE` (phone and mobile) |
| `identity_digest` | `'h:' + sha256(normalised value)`, the same digest form as the Phase 5 ledger. **No readable contact data is stored** |
| `person_id` | the suppressed person; `NULL` if that row was later deleted (the protection outlives the person) |
| `reason` | reviewer-supplied, **internal only** |
| `origin` | `REVIEWER_ACTION`, `QUARANTINE_ACTION`, `LEGACY_SET_STATUS`, `LEGACY_BACKFILL` |
| `source_reference` | a pointer such as `quarantine:<id>`; never personal data |
| `suppressed_by_kind/id/label`, `suppressed_at`, `created_at` | who and when (a SYSTEM row never names a human account; DB check) |

Unique on `(identity_kind, identity_digest)`: an identity is suppressed once, globally. Rows are **immutable**: triggers reject any edit (except the database nulling `person_id` / `suppressed_by_id` when the referenced row is deleted) and any delete. Names, titles, company names, cities and similarity are **never** suppression keys (the `identity_kind` check admits only the three signals above).

## 2. Who writes it (atomically)

* `PeoplePublishingService.suppressPerson`, the single suppression gate (reviewer `POST people/:id/suppress`, and quarantine "suppress"): in **one transaction** it takes a per-person advisory lock, sets the person `SUPPRESSED`, rejects their roles and unpublishes their contacts, registers all identities, and writes the audit row (which now carries `identitiesRegistered` / `identitiesAlreadyRegistered`). There is no window in which a person is suppressed but absent from the registry.
* `PeopleWriteService.setDataStatus('SUPPRESSED')` (legacy trusted-caller setter): same, origin `LEGACY_SET_STATUS`, actor `SYSTEM`.
* Registration is idempotent (`ON CONFLICT DO NOTHING` on the unique index), so repeated or simultaneous suppressions never create duplicates or errors.
* Authorization is unchanged: SUPER_ADMIN / ADMIN only; DATA_MANAGER and customers get 403, anonymous 401. There is no customer suppression path; suppression is global (section 6).

## 3. Matching rules (deterministic only)

`findSuppressionMatch`, precedence **LinkedIn, work e-mail, phone**:

| Signal | Rule |
| --- | --- |
| normalised LinkedIn URL | exact digest match |
| work e-mail (non-generic, as ingestion already validates) | exact digest match. Work e-mail is unique to one person in Orion's model |
| phone / mobile | exact digest match **and** the suppressed person's own name (current or an earlier spelling). This is the People resolver's own determinism rule for phones; if the suppressed person row no longer exists a bare phone number is inert |

Several signals of one person are one suppressed identity. A record carrying a *new* identifier together with *one known* identifier is refused. Nothing else matches: not name similarity, title, company, city, or a signal shared by several active people.

**Existing resolver guard (kept):** independently of the registry, the People resolver still refuses a record that resolves to a person already marked suppressed by its own rules, including the long-standing *same name at the same company* rule. The registry adds protection; it does not remove that one. Consequently "same name + same company + no identifier" is still held back (by the resolver, reason details `kind: PERSON`), while "same name at a *different* company + no identifier" is **not** suppressed. The registry itself never uses a name as a key.

## 4. Ingestion behaviour

A record that matches is **refused**: quarantined with reason **`SUPPRESSED_PERSON`** (details hold the signal kind and the matched person id for reviewers; never digests or contact data). It creates **no** person, role, contact or evidence, does not resurrect the existing person, and is refused whatever the source, source record id, title or company. The check runs (a) early in ingestion (read-only, so dry runs are correct and company work is skipped) and (b) again **inside the write transaction** of `PeopleWriteService.upsertPersonForBusiness`, protecting every caller; the writer also takes the person lock and re-reads the status, so a concurrent suppression cannot be overtaken.

`SUPPRESSED_PERSON` replaces the former ingestion-side `PERSON_SUPPRESSED` (three test assertions were renamed; publishing/verification/review operations on a suppressed person still report `PERSON_SUPPRESSED`). The upload bridge treats both as "held for review".

## 5. Observations (Phase 6.2 preserved)

A keyed source record that is refused is a `QUARANTINED` observation with `reason_codes: ['SUPPRESSED_PERSON']`, no person link, traceable to the source record; repeating the identical refusal in the same run adds nothing. Earlier observations are never modified; suppression does not turn old observations into registry rows (only the suppressed person's own stored identifiers are registered).

## 6. Scope: global

People are a **shared canonical identity layer**: a person row is not owned by a customer or tenant, and customers only read published output. Suppression therefore protects the canonical person **globally**. No customer-facing or tenant-scoped suppression exists or was added; a customer cannot suppress a global person, and registry data never appears in any customer response (structural tests: customer controllers/services never reference suppression).

## 7. Existing suppressed people (legacy)

Migration `0011` registers, for people already `SUPPRESSED`, only the deterministic identifiers **they already hold** (their own LinkedIn, work e-mails, phones), origin `LEGACY_BACKFILL`, actor `SYSTEM`, suppression time taken from their `PEOPLE_PERSON_SUPPRESSED` audit entry (falling back to the row's update time). Nothing is guessed or inferred. A suppressed person who holds **no** such identifier gets no entry and remains protected only by the resolver guard; these are documented legacy records and no identifier is invented for them.

## 8. Unsuppress / restore

No unsuppress, restore or reopen operation exists for people (the reviewer API has none, and a test asserts it). None was invented. Restoration is an explicit administrative operation to be designed later; it would have to relax the registry's immutability deliberately (for example by recording a lift on the row, never by deleting history) and would be audited. Until then a suppression is permanent.

## 9. Concurrency

* The unique index plus `ON CONFLICT DO NOTHING` make registration safe under simultaneous suppressions (tested: three simultaneous suppressions leave one row per identity).
* Ingestion reads committed registry state inside its own transaction; simultaneous ingestion of a suppressed identity is refused every time.
* Suppression and ingestion of the same person serialise on a per-person advisory lock, so a role can never be added after the suppression has rejected the person's roles (tested: no live role remains).
* Limit: PGlite serialises transactions, so true parallel timing is not exercised in tests; the logic relies on PostgreSQL row/advisory locks.

## 10. Privacy

Digests only (`h:` + sha256); no raw e-mail, phone or LinkedIn; no source payload or credentials; reasons and reviewer labels are internal and never returned by customer APIs. Digests are change-detectors, not secrets (phone numbers are guessable), exactly as in the verification ledger. Deleting a person (erasure) keeps only digests and a detached `person_id = NULL`: the suppression survives, the personal record does not.

## 11. Limitations and non-goals

* Identity is only as good as the stored signals: a suppressed person with none is protected by the resolver guard alone.
* A person who returns with entirely new identifiers and a different name is, by design, indistinguishable from a new person; fuzzy or name-based suppression is explicitly not done.
* Work e-mail matches regardless of name (an individual's mailbox is unique to them); a reassigned mailbox would be refused and appears in quarantine for a reviewer.
* Phone numbers are not deterministic on their own.
* Not in this phase: unsuppress workflow, customer-level suppression, bulk suppression, classification versioning, contact provenance, freshness, conflict detection, orchestration, review triage, customer contract changes, real acquisition.
