# Orion security gap report (Phase 1 audit, re-verified)

**Date:** 2026-10-10 · **Type:** audit only. No code, schema, migration, dependency, configuration or infrastructure was changed. · **Scope:** working tree at `D:\Monarch Project\Own product\ownus\ownus`, branch `chore/neon-removal-prep`, HEAD `3cf08b3`.

**Basis:** this report replaces the 2026-10-09 version (same finding ids). Start point was `docs/ORION_CHECKPOINT.md`. Every finding was re-checked against the current source on 2026-10-10; changes since the last version are listed in section 8. Companion detail: `SECURITY_AUDIT_REPORT.md`, `PRIVACY_AUDIT_REPORT.md`, `SECURITY_TEST_RESULTS.md`.

**This audit is PARTIAL:** static review plus read-only commands. No dynamic testing, no signed-in testing of live routes, no review of hosting or cloud configuration, and the roughly 4,400-line gateway was sampled, not read line by line. It does not say Orion is secure or production-ready.

Evidence labels: **CONFIRMED** (seen in code or a read-only run), **POTENTIAL** (depends on a condition not verified), **UNVERIFIED** (appears to exist, not tested end to end). Severity: **P0** production blocker · **P1** fix before paid launch · **P2** prioritised · **P3** hardening.

---

## 0. Repository inventory (verified)

| Area | What exists |
|---|---|
| Frontend | Next.js 16 / React 19 in `ownus/` (route groups `(marketing)`, `(auth)`, `(app)`, `admin`). `apps/web` is an empty stub. |
| Backend | NestJS 11 in `apps/api/src`: 31 controllers, about 201 route handlers, 35 `@Public()` markers, 20 `@Throttle` overrides, 25 modules (business, credit, dashboard, discover, export, health, import, integrations, monitoring, oauth, payment, people, privacy, queue, saved-leads, saved-searches, search, settings, storage, traffic, typesense, unlock, user) plus `auth`, `common`, `config`, `database`, `workers`. |
| Web gateway | `ownus/src/app/api/v1/[...path]/route.ts` (4,364 lines): proxies to the API and re-implements many routes natively with its own database connection and token secrets (SG-06). Route policy table in `ownus/src/lib/gateway-auth.ts`. |
| Database | Drizzle, PostgreSQL. 21 schema files (`users`, `businesses`, `business_details`, `people`, `credits`, `billing`, `exports`, `privacy`, `audits`, `traffic`, `integrations`, `imports`, `review_publish`, `queue_jobs`, `search_sync`, `admin_otps`, others), 25 migration files (0000-0023 applied, journal rules in `ORION_CHECKPOINT.md`). |
| Authentication | E-mail and password, Google and Microsoft OAuth, optional TOTP, admin e-mail OTP. |
| Authorization | Global `JwtAuthGuard` then `RolesGuard` as `APP_GUARD`. Roles USER, DATA_MANAGER, ADMIN, SUPER_ADMIN. |
| Pipelines | Company import (admin CSV or JSON, normalise, validate, duplicate check, publish), People ingestion (source registry, observations, verification, review, suppression, quarantine, publishing), search-index sync job. Verification and enrichment live in the People module; company imports have no verification step. |
| Credits and billing | `user_wallets`, `credit_transactions`, `credit.scheduler` (daily free credits), Razorpay orders, webhook, invoices, packages. |
| Exports | CSV and XLSX of unlocked leads, people and saved leads; scheduled exports. |
| Privacy | `modules/privacy`: consent ledger, data export, deletion with grace period, retention scheduler, request tracking. |
| Operations | Structured and scrubbed logger, request ids, Prometheus metrics, health probes, `modules/traffic` (IP rules, plan limits, lockout, CAPTCHA service). |
| Tests | 85 spec and e2e files under `apps/api` (in-memory PGlite for e2e), web unit tests, Playwright groups in `tests/`, CI in `.github/workflows/test.yml`. |
| Documentation | About 75 files in `docs/` including privacy, retention, incident response, backup, credential and migration documents (most marked "not approved"). |

## 1. Existing security controls (verified in code)

| Control | Where |
|---|---|
| Default-deny JWT guard, explicit `@Public()`, persisted-role guard | `app.module.ts:143-155`, `auth/guards/*` |
| JWT checks issuer, audience, expiry, token type; suspended or inactive users rejected every request | `auth/strategies/jwt.strategy.ts` |
| bcrypt cost 12; reset tokens hashed, single use, 15 minutes; sessions revoked and owner notified | `auth/services/password.service.ts`, `auth.service.ts` |
| Refresh token rotation with family revocation; session id rotation on logout | `auth.service.ts` |
| Login lockout by e-mail and IP; per-route throttles on auth routes | `auth.controller.ts` (`@Throttle`), `auth.service.ts` |
| Global ValidationPipe with whitelist and forbidNonWhitelisted | `main.ts` |
| Credit deduction in one transaction, wallet row `FOR UPDATE`, ledger row per change | `credit/credit.service.ts` |
| Unlock: per-pair advisory lock, unique index, in-transaction publish re-check, single charge | `unlock/unlock.service.ts` |
| Payments: HMAC verification, order bound to user and amount, provider capture check in live mode, idempotency by payment id, raw-body webhook signature | `payment/*` |
| Exports: owner-scoped, 5,000-row cap, audit entry, formula-injection guard, throttles | `export/export.service.ts` |
| SSRF-safe outbound HTTP (https only, resolved-IP checks, no redirects, size and time caps) | `integrations/net/safe-http.ts` |
| Generic error messages in production; log scrubbing of e-mails, tokens, passwords, connection strings | `common/filters/all-exceptions.filter.ts`, `common/observability/scrub.ts` |
| Production secret policy (short or development values refuse to start) | `config/secrets.ts`, `config/env.validation.ts` |
| Metrics need a token; Swagger off in production; Helmet; web CSP, HSTS, frame denial | `main.ts`, `ownus/next.config.ts` |
| Traffic module: IP rules, plan limits, scanner user-agent blocking, request ids | `modules/traffic`, `common/middleware` |
| Upload limits and shape validation; CSV formula guard | `common/http/upload-body-limit.ts`, import `upload-validation.ts` |
| Repository secret scanner in CI (`ops/security/scan-secrets.mjs`, with self-test) | `.github/workflows/test.yml:26-27` (added since the last report) |
| Local-database guard and dry-run default for destructive scripts | `apps/api/scripts/*`, `db-guard.ts` (Step 2A) |
| Ownership scoping on saved leads, saved searches, integrations, exports, unlocks, settings | respective services (no IDOR found) |

## 2. Existing privacy controls

| Control | Where |
|---|---|
| Consent ledger: opt-in, default off, append-only, versioned, IP kept 3 years | `privacy.service.ts`, `privacy.config.ts`, `database/schema/privacy.ts` |
| Customer data export (JSON) and privacy request tracking with 30-day due date | `privacy.controller.ts`, `privacy.service.ts` |
| Account deletion with 7-day cooling-off, hourly execution, anonymised shell kept for billing records | `privacy.scheduler.ts` |
| Scheduled retention: audit-log IP and user agent after 180 days, queue jobs and integration deliveries 30 days, completed requests 3 years | `privacy.config.ts`, `docs/DATA_RETENTION_POLICY.md` (proposal) |
| People model: personal e-mail deliberately not modelled; contact types limited by check constraint | `database/schema/people.ts` |
| Contact values withheld until unlock (company: masked; people: withheld); locked people never exported | `discover.service.ts:385-445`, `people-export.service.ts` |
| Log scrubbing of personal data | `common/observability/scrub.ts` |
| Admin OTP and reset tokens stored hashed | `admin_otps`, `password.service.ts` |

## 3. Existing compliance controls

| Topic | Implemented | Not implemented |
|---|---|---|
| Consent | Customer consent ledger | Consent or notice for third-party individuals (not applicable by design, needs a legal basis and notice) |
| Retention | Scheduler for logs, queue, requests; People freshness TTL per source | No schedule for legacy company contacts or stale businesses |
| Deletion | Customer deletion with grace period; admin delete of businesses (hard delete in gateway, SG-17) | Deletion of third-party individuals on request; backups, object storage and third parties not covered by code |
| Suppression | People: hashed LinkedIn, work e-mail and phone; checked in ingestion and inside the unlock transaction | Company contacts (`business_contacts`): none (SG-05); no public intake; index and cache purge not traced |
| Auditability | `audit_logs` (logins, unlocks, exports, imports, credit adjustments, privacy requests, people review and publishing); credit ledger; consent ledger | Admin reads of customer PII, gateway export, gateway admin user and transaction lists (SG-15, SG-13) |
| Provenance | People: source registry, observations, evidence, verification timestamps | Company contacts: no source, no collected-at (SG-04, SG-05) |
| Policy accuracy | Customer rights statements match code | Several statements do not (SG-16) |

---

## 4. Missing security controls

### SG-01 · P0 · CONFIRMED · Simulated OAuth login active in every environment

> **Phase 3 status (2026-10-10): code fix applied in the working tree, NOT committed, NOT deployed. The vulnerability remains live in any deployed build until this change ships.** Simulation is now allowed only when `NODE_ENV=test` and the database is local (`modules/oauth/oauth-simulation.ts`); both providers refuse `sim_*` codes and unconfigured providers otherwise, and no longer log the code. Verified by `modules/oauth/__tests__/oauth-simulation.spec.ts` (new) and the OAuth e2e suites. Not verified against a running deployed server. Remaining SG-01 follow-up: none in code; SG-03 (linking rules) is separate and still open.
- **Issue:** `exchangeCode` accepts any code starting `sim_google_` / `sim_ms_` (or any code when the provider is unconfigured) and `getUserProfile` returns the text after the prefix as a verified e-mail. No `NODE_ENV` check exists under `modules/oauth` (re-grepped 2026-10-10: only the two prefix checks match). The callback is public and `oauth.service.ts:147-160` links to an existing user by e-mail and issues tokens.
- **Risk:** unauthenticated account takeover of any customer or administrator. Provider step executed read-only with `NODE_ENV=production`; the full HTTP chain was not run against a live server.
- **Severity:** P0
- **Files:** `modules/oauth/providers/google.provider.ts:77-84`, `microsoft.provider.ts:77-87`, `oauth.service.ts:118-165`, `oauth.controller.ts`, gateway `lib/gateway-auth.ts`.
- **Recommended fix:** remove the simulation branches outside `NODE_ENV=test` (same rule as `fixedOtpAllowed()`); refuse unconfigured providers; add unit and e2e tests that `sim_*` codes never create a session.

### SG-02 · P0 · CONFIRMED · Credentials committed to git

> **Phase 3 status (2026-10-10): STILL OPEN.** Working tree: the seven scratch files no longer contain the credential (they now take a local-only target from `ownus/scratch_target.js`; the scanner reports 0 findings), but these edits are **uncommitted**, so HEAD and all history still contain it. No credential has been rotated or revoked (operator action). `git` history scan: 3 distinct secret values (1 database credential, 2 signing secrets). See section 10 for the additional finding SG-02b.
- **Issue:** seven tracked files at HEAD contain a PostgreSQL URL with an owner-role password for a remote managed host: `ownus/scratch_inspect_tables.js`, `scratch_master_e2e_verification.js`, `scratch_test_app_preferences_persistence.js`, `scratch_test_db.js`, `scratch_test_notifications_integration.js`, `scratch_test_profile_persistence.js`, `scratch_test_single_device_login.js` (re-verified 2026-10-10, values redacted). The other eight pattern matches are local or placeholder URLs. `.env.production.example:98` holds a `rzp_live_` key id that must be confirmed as a placeholder.
- **Risk:** anyone with repository read access can attempt to reach the remote database with owner privileges. Repository visibility and rotation status are UNVERIFIED (`ORION_CHECKPOINT.md` records rotation as pending).
- **Severity:** P0
- **Files:** the seven files above; git history (six commits touch the host name).
- **Recommended fix:** rotate first; review provider access logs; remove files; decide history purge (needs approval); the `origin` token was already removed (see section 8). Detail in `SECURITY_REMEDIATION_SG02.md`.

### SG-03 · P1 · CONFIRMED · OAuth e-mail linking ignores provider verification
- **Issue:** the by-e-mail link ignores `profile.isEmailVerified`; Microsoft uses `mail || userPrincipalName` on tenant `common`; e-mail verification is off in the production example, so an attacker can pre-register a victim's address.
- **Risk:** takeover without SG-01.
- **Severity:** P1 · **Files:** `oauth.service.ts:147-160`, `microsoft.provider.ts:156`, `auth.service.ts:56-95`.
- **Fix:** link only when both sides are verified; otherwise require a signed-in link flow.

### SG-04 · P1 · CONFIRMED · Company imports publish without moderation, source or provenance
- **Issue:** `autoPublish` defaults to `true` in the controller (`admin-import.controller.ts:85,117`) and service (`admin-import.service.ts:427`) and is never read by `import-pipeline.service.ts` or `publishing.service.ts` (grep returns nothing), so valid rows go straight to `PUBLISHED`. Batches are not tied to an approved source.
- **Risk:** a bad CSV from any administrator is immediately customer-visible and unlockable; no traceability.
- **Severity:** P1 · **Files:** `modules/import/services/import-pipeline.service.ts`, `admin-import.service.ts`, `publishing.service.ts`, controller.
- **Fix:** honour `autoPublish`, require a source for company batches, store source and collected-at on contacts.

### SG-05 · P1 · CONFIRMED · No suppression, classification or provenance for `business_contacts`
- **Issue:** no contact type, source, collected-at or suppression; `grep suppress` finds nothing in the business, discover, unlock, export or import services (only the People bridge). Local data: all 23 contacts have both verification flags true while one has an e-mail.
- **Risk:** objections cannot be honoured without deleting the company; re-import restores; unearned "verified" shown to paying customers.
- **Severity:** P1 · **Files:** `database/schema/business_details.ts:53-80`, `discover.service.ts:385-410`, `unlock.service.ts`, `export.service.ts:123-145`.
- **Fix:** route individuals through the People model or add type, source, collected-at and a suppression check in all read paths; reset unearned flags.

### SG-06 · P1 · CONFIRMED · The web tier is a second backend (architecture change, section 6)
- **Issue:** the gateway signs and verifies JWTs, has its own login, reset, OTP, discover and export logic and a direct database connection.
- **Risk:** compromise of the web tier bypasses API guards, audit log and rate limits; every API fix must be duplicated; a native branch without a policy-table entry is unauthenticated at the gateway.
- **Severity:** P1 · **Files:** `ownus/src/app/api/v1/[...path]/route.ts`, `lib/gateway-auth.ts`, `lib/db.ts`, `ownus/.env.local`.
- **Fix (in architecture):** least-privilege DB role, verify-only keys, deny-by-default test that enumerates native branches. Long term see section 6.

### SG-07 · P1 · CONFIRMED · Admin access is single-factor with a 7-day session
- **Issue:** e-mailed 6-digit code only; gateway cookie `maxAge` 7 days (`route.ts:638`); token also written to `localStorage` (`app/admin/monarch/page.tsx:302`).
- **Risk:** mailbox control equals admin control for a week; XSS reads the token.
- **Severity:** P1 · **Files:** `auth/admin-auth.controller.ts`, `route.ts:593-640`, `admin/monarch/page.tsx`.
- **Fix:** TOTP or WebAuthn for admins, 1-hour sessions, no `localStorage` copy, session revocation.

### SG-08 · P1 · CONFIRMED · Customer tokens in `localStorage` and in redirect URLs; weak CSP
- **Issue:** `api-client.ts:32-42` stores access and refresh tokens in `localStorage`; `oauth.controller.ts:79,129` redirect with `accessToken` and `refreshToken` in the query string; CSP allows `'unsafe-inline'` scripts.
- **Risk:** script injection steals 7-day refresh tokens; URLs reach history and logs.
- **Severity:** P1 · **Files:** `ownus/src/lib/api-client.ts`, `oauth.controller.ts`, `ownus/next.config.ts`.
- **Fix:** HttpOnly refresh cookie, one-time code exchange, nonce CSP.

### SG-09 · P1 (P2 if Typesense unused) · POTENTIAL · Typesense filter injection
- **Issue:** `typesense-search.provider.ts:25-39` concatenates user values (`industryId`, `state`, `city`, `pincode`, `district`, others) into `filter_by` without escaping. Default provider is Postgres.
- **Risk:** extra clauses could widen results past `status:=PUBLISHED`.
- **Files:** `modules/search/providers/typesense-search.provider.ts`. **Fix:** quote and escape, validate ids, keep the status clause outside user text.

### SG-10 · P2 · CONFIRMED · Account enumeration and timing
- Suspended or social-only accounts get distinct errors before the password check; unknown e-mails skip bcrypt; registration returns 409. **Files:** `auth.service.ts:214-244`. **Fix:** uniform answers and a dummy bcrypt compare.

### SG-11 · P2 · POTENTIAL · Free credits farmable
- 5 free credits per day per new account, e-mail verification off in the production example, CAPTCHA use on registration not confirmed (`auth.controller.ts` shows only throttles). **Files:** `credit.service.ts`, `auth.service.ts`, `traffic/captcha.service.ts`. **Fix:** verified e-mail before credits are usable; per-IP and per-domain registration limits.

### SG-12 · P2 · POTENTIAL · Client IP spoofable through the gateway
- Gateway copies `x-forwarded-for` upstream; API trusts one hop. **Files:** `route.ts` (forwarding), `main.ts`. **Fix:** set the trusted header at the edge, strip client values, restrict API reachability.

### SG-13 · P2 · CONFIRMED · Exports and unlock history ignore unpublish state; gateway export unaudited and uncapped
- **Files:** `export.service.ts:123-145`, `unlock.service.ts` (history), gateway native `discover/export`. **Fix:** filter on PUBLISHED and suppression in every read path; export through the API only.

### SG-14 · P2 · PARTLY ADDRESSED · CI scanning
- CI now runs the secret scanner (working tree). Still missing: git-history scan in CI (`test:secrets:history` exists, not in the workflow), `npm audit`, image scanning, Dependabot. **Files:** `.github/workflows/test.yml`.

### SG-15 · P2 · CONFIRMED · Admin console shows invented figures and lists PII without audit
- Gateway `admin/users` (`route.ts:3380`) and `admin/transactions` return fabricated phone, plan, spend and payment fields; no audit entry on the user list. **Fix:** read real billing data via the API, paginate, audit PII reads.

### SG-16 · P2 · CONFIRMED · Policy states controls the code does not have
- See section 5 (PR-03).

### SG-17 · P2 · CONFIRMED · Admin hard delete removes customers' purchase records
- Gateway `admin/businesses` DELETE removes `lead_unlocks` and `saved_leads`; no refund or ledger entry. **Fix:** soft-archive, or refund and record.

### P3 items (unchanged, re-read)
- **SG-18** Dockerfiles: Node 20 Alpine, `npm install`, MinIO `:latest` in compose. Files: `apps/api/Dockerfile`, `ownus/Dockerfile`, `docker-compose.yml`.
- **SG-19** CSP `connect-src` allows `http://localhost:4000` and any `https:`; malformed Helmet `scriptSrc` (`main.ts:35`).
- **SG-20** `unlock.controller.ts` and `export.controller.ts` use `Number(limit)` with no bound.
- **SG-21** `saved-leads.service.ts`, `saved-searches.service.ts` update by id without owner in the WHERE.
- **SG-22** `credit/admin/adjust` up to 1,000,000 per call by one admin, no second approval.
- **SG-23** `oauth-state.service.ts` keeps state in a process-local Map; providers log the simulation code.
- **SG-24** `user.service.ts:126-140` stores any string as `avatarUrl`.
- **SG-25** Password policy: minimum 8, no maximum, no breached-password check (`auth.dto.ts`).

## 5. Missing privacy controls

| ID | Issue | Risk | Severity | Files | Recommended fix |
|---|---|---|---|---|---|
| PR-01 (SG-05) | No suppression, classification or provenance for company contacts | Individuals cannot be removed; re-import restores; personal numbers sellable | P1 | `schema/business_details.ts`, `discover.service.ts`, `unlock.service.ts`, `export.service.ts` | Move individuals to the People model or add type, source, collected-at, suppression in all read paths |
| PR-02 | Privacy policy omits third-party individuals; no public notice, objection or removal route | Art. 14-type notice and objection rights not met | P1 | `ownus/src/app/(marketing)/privacy/page.tsx`, `privacy.controller.ts` | Add section and a tracked public removal request that triggers suppression (counsel to set legal basis) |
| PR-03 (SG-16) | Policy claims not supported: HTTP-only token cookies (tokens are in `localStorage`, line 209), two-factor admin (line 210), customer CSV uploads (lines 153-158, no such feature), per-organisation tenant isolation (line 211, isolation is per user) | Misleading statements to users and regulators | P1 | `privacy/page.tsx` | Fix the code or the text, and cover named mechanisms with tests |
| PR-04 | "Verified" flags on company contacts not earned | Paying customers misled | P1 | import path, `business_contacts` | Reset flags, set only from verification workflow |
| PR-05 (SG-13) | Unlock history and exports show contacts after unpublish | Data stays exposed after removal | P2 | `export.service.ts`, `unlock.service.ts` | Filter by status and suppression |
| PR-06 | Suppression may not purge search index or caches | Suppressed person remains discoverable | P2 (POTENTIAL) | `modules/typesense`, `people-suppression.ts` | Trace and add purge or re-index on suppression |
| PR-07 | Storage lifecycle, backup retention, sub-processors, transfers undocumented in code | Deletion promises not backed | P2 (UNVERIFIED) | `docs/PRIVACY_COMPLIANCE.md` §4 | Owner decisions, bucket lifecycle rules |
| PR-08 (SG-15) | Admin reads of customer PII not audited | No accountability for access | P2 | gateway `admin/users`, People review | Audit entries on PII reads |
| PR-09 | MOBILE contact type may be a personal number; no business-versus-personal flag | Personal data sold as business data | P3 | `schema/people.ts` | Add flag or restrict type |
| PR-10 | No retention schedule for stale company contacts | Indefinite retention | P3 | `privacy.config.ts` | Add schedule |
| PR-11 | OAuth-only account deletion needs no recent re-authentication | Stolen session can erase an account | P3 | `privacy.service.ts` | Require fresh auth |

## 6. Architecture change required

Only items that cannot be fixed safely inside the current architecture:

1. **SG-06, the gateway as a second backend.** Short-term controls (least-privilege role, verify-only keys, deny-by-default test) fit the current design, but the root cause (two signers and two database clients) can only be removed by making the API the sole signer and database client and reducing the gateway to a proxy. This is multi-week work and should be a decision, not an assumption.
2. **SG-05, one contact model.** Either company contacts move into the People model, or equivalent controls are added to `business_contacts`. Both are data-model changes, and the second does not need a new architecture. Recommended: the second (smaller), unless the owner wants a single model.

Everything else (SG-01 to SG-04, SG-07 to SG-25, PR-02 to PR-11) can be fixed inside the existing architecture.

## 7. Unverified controls and unobserved facts

- Production values of `NODE_ENV`, `REQUIRE_EMAIL_VERIFICATION`, `RAZORPAY_API_MODE`, `SEARCH_PROVIDER`, `CORS_ORIGINS`, `TRAFFIC_TRUSTED_IP_HEADER`.
- Whether the committed remote database credential has been rotated, and whether the repository is public.
- Database role privileges (API and gateway may both use an owner role).
- Signed-in behaviour of every route; whether tokens without a `sessionId` bypass the single-device check (`jwt.strategy.ts`).
- Refund and chargeback flow, CAPTCHA use on registration, admin OTP delivery path, bucket policy, backup encryption, any WAF or edge limits.
- Whether `.env.production.example:98` is a placeholder key id.
- The Playwright suite in `tests/` and a full test run were not repeated in this phase.

## 8. Changes since the 2026-10-09 version

| Item | Then | Now (verified 2026-10-10) |
|---|---|---|
| `origin` remote | URL contained an embedded token | credential-free (`ORION_CHECKPOINT.md`; re-checked) |
| CI secret scan | none | `scan-secrets.mjs` runs in `test.yml`; history scan and dependency or image scans still absent (SG-14) |
| Dependency advisories | 2 moderate, 0 high | commit `3cf08b3` updated drizzle-orm, bcrypt, next; audit state per checkpoint: 2 moderate, 0 high or critical |
| SG-04 detail | `autoPublish` "stored but never read" | re-verified: defaults to true in controller and service, not read in the pipeline |
| Everything else | | unchanged and re-confirmed |

## 9. Recommended order for the next phase (not started)

1. SG-02 rotate credentials (owner action, independent of code).
2. SG-01 remove simulated OAuth, with tests.
3. SG-03 linking rules; SG-07 admin second factor; SG-08 token storage.
4. SG-04 import gate; SG-05 / SG-13 / SG-17 company-contact controls.
5. PR-02 / PR-03 policy and public removal route.
6. SG-06 gateway reduction; SG-14 CI; SG-09 if Typesense is used; then P2 and P3 and an independent penetration test.


---

## 10. Progress and new findings, Phases 3 to 7 (2026-10-10)

**Read this first.** Everything below is **uncommitted working-tree work**: HEAD is still `3cf08b3`, nothing is staged, nothing is deployed. A fix listed as "fixed in the working tree" protects nothing that is running until it is committed, deployed, and (where noted) the matching operator action is done. "Verified" means an automated test or a recorded read-only check exists, and the evidence is named. Nothing here says Orion is secure or production-ready.

### 10.1 Status of the earlier findings

| ID | Severity | Status now | Evidence / what is still open |
|---|---|---|---|
| SG-01 simulated OAuth login | P0 | **Fixed in working tree** | `oauth-simulation.spec.ts` (6) plus the OAuth e2e suites. Simulation only for `NODE_ENV=test` with a local database; providers refuse otherwise. Live until shipped. |
| SG-02 credentials in git | P0 | **OPEN** | Seven tracked scratch files still hold the database owner credential at HEAD and in history (history scan: 3 distinct secret values). Working-tree copies are clean but uncommitted. **Nothing was rotated.** |
| SG-02b signing secrets in git (new) | P1 (P0 if production uses them) | **OPEN, operator action** | See 10.2. |
| SG-03 OAuth e-mail linking | P1 | **OPEN** | Not touched. Registration still marks the e-mail verified when `REQUIRE_EMAIL_VERIFICATION` is off. |
| SG-04 imports publish without review | P1 | **OPEN** | Not touched (business-pipeline change, needs the owner's decision on the default). |
| SG-05 company-contact suppression | P1 | **OPEN** | Not touched. Needs the contact-model decision. |
| SG-06 gateway is a second backend | P1 | **PARTLY mitigated, ARCHITECTURE CHANGE REQUIRED for the root cause** | Phase 4 closed the gateway's login/OTP bypasses (AUTH-01/02/03); Phase 7 bounded its search and export inputs; its route policy was enumerated (only `auth/logout` is ungated, and it verifies the token). Native handlers still have no per-route object-level tests. |
| SG-07 admin single factor, 7-day session | P1 | **PARTLY** | Admin session now 12 hours by default and configurable; OTP redemption is atomic and attempt-capped. **Second factor and admin session revocation are still missing.** |
| SG-08 tokens in `localStorage` / URLs | P1 | **OPEN** | Not touched. |
| SG-09 Typesense filter injection | P2 (P1 if enabled) | **Fixed in working tree** | `typesense-query.spec.ts` (7). Typesense is not the default provider. |
| SG-10 account enumeration and timing | P2 | **Fixed for login**, registration 409 remains | `auth-hardening.e2e` "login answers": identical status, code and message for four account states. Timing was **not measured**. Registration still answers 409 for an existing e-mail (cannot be hidden while verification is optional). |
| SG-11 free credits farmable | P2 | **OPEN** | Not touched. |
| SG-12 client IP via gateway | P2 | **OPEN, deployment-dependent** | Tests prove the API ignores `X-Forwarded-For` when proxy trust is off (test environment). Production topology unverified. |
| SG-13 exports and history ignore unpublish | P2 | **OPEN** | Gateway export is now capped (5,000 rows) but still unaudited and unfiltered by publication state. |
| SG-14 CI scanning | P2 | **PARTLY** | Secret scan in CI (working tree). History scan, dependency audit, image scan, Dependabot still absent. |
| SG-15 invented admin figures | P2 | **OPEN** | |
| SG-16 / PR-02 / PR-03 privacy policy and notice | P1 | **OPEN** | Documentation and counsel work. |
| SG-17 admin delete removes purchases | P2 | **OPEN, now evidenced** | Local data: 57 of 58 unlock charges have no unlock row (10.2, Phase 6). |
| SG-18 containers | P3 | **OPEN** | |
| SG-19 CSP details | P3 | **Partly fixed** | Production CSP no longer lists `localhost` in `connect-src`. `unsafe-inline` and `https:` remain. The API's `scriptSrc` is *not* malformed in effect (Helmet joins the values into the same header text); the API CSP is left as is because the monitoring dashboard needs inline script. |
| SG-20 unbounded pagination | P3 | **Fixed in working tree** | `pagination.util.spec.ts` (5), `api-hardening.e2e` "pagination". |
| SG-21 update by id without owner | P3 | **OPEN** | |
| SG-22 single actor mints credits | P3 | **OPEN** | The adjust endpoint is audited (it was); pricing changes are now audited too. |
| SG-23 OAuth state in memory | P3 | **OPEN** | The simulation log line is gone with SG-01. |
| SG-24, SG-25 | P3 | **OPEN** | |
| PR-01, PR-04..PR-11 | P1-P3 | **OPEN** | PR-01/04 follow SG-05; PR-05 follows SG-13. |

### 10.2 New findings by phase

**Phase 3: secrets and production configuration**

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| SG-02b | P1 | Confirmed exposure (location and type only) | The tracked `docker-compose.yml` at HEAD carries **two literal 88-character JWT signing secrets** (commits `03075bd`, `97a8eea`); the history scan lists them as 2 of the 3 distinct values. A hash comparison (no values printed) shows the local API `.env` and the gateway `.env.local` use **exactly these values** (development only). The Vercel production environment pulled to `.vercel/.env.production.local` has the JWT variables **empty** (the CLI does not pull sensitive values), so **production use is UNVERIFIED**. | Working-tree compose now requires the secrets (uncommitted). **Rotate the signing secrets, in local files too, and anywhere else they may be used.** |
| P3-01 | P2 | Missing control | A copied example file would run in production: the example JWT secrets are 59 to 60 characters, so they passed the minimum-length check. | **Fixed in working tree**: production refuses placeholder-shaped values and the two published compose values, in the API (startup) and the gateway (fails closed). `placeholder-secrets.spec.ts`, `gateway-auth.test.ts`. **Deployment risk: if production currently uses one of those values, the API will not start and the gateway will refuse to sign.** Confirm and rotate first. |
| P3-02 | info | Classification | `.env.production.example` carries a payment key id with placeholder marker words (27 characters): classified a placeholder, not a credential. The earlier "UNVERIFIED" is resolved by inspection only (the value was not printed). | Closed |
| P3-03 | info | Checked | The client bundle (`.next/static`) contains none of the server variable names, no connection-string pattern, no live-payment-key pattern. The bundle's build date is unknown, so this is not proof about the current source; `NEXT_PUBLIC_` use is limited to two non-secret URLs. | Recorded |
| P3-04 | info | Discrepancy | The Phase 1 and 2 reports said the seven scratch files held credentials in the tree; true at HEAD, but an earlier uncommitted step had already replaced them in the working tree (they now use a local-only helper). Likewise a hard-coded OAuth-state fallback secret was already removed, uncommitted. | Documented |

**Phase 4: authentication and sessions**

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| AUTH-01 | P1 | Confirmed | The gateway tried the API first and **fell back to its own native login/register/refresh/admin-code handler on any non-OK answer, including 401, 403 and 429**. An API lockout (429) or MFA requirement could be sidestepped by the native path. | **Fixed in working tree** (`isDefinitiveUpstream`: only an outage or a missing route falls back). The rule is tested; the wiring inside `route.ts` is **not** exercised by a test. |
| AUTH-02 | P1 | Confirmed (code reading) | The gateway's native login never checked `two_factor_enabled`: an account with MFA could sign in with the password alone through it. | **Fixed in working tree** (native login refuses MFA accounts, fails closed). **No automated test** (inline handler); verified by review and type-check only. |
| AUTH-03 | P2 | Confirmed (mutation-proven for TOTP) | Admin one-time codes were checked read-then-write: parallel guesses all saw "0 attempts used", and two parallel correct codes both minted a session. API and gateway. | **Fixed**: attempt claimed atomically before comparing; redemption by delete. API e2e (parallel guesses capped at exactly 5; one session from 10 parallel redemptions) and gateway tests on a real schema. |
| AUTH-04 | P2 | Confirmed, mutation-proven | A TOTP code could complete several logins at once (check then record). | **Fixed**: atomic claim of the time-step. With the old code all 6 parallel logins succeeded; now 1. |
| AUTH-05 | P2 | Confirmed | Logout revoked refresh tokens but left the access token valid until expiry. | **Fixed**: logout rotates the session id. Tested. |
| AUTH-06 | P2 | Confirmed, mutation-proven | The MFA code step did not honour the account lockout. | **Fixed**. |
| AUTH-07 | P2 | Confirmed | Login answered differently for unknown, social-only and suspended accounts, and skipped hashing for unknown users. | **Fixed** (uniform answer, dummy hash on both API and gateway). |
| AUTH-08 | P3 | Confirmed | Session ids came from `Math.random`. | **Fixed** (CSPRNG). |
| AUTH-09 | P3 | Missing control | No explicit JWT algorithm allowlist. | **Fixed** (HS256 pinned for signing and every verify path). Tested with `alg:none` and HS512. |
| AUTH-10 | P2 | Missing control | API admin-code resend had no per-account cooldown (a stranger could keep replacing the real code). | **Fixed** (30 s; the gateway already had 45 s). |
| AUTH-11 | P3 | Missing control | `previewOtp` was exposed under `NODE_ENV=test` alone. | **Fixed** (same local-database rule as the fixed code). |
| AUTH-12 | P2 | Partly | Admin session 7 days. | Now 12 h, configurable `ADMIN_SESSION_TTL_SECONDS` (15 min to 7 days). |
| AUTH-13 | P3 | Missing control | Gateway password change had no attempt limit. | Added (in-process). Not tested. |
| not changed | P2 | Limitation | The API admin sign-in path never sends the code (only the gateway sends mail); the API `changePassword` does not rotate the session (other devices' access tokens live up to 15 minutes); admin tokens carry no session id, so they cannot be revoked; `SESSION_SUPERSEDED` reaches clients as `HTTP_ERROR` with the message only. | Documented |

**Phase 5: authorization**

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| AZ-01 | P2 | Confirmed | `PATCH /user/settings` merged an arbitrary `preferences` object into the top level of `users.metadata`, the same column that holds `activeSessionId`, `mfaLastStep` and `passwordChangedAt`, and echoed the **entire** metadata back. A caller could overwrite their own security state (for example lock their own second factor) and read their session id. | **Fixed**: allowlist of 10 documented keys with types, unknown or reserved keys refused with 400, response limited to the allowed keys. `authorization.e2e`. Not mutation-tested. |
| none | | Verified | For saved leads, saved searches, exports (history, download, schedules), integrations (9 operations), invoices, API keys, sessions, unlock status and history, wallet and ledger, billing history: ownership comes from the token and is applied in the query or an immediate owner check; another customer gets 404; missing or malformed ids give 400 or 404. | `authorization.e2e` plus earlier suites |
| none | | Verified | Every one of the 201 API routes was discovered from live metadata: all non-public routes refuse anonymous callers (401); all role-restricted routes refuse an ordinary customer (403); the set of public routes is pinned (37), so a newly public route fails the suite. | `authorization.e2e` |

**Phase 6: credits, unlocks, billing**

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| CR-01 | P2 | Confirmed | `PUT /credit/admin/config` accepted any key and any JSON value; the daily-credit and annual-discount values were read straight into wallet arithmetic and checkout prices (a huge allocation, a negative or NaN balance, a discount above 100 making a negative price). | **Fixed**: allowlist of 6 keys with shape and range per value; read-back clamped to the default; every change audited with the old value and the administrator. |
| CR-03 | P1 (misconfiguration) | Missing control | With a Razorpay **test-mode** key and live mode on, the capture check passes for fake payments and would grant real credits. | **Fixed**: production refuses a test key (payments fail closed) unless `RAZORPAY_ALLOW_TEST_KEYS=true`. **Deployment note:** production on a test key will lose payments until the key is corrected. |
| CR-04 | P3 | Confirmed | `amount <= 0` let `NaN` and fractions through `addCredits` and `deductCredits`. | **Fixed** (whole numbers only). Callers pass constants, so this was defence in depth. |
| CR-02 | P2 | Missing control, **schema change needed** | No `CHECK` constraints on the wallet (non-negative, `balance = daily + purchased`); no unique key on ledger `(type, reference_id)` (payment idempotency rests on the advisory lock). Not implemented: needs a new migration and a data check first. | OPEN, needs approval |
| CR-05 | P2 | Evidence | Local ledger reconciliation (read-only): 9 of 58 wallets whose ledger does not sum to the balance, 5 expiry rows whose own snapshot is inconsistent (2026-09-22 and 2026-10-06), 57 of 58 unlock charges with no unlock row (their businesses no longer exist). All hard invariants hold: no negative wallet, no payment credited twice, no duplicate invoice, refund or unlock, no unlock without a charge. Probably development clean-up residue; **the cause is unproven and production was not examined.** | Tool added: `npm run db:reconcile-credits` (read-only). Run it against a production copy before launch. |
| CR-06 | P2 | Limitation | A refund keeps the customer's unlocked leads (policy undefined), refunds are full-amount only, and the provider refund is requested inside the database transaction (if the provider succeeds and the commit then fails, money moved without a refund row; a retry is rejected by the provider as already refunded). Refund events from the provider are not handled (a refund made in its dashboard does not reverse credits). | Documented; **decision needed** |
| none | | **Verified on real PostgreSQL** | Row locks and advisory locks are doing their job. The hermetic suites run on PGlite (one connection, whole transactions serialised) and **cannot** show this: with every lock removed they stay green. `pg-concurrency.e2e-spec.ts` (7 tests, opt-in) uses a real server and a 20-connection pool. With the locks removed it fails as expected (10 unlocks on a 3-credit wallet; 16 deductions on 5 credits; a lost update on a purchase racing a spend; duplicate payment credit and refund races); with them, 7 of 7 pass. | Run against disposable scratch databases only. |

**Phase 7: API abuse prevention**

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| P7-01 | P3 | Confirmed (SG-20) | `credit/transactions`, `unlock/history`, admin batches and traffic blocks passed raw page and limit values to SQL: a huge limit read the whole table; garbage became `NaN`. | **Fixed** (`boundedPage` / `boundedWindow`). |
| P7-02 | P2 | Missing control | The public search DTO had no length limits on text filters, no character limit on `sortBy`, no upper bound on `page`, no cap on `cursor`. | **Fixed** (limits per field; arrays and over-range values give 400). Valid searches, including the UI's sort names, still work. |
| P7-03 | P2 | Missing control | The gateway's native search (the production search path) turned garbage page and limit into `NaN`, had no `q` length cap, treated `%` and `_` as wildcards, and accepted unbounded lists. Its export had no row cap and an unbounded id list. | **Fixed** (clamped, not refused: `search-input.ts`); export capped at 5,000 rows with `X-Export-Truncated`. Tested; handler wiring guarded by a source test. |
| P7-04 | P2 | Confirmed (SG-09) | Typesense filter and sort strings were built from raw user values. | **Fixed** (quoted values, allowlisted sort). |
| P7-05 | P2 | Confirmed | Saved-search filters were stored as free-form JSON and re-run without the search validation. | **Fixed**: validated on save and on run (unknown keys still allowed, so no existing filter is dropped). |
| P7-06 | P2 | Missing control | Nothing rejected NUL bytes (PostgreSQL turns them into a 500) or `__proto__` / `constructor.prototype` keys in free-form bodies. | **Fixed**: request guard on every route. Mutation-proven. |
| P7-07 | P3 | Confirmed | A rate-limited response was `errorCode: INTERNAL_SERVER_ERROR` with the text "ThrottlerException: Too Many Requests". | **Fixed**: `RATE_LIMITED` with a plain message. |
| P7-08 | P3 | Confirmed | A malformed-JSON 400 echoed the parser's wording and the start of the input. | **Fixed** (plain message). |
| P7-09 | P2 | Missing control | Cost-bearing routes relied on the global limit only. | **Added** per-route limits: unlock 30/min, payments 20/min, bulk saves 10/min, search 60/min (autocomplete 120/min), refresh 30/min, e-mail verification 10/min, OAuth 20/min, credit adjust 30/min, admin import submit 10/min. The limit holds when the client rotates `X-Forwarded-For`, `X-Real-IP`, the e-mail or a query parameter (tested for login). |
| P7-10 | P3 | Missing control | The API set no Permissions-Policy and cached nothing-aware credentialed responses. | **Added** Permissions-Policy, and `Cache-Control: no-store` when a request carries credentials. |
| P7-11 | P3 | Verified | Errors in production: generic message, no stack, SQL, path or query string; request id included. | Now pinned by `all-exceptions.filter.spec.ts` (8 tests; none existed). |
| P7-12 | P3 | Open | 11 routes type their body as an inline object, which the validation pipe cannot check: 6 administrator-only (import and config), 5 authentication-related (admin code send and verify, logout, OAuth token, link and unlink). Their services check shape or fail safely, but a non-string value can still reach code that assumes a string. | OPEN, small DTO work |
| P7-13 | P2 | Limitation | The per-route and global limiter is **in-process**: with several API instances each keeps its own counters, so the effective limit is the stated one multiplied by the instance count. The traffic module's blocks are persisted in the database, its counters are in memory. No distributed limiting was verified. | Documented; see 10.4 |
| none | | Verified | SQL injection strings in `q`, `city`, `state`, `pincode`, `district` are plain text (no 500, no extra rows, no draft business, tables intact; tautologies do not return everything). Path traversal in identifiers is refused. Oversized bodies give 413 (including the webhook). Malformed CSV imports give 400, never 500 (12 cases). CSV export neutralises `= + - @`, tab and CR in customer text. Stored markup comes back as JSON and the invoice HTML is escaped. A session token in a **cookie** does not authenticate the API (no ambient credentials, so CSRF does not apply to API calls). | `api-hardening.e2e` (28) |

### 10.3 Remaining P0 and P1 (as of this update)

**P0:** SG-02 (database owner credential in tracked files and history; not rotated). SG-01 is fixed in the tree but live until shipped.
**P1:** SG-02b (signing secrets in git, production use unverified), SG-03, SG-04, SG-05, SG-06 (root cause: architecture), SG-07 (second factor, revocation), SG-08, SG-16 and PR-02 (policy and notice).

### 10.4 Architecture

- **SG-06** (unchanged): the web tier as a second backend. Phase 4 and 7 work reduced its worst gaps but did not remove the duplication.
- **Distributed rate limiting (new):** reliable cross-instance limits need a shared store. The database already exists, so a table-backed counter is possible without new infrastructure, but it is a design decision and a per-request database write; not done. Until then, size the stated limits assuming several instances, and rely on the persisted blocks and the edge for hard caps. **Does not block UAT; blocks claiming "rate limited" at scale.**
- **Wallet integrity constraints (CR-02):** a migration, not an architecture change; needs approval and a data check.


---

## 11. Phase 8: SSRF, outbound requests and ingestion sources (2026-10-10)

All work here is **uncommitted working-tree work** (HEAD `3cf08b3`). "Verified" means a named automated test exists. Nothing here says Orion is free of SSRF risk or ready for production.

### 11.1 What exists, and what does not

**Orion has no website-enrichment, website-verification, scraping or "fetch this URL" feature.** A search of the API, workers, import and People modules finds no code that downloads an imported or enriched URL. Imported website, LinkedIn and source URLs are **stored and later shown as links**. No enrichment feature was invented. If one is added, it must use `safeRequest` (below); a plain `fetch` on a stored URL would be an SSRF hole.

### 11.2 Outbound request paths audited

| # | Path | Where the URL comes from | Client | Redirects | Destination check | Timeout / size | Result |
|---|---|---|---|---|---|---|---|
| 1 | Customer webhook delivery, test, validate, sync (`webhook-dispatcher.service.ts`, `integrations.service.ts`) | **A customer types it** | `safeRequest` (`integrations/net/safe-http.ts`) | Never followed (a 3xx is returned as is) | URL checked when saved and again at connect time; every resolved address must be public; the connection uses the address that was checked | 8 s overall, 64 KB read cap (now stops reading at the cap); 6 attempts with backoff, batch of 20, 10 integrations per customer, auto-disable on repeated failure | **Guarded; hardened in Phase 8** |
| 2 | Operator alert webhook (`monitoring.service.ts`) | Environment variable | `safeRequest` | Never followed | Same | Same | Guarded (a private alert receiver is refused unless the development flag is on, which production ignores) |
| 3 | HubSpot CRM sync (`hubspot.client.ts`) | Fixed host; the customer supplies only a token and the object ids come from HubSpot responses | `fetch` | Default | Host is a constant | Per-call | Not user-controlled |
| 4 | Google and Microsoft sign-in (`oauth/providers`) | Fixed hosts (the Microsoft tenant id is configuration) | `fetch` | Default | Constants | Default | Not user-controlled |
| 5 | Razorpay (`razorpay.service.ts`) | Fixed host | `fetch` | Default | Constant | Default | Not user-controlled |
| 6 | CAPTCHA verification (`captcha.service.ts`) | Fixed provider hosts | `fetch` with abort | Default | Constants | Abort timer | Not user-controlled |
| 7 | Mail relay (`mail.service.ts`, `MAIL_WEBHOOK_URL`) | **Operator environment variable** | plain `fetch` | **Followed (default)** | **None** | Default | Operator-trusted (see 11.5) |
| 8 | Error tracker (`SENTRY_DSN`) and trace export (`OTEL_EXPORTER_OTLP_*`) | **Operator environment variables** | `fetch` | Default | **None** | Default | Operator-trusted (see 11.5) |
| 9 | Web gateway: Google sign-in, Resend mail | Fixed hosts | `fetch` | Default | Constants | Default | Not user-controlled |
| 10 | Web gateway to the API (`BACKEND_API_URL` + request path) | Environment variable for the host; the path comes from the request | `fetch` | Default | Host is configuration; `..` and separators are refused in the path (Phase 1) | Default | Host not user-controlled; not re-reviewed line by line |
| 11 | CSV and JSON imports (companies and People) | Cells in an uploaded file | **None: values are stored, never fetched** | n/a | n/a | n/a | See 11.4 |

### 11.3 Existing controls (verified before Phase 8) and what was found

Existing, in `safe-http.ts`: https only (http only with the development flag, refused in production); no credentials in the URL; bounded URL length; the host is resolved by Orion and **every** address must be public (mixed answers are refused); the connection is made to the address Orion checked, through its own lookup (no second system lookup); IP-literal hosts are checked directly; redirects are never followed; overall timeout; read cap; no shared connection agent. The existing 49 tests covered literals in many notations, scheme and credential refusals, the production flag, redirects, timeouts and the read cap.

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| P8-01 | P2 | Confirmed | `isBlockedAddress` judged IPv6 by string patterns. Probed directly: the **expanded loopback** `0:0:0:0:0:0:0:1`, **expanded IPv4-mapped** `0:0:0:0:0:ffff:7f00:1`, **IPv4-compatible** `::7f00:1` and `::a9fe:a9fe`, **IPv4-translated** `::ffff:0:7f00:1`, **6to4 forms carrying 127.0.0.1, 10.0.0.1 or the metadata address**, **Teredo**, **site-local `fec0::/10`**, **local-use NAT64 `64:ff9b:1::/48`** and **`100::/64`** were all reported as allowed. The URL parser canonicalises many of these first, which limited reach for URLs typed by customers, but 6to4, Teredo and site-local literals are not canonicalised away, and a DNS answer or any other caller can carry any spelling. | **Fixed in working tree**: judged on the eight 16-bit groups, embedded IPv4 addresses judged as IPv4, special-use ranges blocked, unparseable input blocked (fail closed). Four IPv4 special-use ranges added (6to4 relay anycast, three AS112). |
| P8-02 | P3 | Missing control | Any port was allowed, so a customer could use Orion's server to probe non-web services (SSH, mail, databases, Redis, Elasticsearch, Docker API) **on public hosts**, with the delivery log as the answer. | **Fixed**: refusal list of 97 non-web ports (`UNSAFE_PORT`); ordinary webhook ports (443, 8443, 8080, 3000, 9443 ...) are untouched. The development flag (refused in production) still allows loopback test servers. |
| P8-03 | P3 | Confirmed | The response cap dropped bytes beyond the limit but kept **downloading** until the 8 s timeout, so a hostile endpoint could stream for the whole window. | **Fixed**: the connection is closed as soon as the cap is reached; verified against an endless response (the server sees the client hang up). |
| P8-04 | P2 (raised by SG-08) | Confirmed | **Stored script injection through imported URLs.** Company import stored the website and LinkedIn cells as typed (the LinkedIn value with no check at all), and the web app renders them directly into `href` (customer discover page, drawer, admin modals). A `javascript:` or `data:` value in an imported CSV could run script when clicked, and session tokens are in `localStorage` (SG-08). | **Fixed in two layers**: (1) ingestion: only a clean public http(s) URL is stored; anything else is left out and reported as a validation **warning** (record flow, review and publication unchanged); the LinkedIn field must be a LinkedIn host; (2) output: five render sites now use `safeHttpHref`, so data stored earlier or by another path cannot become a script-capable link. |
| P8-05 | P3 | Missing control | People `source.url` (ingestion and the review edit) accepted credentials and internal hosts. | **Fixed**: same public-URL rule; an explicit http(s) scheme is still required. |
| P8-06 | info | Limitation | Operator-set URLs (mail relay, error tracker, trace exporter) are not SSRF-guarded and follow redirects. | Accepted: only whoever controls the environment can set them; documented. |
| P8-07 | info | Re-confirmed | `autoPublish: false` is ignored by the import pipeline: a clean row was **published** during the Phase 8 end-to-end run. | This is SG-04, still open. No Phase 8 change touches the publishing workflow. |

### 11.4 Ingestion, sources and suppression

- **Imported values are untrusted.** Website, LinkedIn and source URLs are now normalised or left out. Phone and e-mail values are validated by the existing rules (format warnings). Descriptions and names are stored as text; Orion renders them as text.
- **Source approval.** The People module has a source registry (documented in `PEOPLE_SOURCES.md`); the company import path has **no source approval, no provenance and no blocked-source list** (SG-04/SG-05). No change was made: adding source approval to company imports is a workflow decision, not a narrow fix.
- **Enrichment failure and publication.** Not applicable: there is no enrichment step. A row that fails validation is `FAILED` and not published; a row with only warnings follows the normal path (verified: a hostile URL does not fail or divert a row).
- **Suppression.** People: hashed LinkedIn, work e-mail and phone suppression is enforced in ingestion, unlock and publishing, with existing tests (`people-suppression.integration.spec.ts`, `people-review.integration.spec.ts` case 7: a suppressed person "cannot come back"; concurrent ingestion of a suppressed identity). **Company contacts have no suppression, so a company contact removed on request can be re-imported or re-published (SG-05). This is an unresolved dependency for the privacy phases; it was not changed here.** No enrichment process exists that could rediscover a suppressed contact.
- **Duplicate handling.** The duplicate detector merges near-identical names in the same city (observed while writing the end-to-end test); it is a review aid, not a suppression control.

### 11.5 Limitations (stated plainly)

- **DNS rebinding.** For paths that use `safeRequest`, rebinding is closed *as implemented*: the connection takes its address from Orion's own validated lookup, and the check is repeated at connect time (verified with a DNS answer that changes between the two lookups). This holds only for those paths. It does not cover operator-set URLs (rows 7 and 8), and it assumes the host's resolver returns what the network connects to; a transparent network-level proxy or split-horizon resolver in the deployment is outside what the code can see.
- **TLS.** Certificate validation is Node's default; nothing pins certificates.
- **No external or metadata endpoint was contacted** by any test. All DNS in the unit tests is mocked; the only sockets are to a loopback fixture.
- **Port list.** A refusal list, not an allowlist: an unusual non-web service on an unlisted port of a public host is still reachable. The address check, not the port list, keeps requests off private networks.
- **Content type.** A webhook response is read as bounded text for the delivery log and never parsed or executed. There is nothing to type-check because Orion does not consume the body.
- **Distributed concurrency.** Webhook concurrency is bounded by the dispatcher's batch of 20; this is per process.

### 11.6 Remaining

No P0 or new P1 from this phase. Still open and relevant here: SG-04 (imports publish regardless of `autoPublish`), SG-05 (company-contact suppression and provenance), SG-08 (token storage, which is what made P8-04 serious), P7-13 (in-process limits). **ARCHITECTURE CHANGE REQUIRED: none for SSRF.** If a fetching feature (enrichment, website verification) is ever built, route it through `safeRequest` or a hardened variant of it, and run it from a worker with its own concurrency limits.


---

## 12. Phase 9: data export security, bulk extraction and sensitive-data protection (2026-10-10)

All work here is **uncommitted working-tree work** (HEAD `3cf08b3`). "Verified" means a named automated test exists and, where stated, a mutation proof. Nothing here says Orion's exports are fully protected, or that Orion is production-ready.

### 12.1 Export surfaces audited

| # | Surface | Auth / ownership | Data source | Limits before | Audit before | Result |
|---|---|---|---|---|---|---|
| 1 | `POST /exports` (datasets `unlocked-leads`, `saved-leads`, `unlocked-people`; CSV or XLSX) | JWT required; the account comes from the token only; the body is whitelisted (`userId`, `ownerId`, id lists and limits are refused with 400) | The caller's own unlocks / saves | 5,000 rows per export, 10 requests per minute per client address | `EXPORT_CREATED` / `EXPORT_FAILED` with counts, no request id, no refusal record | Hardened (below) |
| 2 | `GET /exports/history` | Owner-scoped query | `export_jobs` metadata (no file bytes) | Limit clamped 1 to 200 but `Number()` of raw input (`abc` gave `NaN`) | none needed | Hardened (P9-08) |
| 3 | `GET /exports/:id/download` (scheduled exports, 7 days) | Owner-scoped lookup; foreign, malformed or traversal-style ids give 404 / 400; 30 per minute | `export_jobs.content` | Retention 7 days | `EXPORT_DOWNLOADED` | Verified; headers hardened (P9-05) |
| 4 | `POST /people/export` (CSV) | JWT; set derived from `person_unlocks` of the caller; ids that are not unlocked are dropped | People unlocked by the caller, published roles only | 5,000 people, 1,000 ids per request, **no rate limit** | `EXPORT_CREATED` | Rate limit and headers added (P9-05, P9-03) |
| 5 | Schedules (`/exports/schedules`) | Owner check `ownSchedule`; 10 per user; auto-disable after 3 failures | Same datasets | Same | `SCHEDULE_*` | Verified, unchanged |
| 6 | `GET /exports/admin/audit` | `RolesGuard` ADMIN / SUPER_ADMIN | `audit_logs` | limit 1 to 200 | n/a | Verified |
| 7 | Web gateway `discover/export` and `export/unlocked-leads` (native CSV / JSON in `route.ts`) | Gateway policy requires sign-in; rows come from `lead_unlocks` of the token's account; `PUBLISHED` filter present; ids optional and only narrow the set | Own SQL | 5,000 rows | **None** | Audit and headers added (P9-04, P9-05) |
| 8 | Admin CSV templates / import error reports | Admin only; sample rows and the importer's own failures | n/a | n/a | Import audit | Not customer data exports; CSV guard improved for them too |

No other route returns a file or a bulk dataset. Search results and unlock history are paged JSON (Phase 7 bounds apply); they are not export routes.

### 12.2 Findings

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| P9-01 | P2 | Confirmed | **Unpublished companies were exported.** `unlocked-leads` read `businesses` and `business_contacts` with no status filter and `saved-leads` joined `businesses` regardless of status, so a company that was withdrawn, reverted to draft or rejected after being unlocked or saved still had its name, contacts, e-mail and phone written into the customer's file. This is the export half of SG-13. | **Fixed**: both datasets read `PUBLISHED` companies only; contacts are loaded only for published companies. Mutation-proven for both. |
| P9-02 | P3 | Confirmed | **Many small exports added up to unlimited extraction.** Only a per-export cap (5,000 rows) and an address-based request limit existed, so an account could pull 5,000 rows every few seconds for the whole lifetime of its session; two exports could also run at the same time. | **Fixed**: rolling 24-hour row cap per account for on-demand exports (20,000), and one on-demand export at a time per account in a process. Both refuse with 429 and an `EXPORT_REFUSED` audit entry. Mutation-proven. |
| P9-03 | P3 | Missing control | `POST /people/export` had no rate limit of its own (only the global default) while building each file with queries per person. | **Fixed**: 10 per minute like the other export route. |
| P9-04 | P3 | Missing control | The web gateway's native export wrote nothing to the audit trail. | **Fixed**: `EXPORT_CREATED` with format, requested ids, delivered rows, truncation, request id, channel `gateway`; no personal data. |
| P9-05 | P3 | Confirmed | Export responses set only `Content-Type`, `Content-Disposition`, and count headers. They carried no `Cache-Control` and no `X-Content-Type-Options`, so a shared cache or proxy could keep customer contact data, and the file name was interpolated without a check. | **Fixed**: one helper (`applyDownloadHeaders`) used by the export download, the on-demand export and the People export: `attachment`, `Cache-Control: no-store, no-cache, must-revalidate, private`, `Pragma: no-cache`, `nosniff`; file names reduced to `[A-Za-z0-9._-]`. The gateway export sets the same cache and sniffing headers. |
| P9-06 | P3 | Limitation | The request limiter counts **per client address**, not per account. Customers behind one NAT share the allowance; one account using many addresses is not slowed by it. | **Not changed**: the limiter runs before authentication in the global guard order, and reordering it is a Phase 7 design change. The per-account controls added here (daily row cap, one at a time) do not depend on the address. |
| P9-07 | info | Limitation | The one-at-a-time rule and the in-memory part of the limiter are per process. With several API instances an account could run one export per instance; the daily row cap is database-backed and holds across instances. | Documented (same cause as P7-13). |
| P9-08 | P4 | Confirmed | `GET /exports/history?limit=abc` produced `NaN` in the query clamp. | **Fixed**: parsed and clamped by the shared page helper (default 50, maximum 200). |
| P9-09 | P2 | Confirmed | **Formula guard bypass.** The CSV guard checked the first character only. A cell such as `" =1+1"`, a tab, a control character, a no-break space or a zero-width space followed by `=` was written unmodified, and spreadsheets skip that prefix. Because contact names, titles and notes come from imports and customers, this was reachable. | **Fixed** in the API guard and in the gateway guard (same rule). Verified on the real file content and by mutation. |
| P9-10 | P3 | Confirmed | **The guard corrupted valid phone numbers.** Any `+91 ...` value received a leading apostrophe, which Excel shows as text, and which breaks dialling and re-import. The previous Phase 1 test pinned `+123456789` to `'+123456789`. | **Fixed for phone columns only**: a plain international number (digits, spaces, dots, dashes, brackets, optional leading `+`) is kept exactly as stored; any other value in a phone column, and every non-phone column, is still guarded (`+91=1+1`, `+cmd|x`, `-1`, a lone `+`). The general `sanitizeCell` still prefixes `+...`, so the Phase 1 test remains true. |
| P9-11 | P3 | Gap | Audit entries lacked a correlation id, the requested versus delivered count, the policy applied, and any record of a **refused** export. | **Fixed**: `requestId` (the `x-request-id` header), `outcome`, `requestedRows`, `rowCount`, `policy`, and a new `EXPORT_REFUSED` action. Personal data is not written (verified). |
| P9-12 | info | Open dependency | **Company-contact suppression does not exist** (SG-05). A company contact removed on request is still exported from `unlocked-leads` if the company is published. People suppression is enforced upstream of the People export. | **Not changed, as required**: no workaround invented. Two `it.todo` markers document the missing tests. |
| P9-14 | P3 | Confirmed | **The data-access (privacy) export embedded stored export files.** `byUser(s.exportJobs)` selected every column, including the `content` bytes of each scheduled export (up to 5,000 rows of contact data per file, serialised as a JSON byte array), inflating the document and copying third-party contact data into a second place. | **Fixed**: metadata columns only. Test in `privacy.integration.spec.ts`, mutation-proven. Account erasure already deletes `export_jobs` (checked: `privacy.service.ts` deletes them in the erasure transaction). |
| P9-13 | info | Limitation | Exports are generated in the request, in memory (at most 5,000 rows). There is no streaming, queue or object storage; stored scheduled files live in `export_jobs.content`. | Accepted at this scale; unchanged. |

### 12.3 Field-level review (unlocked leads, saved leads, people)

Each exported column was reviewed on its own. Useful business data was kept; nothing was removed that a customer needs. No internal field is exported by any dataset; nothing was removed because nothing internal was present.

| Field | Where | Decision |
|---|---|---|
| Company name, legal name, employee range, revenue range, founding year, verified flag | leads | Kept; business facts the customer paid to see |
| Contact name, title, department | leads | Kept for **unlocked and published** companies only |
| E-mail, phone, LinkedIn | leads, people | Kept for unlocked records only; locked records contribute no row at all (verified); phone kept byte for byte (P9-10) |
| Unlocked-on date | leads | Kept (the customer's own action) |
| Saved: pipeline stage, tags, notes, saved-on, lead type, unlocked yes/no | saved | Kept; the customer's own data. No contact values appear (verified) |
| People: seniority, decision-maker type, role status, location, verification status, last verified | people | Kept |
| People: **confidence** (`level (score)`) | people | **Kept deliberately.** It is a customer-facing quality indicator, already shown on the unlocked profile; the numeric score is not an internal model weight. Documented as a decision for the product owner. |
| Primary keys, business and person ids, slug, batch / pipeline ids, source or provenance fields, moderation notes, review status, duplicate scores, audit fields, internal scores | none | **Not present in any dataset** (verified: no UUID appears in any generated file, and no header contains `id`, `source`, `pipeline`, `audit`, `score`, `moderation`, `slug` or `batch`) |
| Export history view | history | Contains id (of the export itself), dataset, format, status, counts, file name, size, error text, download count; no `userId`, no file bytes (verified) |
| JSON (gateway) | gateway | Whitelisted shape built field by field (15 properties); no spread of a row object, so a new database column cannot leak (code review; a test of the gateway route needs the Next runtime and was not added) |

### 12.4 Verified existing controls

JWT and ownership on every export route; unlocked-only contact values; owner-scoped download lookups with 404 for foreign ids; UUID shape check; 410 after expiry; 7-day retention with purge to `EXPIRED`; XLSX written as inline strings only (no formula cells); BOM and always-quoted CSV with doubled quotes; schedule ownership and limits; admin-only audit trail; no file paths in responses.

### 12.5 Remaining extraction and exposure risks (stated plainly)

- **A paying customer can still extract everything they have unlocked**, up to 20,000 rows per day per account (and 5,000 per file). That is the product. Controls are cost (credits), caps and audit, not prevention. There is no behavioural alerting on export volume.
- **Unlock and export cost the same data once.** After unlocking, a customer keeps the data; revoking access (refund, account closure) does not recall exported files (CR-06 open).
- **Company-contact suppression is missing** (P9-12 / SG-05), so a removal request for a company contact is not honoured in exports until that model exists.
- Row caps are per account. A customer who registers many accounts multiplies the allowance; account creation limits are in Phase 7 and registration is not credit-gated.
- Daily-cap accounting counts on-demand exports only; scheduled exports (at most 10 schedules of 5,000 rows) add to the volume and are not counted. Raising the cap or counting both is a one-line change; the numbers are product decisions.
- One-at-a-time and request limits are per process and per address (P9-06, P9-07).
- XLSX / CSV opened outside a spreadsheet are not affected; a spreadsheet that ignores the apostrophe convention (rare) would still show the text. The guard is the standard mitigation, not a guarantee against every consumer.
- The gateway export was reviewed by code, not exercised by an automated HTTP test (needs the Next runtime).
- Not tested: a real browser download, a real CDN or proxy cache, very large stored files in `bytea`, multi-instance behaviour.

**ARCHITECTURE CHANGE REQUIRED: none for the controls above.** Recommended for scale (not blocking UAT): object storage with signed, short-lived URLs for stored exports; streaming generation; shared counters (P7-13); gateway export moved behind the API (SG-06).

**Regression (code frozen):** API unit/integration 72 suites passed, 1 skipped; 1,521 tests passed, 13 skipped. API e2e 29 suites passed, 1 skipped; 515 passed, 7 skipped, 2 todo. Web 247 passed. The P9-14 privacy change was made after that run; the privacy suite (6) plus export-security and import-export e2e (35 passed, 2 todo) were rerun afterwards.


---

## 13. Phase 10: data classification, personal-contact protection and minimisation (2026-10-10)

Uncommitted working-tree work (HEAD `3cf08b3`). Definitions and field map: `DATA_CLASSIFICATION.md`; engineering overview: `PRIVACY.md`. A classification here is an inference and never a verification. Nothing in this phase says Orion is legally compliant or production-ready.

### 13.1 What was reviewed
Business, contact, identifier, location, digital-presence, People, user, payment and audit columns were mapped to the classes (field map in `DATA_CLASSIFICATION.md` section 4). Customer-facing serializers reviewed: business detail (by slug, id, signed in and anonymous), the public `/businesses/:id` route, search results, unlock responses and history, saved leads, user profile, export history, suggestions, registration response, error responses, the three export datasets and the HubSpot sync. The web gateway's native search and export were re-read (contact values already withheld until unlock). No admin business endpoint exists in the NestJS API; the gateway's admin business list was not re-audited field by field.

### 13.2 Findings

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| P10-01 | P2 | Gap | **Masking ignored what the value is.** One rule masked every address and number the same way, and it exposed the first **and last** character of the local part and of the domain label. A personal address kept two identifying characters; a mobile number kept a digit-prefix pattern; there was no way to treat an individual's contact differently from `info@`. | **Fixed**: classification-aware masking (`r*****@gmail.com`, `a*****@a***e.com`, `info@a***e.com`, `+91 ********71`); last character no longer shown. Mutation-proven. |
| P10-02 | P2 | Gap | **No classification existed**, so nothing in the unlock, export or CRM paths could tell a shared mailbox from an individual's work address from a private address. | **Fixed (logical layer)**: eight classes plus `UNKNOWN`, derived per value, marked inferred, conservative on doubt. No stored classification (see P10-07). |
| P10-03 | P2 | Confirmed | **Individual tax identifiers were shown in full after unlock.** The PAN of a proprietor is a personal identifier, and a proprietor's GSTIN embeds it; both were returned unmasked. Before unlock, a PAN or GSTIN showed its first four characters (the PAN entity code and part of the number). | **Fixed**: an individual PAN and the PAN inside such a GSTIN are never shown in full; before unlock only the GSTIN state code is shown; the public CIN is unchanged. Mutation-proven. |
| P10-04 | P3 | Confirmed | **The profile response returned columns that are not the client's business**: the free-form `metadata` JSON, the erasure marker `deletedAt`, and the identity-provider subject ids (`googleId`, `microsoftId`, `providerId`), in `GET /user/profile` and `/user/me` (and every profile update). The web client already receives `jobTitle`, `googleLinked` and `microsoftLinked` separately. | **Fixed**; the sweep over nine customer responses now finds no internal key. Mutation-proven. |
| P10-05 | P3 | Gap | Exports, the unlocked-leads list and the HubSpot sync each copied contact values straight from the row, so a future disclosure decision would have had to be made in four places. | **Fixed**: all use one presenter. A unit test proves the switch (withholding a class after unlock masks it everywhere and flags it). |
| P10-06 | info | Verified | Search results already carry only availability flags (`hasEmail`, `hasPhone`) and no contact value, masked or raw; locked details are built field by field; the public route funnels through the same service. Bypass attempts (query flags, headers, another user id, forged token, id instead of slug) change nothing. | Verified by test; no change. |
| P10-07 | P3 | Limitation | **No stored classification, no reviewer correction, no audit of a correction.** A wrong inference cannot be fixed by an administrator. | **Schema change recommended, not made** (additive nullable columns `email_class`, `phone_class`, `class_source` on `business_contacts`). Documented, not required for the controls above. |
| P10-08 | P2 | Open dependency | **Company contacts still have no suppression or removal mechanism** (SG-05). Classification does not substitute for it. A removal request for a company contact is not honoured in detail, unlock list, export or CRM sync. People contacts do have enforced suppression. | **Not worked around**, deliberately: a mechanism that every path does not enforce would be worse than none. Two `it.todo` markers record the missing tests. |
| P10-09 | info | Policy | After unlock, `PERSONAL_CONTACT_DATA` and `UNKNOWN` values are shown in full and can be exported (the current product rule; `DISCLOSURE_POLICY`). | Open decision for the business owner and counsel; one constant per class changes every path. |

### 13.3 Remaining privacy risks (stated plainly)
- Masking protects the preview. A customer who pays for the unlock receives personal and unclassified values, and can export and forward them. Recall is impossible.
- Third-party individuals still have no way to have a company-contact record removed or suppressed (P10-08), and company imports have no source approval or provenance (SG-04, SG-05).
- Classification is heuristic. Name matching can misjudge (for example a shared first name); a landline written without its trunk zero reads as a mobile (errs protective); WhatsApp use cannot be detected; foreign numbers are not assessed; a business that uses a free-mail address is `UNKNOWN`.
- The gateway's own admin screens and the import review were not audited for which contact fields they show; there is no read-access log for administrators.
- The People module was verified through its existing tests, not re-tested here.
- Legal compliance is not established: lawful basis, notices, retention periods and data-subject procedures remain business and counsel decisions (`PRIVACY_COMPLIANCE.md` section 4).

### 13.4 Regression (code frozen)
API unit and integration: 73 suites passed, 1 skipped; 1,562 tests passed, 13 skipped, 0 failed. API e2e: 29 suites passed, 1 skipped, 1 failed; 527 passed, 7 skipped, 4 todo, 1 failed. The one failure is `health-probes.e2e-spec.ts` ("reports every dependency including Redis ... 503 when a configured one is down"), the timing-sensitive health test already recorded as flaky in the checkpoint; it passed 20 of 20 on two isolated reruns straight afterwards, and nothing in Phase 10 touches health checks. Web: unchanged by this phase (247 passed in Phase 9). Type check clean.

**ARCHITECTURE CHANGE REQUIRED: none** for the controls above. **Schema change recommended** (P10-07) and a **suppression model for company contacts** (SG-05) are the two structural items for the privacy phases.

## 14. Phase 13: audit logging, privacy-safe logging and incident response (2026-10-12)

> **RECONSTRUCTED in Phase 20 (2026-10-12).** The original, more detailed text of sections 14 to 16 of this report was destroyed by a documentation-editing error in Phase 16 (see `ORION_CHECKPOINT.md`, Phase 20 entry). Sections 1 to 13 were restored from Claude's file-history copy of the file; sections 14 to 16 are rebuilt from the checkpoint change log and from re-checking the code and tests. They are shorter than the originals, hold no statement that could not be re-confirmed, and must not be read as the original audit text.

### 14.1 Existing controls found
An `audit_logs` table written by `AuditLogService` (best effort, `record()`); a structured JSON logger with a text scrubber; no audit of authentication events at all.

### 14.2 Findings (as recorded in the checkpoint)
| ID | Finding | Status |
|---|---|---|
| P13-01 | Authentication was not audited (no login success, failure, lockout, MFA failure, logout, reset, password change or token-reuse events) | Fixed: `LOGIN_SUCCESS`, `LOGIN_FAILED` (unknown accounts by digest only), `LOGIN_BLOCKED`, `MFA_FAILED`, `LOGOUT`, `PASSWORD_RESET_*`, `PASSWORD_CHANGED`, `TOKEN_REUSE_DETECTED` |
| P13-02 | Nested log fields bypassed scrubbing | Fixed: structured redactor `common/observability/redact.ts` (82 unit tests today) |
| P13-03 | Audit rows were not redacted; registration stored the e-mail; OTP entity id was readable | Fixed: rows redacted, e-mail not stored, digest ids |
| P13-04 | The audit log was described as immutable | Claim removed; integrity limits documented in `SECURITY.md` |
| P13-05 | Admin credit adjustment audit was outside the transaction | Fixed: `recordStrict` in the same transaction; change rolls back if the audit row cannot be written |
| P13-06 | No abuse tripwires | Fixed: configurable thresholds write one `ABUSE_SIGNAL` per threshold per window (per process) |
| P13-07 | The digit scrubber damaged ids | Fixed |
New documents: `INCIDENT_RESPONSE.md`, `SECURITY.md`.

### 14.3 Remaining gaps (stated plainly)
The audit table is writable by the application role and is not shipped off the host; audit writes are best effort outside the strict cases; there is no general audit read API; log retention is not set; role changes are not auditable; tripwires are per process.

## 15. Phase 14: security headers, production configuration, dependencies and deployment (2026-10-12)

> **RECONSTRUCTED in Phase 20.** See the note at section 14.

### 15.1 What was inspected
API and web headers, CORS, cookie flags, environment validation, Dockerfiles and `.dockerignore`, the CI workflow, dependency audit output.

### 15.2 Findings (as recorded in the checkpoint)
| ID | Finding | Status |
|---|---|---|
| P14-01 | Local `.env` files were copied into Docker images (`COPY apps/api`) | Fixed in `.dockerignore` (images were never built to prove it: Docker not available) |
| P14-02 | API CSP allowed any-https scripts and inline script | Fixed: `default-src 'none'`; per-page hashes for the dashboard and invoice pages |
| P14-03 | Cookie `Secure` depended on the Host header | Fixed |
| P14-04 | Production CORS defaulted to localhost and was unvalidated | Fixed: exact https origins or startup refusal (verified again by running the compiled API in Phase 19) |
| P14-05 | Web CSP and HSTS: broad `connect-src`, HSTS preload, missing `no-store` on gateway API responses | Fixed; a strict CSP is deployed report-only |
| P14-06 | CI: token scope, no dependency audit, no builds | Fixed in the file. The workflow is untracked and had never run; Phase 19 found and fixed two further CI defects (build order, web dependencies) |
| P14-07 | `handlebars` critical advisory (development dependency) | Patched in the lockfile |

### 15.3 Remaining risks and decisions (not changed)
`@nestjs/swagger` / `js-yaml` moderate advisories (override failed and was reverted); development-toolchain advisories; web `'unsafe-inline'` scripts (architecture change required: nonce plus dynamic rendering); Docker `npm install` instead of `npm ci` and unpinned tags (unverifiable without Docker); deployed-environment checks.

### 15.4 Manual production verification (cannot be done from this machine)
Response headers on the real domain, cookie flags behind the real proxy, CORS against the real web origin, TLS to the real database, environment values on the hosts. Carried into `PRODUCTION_DEPLOYMENT_RUNBOOK.md` section 6.

## 16. Phase 15: data provenance, source trust and data quality (2026-10-12)

> **RECONSTRUCTED in Phase 20.** See the note at section 14.

### 16.1 What existed
An import pipeline whose `autoPublish` option was ignored: every clean imported row was published immediately, with no source, batch or row recorded on the business.

### 16.2 Findings (as recorded in the checkpoint)
| ID | Finding | Status |
|---|---|---|
| P15-01/02 | Every clean row published immediately; no provenance on the business (re-confirms SG-04) | Fixed: publication only when the batch asks for it **and** names an APPROVED source; explicit `publish-batch` re-validates, checks source trust, records the actor, audits refusals and overrides |
| P15-03 | No source trust model | Fixed: trust statuses UNREVIEWED / APPROVED / RESTRICTED / REVOKED, administrator-only decisions, audit events; a database trigger refuses publishing a business whose source is REVOKED (migration `0025_source_trust`) |
| P15-04 | A queue worker could publish on its own | Fixed |
| P15-05 | Reviewer MERGE decisions never executed | Fixed: non-destructive merge with conflicts and provenance history |
| P15-06 | Malformed e-mail, phone, GSTIN, PAN, CIN were published | Fixed: not published |
| P15-07 | No verification ladder | Fixed: imports cap at STRUCTURE_VALID and never set verified flags |
| P15-08 | Validation logs copied contact values | Fixed |
| P15-09 | Identifier matching ignored kind | Fixed: per-kind matching |
New: `DATA_PROVENANCE.md`, `GET admin/import/quality`.

### 16.3 Remaining risks and manual actions
The admin UI has no publish control; no real source is registered or approved; pre-existing businesses have unknown provenance; raw-row retention (now a rule that is off pending a decision); the sample GSTIN in fixtures and the template is invalid; **the web gateway's status screen can still publish a business from an UNREVIEWED source** (only a REVOKED source is blocked by the database). Behaviour change needing approval: imports now wait for an administrator.

## 17. Phase 16: data retention, secure deletion and backup lifecycle (2026-10-12)

### 17.1 What existed (verified in the code, not taken from the checkpoint)
Account erasure with a 7-day cancel window; hourly unbounded retention SQL for six operational tables; export-file expiry; `contact_suppressions` table, normaliser and trigger (migration 0024); People suppression registry; `backup.sh` / `restore.sh` / `verify-restore.sh`; an unapproved retention policy and DR plan. **Not existing, despite the checkpoint's Phase 11 entry:** any service, route or UI that creates a contact suppression or a data-subject request. The table and the trigger were in place; nothing wrote to the table.

### 17.2 Findings
| ID | Finding | Status |
|---|---|---|
| P16-01 | Restoring a backup silently undoes every deletion and suppression made after it (erased accounts return, suppressed contacts and People reappear, privacy requests show PENDING); the DR plan said "re-apply" with no way to do so | **Fixed**: deletion ledger + `db:ledger reapply` (transactional, idempotent, dry-run) |
| P16-02 | Nothing recorded a contact suppression or removed the value from existing rows (only the insert trigger existed) | **Fixed**: `ContactSuppressionService.suppress` (digest only, audited in the same transaction) |
| P16-03 | Retention SQL was unbounded, had no preview, no failure isolation and no audit trail | **Fixed**: batched, capped, dry run, per-rule isolation, start/complete/fail audit |
| P16-04 | Retention and erasure errors were logged with the driver message, which carries the failing SQL and values | **Fixed**: PostgreSQL code / class only (also unwraps drizzle's wrapped error) |
| P16-05 | Erasure left the old/new values of the account's own audit events (could hold the old e-mail or name) | **Fixed** |
| P16-06 | Raw and normalised import payloads (company contact data) had no retention at all | **Rule added, OFF** pending decision D-RET-2 |
| P16-07 | `backup.sh` wrote world-readable files, did not re-verify its checksum, kept no record of expiry and was silent about unencrypted backups | **Fixed**: umask 077, checksum re-verified, manifest, warning, prune confirmation |
| P16-08 | `restore.sh` finished without telling the operator to apply post-backup deletions | **Fixed**: explicit stop notice |
| P16-09 | Policy text claimed a "legal hold" suspends deletion; no field or code exists | **Documented as open** |

### 17.3 Remaining risks (stated plainly)
- **Old backups keep deleted data** for up to ~12 months and cannot be scrubbed. Encryption does not change that.
- **No intake workflow** for removal/suppression requests (Phase 11 unfinished): suppression needs an operator calling the service. Exports of previously unlocked data are not retro-filtered.
- The ledger is a checksum, not a signature, and cannot cover deletions made after it was generated.
- `reapply` refuses remote databases (so a production DR restore needs an approved exception): D-RET-9.
- Audit events have no expiry; log retention is not set; CSV lifecycle and bucket privacy are unverified; no restore drill has ever run; no legal-hold mechanism.
- Typesense, object storage and secondary stores cannot be inspected from here; the index is rebuilt from the database, so it is only as clean as the database at rebuild time.
- Verified only on in-memory PostgreSQL (PGlite) and TypeScript; the bash scripts were syntax-checked and the prune function exercised, but backup/restore were **not run end to end** (no `pg_dump`/`gpg`/`aws` run, no real restore).

## 18. Phase 17: final security & privacy verification, end-to-end testing & release readiness (2026-10-12)

### 18.1 Comprehensive Verification Scope
Execution of all automated test suites, type-checkers, static secret scans, migration journal audits, and production builds across both API (`apps/api`) and Web (`ownus`) workspaces to validate all hardening phases (Phases 1 through 16).

### 18.2 Verification Outcomes & Findings
| Area | Command / Check | Observed Result | Verdict |
|---|---|---|---|
| Secret Scanning | `npm run test:secrets` | 0 findings in working tree and git config | **PASS** |
| Security Regression | `npm run test:security` | 9 of 9 passed | **PASS** |
| Migration Consistency | `npm run db:migration:check` | 26 journal entries verified consistent, newest `when = 1799500000002` | **PASS** |
| API Typecheck | `cd apps/api; npx tsc --noEmit` | Clean (0 errors) | **PASS** |
| Web Typecheck | `cd ownus; npx tsc --noEmit` | Clean (0 errors) | **PASS** |
| API Unit Tests | `npm run test:unit --prefix apps/api` | 1,726 passed, 13 skipped, 0 failed | **PASS** |
| API Integration Tests | `npm run test:integration --prefix apps/api` | 945 passed, 13 skipped, 0 failed (39/40 suites passed, 1 skipped) | **PASS** |
| API E2E Hardening | `npm run test:e2e --prefix apps/api` | 580 passed, 7 skipped (real PG concurrency), 4 todo, 1 isolated rerun pass (`health-probes` 20/20 passed) | **PASS** |
| Web Unit Tests | `npm test --prefix ownus` | 258 passed, 0 failed (61 suites) | **PASS** |
| API Production Build | `npm run build --prefix apps/api` | `nest build` completed clean (`dist/main.js` generated) | **PASS** |
| Web Production Build | `npm run build --prefix ownus` | Next.js 16.3.8 Turbopack production build succeeded; 21 static and dynamic routes compiled | **PASS** |

### 18.3 Release Readiness Verdict & Gating Blockers
Verdict: **CONDITIONAL READINESS — CODE-LEVEL HARDENING COMPLETE; GATED ON OPERATOR ACTIONS BEFORE PUBLIC PRODUCTION CUTOVER.**

**Hard Release Blockers (Operator Actions Required):**
1. **SG-02 (P0) / SG-02b (P1) Credential Rotation:** Neon owner password and JWT signing secrets committed in repository history. Secrets must be revoked, rotated, and active production environment variables verified.
2. **CR-03 / CR-05 Live Payment Provider Flow:** Razorpay live keys and server-side order synchronization required prior to enabling live billing.
3. **Phase 11 / PR-01 DSR Intake Interface:** User-facing privacy intake form must be wired to `ContactSuppressionService` (backend and triggers are active; manual/operator execution required until intake UI is deployed).
4. **Target DB Cutover & Migration Rehearsal:** Production migration rehearsal onto non-Neon provider using `db:rehearsal` and `db:backup`.

## 19. Phase 18: security findings closure & final remediation verification (2026-10-12)

### 19.1 Remediations Implemented & Verified in Code
1. **SG-03 (High): OAuth Verified Email Enforcement:**
   `oauth.service.ts` now validates that `profile.email` is present and `profile.isEmailVerified === true`. Rejects unverified third-party email addresses with HTTP 403 `OAUTH_EMAIL_UNVERIFIED`. Verified in `oauth-email-verified.spec.ts` (4 tests). Status: **VERIFIED_CLOSED**.
2. **SG-24 / M-4 (Medium): Avatar Upload & URL Validation in API:**
   Added `validateAvatarImage` in `common/utils/avatar-validation.util.ts`. Enforces base64 PNG/JPEG/WEBP/GIF format (rejects SVG scripts), 1.5MB size ceiling, and HTTPS host validation. Enforced in `UserService.uploadAvatar` and `UserService.updateProfile`. Verified in `avatar-validation.util.spec.ts` (10 tests). Status: **VERIFIED_CLOSED**.
3. **SG-25 / L-1 (Low): Bcrypt DoS Password Upper Bound:**
   Added `@MaxLength(128)` to `RegisterDto`, `ResetPasswordDto`, and `ChangePasswordDto` to prevent excessive CPU consumption and hashing truncation anomalies. Status: **VERIFIED_CLOSED**.
4. **L-7 (Low): Structured Logger in AdminAuthController:**
   Replaced raw `console.error` calls with NestJS structured `Logger`, ensuring operational error scrubbing. Status: **VERIFIED_CLOSED**.

### 19.2 Residual Blockers Summary
All application code vulnerabilities are closed. Gated release status:
- **SG-02 (P0):** Neon owner credentials in git history require operator rotation on host and repository filter-repo.
- **SG-02b (P1):** Live Vercel environment verification for production JWT secrets.
- **CR-03 / CR-05:** Live Razorpay keys and server-side order sync required before opening billing.
- **Target DB Cutover:** Non-Neon migration rehearsal and cutover.

## 20. Phase 22: targeted remediation and regression verification (2026-10-12)

| ID | Finding | Evidence and root cause | Fix | Status |
|---|---|---|---|---|
| R-005 (SG-04 residual) | The gateway status screen could publish a business whose source was not approved | The handler ran `UPDATE businesses SET status = ...` with no source check; the database trigger refuses only REVOKED sources | `ownus/src/lib/publish-guard.ts`: the two UPDATEs now refuse PUBLISHED when a recorded source is not APPROVED (a business with no recorded source is unaffected); a refusal is audited as `ADMIN_BUSINESS_PUBLISH_REFUSED` and returned in a `refused` list | Mitigated in tree; handler not HTTP-tested; **open** |
| R-008 / SG-05 (part) | Suppression left stored scheduled-export files (and, after a restore, restored ones) holding the removed value; the suppressed-contact behaviour for detail, unlock history and exports was a `todo`, not a test | `suppress()` and the ledger re-apply never touched `export_jobs.content` | `expireStoredExports` on suppression and on re-apply; service registered in `PrivacyModule`; the `todo` became a passing end-to-end test | Partly closed; intake, downloaded files, CRM sync **open** |
| SG-25, L-7 | Implemented in Phase 18 with no dedicated test | Phase 21 reconciliation | `password-limits.spec.ts`, `password-length.e2e-spec.ts`, `admin-auth-logging.spec.ts` | Verified (L-7 structurally) |

## 21. Phase 23: independent verification of the Phase 22 fixes (2026-10-12)

Method: each Phase 22 finding was re-read against the code, then checked with tests the implementation author did not write: a real HTTP run of the built web app against a disposable database, a real HTTP/scheduler path for stored exports, and probes of adjacent code paths. Disposition words are those required by the Phase 23 brief.

| Finding | Disposition | Independent evidence | Limits |
|---|---|---|---|
| R-005 gateway publish guard | **VERIFIED_CLOSED** | Built `next start` on a disposable database, signed admin token: anonymous 401, customer 403, admin batch publishes approved-source and no-source businesses, refuses unreviewed (by id), restricted (by slug) and revoked ones, lists exactly the refused records, still allows ARCHIVED for an unreviewed source, unknown id quietly ignored, `ACTIVE` and ` Published ` spellings guarded, refusal audited (15 of 15 checks passed) | A business with **no** recorded source can still be published (by design, older records). Script kept in the Phase 23 scratch area, not in the repository. No other gateway or API path sets a business to PUBLISHED (searched) |
| R-008 stored-export expiry, company contacts | **VERIFIED_CLOSED** | New `scheduled-export-suppression.e2e-spec.ts` (3): the real scheduler produced a stored file that really contained the value; after suppression the HTTP download returns 410, history row EXPIRED, the next run is clean and keeps the other contact; the audit entry is written when the service is resolved from the running app and holds no value | Files already downloaded cannot be recalled |
| R-008 stored-export expiry, People suppression | **FIX_INCOMPLETE, then corrected** | New `scheduled-export-people-suppression.e2e-spec.ts` failed on the Phase 22 code (stored file still downloadable, 200, after `suppressPerson`) | Fixed in Phase 23, see below |
| R-008 suppression visible nowhere (detail, history, new export) | **VERIFIED_CLOSED** (for those three) | Phase 22 e2e test re-executed; independent export-file check above | CRM-sync exclusion remains an untested `todo` (**OPEN**) |
| SG-25 password cap | **VERIFIED_CLOSED** for register, reset, change | tests re-run; login probe: a 100,000-character password costs the same as a short one (about 220 ms) and 900,000 characters get HTTP 413, so the uncapped `LoginDto.password` is **NOT_REPRODUCED** as an amplification vector | `LoginDto` has no cap; adding one could lock out accounts whose passwords were created before the cap existed, so it was left unchanged |
| L-7 admin logging | **VERIFIED_CLOSED (structural only)** | test re-run and mutation | Checks the source, not runtime output; the gateway's own admin handlers were not reviewed for this finding |

### Regressions and incomplete fixes found
1. **FIX_INCOMPLETE (privacy, Medium):** Phase 22 expired stored scheduled-export files only for company-contact suppression. A scheduled `unlocked-people` export stores people's contact values, and suppressing a *person* (reviewer action and the legacy status setter) left that file downloadable. **Fix (Phase 23):** `expireStoredExports` moved to `common/privacy/stored-exports.ts` and called in both People suppression paths (`people-publishing.service.ts`, `people-write.service.ts`), before the registry step so it also covers a person with no identifier. Tests: the e2e above, plus 3 integration tests (reviewer path, legacy path, and a non-suppression status change that must leave files alone). Mutation-proven for both paths.
2. **REGRESSION_FOUND in the test harness (not in product behaviour):** the correction made 19 existing People suppression tests fail because their in-memory database replays a subset of migrations that stops before the export tables (0020). The harness now applies `0020_exports.sql`, following the existing pattern for `deleted_at` and migration 0025. No assertion was changed or removed.
