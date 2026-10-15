# Security monitoring plan

**Prepared:** Phase 24, 2026-10-12 · **Scope:** what Orion can detect today with the infrastructure it already has, what was added in Phase 24, what is not covered, and what depends on configuration that only exists outside the repository. Companion: `SECURITY_MONITORING_RUNBOOK.md` (what to do when an alert fires), `INCIDENT_RESPONSE.md` (what to do after that).

**Nothing in this document has been observed in production.** Orion has no production traffic history, no configured alert destination and no on-call arrangement recorded anywhere in the repository. Thresholds are starting values (section 4), alert delivery to a real destination is **not verified** (section 7).

## 1. How evidence is labelled

| Label | Meaning |
|---|---|
| **Rule implemented** | The code exists |
| **Triggered in a test** | A test creates the condition and sees the alert (synthetic data, local) |
| **Delivery verified (test destination)** | A test received the notification at a test-only receiver on this machine |
| **Production delivery NOT verified** | No real destination has ever received an Orion alert |
| **EXT** | Depends on a setting, service or person outside the repository |

## 2. What exists (reviewed in Phase 24)

| Capability | Where | Implemented | Tested | Needs configuration |
|---|---|---|---|---|
| Structured JSON logs with request, trace and user ids, scrubbed of e-mail, tokens, passwords, connection strings | `common/observability/structured-logger.ts`, `scrub.ts`, `redact.ts` | yes (JSON by default in production) | yes (`observability.spec.ts`, `redact.spec.ts` 82, `log-injection.spec.ts` 6 new) | log shipping and retention are EXT |
| Audit trail (`audit_logs`) of authentication, privileged and privacy events, redacted before storage | `common/services/audit-log.service.ts` | yes | yes (`audit-logging.e2e-spec.ts` 15) | none; not tamper-evident (R-012) |
| Abuse tripwires: per-subject sliding-window counters write one `ABUSE_SIGNAL` audit entry when a threshold is crossed | `common/services/security-signal.service.ts`, `all-exceptions.filter.ts` | yes | yes (`audit-and-signals.spec.ts`, `security-monitoring.e2e-spec.ts`) | env overrides `SECURITY_SIGNAL_*`; counters are per process |
| Operational alerts: HTTP error rate and latency, event loop, heap, database, pool, locks, queue backlog and failures, search cluster | `modules/monitoring/monitoring.service.ts` `alerts()` | yes | yes (`monitoring.e2e-spec.ts`) | none |
| **Security alerts (new in Phase 24):** nine rules over the audit trail (section 3) | `monitoring/security-alert-rules.ts`, `monitoring.service.ts` | yes | yes (25 unit, 11 integration, 10 e2e tests) | thresholds tunable by env |
| Notification: a JSON webhook (Slack-compatible `text`), once when an alert starts, once when it resolves, a reminder every 6 hours for critical ones | `MonitoringService.evaluateAndNotify` | yes | yes, to a local receiver (`monitoring.e2e-spec.ts`, `security-alerts.integration.spec.ts`) | `MONITORING_ALERT_WEBHOOK_URL` is EXT |
| Error tracking (Sentry protocol) with scrubbed events | `common/observability/error-tracker.ts` | yes | yes | `SENTRY_DSN` is EXT |
| Metrics (Prometheus text) and traces (OTLP) | `metrics.ts`, `tracing.ts` | yes | yes | `METRICS_TOKEN`, `OTEL_EXPORTER_OTLP_ENDPOINT` are EXT |
| Administrator dashboard and JSON endpoints | `/monitoring/dashboard`, `/overview`, `/alerts`, `/errors`, `/traces` | yes | yes (401 anonymous, 403 customer, 200 administrator) | none |
| Public health | `/health/live`, `/health/ready` | yes | yes (status, latency, reason codes only) | none |
| Backup failure ping and manifest | `ops/backup/backup.sh` | yes | run once at test scale (Phase 19) | `BACKUP_PING_*` are EXT; the ping never fired against a real service |
| Retention and deletion failures | `PrivacyService` audit events | yes | yes | none |

## 3. Detection requirements and rules

"Source" is where the event is recorded today. "Rule" is the detection logic. Severity is what the alert carries. **All thresholds are starting values.**

| # | Event to detect | Source | Rule | Severity | Response (see runbook) | Limits |
|---|---|---|---|---|---|---|
| 1 | Repeated authentication failures (customers) | `LOGIN_FAILED`, `LOGIN_BLOCKED`; `ABUSE_SIGNAL` kind AUTH_FAILURE (10 failures per subject per 10 minutes) | `sec_login_lockouts`: 10+ lockouts in 15 min warns, 50+ critical; `sec_abuse_signals` (below) | warning / critical | RB-1 | Lockout counters are database-backed, signal counters are per process; a shared office address can trip the address-level signal |
| 2 | Repeated administrator or MFA failures | `ADMIN_OTP_FAILED`, `ADMIN_OTP_UNAUTHORIZED_DOMAIN`, `ADMIN_OTP_NOT_AN_ADMIN`, `MFA_FAILED` | `sec_admin_signin_failures`: 5+ in 15 min warns, 20+ critical | warning / critical | RB-2 | Few administrators exist, so the threshold is deliberately low |
| 3 | Unusual session invalidation / supersession | API: refresh-token reuse `TOKEN_REUSE_DETECTED`; gateway returns `SESSION_SUPERSEDED` | `sec_token_reuse`: 1+ in 60 min warns, 3+ critical | warning / critical | RB-3 | **Supersession itself (a second login replacing a session) is not audited or counted**; only reuse is. Gap G-5 |
| 4 | Authorization failures / attempts on other customers' data | `ABUSE_SIGNAL` kind AUTHZ_DENIED (15 refusals per subject per 10 min) | covered by `sec_abuse_signals` | warning / critical | RB-4 | **A request for another customer's object is answered 404 by design and is not counted** (it is indistinguishable from a missing object). Gap G-4 |
| 5 | Unusual export volume or repeated denials | `EXPORT_CREATED`, `EXPORT_REFUSED` (audit) ; `ABUSE_SIGNAL` kind EXPORT_REFUSED (3 per 10 min); `EXPORT_FAILED` | `sec_abuse_signals`; `sec_export_failures`: 5+ in 60 min warns | warning | RB-5 | The 20,000-rows-per-24-hours cap is the control; volume is visible in `EXPORT_CREATED` rows but no rule alerts on a high-but-allowed volume (no baseline) |
| 6 | Suspicious credit adjustments | `CREDIT_ADJUSTMENT` (audited in the same transaction as the change) | `sec_credit_adjustments`: 10+ in 60 min warns, 30+ critical | warning / critical | RB-6 | The count says nothing about amounts; review the rows |
| 7 | Repeated unlock failures | `ABUSE_SIGNAL` kind UNLOCK_REFUSED (20 per 10 min) | `sec_abuse_signals` | warning / critical | RB-5 | Includes ordinary "not enough credits" refusals, hence the higher threshold |
| 8 | Attempts to bypass import validation or publication authorization | `PUBLISH_REFUSED`, `IMPORT_REVIEW_REFUSED`, `ADMIN_BUSINESS_PUBLISH_REFUSED` | `sec_publication_refused`: 5+ in 60 min warns | warning | RB-7 | Actors are administrators; the alert never rises above warning |
| 9 | SSRF protection rejections | `ABUSE_SIGNAL` kind SSRF_REJECTED (5 per 10 min); error code `UNSAFE_TARGET_URL` | `sec_abuse_signals` | warning / critical | RB-8 | Only customer-supplied webhook URLs reach this path; operator-set URLs are not guarded |
| 10 | Access to suppressed or unpublished records | none | **no rule** | n/a | n/a | Such requests are answered as "not found" and not recorded. Gap G-3 |
| 11 | Administrative privilege changes | none (`ADMIN_LOGIN_SUCCESS` and `ADMIN_LOGOUT` only) | **no rule**; the API has no role-management route, roles change in the database or seed | n/a | n/a | Gap G-2; a database-level change is invisible to the application |
| 12 | Secret-scanning failure in CI | CI job result | **external**: the CI platform's own failure notice | n/a | RB-9 | `.github/workflows/test.yml` is untracked and has never run (R-023) |
| 13 | Unexpected configuration / startup failure | process exit with a named-variable message; host restart | **external**: uptime check on `/health/live`, host restart notices | n/a | RB-10 | The application cannot alert about its own failure to start; Gap G-6 |
| 14 | Backup failure | `backup.sh` failure ping, `backup-manifest.log` | **external**: ping receiver must alert on a failure **and on a missing run** | n/a | RB-11 | Never fired in a real service; Gap G-7 |
| 15 | Retention / deletion / restoration failures | `RETENTION_JOB_FAILED`, `PRIVACY_DELETE_FAILED` (new, code only); `POST_RESTORE_RECONCILED` (success only) | `sec_privacy_processing_failed`: 1+ in 2 h warns, 3+ critical | warning / critical | RB-12 | A failed restoration re-apply raises an error in the command; it writes no audit row |
| 16 | Repeated rate-limit violations | `ABUSE_SIGNAL` kind RATE_LIMITED (30 per 10 min); `/monitoring/overview` `protection.limited`, `autoBlocks` | `sec_abuse_signals`; traffic counters on the dashboard | warning / critical | RB-13 | Rate limits are per process |
| 17 | Payment tampering | `PAYMENT_VERIFICATION_FAILED` | `sec_payment_verification_failed`: 3+ in 60 min warns, 15+ critical | warning / critical | RB-14 | Only matters once real payments exist (R-004) |
| 18 | The monitor cannot read its source | the query for the rules fails | `security_monitoring_unavailable` | warning | RB-15 | Does not cover the case where the whole API is down |

## 4. Thresholds: how they were chosen, and how to change them

- **No baseline exists.** There is no production history. The values were chosen so that one ordinary mistake (a wrong password, an expired token) never alerts, and so that something an attacker would do repeatedly does. They are not derived from data.
- **Already-aggregated signals are not aggregated twice.** `ABUSE_SIGNAL` rows are written once per subject when its own threshold is crossed, so `sec_abuse_signals` counts *distinct subjects*: one noisy source is a warning, five sources in an hour (a distributed pattern) is critical.
- **Windows:** 15 minutes for fast-moving events (lockouts, administrator sign-in), 60 minutes for most, 2 hours for the hourly privacy jobs (so one failed run is seen before its retry).
- **Change without a deploy:** `MONITORING_SEC_<RULE>_WARN` and `_CRIT` (e.g. `MONITORING_SEC_LOGIN_LOCKOUTS_WARN=20`); signal thresholds with `SECURITY_SIGNAL_THRESHOLD_<KIND>` and the window with `SECURITY_SIGNAL_WINDOW_SECONDS`. Invalid values are ignored.
- **Review rule:** after the first four weeks of real traffic, and then quarterly, compare alert counts with real incidents; raise a threshold that fired without a real cause more than a few times, lower one that stayed silent during a known event. Record the change and the reason in the change log of this document.

## 5. False positives and abuse controls

- **Shared addresses and automation:** address-level counters can be tripped by an office network or a script with an expired token. The alert text names no subject and the response is *investigate*, never *block*. Nothing in the monitoring code blocks, suspends or rate-limits anyone; blocking stays a deliberate administrator action through the traffic routes.
- **High-confidence signals:** only a distributed pattern (five or more subjects), repeated token reuse, or administrator sign-in failures rise to critical.
- **Alert floods:** one alert id per rule; one message when it starts, one when it resolves, a reminder every 6 hours for critical only (tested: 450 events produce one message). Security events cannot be created in unlimited numbers by an anonymous caller: abuse signals are written once per subject per window, the subject table is bounded (5,000), and the API's own rate limits apply first.
- **Cost of monitoring endpoints:** the security counts are one grouped query over a two-hour slice of `audit_logs`, cached for the same short interval as the other snapshots; three evaluations in a row run it once (tested). The dashboard and JSON endpoints are administrator-only; the public health routes run no audit query.
- **Privacy:** alerts carry counts and rule wording only. No account id, address, e-mail or event detail enters the message (tested with hostile fixtures). No new tracking, fingerprinting or per-user behavioural profile was added; every rule reads events that were already being written.

## 6. Logging validation (results)

| Property | Result | Evidence |
|---|---|---|
| Context for investigation: request, trace, span and user ids on every request-scoped line; audit rows carry action, entity, outcome, request id | yes | `observability.spec.ts`, `audit-logging.e2e-spec.ts` |
| Timestamps and levels consistent | ISO-8601 UTC timestamp and a fixed level set on every JSON line | `observability.spec.ts` |
| Authentication vs authorization failures distinguishable | yes: `INVALID_CREDENTIALS` / `INVALID_MFA_*` give AUTH_FAILURE; HTTP 403 gives AUTHZ_DENIED; other 401 gives UNAUTHENTICATED | `security-monitoring.e2e-spec.ts`, `all-exceptions.filter.ts` |
| Audit events not silently dropped | `recordStrict` rolls back the change if the row cannot be written (credit adjustments, privacy decisions); `record()` is best effort and logs a warning on failure; **best-effort rows can still be lost** | `financial-integrity.e2e-spec.ts`, `audit-and-signals.spec.ts` |
| Secrets and personal data redacted | yes, by key and by value, nested objects included. **Phase 24 fix:** a top-level logged field named like a secret (`password`, `token`) was only text-scrubbed; it is now redacted by key | `redact.spec.ts`, `log-injection.spec.ts` |
| Untrusted input cannot forge entries | JSON output: yes (escaped). **Phase 24 fix:** in the human-readable format a line break in a message or context could start a forged entry; line breaks and control characters are now neutralised and stack continuation lines are indented | `log-injection.spec.ts` (failed before the fix) |
| Access to security data | administrators only on every monitoring route; no customer route exposes the audit trail except a customer's own activity in the privacy export; **there is no audit-read route in the NestJS API (the web gateway has a read-only administrator view of the last 50 rows, `GET admin/activity-logs`)** | `security-monitoring.e2e-spec.ts`, `authorization.e2e-spec.ts` |
| Retention | audit IP/user agent blanked after 180 days; **the audit events themselves have no expiry and log-platform retention is not set** (D-RET-3, D-RET-4) | `DATA_RETENTION_POLICY.md` |
| Immutability | **not claimed.** The application role can write and delete audit rows (R-012) | |

## 7. Alert delivery verification matrix

| Alert group | Rule implemented | Triggered in a test | Delivery verified (test destination) | Production delivery |
|---|---|---|---|---|
| Operational (errors, latency, DB, queues, search) | yes | yes (`monitoring.e2e-spec.ts`) | yes: a local HTTP receiver got one message on start and one on resolve | **NOT verified** |
| Security rules (9) | yes | yes (unit, in-memory PostgreSQL, running application) | sink-level in all tests; the webhook path itself is the operational one above | **NOT verified** |
| Abuse signals reaching the audit trail | yes | yes (real failed sign-ins produced exactly one entry) | n/a (audit row, then the rule above) | **NOT verified** |
| Notifier failure | handled | yes: a throwing sink and a refused address do not raise into the caller | n/a | **NOT verified** |
| Backup failure ping | yes | run once, no receiver | no | **NOT verified** |
| CI secret-scan failure | CI file exists | never run | no | **NOT verified** |

An important operational detail found in this phase: **the alert webhook goes through the same outbound-address guard as customer webhooks.** A destination on a private address (an internal receiver) is refused and logged; use a public HTTPS receiver (a chat webhook, an alert service), or have the operator approve a documented exception. No test alert was sent to any real recipient.

## 8. Known gaps (all open; none was hidden)

| ID | Gap | Why it matters | Next step |
|---|---|---|---|
| G-1 | No production destination, no on-call, no escalation roster | Alerts have nowhere to go | Operator: configure `MONITORING_ALERT_WEBHOOK_URL`, name roles in the runbook, send a test alert to an approved receiver |
| G-2 | Administrator role changes are not audited | A privilege grant is invisible | Decide where roles are managed, then audit it |
| G-3 | Access to suppressed or unpublished records is not recorded | Probing for removed records goes unseen | Decide whether a counted, non-identifying event is wanted |
| G-4 | Cross-customer object requests return 404 and are not counted | IDOR probing is not detected | Same decision; a counter on 404s of owned-object routes |
| G-5 | Session supersession is not audited | Account sharing or takeover by login is not visible | Audit `SESSION_SUPERSEDED` with counts only |
| G-6 | Startup or configuration failure cannot alert from inside | An API that never starts says nothing | External uptime check on `/health/live` and host restart notices |
| G-7 | Backup failure and missed-run alerting is external and unproven | A silent backup gap | Configure a dead-man ping receiver; prove it fires |
| G-8 | Counters are per process | Two instances double every threshold | Shared counter before scaling out (R-014) |
| G-9 | Audit trail is not tamper-evident or shipped off-host | An intruder can erase evidence | R-012 |
| G-10 | Thresholds are not tuned on real data | Noise or silence is possible | Review rule in section 4 |

## 9. Change log of this plan
| Date | Change |
|---|---|
| 2026-10-12 | Created (Phase 24). Added nine security alert rules, `PRIVACY_DELETE_FAILED` audit event, log-forging and top-level redaction fixes in the logger. |

## 10. Phase 31 changes (2026-10-13)

Verified by incident simulation (`SECURITY_INCIDENT_SIMULATION_REPORT.md`): the rules `sec_abuse_signals`, `sec_token_reuse`, `sec_admin_signin_failures`, `sec_credit_adjustments` and `sec_publication_refused` fired from real events; the operational "Database unreachable" alert was delivered through the real webhook code to a local receiver, naming no account or address. Changes: gap **G-4 is closed** (a new abuse signal `OBJECT_PROBING` counts "not found" answers on object-id paths per account, threshold 30 per 10 minutes, covered by `sec_abuse_signals`); an active address block no longer applies to health probes or the payment webhook; the monitor no longer reports security alerts "resolved" while it cannot read their source (database outage); audit rows written directly by registration and People review now carry the request id. Still open: G-2 (role or status changes made in the database are invisible; a trigger is proposed), G-3, G-5, G-8, G-9, G-1 (no real destination, no roster), and single-account password guessing is contained by the lockout before any alert threshold is reached (R-083). Alert delivery to a production destination remains **not verified**.
