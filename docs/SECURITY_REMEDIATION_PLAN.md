# Orion security and privacy remediation plan (Phase 2, planning only)

**Date:** 2026-10-10 · **Status:** plan only. No application code, schema, migration, configuration, dependency or infrastructure was changed in this phase. · **Inputs:** `docs/ORION_CHECKPOINT.md`, `docs/SECURITY_GAP_REPORT.md` (Phase 1, 2026-10-10), `SECURITY_AUDIT_REPORT.md`, `PRIVACY_AUDIT_REPORT.md`, `SECURITY_REMEDIATION_SG02.md`. Critical findings were re-checked against current source on 2026-10-10 (evidence cited per finding).

This plan does not say Orion is secure or production-ready. It is based on static review and read-only commands; nothing was tested against a deployed environment, and no fix has been applied.

**Finding types:** CV confirmed vulnerability · LV likely vulnerability, needs verification · MC missing control · DG documentation gap · ED environment-dependent limitation · FP false positive or already resolved.

## 1. Executive summary

**Overall risk assessment: HIGH. Not suitable for a paid launch or for any internet-reachable deployment with real data until P0 and P1 items are resolved.**

Verified evidence:
- **Two P0 items.** (1) SG-01: the Google and Microsoft OAuth providers accept `sim_google_<email>` / `sim_ms_<email>` codes in every environment and the callback links to an existing account by e-mail (`google.provider.ts:77`, `microsoft.provider.ts:77`, `oauth.service.ts:147-160`; no `NODE_ENV` check in `modules/oauth`). (2) SG-02: a remote database owner credential is in seven tracked files at HEAD, and rotation is unverified.
- **Eight P1 items,** mostly account takeover paths (SG-03, SG-07, SG-08), unreviewed publication of personal data (SG-04, SG-05), the gateway as a second backend (SG-06), and a privacy policy that makes claims the code does not support (SG-16, PR-02).
- **Strong existing foundations:** default-deny guards, persisted-role checks, atomic credits and payments, an SSRF-safe client, People-module suppression, scrubbed logs. No IDOR, SQL injection, SSRF or race condition was found in the API. Credits, billing and SSRF therefore have no confirmed vulnerabilities; their plan entries are "preserve and test".
- **New evidence this phase:** registration marks the account e-mail verified unless `REQUIRE_EMAIL_VERIFICATION` is set (`auth.service.ts:93`), so SG-03 pre-hijacking is easier than Phase 1 stated. Gateway logins write `activeSessionId` (`route.ts:321,1364`), so the Phase 1 concern that gateway tokens skip the single-device check is reduced (still unverified end to end).

### Finding counts (31)

| Severity | Count | IDs |
|---|---|---|
| P0 | 2 | SG-01, SG-02 |
| P1 | 8 | SG-03, SG-04, SG-05, SG-06, SG-07, SG-08, SG-16, PR-02 |
| P2 | 10 | SG-09, SG-10, SG-11, SG-12, SG-13, SG-14, SG-15, SG-17, PR-06, PR-07 |
| P3 | 11 | SG-18 to SG-25, PR-09, PR-10, PR-11 |

Changes from Phase 1 severities: SG-16 raised to P1 (published statements to users about security controls that do not exist; paid launch makes this a contractual and regulatory exposure); SG-09 moved to P2 (Typesense is not the default provider; becomes P1 if enabled); PR-02 listed on its own at P1. PR-01, PR-03, PR-04, PR-05 and PR-08 are the privacy views of SG-05, SG-16, SG-05, SG-13 and SG-15 and are not counted twice.

## 2. Prioritized findings

### P0

#### SG-01 · P0 · CV · Simulated OAuth login active in every environment
- **Component:** OAuth module.
- **Evidence:** `modules/oauth/providers/google.provider.ts:77-84` and `microsoft.provider.ts:77-87` return a simulated token when the code starts with the simulation prefix or the provider is unconfigured; the e-mail after the prefix becomes the profile with `isEmailVerified: true`; `oauth.service.ts:147-160` links to an existing user by e-mail and issues tokens; callbacks are `@Public()`. Read-only provider run with `NODE_ENV=production` returned the attacker-chosen e-mail. E2E tests use mock providers, so the real branch is untested.
- **Current behavior:** unauthenticated caller obtains a signed state from the public redirect, calls the callback with `sim_google_<victim>`, receives a session.
- **Impact:** takeover of any customer or admin account; wallet, unlocked leads, exports and admin functions exposed.
- **Exploitability / prerequisites:** none beyond knowing a target e-mail. Full HTTP chain not executed against a live server (it would modify accounts); each step was read.
- **Remediation:** allow simulation only when `NODE_ENV === 'test'` and the database is local (reuse the `fixedOtpAllowed()` rule); refuse unconfigured providers; delete the shared default simulated account and the log line of the code.
- **Tests:** unit: real provider classes reject `sim_*` and unconfigured flows unless `NODE_ENV=test`; e2e: callback with a `sim_` code creates no session; mocks stay for other suites.
- **Dependencies:** none. Do first.
- **Acceptance:** `grep sim_` in non-test, non-mock source returns only the guarded branch; both tests pass; the existing OAuth e2e suite still passes.
- **UAT / launch:** blocks UAT on any reachable environment and blocks launch.

#### SG-02 · P0 · CV · Credentials committed to git
- **Component:** repository, remote database.
- **Evidence:** `git grep` of HEAD finds a password-bearing URL for a remote managed PostgreSQL host (owner role) in `ownus/scratch_inspect_tables.js`, `scratch_master_e2e_verification.js`, `scratch_test_app_preferences_persistence.js`, `scratch_test_db.js`, `scratch_test_notifications_integration.js`, `scratch_test_profile_persistence.js`, `scratch_test_single_device_login.js`. Eight other matches are local or placeholder URLs. `.env.production.example:98` holds a `rzp_live_` key id to confirm as placeholder (UNVERIFIED). The `origin` token was already removed.
- **Current behavior:** history and HEAD expose the credential; rotation, repository visibility and Vercel use of the committed JWT secrets are UNVERIFIED (`ORION_CHECKPOINT.md` section 7).
- **Impact:** owner-level access to the remote database for anyone who can read the repository or a clone.
- **Exploitability:** immediate if the credential is still valid and the repository is public or leaked.
- **Remediation:** owner actions first (rotate the database owner credential, rotate JWT secrets if Vercel uses them, revoke the old hosting token, review provider logs since 2026-09-21, enable secret scanning and push protection); then remove the seven files in a normal commit; history rewrite only with explicit approval. Follow `SECURITY_REMEDIATION_SG02.md`.
- **Tests:** `npm run test:secrets` (0 findings) and `test:secrets:history` after any rewrite; add the history scan to CI (SG-14).
- **Dependencies:** none; independent of code. Rotation must precede any history purge.
- **Acceptance:** old credential verified rejected by the provider; `git grep` of HEAD returns no credential; scanner clean.
- **UAT / launch:** blocks launch; blocks UAT if the old credential still works.

### P1

#### SG-03 · P1 · CV · OAuth links by e-mail without a verified-e-mail check; pre-hijacking
- **Component:** OAuth, registration.
- **Evidence:** `oauth.service.ts:147-160` ignores `profile.isEmailVerified`; Microsoft uses `mail || userPrincipalName` on tenant `common` (`microsoft.provider.ts:156`); `auth.service.ts:93` sets `isEmailVerified: !emailVerificationRequired()`, and `REQUIRE_EMAIL_VERIFICATION` is off by default and `false` in `.env.production.example`.
- **Current behavior:** an attacker registers the victim's address (auto-marked verified), the victim later signs in with Google, the accounts merge, and the attacker's password still works.
- **Impact:** persistent account takeover without SG-01.
- **Exploitability:** needs only the victim's address and the victim later using social login.
- **Remediation:** link only when the provider asserts a verified e-mail and the local account is genuinely verified; otherwise require the signed-in link flow; on a link, invalidate existing password and sessions or require re-verification; fixed Microsoft tenant or verified claim.
- **Tests:** unverified provider profile does not link; password-registered unverified account does not link; linking invalidates the pre-set password.
- **Dependencies:** SG-01 first; coordinate with SG-11 (e-mail verification).
- **Acceptance:** all three tests pass; existing OAuth e2e passes.
- **UAT / launch:** blocks launch. UAT only if OAuth is enabled for testers.

#### SG-04 · P1 · CV · Company imports publish with no moderation, source approval or provenance
- **Component:** import and publishing.
- **Evidence:** `autoPublish` defaults to true (`admin-import.controller.ts:85,117`, `admin-import.service.ts:427`) and is not read by `import-pipeline.service.ts` or `publishing.service.ts`; valid rows go to `PUBLISHED`. Batches have no approved source; contacts carry no source or collection date.
- **Current behavior:** any valid row is customer-visible and unlockable immediately.
- **Impact:** a bad or malicious file from any administrator reaches paying customers; no traceability.
- **Exploitability:** requires an admin account (raised by SG-01, SG-07).
- **Remediation:** honour `autoPublish` (stop at `APPROVED`, publish via the existing publish-batch step); require a source on company batches; store source and collected-at on created contacts (schema change only if no suitable column exists; needs approval).
- **Tests:** batch with `autoPublish:false` leaves no `PUBLISHED` business; batch without a source is refused.
- **Dependencies:** pairs with SG-05; confirm admin UI behavior after the default flips.
- **Acceptance:** tests pass; the import integration suite still passes with the new default decided.
- **UAT / launch:** blocks paid launch; UAT acceptable with test data only.

#### SG-05 · P1 · CV · No suppression, classification or provenance for company contacts (includes PR-01, PR-04)
- **Component:** `business_contacts`, discovery, unlock, export, import.
- **Evidence:** `database/schema/business_details.ts:53-80` has no type, source, collected-at or suppression; no suppression logic in business, discover, unlock, export or import services (only the People bridge). Local data: 23 contacts all flagged verified, one with an e-mail.
- **Current behavior:** individuals cannot be removed without deleting the company; re-import restores; unearned "verified" shown to customers.
- **Impact:** inability to honour objection or erasure; personal numbers sold as business data; misleading product claims.
- **Exploitability:** not an attack; a compliance and integrity defect triggered by any removal request.
- **Remediation:** owner decision first: (a) add type, source, collected-at and a suppression check to company contacts (recommended, in-architecture), or (b) route individuals through the People model. Apply suppression in search, unlock, history, export and import; reset flags that were not earned (data decision, dry-run first).
- **Tests:** suppressed identity absent from unlock, history, export; re-import refused; import leaves flags false.
- **Dependencies:** SG-04, SG-13, PR-02; data decision on legacy contacts.
- **Acceptance:** tests pass; documented decision recorded in the checkpoint.
- **UAT / launch:** blocks paid launch.

#### SG-06 · P1 · CV · The web tier is a second backend (ARCHITECTURE CHANGE REQUIRED, long term)
- **Component:** `ownus/src/app/api/v1/[...path]/route.ts` (4,364 lines), `lib/gateway-auth.ts`, `lib/db.ts`.
- **Evidence:** gateway signs JWTs (`signJwt`, `route.ts:350`), implements login, reset, OTP, discover search, export and admin actions, and uses a direct database connection; routes absent from the `gateway-auth.ts` table are treated as upstream.
- **Impact:** compromise of the web tier bypasses API guards, audit log and rate limits; every API fix must be duplicated (SG-13, SG-15, SG-17 are all gateway-side).
- **Exploitability:** requires a web-tier compromise or a native route added without a policy entry.
- **Remediation (in architecture):** least-privilege database role for the gateway; verify-only keys where possible; a test that enumerates every native `fullPath ===` branch and asserts a policy entry (default deny). See section 6 for the long-term change.
- **Tests:** route-policy enumeration test; gateway role cannot run DDL or touch tables it does not need.
- **Dependencies:** database role changes need owner approval (touches production credentials).
- **Acceptance:** enumeration test in CI; role restriction verified against a rehearsal database.
- **UAT / launch:** short-term controls block paid launch; long-term change does not block UAT.

#### SG-07 · P1 · CV · Administrator access single-factor with a 7-day session
- **Component:** admin authentication.
- **Evidence:** e-mailed 6-digit code only; gateway cookie `maxAge` 7 days (`route.ts:638`); token also saved to `localStorage` (`app/admin/monarch/page.tsx:302-303`); privacy policy claims two-factor.
- **Impact:** mailbox control equals admin control for a week; XSS reads the token.
- **Exploitability:** needs the admin mailbox or a script injection.
- **Remediation:** TOTP (the API already supports TOTP for customers; reuse it) or WebAuthn for admin; 1-hour sessions with re-verification; remove the `localStorage` copy; admin session revocation.
- **Tests:** admin token expiry; token never in storage; admin without second factor refused.
- **Dependencies:** SG-08 (storage approach), SG-16 (policy text).
- **Acceptance:** tests pass; admin console works with the new flow.
- **UAT / launch:** blocks paid launch; UAT acceptable with a short interim session limit.

#### SG-08 · P1 · CV · Tokens readable by scripts and carried in URLs; permissive CSP
- **Component:** web client, OAuth redirect, CSP.
- **Evidence:** `ownus/src/lib/api-client.ts:32-42` stores access and refresh tokens in `localStorage`; `oauth.controller.ts:79,129` redirects with both tokens in the query string; CSP allows `'unsafe-inline'`. No current XSS sink was found, so this is a missing defence, not an exploited bug.
- **Impact:** any script injection steals 7-day refresh tokens; URLs reach history and logs.
- **Exploitability:** needs an XSS or log access.
- **Remediation:** HttpOnly Secure SameSite refresh cookie; one-time-code exchange instead of tokens in the redirect; nonce-based CSP. Highest regression risk in the plan (section 4).
- **Tests:** no tokens in redirect URLs; refresh works via cookie; CSP header has no `unsafe-inline` for scripts.
- **Dependencies:** SG-01, SG-03; coordinate with SG-07 and SG-12.
- **Acceptance:** login, refresh, logout and OAuth round trips pass in e2e and Playwright.
- **UAT / launch:** URL-token removal blocks launch; the cookie move can follow UAT if the policy text is corrected (SG-16).

#### SG-16 · P1 · DG · Privacy policy states controls the code does not have (includes PR-03)
- **Component:** `ownus/src/app/(marketing)/privacy/page.tsx`.
- **Evidence:** line 209 (HTTP-only token cookies; tokens are in `localStorage`), line 210 (two-factor admin; single factor), lines 153-158 (customer CSV uploads; no such feature), line 211 (per-organisation isolation; isolation is per user).
- **Impact:** misleading statements to customers and regulators; becomes a contractual exposure at paid launch.
- **Exploitability:** not applicable (documentation).
- **Remediation:** correct the text now to match the code, or implement the control and keep the text; legal review for the rest.
- **Tests:** a test that fails if the policy names a mechanism without a registered check (keep list small).
- **Dependencies:** SG-07, SG-08 may make some statements true later.
- **Acceptance:** each statement traceable to code; counsel review recorded.
- **UAT / launch:** blocks paid launch; low effort.

#### PR-02 · P1 · MC + DG · No notice, objection or removal route for third-party individuals
- **Component:** privacy policy, privacy module.
- **Evidence:** policy does not mention individuals whose contact data is sold; `people/:personId/suppress` is admin-only; the privacy mailbox is the only channel (`PRIVACY_AUDIT_REPORT.md` section 5, 9).
- **Impact:** inability to honour objection or erasure requests and missing notice obligations.
- **Exploitability:** not applicable; regulatory exposure.
- **Remediation:** policy section on third-party data (categories, sources, purposes, retention, rights; legal basis from counsel); a public removal request that creates a tracked privacy request and triggers suppression through the existing People suppression and the SG-05 mechanism.
- **Tests:** public request creates a tracked request and suppresses; suppressed contact absent from search, unlock and export.
- **Dependencies:** SG-05.
- **Acceptance:** end-to-end removal test; counsel sign-off.
- **UAT / launch:** blocks paid launch.

### P2

| ID | Type | Component and evidence | Current behavior and impact | Exploitability / prerequisites | Remediation | Tests | Dependencies | Acceptance | UAT / launch |
|---|---|---|---|---|---|---|---|---|---|
| SG-09 | LV, ED | `modules/search/providers/typesense-search.provider.ts:25-39` concatenates user values into `filter_by`; default provider is Postgres | Only matters if Typesense is enabled; extra clauses could widen results past `status:=PUBLISHED` | Public search endpoint; needs `SEARCH_PROVIDER=typesense` (UNVERIFIED in production) | Quote and escape values, validate ids as UUIDs, keep status clause outside user text. Becomes P1 if enabled | Filter-metacharacter search returns no extra records | none | Test passes; provider decision recorded | Blocks launch only if Typesense is enabled |
| SG-10 | CV | `auth.service.ts:214-244` distinct errors for suspended and social-only accounts; unknown e-mail skips bcrypt; register returns 409 | Enumerates accounts and timing | Unauthenticated; throttled to 10/min | Uniform answers, dummy bcrypt compare | Same status, body, similar timing | SG-11 (verification flow) | Tests pass | Not a blocker |
| SG-11 | LV | free credits 5/day (`credit.service.ts`); verification off by default (`auth.service.ts:24-26,93`); `captcha.service.ts` is used in traffic code, not in `auth.controller.ts` (only throttles) | Throwaway accounts farm credits | Needs scripted signups; per-IP limits may blunt it (traffic module not fully traced) | Verified e-mail before credits usable; per-IP and per-domain registration limits; wire CAPTCHA if intended | Unverified account cannot unlock | SG-03, SG-12 | Test passes | Revenue risk; address before launch |
| SG-12 | LV, ED | gateway copies `x-forwarded-for` upstream; API `trust proxy` = 1 in production (`main.ts:26`), `TRAFFIC_TRUSTED_IP_HEADER` optional (`client-ip.ts`) | IP limits and lockouts evadable if edge does not overwrite the header | Depends on topology (UNVERIFIED) | Edge sets trusted header, strip client values, API reachable only from gateway | Spoofed header does not change limiter key | deployment decisions | Documented topology and a test | Verify at UAT |
| SG-13 | CV | `export.service.ts:123-145` and unlock history do not check `businesses.status`; gateway native `discover/export` has no audit or cap | Contacts of unpublished or removed businesses remain exportable | Needs a customer who unlocked before removal | Filter on PUBLISHED and suppression in every read path; export through the API | Unpublished business absent from history and export | SG-05 | Tests pass | Launch with SG-05 |
| SG-14 | MC | `.github/workflows/test.yml` runs the secret scan only (lines 26-27) | No history scan, `npm audit`, image scan or Dependabot in CI | n/a | Add history scan, `npm audit --omit=dev --audit-level=high`, image scan, Dependabot | CI fails on a seeded secret | SG-02 cleanup first | CI green and failing correctly | Not a blocker |
| SG-15 | CV | gateway `admin/users` (`route.ts:3380`) and `admin/transactions` return fabricated phone, plan, spend and status; user list unpaginated, no audit | Wrong finance and support data; PII listed without an access record | Needs admin access | Read real billing data via the API, paginate, audit PII reads (PR-08) | Fields match database rows; audit row written | SG-06 | Tests pass | Fix before relying on the console |
| SG-17 | CV | gateway `admin/businesses` DELETE removes `lead_unlocks` and `saved_leads`, no refund or ledger entry | Customers lose purchased records; ledger references dangle | Needs admin access | Soft-archive; if deleting, refund and record | Delete leaves ledger consistent | SG-05, SG-06 | Test passes | Not a blocker |
| PR-06 | LV | no purge of search index or caches on suppression found (not traced end to end) | A suppressed person may stay discoverable | Needs a suppressed person and an index in use | Trace sync job; purge or re-index on suppression | Suppressed person absent from search after suppression | SG-05, SG-09 | Test passes | Verify before launch |
| PR-07 | ED | storage lifecycle, backup retention, sub-processors, transfers unverified (`PRIVACY_COMPLIANCE.md` section 4) | Deletion promises not backed | Owner decisions | Owner decisions and bucket lifecycle rules | Documented evidence | none | Decisions recorded | Not a UAT blocker; launch item |

### P3

| ID | Type | Evidence | Remediation and test | Why P3 |
|---|---|---|---|---|
| SG-18 | MC | `Dockerfile`s Node 20 Alpine, `npm install`; MinIO `:latest` in compose | Current LTS pinned, `npm ci`, pinned images; build test | Needs deployment access to exploit |
| SG-19 | MC | CSP `connect-src` allows localhost and any `https:`; malformed Helmet `scriptSrc` (`main.ts:35`) | Restrict to API origin; header test | Defence in depth |
| SG-20 | MC | `unlock.controller.ts` and `export.controller.ts` use `Number(limit)` unbounded | DTO with `@Min/@Max`; boundary test | Own data only |
| SG-21 | MC | saved-leads and saved-searches updates by id without owner in WHERE | Add `AND user_id`; cross-user test | Prior read gates it |
| SG-22 | MC | `MAX_ADMIN_CREDIT_DELTA = 1_000_000` per call (`admin-adjust-credits.dto.ts:5`), one admin | Dual approval or alert above threshold; test | Needs admin access; ledger records it |
| SG-23 | MC | OAuth state in process memory; simulation code logged | Shared store; remove log with SG-01 | Deployment dependent |
| SG-24 | MC | `user.service.ts:126-140` stores any `avatarUrl` string | Validate scheme and host; test | Same-user exposure |
| SG-25 | MC | password minimum 8, no maximum or breached check (`auth.dto.ts`) | Max 72 bytes, breached check optional; test | bcrypt cost 12 limits impact |
| PR-09 | MC | MOBILE type may be personal; no flag (`schema/people.ts`) | Business-versus-personal flag or restrict type | Schema change; low volume |
| PR-10 | MC | no retention schedule for stale company contacts | Add schedule in `privacy.config.ts`; scheduler test | Needs policy decision first |
| PR-11 | MC | OAuth-only deletion needs no fresh authentication | Require recent re-auth; test | Needs a stolen session |

Not findings: credits, billing, payment and SSRF paths were reviewed and are sound (section 3). No false positives were identified among Phase 1 items; the Phase 1 doubt about gateway tokens lacking `sessionId` is reduced by `route.ts:321,1364` but stays UNVERIFIED until tested.

## 3. Existing controls to preserve (must not regress)

Default-deny `APP_GUARD` chain and persisted-role checks (`app.module.ts`, `roles.guard.ts`); JWT issuer, audience, expiry and status checks (`jwt.strategy.ts`); refresh rotation and family revocation; bcrypt cost 12 and hashed single-use reset tokens; login lockout and route throttles; credit deduction with `FOR UPDATE` and ledger; unlock advisory lock and in-transaction publish re-check; payment HMAC, order binding, idempotency and raw-body webhook signature; export owner scoping, 5,000-row cap and formula guard; `safe-http.ts` SSRF client; People suppression (hashed identities, checked inside the unlock transaction); consent ledger, export and 7-day deletion; production secret policy (`config/secrets.ts`); scrubbed logging and generic production errors; metrics token and Swagger off in production; CI secret scanner; destructive-script guards and the migration-journal rules in `ORION_CHECKPOINT.md`. Each phase below must re-run the suites that cover these.

## 4. Implementation phases

Each phase is independently verifiable, ends with a stop for approval, and updates the checkpoint. None starts without explicit instruction.

| Phase | Scope | Findings | Verification |
|---|---|---|---|
| R0 | Owner actions: rotate credentials, revoke tokens, confirm repository visibility and Vercel secrets, confirm `rzp_live_` placeholder, record production values listed in section 8 of the Phase 1 report | SG-02, SG-12 inputs | Provider rejects old credential; recorded in checkpoint |
| R1 | Remove simulated OAuth with tests | SG-01, SG-23 (log) | New unit and e2e tests; full API unit and e2e suites |
| R2 | OAuth linking and signup hygiene | SG-03, SG-10, SG-11 | New tests; auth e2e |
| R3 | Admin second factor and sessions; token storage and redirect | SG-07, SG-08 (URL first, cookie second) | Auth e2e, Playwright login flows, header test |
| R4 | Import moderation gate and source requirement | SG-04 | Import integration and e2e; manual import trial on a rehearsal database |
| R5 | Company-contact controls after the owner's model decision | SG-05, SG-13, SG-17, PR-06 | Suppression tests across search, unlock, history, export, import; dry-run data reset report |
| R6 | Gateway short-term controls and fabricated admin data | SG-06, SG-12, SG-15, PR-08 | Route-policy enumeration test; least-privilege role rehearsal; admin audit tests |
| R7 | Credits and input hardening | SG-20, SG-21, SG-22, SG-24, SG-25, SG-09 | Boundary and cross-user tests; credit and payment suites unchanged |
| R8 | Privacy documents and public removal route | SG-16, PR-02, PR-07, PR-09 to PR-11 | End-to-end removal test; counsel review |
| R9 | Headers, container hardening | SG-18, SG-19 | Header tests; image build |
| R10 | CI scanning and automated security tests | SG-14 | CI fails on seeded secret and high advisory |
| R11 | Final verification and report | all | Section 8 criteria; independent penetration test of staging |

**Mapping to your 15 steps and the changes:** secrets (R0), authentication and sessions (R1-R3), authorization and IDOR (no confirmed API flaw; gateway policy test in R6), credits and billing (controls sound; only SG-22 and a regression suite in R7), rate limiting and abuse (SG-11, SG-12 in R2 and R6), exports and exposure (SG-13 in R5), SSRF (no gap; preserve and keep its tests), input validation (R7), audit logging (PR-08 in R6), privacy classification, suppression and ingestion (R4, R5), policy (R8), headers and errors (R9), automated tests (R10), final verification (R11). **Order adjustments driven by evidence:** the import gate (SG-04) is placed before the contact-controls phase because publishing without review is the entry point; the gateway phase moves earlier than the usual "input validation" slot because three P2 findings are gateway-side; the privacy policy correction (SG-16) is low effort and may be pulled forward at any time since it needs no code.

## 5. Regression risks

| Area | Risk | Mitigation |
|---|---|---|
| Authentication | R2 linking rules may block users who registered by password and later use social login | Provide the signed-in link flow; announce; test both paths |
| Sessions and tokens | R3 cookie move breaks the gateway, API client and any integration reading `localStorage` | Do the URL-token removal separately from the cookie move; Playwright login, refresh, logout |
| Admin access | R3 second factor can lock out the only admin | Enrol before enforcing; keep a break-glass procedure approved by the owner |
| Imports and publishing | R4 changes the default so existing admin flows stop publishing automatically | Decide the default with the owner; update the admin UI text; keep a publish-batch step |
| Credits and subscriptions | R2 requires verified e-mail before credits are usable | Grandfather existing verified users; run the credit and payment suites unchanged |
| Exports and customer search | R5 filtering may drop contacts customers already unlocked | Define the policy for already-unlocked contacts (hide versus show) before coding |
| Integrations | R7 input bounds or R6 gateway role limits may break webhooks and HubSpot sync | Run the integrations suite; rehearse the role against a copy |
| Existing data | R5 flag reset changes what customers see | Dry-run report first; no data change without approval |
| Gateway | R6 deny-by-default may block routes that work today | Enumeration test lists them first; add explicit policy entries |
| Migrations | Any schema addition (R4, R5) must follow the journal rules (new migration only via `npm run db:migration:new`, never edit 0000-0023) | Rehearse on a disposable database |

## 6. ARCHITECTURE CHANGE REQUIRED

**SG-06 long-term: make the API the only token signer and database client; reduce the gateway to a proxy.**
- **Why the current architecture cannot safely fix it:** the duplicate implementation is the vulnerability. Every control added to the API (audit, rate limits, suppression, guards) must be repeated in about 4,400 lines of gateway code, and the gateway holds signing secrets and a database connection. Reducing risk below that requires removing one of the two backends.
- **Security impact:** web-tier compromise gives token forging and direct database access; fixes drift between the two implementations (SG-13, SG-15, SG-17 are examples).
- **Minimum viable change:** migrate native routes to API calls one group at a time, starting with the ones that have security consequences (export, admin delete, admin lists, discover search), keep the proxy, then remove the signing secrets from the web tier. No framework, database or infrastructure replacement.
- **Possible workaround (R6):** least-privilege database role, verify-only keys where possible, and a deny-by-default policy test. This reduces risk but does not remove the duplication.
- **Blocks UAT:** no, provided R6 is done and the workaround is accepted by the owner. **Blocks paid launch:** the workaround is required; the full change can follow with a dated commitment.
- **Not approved:** this plan documents it only; no change starts without explicit approval.

No other architectural change is needed. SG-05 option (a) stays within the architecture; option (b) is a larger data-model decision for the owner.

## 7. Deferred items

| Item | Why it can wait |
|---|---|
| SG-18 container hardening | Needs deployment access to exploit; applies when images are built for production |
| SG-19 CSP details | Depends on SG-08 nonce work; do together |
| SG-20, SG-21, SG-24 | Own-data scope only, gated by a prior read or by the gateway |
| SG-22 dual approval | Requires admin access and writes a ledger row; revisit after R3 admin factor |
| SG-23 shared OAuth state | Only matters with multiple instances; the simulation log goes with SG-01 |
| SG-25 password policy | bcrypt cost 12 limits impact; low user friction value |
| PR-09, PR-10, PR-11 | Need policy decisions or schema changes; low volume today |
| SG-09 | Deferred only while Typesense stays disabled; becomes P1 if enabled |
| PR-07 | Needs owner decisions that code cannot supply |

## 8. Final acceptance criteria (before Orion can be called security hardened)

All must be demonstrated with evidence in the checkpoint; none is claimed now.

1. Old database credential verified rejected; secret scans (working tree and history) report 0 findings; CI runs both.
2. `sim_*` codes and unconfigured providers produce no session (automated test); OAuth linking tests (SG-03) pass.
3. No tokens in URLs; admin second factor enforced; admin and customer session limits tested.
4. Import with `autoPublish:false` publishes nothing; batches without a source are refused.
5. Suppressed company and People contacts are absent from search, unlock, unlock history, export and re-import; public removal request creates a tracked request and suppresses.
6. Every native gateway route has a policy entry (enumeration test); gateway database role is least privilege (verified on a rehearsal database).
7. Existing controls in section 3 still pass their suites: API unit, integration, security and e2e suites and the web tests (baseline in `ORION_CHECKPOINT.md`: unit 375, integration 912+, security 9, e2e 399, web 222).
8. Privacy policy statements each map to code; counsel review recorded.
9. `npm audit --omit=dev` shows no high or critical advisories; image scan clean.
10. Playwright suite run (not run in Phases 1 or 2).
11. Independent penetration test of a staging deployment with no open P0 or P1.

## 9. Incomplete investigations and assumptions

- Production values (`NODE_ENV`, `REQUIRE_EMAIL_VERIFICATION`, `RAZORPAY_API_MODE`, `SEARCH_PROVIDER`, `CORS_ORIGINS`, `TRAFFIC_TRUSTED_IP_HEADER`), repository visibility, and rotation status are unobserved.
- The full SG-01 HTTP chain was not run; the gateway was sampled, not read in full; no signed-in or dynamic testing; refund and chargeback flow, CAPTCHA use, bucket policy and backup encryption not reviewed.
- Severity of SG-09, SG-11 and SG-12 depends on those unobserved facts and should be revisited when they are known.


---

## 10. Implementation status (Phases 3 to 7, 2026-10-10)

All of this is **uncommitted** working-tree work (HEAD `3cf08b3`, nothing staged, nothing deployed). Per-finding detail, evidence and limits are in `SECURITY_GAP_REPORT.md` section 10; tests are in `SECURITY_TEST_PLAN.md`.

### 10.1 What the planned phases became

| Plan phase | Scope | State |
|---|---|---|
| R0 owner actions | Rotate credentials, revoke tokens, confirm visibility and production values | **NOT DONE, needs the operator.** See 10.2. |
| R1 | Remove simulated OAuth (SG-01, SG-23 log) | **Done in tree**, tested. |
| R2 | OAuth linking, sign-up hygiene (SG-03, SG-10, SG-11) | SG-10 done for login; **SG-03 and SG-11 open**. |
| R3 | Admin second factor and sessions, token storage (SG-07, SG-08) | Partly (atomic OTP, 12 h session); **second factor, revocation and token storage open**. |
| R4 | Import moderation gate (SG-04) | **Open** (decision needed). |
| R5 | Company-contact controls (SG-05, SG-13, SG-17, PR-06) | **Open** (decision needed). |
| R6 | Gateway controls (SG-06, SG-12, SG-15, PR-08) | Partly: gateway login/OTP bypasses closed, policy table enumerated, search and export bounded; **no per-route object-level tests, SG-15 open**. |
| R7 | Credits and input hardening (SG-09, SG-20..25) | **Done**: SG-09, SG-20. **Open**: SG-21, SG-22, SG-24, SG-25. Also done: pricing validation, test-key guard, amount checks (Phase 6). |
| R8 | Privacy documents and public removal route | **Open.** |
| R9 | Headers, containers (SG-18, SG-19) | Partly (Permissions-Policy, no-store, production CSP); containers open. |
| R10 | CI scanning and automated security tests | Tests added in the repository; **CI workflow not changed** beyond the earlier secret scan. |
| R11 | Final verification and penetration test | **Not done.** |

### 10.2 Actions only an operator can take (nothing here was done or can be done by the code changes)

1. **Rotate the database owner credential** that is in the seven tracked scratch files and git history, and revoke anything else that ever appeared (`SECURITY_REMEDIATION_SG02.md`). Review provider access logs since 2026-09-21.
2. **Rotate the JWT access and refresh secrets** (SG-02b). The two values committed in `docker-compose.yml` are also what the local API and gateway env files contain. Whether production uses them is unknown (the pulled Vercel file has empty values). Rotating signs everyone out once.
3. **Before deploying this work**, check what production's `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are. The new production check **refuses** the example values and the two published compose values: the API will not start and the gateway will refuse to sign if production still uses one.
4. **Check the production payment key.** With a test-mode key (`rzp_test_...`) in production, online payments now fail closed. Set `RAZORPAY_ALLOW_TEST_KEYS=true` only on a staging deployment that runs as production on purpose.
5. Decide whether to **commit**. Nothing is committed or staged. The mixed files (`package.json`, `env.validation.ts`, `route.ts`) carry earlier uncommitted work, so grouping needs the hunk-level approach in `ORION_CHECKPOINT.md` section 6.
6. Run `npm run db:reconcile-credits` (read-only) against a **production copy** before launch and review any WARN line.

### 10.3 Behaviour changes to expect (regression watch-list)

| Change | Who notices | Mitigation |
|---|---|---|
| Login answers the same for unknown, social-only and suspended-with-wrong-password accounts | Social-login users who try a password now get "Invalid email or password"; a suspended user sees the deactivation notice only after a correct password | "Forgot password" lets a social-login user set a password; support text |
| Admin session 12 h (was 7 days) | Administrators sign in again daily | `ADMIN_SESSION_TTL_SECONDS` |
| Logout ends the access token at once | Other tabs signed in with the same session get 401 | Intended |
| `PATCH /user/settings` accepts 10 documented keys only | Any client sending other keys gets 400 (the web client does not call it) | Intended |
| `PUT /credit/admin/config` accepts 6 keys with ranges | An admin tool sending another key or a wild value gets 400 | Intended |
| Search: text limits, `sortBy` characters, `page` and `limit` ranges | A client sending an over-long query or a free-text sort gets 400 | Limits are generous; UI names accepted |
| Saved searches are validated on save and on run | A previously saved invalid filter now answers 400 on run | Edit the saved search |
| Per-route limits (unlock 30/min, payments 20/min, search 60/min, ...) | Scripts and shared-NAT offices may see 429 sooner | Limits are per address; tune in the controllers |
| Gateway search and export clamp inputs; export capped at 5,000 rows | Large exports are truncated (`X-Export-Truncated`) | Same cap as the API |
| Production refuses placeholder secrets and test payment keys | Misconfigured deployments stop or lose payments | See 10.2 |
| API responses carrying credentials are `Cache-Control: no-store` | None | |
| `429` and malformed-JSON errors have new codes and text | A client matching the old text | `RATE_LIMITED`, `BAD_REQUEST` |

### 10.4 Next recommended work, in order

1. Operator actions 10.2 (1 to 4). Nothing in the code can substitute for them.
2. Decide and commit (10.2 item 5), then deploy to a **preview** and re-verify; the real-PostgreSQL concurrency suite and the reconciliation tool should be run against the deployment's database engine.
3. Owner decisions that block P1 work: the default for import publishing (SG-04), the contact model (SG-05), refund policy for unlocked leads (CR-06), and whether to add wallet `CHECK` constraints (CR-02).
4. Open P1 code work: SG-03 (OAuth linking and sign-up verification), SG-07 (admin second factor and revocation), SG-08 (token storage).
5. P7-12 (DTOs for the 11 inline-typed bodies) and a table-backed shared rate limiter if more than one API instance will run.
6. A final verification and an independent penetration test of a staging deployment, which this plan still requires; none of the testing so far was dynamic or signed-in against a deployed environment.


---

## 11. Phase 8 status: SSRF and ingestion-source security (2026-10-10)

Uncommitted working-tree work; detail and evidence in `SECURITY_GAP_REPORT.md` section 11, tests in `SECURITY_TEST_PLAN.md` section 9.

| Item | State |
|---|---|
| Outbound-request inventory (11 paths) | Done. One path takes a customer-typed URL (webhooks) and was already guarded; the rest are fixed hosts or operator-set environment values. No fetch of imported or enriched URLs exists. |
| Address classification (IPv6 by value, embedded IPv4, special-use ranges) | **Done** (P8-01), mutation-proven |
| Port refusal list (97 non-web ports) | **Done** (P8-02) |
| Stop reading at the response cap | **Done** (P8-03) |
| Imported website / LinkedIn / source URLs: only clean public http(s) stored, rest reported as warnings | **Done** (P8-04, P8-05) |
| Safe links in the web app (5 render sites) | **Done** (P8-04) |
| Source approval for company imports; company-contact suppression | **Open**: SG-04, SG-05 (workflow decisions) |
| Operator-set URLs (mail relay, error tracker, trace exporter) | **Accepted risk**, documented |

**Behaviour changes to expect**

| Change | Who notices | Mitigation |
|---|---|---|
| A webhook URL with a port from the refusal list (for example `:22`, `:6379`, `:3306`) is refused | A customer whose endpoint runs on such a port | Use 443 or any other web port |
| A webhook URL written as 6to4, Teredo, site-local or IPv4-compatible IPv6 is refused | Practically nobody | None needed |
| Imported website and LinkedIn values are normalised (`acme.in` becomes `https://acme.in`; a trailing slash on a bare host is not added) or left out, with a warning in the preview and validation log | Admins importing files with malformed or non-LinkedIn values | The preview names each value and the reason (`SCHEME`, `CREDENTIALS`, `HOST_NOT_PUBLIC`, `NOT_LINKEDIN`, `INVALID`, `TOO_LONG`); fix the cell and re-import |
| A People `source.url` with credentials or an internal host is refused (`INVALID_SOURCE_URL`) | People import authors | Use the public page |
| A stored link that is not http(s) renders as plain text instead of a link | Reviewers looking at old bad data | Intended |

**Not done and why:** source approval for company imports and company-contact suppression are workflow and data-model decisions (SG-04, SG-05); a distributed outbound-concurrency limit would need shared state (P7-13); certificate pinning and a deployment-level egress filter are infrastructure, not code, and are recommended for production (block the cloud metadata address and private ranges at the network edge as a second layer).

**Architecture change required:** none for SSRF. **Does not block UAT.**

**Next recommended work:** the privacy and suppression phases (SG-05, PR-02, company-contact suppression and provenance), then SG-04 (the import publishing default), as these are the remaining ingestion-side dependencies; and the operator actions in section 10.2.


---

## 12. Phase 9 status: export security and bulk-extraction controls (2026-10-10)

Uncommitted working-tree work; detail and evidence in `SECURITY_GAP_REPORT.md` section 12, tests in `SECURITY_TEST_PLAN.md` section 10.

| Item | State |
|---|---|
| Export surface inventory (8 surfaces, 3 datasets, 2 formats) | Done |
| Published-only exports (unlocked leads, saved leads) | **Done** (P9-01), mutation-proven |
| Rolling 24-hour row cap and one-at-a-time rule per account; `EXPORT_REFUSED` audit | **Done** (P9-02), mutation-proven |
| Rate limit on the People export | **Done** (P9-03) |
| Gateway export audit | **Done** (P9-04) |
| Download headers: attachment, no-store, nosniff, safe names (API and gateway) | **Done** (P9-05), mutation-proven |
| History page size parsing | **Done** (P9-08) |
| Formula guard: leading whitespace and control characters (API and gateway) | **Done** (P9-09), mutation-proven |
| Phone numbers kept intact in phone columns | **Done** (P9-10), mutation-proven |
| Privacy data-access export no longer embeds stored export files | **Done** (P9-14), mutation-proven |
| Audit: request id, outcome, requested versus delivered, policy | **Done** (P9-11) |
| Company-contact suppression in exports | **Open**: depends on SG-05 (no model exists); not worked around |
| Per-account (not per-address) request limit | **Open**: P9-06, needs a guard-order change |
| Shared export counters across instances | **Open**: P9-07, same as P7-13 |

**Behaviour changes to expect**

| Change | Who notices | Mitigation |
|---|---|---|
| A company that is no longer published no longer appears in the unlocked-leads or saved-leads export | Customers who unlocked or saved a company later withdrawn | Intended; the lead stays in their unlock history |
| A second on-demand export while one is running returns 429 `EXPORT_IN_PROGRESS` | Double-clicks, scripted clients | Wait for the first to finish |
| More than 20,000 rows exported in 24 hours returns 429 `EXPORT_DAILY_LIMIT` | Heavy exporters | The limit is `MAX_EXPORT_ROWS_PER_DAY` in `export.service.ts`; a product decision |
| `POST /people/export` is limited to 10 per minute | Scripts | Same as the other export route |
| A cell with a formula trigger behind spaces or control characters now starts with an apostrophe | Anyone with such data | Intended |
| Phone numbers in phone columns of the CSV are no longer prefixed with an apostrophe (when they are plain numbers) | Customers who saw `'+91...` before | Intended |
| Export responses are `no-store` and `nosniff` | Proxies, download managers | None needed |

**Not done and why:** company-contact suppression (SG-05, data model and workflow decision); per-account limiter and shared counters (guard order and shared state); streaming, object storage and signed URLs (infrastructure; recommended at scale); volume alerting on exports (monitoring design).

**Architecture change required:** none for the controls above. **Does not block UAT.** Production readiness still depends on the open P0/P1 items and operator actions in section 10.2.

**Next recommended work:** the privacy and suppression phase (SG-05, PR-02, erasure of stored `export_jobs.content`), then Phase 10 as the user directs.


---

## 13. Phase 10 status: data classification and personal-contact protection (2026-10-10)

Uncommitted working-tree work; evidence in `SECURITY_GAP_REPORT.md` section 13, definitions in `DATA_CLASSIFICATION.md`, tests in `SECURITY_TEST_PLAN.md` section 11.

| Item | State |
|---|---|
| Classification model (8 classes + UNKNOWN), derived per value, inferred, conservative | **Done** (P10-02) |
| Classification-aware server-side masking before unlock | **Done** (P10-01), mutation-proven |
| Individual PAN / embedded-PAN GSTIN never in full; identifiers masked before unlock | **Done** (P10-03), mutation-proven |
| One disclosure policy for detail, unlocked list, export, CRM sync | **Done** (P10-05) |
| Profile response minimised | **Done** (P10-04), mutation-proven |
| Search-result and error-response minimisation | **Verified**, no change (P10-06) |
| Stored classification, reviewer correction, audit of corrections | **Open**: additive migration recommended (P10-07) |
| Company-contact suppression honoured by all paths | **Open**: SG-05, not worked around (P10-08) |
| After-unlock disclosure of personal / unknown values | **Open policy decision** (P10-09) |
| Field-level admin views and admin read logging | **Open** |

**Behaviour changes to expect**

| Change | Who notices | Mitigation |
|---|---|---|
| Locked emails and phones are masked differently and show less (`r*****@gmail.com`, `+91 ********71`); the last character is gone | Customers comparing before and after | Intended; still contains `***` |
| Locked contacts carry `emailKind` and `phoneKind` | Client developers | Additive fields |
| The PAN of an individual and the PAN inside such a GSTIN are masked after unlock | Customers who relied on a proprietor's PAN | Intended; policy switch `individualPanAfterUnlock` |
| Locked GSTIN shows only its state code; locked PAN / TAN / other numbers show only stars | Customers | Intended |
| `/user/profile` and `/user/me` no longer include `metadata`, `deletedAt`, `googleId`, `microsoftId`, `providerId` | Any client reading them | `jobTitle`, `googleLinked`, `microsoftLinked` remain; the web client does not use the removed fields |
| Unlocked values, exports and CRM sync are unchanged under today's policy | Nobody | None |

**Not done and why:** stored classification and corrections (schema change needs authorisation); company-contact suppression (data model and workflow decision); a stricter after-unlock policy (business and legal decision, one constant); admin field-level views and read logs (separate design).

**Architecture change required:** none. **Does not block UAT.** Production readiness still depends on the open P0/P1 items and operator actions in section 10.2.

**Next recommended work:** the suppression and removal phase for company contacts (SG-05, P10-08), then the stored-classification migration if reviewer correction is wanted.

## 14. Phase 13 status: audit logging, privacy-safe logging, incident response (2026-10-12)

> **RECONSTRUCTED in Phase 20 (2026-10-12).** The original text of sections 14 to 16 was destroyed by a documentation-editing error in Phase 16; sections 1 to 13 were restored from Claude's file-history copy. Sections 14 to 16 are rebuilt from the checkpoint change log and are summaries, not the original.

| Item | Status |
|---|---|
| Authentication events audited (P13-01) | Done in tree |
| Structured redactor for logs and audit rows (P13-02/03) | Done in tree |
| "Immutable audit log" claim removed; limits documented (P13-04) | Done |
| Admin credit adjustment audited in the same transaction (P13-05) | Done in tree |
| Abuse tripwires (P13-06), scrubber fix (P13-07) | Done in tree |
| `INCIDENT_RESPONSE.md`, `SECURITY.md` | Written |
| Off-host log shipping, audit tamper protection, log retention, role-change audit | **Open** |

## 15. Phase 14 status: headers, production configuration, dependencies, deployment (2026-10-12)

> **RECONSTRUCTED in Phase 20.** See the note at section 14.

| Item | Status |
|---|---|
| `.dockerignore` keeps `.env*`, keys and `.vercel` out of images (P14-01) | Done (images unbuilt) |
| API CSP tightened (P14-02); cookie `Secure` fixed (P14-03) | Done |
| Production CORS validation and startup refusal (P14-04) | Done; re-verified on the compiled API in Phase 19 |
| Web headers, `no-store` on gateway API, report-only strict CSP (P14-05) | Done |
| CI hardening and builds (P14-06) | Done in file; workflow untracked, never run; two further defects fixed in Phase 19 |
| `handlebars` advisory (P14-07) | Patched |
| Web `'unsafe-inline'` scripts | **Open; ARCHITECTURE CHANGE REQUIRED** |
| Docker reproducibility, Node version alignment | **Open** (Phase 19) |

**Needs approval before production:** CORS startup refusal, `connect-src` narrowing, first CI run, image rebuild, lockfile changes.

## 16. Phase 15 status: provenance, source trust and data quality (2026-10-12)

> **RECONSTRUCTED in Phase 20.** See the note at section 14.

| Item | Status |
|---|---|
| No automatic publication without approved source and request (P15-01/02) | Done in tree |
| Source trust model and revocation guard, migration `0025_source_trust` (P15-03) | Done in tree; migration unapplied in any shared environment |
| Queue worker cannot publish (P15-04); merge decisions executed (P15-05) | Done |
| Identifier validation, verification ladder, validation-log hygiene, per-kind matching (P15-06 to P15-09) | Done |
| Admin UI publish control | **Open** (needs approval) |
| Register and approve real sources | **Open** (business action) |
| Gateway status screen can publish an unreviewed source's business | **Open** |
| Company-contact suppression and raw-row retention | Partly addressed in Phase 16 |

**Behaviour changes to expect:** imports wait for an administrator; publishing from an unreviewed or unnamed source needs the override flag; a revoked source's businesses are held back.

**Changes that need explicit approval before production:** migration `0025_source_trust`, the no-auto-publish default and a UI control to publish, registering and approving real sources, the holding behaviour for pre-existing businesses.

## 17. Phase 16 status: retention, deletion and backup lifecycle (2026-10-12)

| Item | Status |
|---|---|
| Deletion ledger, `db:ledger export/reapply`, backup integration | **Done in tree** |
| Contact suppression service (record + clear existing rows + audit) | **Done in tree** (no intake route) |
| Bounded, previewable, audited retention; `db:retention` | **Done in tree** |
| Import raw-payload retention rule | Built, **off** until D-RET-2 |
| Safe error labels; erasure clears own-entity audit values | **Done** |
| Backup hardening (umask, manifest, checksum re-verify, unencrypted warning) | **Done** (not run end to end) |
| Data-subject-request workflow (Phase 11) | **Open**: needed to make suppression usable by non-operators |
| Audit-event expiry, log retention, legal hold, restore drill | **Open** (decisions D-RET-3/4/6) |
| Remote ledger reapply for production DR | **Open** (D-RET-9, needs approval) |

**Behaviour changes to expect:** retention now processes at most 20,000 rows per rule per hour (a large backlog clears over several runs); a failing rule no longer stops the others; backups write a ledger and a manifest and warn when unencrypted; `restore.sh` prints a mandatory next step. No schema change in this phase.

**Needs approval before production:** D-RET-1 to D-RET-9 in `DATA_RETENTION_POLICY.md`; setting `RETENTION_IMPORT_RAW_PAYLOAD_DAYS`; applying migration 0024 where it is not applied (it holds the triggers this phase depends on); a first ledger-enabled backup and a restore drill.

## 18. Phase 17 status: release readiness verification (2026-10-12)

> **Correction (Phase 20):** the Phase 17 table below lists "API Unit suite 1,726 passed, 13 skipped". That is not a unit-suite result: unit and integration are separate runs (Phase 19, clean copy: unit 802 passed / 1 skipped; integration 945 passed / 13 skipped). The release verdict of Phase 17/18 (conditionally ready) is superseded by BLOCKED (`PRODUCTION_READINESS_REPORT.md`).

| Verification Milestone | Target | Status |
|---|---|---|
| Static secret scan | `ops/security/scan-secrets.mjs` | 0 working tree / git config findings |
| Security test regression | `test/jest-security.config.js` | 9/9 passed |
| Migration chain check | `scripts/new-migration.ts --check` | 26 journal entries verified consistent |
| API type check | `apps/api/tsconfig.json` | 0 compilation errors |
| Web type check | `ownus/tsconfig.json` | 0 compilation errors |
| API Unit suite | `test/jest-unit.config.js` | 1,726 passed, 13 skipped, 0 failed |
| API Integration suite | `test/jest-integration.config.js` | 945 passed, 13 skipped, 0 failed |
| API E2E Hardening | `test/jest-e2e.json` | 580 passed, 7 skipped, 4 todo, 1 passed in isolation (`health-probes` 20/20) |
| Web Unit suite | `ownus/src/lib/__tests__` | 258 passed, 0 failed (61 suites) |
| API Production build | `npm run build` | `dist/main.js` generated cleanly |
| Web Production build | `npm run build` | Turbopack 21 static & dynamic routes compiled |

**Release Gate Recommendation:**
Code-level hardening for Phases 3 through 16 is validated. Release is **CONDITIONAL** upon operator completing credentials rotation (SG-02/SG-02b), live payment setup, and production database cutover.

## 19. Phase 18 status: final finding closures (2026-10-12)

| Finding | Remediation | Verification | Final Status |
|---|---|---|---|
| **SG-03** | Enforce `profile.isEmailVerified === true` on OAuth callbacks & automatic account linking | `oauth-email-verified.spec.ts` (4/4 pass) | `VERIFIED_CLOSED` |
| **SG-24 / M-4** | Add base64 PNG/JPEG/WEBP/GIF format check, SVG rejection, 1.5MB size ceiling, HTTPS URL host guard (`avatar-validation.util.ts`) | `avatar-validation.util.spec.ts` (10/10 pass) | `VERIFIED_CLOSED` |
| **SG-25 / L-1** | Add `@MaxLength(128)` to `RegisterDto`, `ResetPasswordDto`, and `ChangePasswordDto` to prevent Bcrypt CPU DoS | `tsc --noEmit` clean, `test:unit` clean | `VERIFIED_CLOSED` |
| **L-7** | Replace `console.error` with NestJS structured `Logger` in `AdminAuthController` | `tsc --noEmit` clean | `VERIFIED_CLOSED` |
| **SG-02** | Neon owner credentials in historic commits | Pending operator execution | `BLOCKED` |
| **SG-02b** | Ensure production environment variables on Vercel do not match compose defaults | Pre-flight operator check | `ACCEPTED_RISK_PENDING_APPROVAL` |
| **SG-06** | Gateway native fallback route consolidation | Deny-by-default route table active | `ACCEPTED_RISK_PENDING_APPROVAL` |
| **SG-07** | Admin sign-in TOTP / WebAuthn second factor | Domain check + atomic OTP active | `ACCEPTED_RISK_PENDING_APPROVAL` |
| **SG-08** | Nonce CSP to eliminate `'unsafe-inline'` | Report-only strict CSP active | `ACCEPTED_RISK_PENDING_APPROVAL` |

## 20. Phase 22 status: targeted remediation (2026-10-12)

Selected because they were confirmed in the code, fixable locally and needed no owner decision: R-005 (gateway publish bypass), the testable and purgeable part of R-008 (suppression visibility and stored export files), and the missing tests for SG-25 and L-7. Everything else on the Critical and High list is blocked on an external action or a decision (credentials, host secrets, production target, payments, gateway future, retention decisions) and was not touched. Acceptance criteria (set before the change): a business from an unapproved source cannot be published from the gateway screen; a suppressed value is absent from detail, unlock history and a new export and cannot be re-inserted; stored export files are expired when a value is removed, including after a restore; the password cap and admin logging each have a test that fails when the control is removed. Results are in `SECURITY_TEST_PLAN.md` section 18 and the checkpoint.

## 21. Phase 23 status: independent verification (2026-10-12)

Reviewed independently: R-005, the stored-export expiry, suppression visibility, SG-25, L-7. Results are in `SECURITY_GAP_REPORT.md` section 21 (dispositions and evidence). One incomplete fix was found and corrected (People suppression left stored export files downloadable). **R-005 is verified closed** for the reported weakness. **R-008 stays open**: intake workflow, files already downloaded, CRM-sync exclusion. Nothing was committed or deployed; the release is still BLOCKED.

## 22. Phase 32 status: regression coverage and fixed-vulnerability verification (2026-10-13)

Full detail in `SECURITY_REGRESSION_VERIFICATION_REPORT.md` and `SECURITY_REGRESSION_MATRIX.md`. Summary: 85 register entries and 84 traceability rows reviewed; 27 controls deliberately broken and re-tested (23 detected; 2 equivalent; 2 real blind spots, one closed by a new test and one structural). **One finding: R-086**, the avatar URL host check let 9 of 14 non-public hosts through (Low; the earlier "SG-24 closed / SR-SSRF-03 VERIFIED" statements were overstated), fixed by reusing the shared address classifier and covered at unit and HTTP level. **Three coverage gaps closed** with new tests: avatar validation wiring (had no test), the unverified OAuth e-mail rule at the HTTP boundary (existing HTTP suite stayed green with the rule removed), and cross-workflow behaviour (a person suppressed after a customer unlocked them; a logged-out token against export and unlock). **Not closed:** wallet-lock removal is invisible to every default suite and is caught only by the opt-in real-PostgreSQL suite, which is not in CI and needs a fresh database per run (R-017); the web gateway's route handlers still have no repository-level HTTP tests (R-006). Nothing was committed or deployed; the release is still BLOCKED.
