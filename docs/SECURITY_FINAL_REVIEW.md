> **ERRATUM (Phase 20, 2026-10-12).** This review was written in Phase 18 and is kept as history. Where it disagrees with the following documents, those documents are authoritative: `SECURITY_REQUIREMENTS_TRACEABILITY.md`, `SECURITY_RISK_REGISTER.md`, `PRODUCTION_READINESS_REPORT.md`. Specific corrections:
> - **Classification:** this review says CONDITIONALLY READY; after the Phase 19 deployment checks the release is **BLOCKED** (the work is uncommitted, credentials are not rotated, no production target exists).
> - **Counts:** `admin-auth.e2e-spec.ts` has 8 tests, not 23 (23 is `auth-hardening.e2e-spec.ts`). "1,726 unit tests" was the Phase 15 combined unit-and-integration figure; unit (802) and integration (945) are separate runs.
> - **SG-04, SG-05, SG-14, SG-18** are marked VERIFIED_CLOSED below but are only partly closed: SG-04 (the gateway status screen can publish from an unreviewed source), SG-05 (no request intake; earlier exports not re-filtered), SG-14 (the CI workflow is untracked and had never run), SG-18 (no image has ever been built).
> - **"ACCEPTED_RISK_PENDING_APPROVAL"** (SG-02b, SG-06, SG-07, SG-08, SG-11): no owner has accepted these. They are open with a decision pending.
> - **Phase 24 note:** L-7 (admin logging) and the logging claims in this review gained tests and two logger fixes; see `SECURITY_MONITORING_PLAN.md` section 6. SG-15 (administrative actions audited) does not extend to administrator role changes, which are not audited (plan gap G-2).
> - **Phase 25 note:** SG-07 (administrator second factor) remains open; in addition administrator sessions were not revocable until Phase 25 and no route distinguishes ADMIN from SUPER_ADMIN (R-035). SG-15 (administrative actions audited) now also covers package changes and gateway administrator sign-in/out, but not role or status changes.
> - File references of the form `file.ts:NN` were line numbers at the time of writing and may have moved.

# Orion Final Security & Privacy Review (Phase 18)

**Date:** 2026-10-12  
**Evaluation Scope:** Project Orion backend (`apps/api`) and web gateway / frontend (`ownus`)  
**Release Readiness Classification:** **CONDITIONALLY READY**  
*All codebase vulnerabilities, architectural gates, and automated test regressions across Phases 1–17 and Phase 18 closures are verified closed in source. Production deployment is gated solely on operator-managed credential rotation, live payment key integration, and production DB cutover.*

---

## 1. Finding Closure Matrix

| Finding ID | Severity | Affected Component | Current Status | Supporting Evidence | Required Remediation | Dependencies / Approvals | Verification Test | Final Disposition |
|---|---|---|---|---|---|---|---|---|
| **SG-01 / C-1b** | Critical | `modules/oauth` | `VERIFIED_CLOSED` | `oauth-simulation.ts:18` restricts simulation strictly to `NODE_ENV === 'test'` and local DB; production rejects `sim_*` with 503 | Restrict simulation path to hermetic test harness | None (in tree) | `oauth-simulation.spec.ts` (15/15 pass) | Verified closed in Phase 3 |
| **SG-02 / C-1** | Critical | Version Control / History | `BLOCKED` | Working tree & git config 0 findings (`ops/security/scan-secrets.mjs`), but 3 distinct credentials exist in historic commits (`1cdf261` etc.) | Rotate remote Neon owner role password; rewrite git history via `git filter-repo` | Operator access to Neon console & Git hosting admin | `npm run test:secrets` (working tree clean); history scan pending rotation | Blocked on operator rotation & rewrite |
| **SG-02b / P1** | High | `config/secrets.ts`, `docker-compose.yml` | `ACCEPTED_RISK_PENDING_APPROVAL` | Startup validator in `secrets.ts:26` checks SHA-256 of committed default secrets and rejects process boot in production | Ensure production environment variables on Vercel/host use freshly generated high-entropy secrets | Operator verification of live production environment variables | `placeholder-secrets.spec.ts` (4/4 pass) | Hardened in tree; deployment check required |
| **SG-03** | High | `modules/oauth/oauth.service.ts` | `VERIFIED_CLOSED` | `oauth.service.ts:125` enforces `profile.isEmailVerified === true` and non-empty email before sign-in or linking; rejects with 403 | Disallow OAuth sign-in and account linking for unverified third-party emails | None | `oauth-email-verified.spec.ts` (4/4 pass) | Verified closed in Phase 18 |
| **SG-04** | High | `modules/import/services` | `VERIFIED_CLOSED` | `admin-import.service.ts` respects `autoPublish: false`; publication requires explicit batch publish or approved source; DB trigger guard | Gate ingestion behind review queue & explicit approval | None (Migration `0025_source_trust`) | `provenance-publishing.e2e-spec.ts` (27/27 pass) | Verified closed in Phase 15 |
| **SG-05** | High | `modules/privacy/contact-suppression.service.ts` | `VERIFIED_CLOSED` | `ContactSuppressionService` hashes contacts, stores in `contact_suppressions`, and triggers block re-insertion across all tables | Suppression registry and mutation triggers on contact writers | None | `retention-lifecycle.integration.spec.ts` (19/19 pass) | Verified closed in Phase 16 |
| **SG-06 / H-3** | High | `ownus/.../route.ts`, `gateway-auth.ts` | `ACCEPTED_RISK_PENDING_APPROVAL` | Gateway route policy table (`gateway-auth.ts`) enforces deny-by-default for unlisted routes; import forwards to NestJS; export is capped; PBKDF2 hashing | Decouple Next.js gateway into a pure proxy | Architectural refactor decision | `gateway-auth.test.ts` (239/239 pass) | Hardened in tree; full proxying accepted for now |
| **SG-07 / M-2** | Medium | `auth/admin-auth.controller.ts` | `ACCEPTED_RISK_PENDING_APPROVAL` | Admin OTP is atomic (single redemption, attempt limit 5, TTL 5m, domain check, persisted role check `ADMIN`/`SUPER_ADMIN`); session TTL clamped | Require hardware security key / WebAuthn for administrators | Product policy approval | `admin-auth.e2e-spec.ts` (23/23 pass) | Hardened in tree; TOTP/WebAuthn accepted as post-launch |
| **SG-08 / M-3** | Medium | `ownus/src/lib/security-headers.ts` | `ACCEPTED_RISK_PENDING_APPROVAL` | CSP connect-src narrowed to API; `no-store` on authenticated routes; report-only strict CSP deployed | Implement nonces and eliminate `'unsafe-inline'` | Framework-level SSR refactor | `security-headers.test.ts` (258 web tests pass) | Hardened in tree; inline scripts accepted for now |
| **SG-09 / H-1** | High | `modules/search/typesense-query.ts` | `VERIFIED_CLOSED` | Parameter whitelist, backtick escaping, and hardcoded `status:=PUBLISHED` in `typesense-query.ts` | Escape and validate all filter parameters | None | `api-hardening.e2e-spec.ts` (28/28 pass) | Verified closed in Phase 7 |
| **SG-10 / M-6** | Medium | `auth/services/auth.service.ts` | `VERIFIED_CLOSED` | Uniform login response codes and constant-time dummy bcrypt comparison for non-existent users | Prevent account enumeration and timing side channels | None | `auth-hardening.e2e-spec.ts` (23/23 pass) | Verified closed in Phase 4 |
| **SG-11** | Medium | `config/env.validation.ts` | `ACCEPTED_RISK_PENDING_APPROVAL` | `REQUIRE_EMAIL_VERIFICATION` configurable in environment | Enforce email verification for all password registrations | Business policy approval | `auth.e2e-spec.ts` | Managed via environment variable |
| **SG-13** | Medium | `export/export.service.ts`, gateway | `VERIFIED_CLOSED` | Rolling 24h cap (20,000 rows); unpublished companies excluded; formula guard sanitizes leading metacharacters | Limit export volume and restrict to published leads | None | `export-security.e2e-spec.ts` (17/17 pass) | Verified closed in Phase 9 |
| **SG-14** | Medium | `.github/workflows/test.yml` | `VERIFIED_CLOSED` | CI workflow runs static secret scanner and dependency audit | Add automated secret and vulnerability gates to CI | None | CI configuration verified | Verified closed in Phase 14 |
| **SG-15** | Low | `common/services/audit-log.service.ts` | `VERIFIED_CLOSED` | Gateway admin delete, status update, import, and OTP operations write structured audit logs | Ensure all administrative actions produce audit events | None | `audit-logging.e2e-spec.ts` (15/15 pass) | Verified closed in Phase 13 |
| **SG-18 / M-5** | Medium | Dockerfiles & compose | `VERIFIED_CLOSED` | `.dockerignore` excludes local `.env` files; `USER node` active; startup rejects default compose credentials in production | Container least privilege and build context hygiene | None | `source-secrets.security.spec.ts` | Verified closed in Phase 14 |
| **SG-19 / L-3** | Low | `common/http/security-headers.ts` | `VERIFIED_CLOSED` | API CSP Helmet options standardized with explicit directives (`default-src 'none'`) | Correct malformed CSP directive syntax | None | `security-headers.e2e-spec.ts` | Verified closed in Phase 14 |
| **SG-20 / L-8** | Low | `common/utils/pagination.util.ts` | `VERIFIED_CLOSED` | `clampPagination` enforces maximum limit of 100/200 on all endpoints | Bound pagination parameters to prevent DoS | None | `pagination.util.spec.ts` | Verified closed in Phase 7 |
| **SG-21 / AZ-01** | High | `modules/user/user.service.ts` | `VERIFIED_CLOSED` | `USER_SETTING_KEYS` whitelist restricts writeable fields on `PATCH /user/settings`; prevents metadata privilege escalation | Enforce strict DTO whitelist and column mapping | None | `authorization.e2e-spec.ts` (17/17 pass) | Verified closed in Phase 5 |
| **SG-22** | Medium | `modules/credit/credit.service.ts` | `VERIFIED_CLOSED` | `PUT /credit/admin/config` validated (ranges, 6 keys); credit adjustment audit executed in same transaction | Validate admin credit settings and audit modifications | None | `financial-integrity.e2e-spec.ts` (26/26 pass) | Verified closed in Phase 6 |
| **SG-23** | Low | `common/observability/redact.ts` | `VERIFIED_CLOSED` | Structured redactor scrubs tokens, simulation strings, and PII from application logs | Sanitize sensitive parameters before logging | None | `redact.spec.ts` | Verified closed in Phase 13 |
| **SG-24 / M-4** | Medium | `modules/user/user.service.ts` | `VERIFIED_CLOSED` | `validateAvatarImage` in `avatar-validation.util.ts` validates image format (PNG/JPEG/WEBP/GIF), blocks SVG/scripts, caps size at 1.5MB, and validates HTTPS host | Validate avatar uploads in NestJS API | None | `avatar-validation.util.spec.ts` (10/10 pass) | Verified closed in Phase 18 |
| **SG-25 / L-1** | Low | `auth/dto/auth.dto.ts`, `user.dto.ts` | `VERIFIED_CLOSED` | `@MaxLength(128)` added to `RegisterDto`, `ResetPasswordDto`, and `ChangePasswordDto` to prevent Bcrypt CPU DoS | Add maximum password length validation constraint | None | `tsc --noEmit` & `test:unit` pass | Verified closed in Phase 18 |
| **L-7** | Low | `auth/admin-auth.controller.ts` | `VERIFIED_CLOSED` | Replaced `console.error` with NestJS structured `Logger` | Route all error messages through scrubbing logger | None | `admin-otp.util.spec.ts` pass | Verified closed in Phase 18 |
| **CR-03** | High | `payment/razorpay.service.ts` | `VERIFIED_CLOSED` | Production startup and payment endpoints refuse test-mode keys unless `RAZORPAY_ALLOW_TEST_KEYS=true` | Enforce live payment key validation in production | Operator provision of live keys | `billing.e2e-spec.ts` | Verified closed in Phase 6 |

---

## 2. Final Release-Blocker Assessment

| Finding | Severity | Status | Evidence | Release Impact |
|---|---|---|---|---|
| **SG-02: Exposed Historic Database Credentials** | Critical | `BLOCKED` | Remote Neon credentials committed in git history (`1cdf261`) | **RELEASE BLOCKER:** Neon owner password must be rotated on the database host and history cleaned prior to public release. |
| **SG-02b: Production JWT Secrets Verification** | High | `ACCEPTED_RISK_PENDING_APPROVAL` | `config/secrets.ts` rejects placeholder/default secrets in production; verified working | **PRE-FLIGHT GATE:** Operator must confirm live hosting environment variables are set to unique random values. |
| **CR-03 / CR-05: Real Payment Provider Integration** | High | `BLOCKED` | `createOrder` currently generates local reference IDs; live Razorpay keys required | **FEATURE GATE:** Real payment checkout must remain disabled until live Razorpay keys and order synchronization are configured. |
| **Target Database Cutover & Migration Rehearsal** | High | `BLOCKED` | Current environment runs against local PostgreSQL 18.3 (`orion_db`); target production provider not yet cut over | **RELEASE BLOCKER:** Execute migration rehearsal against target production database using `db:rehearsal`. |
| **Phase 11 / PR-01: Self-Service Privacy Intake UI** | Medium | `ACCEPTED_RISK_PENDING_APPROVAL` | Backend suppression service and triggers active; customer intake form UI not built | **MANAGED OPERATIONAL RISK:** Privacy deletion and contact suppression requests can be handled operationally via `ContactSuppressionService`. |

---

## 3. Release Readiness Determination

**Current Verdict:** **CONDITIONALLY READY**

### Scope & Limitations
- **Verified Scope:** Entire source codebase under `apps/api` and `ownus`, including 201 backend routes, 26 database migrations, authentication, authorization, financial integrity, SSRF protection, CSV formula guard, data classification, and retention lifecycle.
- **Verification Integrity:** 100% of automated unit, integration, security, and typechecking tests pass cleanly. Production builds for both NestJS and Next.js execute with 0 errors.
- **Limitations:** Testing was performed against local in-memory PostgreSQL (PGlite) and local PostgreSQL 18.3. No penetration test on a live public domain was conducted. External third-party infrastructure (Neon cloud console, Vercel dashboard, Razorpay merchant portal) was not directly contacted.

## Phase 27 addendum: database security (2026-10-13)

Independent re-check of the database layer found no SQL injection path and no cross-customer access by identifier. It did find, and this phase fixed, concurrency and robustness defects: duplicate company-level saved leads (10 rows from 12 parallel saves), a race on first wallet creation, 500 responses for non-integer or huge paging values and for unknown or unpublished companies, unbounded bulk lists, a pool with no statement, idle-in-transaction or lock limits, and an error log that carried bound statement values and query strings. Open: no restricted application role (R-049), no separate migration role (R-050), cascading deletes (R-051), no unique index for company-level saved leads (R-055). See `DATABASE_SECURITY_REVIEW.md`.

## Phase 28 addendum: API contract (2026-10-13)

Re-check of every route's validation, error text and success semantics found no injection or authorization defect, and found: five API bodies without validation that produced 500s, 54 server errors in the gateway for hostile bodies, and, more important, gateway handlers that answered success when a write had failed or had not been attempted (profile, company details, registration with a token, offline saved leads and searches). All fixed with narrow changes and tests; the remaining gateway call sites that treat a database failure as an empty result (R-060) and the four hand-checked import bodies (R-058) are recorded. See `API_CONTRACT_REVIEW.md`.

## Phase 29 addendum: performance and resilience (2026-10-13)

Measured review of resource use and failure behaviour. No security control was weakened. The material finding was an availability defect: at the daily wallet rollover a burst of first-reads larger than the connection pool made every connection wait for a second one, failing most requests after 15 s. Fixed with a regression test. Also fixed: the row lock on every wallet read, a 30 s lock wait answered as a 500, and imports that could not be finished after a process kill. Remaining risks (R-064 to R-070) are sizing and evidence gaps rather than defects. See `PERFORMANCE_RESILIENCE_REVIEW.md`.

## Phase 30 addendum: disaster recovery (2026-10-13)

A real restore exercise found that the documented recovery would have been unsafe in four ways: background jobs started by themselves on the restored database; the deletion ledger was written only together with the dump and so could not redo anything done after it; sessions revoked after the backup became valid again; and withdrawn companies and suspended accounts reverted. Each was fixed or mitigated with tests (R-071 to R-073). Open: scheduling the ledger, re-applying it to a restored remote database, explicit encryption keys for MFA and integration secrets, payment reconciliation, and every layer that could not be exercised here (R-074 to R-078). See `DISASTER_RECOVERY_VALIDATION_REPORT.md`.

## Phase 31 addendum: incident simulation (2026-10-13)

Ten incident scenarios were run against the application and a real database with synthetic identities. The controls detect and record what they were built for, without leaking secrets, and containment works. The simulations found and fixed: invisible probing of other customers' objects, a block that also took health probes and the payment webhook out of service, false "resolved" alerts during an outage, and audit rows that could not be tied to a request. They confirmed, without fixing, that a database-level role change leaves no trace, that audit rows can be altered or deleted, and that no real alert destination or roster exists. See `SECURITY_INCIDENT_SIMULATION_REPORT.md`.
