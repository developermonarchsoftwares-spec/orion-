# API contract integrity, error handling and backward compatibility review (Phase 28)

Date: 2026-10-13. Scope: the NestJS API (`apps/api`), the Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`, which answers the browser's `/api/v1/*` calls with its own handlers and proxies the rest to the API), and the browser's API client (`ownus/src/lib/api-client.ts`). Tests used in-memory PostgreSQL, a disposable local database (`orion_scratch_phase28_gw`) and a built gateway server on a local port with generated test secrets and no upstream API. No production data, no deployment, no commit, no push, no credential printed. No framework was introduced, no request format that a current consumer sends was changed.

## 1. Endpoint inventory and contract scope

The route-by-route authentication, role, throttle and ownership table already exists and is kept current: `AUTHORIZATION_ROUTE_INVENTORY.md` (Phases 7, 25: 83 role-restricted API routes, public routes with their own credential checks, gateway-native routes). This review adds the parts that file does not hold. Nothing below is a contract that the code does not show.

**Two services answer `/api/v1/*`.**
- The browser calls the gateway. For the routes it implements natively (58 path literals and four prefixes: authentication and sessions, profile and settings, discover search/filter options/export, administrator OTP sign-in, import preview/submit/batches, health) it answers itself, from the database. For everything else it forwards to the NestJS API. When the API is unreachable a small set of *fallback* handlers answers (wallet, transactions, unlock, saved items, payments, dashboard); payments and credit-spending fail closed.
- The API is the system of record for credits, unlocks, payments, exports, integrations, privacy and People. 210 method/path pairs were read from the running application.

**Envelope (API).** Success: `{ success: true, statusCode, message, data, timestamp }`; a list adds `pagination: { page, limit, totalItems, totalPages }` and `data` is the item array (`TransformInterceptor`). Error: `{ success: false, statusCode, errorCode, message, details?, path, method, requestId, timestamp }` (`AllExceptionsFilter`); `path` never carries the query string; outside development/test a 5xx has a fixed message. The gateway's native answers use the same outer keys; its list answers use `data: { items, total, page, limit }` (see section 6).

**Request validation.** One global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`): an unknown property is a 400, a wrong type is a 400. Identifiers in paths are validated with `ParseUUIDPipe` on 54 parameters and by hand elsewhere (`malformed-ids.e2e-spec.ts`).

**Workflow contracts and where they are tested**

| Workflow | Key routes | Auth / ownership | Tests |
|---|---|---|---|
| Authentication and sessions | `POST auth/register, login, refresh, logout, forgot/reset-password, verify-email, link/unlink-provider, oauth/token`; `admin/auth/send-otp, verify-otp` | public with throttles; logout and linking need a session; admin session is revocable | `auth*.e2e`, `admin-session.e2e`, `oauth.e2e`, this phase's sweep |
| Customer and admin account | `GET auth/me`, `user/*`, `settings/*`, `admin/users` | caller's own record; admin roles for `admin/*` | `account-integrity`, `privileged-operations`, `database-security` |
| Discovery and filtering | `GET discover/search, businesses/:slug, suggestions, filter-options` | search is public-masked; contacts appear only after unlock | `lead-discovery-unlock`, `discover-hardening`, `database-security` (hostile input, paging) |
| Unlock and credits | `POST unlock/business`, `GET unlock/history, status/:id`, `GET credit/wallet, transactions`, `POST credit/admin/adjust` | owner only; one charge per (customer, company) | `financial-integrity`, `pg-concurrency` (real server), `api-contract` (repeat unlock) |
| Exports | `POST export`, `GET export/history, :id/download`, schedules | owner only; stored exports re-filtered at download | `export-security`, `scheduled-export-*` |
| Import, validation, duplicates, publication | `admin/import/*`, People bundle/export-import | admin roles; approved sources only | `admin-import-pipeline`, `admin-people-import`, `provenance-publishing` |
| Privacy and suppression | `privacy/*`, People suppression | owner; admin for decisions | `privacy-classification`, `people-suppression` |
| Subscription and invoices | `billing/*`, `payments/*` | owner only; webhooks signature-verified | `billing`, `financial-integrity` |
| Health and operations | `health/*`, `monitoring/*` | health public (no secrets); monitoring admin | `health*`, `monitoring` |

Compatibility consideration for every row: the consumers are the browser pages through `api-client.ts`, the gateway's own handlers, integrations that call the API with API keys, and background jobs that call services directly. No public route, method, success shape or status code was removed or renamed in this phase; the changes are listed in section 3 and each is a case that previously ended in a 500, a false success, or an unvalidated body.

## 2. Validation findings

A route list read from the running application was exercised as a customer and as a super administrator with 9 body payloads (empty object, array, string, wrong types, prototype pollution, protected fields, 60-level nesting, 60,000-character strings, control characters) on write routes and 5 query shapes on read routes: several thousand requests, asserting no 5xx and no stack, SQL, path, hash or connection text in any body.

| # | Finding | Fix |
|---|---|---|
| V-1 | **Five API bodies were inline types, which the pipe cannot validate.** A number or object where text was expected produced a 500: `admin/auth/send-otp`, `admin/auth/verify-otp` (wrong types), `auth/link-provider`, `auth/unlink-provider` (any body without a valid `provider`). `auth/oauth/token`, `auth/logout` and `credit/admin/config` had the same shape without a crash. | DTO classes: `AdminSendOtpDto`, `AdminVerifyOtpDto`, `LogoutDto`, `OAuthProviderDto`, `OAuthTokenDto`, `UpdatePricingSettingDto`. Fields stay optional where the handler already gives its own "please provide ..." answer, so those messages are unchanged. Sweep: 0 server errors after (2 as a customer and 10 as an administrator before). |
| V-2 | **Four administrator import routes still take inline types** (`preview`, `submit`, `csv/preview`, `csv/submit`); they validate by hand and survived the sweep. | Not changed (the CSV/JSON formats are consumed by the admin console). A test lists them as the only allowed exceptions: a new unvalidated body fails the test. R-058. |
| V-3 | **Gateway: a JSON body of `null`, a number or a string crashed 13 handlers** (`user/profile`, `user/avatar`, `settings`, `settings/company`, `auth/me`, `unlock/business` fallback ...) with a body-less 500. | One `readJson` reader; non-object JSON becomes `{}`, so the handler's own "required" answer applies. Malformed JSON still throws and is answered 400. |
| V-4 | **Gateway: `auth/register` crashed when `name` was not text.** | Text check before `split`. |
| V-5 | Paging (from Phase 27): non-integer and huge `page`/`limit`; bulk lists capped at 100. | Done in Phase 27. |
| V-6 | Protected values: registration cannot set role or status; profile/settings updates cannot set role, status, e-mail verification or balance; a customer cannot set price, credit amount, publication state or ownership through any customer route (tested with a draft company: it stays a draft, the wallet is unchanged). | Verified working; tests added. |

## 3. Response contract and data minimisation

- 15 customer responses were scanned for credential-like property names in Phase 27 (none); the sweep this phase additionally scans every response body, for every route, for stack traces, SQL, file paths, hash names and connection strings: none.
- Contact data follows the unlock rules (`presentCompanyContact`, People customer contract); suppressed, unpublished and withdrawn records stay out of search, saved-lead summaries, exports and history (existing suites, unchanged and passing).
- **Changed behaviours (each previously wrong; none removes a field a consumer reads):**
  1. `POST saved-leads` for an unknown or unpublished company: 404 (was 500, or it saved a draft; Phase 27).
  2. Gateway write refusals: a value the database rejects (too long, NUL byte, bad format) is a **400** `INVALID_VALUE`, a duplicate is **409**, anything else **503** `SAVE_FAILED`; before, the gateway answered **200 "Profile updated successfully"** (or **201 registered, with tokens**) while nothing was stored, because its database helper turned every failure into an empty result. Consumers that checked only `success` now see `false` when the save failed.
  3. Gateway offline stand-ins for `saved-leads` and `saved-searches` answered any method, including POST, PUT and DELETE, with an empty successful list. A write is now **503** `TEMPORARILY_UNAVAILABLE` while the API is unreachable; reads are unchanged. The browser shows its existing error toast for a 503.
  4. Gateway offline `unlock/status/:id` always answered "not unlocked" because its query compared a uuid with text and failed silently; fixed.
- Divergence kept, documented: the gateway's offline list shape (`data: { items, total, page, limit }`) differs from the API's (`data: [...]`, `pagination`). The discover page reads both (`res.total` or `res.data.total`); the saved-lead and wallet pages were not re-checked against the offline shape (R-059).

## 4. Error handling

- 4xx versus 5xx are distinguishable; validation failures return the offending property names (useful, not sensitive); unexpected errors are generic outside development and test (`all-exceptions.filter.spec.ts`); a malformed JSON body is a 400 with a fixed message, an unsupported content type is a 4xx, a 413 is "request body is too large".
- Logs keep diagnostic value without values: Phase 27 removed bound statement values and query strings from API logs. This phase did the same for the gateway: its database helper logged the whole driver error, whose `detail` holds the offending row values (observed in this phase's own run: e-mail addresses). It now logs code, table, column, constraint and routine.
- **Gateway swallowed every database error** (`queryDb` returns `[]`). Customer-facing writes now use `queryDbStrict`, which throws a `DbWriteError` that carries only the server error code: registration, password reset, password change, profile, avatar, company details, notification and preference settings. The registration handler's own `catch` was dead code before and now runs. All other call sites keep the old behaviour deliberately (reads and bookkeeping where "no row" is the right fallback, 76 call sites; changing them is out of scope). R-060.
- **Gateway handlers could throw to Next's default, a body-less 500.** All five method exports now pass through one guard that answers JSON 500 `INTERNAL_ERROR` with a fixed message and logs only the error's class name.
- Authorization failures: 401 or 403 with a fixed message, no record details; cross-customer lookups answer 404 (Phase 27 tests).
- No handler was changed to hide an error behind a success response. The one that did so before (offline writes, section 3) was fixed.

## 5. HTTP semantics and idempotency

- **GET never changes business data:** every GET route (read from the application, called as a fresh customer and as an administrator) was compared by row counts of wallets, ledger, unlocks, saved leads, saved searches and export jobs before and after: 0 changes. (Audit rows for reads are allowed.)
- **Repeated sensitive requests:** four sequential unlocks of one company charge once and answer 200 each time with `alreadyUnlocked` after the first; parallel versions on a real server are in `pg-concurrency` (12 parallel unlocks, payments, webhooks, refunds). No client-supplied idempotency key exists or is needed: protection is by natural key (customer + company, payment id, refund payment id), with a lock and a unique index. R-061 notes that a client retry after a timeout sees `alreadyUnlocked: true` rather than the original `creditsSpent`.
- **Methods:** create answers 201 where the framework default applies and 200 where `@HttpCode(200)` is declared (login, unlock); this is existing behaviour consumers depend on and was not changed. Every privileged path rejects every method for anonymous and customer callers (Phase 25).
- **Caching:** the security middleware sets `Cache-Control: no-store` on any request carrying credentials (proved in `security-headers.e2e-spec.ts`; the contract test harness does not mount that middleware, so it is not repeated there). The gateway's native handlers answer authenticated requests with `no-store, no-cache, must-revalidate, private` (checked over HTTP for six routes: all present).
- **Rate limiting** stays effective across methods and alternate paths (Phase 13, traffic-control suite); the sweep triggered the limiter 302 times on the gateway (HTTP 429) without any 5xx.

## 6. Frontend compatibility

- **Gateway, over HTTP** (built `next start`, disposable database, generated secrets, upstream unreachable): 10,140 hostile requests (58 route literals plus extra shapes, as anonymous, customer and administrator, all methods, 11 body payloads and 8 query shapes). Before the fixes: **54 server errors** and the false successes described above. After: **0 server errors**, 0 internal details in any body. Statuses after: 200 ×3,422; 400 ×1,447; 401 ×2,149; 403 ×659; 405 ×231; 429 ×302; 503 ×1,930 (the proxied routes with no upstream, the intended fail-closed answer).
- **Normal flows still work** (same server): register → 201, profile update → 200 and stored, company details → 200, change password → 200, login with the new password → 200.
- **Client:** `api-client.ts` refreshes once on a 401 for non-auth routes, retries with the new token, deduplicates concurrent refreshes, and turns a network failure into a 503-style error (`api-client-refresh.test.ts`, 270 web tests pass). Error shapes it reads (`message`, `statusCode`) match both services.
- **Not verified:** a browser run (Playwright was not executed), the saved-lead and wallet pages against the gateway's offline list shape (R-059), and the frontend's TypeScript response types against runtime values (they are interface declarations with `as` casts at the client boundary; no runtime schema validation exists, R-062).

## 7. Regression tests and results

Working tree, 2026-10-13. Commands from `apps/api` unless noted.

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `node ops/security/scan-secrets.mjs` (root) | 0 findings |
| `npm run test:inventory -- --check` (root) | passed |
| `npm run test:unit` | 45 suites, 843 tests passed |
| `npm run test:integration` | 41 of 42 suites passed, 1 skipped; 969 passed, 13 skipped, 0 failed |
| `npm run test:security` | 9 passed |
| `npm run test:perf` | 3 passed |
| `npm run test:e2e` | 40 of 42 suites passed, 1 skipped (opt-in real-server suite), 1 failed; 649 passed, 10 skipped, 3 todo, **1 failed**: `health-probes` "reports every dependency ... 503 when a configured one is down", the known timing-sensitive test; re-run alone three times: 20 of 20 passed each time; not changed |
| new `api-contract.e2e-spec.ts` | 11 tests passed (the first run had 4 failures: route-count threshold set too high, a 503 on `/health` that is intentional, a test artefact where the hostile sweep legitimately ended the swept customer's session, and a cache-header check the harness cannot perform; the real defects it found are listed in section 2) |
| `npm test` in `ownus` | 270 passed, 0 failed (264 + 6 new in `gateway-contract.test.ts`) |
| `npm run build` in `ownus` (three times, the last on the final code) | passed |
| Gateway probe over HTTP (built `next start` on a local port, disposable database `orion_scratch_phase28_gw`, generated secrets, upstream unreachable; script outside the repository) | first run 10,140 requests: 54 server errors, false successes confirmed; final run 10,140 requests: **0 server errors**, 0 internal details, 6 credentialed routes answered `no-store`; statuses 200 x3,422, 400 x1,447, 401 x2,149, 403 x659, 405 x231, 429 x302, 503 x1,930 |
| Gateway normal flows (same server) | register 201; profile update 200 and stored; company details 200; change password 200; login with the new password 200 |
| Gateway false-success probes | before: 200 "Profile updated" and 201 registered with tokens for a value the database refused, data not stored; after: 400 `INVALID_VALUE`, stored data unchanged |

Fail-first: the null-body, non-text-name, administrator OTP and provider-link 500s, and the false successes, were each reproduced before the fix (counts above). The body-type fence and the six web guards are structural tests, not fail-first.

Not run: Playwright, lint, Docker, CI, the opt-in real-PostgreSQL suite (unchanged this phase; last run in Phase 27: 10 of 10), any production or Neon database.

## 8. Unresolved issues and manual actions

| ID | Item | Action |
|---|---|---|
| R-058 | Four administrator import bodies are unvalidated inline types (hand-checked); a test fences the list | Convert to DTOs together with the admin console, after a format review |
| R-059 | Gateway offline list shapes differ from the API's; saved-lead and wallet pages not re-checked offline | Decide whether the offline mode is supported in production; if so add shape tests |
| R-060 | 76 gateway call sites still treat a database failure as "no rows" | Convert write paths first (done for the customer writes); admin import and business admin writes remain |
| R-061 | A retried unlock answers `creditsSpent: 0, alreadyUnlocked: true` | Acceptable; document for client authors |
| R-062 | No runtime validation of responses in the browser client | Optional; add schema checks for the few shapes that crash pages when missing |
| R-063 | The gateway and the API are two implementations of the same routes (auth, profile, search, import); divergence is a standing risk | Long-term: reduce the gateway to a proxy; not proposed here |

Not run: Playwright, a browser session, lint, Docker, CI, any production or Neon database, a load test.
