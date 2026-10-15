# Privacy & legal compliance (GDPR / CCPA)

**Status: PROPOSED — NOT APPROVED, NOT LEGAL ADVICE.** This documents what the product does and what the business must still decide. The Privacy Policy and Terms pages are drafts until a qualified lawyer reviews them. Created 2026-10-07.

## 1. What is implemented

| Requirement | Where | Behaviour |
|---|---|---|
| Privacy Policy | `ownus/src/app/(marketing)/privacy/page.tsx` | Retention table, GDPR legal bases, CCPA rights, cookie section; `lastUpdated` must match `POLICY_VERSION` changes |
| Terms of Service | `ownus/src/app/(marketing)/terms/page.tsx` | Links account deletion to the Privacy Policy |
| Consent management | `apps/api/src/modules/privacy`, `consent_records` table, `ownus/src/components/privacy/consent-banner.tsx`, Settings → Privacy & Data | Purposes `ANALYTICS`, `MARKETING`, `PRODUCT_UPDATES`, `SALE_SHARING`. **Opt-in, default off.** Append-only ledger stores purpose, granted, policy version, source, IP, user agent, time. Withdrawing is as easy as granting. A new `POLICY_VERSION` makes the banner ask again |
| Data export (access / portability) | `POST /privacy/export`, Settings → Download my data | JSON of profile, keys (prefix only), searches, leads, unlocks, credits, billing, exports, integrations (no secrets), consents, requests, activity. Rate limited to 3 per hour. Each export is logged as a request |
| Data deletion (erasure) | `POST /privacy/delete`, `DELETE /privacy/delete` (cancel) | Requires typing the account e-mail and, if set, the password. **7-day cooling-off**, then hourly job anonymises the user row and deletes personal data (see §3). Notice e-mail sent. Statutory deadline stored as `due_at` (30 days) |
| Retention enforcement | `PrivacyService.enforceRetention`, `PrivacyScheduler` (hourly) | See `DATA_RETENTION_POLICY.md` |
| Request tracking | `privacy_requests` table, `GET /privacy/admin/requests` (admin) | Open requests ordered by deadline |
| CCPA "Do Not Sell or Share" | `SALE_SHARING` consent switch | Orion does not sell or share data; the switch records the opt-out |

Tests: `apps/api/src/modules/privacy/__tests__/privacy.integration.spec.ts` (real migrations on PGlite): consent ledger, export excludes secrets, deletion confirmation and cancellation, erasure result, retention.

## 2. Rights → how we answer them

| Right | GDPR | CCPA/CPRA | Self-service | Deadline |
|---|---|---|---|---|
| Access / know | Art. 15 | §1798.110 | Yes | 30 days (CCPA 45) |
| Portability | Art. 20 | §1798.130 | Yes (JSON) | 30 days |
| Rectification | Art. 16 | §1798.106 | Yes (profile) | 30 days |
| Erasure / delete | Art. 17 | §1798.105 | Yes (7-day delay) | 30 days |
| Withdraw consent | Art. 7(3) | opt-out of sale/share | Yes | immediate |
| Restrict / object | Art. 18, 21 | limit use of sensitive data | By e-mail to privacy office | 30 days |
| Complaint | Art. 77 | — | Policy names the right | — |

## 3. What deletion does

Deleted: saved searches, saved leads, API keys, refresh tokens, auth tokens, recovery codes, integrations and their deliveries, export schedules and jobs, rate overrides. Anonymised: the user row (e-mail becomes `deleted-<id>@deleted.invalid`, names, phone, avatar, organisation, OAuth ids, 2FA secret and password hash cleared; status `INACTIVE`; `deleted_at` set), IP and user agent in audit logs and consent records. Subscriptions are marked `CANCELLED`.

**Kept deliberately:** payment orders, invoices, refunds, credit ledger and unlock records (tax/accounting law), now linked only to the anonymised shell. Consent records stay as proof of consent.

**Not covered by code, must be done by hand or process:**
1. Data in **backups** ages out (12 months, see `BACKUP_AND_DISASTER_RECOVERY.md`). After any restore, re-apply deletions from the **deletion ledger** (`npm run db:ledger -- reapply`, Phase 16). The earlier instruction to use completed `DELETE` rows in `privacy_requests` was wrong: those rows live inside the restored database and are rolled back with it. Old backups themselves cannot be scrubbed.
2. **Third parties** that received the user's data (payment provider, e-mail provider, CRM the customer connected, error tracking). Erase or request erasure there and note it on the request.
3. **Object storage** files uploaded by the user (CSV uploads, exports): the 30-day purge handles the data rows; confirm bucket lifecycle rules delete the files.
4. A user with an **active paid subscription at the payment provider** must be cancelled there; the code only marks the local record.

## 4. Business decisions still open (owner: NOT SET)

- [ ] Legal entity name, registered address and EU/UK representative (if required) in the Privacy Policy.
- [ ] Data Protection Officer or privacy contact, and a monitored `privacy@` mailbox.
- [ ] Confirm legal bases and the 7-day delay with counsel; confirm tax-record retention period per jurisdiction.
- [ ] List of sub-processors (hosting, database, search, storage, payment, e-mail, analytics) published or available on request, with DPAs signed.
- [ ] International-transfer mechanism (SCCs / DPF) per sub-processor.
- [ ] Record of Processing Activities (Art. 30) — start from §1 and the schema.
- [ ] DPIA for the lead-intelligence data about **third-party business contacts** (`people` tables): those individuals are data subjects too. See `PEOPLE_SUPPRESSION.md`; give them a public opt-out/erasure channel and a "how we got your data" notice (GDPR Art. 14).
- [ ] If analytics is added, load it **only** when `analyticsAllowed()` in `ownus/src/lib/consent.ts` is true.
- [ ] Age: Terms must state the minimum age (16 in much of the EU; no knowingly collecting under-13 data in the US).
- [ ] Breach notification: 72 hours to the regulator from awareness; flow in `INCIDENT_RESPONSE_RUNBOOK.md` §6.

## 5. Operating procedure for requests that arrive by e-mail

1. Log it in `privacy_requests` (or a ticket) the day it arrives; the clock is 30 days.
2. Verify identity by replying to the account e-mail or asking the user to submit from Settings.
3. Export/delete through the user's own Settings flow, or an administrator runs the same service methods.
4. Confirm completion by e-mail; record third-party erasures.
5. Review `GET /privacy/admin/requests` weekly for anything within 7 days of `due_at`.

## 6. Change control

Bump `POLICY_VERSION` in **both** `apps/api/src/modules/privacy/privacy.config.ts` and `ownus/src/lib/consent.ts` when the policy changes materially, update the page date, and add a row to `DOCUMENT_CONTROL_REGISTER.md`.
