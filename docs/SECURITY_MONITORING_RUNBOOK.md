# Security monitoring runbook

**Status: DRAFT, not exercised.** Written in Phase 24 (2026-10-12) for the operators who will receive and act on security alerts. It does not replace `INCIDENT_RESPONSE.md` (classification, notification, evidence handling, breach worksheet) or `INCIDENT_RESPONSE_RUNBOOK.md`; once an alert is judged to be a real incident, those take over. Rules and thresholds: `SECURITY_MONITORING_PLAN.md`.

**Not invented here:** no dashboard other than the one the API serves, no alert-delivery guarantee, no on-call rota. Roles are placeholders until people are named.

Never paste secrets, tokens, passwords, one-time codes or customers' personal data into a ticket, chat or alert reply. Use event ids, counts and opaque identifiers.

## 1. Roles (placeholders)

| Role | Does | Name / channel |
|---|---|---|
| First responder (`[ON-CALL ENGINEER]`) | Acknowledges the alert, runs the first checks below, contains | NOT SET |
| Security approver (`[SECURITY APPROVER]`) | Decides containment beyond the standard actions, declares an incident | NOT SET |
| Privacy owner (`[PRIVACY OWNER]`) | Any event involving personal data or removal requests | NOT SET |
| Release owner (`[RELEASE OWNER]`) | Rollback and communication decisions | NOT SET |
| Database operator (`[DATABASE OPERATOR]`) | Restores, read-only evidence queries on request | NOT SET |

Escalation order for a **critical** alert: first responder, within the agreed response time (NOT SET) to the security approver; privacy owner is added whenever personal data may be involved. A **warning** is reviewed during working hours (NOT SET) and escalated if a second related alert appears.

## 2. Where alerts come from, and what must be configured outside the repository

| Source | Where the operator sees it | External configuration needed |
|---|---|---|
| Operational and security alerts | the webhook message (`[service · environment] 🔴/🟠 title: detail`), the administrator dashboard `/api/v1/monitoring/dashboard`, `GET /api/v1/monitoring/alerts` | `MONITORING_ALERT_WEBHOOK_URL` pointing at a **public HTTPS** receiver (an internal address is refused); the receiver must notify a person |
| Errors | error tracker, `GET /api/v1/monitoring/errors` | `SENTRY_DSN` |
| Metrics | Prometheus scrape of `/api/v1/metrics` | `METRICS_TOKEN`, a scraper, alert rules there if wanted |
| Backups | `backup-manifest.log`, ping receiver | `BACKUP_PING_OK_URL`, `BACKUP_PING_FAIL_URL`; the receiver must alert on a failure **and on a missing run** |
| Uptime / startup | `GET /api/v1/health/live` and `/ready` | an external uptime check; host restart notifications |
| CI | the CI platform | commit and run `.github/workflows/test.yml`; platform failure notices |

Until each of these exists and has been proven to reach a person, the corresponding alert is **not operational**. The first tasks of whoever takes this runbook over are in section 9.

## 3. Reading the evidence (authorised operators only)

- **Dashboard / API:** sign in as an administrator; `GET /api/v1/monitoring/alerts` lists what is firing with counts; `/overview` adds request, error, queue and database state.
- **Audit trail:** the NestJS API has no audit-read route; the web gateway offers administrators a read-only view of the last 50 rows (`GET /api/v1/admin/activity-logs`, shows actor e-mail and event details: treat as personal data). For anything longer a `[DATABASE OPERATOR]` can run read-only queries on `audit_logs` (columns: `action`, `entity_type`, `entity_id`, `user_id`, `ip_address`, `new_values`, `created_at`). Example, counts per action in the last hour:
  `SELECT action, count(*) FROM audit_logs WHERE created_at > now() - interval '1 hour' GROUP BY action ORDER BY 2 DESC;`
  Treat the output as personal data: do not copy it into tickets; record action names, counts and time ranges.
- **Request correlation:** every API answer carries a request id; the JSON log line and the audit row (`new_values.requestId`) share it.
- **Logs:** from the platform where JSON stdout is collected (EXT). Search by `requestId`, `traceId`, `context`, `level`.

## 4. Alert catalogue and first response

Each entry: what it means, the first checks, immediate containment, what a false positive looks like. Containment actions are the administrator tools that exist today; none is automatic.

### RB-1 `sec_login_lockouts` / `sec_abuse_signals` (AUTH_FAILURE): credential guessing
- **Checks:** counts of `LOGIN_FAILED` vs `LOGIN_BLOCKED` vs `ABUSE_SIGNAL`; how many distinct subjects; whether one address or many (credential stuffing uses many).
- **Contain:** if one address dominates, add an IP rule or a temporary block (`POST /api/v1/traffic/ip-rules` or `/traffic/blocks`, administrator; removable). For many addresses, raise the sign-in friction only with the security approver; do **not** disable accounts on this signal alone.
- **False positive:** a shared office network, a script with a rotated password, a mis-typed saved password on many devices after a password reset.
- **Close when:** counts back below the warning level for two windows and no successful sign-in followed a burst for the same account.

### RB-2 `sec_admin_signin_failures`: administrator sign-in
- **Checks:** which actions (`ADMIN_OTP_FAILED`, `ADMIN_OTP_NOT_AN_ADMIN`, `ADMIN_OTP_UNAUTHORIZED_DOMAIN`, `MFA_FAILED`); whether `ADMIN_LOGIN_SUCCESS` followed.
- **Contain:** tell the administrators; if a success followed an unusual burst, treat as a possible takeover (RB-3 steps) and involve the security approver.
- **False positive:** an administrator mistyping a code.

### RB-3 `sec_token_reuse`: refresh token presented twice
- **Meaning:** a session was replayed or stolen; the token family is revoked by the application.
- **Checks:** affected accounts (from audit rows, by an authorised operator); recent password or e-mail changes on them.
- **Contain:** force sign-out (password reset flow rotates the session id); contact the account owner through the account's registered address only.
- **False positive:** a client that retries a refresh after a network timeout.

### RB-4 `sec_abuse_signals` (AUTHZ_DENIED / UNAUTHENTICATED): forbidden or unauthenticated requests
- **Checks:** the kind in `entity_id`; subjects; paths from the access log (by request id).
- **Contain:** as RB-1 for an address; for an account, contact the owner.
- **Limit:** requests for other customers' objects return 404 and are not counted (gap G-4).

### RB-5 `sec_abuse_signals` (EXPORT_REFUSED / UNLOCK_REFUSED) and `sec_export_failures`
- **Checks:** `EXPORT_CREATED` volume for the subject, daily cap hits, failed exports; whether the account is new.
- **Contain:** temporary per-user limit (`PUT /api/v1/traffic/users/:userId/limits`, removable); suspend only with the security approver.
- **False positive:** an automation that retries after the daily limit; ordinary "not enough credits".

### RB-6 `sec_credit_adjustments`
- **Checks:** who performed the adjustments (`user_id`), amounts and reasons in `new_values`; compare with the support tickets.
- **Contain:** suspend the administrator account if the adjustments are not explained; run `npm run db:reconcile-credits` (read-only).

### RB-7 `sec_publication_refused`
- **Checks:** which source, which administrator; whether the source is genuinely unreviewed.
- **Contain:** none needed by default; ask the administrator. Repeated attempts after an explanation go to the security approver.

### RB-8 `sec_abuse_signals` (SSRF_REJECTED)
- **Checks:** the customer integration being created or edited; the rejected target is in the access log by request id, not in the alert.
- **Contain:** disable the integration (`INTEGRATION_DISABLED` flow) and contact the customer.

### RB-9 CI secret-scan failure
- **Checks:** the failing job's report (it prints fingerprints, never values). Treat any real finding as exposed: rotate first, clean history second (`SECURITY_REMEDIATION_SG02.md`).

### RB-10 API will not start / configuration failure
- **Checks:** the startup message names the variable and the rule that failed (missing, placeholder, short, localhost CORS); never prints values.
- **Contain:** fix the setting in the intended secret store; do not weaken the check. Roll back the release if the previous configuration is known good (`PRODUCTION_DEPLOYMENT_RUNBOOK.md` section 9).

### RB-11 Backup failure or missed run
- **Checks:** the last lines of `backup-manifest.log`; ping receiver history; free disk; credentials of the backup role.
- **Contain:** run `ops/backup/backup.sh` by hand once the cause is fixed; a day without a backup is recorded in the incident log.

### RB-12 `sec_privacy_processing_failed`
- **Checks:** `RETENTION_JOB_FAILED` / `PRIVACY_DELETE_FAILED` rows: `new_values.code` is a PostgreSQL error code; the API log names the failing rule. The jobs retry hourly.
- **Contain:** none for the data; escalate to the privacy owner if a deletion request is near its 30-day deadline (`GET /api/v1/privacy/admin/requests`).

### RB-13 `sec_abuse_signals` (RATE_LIMITED)
- **Checks:** the dashboard `protection` counters (`limited`, `autoBlocks`); whether the volume is one client or many.
- **Contain:** as RB-1.

### RB-14 `sec_payment_verification_failed`
- **Checks:** payment ids in the rows; the provider's dashboard (EXT) for the same references.
- **Contain:** keep payments disabled if tampering is plausible (R-004).

### RB-15 `security_monitoring_unavailable`
- **Meaning:** the security rules could not read the audit trail. Treat as monitoring blind, not as "quiet".
- **Checks:** database health (`db_*` alerts), the slow-query timeout (4 s), table permissions.
- **Contain:** restore database access; until then review `audit_logs` by hand daily.

### Operational alerts (`http_errors`, `db_down`, `queue_*`, `search_*`, `heap`, `event_loop`)
These are not security alerts; they are handled by the on-call engineer from the dashboard. A cluster of them together with a security alert is escalated.

## 5. False-positive handling
1. Record the alert id, time, counts and the reason it was not a threat, in the incident log (no personal data).
2. If the same rule produced three false positives in a month, propose a threshold change (`SECURITY_MONITORING_PLAN.md` section 4) to the security approver; apply it by environment variable; record the change.
3. Never close an alert by deleting audit rows. Alerts resolve by themselves when the window passes.

## 6. Evidence preservation
- Export the relevant audit rows (action names, counts, time range, request ids) and the matching JSON log lines **before** retention can remove them (IP and user agent are blanked after 180 days; log retention is NOT SET).
- Keep copies in the access-controlled incident folder of `INCIDENT_RESPONSE.md`; record who read them and when.
- Do not alter production data to "tidy" evidence. The audit table is not tamper-evident (R-012): if an intruder with database access is suspected, preserve a database snapshot first.

## 7. Privacy-safe incident documentation
Write incidents with: alert id, rule, time window, counts, systems affected, actions taken, decisions and who made them. Leave out names, e-mail addresses, addresses, payment details and message contents; refer to rows by request id or audit id. If personal data may have been exposed, hand over to the privacy owner and the breach worksheet in `INCIDENT_RESPONSE.md` section 5.

## 8. Recovery and closure criteria
An alert is closed when: it has resolved (the resolve message arrived or the dashboard shows it gone); the cause is identified or recorded as unknown with the reason; containment actions are reversed or made deliberate; the incident log is complete; any needed rotation, rollback or restore is done and verified; follow-up changes (threshold, rule, fix) have an owner and a date.

## 9. Setup and recurring review

### 9.1 First tasks (nothing below has been done)
1. Choose a public HTTPS receiver; set `MONITORING_ALERT_WEBHOOK_URL`; **trigger a harmless alert deliberately** (for example `POST /api/v1/monitoring/test-error` for the error tracker, and lower one security threshold temporarily in a non-production environment) and confirm a named person receives it.
2. Name the roles in section 1 and the response times.
3. Configure the backup ping receiver with a missed-run alert and prove it fires.
4. Put an uptime check on `/api/v1/health/live`.
5. Commit `.github/workflows/test.yml` and see it run (R-023).

### 9.2 Recurring review (weekly unless noted; uses only existing commands)
| Check | How | Pass |
|---|---|---|
| New dependency advisories | `npm audit --omit=dev --audit-level=high` in the repository root and `npm --prefix ownus audit --omit=dev --audit-level=high` | no high or critical; moderate items are listed in the risk register |
| Secret-scanner findings | `npm run test:secrets`; monthly `npm run test:secrets:history` | 0 in the tree; history findings only those already tracked under R-001 |
| Security regression tests | `npm run test:security`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` (any time the code changes; at least monthly) | green; a failure is a ticket, not a re-run |
| Open high-priority findings | read `SECURITY_RISK_REGISTER.md` | no item older than its agreed date without a decision |
| Unexpected configuration changes | compare the deployed environment variable **names** and the release commit with the change record; `GET /api/v1/monitoring/overview` shows version and commit | no unrecorded change |
| Backup and retention jobs | last 7 lines of `backup-manifest.log` show `CREATED`, `LEDGER`, `OK`; `RETENTION_JOB_*` audit rows; `npm run db:retention` (dry run) counts look sane | no `FAILED`, no `WARNING` |
| Alert delivery | confirm the receiver still delivers (a deliberate test message **monthly**); check the webhook failure warnings in the API log (`Alert webhook failed`) | a person received the test |
| Stale or unverified rules | in `SECURITY_MONITORING_PLAN.md` section 7, any row not re-proven in the last quarter is marked stale; re-run the monitoring tests (`security-alert-rules`, `security-alerts`, `security-monitoring`) | all rows current |
| Threshold review | after four weeks of real traffic and quarterly | section 4 of the plan updated |

Do not add a scheduler or an external monitoring service for this without a demonstrated need and an approval.
