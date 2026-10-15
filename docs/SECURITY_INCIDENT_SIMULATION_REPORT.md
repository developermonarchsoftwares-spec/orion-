# Security incident simulation and response validation report (Phase 31)

Date: 2026-10-13. Every simulation below was run against a locally started API (built `dist`, `NODE_ENV=development`, traffic control ON) and a disposable local PostgreSQL database (`orion_scratch_phase31`, a copy of the Phase 29 synthetic dataset), plus a hermetic in-memory suite. All identities (`p31.*@orion-test.io`, `p31.admin.*@monarchsoftwares.com`), records, credentials (every "secret" is a fake string such as `sk_live_P31FAKE...`) and the alert destination (a receiver listening on 127.0.0.1) are synthetic. No production, Neon or external system was contacted; no real customer account, administrator or session was touched; no real secret was used; nothing was committed, pushed or deployed. Each simulated actor leaves from its own loopback address so one actor's block does not affect another's.

**Overall incident-response readiness: PARTIALLY VERIFIED.** Detection, recording, alerting through the application's own pipeline, local-receiver delivery, containment by the administrator traffic controls and by direct database actions, and evidence reconstruction were exercised and work. Four defects found by the simulations were fixed (section 7). Delivery to a real destination, on-call and escalation, log shipping, tamper evidence and a role-change audit are **not** in place or not testable here (section 7 and 8).

## 1. Scenarios selected, and why

Chosen from the ten listed in the brief because each maps to a control the repository actually has: repeated failed sign-ins (S1), refresh-token replay as the repository's form of a "superseded or revoked session" (S2), probing another customer's objects (S3), unlock refusals and credit-route tampering (S4), unauthorized and abusive exports (S5), administrator activity (credit adjustments, one-time-code failures, an out-of-band role change) (S6), publication of ineligible or suppressed records (S7), fake-credential exposure (S8), a burst of page fetches by one customer (S9), database connectivity loss (S10). Two items are partly out of reach and are marked: session *supersession* (a second login replacing a session) exists only in the web gateway and is not audited (G-5), and suppressed-record access by customers is answered as "not found" without any event (G-3).

## 2. Environment and safety boundaries

API on port 4011, receiver on 4012, PostgreSQL 18.3 local, Node 24. The alert webhook used the real delivery code (`MonitoringService.deliver` → `safeRequest`) with `INTEGRATIONS_ALLOW_PRIVATE_NETWORK=true`, which the code honours only outside production. Fixtures were returned to their intended state after each drill (section 6). Nothing here was run with production variables; the secret scanner test used a temporary untracked file holding two fake credentials, which was deleted straight after.

## 3. Detection and alert results per scenario

"Recorded" = a row in `audit_logs`. "Alert" = the monitoring rule fired when read by an administrator through `/monitoring/alerts`. "Delivered" = a message reached the local receiver. **Nothing was delivered to a production destination.**

| # | Simulation | Recorded | Request id | Alert fired | Result |
|---|---|---|---|---|---|
| S1 | 12 wrong passwords for one account | `LOGIN_FAILED` x8, then `LOGIN_BLOCKED` x2; the correct password is refused (429) while locked; no password or e-mail in any row | 11 of 11 rows | **No.** The lockout engages after 8 failures, below the 10 needed for an `ABUSE_SIGNAL` and far below 10 lockouts across accounts | Contained, but a single-account guessing attack raises no alert until further blocked attempts cross the RATE_LIMITED signal (30). A tuning decision (section 8) |
| S2 | refresh token replayed | `TOKEN_REUSE_DETECTED` x2 | 2 of 2 | **Yes** `sec_token_reuse` (warning) | PASS: the replay is refused, the rotated token is dead too, and both stay dead |
| S3 | a customer asks 36 times for another customer's saved search | before the fix: **nothing** (404, not counted: G-4). After the fix: one `ABUSE_SIGNAL OBJECT_PROBING` at 30 | yes | **Yes** `sec_abuse_signals` | FIXED. The owner keeps access throughout |
| S4 | 22 unlock attempts with 0 credits; 16 calls to administrator credit routes | `ABUSE_SIGNAL UNLOCK_REFUSED` (20) and `ABUSE_SIGNAL AUTHZ_DENIED` (15) | yes | **Yes** | PASS: 20 x 402, 16 x 403, wallet 0 → 0 (5 → 5), no ledger or unlock row created |
| S5 | anonymous export; 6 parallel exports; another customer's export id | `EXPORT_CREATED` x1, `EXPORT_REFUSED` x5, one `ABUSE_SIGNAL` | yes | **Yes** | PASS: 401, 1 x 200 + 5 x 429, 404 |
| S6a | 12 administrator credit adjustments on one account | `CREDIT_ADJUSTMENT` x12, each with the administrator as actor | yes | **Yes** `sec_credit_adjustments` (warning at 10) | PASS |
| S6b | 6 wrong administrator one-time codes | `ADMIN_OTP_FAILED` x6, code not stored | yes | **Yes** `sec_admin_signin_failures` | PASS |
| S6c | a customer's role changed to SUPER_ADMIN directly in the database | **nothing** | n/a | **No** | **GAP G-2 confirmed:** the customer's own USER-claim token reached an administrator route (200) because the role is read from the database; no application path exists and no database trigger records it |
| S7 | 6 publish attempts for a batch from an unapproved source | `PUBLISH_REFUSED` x6 with `failureCategory SOURCE_NOT_APPROVED`, `sourceTrust`, ids only | yes | rule `sec_publication_refused` is unit-tested (Phase 24); live evaluation result in section 3.1 | PASS: nothing became visible; a refused approval of a suppressed person's role answers 409 and stays unpublished, but **no event is written for it** (G-3) |
| S8a | fake token, key and password in headers, body and query | none of the fake values appears in the application log, the audit rows or alert text | n/a | n/a | PASS |
| S8b | secret scanner over a file with two fake credentials | the scanner reports 1 finding naming file, line and fingerprint; it prints no value | n/a | CI wiring unverified (the workflow has never run on GitHub: R-048) | PASS for detection; delivery of a CI failure notice is untested |
| S9 | one customer fetching 120 company pages | 20 x 200 then 100 x 429; `TRAFFIC_AUTO_BLOCK` and an `ABUSE_SIGNAL RATE_LIMITED` | yes | **Yes** | PASS, by rate limit only: there is no rule for the *volume of distinct records* viewed within the limit |
| S10 | database closed to connections for about 80 s | customer requests answered **503 DATABASE_BUSY** with `Retry-After`; readiness 503; liveness 200 | n/a | **Yes**, critical "Database unreachable" | **Delivered** to the local receiver within one monitor cycle (about 60 s), naming no account or address. See section 7 for the false "resolved" notice found and fixed |

### 3.1 Alerts read after the simulations
Read through the administrator route `/monitoring/alerts?fresh=true` on the live scratch API after the simulations: `sec_abuse_signals` (critical, several subjects), `sec_token_reuse` (critical), `sec_publication_refused` (warning), `sec_credit_adjustments` (warning). `sec_admin_signin_failures` fired when the one-time-code failures were fresh (it ages out of its 15-minute window) and is shown in the S6 row. The alert text names no account, e-mail or address.

## 4. Containment results (synthetic accounts, authorised responder actions)

| Step | How | Result |
|---|---|---|
| Revoke one account's refresh tokens | `UPDATE refresh_tokens SET is_revoked = true, revoked_at = now(), revoked_reason = 'INCIDENT' WHERE user_id = <id> AND is_revoked = false` | next refresh 401. **The access token already issued keeps working until it expires (15 minutes by default)** |
| Suspend an account | `UPDATE users SET status = 'SUSPENDED' WHERE id = <id>` | the same access token is refused on the next request (401), sign-in answers 403; the account cannot reactivate itself through its profile |
| Block an attacker address | administrator `POST /traffic/blocks` | 201; the address gets 429 on every route except the health probes and payment webhook (changed in this phase); `TRAFFIC_BLOCK_CREATED` audited; lifted with `DELETE /traffic/blocks/:id` |
| Restrict one account | administrator `PUT /traffic/users/:id/limits` | 1 request a minute enforced; `TRAFFIC_USER_LIMIT_SET` audited |
| Automatic containment | address auto-block after repeated failures or scanner probes | observed; `TRAFFIC_AUTO_BLOCK` audited |
| Prevent publication | no switch. The levers are the approved-source rule (a revoked source is always refused) and suspending the administrator account | not freezable in one step (section 8) |
| Prevent exports | suspension, or the per-account limit; the daily allowance and one-at-a-time rule apply to everyone | works, via the controls above |

**The two database actions (revoke, suspend) write no audit row.** The responder must record them: `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values) VALUES (NULL, 'INCIDENT_CONTAINMENT', 'user', '<id>', '{"role":"responder","ticket":"<id>","step":"suspend"}')` was tested and is accepted. There is no emergency access mechanism, and none was added.

## 5. Evidence and investigation

- **Reconstruction:** an account's timeline can be rebuilt from `audit_logs` by `user_id` or `entity_id`, ordered by time (non-decreasing timestamps verified); each row names actor, action, target type and id, outcome and failure category, address and user agent (the last two blanked after 180 days by retention).
- **Correlation:** audit rows written through `AuditLogService` carry the request id; the application log prints `[requestId-prefix/traceId-prefix]` on every line, so the prefix finds the matching log lines (3 lines found for the first id checked). **Four writers inserted audit rows directly and so had no request id: registration (14 of 14 rows), social registration, and every People review decision (for example `PEOPLE_PERSON_SUPPRESSED`). Fixed** (section 7): the request id is now added; the People review decisions keep the reviewer's identity and the old and new values on purpose, so they are not redacted.
- **Privacy of evidence:** no password, token, key or e-mail was found in any audit row or log line produced by the simulations. **One exception was found by reading the code and fixed:** the social-registration audit row stored the new user's e-mail address.
- **Access to evidence:** operational and error data is administrator-only (customer 403, anonymous 401). There is **no API route that lists audit rows for an investigator**; they are read from the database (or the gateway's administrator activity view).
- **Tamper evidence: none.** On a synthetic audit row, `UPDATE` and `DELETE` were both accepted by the application's database role; `audit_logs` has no trigger, hash chain or signature, and nothing is shipped off the host. This report does not claim tamper-proof or tamper-evident logging (R-012 stays open). An extract is only as trustworthy as database access control at the time, as `INCIDENT_RESPONSE.md` section 4 already says.
- **Missing events are detectable only by absence:** nothing sequences audit rows.

## 6. Recovery and post-incident validation

After the drills the containment fixtures were removed (blocks 0, per-account limits 0); the revoked refresh tokens stayed revoked (0 valid) and the suspended state was not undone by the account. Wallets: 0 inconsistent (balance equals its parts, none negative); the suppressed person stayed suppressed; no unpublished company was published by any simulation; customer isolation held (S3: the owner kept access, the prober got 404 throughout); credit and ledger rows unchanged by every tampering attempt (S4). The hermetic suite repeats these checks (section 9). Evidence stays available under the retention schedule (audit address data 180 days). Compromised credentials were not reactivated to restore the fixtures; the accounts used in drills are throwaway test accounts.

## 7. Defects and gaps found, with disposition

| ID | Finding | Disposition |
|---|---|---|
| F-1 (G-4, R-079) | Probing other customers' objects was invisible: the 404 is deliberate (it must not reveal existence) but nothing counted it. | **Fixed:** a "not found" answer on a path that names an object by id is now counted per account (`OBJECT_PROBING`, 30 in 10 minutes); the existing rule `sec_abuse_signals` alerts. Tests added. |
| F-2 (R-080) | An automatically blocked address was also refused on `/health/*` and the payment webhook. When clients share an address (proxy, NAT, the platform's own probe) one abusive client would take the whole service out of rotation or drop payment notifications. | **Fixed:** an active address block no longer applies to the health probes and the payment webhook (every other route stays blocked). Regression test added; confirmed to fail without the change. |
| F-3 (R-081) | During a database outage the monitor sent "Resolved" for security alerts that were firing (it could not evaluate them, and an alert that is absent was read as resolved), then re-announced them as new when the database returned. | **Fixed:** while the database is unreachable or the audit trail cannot be read, security alerts are neither resolved nor re-announced. Test added; confirmed to fail without the change. |
| F-4 (R-082) | Audit rows written directly by registration, social registration and every People review decision lacked the request id, and social registration stored an e-mail address. | **Fixed** with two small helpers: `auditValues` (redaction plus the request id) for registration and social registration, and `withRequestId` (the id only) for People review decisions, whose reviewer identity and changed values are kept on purpose. A first version redacted the People rows too and broke 5 integration and 2 end-to-end tests that pin the reviewer audit; it was corrected, not the tests. Unit tests added. |
| G-2 (R-034) | A role or status change made in the database leaves no trace and takes effect on the next request. | **Open.** A database trigger on `users.role` and `users.status` that writes an audit row would also catch changes made outside the application. Proposed, not applied (it needs a migration and your approval). |
| G-3 | Attempts on suppressed or unpublished records are answered "not found" or 409 and not recorded. | Open (decision). |
| G-5 | A second sign-in replacing a session (supersession) is not audited. | Open. |
| R-083 | A single-account password-guessing attack is stopped by the lockout before any alert threshold is reached. | Open (tuning): count lockouts per account, or lower `sec_login_lockouts`. |
| R-084 | Containment by database action leaves no audit row; an access token outlives a refresh-token revocation by up to 15 minutes; there is no one-step publication freeze and no API for investigators. | Open. Procedures documented. |
| R-085 | No on-call, contacts, destination or escalation roster exist (all `NOT SET`); alert delivery to a real destination, backup-failure pings and CI failure notices were never proven. | Open, owner action. |

## 8. Incident-response readiness assessment (documents reviewed: `INCIDENT_RESPONSE_RUNBOOK.md`, `INCIDENT_RESPONSE.md`, `SECURITY_MONITORING_RUNBOOK.md`)

| Element | Present | Missing or unproven |
|---|---|---|
| Severity classification | SEV1 to SEV3 with response times and update cadence | no security-specific criteria (what makes a privacy incident SEV1), no rule for downgrading |
| Roles and ownership | Incident Commander, Operations lead, Communications lead, Scribe; Coordinator / Engineering Lead / Security Reviewer in the longer document | no person, no deputy, no on-call: **NOT SET**; no decision right named for suspending an administrator or for taking the service down |
| Triage and first 15 minutes | yes, plus per-alert playbooks RB-1 to RB-15 | the containment commands existed only in prose; now tested (section 4) |
| Evidence preservation | yes (export before retention, hashes, restricted store, work on copies) | the restricted store is NOT SET; no shipped copy of the audit table; tamper evidence absent |
| Privacy and legal escalation | breach worksheet, 72-hour reminder, data-protection owner | owner NOT SET; **no legal advice is given here and none was invented** |
| Customer notification | decision step 2.7 and a message template | no approver, no channel list |
| Credential rotation | linked plans and `ACCOUNT_RECOVERY.md`; restore reconciliation (Phase 30) | rotating JWT secrets can break stored MFA secrets unless explicit encryption keys are set (R-075) |
| Business continuity | `BACKUP_AND_DISASTER_RECOVERY.md`, drill measured in Phase 30 | RTO/RPO unapproved |
| Post-incident review | blameless review within 5 working days, action items with owners | no tracker named |

## 9. Automated tests added (all synthetic; the alert sink is in-process, so they prove the pipeline, not delivery)

`test/security-incident.e2e-spec.ts` (10): S1 to S8 and containment as above; `traffic-control.e2e-spec.ts` (+1: block does not take the probes out); `security-alerts.integration.spec.ts` (+1: no false "resolved"); `audit-values.spec.ts` (3). Fail-first was confirmed for the probe exemption and the false "resolved"; the object-probing and request-id changes were reproduced in the live run before the fix.

## Regression results (working tree, 2026-10-13; commands from `apps/api`)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `node ops/security/scan-secrets.mjs` (root) / `npm run test:inventory -- --check` | 0 findings / passed |
| `npm run test:unit` | 47 suites, 865 tests passed |
| `npm run test:integration` | 43 of 44 suites passed, 1 skipped; 979 passed, 13 skipped, 0 failed |
| `npm run test:security` / `npm run test:perf` | 9 passed / 3 passed |
| `npm run test:e2e` with `CONCURRENCY_DATABASE_URL` set to the empty scratch database `orion_scratch_phase31c` (real-PostgreSQL suite included) | 43 of 44 suites passed; 677 passed, 3 todo, **1 failed**: `health-probes` "reports every dependency ..." (timing-sensitive; known). Re-run alone: 19 of 20, then 20 of 20 twice. Not changed |
| A first regression run of this phase had 5 integration and 2 end-to-end failures in the People review and verification suites | Cause: my first version of the request-id helper also redacted People review audit rows, which deliberately keep the reviewer identity and the old and new values. The helper was corrected (request id only for those rows); the tests were not touched. Rerun: all pass |

Not run: Playwright, lint, Docker, CI, the web tests (no web code changed), real alert delivery, any production or Neon database.

## 10. Reproducible commands and evidence (no secrets)

```bash
# scratch API, traffic control on, real alert path to a local receiver
DATABASE_URL=<scratch> NODE_ENV=development INTEGRATIONS_ALLOW_PRIVATE_NETWORK=true MONITORING_ALERT_WEBHOOK_URL=http://127.0.0.1:4012/alert node dist/main.js
# hermetic suite
npm run test:e2e --prefix apps/api -- security-incident traffic-control
npm run test:integration --prefix apps/api -- security-alerts
node ops/security/scan-secrets.mjs --self-test
```

The simulation scripts (actors on separate loopback addresses, audit snapshots, a local receiver) were kept outside the repository; every figure above is from their output. Audit queries used by an investigator are in `INCIDENT_RESPONSE.md` section 4.

## 11. Verified functionality versus recommendations

**Verified in this phase:** everything in sections 3 to 6 marked PASS or FIXED. **Recommendations (not done):** (1) name the roles, on-call and a real alert destination, send one test alert, and prove the backup-failure ping and CI failure notice; (2) add the database trigger for role and status changes (G-2); (3) decide on recording attempts on suppressed or unpublished records (G-3) and on auditing supersession (G-5); (4) tune single-account lockout alerting (R-083); (5) ship `audit_logs` off the host and restrict write access to a dedicated role (R-012); (6) give investigators a read-only route or view; (7) consider a publication freeze switch.

## 12. Limitations

One machine, one operator, synthetic data and a local receiver. Thresholds were exercised at their defaults but not tuned on real traffic. Counters are per process (G-8). Alert delivery to Slack, e-mail or a pager was not tested. The gateway's own session and administrator flows were not re-simulated over HTTP in this phase (covered in Phases 25 and 28). Timing of the monitor cycle (about 60 s) bounds detection latency.
