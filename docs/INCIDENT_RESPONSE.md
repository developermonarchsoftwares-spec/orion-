# Security incident response (Phase 13)

**Status: PROPOSED, NOT APPROVED. Not legal advice.** This document describes how an incident would be handled with the controls Orion has today. Names, phone numbers and the legal decisions are placeholders: fill them in the secret vault or the owner's records, not here. It extends `INCIDENT_RESPONSE_RUNBOOK.md` (outage playbooks, severity table, backup commands), which stays the quick reference for availability incidents. Nothing here says Orion has ever been or will be free of incidents.

## 0. What the investigator actually has

| Source | What it holds | Limits (stated plainly) |
|---|---|---|
| `audit_logs` table | Security and business events (list in section 7): actor account, action, entity, outcome, failure category, request correlation id, client address, user agent, values with secrets and personal contact details removed | An ordinary table. **Not tamper-proof or immutable**: anyone with write access to the database, including the application role, can edit or delete rows. Client address and user agent are blanked after 180 days (`DATA_RETENTION_POLICY.md`); the event itself is kept. The gateway writes a few events directly (export, business delete and status change). Events the application does not emit are simply absent (section 8) |
| Application log (JSON on stdout / stderr) | One line per event with `requestId`, `traceId`, `userId`; one access-log line per request (route pattern, status, duration, client address) | Retention is whatever the log platform is set to: **NOT SET**. No log shipping is built; if the platform keeps nothing, there is no history. Secrets and personal data are redacted before writing, so a line can say that something happened but not what the secret was |
| `ABUSE_SIGNAL` audit entries | "Subject X crossed threshold Y in window Z" for authentication failures, authorization refusals, rate-limit hits, unsafe webhook targets, export refusals, unlock refusals | In-memory counters, per process, reset on restart; a prompt to look, not proof of abuse; never blocks anyone |
| Traffic controls (`traffic_blocks`, admin IP rules, per-user limits) | Automatic and manual blocks with reason, source and expiry | Per-process caches; block events are audited (`TRAFFIC_*`) |
| Error tracker (`SENTRY_DSN`), traces (`OTEL_*`) | Exceptions and spans, scrubbed | Only if the operator configured them |
| `GET /exports/admin/audit` | Export events for administrators | Export events only. There is **no general audit-log API** in the NestJS service: other events are read with SQL by an authorised database user or through the gateway's activity-log screen |
| Database backups | Point-in-time copies (`BACKUP_AND_DISASTER_RECOVERY.md`) | Needed to compare "before and after"; restore only into a NEW database |

## 1. Roles (placeholders; one person may hold several in a small team)

| Role | Holder | Backup | Decides |
|---|---|---|---|
| Incident Coordinator | NOT SET | NOT SET | Severity, who is called, when the incident is closed |
| Engineering Lead | NOT SET | NOT SET | Containment actions on systems, remediation |
| Security Reviewer | NOT SET | NOT SET | What happened, scope of access, evidence quality |
| Privacy/Legal Reviewer | NOT SET | NOT SET | Whether personal data is affected, notification duties and wording (with qualified counsel) |
| Customer Communications Owner | NOT SET | NOT SET | What customers are told and when, approved by the Privacy/Legal Reviewer |
| Scribe | NOT SET | | Keeps the timeline (UTC) |

The Coordinator should not be the person debugging.

## 2. The workflow

`DETECTED → CONTAINED → INVESTIGATED → IMPACT ASSESSED → REMEDIATED → DOCUMENTED → CUSTOMER / REGULATORY NOTIFICATION WHERE REQUIRED`

Stages can overlap and an incident can go back a stage (a new finding while remediating). The order of containment and notification is a decision, not a sequence: notification clocks (if any apply) can start before investigation ends.

### 2.1 DETECTED
- **Purpose:** know that something may be wrong and start the record.
- **Responsible:** whoever notices; Incident Coordinator takes over.
- **Required actions:** open an incident record with a UTC start time and the reporter; note the signal (alert, customer report, `ABUSE_SIGNAL`, error spike, vendor notice, a found secret); assign a provisional severity (runbook section 1).
- **Evidence to preserve:** the original alert or message, screenshots only if they hold no secrets; the time you first saw it.
- **Escalate when:** any sign of exposed credentials, access to another customer's data, administrator misuse, personal data leaving the system, or money moving wrongly: treat as SEV1 until shown otherwise.
- **Exit:** record opened, roles assigned, severity set.
- **Document:** record id, reporter, signal, first-seen time.

### 2.2 CONTAINED
- **Purpose:** stop further harm without destroying evidence.
- **Responsible:** Engineering Lead, authorised by the Coordinator.
- **Required actions:** the smallest action that stops the harm (scenario table, section 3). **Before any destructive step** (deleting rows, wiping a server, rotating a key that also protects evidence) copy the relevant logs and audit rows (section 4). Prefer reversible controls: disable a feature, block an address, revoke a session or key, suspend an account, pause a worker.
- **Evidence:** the state before each action (who/what/when you changed), exported log and audit extracts.
- **Escalate when:** containment would take the service down for customers (Coordinator decides), or the attacker may still hold access after the action.
- **Exit:** the harmful activity has stopped and this is verified from fresh logs, not assumed.
- **Document:** every containment action with time, actor and reason.

### 2.3 INVESTIGATED
- **Purpose:** establish what happened and how.
- **Responsible:** Security Reviewer with the Engineering Lead.
- **Required actions:** build the timeline from audit rows and logs by correlation id; identify the entry point, the accounts, sessions, keys and records involved; separate facts from assumptions in writing. Use read-only queries on a copy where possible.
- **Evidence:** extracts with their query and time; hashes of exported files; the list of affected account and record identifiers (kept in the restricted evidence store, section 4).
- **Escalate when:** the entry point is not found, evidence is missing (log gap), or an insider or a vendor may be involved.
- **Exit:** a written account of the cause with confidence stated, and the list of what is unknown.
- **Document:** timeline, root cause (or "unknown"), data sources used and their gaps.

### 2.4 IMPACT ASSESSED
- **Purpose:** decide who and what was affected.
- **Responsible:** Security Reviewer and Privacy/Legal Reviewer.
- **Required actions:** complete the worksheet in section 5. Count affected customers and affected third-party individuals separately; state what was viewed versus what was extracted (an export or API response proves extraction; a database read may only prove access).
- **Evidence:** the worksheet, the extracts that support each line.
- **Escalate when:** personal data of any individual may be involved, money was affected, or another party's systems are involved.
- **Exit:** impact stated with a confidence level; open questions listed with an owner.
- **Document:** the signed-off worksheet.

### 2.5 REMEDIATED
- **Purpose:** remove the cause and restore trust in the system.
- **Responsible:** Engineering Lead; Security Reviewer verifies.
- **Required actions:** fix the cause (code, configuration, credentials); rotate everything that may have been seen (`CREDENTIAL_ROTATION_EXECUTION_PLAN.md`); revoke sessions and keys; restore services safely (section 6); run the verification list (section 6).
- **Evidence:** change references (commit, deployment), before and after test results.
- **Escalate when:** the fix needs a change that cannot be tested safely before release, or the cause is in a vendor system.
- **Exit:** the Security Reviewer has verified the fix and the access controls, including that suppression and masking still hold.
- **Document:** what was changed, how it was verified.

### 2.6 DOCUMENTED
- **Purpose:** learn and keep an accurate record.
- **Responsible:** Incident Coordinator and Scribe.
- **Required actions:** blameless review within 5 working days (runbook section 7): timeline, impact, cause, what worked, what failed, action items with owner and date; update the checkpoint, the gap report and this document where reality differed.
- **Evidence:** the final record, stored in the restricted evidence store.
- **Escalate when:** action items touch P0 or P1 findings: they go to the remediation plan.
- **Exit:** review published internally (no secrets, no personal data), actions tracked.
- **Document:** the review; a redacted summary for customers only if the Communications Owner decides so.

### 2.7 CUSTOMER / REGULATORY NOTIFICATION WHERE REQUIRED
- **Purpose:** meet legal, contractual and fairness obligations to those affected.
- **Responsible:** Privacy/Legal Reviewer decides; Customer Communications Owner sends.
- **Required actions:** see section 5. **This document does not state which law applies, which regulator must be told, or any deadline.** Those are legal determinations to be made with qualified counsel for the facts of the incident (see `LEGAL_REVIEW_CHECKLIST.md` when it exists). Contracts with customers and processors may add duties.
- **Evidence:** the legal reasoning and decision, the text sent, the recipients, the time sent.
- **Escalate when:** a deadline may be running; counsel is unreachable; the facts are still unclear but the decision cannot wait.
- **Exit:** a recorded decision (notify / not required, with reasons) and, where notifying, proof it was done.
- **Document:** decision record in the restricted evidence store.

## 3. Scenarios

Each row lists containment that fits Orion's current architecture and how to verify it. "Admin" means a user with the ADMIN or SUPER_ADMIN role. Where no application control exists the row says so.

| Scenario | First signals | Containment (reversible first) | Verification before closing |
|---|---|---|---|
| **Exposed credentials** (key in a repo, log, chat, ticket) | Secret scanner (`npm run test:secrets`), report, vendor alert | Rotate the exposed secret per `CREDENTIAL_ROTATION_EXECUTION_PLAN.md`. Signing secrets: rotating forces every user to sign in again. Database owner role: new credential, update the environment, redeploy. Payment keys: rotate with the provider. Revoke integration secrets (`INTEGRATION_SECRET_ROTATED`). Keep a copy of where the secret appeared before removing it | Old secret refused (try it once, expect failure); new secret in place; scanner clean; history exposure recorded (a secret in git history stays valid until rotated) |
| **Suspected account takeover** | `LOGIN_FAILED` bursts then `LOGIN_SUCCESS` from a new address; `ABUSE_SIGNAL` AUTH_FAILURE; `TOKEN_REUSE_DETECTED` (refresh-token replay; the session family is revoked); customer report | End the account's sessions: a password reset (the recovery flow) revokes every refresh token and rotates the session id, which ends access tokens on their next use. There is **no administrator button** that revokes one account's sessions (open item); the alternative is a database change by an authorised person that revokes the account's refresh tokens and rotates its `activeSessionId`, recorded in the incident log. Revoke its API keys (`API_KEY_REVOKED`); disable its integrations and export schedules; set the account status to SUSPENDED if abuse continues (no NestJS admin endpoint: a database change by an authorised person, recorded); block the address through the traffic admin rules if it is hostile | Audit trail shows no further actions after containment; unlock and export history reviewed for the window; customer re-verified through the account-recovery process (`ACCOUNT_RECOVERY.md`) |
| **Unauthorized administrative access** | `ADMIN_OTP_FAILED`, `ADMIN_OTP_NOT_AN_ADMIN`, `ADMIN_OTP_UNAUTHORIZED_DOMAIN`, `ADMIN_LOGIN_SUCCESS` at an odd time; changes in pricing or credits | Admin sessions are short-lived (12 hours by default) and ended by rotating the session id; rotate the signing secrets for an immediate global sign-out; remove the administrator role at the database (no application path exists to change roles; changes are made by whoever has database access); review every admin action in the window (`CREDIT_ADJUSTMENT`, `PRICING_SETTING_UPDATED`, `IMPORT_*`, `TRAFFIC_*`, `PEOPLE_*`, `ADMIN_BUSINESS_*`) | List of admin actions in the window reviewed and each either confirmed legitimate or reversed through the normal workflow with a reason; the single-factor-admin weakness (SG-07) noted if relevant |
| **Cross-customer data exposure** | Customer report; an object id in another account's logs; a failed authorization test | Disable the affected route or feature at the gateway or by configuration; if the cause is a missing ownership check, deploy the fix before re-enabling; do not delete data | Authorization test for the route added and run (`authorization.e2e-spec.ts` pattern); the set of rows another customer could have seen is computed from access logs and recorded for impact assessment |
| **Bulk data extraction** | `ABUSE_SIGNAL` EXPORT_REFUSED or RATE_LIMITED; `EXPORT_REFUSED` rows; unusually many `BUSINESS_UNLOCKED`; high `EXPORT_CREATED` row counts | Suspend or block the account; disable its export schedules (`EXPORT_SCHEDULE_DISABLED`) and API keys; remove stored scheduled files (`export_jobs.content`, 7-day retention) of the account after copying their metadata. **Files already downloaded cannot be recalled** | Row counts per account and per day compared with the daily cap (20,000); which datasets and how many contacts left; whether any suppressed or unpublished record was included (it should not be) |
| **Credit or billing manipulation** | `CREDIT_ADJUSTMENT` by an unexpected actor; reconciliation warnings (`npm run db:reconcile-credits`); payment verification failures (`PAYMENT_VERIFICATION_FAILED`) | Pause the credit scheduler and the affected admin routes; freeze the account; correct only through ledger entries, never by editing rows (`BILLING.md`) | Reconciliation run read-only against a copy first; every wallet change traceable to a ledger row and an audit row; provider events reconciled |
| **SSRF or internal-service exposure** | `ABUSE_SIGNAL` SSRF_REJECTED; unusual webhook delivery targets or response sizes; cloud-metadata request from the API host | Disable the integration (`INTEGRATION_DISABLED`); block the account; if a request reached an internal service, treat that service's credentials as exposed and rotate them (including cloud instance credentials); add the network-level egress block recommended in `SECURITY_GAP_REPORT.md` section 11 | Delivery log reviewed (30-day retention: export it first); the guarded client refuses the target in a test; egress filter confirmed by a connection attempt from the host |
| **Personal-data leakage** (contact data in a response, export, log or error) | Report; a test or scan finds a raw contact value; log review | Remove the route or the field from the response; purge or redact the affected log entries at the platform if it allows (record that you did); expire stored exports of the affected datasets | The leak path has a regression test; masked responses checked for the affected record types; log redaction test run; impact assessment lists the individuals and what was shown |
| **Suppression failure** (a removed or suppressed person reappears) | Customer or individual complaint; a suppressed identity found in search, unlock, export, or CRM data | Unpublish the record now (People: the suppression gate; company contacts: unpublish or remove the value directly, recorded); stop the ingestion path that re-created it; expire stored exports that include it. **Company-contact suppression is not built (SG-05)**: removal today is manual and does not prevent re-import | The identity is absent from search, detail, unlock history, exports and CRM sync; a re-import attempt is refused (People) or, for company contacts, the dependency is recorded as open; the complainant is told what was done |
| **Malicious or poisoned ingestion** | `IMPORT_*` batches from an unexpected source; hostile URLs or formula cells in imported data; sudden duplicate or quarantine volume | Pause the import queue and the People upload bridge; leave published data as is until reviewed, then unpublish the batch's records (no bulk "undo" exists: it is record-by-record or by batch id with an authorised script) | Records of the batch listed from the import tables; stored URLs and cells checked by the Phase 8 and Phase 9 guards; none published unreviewed (note SG-04: company imports publish regardless of `autoPublish`) |
| **Production dependency compromise** | Advisory, `npm audit`, vendor notice, unexpected network egress from the build | Stop deployments; pin the last known good lockfile; rebuild from a clean checkout; rotate every secret the build or runtime could read; review what the compromised package could have executed | Lockfile diff reviewed; `npm audit` and the secret scan clean; a clean rebuild deployed to a preview and checked before production |

Destructive actions (deleting data, wiping hosts, dropping tables) are never a first step: they need the Coordinator's written approval, an evidence copy, and a recovery path.

## 4. Evidence handling

1. **Preserve first.** Export the relevant `audit_logs` rows, application log lines and traffic-block rows for the window **before** retention jobs run: client address and user agent in `audit_logs` are blanked after 180 days, delivery logs after 30 days, finished jobs after 30 days. If the log platform keeps nothing, say so in the record.
2. **Query by correlation id and actor.** Example audit query (read-only, run by an authorised database user, adjust names): `SELECT created_at, action, entity_type, entity_id, user_id, ip_address, new_values FROM audit_logs WHERE user_id = '<account id>' AND created_at BETWEEN '<start>' AND '<end>' ORDER BY created_at;` and `... WHERE new_values->>'requestId' = '<request id>'`.
3. **Timeline:** one table in UTC (time, source, event, who/what, confidence), maintained by the Scribe; corrections are added as new lines, not edits.
4. **Restricted evidence store:** a location only the incident roles can read (NOT SET). Evidence may contain personal data and, despite redaction, must be treated as sensitive. Never paste it into tickets, chat or public reports. Record who accessed it.
5. **Protect from alteration:** work on copies; record a hash (for example SHA-256) of every exported file at the time of export; keep the original export read-only. Because `audit_logs` can be edited by anyone with write access, an extract is only as trustworthy as the database access control at the time; record who had write access.
6. **Identify affected credentials and sessions:** accounts seen in the window; their refresh-token families and active session ids; API keys (prefix only is stored); integrations and their secrets; any administrator OTPs. Revocation is per section 3.

## 5. Breach assessment worksheet

Fill one per incident. Mark each answer FACT, ESTIMATE or UNKNOWN.

| Question | Answer |
|---|---|
| Data categories affected (use `DATA_CLASSIFICATION.md`): public business data, business contact, individual work contact, personal contact, customer account, payment, security data | |
| Number of customer accounts affected; how identified | |
| Number of third-party individuals affected (contacts in company or People records); how counted | |
| Exposure start and end (UTC); duration; how known | |
| Access only, or extraction proven (export file, API response, copy)? Evidence | |
| Were secrets or tokens exposed? Which, and are they rotated? | |
| Potential harm to individuals (contact misuse, fraud, identity, discrimination, safety) | |
| Containment status now | |
| Contractual duties (customer agreements, processor agreements, payment provider rules) | NOT SET |
| Legal notification duties (which law, which body, which individuals, which deadline) | **Decided by Privacy/Legal Reviewer with qualified counsel. Not asserted here.** |
| Decision-makers and times (who decided, when, on what information) | |

Rules: do not wait for certainty to start the legal review; do not tell customers more than is known; do not state a cause before it is confirmed; do not promise outcomes.

## 6. Recovery and verification

1. Restore only into a **new** environment first (`BACKUP_AND_DISASTER_RECOVERY.md`); compare with the evidence copy; then switch traffic.
2. After a restore, re-apply completed deletion and suppression requests (`privacy_requests` rows of type DELETE and People suppression entries are the list); otherwise removed data returns from the backup.
3. Verification list before declaring REMEDIATED: health endpoints green; sign-in works and old sessions are refused; an unauthenticated and a cross-customer request are refused on the affected routes; locked contacts are masked and unlock still charges credits correctly; exports respect published-only and caps; suppressed People identities are refused on ingestion; the full API test suites pass; secret scan clean; audit rows appear for a test login, a test export and a test admin action.
4. Record lessons learned and update this document, the gap report and the checkpoint.

## 7. Audit events available (Phase 13)

Authentication: `USER_REGISTERED`, `OAUTH_REGISTRATION`, `LOGIN_SUCCESS`, `LOGIN_FAILED` (categories UNKNOWN_ACCOUNT, BAD_PASSWORD, ACCOUNT_INACTIVE, EMAIL_NOT_VERIFIED), `LOGIN_BLOCKED` (account lockout), `LOGIN_MFA_CHALLENGED`, `MFA_FAILED`, `LOGOUT`, `TOKEN_REUSE_DETECTED` (a replayed refresh token; the session family is revoked), `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_FAILED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED`, `ADMIN_OTP_GENERATED`, `ADMIN_OTP_FAILED`, `ADMIN_OTP_NOT_AN_ADMIN`, `ADMIN_OTP_UNAUTHORIZED_DOMAIN`, `ADMIN_LOGIN_SUCCESS`, `ADMIN_LOGOUT`.
Money and access: `CREDIT_ADJUSTMENT` (atomic with the change), `PRICING_SETTING_UPDATED`, `PAYMENT_VERIFIED`, `PAYMENT_VERIFICATION_FAILED`, `TOPUP_VERIFIED`, `PAYMENT_REFUNDED`, `BUSINESS_UNLOCKED`, `PERSON_UNLOCKED`, `API_KEY_CREATED`, `API_KEY_REVOKED`.
Data: `EXPORT_CREATED`, `EXPORT_FAILED`, `EXPORT_REFUSED`, `EXPORT_DOWNLOADED`, `EXPORT_SCHEDULE_*`, `IMPORT_BATCH_SUBMITTED`, `IMPORT_RECORD_CORRECTED`, `IMPORT_FAILED_ROWS_RETRIED`, `IMPORT_PEOPLE_REPROCESSED`, `PEOPLE_*` (publish, edit, reject, quarantine, suppress), `INTEGRATION_*`, `PRIVACY_EXPORT`, `PRIVACY_DELETE_REQUESTED`, `PRIVACY_DELETE_CANCELLED`, `PRIVACY_DELETE_EXECUTED`; gateway: `EXPORT_CREATED`, `ADMIN_BUSINESS_DELETE`, `ADMIN_BUSINESS_STATUS_UPDATE`.
Controls: `TRAFFIC_AUTO_BLOCK`, `TRAFFIC_BLOCK_CREATED`, `TRAFFIC_BLOCK_RELEASED`, `TRAFFIC_IP_RULE_*`, `TRAFFIC_USER_LIMIT_*`, `ABUSE_SIGNAL`.

## 8. Monitoring gaps (manual today)

- No alert reads `ABUSE_SIGNAL`; someone must look. No pager integration is built.
- Not recorded as audit events: role or status changes (there is no application path; database changes are invisible to the application), rejected-access detail per request (counted into `ABUSE_SIGNAL` only), subscription changes outside the payment events, company-contact corrections and suppressions (no workflow exists), reads of audit data by administrators, direct database access.
- Detection that remains manual: unusual export volume across many accounts, slow credential stuffing below the thresholds, abuse that spreads across several addresses, data copied by someone with legitimate access.
- No log shipping or off-host copy of the audit table is built.

## 9. External actions the operator must take
Set log-platform retention and access; choose the restricted evidence store; name the roles in section 1; restrict database write access to `audit_logs` to a dedicated role (the application role currently owns the table); configure the error tracker and alert thresholds (`SECURITY_SIGNAL_*` variables are optional); decide a legal-hold procedure; arrange qualified counsel for notification decisions; run a tabletop exercise of one scenario and record the result.

## 10. Restore after an incident: do not resurrect deleted data (Phase 16)

A restore returns the database to the backup's moment. Everything deleted or suppressed after it comes back unless the deletion ledger is re-applied. Keep the API and queue workers stopped, restore, run `npm run db:ledger -- reapply` (dry run, then apply; see `BACKUP_AND_DISASTER_RECOVERY.md` §5 step 6), check the `POST_RESTORE_RECONCILED` audit entry, then start services and re-index search. If a restored database was ever served before the ledger was applied, treat the window as a privacy incident: list which erased accounts and suppressed contacts were visible (the ledger's ids, `audit_logs` access events) and assess notification under section 2.7.

Audit events added in Phase 16: `RETENTION_JOB_STARTED`, `RETENTION_JOB_COMPLETED`, `RETENTION_JOB_FAILED`, `CONTACT_SUPPRESSION_ADDED`, `CONTACT_SUPPRESSION_REAPPLIED`, `POST_RESTORE_RECONCILED`. Counts and opaque ids only.

## 11. Alerts as the entry point (Phase 24)
An incident can start from a monitoring alert. Triage with `SECURITY_MONITORING_RUNBOOK.md` (alert catalogue RB-1 to RB-15, evidence sources, containment with existing administrator tools, false-positive handling); when an alert is judged to be a real incident, continue from section 2 of this document. New audit events available to investigators: `PRIVACY_DELETE_FAILED`, and the alert ids `sec_abuse_signals`, `sec_token_reuse`, `sec_login_lockouts`, `sec_admin_signin_failures`, `sec_privacy_processing_failed`, `sec_payment_verification_failed`, `sec_publication_refused`, `sec_credit_adjustments`, `sec_export_failures`, `security_monitoring_unavailable`.

## 11. Containment commands and what simulation proved (added in Phase 31)

Full report: `SECURITY_INCIDENT_SIMULATION_REPORT.md`. Tested on synthetic accounts by an authorised database user:
- **Revoke renewal:** `UPDATE refresh_tokens SET is_revoked = true, revoked_at = now(), revoked_reason = 'INCIDENT' WHERE user_id = '<id>' AND is_revoked = false;` The next refresh answers 401. **An access token already issued keeps working until it expires (15 minutes by default).**
- **Stop the account at once:** `UPDATE users SET status = 'SUSPENDED' WHERE id = '<id>';` The next request with the same access token is refused (401) and sign-in answers 403; the account cannot undo it.
- **Block an address / restrict an account:** administrator routes `POST /traffic/blocks`, `PUT /traffic/users/:id/limits` (audited as `TRAFFIC_BLOCK_CREATED`, `TRAFFIC_USER_LIMIT_SET`). A block does not apply to the health probes and the payment webhook.
- **Record what you did.** The two database actions above write no audit row: `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values) VALUES (NULL, 'INCIDENT_CONTAINMENT', 'user', '<id>', '{"role":"responder","ticket":"<ticket>","step":"suspend"}');`
- **Not possible in one step:** freezing publication (revoke the source, or suspend the administrator account); listing audit rows through the API (use the database or the gateway's administrator activity view).
- Alerts are not proof of delivery: every alert test used a local receiver. Send one test alert to the real destination when it exists.
