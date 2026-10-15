# Gateway security & authentication hardening (Phase 6.17)

## Vulnerabilities found and fixed
**Gateway (`ownus/src/app/api/v1/[...path]/route.ts`, native handlers)**
1. **Password reset with a forged token:** the reset token was decoded, never verified; anyone could reset any account's password. Now verified (signature, expiry, purpose `password_reset`, user-id subject) with a purpose-derived key.
2. **Token refresh with a forged token:** the refresh token was decoded, not verified; anyone could mint access tokens for any user. Now verified with the refresh secret and purpose `refresh`.
3. **Unsigned identity everywhere:** every route read the user from an unsigned token, then a request-body id, then a hard-coded default account. Identity now comes only from a signature-verified, unexpired access token (`sub` required, `iss`/`aud` checked, purpose `access`); no body ids, no default account.
4. **Unauthenticated admin routes** (always native): business delete, user list, transactions, activity logs, import preview/submit/batches, filter-option changes. All now require a verified ADMIN / SUPER_ADMIN token (central access gate).
5. **Free credits:** the fallback `payments/verify` added any client-supplied `credits` (or a package's) to a wallet with no payment check; `payments/create-order` returned a fake order with a demo key. Both now fail closed (503 `PAYMENTS_UNAVAILABLE`): the gateway never creates orders, verifies payments or credits wallets.
6. **Receipt forger:** the fallback invoice route rendered a "paid" PDF from query-string values. Now fails closed.
7. **Hard-coded secrets** (JWT access / refresh, reset, admin-OTP HMAC): removed. Secrets come only from the environment (min 16 characters); missing = `AUTH_NOT_CONFIGURED` (503), never a well-known key. Reset and OTP keys are derived per purpose from the access secret.
8. Business unlock fallback: see Phase 6.16 (atomic, verified identity).

**NestJS API**
9. **Demo / mock payment signatures** (`demo_verified`, `mock_sig_*`) were accepted by payment verification: free credits for any customer (the credits page used it). Removed.
10. **Built-in Razorpay key, webhook secret and key id:** removed; unconfigured payments fail closed (`PAYMENTS_NOT_CONFIGURED`, 503).
11. **Order not bound to the customer / package:** a valid signature of a cheap or someone else's order could buy any package. The order id now carries an HMAC tag over (customer, package, price, cycle) and verification requires it (`ORDER_MISMATCH`). Credits always come from the package record.
12. **Non-atomic idempotency:** the duplicate check ran before an unlocked credit; concurrent callbacks could double-credit. Crediting is now one transaction-scoped advisory lock on the payment id + check + credit; a payment already credited to another customer is `PAYMENT_ALREADY_USED`. The webhook uses the same path, credits the package's amount (not `notes.credits`) and stores no payment payload.
13. **Built-in JWT and OAuth-state secrets** in config / strategies: removed. Production refuses to start without `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`; elsewhere a random per-process secret is used.
14. A package slug passed where a uuid was expected raised a database error (500); it is now "not found".

## Routes audited (gateway)
PUBLIC (own credential checks): auth login / register / refresh / forgot / reset / google, health, admin OTP send / verify / logout, import template, discover search and filter-options GET, credit packages / config. USER (verified customer token): auth/me, user and settings routes, discover export; fallback-only: credit wallet / transactions, payments, dashboard, unlock, saved leads / searches, invoices. ADMIN (verified role): admin users / businesses / transactions / activity-logs / import (preview, submit, batches) / filter-options (and POST discover/filter-options); fallback-only: admin duplicates, admin invoices, admin packages. Everything else is proxied to the NestJS API, which authenticates it. The gate runs before native handlers, and again before fallback handlers when the upstream is unreachable (so a normally proxied route is never blocked by gateway configuration).

## Required configuration (deployment action)
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥ 16 chars, identical in the gateway and the API); for purchases `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Without them the API (production) will not start, and the gateway / payments fail closed.

## Not changed / limits
No payment provider was added: a real checkout and a server-side order record are still needed (the current order id is generated locally, bound by tag). The webhook route verifies the signature over re-serialised JSON; raw-body verification needs `rawBody` enabled. Other built-in non-JWT defaults (storage, search keys) are outside this phase.
