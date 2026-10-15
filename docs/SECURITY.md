# Orion security overview

**Status: internal engineering overview, not a certification or a guarantee.** It lists the security controls that exist in the code today, where to read more, and what is known to be missing. Most of the hardening described here was done in the 2026-10 security program and is **uncommitted working-tree work** until the owner commits it. Orion has not been independently penetration-tested, and nothing here says it is secure or ready for production.

## 1. Reporting a security problem
Security contact and disclosure policy: **NOT SET** (placeholder). Until an address exists, report to the product owner directly and do not post details publicly. An incident is handled with `INCIDENT_RESPONSE.md`.

## 2. Controls by area

| Area | What exists | Read |
|---|---|---|
| Secrets and configuration | Production refuses placeholder-shaped and published secrets; startup validation; secret scanner in CI (`npm run test:secrets`) | `SECURITY_REMEDIATION_SG02.md`, gap report section 10 |
| Authentication | Password hashing, lockout and CAPTCHA escalation, TOTP with replay protection, single-use rotating refresh tokens with reuse detection, single active session, short admin sessions | gap report section 10 (Phase 4) |
| Authorization | Default-deny global guard, role guard on the persisted role, ownership checks on user-owned objects, route inventory generated from source | `AUTHORIZATION_ROUTE_INVENTORY.md` |
| Credits and billing | Row and advisory locks proven on real PostgreSQL, validated pricing settings, whole-number amounts, test-mode payment key refused in production, read-only reconciliation script | gap report section 10 (Phase 6), `BILLING.md` |
| API protection | Bounded pagination and input sizes, request guard (NUL bytes, prototype keys), per-route rate limits, safe filter building, security headers | `API_PROTECTION.md`, gap report section 10 (Phase 7) |
| Outbound requests | One guarded client for customer-supplied URLs (public addresses only, checked at connect time, no redirects, size and time caps); imported URLs stored only if public and web-safe | gap report section 11 |
| Exports | Owner-scoped, published records only, row and daily caps, one at a time, formula-injection guard, no-store headers, audited | gap report section 12 |
| Privacy | Data classification, server-side masking before unlock, individual tax identifiers never shown in full, minimised responses, consent ledger, access export and erasure for customers, People suppression registry | `DATA_CLASSIFICATION.md`, `PRIVACY.md`, `PRIVACY_COMPLIANCE.md`, `PEOPLE_SUPPRESSION.md` |
| Logging and audit | Structured logs with secrets and personal data removed by key and value (nested objects included); audit trail with outcome, failure category and correlation id; money changes audited in the same transaction; abuse tripwires with configurable thresholds | gap report section 14, `OBSERVABILITY.md`, `INCIDENT_RESPONSE.md` |
| Backup and recovery | Backup, restore and verification scripts, retention schedule | `BACKUP_AND_DISASTER_RECOVERY.md` |

## 3. What the audit trail is, and is not
It is an investigation aid: a table of events with actor, action, outcome and a correlation id, with secrets and personal contact details removed before writing. It is **not tamper-proof or immutable**: the application's own database role can change or delete rows, nothing signs or chains them, and no copy is shipped elsewhere. Stronger guarantees need a restricted write role, an append-only store or log shipping (an operator decision; see `INCIDENT_RESPONSE.md` section 9). Client addresses and user agents are blanked after 180 days. Some events are written best effort and can be lost if the database is unavailable; money changes made by administrators are written in the same transaction as the change.

## 4. Known limitations (see the gap report for the full list)
- **Operator actions pending:** rotate the database owner credential and the JWT signing secrets that appeared in git history; confirm the production payment key; decide on commits.
- **Open findings:** OAuth e-mail linking (SG-03), imports publishing regardless of `autoPublish` (SG-04), company contacts with no suppression or provenance (SG-05), the web gateway as a second backend (SG-06), single-factor administrator sign-in (SG-07), tokens in browser storage (SG-08), in-process rate limits not shared across instances (P7-13).
- **Monitoring:** detection is mostly manual; there is no log shipping, off-host audit copy, on-call integration or anomaly detection beyond configurable thresholds.
- **Not tested:** a deployed environment, the browser UI suite, real DNS or TLS behaviour for outbound requests, multi-instance behaviour, load.

## 5. Where decisions are recorded
`ORION_CHECKPOINT.md` (progress and decisions), `SECURITY_GAP_REPORT.md` (findings), `SECURITY_REMEDIATION_PLAN.md` (plan and status), `SECURITY_TEST_PLAN.md` (what is tested and how).

## 6. Security headers and where they are set (Phase 14)

| Surface | Header | Value / rule | Set in |
|---|---|---|---|
| Web pages | Content-Security-Policy | `default-src 'self'`; `connect-src` = this site + the configured API origin; frame, object, base and form restrictions; scripts and styles still allow `'unsafe-inline'` (open item) | `ownus/src/lib/security-headers.ts` via `next.config.ts` |
| Web pages (production) | Content-Security-Policy-Report-Only | the same policy without inline script or style, blocks nothing | same |
| Web pages | X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy | DENY, nosniff, strict-origin-when-cross-origin, features denied, same-origin-allow-popups | same |
| Web pages (production) | Strict-Transport-Security | `max-age=31536000`; **no includeSubDomains, no preload** | same |
| Gateway `/api/*` | Cache-Control | `no-store, no-cache, must-revalidate, private` | same |
| Signed-in page shells, login and register pages | Cache-Control | `private, no-cache, must-revalidate`; the reset page `no-store` and `Referrer-Policy: no-referrer` | same |
| API JSON | Content-Security-Policy | `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | `apps/api/src/common/http/security-headers.ts` (one source; Helmet's own CSP is off) |
| API explorer (outside production, or when forced on) | Content-Security-Policy | its own looser policy, still not frameable | same |
| API monitoring dashboard, invoice view | Content-Security-Policy | script allowed by hash of its inline script (invoice: none), no external resource | the two controllers, using `htmlPageCsp` |
| API | Permissions-Policy, Cache-Control | features denied; `no-store` on any request carrying credentials | same |
| API (production) | Strict-Transport-Security | `max-age=31536000`, no includeSubDomains, no preload | Helmet options in the same file |
| API | X-Frame-Options, nosniff, Referrer-Policy and Helmet's other defaults | Helmet | `main.ts` |

There is no Vercel configuration file and no reverse-proxy configuration in the repository. A CDN or proxy in front of either service can add or replace headers (Vercel adds its own HSTS on its default domains): compare the deployed responses with this table (checklist in `SECURITY_GAP_REPORT.md` section 15.4).

## 7. Production environment requirements

| Setting | Requirement |
|---|---|
| `NODE_ENV` | `production` on the API and the web app. Enables HSTS, secret validation, the single-hop proxy trust, binding to all interfaces, the stricter CSP and refusal of local development behaviour |
| Secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, database URL, payment, mail, storage keys) | Supplied by the hosting platform's secret store. The API refuses to start with a missing, short, placeholder or published value |
| `CORS_ORIGINS` | Unset (no cross-origin browser access; the web gateway is server-side) or exact https origins. A wildcard, localhost, http, path or credentials stops the API from starting |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` | The only browser-visible names. Public URLs only. `APP_URL`/`NEXT_PUBLIC_APP_URL` must be set: reset links are built from them and never from the request |
| `SWAGGER_ENABLED` | Unset in production |
| Database | Remote connections always verify TLS; the URL's own `sslmode` cannot weaken it |
| `RAZORPAY_*` | A live key; a test-mode key fails payments closed unless `RAZORPAY_ALLOW_TEST_KEYS=true` (staging only) |
| `LOG_FORMAT`, `LOG_LEVEL` | JSON lines; no secrets or contact details are written |
| `SECURITY_SIGNAL_THRESHOLD_*`, `SECURITY_SIGNAL_WINDOW_SECONDS` | Optional tripwire tuning |
| Docker | Build with a context that contains no local `.env` file (the `.dockerignore` now excludes them); run as the non-root `node` user |

## 8. Cookies, CORS and caching decisions
Session cookies (`orion_access_token`, `orion_admin_token`, the OAuth state cookie) are `HttpOnly`, `SameSite=Lax`, path `/`, and `Secure` in production whatever the Host header says. The single-active-session rule invalidates the access token on sign-out or a new login. No CSRF token exists; the SPA sends its bearer token explicitly and Lax cookies are not sent on cross-site POSTs. CORS allows exact origins only, with credentials, and none by default in production. Responses carrying credentials are never cacheable.

## 9. Dependencies
Production dependency trees (API and web) have no high or critical advisory. Accepted and open: `js-yaml` moderate pinned by `@nestjs/swagger` (explorer off in production, no untrusted YAML), and dev-toolchain findings (jest, ts-jest, drizzle-kit, the lint toolchain). The CI workflow now fails on a high or critical production advisory. Details: `SECURITY_GAP_REPORT.md` section 15.2.



## 10. Data provenance and source trust (Phase 15)
Imported records are published only by an administrator, or automatically from a batch that asks for it and names an approved source. Sources are registered with a trust status (UNREVIEWED, APPROVED, RESTRICTED, REVOKED) by administrators, with a reason, in the audit trail. Each published business records its source, the source's trust at publication, the batch and row, the publishing administrator and any override. Verification claims are a ladder that an import can climb only to a structural check; no import marks a business or a contact verified. Revoking a source holds its businesses back, reversibly, and a database guard stops them being republished. See `DATA_PROVENANCE.md` for the rules and the known gaps (no publish control in the admin screen yet; pre-existing businesses have unknown provenance; no real source is registered yet).

## 11. Retention, deletion and backup lifecycle (Phase 16)

- Retention runs in bounded, retry-safe batches with a dry-run mode and aggregate-only audit events; errors are logged by code, never message. Full table and the list of undecided periods: `DATA_RETENTION_POLICY.md`.
- Account erasure also clears the old/new values of the account's own audit events. Unpublishing, restricting and deleting are distinct and documented; only deletion removes data, and only from live tables.
- Company-contact suppression is digest-only, immutable, normalised in one SQL function, and enforced by a trigger on every writer. **No intake workflow exists yet** (Phase 11 unfinished).
- Backups: umask 077, checksum verified at write, manifest of create/expire events, unencrypted-backup warning, and a **deletion ledger** stored beside the dump that is re-applied after every restore (`npm run db:ledger`). Old backups are not scrubbed and keep deleted data until they expire.

## 12. Security monitoring (Phase 24)
Operational alerts existed before; Phase 24 added nine security alert rules over the audit trail (abuse thresholds, token reuse, lockouts, administrator sign-in failures, privacy-processing failures, payment verification failures, publication refusals, credit adjustments, export failures), a `PRIVACY_DELETE_FAILED` audit event, and two logger fixes (forged entries in the human-readable format; top-level secret fields). Detection rules, thresholds, gaps and the delivery matrix: `SECURITY_MONITORING_PLAN.md`. What to do when an alert fires: `SECURITY_MONITORING_RUNBOOK.md`. **No alert has been delivered to a real destination; the audit trail is not tamper-evident.**

## 13. Privileged access (Phase 25)
Inventory of the 83 role-restricted routes and the gateway's native admin handlers, with role, enforcement point, audit event and tests: `AUTHORIZATION_ROUTE_INVENTORY.md` (Phase 25 section). Controls in force: authorisation uses the persisted role and status on every request; administrator sessions are now revocable (logout and a newer sign-in end the older token); sign-in, failure and logout are audited on both the API and the gateway paths; package and price changes are audited; credit adjustments refuse unknown or erased accounts. **Not in place:** any distinction between ADMIN and SUPER_ADMIN (R-035), segregation of duties on credit adjustments (R-036), audit of role and status changes (done in the database only, R-034), a restricted service identity for background jobs, a documented break-glass procedure.

## 14. Pipeline and supply chain (Phase 26)

Full review: `CI_CD_SECURITY_REVIEW.md`. In place: one workflow with a read-only token, no secrets, no untrusted text in shell commands, `pull_request` (not `pull_request_target`); actions pinned to commit SHAs; no persisted checkout credential; lockfile installs (`npm ci`) from the npm registry only with integrity hashes and verified registry signatures; secret scan, production and critical-level dependency audits, migration journal check, type-checks, builds and all test classes in CI. Phase 26 found that the workflow was **not valid YAML** (fixed) and that it had never run. **Not in place:** proof that CI is a release gate (branch protection, required checks and Vercel settings are unverified, R-042), container builds from the lockfile with pinned bases and an image scan (R-043), an SBOM or any build provenance (R-046), working Dependabot/CODEOWNERS (files added, inert until enabled, R-047).

## 15. Database security (Phase 27)

Full review: `DATABASE_SECURITY_REVIEW.md`. In place: one environment-supplied connection string, verified TLS for every remote host, bound parameters and allowlisted sorting in all reviewed queries, owner-scoped lookups for every customer-owned record (tested with two synthetic customers), advisory locks plus `FOR UPDATE` plus unique indexes on every money and unlock path (proved on a real PostgreSQL server). Phase 27 added server-side connection limits (statement, idle-in-transaction, lock wait), integer bounds on paging and bulk lists, serialised saved-lead and wallet creation, a published-company requirement for new saved leads, and removal of bound values and query strings from the error log. **Not in place:** a restricted application role and a separate migration role (R-049, R-050), row-level security, a unique index for company-level saved leads (R-055), atomic quota checks (R-054).

## 16. API contract and error handling (Phase 28)

Full review: `API_CONTRACT_REVIEW.md`. In place: one global validation pipe that refuses unknown and mistyped properties, DTO classes for every API request body except four hand-checked administrator import routes (a test fences that list), allowlisted sorting, bounded paging and bulk lists, fixed generic 5xx messages outside development, no bound values or query strings in logs (API and gateway), `no-store` on credentialed responses, natural-key idempotency on unlocks, payments and refunds. Phase 28 added validated bodies for the administrator OTP, logout, provider link/unlink/token and pricing-setting routes; a body reader and a guard on the gateway so a `null` body or a thrown error cannot produce a bare 500; strict (throwing) database writes for the gateway's customer-facing updates, so a refused write is no longer reported as success; and a 503 instead of a fake success for writes to the gateway's offline saved-lead and saved-search stand-ins. **Not in place:** runtime validation of responses in the browser client (R-062), conversion of the remaining gateway call sites that treat a database failure as an empty result (R-060), a single implementation of the routes that the gateway and the API both answer (R-063).

## 17. Performance and resilience (Phase 29)

Full review: `PERFORMANCE_RESILIENCE_REVIEW.md`. In place: bounded pages, bulk lists, exports (5,000 rows, one at a time), imports (5,000 rows, 20 MB), retention batches; route limits on search (60 per minute) and unlock (30 per minute); server-side statement, idle-in-transaction and lock-wait limits; transient database conditions answered 503 with Retry-After; a stale import batch can be finished after a crash. Phase 29 fixed a pool self-deadlock at the daily wallet rollover (60 simultaneous first-reads against a pool of 20: 56 failures after 15 s, now none), the row lock taken by every wallet read, the 30 s lock wait, and the stranded import after a killed process. **Not in place:** production-class measurements, a soak test, a trigram index for free-text search (proposed, R-065), a retention cap sized to real audit volume (R-064).

## 18. Disaster recovery (Phase 30)

Full report: `DISASTER_RECOVERY_VALIDATION_REPORT.md`. Verified by a real restore: the dump restores completely (all 68 tables, 1,068,850 rows, no orphan row), publication states survive (archived, draft and rejected companies stay invisible), a failed migration leaves no trace, the API survives and recovers from a database outage (503 answers, recovery in under a second) and refuses to start without secrets. Phase 30 added `RESTORE_MODE` (no background job runs on the first start of a restored database), a ledger that also carries withdrawn companies and suspended accounts, a ledger-only backup mode, session revocation on re-apply, and 503 (not 500) for every database-unavailable condition. **Not in place:** a scheduled ledger job (R-071), a way to re-apply the ledger to a restored remote database (R-074), explicit encryption keys for MFA and integration secrets (R-075), a payment reconciliation procedure (R-076), production-scale and provider-level recovery evidence (R-078).

## 19. Incident detection and response (Phase 31)

Full report: `SECURITY_INCIDENT_SIMULATION_REPORT.md`. Verified by simulation on synthetic data: repeated failed sign-ins, refresh-token replay, unlock and credit tampering, abusive exports, administrator credit bursts and one-time-code failures, refused publication, fake credentials, bulk page fetches and a database outage are recorded with a request id, without secrets or personal data, and reach the alert rules; containment by suspension, token revocation, address block and per-account limit works. Phase 31 added detection of probing other customers' objects, kept health probes and the payment webhook reachable while an address is blocked, stopped false "resolved" alerts during an outage, and added the request id to registration and People review audit rows. **Not in place:** a real alert destination and on-call roster (R-085), tamper-evident and off-host audit logs (R-012), an audit of role or status changes (G-2), an alert for single-account password guessing (R-083), a one-step publication freeze and an investigator read route (R-084).
