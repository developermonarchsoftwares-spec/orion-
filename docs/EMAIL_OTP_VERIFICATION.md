# Sign-up e-mail verification code (OTP)

**Status:** implemented in the working tree (uncommitted), 2026-10-14. Migration `0026_email_otp_challenges` is **not applied to any database yet**.

## What it does

A new user cannot create an account, or receive any session, until they enter a 6-digit code that the server e-mailed to the exact address they typed.

```
Register page ─ details + Continue ─▶ POST /auth/send-otp ─▶ e-mail with code
              ─ enter code        ─▶ POST /auth/verify-otp ─▶ one-time proof (no session)
              ─ (automatic)       ─▶ POST /auth/register  { …, verificationToken: proof } ─▶ account + session
```

* `send-otp` is also the **resend** endpoint (60 second cooldown; each send replaces the previous code).
* `verify-otp` returns `{ verified: true, verificationToken }`. That token is **not** a credential: it is rejected as a bearer token and as a refresh token. Its only use is to be presented to `register`.
* `register` refuses (`403 EMAIL_OTP_REQUIRED`) without a live, unspent proof for exactly the address being registered. The proof is spent **in the same transaction** that creates the user, so it can create at most one account and a failed creation does not use it up. The user row is created with `is_email_verified = true`.
* Existing users: `login`, OAuth, refresh, MFA and password recovery are unchanged. The code is never a way to sign in; there is no passwordless path.

## Where it is enforced

| Path | File | Note |
|---|---|---|
| NestJS API | `apps/api/src/auth/services/email-otp.service.ts`, `auth.service.ts` (`register`), `auth.controller.ts` | `POST /api/v1/auth/send-otp`, `verify-otp` |
| Web gateway (native handlers) | `ownus/src/lib/email-otp.ts`, `ownus/src/app/api/v1/[...path]/route.ts` (`handleSendOtp`, `handleVerifyOtp`, `handleRegister`) | The gateway can create accounts itself, so it enforces the same proof with the same SQL and hashes. A structural test fails if the plain insert is reachable while the requirement is on |
| Browser | `ownus/src/app/(auth)/register/page.tsx`, `components/auth/otp-input.tsx`, `lib/otp-flow.ts` | Display only. Nothing the browser holds decides validity |

## Rules

| Rule | Value |
|---|---|
| Code | 6 digits, `crypto.randomInt` (CSPRNG) |
| Stored | HMAC-SHA256 of purpose + address + code, keyed from `EMAIL_OTP_SECRET` (or `JWT_ACCESS_SECRET`); never the code |
| Compared | constant time |
| Expires | 5 minutes |
| Attempts | 5 per code; each try is counted **before** it is compared, in one atomic statement, so parallel guesses cannot exceed 5 |
| Single use | accepting a code and consuming it is one statement; of two parallel correct submissions one wins |
| Resend | not before 60 s; a new code invalidates the previous one |
| Limits | 10 codes per address per day; 20 per network address per hour (keyed digest of the address, not the address); route throttles 6/min (send) and 12/min (verify) |
| Proof | single use, bound to the address and purpose, valid 15 minutes |
| Address | trimmed and lower-cased before any lookup; one account per normalised address (unique index) |
| Enumeration | `send-otp` answers identically for an address that already has an account. No code is sent to it; a decoy row keeps cooldown, daily limit, wrong-code answers and lockout identical. See limits below |
| Logging | the code is never logged. The mail is marked `sensitive`: the log transport writes only recipient and subject, and counts as **not delivered**. Audit rows hold an address digest and a result, never a code or an address |
| Subject line | contains no code (subjects appear on lock screens) |

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `REQUIRE_REGISTRATION_OTP` | API + web | Default **on**. In production it is **always on** and this setting is ignored. Outside production, `false` switches it off (local development without a mail relay; the automated suites that register accounts directly) |
| `EMAIL_OTP_SECRET` | API + web | Optional key for hashing codes; defaults to a key derived from `JWT_ACCESS_SECRET`. Must be identical for the API and the gateway. Changing it invalidates codes in flight |
| `APP_NAME` | API + web | Name shown in the e-mail (default `Orion`) |
| `MAIL_TRANSPORT`, `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_TOKEN` | API | The API's existing mail path. `webhook` POSTs `{ to, subject, text, html, sensitive }` as JSON. **There is no SMTP client in the project**: the project already sends through a webhook relay (API) and Resend (gateway); this feature reuses both rather than adding a dependency. Point the relay at Gmail/SMTP if that is the provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | web | The gateway's existing mail path |

In production without a working transport nobody can register (fails closed, 503 `EMAIL_DELIVERY_FAILED`). That is deliberate: the alternative is accounts for addresses nobody verified.

Local development: either set `REQUIRE_REGISTRATION_OTP=false`, or point `MAIL_TRANSPORT=webhook` at a local catcher. The development log transport does **not** print codes.

## Database

`email_otp_challenges` (migration `0026_email_otp_challenges.sql`, additive: one table, three indexes, no change to existing tables). One row per code sent: `email`, `purpose`, `otp_hash`, `attempts`, `max_attempts`, `expires_at`, `created_at`, `consumed_at`, `invalidated_at`, `locked_at`, `proof_hash`, `proof_expires_at`, `proof_consumed_at`, `ip_hash`.

The migration was generated with `npm run db:migration:new` (journal `when` 1799500000003, above every existing entry) and verified on in-memory PostgreSQL by every OTP test. **It has not been applied to `orion_db`, Neon, or any production database.** Before deploying: back up, apply with the project's migration command, and confirm the table exists. Until it exists the code routes answer 503 and registration is refused (fail closed).

Expired and spent rows are not yet purged. They hold only hashes; add `email_otp_challenges` to the retention job (e.g. delete rows older than 7 days) when the retention periods are decided.

## Known limits

* **Timing:** a request for an address that already has an account skips the mail call, so it can return faster than one that sends. The response bodies are identical; the timing difference is not hidden. (The register endpoint also still answers `409` for an existing address, as before, so this feature does not make account existence secret by itself.)
* **Provider outage:** `503 EMAIL_DELIVERY_FAILED` is returned only when a real send failed, which reveals an outage and, during one, that the address is new.
* Per-process route throttles are not shared between API instances; the database limits (cooldown, daily, per-network) are.
* A code protects against typing someone else's address; it does not prove the person is who they claim to be.
* Real e-mail delivery (Resend/relay), mailbox spam filtering and a real Gmail mailbox were **not** exercised. Tests use an in-memory mail capture.

## Tests

* API e2e `apps/api/test/email-otp.e2e-spec.ts` (35): send, normalisation, hashing at rest, wrong/expired/reused/locked codes, cooldown, replacement, daily and network limits, provider failure, log safety, no session before verification, proof single-use/binding/expiry, duplicate registration, parallel verification and parallel registration, existing users unaffected, state in the database not the process.
* API unit `src/auth/__tests__/email-otp.util.spec.ts` (9) with known-answer vectors shared with the gateway.
* Web `src/lib/__tests__/email-otp.test.ts` (15, real SQL on in-memory PostgreSQL, includes a structural guard on the route) and `otp-flow.test.ts` (4).
* Mutation checks (the control was weakened, the suite had to fail): proof not spent, any code accepted, expiry ignored, cooldown removed, proof reusable, attempt limit and lock flag removed together: all caught. Removing only the attempt counter column check is an equivalent change because the lock flag enforces the same limit.
