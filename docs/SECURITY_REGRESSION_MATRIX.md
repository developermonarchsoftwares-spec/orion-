# Security regression matrix

**Prepared:** Phase 32, 2026-10-13 · **Tree:** branch `chore/neon-removal-prep`, HEAD `3cf08b3` plus uncommitted work (nothing here is in a commit) · **Companion:** `SECURITY_REGRESSION_VERIFICATION_REPORT.md` (method, results, weaknesses, gaps).

This maps each previously identified, code-controlled security finding to its remediation, the regression test that guards it, what was executed in Phase 32, and what is still uncovered. It is an assessment, not a certification. Nothing was verified in production, preview or any deployed environment.

## 1. How to read it

### Result codes (what was actually executed in Phase 32, on the working tree)
| Code | Run | Result |
|---|---|---|
| **U** | `npm run test:unit` (apps/api) | 47 suites, **874 passed**, 0 failed |
| **I** | `npm run test:integration` (in-memory PostgreSQL, PGlite) | 43 suites passed + 1 skipped (opt-in); **979 passed**, 13 skipped, 0 failed |
| **E** | `npm run test:e2e:all` (real Nest app, PGlite) | 45 suites passed, 1 skipped (opt-in real-PostgreSQL), **1 failed**; **688 passed**, 10 skipped, 3 todo, 1 failed (`health-probes`, see report s5) |
| **S** | `npm run test:security` | 1 suite, **9 passed** |
| **P** | `npm run test:perf` | 3 passed |
| **W** | `npm test` in `ownus/` (web, node:test) | **270 passed**, 0 failed |
| **PG** | `pg-concurrency.e2e-spec.ts` with `CONCURRENCY_DATABASE_URL` on a fresh disposable local database (PostgreSQL 18.3, real pool) | **10 passed** |
| **Static** | `tsc --noEmit` API and web, `nest build`, `test:secrets`, `db:migration:check`, `test:inventory` | all exit 0; secrets: 0 findings in the tree; journal: 26 entries consistent |

### Mutation evidence
"Mutation" means a temporary, test-only change to production source that removes or weakens the control, run against the narrowest relevant suites, then restored. Every restore was verified by SHA-256 against the pre-change file. **M-codes below were all executed in Phase 32.** "Historic" means a mutation proof recorded in an earlier phase and **not** repeated now; it is context only.

| M | Control removed or weakened | Suites run | Failures / total |
|---|---|---|---|
| M-A | `uploadAvatar` no longer validates (`user.service.ts`) | `avatar-validation.e2e` (new) | 15 / 17 |
| M-B | `updateProfile` no longer validates avatar | same | 15 / 17 |
| M-C | OAuth unverified-e-mail check off (`oauth.service.ts`) | `oauth-email-verified` unit | 1 / 4 |
| M-C2 | same | existing `oauth.e2e-spec` | **0 / 16 (not detected at HTTP level before this phase)** |
| M-C3 | same | `oauth-unverified-email.e2e` (new) | 2 / 2 |
| M-D | JWT session-id binding off (`jwt.strategy.ts`) | `auth-hardening`, `admin-session` | 4 / 31 |
| M-E | status check off in `RolesGuard` | admin suites | 0 / 31 (**equivalent mutant**: `JwtStrategy` already refuses SUSPENDED and INACTIVE) |
| M-E2 | status check off in `JwtStrategy` | `access-model`, `admin-authorization`, `admin-session`, `auth-hardening`, `auth-identity`, `account-integrity`; then `security-incident` | 2 / 80; 1 / 10 (the customer-account path) |
| M-R1 | role check off in `RolesGuard` | `admin-authorization`, `authorization`, `privileged-operations` | 14 / 40 |
| M-F | unlocked-leads export no longer limited to the caller | `export-security`, `authorization` | 6 / 40 |
| M-G | source-trust `assess()` approves non-approved sources | `provenance-publishing`, `admin-import-pipeline` | 3 / 39 |
| M-H | "already unlocked" ignores the owner (free unlock) | unlock, financial, authorization, performance suites | 1 / 62 |
| M-I1 | integration lookup ignores the owner | `integrations`, `authorization` | 2 / 45 |
| M-I2 | saved-lead delete by id ignores the owner | `saved-leads-searches`, `authorization`, `database-security` | 1 / 47 |
| M-I3 | CSV formula guard off | `export-security`, `import-export` | 2 / 38 |
| M-I4 | People suppression registry ignored on ingestion | `people-suppression` (integration) | 4 / 25 |
| M-I5 | refresh-token replay branch off | `auth-hardening`, `auth-identity`, `audit-logging`, `security-incident` | 1 / 66 |
| M-L1 | advisory lock in unlock replaced by `SELECT 1` | **PG** (fresh DB) | 0 / 10 (**equivalent mutant**: unique index `lead_unlocks_user_business_idx` plus the wallet row lock keep the outcome correct) |
| M-L2 | every wallet row lock (`FOR UPDATE`) removed in `credit.service.ts` | **PG** (fresh DB) | 3 / 10 |
| M-L2h | the same mutation as M-L2 | hermetic only: e2e `credit-wallet`, `financial-integrity`, `lead-discovery-unlock`, `performance-resilience`, `billing`, `database-security` (84); integration `credit`/`payment`/`unlock` (38); unit (4) | **0 / 126: invisible to every default suite** |
| M-P1 | advisory lock in saved-lead upsert removed (no unique index backs it, R-055) | **PG** (fresh DB) | 1 / 10 |
| M-S1 | `isBlockedAddress` always false (SSRF address rules) | `safe-http`, `public-url`, `avatar` unit | 108 / 183 |
| M-S2 | log scrubber no longer masks e-mail addresses | `redact`, `observability`, `log-injection` | 9 / 120 |
| M-S3 | People suppression no longer expires stored export files | `scheduled-export-people-suppression.e2e` | 1 / 1 |
| M-X1 | customer-visible-role filter emptied (suppressed/unpublished people visible) | `cross-workflow-regression.e2e` (new) | 1 / 2 |
| M-X2 | session binding off | same | 1 / 2 |
| M-W1 | web gateway publish guard accepts any source | web `publish-guard.test` | 1 / 6 |

Two attempts were **discarded as invalid** and are not counted as evidence: the first M-L1 run (the suite refuses a non-empty database, so every test failed for an unrelated reason; the unmutated baseline failed the same way), and the first M-X1 run (the mutation did not compile, "0 total"). Both were redone correctly.

### Status values
**GUARDED** = a test that reaches the real boundary asserts the security property, and a Phase 32 mutation (or, where marked, a historic one) made it fail. **PARTIAL** = guarded only at unit level, only by a historic proof, or for part of the property. **GAP** = no test would notice. **EXT** = depends on something outside the repository.

## 2. Coverage matrix: findings fixed in code

Critical and high first. "Type": unit / integration (in-memory PostgreSQL) / API (real app, HTTP) / PG (real PostgreSQL) / web / config.

| ID | Weakness originally found | Remediation (file) | Regression tests · type | Phase 32 result | Mutation | Status · remaining gap · action |
|---|---|---|---|---|---|---|
| SG-01 (Critical) | Simulated OAuth login active in every environment | `modules/oauth/oauth-simulation.ts`, providers | `oauth-simulation.spec` (15) unit; `oauth.e2e-spec` (16) API | U, E pass | historic (Phase 3) | **PARTIAL**: not re-mutated. Real Google/Microsoft callbacks never exercised (EXT) |
| SG-02/02b (R-001, Critical) | Credentials in Git history | `ops/security/scan-secrets.mjs` | scanner self-test; `test:secrets` | tree: 0 findings; **history: 3 distinct values** | n/a | **EXT/BLOCKED**: no regression test can close a rotation. Operator action |
| SG-03 (High) | Unverified provider e-mail could log in / link to a victim | `oauth.service.ts` | `oauth-email-verified.spec` (4) unit; **`oauth-unverified-email.e2e` (2) API, new** | U, E pass | M-C, M-C2, M-C3 | **GUARDED (gap closed this phase)**: before Phase 32 only a mock-based unit test guarded it (M-C2: 0/16) |
| AUTH-05 / R-037 | Logout and a newer sign-in did not end a token (customer and administrator) | `jwt.strategy.ts`, `auth.service.ts`, `admin-auth.controller.ts`, gateway | `auth-hardening.e2e` (23), `admin-session.e2e` (8), **`cross-workflow-regression.e2e` logout case (new)** API | E pass | M-D, M-X2 | **GUARDED** for the API. Gateway native flow proven only by an out-of-repo script (Phase 25): **PARTIAL** there |
| AUTH-04 | Refresh-token replay | `auth.service.ts` | `auth-hardening`, `audit-logging` API | E pass | M-I5 | **GUARDED** |
| S-08 | Suspended/inactive account kept working until token expiry | `jwt.strategy.ts` | `access-model`, `admin-session`, `security-incident` API | E pass | M-E2 (admin 2, customer 1); M-E (equivalent) | **GUARDED**. The role-guard status check is defence in depth and cannot be told apart from the strategy by any test |
| AUTH-01..03, 06, 07 | Gateway fell back past lockout/MFA; one-time code race; TOTP replay; non-uniform answers | `auth.service.ts`, `admin-auth.controller.ts`, gateway | `auth-hardening.e2e` (23), web `auth-hardening.test` | E, W pass | historic (Phase 4: TOTP 6 of 6 logins → 1) | **PARTIAL**: not re-mutated; gateway native-login MFA refusal wiring untested (Phase 4 note) |
| RBAC (SR-AZ-01/06/08) | Customer reaching privileged routes; role taken from the token | `roles.guard.ts` | `authorization.e2e` (17), `admin-authorization.e2e`, `privileged-operations.e2e` (18; every privileged path × 5 methods) API | E pass | M-R1 (14/40) | **GUARDED** for the API. Gateway admin handlers: unit only (R-006) |
| IDOR / BOLA (SR-AZ-02) | Cross-customer access to integrations, saved leads, unlocks, exports, invoices, wallets | per-module `userId` filters | `authorization.e2e`, `export-security.e2e`, `integrations.e2e`, `saved-leads-searches.e2e`, `database-security.e2e` API | E pass | M-I1, M-I2, M-H, M-F | **GUARDED** for the four mutated paths; invoices, wallets, schedules and API keys: tests exist, not re-mutated (**PARTIAL**) |
| AZ-01 | Mass assignment through `PATCH /user/settings` | `user.service.ts` | `authorization.e2e` API | E pass | historic (Phase 5) | **PARTIAL** |
| CR-01/03/04 | Unvalidated price config; test payment key in production; fractional amounts | `credit/*`, `payment/razorpay.service.ts` | `financial-integrity.e2e` (26) API | E pass | historic (Phase 6) | **PARTIAL**: not re-mutated; real payments absent (R-004, EXT) |
| Unlock charged once / never overspent | Races between parallel unlocks, payments, refunds | `unlock.service.ts`, `credit.service.ts` | `pg-concurrency.e2e` (10) **PG (opt-in)** | **PG: 10 passed** | M-L2 (3/10), M-L1 (equivalent) | **GUARDED only when the opt-in suite runs.** Default `E` is blind to lock removal (R-017: not in CI). The suite must be pointed at a **new empty database every run** |
| Saved lead duplicates under parallel saves | Duplicates; first-wallet creation race | `saved-leads.service.ts` (lock), `credit.repository.ts` | `pg-concurrency.e2e` PG | PG pass | M-P1 (1/10) | **GUARDED (PG only)**. No unique index (R-055); the lock is the only guard |
| Export authorisation (SR-EXP-01/02) | Other customers' or unpublished data in exports; headers | `export.service.ts`, `download-headers.ts` | `export-security.e2e` (17 + 1 todo), `export-csv-safety.spec` (25) | E, U pass | M-F | **GUARDED**. Remaining `todo`: People export after consent withdrawal (PR-02) |
| CSV / formula injection (P9-09) | Leading-whitespace bypass of the guard | `csv-security.util.ts`, web `csv-security.ts` | `export-csv-safety.spec`, `export-security.e2e`, web `csv-security.test` | U, E, W pass | M-I3 (2/38) | **GUARDED** (API). Gateway export untested over HTTP |
| Sensitive-field exposure (Phase 10) | Contacts and individual PAN shown before unlock; profile leaked metadata | `data-classification.ts`, `discover.service.ts`, `user.service.ts` | `data-classification.spec` (40), `privacy-classification.e2e` (13 + 2 todo) | U, E pass | historic (Phase 10, 8 proofs) | **PARTIAL**: not re-mutated. Two `todo`: CRM-sync exclusion, reviewer correction |
| SSRF (SR-SSRF-01/02) | Webhook and stored-URL address rules | `safe-http.ts`, `public-url.util.ts` | `safe-http-ssrf.spec` (96), `safe-http.spec` (49), `public-url.util.spec`, `ssrf-ingestion.e2e` (5) | U, E pass | **M-S1 (108/183)** | **GUARDED** at the function level; no real DNS/TLS/egress test (EXT) |
| **SG-24 / M-4 (found incomplete in Phase 32)** | Avatar URL host check was a string list: 9 of 14 probes passed, including `[::1]`, `127.0.0.2`, `169.254.1.1`, `100.64.0.1`, `fd00::1`, `metadata.google.internal` | `avatar-validation.util.ts` now uses the shared `parsePublicUrl` | `avatar-validation.util.spec` (+9 cases) unit; **`avatar-validation.e2e` (17) API, new** | U, E pass | M-A, M-B (15/17 each) | **GUARDED (fixed and covered this phase).** Before: wiring in `user.service.ts` had no test at all. Server-side fetch of avatars does not exist, so impact was Low |
| SG-25 | bcrypt DoS (no password cap) | DTOs `@MaxLength(128)` | `password-limits.spec` (3), `password-length.e2e` (3) | U, E pass | historic (Phase 22) | **PARTIAL**: not re-mutated. Login DTO deliberately uncapped |
| SQL injection / input (SG-09, P7, R-053) | Typesense filter injection; hostile strings; NUL bytes; `__proto__` | `typesense-query.ts`, `input-guard.middleware.ts`, DTOs | `database-security.e2e` (13 strings × 7 inputs), `api-hardening.e2e` (28), `typesense-query.spec` (7) | E, U pass | historic (Phase 7) | **PARTIAL**: not re-mutated. No live Typesense server ever queried. 11 inline bodies outside DTO validation (R-015) |
| Publication needs explicit approval (SG-04, P15) | Every clean imported row was published immediately | `publishing.service.ts`, `source-trust.service.ts`, trigger `0025` | `provenance-publishing.e2e` (27), `provenance.util.spec` (39) | E, U pass | **M-G (3/39)** | **GUARDED** (API path). Admin UI cannot publish (R-018) |
| R-005 (gateway publish) | Gateway status screen published an unreviewed source | web `publish-guard.ts` | web `publish-guard.test` (6) | W pass | **M-W1 (1/6)** | **GUARDED** at unit level; route handler HTTP run was an out-of-repo script (Phase 23): **PARTIAL** |
| Suppression: no re-ingestion (SG-05, P16/P22/P23) | Removed people/contacts returned through new imports | `people-suppression.ts`, `contact-suppression.service.ts`, trigger `0024` | `people-suppression.integration` (22), `retention-lifecycle.integration` (19), `privacy-classification.e2e` | I, E pass | **M-I4 (4/25)** | **GUARDED** |
| R-032 stored exports expiry | Suppressed person stayed downloadable in a stored export file | `common/privacy/stored-exports.ts` | `scheduled-export-people-suppression.e2e`, `scheduled-export-suppression.e2e` (3) | E pass | **M-S3 (1/1)** | **GUARDED** |
| **Suppression/logout across workflows (new)** | A control of one workflow bypassed by another | n/a (behaviour was already correct) | **`cross-workflow-regression.e2e` (2), new** | E pass | **M-X1, M-X2 (1/2 each)** | **GUARDED (gap closed)**: a person suppressed after a customer unlocked them is gone from on-demand export, list, detail, company view, bulk export and unlock, with no charge; a logged-out token reaches neither export, unlock, wallet nor history |
| Privacy-safe logging (SR-PRIV-09, R-033) | Secrets/e-mail in logs and audit rows; forged log lines | `redact.ts`, `scrub.ts`, `structured-logger.ts` | `redact.spec` (82), `log-injection.spec`, `audit-values.spec`, `audit-logging.e2e` | U, E pass | **M-S2 (9/120)** | **GUARDED**. Four `logger.*` calls still pass an e-mail in free text; the installed `StructuredLogger` masks it at write time (see report s6) |
| Rate limits / abuse (SR-API-04) | Missing per-route limits; unbounded input | `@Throttle`, traffic module, `pagination.util.ts` | `api-hardening.e2e` (28), `traffic-control.e2e`, `performance-resilience.e2e` | E, P pass | historic (Phase 7) | **PARTIAL**: in-process only (R-014); not re-mutated |
| DB timeouts / busy answers (P-3, R-056) | Pool self-deadlock, lock waits held connections | `pool-settings.ts`, `all-exceptions.filter.ts` | `pool-settings.spec`, `all-exceptions.filter.spec`, PG statement-timeout case | U, PG pass | historic (Phase 29) | **PARTIAL** |
| Restore-sensitive states (R-071..073) | Restore resurrects deletions, suspensions, revoked sessions; jobs run before reconciliation | `deletion-ledger.ts`, `restore-mode.ts` | `restore-recovery.integration`, `restore-mode.spec`, `retention-lifecycle.integration` | I, U pass | historic (Phase 30) | **PARTIAL**: not re-mutated; the shell scripts were never run in Phase 32 (EXT) |
| Detection (R-079..R-082) | Object probing invisible; health probes blocked; false "resolved"; request id missing | `security-signal.service.ts`, `traffic.middleware.ts`, `monitoring.service.ts`, `audit-values.ts` | `security-incident.e2e` (10), `security-alerts.integration`, `security-alert-rules.spec`, `audit-values.spec` | E, I, U pass | historic (Phase 31, fail-first) | **PARTIAL**: not re-mutated; no real alert destination (R-085, EXT) |
| Privileged operations (R-038..R-040) | Gateway admin sign-in unaudited; package changes unaudited; 500 on unknown account | `credit.service.ts`, `credit.controller.ts`, gateway | `privileged-operations.e2e` (18) | E pass | historic (Phase 25) | **PARTIAL**: gateway audit rows by script only |

## 3. Register entries that have no code-level regression test, and why

85 entries exist (R-001 to R-085). The matrix above covers the technical findings that were fixed in code. The rest are not testable by a regression suite today:

| Reason | Entries |
|---|---|
| Operator or hosting action (rotation, host secrets, production database, backups, alerts, branch protection, on-call) | R-001, R-002, R-003, R-042, R-047, R-048, R-069, R-078, R-085 |
| Product, legal or policy decision (not implemented by design) | R-007, R-008 (intake), R-011, R-016, R-024, R-025, R-035, R-036, R-018, R-061, R-077 |
| Process (version control, CI, images, documents) | R-021, R-022, R-023, R-030, R-043, R-044, R-045, R-046 |
| Real code gap: no test is possible until the control exists | R-012 (tamper evidence), R-013 (wallet `CHECK`, ledger key), R-049/R-050 (database roles), R-054 (atomic quotas), R-055 (unique index), R-084 (containment audit), R-083 (guessing alert) |
| Open, low, with partial tests | R-006, R-009, R-014, R-015, R-017, R-019, R-020, R-026, R-027, R-028, R-029, R-051, R-052, R-053, R-056, R-057, R-058, R-059, R-060, R-062, R-063, R-064, R-065, R-066, R-067, R-068, R-070, R-074, R-075, R-076 |
| Open or only mitigated, with partial tests (also named above or in section 2) | R-034 (detection gaps), R-041 (small items), R-071 (privacy RPO = ledger interval; mitigated) |
| Fixed and listed in section 2 | R-005, R-032, R-033, R-037, R-038, R-039, R-040, R-072, R-073, R-079, R-080, R-081, R-082 |
| Documents only | R-031 (inaccurate earlier reports, corrected in Phase 20) |
| Blocked / decision with an external part | R-004 (real payments), R-010 (remote ledger re-apply) |

No entry was closed in Phase 32 by editing a document. Phase 32 adds **R-086** (avatar host check incomplete; Low; fixed and covered) to the register.

## 4. Counts

- Register entries reviewed: **85**. Traceability rows reviewed: **84** (48 VERIFIED, 19 PARTIALLY VERIFIED, 11 NOT VERIFIED, 6 BLOCKED, 0 FAILED before this phase; changes in section 5 of the report).
- Rows in the section 2 matrix: **31** (counted from the file; the first word of each Status cell decides): **GUARDED 18, PARTIAL 12, EXT/BLOCKED 1**. A GUARDED row can still name a residual gap in its last column; read it.
- Labelled mutations executed this phase: **27** (28 runs; M-E2 was run against two suite sets). **Detected: 23. Not detected: 4**: M-E and M-L1 are equivalent mutants (another layer enforces the same property); M-C2 shows the existing HTTP-level OAuth suite did not notice the change (the unit test did; a new HTTP test now does); M-L2h shows the default suites cannot see wallet-lock removal (the opt-in real-PostgreSQL suite does, M-L2). Two further attempts were discarded as invalid (see above).
- One control had **no test at all** at the HTTP boundary before this phase: avatar validation wiring (M-A/M-B). It also turned out to be incomplete (F32-01). Both are fixed and covered.
- New tests added: 21 API tests (17 avatar + 2 cross-workflow + 2 OAuth) and 9 unit cases (avatar bypass forms).
