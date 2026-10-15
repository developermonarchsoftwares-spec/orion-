# Privacy and compliance traceability

**Prepared:** Phase 20, 2026-10-12 · **Not legal advice. Orion is not certified, audited or declared compliant with GDPR, UK GDPR, CCPA/CPRA, India's DPDP Act or any other law or standard, and nothing here says it is.** This document maps *technical controls* to the privacy commitments and requirements the project has identified, with the evidence for each and the part that only a person (owner, counsel, operator) can supply.

Status words are those of `SECURITY_REQUIREMENTS_TRACEABILITY.md` (VERIFIED, PARTIALLY VERIFIED, NOT VERIFIED, FAILED, BLOCKED, NOT APPLICABLE); evidence codes E1 to E5 and EXT are defined there. "VERIFIED" here means "the technical control works as described in the tested scope"; it never means "lawful".

## 1. Whose data, and where

| Group | Examples | Where it lives | Orion's role (to be confirmed by counsel) |
|---|---|---|---|
| **Customers** (people with an Orion account) | name, e-mail, phone, organisation, password hash, saved searches, unlocks, payments, API keys, IP/user agent | `users` and user-owned tables, `audit_logs`, `consent_records`, `privacy_requests`, billing tables | Controller of its customers' data; the payment, e-mail and hosting providers are likely processors |
| **Business contacts** (people named in company records) | named contacts, work e-mail, phone, LinkedIn URL, role | `business_contacts`, `people`, `person_contacts`, `company_people`, import tables | The business collected this data about people who are **not** its customers; role and legal basis are open questions (section 5) |
| **Operational data** | audit events, logs, queue jobs, delivery logs | `audit_logs`, `queue_jobs`, `integration_deliveries`, log platform | see `DATA_RETENTION_POLICY.md` |

The full inventory with purposes, triggers, periods and methods is `DATA_RETENTION_POLICY.md` section 1; the field-level classification is `DATA_CLASSIFICATION.md` (derived per value, nothing stored).

## 2. Control traceability

| ID | Requirement or commitment | Implemented control | Evidence | Status | Known limitation | Owner / action |
|---|---|---|---|---|---|---|
| PC-01 | **Data inventory** exists and is current | `DATA_RETENTION_POLICY.md` s1 (21 categories), `DATA_CLASSIFICATION.md`, `PRIVACY.md` | E4 documents read and checked against the schema in Phase 16 and Phase 20 | PARTIALLY VERIFIED | Not a legal Record of Processing Activities; the `data_subject_requests` and company-contact stores are listed but have no live data | Owner: build the Art. 30-style record (`PRIVACY_COMPLIANCE.md` s4) |
| PC-02 | **Classification** of personal, business, sensitive identifiers | `common/privacy/data-classification.ts` (8 classes + UNKNOWN, conservative on doubt) | E1 `data-classification.spec.ts` 40, `privacy-classification.e2e-spec.ts` 13 | VERIFIED | Derived, not stored; reviewers cannot correct a classification (migration recommended, not made) | Decision R-016 |
| PC-03 | **Source provenance and acquisition restrictions**: every published business can be traced to an approved source and batch; unapproved or revoked sources cannot publish | `import/provenance`, `source-trust.service.ts`, migration `0025_source_trust`, trigger `businesses_source_guard` | E1 `provenance-publishing.e2e-spec.ts` 27, `provenance.util.spec.ts` 39; E3 trigger refusal | PARTIALLY VERIFIED | No real source registered or approved; pre-existing businesses have unknown provenance; the gateway status screen can publish from an UNREVIEWED source; "approved" is an administrator's judgement, not a legal check | Owner: approve sources with a documented lawful basis; Engineering R-005 |
| PC-04 | **Personal-contact handling**: individuals' contacts not shown before unlock, masked by kind, individual PAN never in full | `data-classification.ts`, `discover.service.ts`, `unlock.service.ts` | E1 same suites | VERIFIED | After-unlock disclosure of personal/unknown values is permitted by default (policy constant) | Decision R-016 |
| PC-05 | **Data minimisation** in responses, exports, logs | classification-aware masking; profile response drops `metadata`, provider ids; export caps; redacted logs | E1 `privacy-classification.e2e-spec.ts`, `export-security.e2e-spec.ts`, `redact.spec.ts` 82 | VERIFIED | Customers can still extract everything they unlock, up to 20,000 rows per 24 h (product decision) | none |
| PC-06 | **Access control** to personal data | role guards, ownership filters, cross-user tests (`SR-AZ-01..06`) | E1 `authorization.e2e-spec.ts` 17, `admin-authorization.e2e-spec.ts` 5 | VERIFIED (API) | Gateway native handlers lack object-level tests (SR-AZ-03) | R-006 |
| PC-07 | **Access and portability** (customer) | `POST /privacy/export`, Settings page; secrets and file bytes excluded | E1 `privacy.integration.spec.ts` 6 | VERIFIED | Covers account data only; says nothing about business contacts | none |
| PC-08 | **Erasure** (customer) | `eraseAccountData` after a 7-day cancel window; cancel route; anonymised shell; financial rows kept without identity | E1 `privacy.integration.spec.ts`, `retention-lifecycle.integration.spec.ts` | VERIFIED (live tables) | Backups keep the data up to ~12 months; third parties (payment, e-mail, CRM, error tracker) are not reached by code; paid subscriptions at the provider are not cancelled by code (`PRIVACY_COMPLIANCE.md` s3) | Operator process |
| PC-09 | **Correction** (customer) | profile update; whitelist of writable keys | E1 `authorization.e2e-spec.ts` | VERIFIED | none | none |
| PC-10 | **Removal / suppression of business contacts** | `ContactSuppressionService`, `contact_suppressions` (digest only, immutable), trigger on `business_contacts`; People registry `people_suppressions` | E1 `retention-lifecycle.integration.spec.ts`, `people-suppression.integration.spec.ts` 22 | PARTIALLY VERIFIED | **No intake channel or workflow** (the `data_subject_requests` table has no service, route or UI); exports made earlier are not re-filtered (2 todo tests); matching is exact on normalised e-mail/phone/LinkedIn | Owner + Engineering R-008 |
| PC-11 | **Re-ingestion prevention** | trigger on every writer; People registry checked at ingestion | E1 tests above; E3 re-import after restore inserted nothing | VERIFIED (`business_contacts`, `people`) | Other future tables holding contacts would need the same guard | Rule in `DATA_RETENTION_POLICY.md` |
| PC-12 | **Retention enforcement** | `PrivacyService.runRetention` (bounded, retry-safe, previewable, audited) | E1 `retention-lifecycle.integration.spec.ts` 19 | PARTIALLY VERIFIED | Periods for financial records, audit events, logs, import payloads, CSV files and the 12-month backup tier are **undecided** (D-RET-1..9); import-payload rule is off | Owner + counsel |
| PC-13 | **Backup lifecycle** and deletion after restore | `backup.sh`/`restore.sh`, deletion ledger | E3 end-to-end on disposable PostgreSQL; E1 ledger tests | PARTIALLY VERIFIED | Old backups cannot be scrubbed; production backup configuration unverified (EXT); remote ledger apply needs an approved exception | Operator, D-RET-9 |
| PC-14 | **Auditability** of privacy-relevant actions, without personal data in the log | `AuditLogService` (`recordStrict` for privacy decisions), `redact.ts`; events `PRIVACY_*`, `CONTACT_SUPPRESSION_*`, `RETENTION_JOB_*`, `POST_RESTORE_RECONCILED` | E1 `audit-logging.e2e-spec.ts` 15, `retention-lifecycle.integration.spec.ts` | VERIFIED | Audit events have no expiry (D-RET-3); audit table not tamper-evident or shipped off-host | R-012 |
| PC-15 | **Request handling process** (30-day clock, identity checks, third-party erasure notes) | `privacy_requests.due_at`; `GET /privacy/admin/requests`; procedure in `PRIVACY_COMPLIANCE.md` s5 | E1 for the data model; the human process was never run | PARTIALLY VERIFIED | No monitored mailbox or owner is recorded; the deadline view is not alerting | Owner |
| PC-16 | **Consent** for optional uses; opt-out of sale/share recorded | `consent_records` (append-only), `SALE_SHARING` switch, web `lib/consent.ts` | E1 `privacy.integration.spec.ts` | VERIFIED | Orion states it does not sell or share data; no code enforces that statement, the switch records a choice | none |
| PC-17 | **Privacy policy and terms match behaviour** | `ownus/src/app/(marketing)/privacy/page.tsx`, `terms/page.tsx` | E4 page text read against code in Phase 20 (table below) | PARTIALLY VERIFIED | Drafts; legal entity, representative, sub-processors, transfers, minimum age and the position of business contacts are missing | Counsel |
| PC-18 | **Incident and breach response** | `INCIDENT_RESPONSE.md`, `INCIDENT_RESPONSE_RUNBOOK.md` (breach worksheet, notification workflow with placeholders) | documents; never exercised | PARTIALLY VERIFIED | Roles and contacts are placeholders; the 72-hour question is jurisdiction-dependent (counsel) | Owner + counsel |
| PC-19 | **Privacy-safe operations** (no raw personal data in routine logs, backups of suppression only as digests) | `redact.ts`, ledger design | E1 `redact.spec.ts`; ledger raw-value test | VERIFIED | none | none |

## 3. What the privacy page says, and what backs it

| Statement on the page | Backed by | Judgement |
|---|---|---|
| Optional uses (analytics, marketing, product updates) are off until the user turns them on | `consent_records` default "not granted"; banner | Supported |
| Deletion requests are completed within 30 days | 7-day cancel window plus hourly job; `due_at` = 30 days | Supported for customer accounts; says nothing about requests from other people |
| After the cooling-off period the profile, saved searches and leads, API keys and integrations are "permanently erased" | `eraseAccountData` | Supported **for live tables**; backups keep the data until they expire. The page also states "Backups: up to 12 months", so it is consistent, provided the backup lifecycle is actually configured (EXT) |
| Backups: up to 12 months; deleted data "is not restored into live systems" | deletion ledger re-applied on restore | Supported **only if the restore procedure including the ledger is followed**; the guarantee is procedural, and the production restore path is untested (D-RET-9) |
| Privacy requests kept 3 years | `RETENTION.completedPrivacyRequestDays` | Supported |
| Google API data use follows the Limited Use requirements | none in code beyond not requesting Drive/Gmail scopes | Cannot be verified here (EXT) |
| Contact for privacy: a monitored mailbox | an address is named; whether it is monitored is unknown | EXT |

**Missing from the pages** (all open decisions for counsel and the owner; nothing in this list is asserted to be legally required): how Orion obtains and uses information about people named in company records, and how those people can object or ask for removal; the legal entity, registered address and any representative; the list of sub-processors and cross-border transfers; a minimum age; the breach-notification commitment; a data protection officer or equivalent contact.

## 4. Operational and legal dependencies (things only people can supply)

| Dependency | Needed for | Owner |
|---|---|---|
| A monitored privacy mailbox and a named request handler | PC-15 | NOT SET |
| Documented lawful basis and source terms for each approved data source | PC-03 | NOT SET |
| Decisions D-RET-1..9 (`DATA_RETENTION_POLICY.md` s6) | PC-12, PC-13 | NOT SET |
| Sub-processor list, agreements and transfer mechanism | PC-17 | NOT SET |
| A way for non-customers to make and verify a removal request (finish Phase 11) | PC-10 | NOT SET |
| Confirmation of bucket lifecycle and backup configuration | PC-13 | NOT SET |
| An exercised incident drill and named escalation contacts | PC-18 | NOT SET |

## 5. Jurisdiction-specific questions for qualified legal review

These are questions, not conclusions. None of them has been answered by this project.
1. **Which laws apply**, given where Orion's customers, the people named in its records, and its hosts are (the documents mention GDPR, CCPA/CPRA and the Indian context; DPDP applicability and the position of "business contact data" under each are unconfirmed).
2. **Status of business-contact data**: whether individuals' work e-mail, phone and LinkedIn data collected from third-party sources is personal data under each law, the legal basis (if any), whether a notice is owed to those individuals when the data is obtained indirectly, and whether the right to object or erase must be offered through a public channel.
3. **Role allocation**: controller or processor status for customer-uploaded lists and for sub-processors.
4. **Retention**: statutory periods for invoices, payment and credit records; whether a 7-day erasure delay and a 12-month backup tail are acceptable; whether a legal-hold mechanism is required.
5. **Sensitive identifiers**: treatment of PAN, GSTIN and similar identifiers of proprietors.
6. **Transfers**: cross-border transfers to hosting, e-mail, search and payment providers.
7. **Breach notification**: thresholds, authorities and time limits that apply, and who must be told.
8. **Age and consent**: minimum age, and whether the consent defaults are sufficient where consent is the basis.
9. **Sale/share statements**: whether the "we do not sell or share" statement is accurate given integrations a customer can enable.

## 6. Limits of this document
Technical controls were checked on a developer machine and disposable databases. No regulator, lawyer, auditor or data subject has reviewed anything. No production data or request has been processed. A control marked VERIFIED can still be unlawful in a given context.
