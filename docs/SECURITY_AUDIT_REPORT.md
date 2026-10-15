# Orion security audit report (Step 1, audit only)

**Date:** 2026-10-09 · **Status:** PARTIAL (static review and read-only checks; no deployed environment, no signed-in live testing). No application code, schema, configuration or dependency was changed by this phase. Finding ids (SG-nn) refer to `SECURITY_GAP_REPORT.md`, which holds the severity, evidence and fix for each.

Labels: **CONFIRMED** (seen in code or in a read-only run), **POTENTIAL** (needs a condition I could not verify), **UNVERIFIED** (exists but not tested end to end).

## 1. Architecture as found

| Area | What the repository contains |
|---|---|
| Frontend | Next.js 16 / React 19 app in `ownus/` (route groups `(marketing)`, `(auth)`, `(app)`, `admin`); Tailwind, Radix UI. `apps/web` is an empty stub. |
| Backend | NestJS 11 API in `apps/api` (about 200 routes in 25 modules), Drizzle ORM, PostgreSQL, optional Typesense, Redis (queue and rate state), S3-compatible storage (MinIO or R2). |
| Web gateway | `ownus/src/app/api/v1/[...path]/route.ts`: proxies to the API **and** re-implements many routes natively with a direct database connection and the token secrets (SG-06). |
| Authentication | Customer: e-mail and password (bcrypt 12), Google and Microsoft OAuth, optional TOTP; 15-minute access tokens, 7-day rotating refresh tokens with family revocation; single-device session id in `users.metadata`. Admin: e-mailed 6-digit code to a company-domain address. |
| Authorization | Global `JwtAuthGuard` (default deny, `@Public()` opt-out) then `RolesGuard` (persisted role and status). Roles: USER, DATA_MANAGER, ADMIN, SUPER_ADMIN. Customer isolation is per user id; `users.organization_id` exists but there is no tenant model. |
| Data | Drizzle migrations `0000` to `0010+`; companies (`businesses` and detail tables), legacy `business_contacts`, the People model (`people`, `person_contacts`, evidence, verification, observations, suppressions, quarantine), credits (`user_wallets`, `credit_transactions`), `lead_unlocks`, billing, exports, privacy (`consent_records`, `privacy_requests`), `audit_logs`. |
| Ingestion | Admin CSV or JSON, parse and validate, normalise, duplicate detection, then (today) automatic publication; People stage after publication through `ImportPeopleBridge`; separate People import and bundle import. |
| Discovery | Public search and company profile with masked contacts; Postgres search by default, Typesense optional. |
| Credits and unlock | Daily free credits plus purchased credits; unlock spends one credit; People unlock separate. |
| Exports | CSV or XLSX of unlocked leads, unlocked people and saved leads; scheduled exports. |
| Payments | Razorpay orders, signature verification, webhook, invoices; local simulation unless `RAZORPAY_API_MODE=live`. |
| Privacy features | Consent ledger, data export, deletion with 7-day delay, retention scheduler, privacy request tracking. |
| Operations | Structured and scrubbed logging, request ids, Prometheus metrics, health probes, rate limiting and IP rules (`modules/traffic`), backups scripts in `ops/`. |
| Tests | 60 API spec files, 23 API e2e suites (in-memory PGlite), 22 web test files, 10 Playwright groups in `tests/`; CI in `.github/workflows/test.yml`. |
| Deployment | Dockerfiles for API and web, `docker-compose.yml` (Postgres, Typesense, MinIO), a `.vercel` folder (serverless entry in `main.ts`). |

## 2. Authentication audit

| Check | Result | Evidence |
|---|---|---|
| Password hashing | bcrypt cost 12. CONFIRMED sound. | `password.service.ts` |
| Password policy | Minimum 8, no maximum, no breached-password check. SG-25. | `auth.dto.ts` (carried forward) |
| JWT validation | Signature, expiry, issuer, audience, token type, persisted status. CONFIRMED sound. | `jwt.strategy.ts` |
| JWT secrets | Required and at least 16 characters; production refuses short or placeholder values. Entropy not checked. | `config/secrets.ts` |
| Token lifetimes | Access 15 minutes, refresh 7 days. Admin token through the gateway 7 days (SG-07). | `auth-token.service.ts`, `route.ts:638` |
| Refresh tokens | Rotation with family revocation on reuse. CONFIRMED present; not re-tested live. | `auth.service.ts:350` |
| Single-device enforcement | Session id compared only when the token carries one. Tokens without it skip the check. UNVERIFIED for the gateway-issued tokens. | `jwt.strategy.ts:44-56` |
| Logout and invalidation | Session id rotation invalidates all access tokens; refresh revoked. CONFIRMED present. | `auth.service.ts:174-179,431` |
| Login rate limiting and lockout | Throttle 10 per minute on login, lockout by e-mail and IP. CONFIRMED present. | `auth.controller.ts`, `auth.service.ts:214` |
| Account enumeration | Differences before the password check; registration 409. SG-10. | `auth.service.ts:214-244` |
| Password reset | Token hashed, single use, 15 minutes, sessions revoked, owner notified; same answer for unknown e-mails. CONFIRMED sound. | `auth.service.ts:458-501` |
| E-mail verification | Supported but off by default in the production example. SG-11, SG-03. | `auth.service.ts:25,93` |
| OAuth | Simulation path live, link without verified e-mail, tokens in redirect URL, in-memory state. SG-01, SG-03, SG-08, SG-23. | `modules/oauth/*` |
| Admin sign-in | Single factor, HMAC-stored code, 5 attempts, 5 minutes; gateway 7-day token. SG-07. | `admin-auth.controller.ts`, gateway |
| Cookies and CSRF | Gateway sets HttpOnly cookies for OAuth state and the admin token; requests authenticate by `Authorization` header, so CSRF does not apply to API calls. Customer tokens are in `localStorage` (SG-08). | `route.ts:154,633,2458`, `api-client.ts` |
| Sensitive responses | Refresh and access tokens are returned in bodies (normal) and in OAuth redirect URLs (SG-08). | `oauth.controller.ts` |

## 3. Authorization and IDOR/BOLA audit

Method: for every controller I listed the guard decorators (`@Public`, `@UseGuards`, `@Roles`), then read the service methods for saved leads, saved searches, integrations, exports, unlock, user, settings, credit, payment and privacy to see how the resource is selected.

- **Server-side enforcement:** CONFIRMED. The global `JwtAuthGuard` plus `RolesGuard` apply to all routes; public routes are explicit. Public routes found: health, discovery search and filters, company profile and related companies, credit packages and config, OAuth, auth, admin send-OTP and verify-OTP, the admin import template, payment webhook, integration callback, metrics (token-protected).
- **Role separation:** all admin controllers carry `@Roles(SUPER_ADMIN, ADMIN)` (People review also admits DATA_MANAGER). The role guard reads the persisted role. CONFIRMED.
- **Object ownership:** saved leads (`updateSavedLead`, `removeLead`), saved searches (`findById`), integrations (`getOwned`), exports (`download`, schedules) and unlock history all scope to the caller's id. CONFIRMED by reading. No IDOR was found in the API. The e2e suite includes cross-user cases (`access-model`, `admin-authorization`, `saved-leads-searches`); I did not read each assertion.
- **Weak spots:** SG-21 (update by id without owner in the WHERE), SG-20 (unbounded `limit`).
- **Mass assignment:** global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`. The profile DTO does not expose role, status or credits. POTENTIAL residual: `users.metadata` is merged by the profile update; the DTO whitelist prevents arbitrary keys but I did not test `activeSessionId` injection.
- **Tenant boundaries:** per user only. There is no organisation model despite `organization_id` (see `PRIVACY_AUDIT_REPORT.md` section 9).
- **Privilege escalation through OAuth:** SG-01 and SG-03 bypass the above because they grant a session as the victim.
- **Gateway:** the gateway applies its own route policy table (`gateway-auth.ts`); routes absent from the table are `UPSTREAM` and are only as protected as the API. A native branch added without a table entry is unauthenticated at the gateway (SG-06).

## 4. Credits, billing and export audit

| Question | Finding |
|---|---|
| Atomic deduction | CONFIRMED. `FOR UPDATE` on the wallet row inside a transaction; unlock also takes a per-pair advisory lock and a unique index. |
| Duplicate unlocks | CONFIRMED handled (lock, in-transaction re-check, unique-violation fallback returns "already unlocked", no charge). |
| Client-controlled balance | None found; balance is only changed by `deductCredits`, `addCredits`, `adjustUserCredits` and daily allocation. |
| Daily rollover | Done inside the deduction transaction. The gateway fallback unlock SQL has no rollover but is only used when the API is down. |
| Refunds and reversals | `adjustUserCredits` writes the applied delta to the ledger. Refund flow through the provider **not reviewed** (UNVERIFIED). |
| Admin credit changes | One ADMIN can add up to 1,000,000 per call; ledger row records admin id and reason. SG-22. |
| Payment verification | HMAC of `order|payment` with the key secret (timing-safe), order bound to user, package, amount and cycle, provider capture check in live mode, idempotency per payment id. CONFIRMED. In non-live mode no real money moves and the secret is server-side, so a client cannot forge a signature. Production must set `RAZORPAY_API_MODE=live` (UNVERIFIED). |
| Webhook | Signature over the raw body, parsed only after it verifies, amount checked against the stored order, idempotent. CONFIRMED. No timestamp window, but replays are harmless because of idempotency. |
| Export authentication and ownership | CONFIRMED in the API (owner only, history and download scoped by user). |
| Export limits | 5,000 rows, `truncated` flag, 10 per minute, 30 downloads per minute; 10 schedules per user. CONFIRMED. Gateway native export has no cap (SG-13). |
| Fields in exports | Company contacts for unlocked businesses; People export includes only unlocked, published contacts. Unpublished and suppressed company contacts are not filtered (SG-13, SG-05). |
| Audit trail | Credits ledger, unlocks (`BUSINESS_UNLOCKED`), exports (`EXPORT_*`), schedules. Gateway export none. |
| Race conditions | None found in unlock, deduction or payment crediting. Scheduler and daily reset use the same transaction. |

## 5. API and input validation

- **SQL injection:** API uses Drizzle parameters; the few raw fragments take code-defined values. Gateway SQL is parameterised; its `ORDER BY` comes from a fixed mapping (`route.ts:2826-2845`). No injection found. The exception is **Typesense filters** (SG-09).
- **XSS:** no `dangerouslySetInnerHTML` apart from a static theme script (carried forward; the grep was not repeated). CSV output goes through a formula guard (`csv-security`, `CsvSecurityUtil`). CSP still allows inline scripts (SG-08, SG-19).
- **Command injection and path traversal:** the gateway rejects `..` and separators in path segments; import file names are sanitised (`admin-import.service.ts:410-414`). No shell execution found in the API.
- **SSRF:** webhooks use `safe-http.ts` (see section 3 of the gap report, existing controls). Other outbound calls go to fixed hosts (Razorpay, Google, Microsoft, HubSpot, mail provider). No user-supplied URL is fetched elsewhere. CONFIRMED.
- **Prototype pollution:** `forbidNonWhitelisted` DTOs; the CSV parser has row and column caps (carried forward). Not tested.
- **Pagination and sorting:** most DTOs bound `limit` at 100 or 200; `unlock/history` does not (SG-20); sort fields are mapped, not interpolated.
- **File upload:** admin only; size and shape limits in `upload-validation.ts` and `upload-body-limit.ts`. Avatar strings unvalidated in the API (SG-24).
- **Webhook payloads:** raw-body signature first. CONFIRMED.
- **Error exposure:** generic messages in production, details only in development and test. CONFIRMED.
- **Rate limiting:** global throttler plus per-route limits and the traffic module (IP rules, per-plan limits, lockout). Public discovery search is limited by the global limit only; scraping resistance beyond that is UNVERIFIED.
- **Security headers:** API Helmet with a malformed `scriptSrc` (SG-19); web CSP, HSTS (production only), frame denial, nosniff, referrer policy. CONFIRMED.

## 6. Secrets and configuration

- **Committed credentials:** SG-02 (type and location only).
- **`.gitignore`:** ignores `.env`, `**/.env`, `.env*.local`; `.env.production.example` and `apps/api/.env.example` are tracked (contain placeholders; one line carries a live-key prefix, to be confirmed as a placeholder).
- **Local environment files (names only):** the API `.env` holds database, Redis, Typesense, JWT, storage, OAuth and mail settings; `ownus/.env.local` holds JWT secrets, a database URL, Google client id and mail key (the gateway holds signing power, SG-06); the repository root `.env.local` holds a mail key and a hosting OIDC token. All three are untracked and ignored.
- **Frontend exposure:** only `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` are read in client code. CONFIRMED no server secret is exposed through `NEXT_PUBLIC_`.
- **Validation:** `config/env.validation.ts` and `secrets.ts` enforce presence and length in production and refuse development defaults. Entropy not checked (carried forward L-5).
- **Logging of secrets:** logs are scrubbed; the OAuth simulation code is logged (SG-23).
- **Docker and compose:** `USER node` present; Node 20; `npm install`; fixed MinIO root user in compose (SG-18).

## 7. Logging, audit and abuse prevention

- `audit_logs` records logins, unlocks, exports, imports, credit adjustments, privacy requests, admin business actions. Retention blanks IP and user agent after 180 days (`DATA_RETENTION_POLICY.md`).
- Gateway admin actions are audited only for import (earlier), business delete and status update; admin user and transaction listing are not audited (SG-15).
- Abuse prevention: IP blocklists, per-plan limits, lockout, request ids, scanner user-agent blocking (`traffic.middleware.ts`), optional CAPTCHA service (use on registration UNVERIFIED).

## 8. Data pipeline trace (import to customer)

1. Admin uploads CSV or JSON (`admin/import/csv/submit` or `submit`); size and shape limits.
2. Batch and one `import_records` row per input row are stored (I fixed the gateway path earlier so this is also true for local uploads).
3. Normalise, validate, detect duplicates (intra-file and against existing businesses).
4. Valid and not duplicate: **auto-approve and publish** (SG-04). Duplicates go to a review queue. Invalid rows are stored as `FAILED` with reasons.
5. After publication the People stage runs for rows with `person_*` columns through the source registry, with suppression, quarantine and review (strong).
6. Search index sync job is enqueued.

Paths that bypass controls: (a) any valid row skips moderation (SG-04); (b) company contact columns skip the People model's suppression and classification (SG-05); (c) the gateway's old native submit wrote directly to `businesses` and set contacts verified; it was replaced earlier in this session by a forward to the API, but the same direct-SQL pattern remains in the native admin delete and export (SG-06, SG-13); (d) re-import behaviour for a suppressed company contact: no suppression exists to enforce.

## 9. Positive findings worth keeping under test

Default-deny guards, persisted role checks, atomic credit and payment code, the SSRF client, People suppression, scrubbed logging, production secret checks, per-route throttles, owner-only exports with audit.
