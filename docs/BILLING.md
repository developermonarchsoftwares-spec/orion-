# Credits, billing and subscriptions (Orion API)

Applies to `apps/api` (`/api/v1/payments/*`, `/api/v1/billing/*`, `/api/v1/credit/*`). Migration: `0019_billing`.

## 1. Model

| Concept | Where | Notes |
|---|---|---|
| Plans | `credit_packages` (`GET /credit/packages`) | A package slug is its tier: `free < starter < growth < agency < enterprise` |
| Wallet | `user_wallets` | Daily free credits (expire at UTC midnight) + purchased credits (never expire). Spending takes daily first |
| Checkout order | `payment_orders` | One row per order created; a payment can only be redeemed for exactly the order stored for that customer |
| Invoice | `invoices` | One per credited payment (unique `payment_id`), sequential `INV-YYYY-000001`, written in the **same transaction** as the credit |
| Subscription / tier | `user_subscriptions` | A plan purchase grants its tier for one cycle (monthly 30 d, annual 365 d). **No auto-renewal**: the customer buys again |
| Refund | `refunds` | At most one per payment, full refunds only |

## 2. Customer endpoints

| Endpoint | Purpose |
|---|---|
| `POST /payments/create-order` → `POST /payments/verify` | Buy a plan (existing flow; now also persists the order and issues an invoice) |
| `GET /billing/topup/quote?credits=N` | Server-side price and the allowed range |
| `POST /payments/topup/order {credits}` → `POST /payments/topup/verify` | Top up extra credits without changing the plan. Price and quantity come from the stored order, never from the verify request |
| `GET /billing/subscription` | `tier`, `status` (`NONE/ACTIVE/EXPIRED/CANCELLED`), `expiresAt`, `daysRemaining`, `autoRenew:false` |
| `GET /billing/history` | Purchases, top-ups, refunds, adjustments with invoice numbers |
| `GET /billing/invoices`, `/invoices/:id`, `/invoices/:id/html` | Invoices as JSON, and a printable HTML page (browser "Save as PDF") |
| `GET /credit/wallet` | Now also returns `creditStatus` (`OK/LOW/EMPTY`), `lowCreditThreshold`, `restricted`, `nextDailyResetAt` |

## 3. Credit warnings and zero-credit handling

- `LOW` when balance ≤ `LOW_CREDIT_THRESHOLD` (default 2), `EMPTY` at 0.
- After a successful unlock, the customer is e-mailed once per UTC day per level (LOW, then EMPTY).
- Spending at zero is refused with **402 `INSUFFICIENT_CREDITS`** and `details: {required, available, creditStatus, nextDailyResetAt, canTopUp}` so a client can offer a top-up or show when free credits return. Nothing is charged.

## 4. Tier-based access

```ts
@UseGuards(JwtAuthGuard, TierGuard)
@RequireTier('growth')
@Get('something')
```
`PaymentModule` must be imported by the module that uses it. A customer below the tier gets **403 `TIER_REQUIRED`** with `{requiredTier, currentTier}`; an expired or cancelled plan counts as `free`. **No existing endpoint is gated yet**: which features belong to which tier is a product decision.

## 5. Refund and adjustment workflow (administrators)

`POST /billing/admin/refunds {paymentId, reason}` (reason ≥ 5 chars), `GET /billing/admin/refunds`. In one transaction, serialised per payment:
1. Live mode: the gateway refund is requested first; if the gateway refuses, nothing is recorded and the refund can be retried.
2. Purchased credits are taken back as far as the customer still has them; **credits already spent are recorded as `creditsShortfall`** (the wallet never goes negative). Review shortfalls manually.
3. Invoice → `REFUNDED`; a plan bought with that payment → `CANCELLED`; refund row, ledger entry (`REFUND`), audit log and customer e-mail are written.
4. A second refund of the same payment returns 409.

Without live mode no money moves: the refund is recorded as `MANUAL_REQUIRED` and the money must be returned in the Razorpay dashboard.
Manual wallet adjustments (`POST /credit/admin/adjust`) are unchanged except that the ledger now records the amount actually applied when a balance would have gone below zero.

> Known gap: if the database fails *after* the gateway accepted a refund, the refund is not recorded locally. The failure is logged; reconcile with the Razorpay dashboard.

## 6. Payment gateway

Razorpay is the integrated gateway. **Stripe is not implemented.**

| Mode | Set by | Behaviour |
|---|---|---|
| Simulated (default) | nothing | Orders are generated locally (no network), signature checks are real. This cannot open a real Razorpay checkout or move money |
| Live | `RAZORPAY_API_MODE=live` + `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` | Orders are created at Razorpay; on verify the server asks Razorpay that the payment is `captured`/`authorized` for that order and amount; refunds go through the API |

The live code is covered by tests against a mocked HTTP layer only. **It has not been run against Razorpay**: do that in test mode before going live. The webhook secret (`RAZORPAY_WEBHOOK_SECRET`) is unchanged; a webhook for a stored order credits from our own record and ignores a payload whose amount differs.

## 7. Settings (`pricing_settings`, via `PUT /credit/admin/config`)

| Key | Value | Default |
|---|---|---|
| `TOPUP_PRICING` | `{pricePerCreditInr, minCredits, maxCredits}` | ₹1 per credit, 50 to 5000 |
| `TAX_PERCENTAGE` | `{percentage}` | 0 (no tax shown). Prices are tax-inclusive; tax is carved out of the total |
| `LOW_CREDIT_THRESHOLD` | `{amount}` | 2 |

Invoice header: `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS`, `INVOICE_SELLER_TAX_ID` (environment). The invoice is a plain commercial invoice; whether it satisfies local tax-invoice rules (for example GST fields such as HSN/SAC, place of supply, buyer tax ID) is for your finance/legal team to confirm.

## 8. Limits

- Not built: Stripe, auto-renewing subscriptions (Razorpay Subscriptions), partial refunds, credit notes as separate documents, PDF files (HTML only), a frontend for any of this.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) has its own wallet/payment handling for some paths; it was not changed.
