# Orion privacy audit report (Step 1, audit only)

**Date:** 2026-10-09 · **Status:** PARTIAL. Static review of the schema, services, policy pages and existing privacy documents, plus read-only counts against the **local development database** (not production). This is a technical audit, **not legal advice**; legal bases, retention periods and notices need review by qualified counsel. No code, schema or configuration was changed. Finding ids (SG-nn) refer to `SECURITY_GAP_REPORT.md`.

Labels: **CONFIRMED**, **POTENTIAL**, **UNVERIFIED** as in the other reports.

## 1. Summary

Orion has two kinds of personal data: (a) its own customers' account data, and (b) the individuals who appear as contacts in the lead database, who never signed up and are the product.

- **Customers (a):** consent ledger, export, 7-day deletion, retention scheduler and request tracking exist and are tested. Gaps are mostly accuracy of the policy text and a few process items.
- **Contacts (b):** the **People module** is well governed (personal e-mail not modelled, provenance, verification, suppression by hashed identity, review workflow). The **legacy company-contact path** is not: no classification, no provenance, no suppression, and "verified" flags that are not earned. The privacy policy does not mention group (b) at all, and there is no public route for those individuals to object or ask for removal.

Public availability of a contact is not treated here as permission for commercial reuse; each jurisdiction needs its own basis and notice.

## 2. Personal data inventory

| Data | Subject | Where | Notes |
|---|---|---|---|
| Name, e-mail, password hash, phone, organisation name, avatar, OAuth ids, TOTP secret (encrypted), IP and user agent | Customer | `users`, `refresh_tokens`, `audit_logs`, `consent_records` | Covered by export and deletion |
| Saved searches, saved leads, notes, API keys (hash), integrations, export jobs | Customer | user-owned tables | Deleted on erasure |
| Credit ledger, payments, invoices | Customer | `credit_transactions`, billing tables | Kept for tax, linked to the anonymised shell |
| Company contacts: full name, title, department, e-mail, phone, LinkedIn URL | Third-party individual | `business_contacts` | No type, source, collection date or suppression (section 5) |
| People: name, role, work e-mail, phone, mobile, LinkedIn, evidence, observations | Third-party individual | `people`, `person_contacts`, evidence, observations | Governed (section 6) |
| Suppression digests of LinkedIn, work e-mail, phone | Third-party individual | `people_suppressions` | Stored as `h:` + SHA-256, not readable |

## 3. Data classification

- **People model:** `person_contacts.contact_type` is limited by a check constraint to `WORK_EMAIL`, `PHONE`, `MOBILE`; the comment in the schema says personal e-mail "is deliberately not modelled". Suppressions only accept LINKEDIN, WORK_EMAIL, PHONE. CONFIRMED. A MOBILE number can still be a personal number; the model has no "business versus personal" flag for it. POTENTIAL gap.
- **Company contacts:** no classification. A generic address (`info@`), an individual work address and a personal mobile are all stored in the same two columns (`email`, `phone`). CONFIRMED (`database/schema/business_details.ts:53-80`).
- **Customer-facing distinction:** the UI cannot tell a buyer whether a number is a switchboard or a person's mobile, except through `isDirectDial`.

## 4. Provenance, collection and verification

- **People:** source registry with terms reference and acknowledgement, per-claim observations and evidence, verification states and timestamps, freshness TTL per source (`people_sources`, observations, verification tables). The three built-in sources are enabled in the local database. CONFIRMED.
- **Companies and company contacts:** no source id on contacts; `businesses` has `source_batch_id`; the existing batch has `source_id` null; no collected-at or verified-at on contacts; no source terms recorded. CONFIRMED. Data cannot be traced to where it came from or when (SG-04, SG-05).
- **Verification flags:** locally, all 23 `business_contacts` rows have `is_email_verified` and `is_phone_verified` set to true while only 1 has an e-mail. The old gateway import set them to true. Customers see these flags in the profile. CONFIRMED in the local data; whether production data has the same is UNVERIFIED.

## 5. Suppression, opt-out and removal

| Question | People | Company contacts |
|---|---|---|
| Can an individual be suppressed? | Yes, by hashed LinkedIn, work e-mail or phone; reviewer or quarantine action | **No mechanism** |
| Is suppression checked in ingestion? | Yes, before write, inside the transaction (`people-ingestion.service.ts`, `people-suppression.ts`) | No |
| In unlock? | Yes, re-checked inside the locked transaction (`people-unlock.service.ts:56-120`) | No |
| In search and export? | Search requires published, approved roles (`people-search.service.ts:97-98`); people export includes only unlocked, published contacts | Search masks, does not check suppression; export and history include contacts regardless (SG-13) |
| In caches and the search index? | UNVERIFIED (no cache purge on suppression was found; the Typesense sync job is enqueued on publish; a suppression-triggered re-index was not traced) | n/a |
| Public intake for the individual? | None. `people/:personId/suppress` is an admin-only action. The policy lists only a customer privacy mailbox. | None |
| Can a re-import bring a suppressed person back? | No for People (digest match); for company contacts yes, nothing prevents it | Yes |

**Gap (SG-05, P1):** there is no way to honour an objection or erasure request from a company contact short of deleting the whole business, and re-import would restore it. **Gap (P2):** no public opt-out or "how we got your data" notice for third-party individuals (GDPR Art. 14 and similar); `docs/PRIVACY_COMPLIANCE.md` §4 already lists this as an open decision.

## 6. Masking and customer minimisation

- Before unlock the company profile shows the first name and "***", masked e-mail (first and last character of the name, part of the domain), masked phone, `https://linkedin.com/in/***`, "Locked Address", and truncated identifiers (`discover.service.ts:385-445`). CONFIRMED. The masked e-mail still reveals the first and last characters and a domain prefix; acceptable, but note it narrows guessing.
- After unlock the customer sees the full contact. Their unlock history and exports keep showing it even if the business is later unpublished or the contact would be suppressed (SG-13).
- People contact values are withheld until unlock; locked people are never exported (`people-export.service.ts`). CONFIRMED.
- Export size is capped at 5,000 rows per export; there is no per-customer daily cap on the number of unlocked contacts that can be exported, beyond credits. Credit price is the only bulk-extraction control (and free daily credits, SG-11).

## 7. Administrative access to personal data

- ADMIN and SUPER_ADMIN can read all customers (the gateway `admin/users` returns every user's e-mail in one call, with no audit entry, SG-15) and all People data through review screens. DATA_MANAGER can use the review and verification screens only.
- Single-factor admin sign-in (SG-07) makes this access easier to obtain than the policy implies.
- Gateway admin user list shows an invented phone number (a constant), so no real phone leaks there, but the pattern shows the console returns fabricated personal fields.

## 8. Retention, correction, deletion and requests (customers)

CONFIRMED present in code and in the existing integration tests: consent ledger (opt-in, default off, append-only, versioned), JSON export of the customer's data, deletion with a 7-day cooling-off and hourly execution, retention for audit-log IPs (180 days), consent IPs (3 years), queue jobs and integration deliveries (30 days), completed requests (3 years), privacy request tracking with a 30-day due date (`privacy.config.ts`, `privacy.service.ts`, `DATA_RETENTION_POLICY.md`).

Observations:
- The production-like database counts are zero for consents and requests locally (no one has used the features), so nothing about real volumes is verified.
- Deletion cannot cover backups, third parties and object storage by code (documented in `PRIVACY_COMPLIANCE.md` §3); bucket lifecycle rules are UNVERIFIED.
- Account deletion for OAuth-only users needs only the typed e-mail plus an access token (carried forward M-7).
- Third-party individuals have no retention schedule for stale contacts beyond the People freshness TTL; legacy company contacts have none.
- Correction for customers is through Settings; for third-party individuals there is no route.

## 9. Policy and Terms accuracy

Compared `ownus/src/app/(marketing)/privacy/page.tsx` (last updated 7 Oct 2026) with the implementation:

| Statement in the policy | Reality | Status |
|---|---|---|
| "Access and refresh tokens ... transported in secure, HTTP-only cookies to defend against XSS exfiltration" | Customer tokens are stored in `localStorage` by `api-client.ts:41-42`; OAuth tokens travel in a URL; the admin token is both a cookie and in `localStorage` | **Inaccurate** |
| "The internal administration console is guarded behind a two-factor OTP authentication gateway" | One factor (an e-mailed code) | **Inaccurate or overstated** |
| "Your uploaded CSV spreadsheets are stored in isolated private storage buckets ..." and "temporary parsing artifacts are deleted" | No customer-facing CSV upload exists (the only customer file input is the avatar, `settings/page.tsx:327`); imports are admin only | **Describes a feature that does not exist** |
| "Database queries enforce relational tenant boundary constraints, ensuring accounts cannot query data belonging to other organizations" | Isolation is per user id; there is no organisation model (`organization_id` is an unused column) | **Misleading** (true per user, not per organisation) |
| "Verified business emails, official telephone lines" as collected signals | Verification flags on company contacts are not earned (section 4) | **Overstated** |
| Categories: public registry information, digital presence signals | Does not say that individuals (names, titles, work contact details) are collected, from where, or how they can object | **Incomplete** |
| Consent, export, deletion, 7-day delay, GDPR and CCPA rights for the customer | Implemented | Consistent |
| "We do not sell your personal information" | Customers' data: no sale found. The product itself sells access to third-party contacts, which the sentence does not address | Needs counsel |

Terms of Service were not re-read in depth in this phase (UNVERIFIED beyond the link to the policy noted in `PRIVACY_COMPLIANCE.md`).

## 10. Findings

| ID | Severity | Status | Finding |
|---|---|---|---|
| PR-01 (SG-05) | P1 | CONFIRMED | No suppression, classification or provenance for `business_contacts`; objection or erasure impossible without deleting the company; re-import restores |
| PR-02 | P1 | CONFIRMED | Policy omits third-party individuals entirely and offers them no notice, objection or removal route |
| PR-03 (SG-16) | P1 | CONFIRMED | Policy statements about cookies, two-factor admin, CSV uploads and tenant isolation do not match the code |
| PR-04 (SG-05) | P1 | CONFIRMED (local data) | Verification flags set true without verification; shown to paying customers |
| PR-05 (SG-13) | P2 | CONFIRMED | Unlock history and exports keep showing contacts after unpublish |
| PR-06 | P2 | POTENTIAL | Suppression may not purge the search index or caches (not traced) |
| PR-07 | P2 | UNVERIFIED | Object storage lifecycle for uploaded files and backups; third-party processors and DPAs (open decisions in `PRIVACY_COMPLIANCE.md` §4) |
| PR-08 (SG-15) | P2 | CONFIRMED | Admin reads of customer PII are not audited |
| PR-09 | P3 | POTENTIAL | A MOBILE contact type can be a personal number; no business-versus-personal flag |
| PR-10 | P3 | CONFIRMED | No retention schedule for stale company contacts |
| PR-11 | P3 | CARRIED FORWARD | Deletion of OAuth-only accounts without recent re-authentication |

## 11. Minimum fixes (for the next phase)

1. Decide the contact model: move individual contacts into the People model, or add `contact_type`, `source_id`, `collected_at`, `suppressed` to `business_contacts` and enforce suppression in search, unlock, history, export and import.
2. Reset unearned verification flags; set them only from the verification workflow.
3. Rewrite the policy to match the code (or fix the code), and add a third-party-data section: categories, sources, purposes, legal basis (counsel), retention, rights, and a public objection and removal channel with a tracked request type.
4. Filter exports and history by publication and suppression state.
5. Audit admin reads of customer data.
6. Confirm storage lifecycle, sub-processor list and international-transfer mechanisms (owner decisions).

## 12. Tests needed

Suppressed company contact absent from search, unlock, history and export; re-import of a suppressed identity is refused; policy claims that name a mechanism (cookies, 2FA) covered by a test or removed; public removal request creates a tracked request and suppresses; verification flags false after import.

## 13. Existing privacy controls (summary)

Consent ledger, customer export, deletion with grace period, retention scheduler, request tracking, People suppression and provenance, unlock-time visibility re-check, masked contact values before unlock, scrubbed logs. See `PRIVACY_COMPLIANCE.md` and `DATA_RETENTION_POLICY.md`; these documents are proposals marked "not approved".
