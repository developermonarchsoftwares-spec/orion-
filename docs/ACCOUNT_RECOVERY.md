# Account recovery and session security (Orion API)

Applies to the NestJS API in `apps/api` (`/api/v1/auth/*`). See the note at the end about the web gateway.

## 1. What a user can do

| Situation | Procedure |
|---|---|
| Forgot password | `POST /auth/forgot-password {email}`. Same response whether or not the account exists. An e-mail with a single-use link (15 minutes) is sent to active accounts. |
| Reset password | `POST /auth/reset-password {token, newPassword}`. The token works once; a newer request replaces an older link. A successful reset signs out every device, marks the e-mail verified, and sends a "password changed" notice. |
| Social-login account with no password | Use forgot-password to set one. |
| E-mail not verified (when `REQUIRE_EMAIL_VERIFICATION=true`) | Login returns `EMAIL_NOT_VERIFIED`. `POST /auth/resend-verification {email}` then `POST /auth/verify-email {token}` (24 h, single use). |
| Lost authenticator device (MFA on) | Sign in with password, then `POST /auth/mfa/login {mfaToken, recoveryCode}`. Each of the 10 recovery codes works once; the owner is e-mailed when one is used. Then regenerate codes with `POST /auth/mfa/recovery-codes`. |
| Lost device and no recovery codes | Not self-service. See §3. |
| Suspect someone else is signed in | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, or `POST /auth/sessions/revoke-all` (immediate, all devices). |

## 2. Token and session lifecycle

- **Access token**: 15 min (`JWT_ACCESS_EXPIRES_IN`). Invalidated at once when the account's active session id rotates (login elsewhere, password reset, revoke-all).
- **Refresh token**: lifetime from `JWT_REFRESH_EXPIRES_IN` (default 7 d), single use, rotated on every refresh within one *family* (= one session). Replaying a used token revokes the whole family. Revocations record `revoked_at` and `revoked_reason` (`ROTATED`, `LOGOUT`, `SUPERSEDED`, `PASSWORD_RESET`, `REVOKE_ALL`, `USER_REVOKED`, `REUSE_DETECTED`, `EXPIRED`).
- **Cleanup**: hourly job deletes expired tokens and tokens revoked more than 24 h ago (kept briefly so replay detection still works).
- **Single-device policy is unchanged**: a new login supersedes older ones. `GET /auth/sessions` therefore usually shows one entry.
- Revoking one session stops its refresh token immediately; an access token already issued for it stays valid until it expires (≤15 min). `revoke-all` has no such window.

## 3. Operator procedure: user cannot sign in with MFA and has no recovery code

1. Verify identity out of band (support ticket from the registered e-mail, plus one additional factor your organisation requires). Record who verified, when, and how in `DOCUMENT_CONTROL_REGISTER.md` audit notes or your ticketing system.
2. A second authorised person approves the MFA reset.
3. Reset in the database (no API for this by design):
   ```sql
   UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = '<user id>';
   DELETE FROM user_recovery_codes WHERE user_id = '<user id>';
   UPDATE refresh_tokens SET is_revoked = true, revoked_at = now(), revoked_reason = 'REVOKE_ALL' WHERE user_id = '<user id>' AND is_revoked = false;
   ```
4. Tell the user to sign in, enable MFA again, and store the new recovery codes.

Never read, log or send a user's TOTP seed: it is stored sealed (AES-256-GCM).

## 4. Configuration

| Variable | Purpose |
|---|---|
| `WEB_APP_URL` | Base URL used in reset / verification links |
| `MAIL_TRANSPORT`, `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_TOKEN` | How account e-mails are delivered. **Production has no default**: until a transport is configured, reset and verification e-mails are not sent (an error is logged, the link is not). |
| `REQUIRE_EMAIL_VERIFICATION` | `true` to block sign-in until verified. Default `false` keeps current auto-verify behaviour. |
| `MFA_ENCRYPTION_KEY` | Optional key for sealing TOTP seeds; changing it invalidates enrolled authenticators |
| `MFA_ISSUER` | Name shown in authenticator apps |

## 5. Known limits

- Rate limits are per IP (`@Throttle`): forgot/reset 5/min, MFA code endpoints 5/min, resend 3/min. There is no per-account lockout yet.
- Password reset does not require the second factor of an MFA account; MFA stays on afterwards.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) has its own native login / forgot / reset handlers used when the API is unreachable or not configured. Those do not implement MFA, single-use reset tokens or the session endpoints. See the hand-off notes in the change summary.
