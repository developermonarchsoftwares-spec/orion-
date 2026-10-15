# Data retention, deletion and backup lifecycle

**Status: PROPOSED — NOT APPROVED.** Periods marked "enforced" are what the code does today (`apps/api/src/modules/privacy/privacy.config.ts`); a period marked **DECISION** is not enforced until the business owner (and, for legal periods, qualified counsel) approves it. Nothing in this document is legal advice, and no statutory retention period is asserted here. Created 2026-10-07; rewritten for Phase 16 on 2026-10-12.

Principle: keep personal data only as long as its purpose requires, then delete it or strip the identifying fields; never describe data as deleted when only its visibility changed.

## 1. Data inventory

"Trigger" is what starts the clock. "Method" is how the data leaves. Every row names the copies that must be covered.

| # | Category | Where | Why kept | Trigger | Period | Method | Copies to cover |
|---|---|---|---|---|---|---|---|
| 1 | Customer account profile, saved searches/leads, API keys, integrations, export schedules and jobs | `users` and user-owned tables | Provide the service | Account life | Life of account | `eraseAccountData` after a 7-day cancel window (enforced) | Database, backups (§5), export files (inside `export_jobs`) |
| 2 | Anonymised account shell | `users` (`deleted_at` set) | Foreign keys of financial records | Erasure | **DECISION** (no personal data left; kept so invoices keep a reference) | None: it holds no personal data | Ledger lists its id (§4) |
| 3 | Sessions and tokens | `refresh_tokens`, `auth_action_tokens`, `user_recovery_codes`, `admin_otps` | Authentication | Expiry | Until expiry (+ grace); admin OTPs 24 h after expiry (enforced) | Hourly cleanup; deleted at erasure | Database |
| 4 | Credits, unlocks, invoices, payments, refunds, subscriptions | `credit_transactions`, `lead_unlocks`, `person_unlocks`, `payment_orders`, `invoices`, `refunds`, `user_subscriptions` | Accounting, tax, dispute handling | Transaction | **DECISION: counsel to confirm per jurisdiction** (the earlier "6–10 years" figure is an unverified placeholder) | Kept after erasure with the account id only; no automatic deletion | Database, backups |
| 5 | Business profiles | `businesses`, `business_details` | The product | Publication | Life of the record, subject to source revocation and removal requests | Unpublish (reversible) vs delete (§3) | Database, search index, backups |
| 6 | Company contacts (named people, e-mail, phone, LinkedIn) | `business_contacts` | The product | Import | Life of the record, subject to suppression | Row delete (CONTACT scope) or value cleared (FIELD scope); trigger blocks re-entry | Database, exports, backups |
| 7 | People (individuals) and their contacts | `people`, `person_contacts`, `company_people`, observations/evidence | The product | Ingestion | Life of the record, subject to suppression | Suppress (hide + register digest); hard delete is a separate administrator action | Database, backups |
| 8 | Import batches, rows, validation | `import_batches`, `import_records` (`raw_payload`, `normalized_payload`), `validation_logs` | Provenance, re-validation, publish review | Batch end | Raw/normalised payload: **DECISION** — rule exists, **off** until `RETENTION_IMPORT_RAW_PAYLOAD_DAYS` is set. When set it blanks payloads of published rows and of FAILED/CANCELLED batches only | `runRetention` (batched) | Database, uploaded CSV in object storage |
| 9 | Uploaded CSV files | Object storage | Re-processing | Upload | 30 days (policy statement, **not enforced by code**) | Bucket lifecycle rule — **confirm configured** | Bucket and its versions |
| 10 | Source register, trust decisions | `data_sources` | Provenance | Source life | Life of source | Not personal data | Database |
| 11 | Search index (Typesense) | Typesense | Derived | Publication | Rebuilt from the database; carries flags, not contact values | Rebuild after restore/suppression | Index (rebuild after the ledger is applied) |
| 12 | Audit events | `audit_logs` | Security, accountability | Event | IP and user agent blanked after **180 days** (enforced). **The events themselves have no expiry — DECISION** (recommend a fixed period, e.g. 1–2 years, chosen by the owner) | Blank (enforced); delete (not implemented) | Database, backups, any log shipping |
| 13 | Consent ledger | `consent_records` | Proof of consent | Consent | Row kept; IP/UA blanked after **3 years** (enforced) | Blank | Database |
| 14 | Privacy requests | `privacy_requests` | Proof the request was handled | Completion | **3 years** after completion (enforced). Holds a SHA-256 of the e-mail address, which is guessable and therefore pseudonymous, not anonymous | Delete row | Database, backups |
| 15 | Data-subject requests (non-customers) | `data_subject_requests` (table exists; **no service or route yet — Phase 11 unfinished**) | Handle removal/suppression | Request | **DECISION** once the workflow exists | n/a | n/a |
| 16 | Suppression register | `contact_suppressions`, `people_suppressions` | Prevent a removed value being re-added | Request | **Indefinite by design**; digest only (§4) | Cannot be edited or deleted (database triggers) | Database, **deletion ledger** |
| 17 | Application logs, traces, error tracker | Log platform | Operations | Event | **NOT SET** — recommend 30–90 days, personal data redacted at source (Phase 13) | Platform setting | Log platform |
| 18 | Background jobs and webhook deliveries | `queue_jobs`, `integration_deliveries` | Operations | Completion | 30 days, finished jobs only (enforced); waiting/active jobs are never removed | `runRetention` | Database |
| 19 | Generated exports | `export_jobs.content` (scheduled exports only) | Let the owner download | Creation | Until `expires_at`, then file removed and row kept as `EXPIRED` (enforced by the export scheduler) | `purgeExpired` | Database, backups |
| 20 | Database backups | Backup directory / bucket | Recovery | Backup | 7 daily / 4 weekly / 12 monthly (documented; enforced by `backup.sh` locally, by bucket lifecycle remotely — **confirm**) | Prune + lifecycle; each removal logged in `backup-manifest.log` | See §5 |
| 21 | Deletion ledger | `ledger/` beside the backups | Re-apply deletions after a restore | Every backup | Newest is the one used; 30 kept (`RETAIN_LEDGER`) | Prune | Same protection as backups |

## 2. Retention enforcement (what runs, and its limits)

- **Where:** `PrivacyService.runRetention` (hourly via `PrivacyScheduler`; manual via `npm run db:retention`). One rule per row of §1 marked "enforced".
- **Bounded:** every rule works in batches of 1,000 rows, at most 20 batches per run (`RETENTION_RUN`). A rule that fills every batch is reported as *capped*; the next run continues. A backlog is never one long lock.
- **Retry-safe:** each batch selects by primary key and the condition is re-evaluated each time, so a half-finished run, a crash or a repeat changes nothing already done.
- **Independent rules:** a failing rule is reported by PostgreSQL error code only (never the message, which can contain SQL and values); the other rules still run; the failure is audited as `RETENTION_JOB_FAILED`.
- **Preview:** `npm run db:retention` (default) and `RETENTION_DRY_RUN=true` for the scheduler count what is eligible and change nothing.
- **Production safety:** the manual script refuses any non-local database (even for a dry run); applying also needs `--apply`, `CONFIRM_DESTRUCTIVE_DATABASE=<name>` and a verified backup under 24 h old. The in-app scheduler is the only thing that runs in production, and `RETENTION_DRY_RUN` can hold it in preview.
- **Audit:** `RETENTION_JOB_STARTED/COMPLETED` for manual runs; `COMPLETED` for scheduled runs only when something changed; `FAILED` always. Counts only.
- **Kept on purpose (no rule touches these):** payment orders, invoices, refunds, credit ledger, the anonymised user shells, unlock rows, audit events, consent rows (only their IP/UA), the suppression register, waiting/active jobs. Each exclusion is listed in §1 with its reason; changing one needs an approved decision.
- **Known inconsistency:** `QueueService.pruneOldJobs` defaults to 7 days while the policy rule uses 30; the shorter one wins in practice. Harmless for privacy (it deletes sooner), noted for tidiness.

## 3. Deletion: five different things

The system distinguishes them. Reports and the UI must use the right word.

| Action | What happens | Reversible? | Is the personal data gone? |
|---|---|---|---|
| **Unpublish** (remove from discovery) | `status` / `is_published` changes | Yes | **No.** Still in the database, exports of prior unlocks, backups |
| **Restrict** (source revoked, held back) | Publication blocked by trigger | Yes | **No** |
| **Delete personal fields** (FIELD suppression) | The e-mail/phone/LinkedIn value is set to NULL, verification reset | No | The value is gone from live tables; **old backups still hold it** |
| **Delete the contact / record** (CONTACT suppression) | `business_contacts` row deleted | No | Gone from live tables; old backups still hold it |
| **Erase an account** | `eraseAccountData`: personal data deleted/anonymised, financial rows kept without identity | No | Gone from live tables; old backups still hold it |
| **Suppression marker** | One-way digest kept so the value cannot return | Cannot be removed | n/a — contains no readable personal data |

**Do not claim permanent deletion** until §5's backup expiry has passed for every backup that held the data.

### Coverage when an account is erased (`eraseAccountData`)

| Store | Result |
|---|---|
| Saved searches/leads, API keys, refresh/action tokens, recovery codes, integrations (+deliveries, sync records), export schedules and **export jobs including stored files**, rate overrides | Deleted |
| User row | Anonymised shell (email `deleted-<id>@deleted.invalid`, names, phone, organisation, OAuth ids, avatar, 2FA secret, metadata cleared) |
| Audit events: IP/UA of the account | Blanked |
| Audit events about the account itself (`entity_type='user'`): old/new values | **Cleared (Phase 16)** — they could hold the old e-mail or name |
| Consent rows | IP/UA blanked; rows kept as proof |
| Subscriptions | Cancelled |
| Financial rows, unlock rows | Kept, account id only |
| Pending deletion request | Marked COMPLETED in the same transaction |
| Search index | Users are not indexed |
| Access tokens already issued | Short-lived; the account row is INACTIVE and the session id is cleared |
| Backups | **Not scrubbed.** Covered by the ledger on restore (§4) |

Not implemented: a legal-hold flag that suspends deletion (the old policy text required it; there is no field for it). Recorded as an open item.

## 4. Suppression and re-ingestion

**Company contacts** (`contact_suppressions`, migration 0024): `identity_kind` (EMAIL, PHONE, LINKEDIN) + SHA-256 digest of the *normalised* value + scope + a short reason code. No value, name or company. Rows cannot be edited (except widening FIELD→CONTACT) or deleted: database triggers refuse it, so no application bug or admin route can drop one. Normalisation is one SQL function used by the trigger and the application: e-mail trimmed and lower-cased; phone last 10 digits (so `+91 98765-43210` = `09876543210`); LinkedIn host+path without scheme, `www.`/country sub-domain, query, fragment or trailing slash. A phone suppression never removes the contact, only the number (a number can be shared); matching is exact on the normalised value, so unrelated businesses and people are not blocked.

| Re-entry path | Covered by |
|---|---|
| CSV re-import, repeated batch, import publishing, enrichment, scripts, manual admin edit, direct SQL | Trigger `business_contacts_suppression_guard` on every insert/update |
| Duplicate merge | Merge writes `business_contacts`; the trigger applies |
| Search-index rebuild | The index is built from `business_contacts`/`businesses`; a suppressed value is no longer in them |
| Backup restore | The deletion ledger (below) |
| People (individuals) | `people_suppressions` registry (Phase 6.4), checked at ingestion |

**Gap, stated plainly:** the register is only populated by `ContactSuppressionService.suppress` (new in Phase 16). There is **no customer- or requester-facing intake, no admin screen and no route** that calls it — Phase 11's workflow (`data_subject_requests` service/API) was never finished. Until then a removal request is handled by an operator calling the service. Exports of already-unlocked data are not retro-filtered (SG-05 remains partly open).

**Deletion ledger** (`deletion-ledger.ts`): a JSON file produced by every backup run, stored beside — never inside — the dump. Contents: contact-suppression digests, People-registry digests, ids of suppressed People, ids of erased accounts, a checksum. No name, e-mail, phone or company. `reapply` runs in one transaction (all or nothing), is idempotent, and has a dry run that rolls back. It: re-inserts suppressions, removes/clears matching contacts, re-suppresses People (hidden, roles rejected, contacts unpublished), re-erases accounts with the same code as live erasure, reconciles `privacy_requests`, and writes `POST_RESTORE_RECONCILED` (counts only).

Limits: a checksum, not a signature — protect the ledger like the backups. The ledger cannot undo anything that happened *after the ledger itself was generated* (back up often; generate the ledger at least as often as the dump). It cannot scrub the old dumps.

## 5. Backup lifecycle

- **Schedule and retention:** `ops/backup/backup.sh`; 7 daily / 4 weekly / 12 monthly; local pruning by the script (each removal logged with a confirmation), remote by bucket lifecycle (**confirm it is configured**). A deleted person's data therefore remains in backups for **up to ~12 months**; this must be stated in the privacy notice. A shorter monthly tier is a **DECISION**.
- **Integrity:** SHA-256 written and re-verified immediately; `pg_restore --list` structural check; restore re-verifies before use. Results and every create/expire/failure event go to `backup-manifest.log` (no data).
- **Encryption:** AES-256 GPG with a passphrase *file*; the script refuses nothing but now warns loudly (manifest + stderr) when unencrypted. The passphrase is never logged or placed in the environment. Encrypted storage does **not** by itself satisfy a deletion request: the data is still recoverable by whoever holds the key.
- **Access:** `umask 077` for dumps, ledgers and temporary decrypted files; restore decrypts to `mktemp` and removes it on exit. Bucket access policy, versioning and public-access block **cannot be verified from the repository** — see the manual list in §7.
- **Alerts:** a failure pings `BACKUP_PING_FAIL_URL`; a missing run is caught by the dead-man ping. The ping carries no data. A missing ledger is a warning in the manifest and on stderr.
- **Recovery objectives:** proposed in `BACKUP_AND_DISASTER_RECOVERY.md` §2; not approved; no restore drill recorded.

## 6. Decisions pending approval

| ID | Decision | Owner |
|---|---|---|
| D-RET-1 | Statutory period for financial records, per jurisdiction | Counsel / finance |
| D-RET-2 | Period for `import_records` raw/normalised payloads (switches on `RETENTION_IMPORT_RAW_PAYLOAD_DAYS`) | Business owner |
| D-RET-3 | Expiry for audit events (not implemented; app-role deletes would also need a tamper-protection decision) | Business owner / security |
| D-RET-4 | Application log retention | Operations |
| D-RET-5 | Whether the 12-month monthly backup tier is acceptable given deletion requests | Business owner / counsel |
| D-RET-6 | Legal-hold field and process | Counsel |
| D-RET-7 | Uploaded-CSV lifecycle rule value, and confirmation it exists | Operations |
| D-RET-8 | Finish the data-subject-request workflow (Phase 11) and who may run suppressions meanwhile | Business owner |
| D-RET-9 | Allow `deletion-ledger reapply` against a **remote** restored production database (today refused by design) — needs a written change request | Business owner |

## 7. Manual production actions (cannot be done or verified from the repository)

1. Confirm the backup bucket is private (public-access block on), versioned, encrypted at rest, and reachable only by the backup role and named people; confirm the lifecycle rules match §5 (daily 7 d, weekly 28 d, monthly 365 d, ledger prefix).
2. Confirm the uploaded-CSV bucket lifecycle rule (30 days) exists, including non-current versions.
3. Set `BACKUP_PASSPHRASE_FILE`, store two vault copies of the passphrase held by different people; do not rotate live keys without a plan to re-encrypt or retain the old key for the life of the old backups.
4. Install the backup cron and the dead-man ping; make sure the ledger step works in that environment (Node + repository present) — the manifest shows `LEDGER` or `WARNING ledger-missing`.
5. Decide D-RET-1 to D-RET-9; set `RETENTION_IMPORT_RAW_PAYLOAD_DAYS` only after D-RET-2.
6. Run `npm run db:retention` (dry run) against a **copy** of production and review the counts before the first scheduled run is trusted; run one restore drill with a ledger re-apply and record it in `BACKUP_AND_DISASTER_RECOVERY.md` §8.
7. Update the privacy notice: deleted data remains in backups until they expire.
8. Apply migrations 0024 and 0025 only through the approved migration process (0024 carries the suppression triggers this phase relies on; verify it is applied where you expect it).

## Rules
- A new table that stores personal data must be added to §1, to `PrivacyService.exportData`, to `eraseAccountData`, and to the ledger if it records deletions.
- Review yearly and after any change in `PRIVACY_COMPLIANCE.md` §4.
