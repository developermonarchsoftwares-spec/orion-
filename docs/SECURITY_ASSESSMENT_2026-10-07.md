# Orion security assessment

**Date:** 7 October 2026 · **Type:** static source review of the repository (NestJS API, Next.js web app and gateway, database schema, Docker and ops files) plus `npm audit` and a git-history scan · **Status:** findings for the owner; nothing here has been fixed except where stated.

No secret values appear in this report. Where a credential is mentioned, only the file and the commit are named.

## 1. Summary

| Severity | Count | Findings |
|---|---|---|
| **Critical** | 1 | C-1 Live database credentials committed to git (at HEAD and in history) |
| **High** | 3 | H-1 Search filter injection (when Typesense is the search provider) · H-2 Vulnerable dependencies (2 critical, 3 high by `npm audit`) · H-3 A second, parallel backend in the web tier holds the token-signing secret and a direct database role |
| **Medium** | 7 | M-1 to M-7 |
| **Low** | 8 | L-1 to L-8 |
| **Informational** | 5 | I-1 to I-5 |

**Overall:** the application code is, in most areas, noticeably hardened. Earlier fixes (labelled S-xx in the code) cover default-deny authentication, signed and typed tokens, refresh-token rotation with replay detection, hashed admin codes, SSRF-safe webhooks, a CSV parser with limits, payment-webhook signature checks with replay protection, rate limiting, and security headers. The serious problems are around **secrets in version control**, **dependencies**, **one injection path**, and the **architecture of the web gateway**.

## 2. Scope and method

- **Read:** `apps/api/src/main.ts`, config and env validation, the auth module (login, MFA, refresh, admin OTP, JWT strategy, guards), the global guard setup, every `@Public()` route, monitoring and metrics, discover and business controllers, the Typesense provider, user service (avatar), payment signature code, the integrations SSRF module (by reference), the Next.js gateway (`app/api/v1/[...path]/route.ts`, `lib/gateway-auth.ts`, `lib/db.ts`), `next.config.ts`, Dockerfiles, `docker-compose.yml`, and the backup scripts and privacy module added earlier in this project.
- **Run:** `npm audit --omit=dev` for the API and the web app; a scan of git history for credential patterns (file names and counts only).
- **Not done:** no dynamic testing, no exploitation, no penetration test, no review of every one of the ~4,500 lines in the gateway or every frontend component, no cloud-console or hosting review, no test against a deployed environment. Statements marked *(not tested)* are reasoned from the code.

## 3. Findings

### C-1 · CRITICAL · Live database credentials committed to git
- **Where:** seven tracked files at HEAD contain the credential pattern: `ownus/scratch_test_db.js`, `scratch_inspect_tables.js`, `scratch_master_e2e_verification.js`, `scratch_test_app_preferences_persistence.js`, `scratch_test_notifications_integration.js`, `scratch_test_profile_persistence.js` and `scratch_test_single_device_login.js` (all under `ownus/`). An eighth scratch file and a `ownus/scratch/` folder of scripts are also tracked and should be removed. The first commit that introduced them is `1cdf261` (2026-09-21); four commits contain the credential pattern. The git remote is a GitHub repository (visibility not checked).
- **What:** connection strings for a remote Neon PostgreSQL database with the **owner role** and its password, in plain text. `.env.production.example` also appears in history with a password-bearing URL (it may be a placeholder; confirm).
- **Current state:** in your working tree these files have since been edited to read a local database URL instead, but **that change is uncommitted**, so HEAD, every earlier commit and any clone or fork still contain the credentials.
- **Impact:** anyone with read access to the repository (or a leaked clone) can connect to the production-class database and read or change all data (users, password hashes, leads, billing) or drop it. The owner role bypasses all application-level controls.
- **Scenario:** a contractor or an attacker with a stolen GitHub token clones the repo, runs `git log -S` for the connection string, connects with `psql`, exports the `users` table.
- **Fix (in this order):**
  1. **Rotate the database password and any other credential that ever appeared** (do this first; removing it from git does not undo exposure). Follow `docs/CREDENTIAL_ROTATION_EXECUTION_PLAN.md`. Check Neon's connection logs for unfamiliar sources since 2026-09-21.
  2. Stop using the owner role for the app. Create separate least-privilege roles: API (DML only), gateway (read/write on a short list of tables), migrations (DDL, used only in deploys). The code already supports `GATEWAY_DATABASE_URL`.
  3. Commit the working-tree cleanup, and delete the scratch scripts from the repo (they do not belong in version control).
  4. Remove the credential from history (`git filter-repo` or BFG), force-push, ask collaborators to re-clone, and delete forks and cached copies.
  5. Add secret scanning on every push (gitleaks or GitHub secret scanning with push protection).
- **Note on tooling:** the `source-secrets.security.spec.ts` test added earlier scans only the **working tree**, so it passed while history was exposed. Add a history scan (gitleaks) to CI.

### H-1 · HIGH (conditional) · Typesense filter injection from a public endpoint
- **Where:** `apps/api/src/modules/search/providers/typesense-search.provider.ts:22-39`, fed by `GET /discover/search` (public) via `discover.service.ts`. Fields `industryId`, `categoryId`, `businessType`, `state`, `district`, `city`, `pincode` and others are placed into the `filter_by` string with no escaping or validation (the DTO only requires a string).
- **Condition:** exploitable only when `SEARCH_PROVIDER=typesense`. The default is `postgres`, which uses parameterised queries.
- **Impact:** an attacker controls part of the filter expression and can add clauses with `&&` / `||` to try to widen results beyond `status:=PUBLISHED` (unpublished, draft or suppressed records) or to cause errors. *(Typesense operator precedence was not tested; treat as exploitable until proven otherwise.)*
- **Scenario:** `GET /api/v1/discover/search?city=Pune%20||%20status:=DRAFT` yields `status:=PUBLISHED && city:=Pune || status:=DRAFT`.
- **Fix:** wrap every value in backticks and escape backticks, as Typesense documents (`city:=\`value\``); validate ids as UUIDs and enums with `@IsIn`; apply a hard-coded `status:=PUBLISHED` clause outside user-controlled text and parenthesise the user part; also whitelist `queryBy` and `sortBy` (currently they pass through if ever set from input). Add a test with filter metacharacters.

### H-2 · HIGH · Vulnerable dependencies (`npm audit`, production dependencies)
| Package | Severity | Advisory | Why it matters here |
|---|---|---|---|
| `proxy-addr` (via Express) | **Critical** | GHSA-jqcg-44mw-7w3h, IP spoofing via IPv4-mapped IPv6 trust subnet | `trust proxy` is on in production; spoofing defeats IP rate limits, IP blocks and lockouts keyed on `req.ip` |
| `shell-quote` | **Critical** | GHSA-pqg4-j6r4-53mv, `quote()` command injection | Reachability not established; likely a transitive tooling dependency. Confirm with `npm ls shell-quote` and remove it from the production image if it is not needed |
| `compression` | High | GHSA-vc2v-76pw-4v95, memory-leak DoS on premature close | Used in `main.ts` on every response; remote denial of service |
| `sharp` (web) | High | GHSA-wq5f-xc86-pv6w (librsvg) | Next.js image optimisation of untrusted images |
| `source-map-js` (web) | High | GHSA-68fv-2mgg-jv7q, event-loop DoS | Build-time mostly; low runtime exposure |
| `joi`, `@nestjs/swagger`, `js-yaml` | Moderate | prototype replacement via `__proto__` error codes; YAML merge-key CPU use | Env validation and docs only; low exposure |
- **Fix:** `npm audit fix` for each (the audit reports a fix for all of them); re-run the whole test suite; add `npm audit --omit=dev --audit-level=high` to CI; enable Dependabot or Renovate.
- **STATUS (7 Oct 2026, remediated, uncommitted):** `npm audit fix` applied to the API workspace and to the web app; a root override pins `shell-quote` to ^1.11.0 (installed 1.12.0). Result: **no critical or high findings remain in production dependencies** (`proxy-addr` 2.0.8, `compression` 1.8.2, `sharp` 0.35.5, `source-map-js` 1.2.2, Next.js 16.3.8). Verified: type-check, API build, 369/370 unit (the one failure is the stale test in I-3), 894 integration, 356/357 e2e (`health-probes`, flaky and unchanged from before), 9 security, 3 performance, 197 web tests.
- **Still open (accepted for now):** 2 moderate in production, `js-yaml` 5.3.0 via `@nestjs/swagger` 11.4.7, which pins it exactly (a root override had no effect, and `@nestjs/swagger` 12 needs NestJS 12); it affects the API docs page only, which is disabled in production. Dev-only: 5 high in the web app (`braces` via `eslint-config-next`; no patched `braces` release exists, and npm's suggested fix downgrades the Next.js ESLint config) and 24 moderate in root dev tooling. Re-check when upstream releases land; add Dependabot.

### H-3 · HIGH (architecture) · The web tier is a second backend with signing power and direct database access
- **Where:** `ownus/src/app/api/v1/[...path]/route.ts` (about 4,500 lines), `lib/gateway-auth.ts`, `lib/db.ts`.
- **What:** besides proxying, the Next.js route re-implements authentication (it signs and verifies JWTs with the same `JWT_ACCESS_SECRET` as the API), password reset, Google OAuth, admin OTP, wallet and credit unlock SQL, payments fallback, avatar upload, admin import and exports, all with a direct PostgreSQL connection (owner role unless `GATEWAY_DATABASE_URL` is set). A hand-maintained allow-list (`PUBLIC_NATIVE`, `ADMIN_PRE`, `USER_PRE`, fallback sets) decides which native routes are authenticated; anything not listed is "UPSTREAM" and relies on the handler or the API.
- **Impact:**
  - Two implementations of the same security logic must stay identical; a fix applied to the API (for example the privacy and consent features) does not protect the gateway's native paths. A route added to the handler but forgotten in the allow-list is unauthenticated by default.
  - Compromise of the web tier (an RCE in Next.js, a leaked server env var) yields the token-signing secret (forge any user or admin token) **and** database access, bypassing the API's guards, audit log and rate limits.
  - Deploying the gateway on a serverless platform multiplies the places the secret lives.
- **What I checked and found sound:** the gate runs before native handlers (`decideAccess`), tokens are verified with HS256 signature, `exp`, issuer, audience and purpose; the fallback phase re-applies the gate; native identity comes only from a verified token; SQL in the gateway is parameterised.
- **Fix:** make the NestJS API the only place that signs tokens and touches the database; reduce the gateway to a thin proxy. Short term: give the gateway its own least-privilege database role, split signing keys (gateway verify-only with an asymmetric key such as RS256/EdDSA), invert the allow-list to **deny by default** for native handlers, and add a test that enumerates every native `fullPath ===` branch and asserts it has a policy.

### M-1 · MEDIUM · Client IP spoofing through the gateway
- **Where:** `route.ts` (proxy section, around line 3790) copies the incoming `x-forwarded-for` (or `x-real-ip`) unchanged to the API; `main.ts` trusts exactly one proxy hop in production; `modules/traffic/client-ip.ts`.
- **Impact:** if the Next.js server is reachable directly (self-hosted, no CDN that overwrites the header), a client can choose its own IP and evade per-IP rate limits, IP blocks and sign-in throttling. Combined with H-2 (`proxy-addr`) the risk is higher. Platforms such as Vercel overwrite the header, which reduces but does not remove the need to verify the topology. *(Deployment-dependent; not tested.)*
- **Fix:** have the edge set a trusted header the app reads (`TRAFFIC_TRUSTED_IP_HEADER`, already supported) and strip client-supplied `x-forwarded-for` at the gateway; make the API reachable only from the gateway (network rule or shared secret header); upgrade `proxy-addr`.

### M-2 · MEDIUM · Administrator login relies on a single factor (an e-mailed code) and a company-domain check
- **Where:** `auth/admin-auth.controller.ts`, gateway `handleAdminSendOtp` / `handleAdminVerifyOtp`.
- **What:** admin access needs a 6-digit code sent to an `@monarchsoftwares.com` mailbox for an existing ADMIN or SUPER_ADMIN account; no password and no authenticator. The code is stored as an HMAC, compared in constant time, limited to 5 attempts and 5 minutes (good). Anyone who controls the mailbox (phishing, mail forwarding rule, shared mailbox) becomes an administrator.
- **Fix:** require a second factor for admins (TOTP or WebAuthn, the user-level TOTP already exists), shorten admin session lifetime, restrict admin routes by IP or VPN, alert on every admin login (an e-mail to the account and a security channel).

- **Update (admin console check, 7 Oct 2026):** the administrator token issued after the e-mailed code is valid for **7 days** (`exp - iat = 10080` minutes) with no refresh or server-side revocation beyond the account status check. Shorten it (for example 1 hour with re-verification) and add a way to end all admin sessions.

### M-3 · MEDIUM · Access tokens in `localStorage` with a permissive Content-Security-Policy
- **Where:** `lib/api-client.ts` (`orion_access_token`, `orion_refresh_token`), `app/admin/monarch/page.tsx` (`orion_admin_token`); `next.config.ts` CSP has `script-src 'self' 'unsafe-inline'` and `connect-src 'self' https: …`.
- **Impact:** any XSS (a vulnerable dependency, a future `dangerouslySetInnerHTML`) can read the tokens and send them to any HTTPS host; `unsafe-inline` removes CSP's main protection. I found no current XSS sink (the only `dangerouslySetInnerHTML` is a static theme script in `layout.tsx`), so this is defence in depth, not an exploit today.
- **Fix:** keep refresh tokens in an `HttpOnly; Secure; SameSite=Strict` cookie; use a nonce-based CSP (the code comment already lists it as a follow-up); restrict `connect-src` to the API origin.

### M-4 · MEDIUM · Avatar upload is unvalidated in the NestJS API
- **Where:** `modules/user/user.service.ts:126-142`, `UploadAvatarDto` (`image: string` only). The gateway validates avatars (`validateAvatar`, S-16) but the API does not.
- **Impact:** a client calling the API directly can store an arbitrary string (any URL, a `javascript:` or `data:` URI, a large blob up to the body limit) in `avatar_url` and `profile_picture`, which the UI renders; tracking pixels or oversize rows. It is returned to the same user only, so cross-user impact is low unless an admin screen shows other users' avatars.
- **Fix:** apply the same validation in the API (allow only `data:image/(png|jpeg|webp);base64,` under a size cap, or an https URL on your storage host); better, upload to object storage and store a key.

### M-5 · MEDIUM · Container and build hardening
- **Where:** `apps/api/Dockerfile`, `ownus/Dockerfile`, `docker-compose.yml`.
- **What:** images run as **root** (no `USER`); `npm install` instead of `npm ci` (no lockfile enforcement); base `node:20-alpine` (**Node 20 reached end of life in April 2026**, so it no longer gets security fixes); no `HEALTHCHECK`; MinIO is `:latest` with a fixed root user `minioadmin`; the web build copies `ownus/` wholesale (confirm `.dockerignore` excludes `.env*`, `scratch*`, `node_modules`).
- **Fix:** move to the current LTS (Node 22 or 24) pinned by digest, `npm ci --omit=dev`, `USER node`, read-only root filesystem where possible, a `.dockerignore`, pinned image versions, add Trivy or Grype image scanning in CI.

### M-6 · MEDIUM · Account enumeration and timing differences at sign-in
- **Where:** `auth/services/auth.service.ts:212-263`.
- **What:** a suspended or inactive account gets a distinct `ACCOUNT_INACTIVE` answer **before** the password is checked, and a social-login-only account gets `OAUTH_ACCOUNT_NO_PASSWORD` before the password check. Both reveal that the e-mail is registered (and its status) to anyone. An unknown e-mail also returns faster than a wrong password (no bcrypt comparison), which allows timing discovery. Sign-in lockout by e-mail is in place.
- **Fix:** check the password first (or run a dummy bcrypt compare for unknown users); return the same generic message for all failures; show the "use Google" hint only after a verified e-mail ownership step.

### M-7 · MEDIUM · Account deletion does not re-authenticate users without a password
- **Where:** `modules/privacy/privacy.service.ts` (`requestDeletion`), added in this project.
- **What:** for accounts that sign in with Google/Microsoft there is no password, so a stolen access token plus the typed e-mail is enough to schedule deletion. Mitigations: a 7-day cooling-off period, a confirmation e-mail, and cancellation.
- **Fix:** for social-login accounts require a fresh login (recent `auth_time` claim) or an e-mailed confirmation link before the request is accepted; also e-mail on cancellation and on execution.

### L-1 · LOW · Weak password policy
`auth.dto.ts`: minimum 8 characters, no maximum, no breached-password check. bcrypt only uses the first 72 bytes, so a very long password is silently truncated. Set min 12, max 128, reject common/breached passwords (zxcvbn or the HIBP range API).

### L-2 · LOW · TOTP replay guard is a read-modify-write
`checkTotp` stores `mfaLastStep` inside `users.metadata` after reading it; two concurrent requests with the same code can both pass, and the whole `metadata` object is rewritten (a stale copy can overwrite `activeSessionId`). Use an atomic `UPDATE … WHERE mfa_last_step < $step` on a dedicated column.

### L-3 · LOW · Malformed CSP in the API's Helmet configuration
`main.ts` sets `scriptSrc: ["'self'", "https: 'unsafe-inline'"]`, a single malformed token that browsers may ignore or interpret loosely. The API serves JSON (and Swagger only outside production), so impact is minimal; fix the directive.

### L-4 · LOW · Insecure fallback when `NODE_ENV` is not `production`
Swagger is exposed, trust proxy is off, and the process binds to loopback for any value other than `production` (including unset or `provision`). A production deployment with the variable missing would expose the full API schema and break IP handling. Fail closed: require `NODE_ENV` and refuse to start when `DATABASE_URL` points to a remote host and `NODE_ENV` is not `production`.

### L-5 · LOW · Secrets policy is lenient
JWT secrets only need 16 characters, with no entropy check; HS256 with one shared secret across API and gateway (see H-3). Require 32+ random bytes (base64), reject known placeholders, and plan key rotation (support a `kid` and two active keys).

### L-6 · LOW · CORS origin list not validated
`CORS_ORIGINS` is split on commas and used with `credentials: true`. A `*` or a malformed entry would not be rejected at startup. Validate each entry as an `https://` origin in production.

### L-7 · LOW · Operational leaks and noise
`admin-auth.controller.ts` logs with `console.error` (bypasses the structured, scrubbing logger); the admin OTP endpoint answers 403 with a message for non-company domains but 200 for non-admin company addresses (domain enumeration, minor); the backup script (`ops/backup`) takes the database URL as an argument to `pg_dump`/`psql`, which can show the password in the process list. Use the structured logger, and `PGPASSWORD`/`.pgpass` or `--dbname` from the environment.

### L-8 · LOW · Missing request-size and schema constraints on some inputs
Default JSON limit is used for most routes; several DTOs accept unbounded strings (for example saved-search filters). Set per-field `@MaxLength` and a global body limit, and keep the admin upload limits as they are.

### I-1 · INFO · Things done well (keep and test)
Default-deny JWT guard with explicit `@Public()`; role guard; user status re-checked on every request; refresh-token rotation with family revocation; admin OTP stored as HMAC with attempt limits; constant-time comparisons; parameterised SQL (the few `sql.raw` uses take only code-defined aliases); SSRF-safe HTTP client for webhooks; CSV parser with row and column caps and formula-injection neutralisation; payment webhook signature over the raw body with replay protection; contact data masked until unlocked; Prometheus metrics need a token; helmet and Next.js security headers (HSTS, frame denial, nosniff); reset links built only from configured URLs; per-plan rate limits and IP blocking; integration secrets encrypted at rest.

### I-2 · INFO · API keys are issued but not enforced
`x-api-key` is an allowed CORS header and keys are created and stored (hashed), but no guard authenticates requests with them, and the Settings → API tab shows a hard-coded demo key and usage. Either implement key authentication (with scopes and rate limits) or hide the feature, so customers do not assume it works.

### I-3 · INFO · A stale unit test
`config-hardening.spec.ts` ("admin OTP fixed code") fails because it expects an older code pattern; the controller is now stricter (`NODE_ENV === 'test'` and a local database). Update the test to the current rule; it is not a vulnerability.

### I-4 · INFO · Duplicate admin OTP implementations
The NestJS admin controller generates and stores a code but never delivers it (no mail call); the gateway handler sends it by e-mail. Whichever route is live decides behaviour. Remove the unused path to avoid drift (see H-3).

### I-5 · INFO · Privacy features added in this project
Consent, export and deletion are authenticated, rate limited and covered by tests. Limits: export is rate limited per IP rather than per user; third-party erasure and backup ageing are process items (see `docs/PRIVACY_COMPLIANCE.md`).

## 4. Remediation plan

| Order | Action | Findings | Effort |
|---|---|---|---|
| **Today** | Rotate the exposed database credential and any other that appeared in git; review Neon access logs | C-1 | hours |
| This week | Commit the cleanup, purge history, enable secret scanning (working tree **and** history) | C-1 | 1 day |
| This week | `npm audit fix`, retest, add audit to CI; check `shell-quote` reachability | H-2 | 1 day |
| This week | Escape and validate Typesense filters if Typesense is or will be used; add tests | H-1 | half a day |
| 2 weeks | Least-privilege database roles; gateway verify-only keys; deny-by-default native routes; plan to remove native logic from the gateway | H-3, L-5 | 1-3 weeks |
| 2 weeks | Trusted client-IP header and API reachable only through the gateway | M-1 | 1-2 days |
| 2 weeks | Admin second factor and admin login alerts | M-2 | 2 days |
| 1 month | HttpOnly refresh cookie, nonce CSP | M-3 | 3-5 days |
| 1 month | Avatar validation in API; uniform sign-in errors; deletion re-auth; Docker hardening and Node LTS | M-4 to M-7 | 3-4 days |
| Backlog | L-1 to L-8, I-2 to I-4 | | |
| After fixes | Independent penetration test of the deployed staging environment (auth, admin, import, payments, gateway) | all | 1-2 weeks |

## 5. Verification checklist after fixes
- [ ] Old database password no longer connects; new role privileges tested.
- [ ] `git log -S` and gitleaks over full history return nothing.
- [ ] `npm audit --omit=dev --audit-level=high` is clean in both apps.
- [ ] A test sends filter metacharacters to `/discover/search` with Typesense enabled and gets no extra records.
- [ ] A request with a forged `X-Forwarded-For` does not change the rate-limit identity.
- [ ] Every native gateway route has an explicit policy (automated test).
- [ ] Admin sign-in requires a second factor.
- [ ] Containers run as non-root on a supported Node release.
