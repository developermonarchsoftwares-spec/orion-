# Security requirements traceability matrix

**Prepared:** Phase 20, 2026-10-12 · **Tree:** branch `chore/neon-removal-prep`, HEAD `3cf08b3` plus uncommitted work (nothing in this matrix is in a commit) · **This is an assessment, not a certification.**

Companion documents: `PRIVACY_COMPLIANCE_TRACEABILITY.md`, `SECURITY_RISK_REGISTER.md`, `ORION_SECURITY_PRIVACY_HANDOVER.md`, `PRODUCTION_READINESS_REPORT.md`.

## 1. How to read this

### Status values (used consistently)
| Status | Meaning |
|---|---|
| VERIFIED | Implemented, and covered by evidence that was executed or inspected and passed, **within the verified scope** (the scope is always stated; "VERIFIED" never means "verified in production") |
| PARTIALLY VERIFIED | Implemented and tested in part; the untested or unimplemented part is named |
| NOT VERIFIED | No sufficient evidence, or the control is not implemented. The cell says which |
| FAILED | Tested and found not to meet the requirement. (None at the time of writing; defects found during the work were fixed and re-tested.) |
| BLOCKED | Cannot be completed or verified until a named external action happens |
| NOT APPLICABLE | The requirement does not apply to Orion's architecture |

### Evidence classes (each row names the strongest it has)
| Code | Evidence | When |
|---|---|---|
| **E1** | Automated tests **executed in Phase 20** (2026-10-12): API e2e subset of 13 suites, 217 passed, 0 failed, 4 todo; API unit subset of 15 suites, 413 passed, 0 failed; API integration subset of 3 suites, 47 passed, 0 failed; opt-in real-PostgreSQL concurrency suite, 7 passed, 0 failed (PostgreSQL 18.3, disposable database) | fresh |
| **E2** | Full automated suites and builds executed in **Phase 19** (2026-10-12) in a clean copy without environment files: unit 802, integration 945, e2e 581 passed (0 failed); web 258 passed (working tree); security 9; performance 3; type checks, API and web builds | fresh in the same session, not re-run in Phase 20 |
| **E3** | Manual execution on disposable databases (Phase 19): compiled API in production mode, migrations fresh and upgrade, `backup.sh` / `restore.sh` / ledger re-apply with real `pg_dump` and `gpg` | fresh in the same session, not re-run in Phase 20 |
| **E4** | Source inspected in Phase 20 (file and construct confirmed to exist and to do what the row says) | fresh |
| **E5** | Historical: stated in an earlier phase report and not re-executed since. Used only for context; **no row is VERIFIED on E5 alone** | historical |
| **E8** | Phase 25 (2026-10-12): privileged-access checks, including HTTP runs of the built web app on a disposable database and probes of adjacent paths | fresh |
| **E7** | Phase 23 (2026-10-12): independent checks written by someone other than the fix author: real HTTP run of the built web app on a disposable database; scheduled-export download path; adjacent-path probes | fresh |
| **E6** | Phase 22 (2026-10-12), working tree: new focused tests (6 web, 2 integration, 1 e2e converted from `todo`, 6 unit, 3 e2e) each shown to fail when its fix is reverted, plus the full regression listed in `ORION_SECURITY_PRIVACY_HANDOVER.md` s5.7 | fresh |
| **EXT** | Depends on configuration or an action outside the repository (hosts, provider consoles, people) | not verifiable here |

Test counts were measured in Phase 20 or Phase 19 and replace the numbers in earlier phase reports where those differed (see section 6).

### Verified scope
Local machine (Windows 11, Node 24.11.1, PostgreSQL 18.3), in-memory PostgreSQL (PGlite) and disposable local databases. **Not production, not preview, not a deployed environment.** Real third parties (Google, Microsoft, Razorpay, Typesense, object storage, Vercel, Neon) were not contacted.

## 2. Matrix

### 2.1 Authentication and session security
| ID | Control | Implementation | Endpoints / data | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|---|
| SR-AUTH-01 | Login lockout, uniform failure answers, constant-time dummy hash | `auth/services/auth.service.ts` (`LOGIN_BLOCKED`, `dummyHash`) | `POST /auth/login`; `users` | E1 `auth-hardening.e2e-spec.ts` 23 passed; E4 | VERIFIED | Rate limits are per process (R-014) | none |
| SR-AUTH-02 | HS256-only verification, issuer/audience, session id rotation, logout ends the access token | `auth/strategies/jwt*.strategy.ts` (`algorithms: ['HS256']`), `auth.service.ts` (`activeSessionId`) | `POST /auth/logout`; `users.metadata` | E1 `auth-hardening.e2e-spec.ts`; E4 | VERIFIED | Access tokens of an erased account stay valid until expiry unless the session id check catches them (it does: erasure clears metadata) | none |
| SR-AUTH-03 | TOTP replay prevented; MFA step honours lockout | `auth/services/totp.util.ts`, `auth.service.ts` | `POST /auth/mfa/*` | E1 `auth-hardening.e2e-spec.ts`; E5 mutation proof (6 of 6 parallel logins succeeded before the fix, 1 after) | VERIFIED | none known | none |
| SR-AUTH-04 | Refresh-token rotation and reuse detection | `auth/services/auth-token.service.ts` | `POST /auth/refresh`; `refresh_tokens` | E1 `audit-logging.e2e-spec.ts` (15), `auth-identity.e2e-spec.ts` is in E2 | VERIFIED | none known | none |
| SR-AUTH-05 | Admin sign-in: one-time code claimed atomically, attempt limit, expiry, domain and persisted-role check, 12 h session | `auth/admin-auth.controller.ts`, `auth/admin-otp.util.ts`; web `lib/admin-otp-store.ts` | `POST /admin/auth/*`; `admin_otps` | E1 `admin-auth.e2e-spec.ts` 8, `admin-otp.util.spec.ts` 6, `security-hardening.e2e-spec.ts` 22 | VERIFIED | Single factor (see SR-AUTH-06) | none |
| SR-AUTH-06 | Admin second factor / hardware key (SG-07) | **Not implemented** | | none | NOT VERIFIED (not implemented) | An administrator account is one e-mailed code plus a password | **Decision:** business owner (R-007) |
| SR-AUTH-07 | OAuth: simulated login impossible outside `NODE_ENV=test` with a local database; unverified provider e-mail refused for sign-in and linking | `modules/oauth/oauth-simulation.ts`, `oauth.service.ts` (`OAUTH_EMAIL_UNVERIFIED`) | `GET /auth/oauth/*` | E1 `oauth-simulation.spec.ts` 15, `oauth-email-verified.spec.ts` 4 (unit, mocked repositories); E2 `oauth.e2e-spec.ts` (**does not cover the unverified-e-mail rule**: with the check removed it stayed 16 of 16 green, Phase 32); **E9 (Phase 32)** `oauth-unverified-email.e2e-spec.ts` 2 over HTTP (no account created, no link, victim unchanged), mutation-proven | VERIFIED | Real Google/Microsoft callbacks never exercised (EXT) | Operator: configure and test providers before enabling |
| SR-AUTH-08 | Password length cap 128; hashing; legacy-hash upgrade | `auth/dto/auth.dto.ts`, `modules/user/dto/user.dto.ts`, `auth/services/password.service.ts`; web `lib/password.ts` | register, reset, change | **E6** `password-limits.spec.ts` (3, boundary 7/8/128/129), `password-length.e2e-spec.ts` (3, HTTP 400); E2 web `password.test.ts`. (Before Phase 22 the cap had no test and this row was overstated.) | VERIFIED | Gateway PBKDF2 (210,000 iterations) differs from the API's bcrypt (R-009) | none |
| SR-AUTH-10 | Privileged (administrator) sessions are revocable: logout and a newer sign-in end the older token; suspension and demotion act at once; a token cannot carry a role the account does not hold | `auth/admin-auth.controller.ts` (`setActiveSession`, token carries `sessionId`, logout rotates it); gateway `handleAdminVerifyOtp` / `handleAdminLogout`; `RolesGuard` (persisted role and status) | `POST admin/auth/*`; `users.metadata.activeSessionId` | **E8** `admin-session.e2e-spec.ts` (8): **2 failed before the Phase 25 fix**; gateway native flow 17 of 17 checks over HTTP against the built web app (script outside the repository); mutation-proven on both | PARTIALLY VERIFIED | The gateway proof is a script, not a repository test; tokens issued before the change (up to 12 h) carry no session id and cannot be revoked; one account has one active session (a newer sign-in of any kind ends the older) | none |
| SR-AUTH-09 | E-mail verification required before use (SG-11) | `config/env.validation.ts` (`REQUIRE_EMAIL_VERIFICATION`); registration marks verified when the switch is off | `POST /auth/register` | E4 | PARTIALLY VERIFIED | Default behaviour lets unverified registration proceed | **Decision:** business owner (R-011) |

### 2.2 Authorization and customer data isolation
| ID | Control | Implementation | Endpoints / data | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|---|
| SR-AZ-01 | Every non-public API route refuses anonymous callers; every role-restricted route refuses a customer | `auth/guards/roles.guard.ts`, route metadata; inventory `AUTHORIZATION_ROUTE_INVENTORY.md` (201 routes) | all `apps/api` routes | E1 `authorization.e2e-spec.ts` 17, `admin-authorization.e2e-spec.ts` 5 (discovered from live metadata) | VERIFIED (NestJS API) | The web gateway is a second backend (SR-AZ-03) | none |
| SR-AZ-02 | Cross-user isolation: exports, integrations, invoices, unlocks, wallet, saved items, shared-lead privacy | per-module `userId` filters | `export`, `integrations`, `billing`, `unlock`, `saved-*` | E1 `authorization.e2e-spec.ts` (17), `export-security.e2e-spec.ts` (17) | VERIFIED (API) | none known | none |
| SR-AZ-03 | Web gateway native handlers enforce the same object-level rules (SG-06) | `ownus/src/lib/gateway-auth.ts` (`routePolicy`, deny by default); `app/api/v1/[...path]/route.ts` | gateway `/api/v1/*` | E2 web suite (258) covers policy tables and helpers; no HTTP-level object-level tests | PARTIALLY VERIFIED | A second implementation of business rules that can drift from the API; behaviour when `BACKEND_API_URL` is unset is unverified | **Decision:** retire native handlers or test them (R-006) |
| SR-AZ-08 | The privileged surface cannot be reached by an unlisted method, a path spelling trick, client-supplied role/user headers or a customer; no route changes roles, creates administrators or removes a suppression | route metadata of the running application; `RolesGuard` | all 83 role-restricted routes | **E8** `privileged-operations.e2e-spec.ts` (18): every privileged path x 5 methods x {anonymous, customer} never succeeds and never errors with 5xx; 9 path spellings; header/query role spoofing; pinned list of account-touching mutations | VERIFIED | Path spellings tested are those Express/Nest normalise; a reverse proxy in front may differ (EXT) | none |
| SR-AZ-09 | Least privilege between administrator tiers | **Not implemented:** all 83 privileged routes allow ADMIN and SUPER_ADMIN; SUPER_ADMIN has no unique capability | | **E8** route inventory | NOT VERIFIED (not implemented) | Any ADMIN can change prices, adjust any wallet, block addresses and approve sources | **Decision:** which operations become SUPER_ADMIN-only (R-035) |
| SR-AZ-04 | Mass assignment closed on settings (AZ-01) | `user/user.service.ts` (`USER_SETTING_KEYS`) | `PATCH /user/settings` | E1 `authorization.e2e-spec.ts` | VERIFIED | none known | none |
| SR-AZ-05 | Search carries flags only; contacts masked until unlock; individual PAN never shown in full | `common/privacy/data-classification.ts`, `discover.service.ts`, `unlock.service.ts` | `GET /discover/*`, unlock | E1 `data-classification.spec.ts` 40, `privacy-classification.e2e-spec.ts` 13 (+2 todo) | VERIFIED | After-unlock disclosure of personal/unknown values is a policy decision (R-016); two todo tests are open requirements | **Decision:** `DISCLOSURE_POLICY` |
| SR-AZ-06 | Admin-only: monitoring, privacy admin, import, credit configuration | `@Roles` decorators | `/monitoring/*`, `/privacy/admin/*`, `/admin/*`, `PUT /credit/admin/config` | E1 `admin-authorization.e2e-spec.ts`, `authorization.e2e-spec.ts` | VERIFIED | none known | none |
| SR-AZ-07 | Gateway admin handlers require a persisted ADMIN/SUPER_ADMIN | web `requirePersistedAdmin`, `lib/gateway-auth.ts` | gateway admin routes | E2 web `admin-role.test.ts`, `gateway-auth.test.ts` | PARTIALLY VERIFIED | Unit level only | see SR-AZ-03 |

### 2.3 Secret management
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-SEC-01 | Production refuses missing, placeholder, short or publicly known JWT secrets; localhost/wildcard CORS; development Typesense/MinIO keys | `config/env.validation.ts`, `config/secrets.ts`, `config/cors.ts` | E1 `placeholder-secrets.spec.ts` 8; E2 `config-hardening`, `cors.spec`; E3 compiled API refused 5 bad configurations (no values printed) | VERIFIED (local) | A wrong value on the real host is an outage, not a silent weakness | Operator: GATE-02 |
| SR-SEC-02 | No secrets in the working tree, git config, client bundle or build output | `ops/security/scan-secrets.mjs`; `.gitignore` | E2 `npm run test:secrets` 0 findings (working tree); E3 build-output inspection (no private-key blocks, no live keys, no server variable names in the client bundle) | VERIFIED (current tree) | none | none |
| SR-SEC-03 | Secrets exposed in Git history are rotated and the history cleaned (SG-02 / SG-02b) | n/a: operator action | E2 `npm run test:secrets:history`: 3 distinct values remain | BLOCKED | Public-repository exposure of a database owner credential and signing secrets | Operator: GATE-01 (R-001) |
| SR-SEC-04 | Production secrets live only in the intended secret store with the right values | n/a: hosts | none | BLOCKED (EXT) | Unknown | Operator: GATE-02 (R-002) |
| SR-SEC-05 | Secrets cannot enter container images | `.dockerignore` | E2 `deployment-config.spec.ts` (file content); image never built | PARTIALLY VERIFIED | Docker daemon unavailable, images unbuilt | Operator: build and inspect an image |
| SR-SEC-06 | Only intentionally public values are `NEXT_PUBLIC_` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` | E3 grep of source and client bundle | VERIFIED | none | none |

### 2.4 Input validation and API protection
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-API-01 | Whitelist validation of typed bodies | `main.ts` `ValidationPipe`; DTOs | E2 e2e suites | PARTIALLY VERIFIED | 11 inline-typed bodies remain outside DTO validation (P7-12) | Engineering (R-015) |
| SR-API-02 | Request guard: NUL bytes, `__proto__` keys | `common/middleware/input-guard.middleware.ts` | E1 `input-guard.middleware.spec.ts` 8, `api-hardening.e2e-spec.ts` 28 | VERIFIED | none | none |
| SR-API-03 | Pagination and search limits bounded | `common/utils/pagination.util.ts`, DTOs | E1 `pagination.util.spec.ts` 5, `api-hardening.e2e-spec.ts` | VERIFIED | none | none |
| SR-API-04 | Per-route rate limits and global limiter | `@Throttle` decorators, throttler module, traffic module | E1 `api-hardening.e2e-spec.ts` | PARTIALLY VERIFIED | In-process only: not shared across API instances | Decision: table-backed counter before scaling out (R-014) |
| SR-API-05 | Search filter injection closed | `modules/search/typesense-query.ts`; default provider is PostgreSQL | E1 `typesense-query.spec.ts` 7, `api-hardening.e2e-spec.ts` | VERIFIED | A live Typesense server was never queried | none unless Typesense is enabled |
| SR-API-06 | Errors reveal no SQL, stack or host | `common/filters/all-exceptions.filter.ts` | E2 `all-exceptions.filter.spec.ts`; E3 production 404/401/503 bodies | VERIFIED | none | none |

### 2.5 SSRF and external resource access
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-SSRF-01 | Customer webhook URLs only through `safeRequest` (IPv4/IPv6 special ranges, ports, read cap) | `integrations/net/safe-http.ts` | E1 `safe-http-ssrf.spec.ts` 96, `safe-http.spec.ts` 49 | PARTIALLY VERIFIED | Real DNS resolution, TLS and egress filtering were not exercised | Operator: block metadata and private ranges at the network edge |
| SR-SSRF-02 | Imported URLs are stored, never fetched; stored and rendered links sanitised | `common/utils/public-url.util.ts`; web `lib/safe-url.ts` | E1 `public-url.util.spec.ts` 19, `ssrf-ingestion.e2e-spec.ts` 5; E2 web `safe-url.test.ts` | VERIFIED | none | none |
| SR-SSRF-03 | Avatar payload and URL validation (SG-24) | `common/utils/avatar-validation.util.ts` (host rules now the shared `parsePublicUrl`, Phase 32) | E1 `avatar-validation.util.spec.ts` (19 after Phase 32); **E9 (Phase 32)** `avatar-validation.e2e-spec.ts` 17 over HTTP on both routes, mutation-proven (15 of 17 fail with either call removed). **Correction:** this row was marked VERIFIED while 9 of 14 probe URLs (IPv6 loopback, `127.0.0.2`, `169.254.x`, `100.64/10`, unique-local, `metadata.google.internal`) passed the old string-list check and no test reached the route (R-086) | VERIFIED (after the Phase 32 fix) | No server-side avatar fetch exists; if one is added it must use `safeRequest` | none |
| SR-SSRF-04 | Operator-configured URLs (mail relay, error tracker, trace exporter) cannot be abused | Not guarded **by design** | none | NOT VERIFIED (by design) | Anyone who can set those variables can point the server at an internal host | Accept explicitly or guard (R-020) |

### 2.6 Credits, billing, unlocking and exports
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-FIN-01 | An unlock or spend is charged once and never exceeds the balance under concurrency | `unlock/unlock.service.ts` (advisory lock), `credit/credit.service.ts` (row locks) | **E1 `pg-concurrency.e2e-spec.ts` 7 passed on real PostgreSQL 18.3** (the in-memory suites cannot show this; removing the locks leaves them green, E5 mutation proof: 5 failures) | VERIFIED | Opt-in suite; not part of CI | Add to CI against a service database (R-017) |
| SR-FIN-02 | A payment is credited once; webhook is HMAC-verified, fail-closed; refunds reverse once | `payment/razorpay.service.ts`, `payment/*` | E1 `financial-integrity.e2e-spec.ts` 26; E2 `billing.e2e-spec.ts` | PARTIALLY VERIFIED | Tested against a simulation: real Razorpay never contacted | Operator: GATE-03 |
| SR-FIN-03 | Real payment checkout works (server-side order creation and synchronisation) | `createOrder` makes a local id only (CR-05) | none | BLOCKED | Payments must stay disabled | Engineering + operator: GATE-03 (R-004) |
| SR-FIN-04 | Admin credit configuration validated and audited in the same transaction | `credit/pricing-settings.validation.ts`, `credit.service.ts` (`recordStrict`) | E1 `financial-integrity.e2e-spec.ts` | VERIFIED | none | none |
| SR-FIN-07 | Credit adjustment and package administration are authorised, validated, atomic and attributed | `CreditService.adjustUserCredits` (checks the target is a live account; one transaction with a row lock), `createPackage/updatePackage/deletePackage` (audited, 404 on unknown ids, UUID-validated) | `POST credit/admin/adjust`, `credit/admin/packages*` | **E8** `privileged-operations.e2e-spec.ts`: an unknown account returned **HTTP 500 and package changes were not audited before the Phase 25 fix**; both pass now; mutation-proven (5) | VERIFIED | Audit rows for package changes are best effort (not in the change's transaction) | none |
| SR-FIN-08 | Segregation of duties on credit adjustments | **Not implemented:** an ADMIN can credit their own wallet (`201`, audited) | `POST credit/admin/adjust` | **E8** probe | NOT VERIFIED (not implemented) | Insider self-credit, bounded by the per-call limit and the 30 per minute throttle, visible only if someone reads the audit | **Decision:** forbid self-adjustment or require a second SUPER_ADMIN (R-036) |
| SR-FIN-05 | Database `CHECK` constraints on wallets and a ledger uniqueness key (CR-02) | Not implemented | none | NOT VERIFIED (not implemented) | Integrity depends on code alone | Decision + new migration (R-013) |
| SR-FIN-06 | Ledger reconciles to balances | `scripts/reconcile-credits.ts` (read-only) | E5 Phase 6 run on the local database: hard checks passed, 3 warnings (9 wallets whose ledger does not sum, 5 expiry rows, 57 unlock charges without an unlock row) | PARTIALLY VERIFIED | Warnings unexplained; production never reconciled | Operator: run on a production copy (R-013) |
| SR-EXP-01 | Export authorisation: own unlocked/saved, published only; formula guard; 20,000 rows/24 h; one at a time; audited | `export/export.service.ts`, `common/utils/csv-security.util.ts` | E1 `export-security.e2e-spec.ts` 17 (+1 todo), `export-csv-safety.spec.ts` 25; E6 suppression test above | PARTIALLY VERIFIED | Exports already downloaded keep their values; the remaining `todo` is People export after consent withdrawal | see SR-PRIV-06 |
| SR-EXP-02 | Download headers (attachment, no-store, nosniff, safe names) | `common/http/download-headers.ts` | E1 `export-security.e2e-spec.ts` | VERIFIED | none | none |

### 2.7 Provenance and publication
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-PROV-01 | No publication without an approved source and an explicit request; re-validation at publish; actor recorded | `import/services/admin-import.service.ts`, `source-trust.service.ts`, `provenance/provenance.util.ts` | E1 `provenance-publishing.e2e-spec.ts` 27, `provenance.util.spec.ts` 39 | VERIFIED (API path) | Behaviour change: existing sources become UNREVIEWED (E3) | Business owner approval |
| SR-PROV-02 | A business from a REVOKED source cannot be published by any writer | trigger `businesses_source_guard`, migration `0025_source_trust` | E3 scratch database: insert refused with SQLSTATE 23514 | VERIFIED | Only REVOKED is blocked by the database | none |
| SR-PROV-03 | Every publication path honours source trust | Gateway status screen now refuses PUBLISHED for a business whose recorded source is not APPROVED: `ownus/src/lib/publish-guard.ts`, wired into `app/api/v1/[...path]/route.ts` (Phase 22) | **E6** `publish-guard.test.ts` (6); **E7** real HTTP run of the built app, 15 of 15 checks (id and slug, aliases, audit, other statuses unaffected); no other path sets PUBLISHED (searched) | PARTIALLY VERIFIED | The HTTP run is a script outside the repository (not a regression test); a business with **no** recorded source can still be published from the screen (older records); the API's override flag is not available in the gateway | Engineering (R-005): HTTP-level test or retire the native handler (R-006) |
| SR-PROV-04 | Malformed identifiers not published; imports never set verified flags | `import/provenance/provenance.util.ts` | E1 `provenance.util.spec.ts` | VERIFIED | none | none |
| SR-PROV-05 | Duplicate/merge decisions executed non-destructively with history | `import/services/review.service.ts` | E1 `provenance-publishing.e2e-spec.ts` | VERIFIED | none | none |
| SR-PROV-06 | Admin UI can publish a batch | Not built | none | NOT VERIFIED (not implemented) | Publication is API-only | Business owner decision (R-018) |

### 2.8 Privacy requests, deletion, suppression and retention
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-PRIV-01 | Account erasure after a 7-day cancel window | `privacy/privacy.service.ts` (`eraseAccountData`) | E1 `privacy.integration.spec.ts` 6, `retention-lifecycle.integration.spec.ts` 19 | VERIFIED (live tables) | Backups keep the data up to ~12 months | see SR-BAK-05 |
| SR-PRIV-02 | Company-contact suppression: digest-only register, immutable, database trigger blocks re-entry by any writer | `privacy/contact-suppression.service.ts`, migration `0024`, trigger `business_contacts_suppression_guard` | E1 `retention-lifecycle.integration.spec.ts`; E3 re-import blocked after restore | VERIFIED (`business_contacts`) | `people` has its own registry (SR-PRIV-04) | none |
| SR-PRIV-03 | Intake and handling workflow for requests from people who are not customers (Phase 11) | `data_subject_requests` table only; **no service, route or UI** | none | NOT VERIFIED (not implemented) | Requests are handled by an operator calling the service | Business owner decision; engineering (R-008) |
| SR-PRIV-04 | People suppression registry blocks re-ingestion | `people/suppression/people-suppression.ts` | E1 `people-suppression.integration.spec.ts` 22 | VERIFIED | none | none |
| SR-PRIV-05 | Retention enforced by server-side jobs, bounded, retry-safe, previewable, audited | `PrivacyService.runRetention`, `privacy.scheduler.ts`, `scripts/retention-run.ts` | E1 `retention-lifecycle.integration.spec.ts` 19 | PARTIALLY VERIFIED | Tested on in-memory PostgreSQL; production periods undecided (D-RET-1..9); import raw-payload rule is off | Decisions D-RET-1..9 |
| SR-PRIV-06 | A suppressed contact or person is removed from what customers can see and export afterwards; stored export files are expired | `ContactSuppressionService.suppress` removes the row; `expireStoredExports` (Phase 22) is called on suppression and on ledger re-apply; service registered in `PrivacyModule` | **E6** `privacy-classification.e2e-spec.ts` ("suppression of a company contact": detail for owner and others, unlock history, new export, re-insert refused), `retention-lifecycle.integration.spec.ts` (stored files expired on suppression and on restore); **E7** `scheduled-export-suppression.e2e-spec.ts` (3) and `scheduled-export-people-suppression.e2e-spec.ts` (1), `people-suppression.integration.spec.ts` (+3): the People path was **incomplete in Phase 22 and corrected in Phase 23** | PARTIALLY VERIFIED | Files a customer already **downloaded** cannot be recalled; CRM-sync exclusion remains a `todo` (needs a HubSpot double); expiring stored files is broad (all stored scheduled exports, regenerated on the next run); no intake workflow (SR-PRIV-03) | Decision on earlier downloads (R-008) |
| SR-PRIV-07 | Consent ledger; access/portability export without secrets | `privacy.service.ts` | E1 `privacy.integration.spec.ts` | VERIFIED | none | none |
| SR-PRIV-08 | Data classification and minimisation | `common/privacy/data-classification.ts` | E1 `data-classification.spec.ts` 40 | VERIFIED | Classification is derived, not stored | Decision (R-016) |
| SR-PRIV-09 | Personal data kept out of logs and audit rows | `common/observability/redact.ts`, `scrub.ts` | E1 `redact.spec.ts` 82; E2 `audit-logging.e2e-spec.ts` | VERIFIED | Test runs print fixture secrets through the plain logger by design | none |

### 2.9 Backup and restoration
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-BAK-01 | Backups are encrypted, checksummed, access-restricted and a tampered file is refused | `ops/backup/backup.sh`, `restore.sh` | E3 real `pg_dump` + `gpg` on test data; tamper refused | VERIFIED (test scale, manual) | Not automated; no S3 upload test | none |
| SR-BAK-02 | A restore cannot silently resurrect deleted or suppressed data | `privacy/deletion-ledger.ts`, `scripts/deletion-ledger.ts` | E1 ledger tests in `retention-lifecycle.integration.spec.ts`; E3 end-to-end on PostgreSQL | VERIFIED (test scale) | Reapply refuses non-local databases by design (R-010) | Decision D-RET-9 |
| SR-BAK-03 | Production backups scheduled, encrypted, off-site, lifecycle enforced, restore-tested | | none | BLOCKED (EXT) | Unknown | Operator (R-003) |
| SR-BAK-04 | Recovery objectives (RTO/RPO) established | proposals in `BACKUP_AND_DISASTER_RECOVERY.md` | only a 40 KB restore (2 s) | NOT VERIFIED | No evidence-based objective | Operator: production-scale drill |
| SR-BAK-05 | The privacy notice matches backup behaviour | `privacy/page.tsx` ("up to 12 months") | E4 | PARTIALLY VERIFIED | Bucket lifecycle rules unverified | Operator |

### 2.10 Security logging and incident response
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-LOG-01 | Authentication and privileged actions are audited | `common/services/audit-log.service.ts`, controllers | E1 `audit-logging.e2e-spec.ts` 15 | VERIFIED | Best-effort writes outside strict cases | none |
| SR-LOG-02 | Audit trail is tamper-evident and shipped off-host | Not implemented | none | NOT VERIFIED (not implemented) | The application role can write and delete audit rows | Decision (R-012) |
| SR-LOG-03 | Retention, suppression and restore events are audited with counts only | `privacy.service.ts`, `contact-suppression.service.ts`, `deletion-ledger.ts` | E1 `retention-lifecycle.integration.spec.ts`; E3 | VERIFIED | none | none |
| SR-LOG-04 | Incident response procedure exists and is usable | `INCIDENT_RESPONSE.md`, `INCIDENT_RESPONSE_RUNBOOK.md` | documents only | PARTIALLY VERIFIED | Never exercised; contacts are placeholders | Owner: assign roles, run a tabletop |
| SR-LOG-05 | Alerts reach a person | `MonitoringService.evaluateAndNotify` posts a JSON webhook (start, resolve, 6-hour reminder for critical) | **E7** (Phase 24) a local test receiver got one message on start and one on resolve (`monitoring.e2e-spec.ts`); a throwing sink and a refused private address do not raise into the caller (`security-alerts.integration.spec.ts`) | NOT VERIFIED | **No real destination is configured and no person has ever received an Orion alert.** The webhook goes through the outbound-address guard, so an internal receiver address is refused | Operator: configure and prove delivery (R-003, plan G-1) |
| SR-LOG-07 | Security events raise alerts at documented thresholds, without naming anyone, deduplicated, with bounded cost | `monitoring/security-alert-rules.ts` (9 rules over `audit_logs`), wired into `MonitoringService.alerts()` (Phase 24) | **E7** `security-alert-rules.spec.ts` (25: at, below and above each threshold, overrides, every rule's audit action exists in the code), `security-alerts.integration.spec.ts` (11: real SQL on PostgreSQL semantics, windows, subjects, dedupe, one message for 450 events, no identifiers in the text, monitor-blind alert, repeated evaluation runs one query), `security-monitoring.e2e-spec.ts` (10: administrator-only, real failed sign-ins give one `ABUSE_SIGNAL`, critical alert visible); mutation-proven | PARTIALLY VERIFIED | Thresholds are starting values with no production baseline; per-process abuse counters; no rule for administrator role changes, suppressed-record probing, cross-customer 404s or session supersession (plan G-2 to G-5) | Owner: tune after real traffic; decide on the missing detections (R-034) |
| SR-LOG-08 | Untrusted input cannot forge or split log entries; secret-named fields are redacted at the top level of a logged object | `common/observability/structured-logger.ts` (`oneLine`, `indentedStack`, top-level `redactDeep`) | **E7** `log-injection.spec.ts` (6): **failed before the Phase 24 fix** (human-readable format could be forged; a `password` field passed through), passes after; mutation-proven | VERIFIED | JSON output was already safe; the human-readable format is the default outside production and selectable with `LOG_FORMAT` | none |
| SR-LOG-09 | Administrator sign-in failures, successes and logouts are audited on every path, without e-mail or code | API `admin-auth.controller.ts`; gateway `handleAdminVerifyOtp` / `handleAdminLogout` (added in Phase 25) | audit events `ADMIN_OTP_FAILED`, `ADMIN_OTP_UNAUTHORIZED_DOMAIN`, `ADMIN_LOGIN_SUCCESS`, `ADMIN_LOGOUT` | **E8** API path in `admin-session.e2e-spec.ts`; gateway path in the HTTP script (failure audit holds neither e-mail nor code) | PARTIALLY VERIFIED | Gateway proof is outside the repository; account suspension and role changes (done in the database) are still not audited (R-034) | none |
| SR-LOG-06 | Health endpoints disclose nothing sensitive | `health/health.controller.ts` | E2 `health-probes.e2e-spec.ts`; E3 live production-mode responses | VERIFIED | `/health` returns 503 when optional storage is down (monitoring noise) | none |

### 2.11 Headers and production configuration
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-HDR-01 | API security headers | `common/http/security-headers.ts` | E1 `security-headers.e2e-spec.ts` 11; E3 live headers | VERIFIED | none | none |
| SR-HDR-02 | Web headers and CSP; cookies | `ownus/next.config.ts`, `src/lib/security-headers.ts` | E2 web `security-headers.test.ts` | PARTIALLY VERIFIED | `'unsafe-inline'` scripts remain (architecture change); real domain not checked | Operator: check on a preview (R-019) |
| SR-HDR-03 | CORS exact origins in production | `config/cors.ts` | E1/E2 `cors.spec.ts`; E3 foreign-origin preflight gets no allow-origin header | VERIFIED (local) | Real web origin not checked | Operator |
| SR-HDR-04 | API documentation not served in production | `main.ts` | E3 `/docs` 404 | VERIFIED | Startup log still prints a Swagger line (cosmetic) | none |

### 2.12 Dependencies, build and deployment
| ID | Control | Implementation | Evidence | Status | Residual risk | Approval / action |
|---|---|---|---|---|---|---|
| SR-DEP-01 | No known high or critical production dependency vulnerability | lockfiles | E2 `npm audit --omit=dev`: root 2 moderate, web 0 | VERIFIED (as of 2026-10-12) | 2 moderate (`@nestjs/swagger`, `js-yaml`); advisories change daily | Re-run before release |
| SR-DEP-02 | Applications build reproducibly from the lockfiles with no local environment | npm workspaces + `ownus` lockfile | E2/E3 clean copy: `npm ci`, type checks, API and web builds all exit 0 | VERIFIED (Node 24) | Docker builds use `npm install` and no API lockfile; Node 20/22/24 mix | Engineering (R-021) |
| SR-DEP-03 | Migrations apply on a fresh database and over existing data; ORM and migrations agree | `src/database/migrations`, `migrate.ts` | E3 fresh 68 tables, `db:audit` 0 drift; upgrade over data lost no rows | VERIFIED (disposable DB) | Production database state and lock times unknown | Operator: rehearsal (R-003) |
| SR-DEP-04 | CI runs the checks on every change | `.github/workflows/test.yml` | none: untracked, never run; two defects fixed in Phase 19 | BLOCKED | The pipeline is unproven | Release owner: commit and run |
| SR-DEP-05 | The release candidate is committed, reviewed and merged | n/a | `git status`: 144 modified, ~499 untracked | BLOCKED | Nothing deployable exists in version control | Release owner (release blocker B1) |
| SR-DEP-06 | Images build and run | `apps/api/Dockerfile`, `ownus/Dockerfile` | none | NOT VERIFIED | Docker unavailable | Operator |

## 3. Summary by status (count of rows above)

| Status | Rows |
|---|---|
| VERIFIED | 48 |
| PARTIALLY VERIFIED | 19 |
| NOT VERIFIED | 11 |
| FAILED | 0 |
| BLOCKED | 6 |
| NOT APPLICABLE | 0 |
| **Total** | **84** |

(The counts are tallied by a script over this file's tables; see section 5.)

## 4. Reading the gaps
VERIFIED rows are the controls that are implemented in code **and** have passing automated evidence from this machine. They say nothing about production. The 31 rows that are not VERIFIED fall into four groups:
1. **Not implemented** (SR-AUTH-06, SR-FIN-05, SR-PRIV-03, SR-PRIV-06, SR-LOG-02, SR-PROV-06): decisions or engineering work, listed in the risk register.
2. **Depends on an operator or a host** (SR-SEC-03, SR-SEC-04, SR-BAK-03, SR-LOG-05, SR-DEP-04, SR-DEP-05): cannot be closed from the repository.
3. **Tested only in part** (the PARTIALLY VERIFIED rows): the untested part is in the Residual column.
4. **Unverifiable here** (real providers, Docker, deployed domain, Typesense).

## 5. Regeneration and limits
- Counts in section 3 are produced by `python` over the status column of the tables in section 2 (script kept in the Phase 20 scratch area, not in the repository). Re-tally if a row changes.
- Evidence E1 re-runs with: `npm run test:e2e`, `npm run test:unit`, `npm run test:integration` (and `CONCURRENCY_DATABASE_URL=<empty disposable local database> ... jest --config ./test/jest-e2e.json pg-concurrency` for SR-FIN-01).
- This matrix was written from inspection and execution in Phase 20; it replaces the closure matrix in `SECURITY_FINAL_REVIEW.md` where the two differ (section 6).

## 6. Corrections to earlier reports found in this phase
| Earlier statement | Correction | Basis |
|---|---|---|
| `SECURITY_FINAL_REVIEW.md`: `admin-auth.e2e-spec.ts` 23/23 | 8 tests; 23 is `auth-hardening.e2e-spec.ts` | E1 per-file counts |
| `SECURITY_FINAL_REVIEW.md` / Phase 17: "1,726 unit tests passed" | Unit 802 and integration 945 are separate runs (1,726 was the Phase 15 combined unit-and-integration figure); the "13 skipped" belong to integration | E2 |
| SG-05 "VERIFIED_CLOSED" | Partly closed: register, trigger and service exist; no intake workflow; previously unlocked exports are not re-filtered (2 todo tests) | SR-PRIV-02/03/06 |
| SG-04 "VERIFIED_CLOSED" | Closed on the API path; the gateway status screen can still publish from an UNREVIEWED source | SR-PROV-03 |
| SG-14 CI "VERIFIED_CLOSED" | The workflow is untracked, never ran, and had two defects | SR-DEP-04 |
| SG-18 containers "VERIFIED_CLOSED" | Dockerfiles use `USER node` and `.dockerignore` excludes env files, but no image was ever built | SR-SEC-05, SR-DEP-06 |
| SG-02b / SG-06 / SG-07 / SG-08 / SG-11 "ACCEPTED_RISK_PENDING_APPROVAL" | No owner has accepted any of these. They are **open, decision pending**, not accepted | `SECURITY_RISK_REGISTER.md` |
| Phase 17/18: "CONDITIONALLY READY" | The release is BLOCKED (Phase 19 and this phase) | `PRODUCTION_READINESS_REPORT.md` |
| `PRIVACY_COMPLIANCE.md` section 3: re-apply deletions from completed `DELETE` rows in `privacy_requests` after a restore | Those rows live inside the restored database and are rolled back with it; the source is the deletion ledger | Phase 16, corrected in the file |
| Phase 16 (my own): sections 14 to 16 of the gap report, remediation plan and test plan were destroyed by an editing error and later rebuilt | See `ORION_CHECKPOINT.md`, Phase 20 | file-history recovery |
