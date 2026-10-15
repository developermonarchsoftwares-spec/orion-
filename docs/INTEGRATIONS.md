# Third-party integrations (Orion API)

Applies to `apps/api` (`/api/v1/integrations/*`). Migration: `0021_integrations`. Code: `apps/api/src/modules/integrations/`.

## 1. What a customer can connect

| Type | What it does |
|---|---|
| `WEBHOOK` | Orion POSTs signed JSON events to an **https** endpoint the customer owns |
| `HUBSPOT` | Orion pushes the customer's **unlocked** leads (companies and their contacts) to HubSpot |

Up to 10 integrations per customer. Any other CRM (Salesforce, Zoho, Pipedrive) can be reached today through a webhook and the customer's own automation; there is no native connector for them.

## 2. Webhooks

`POST /integrations {type:"WEBHOOK", name, targetUrl, events[]}` returns the **signing secret once** (`whsec_…`); it is stored sealed (AES-256-GCM, key `INTEGRATIONS_ENCRYPTION_KEY`, else derived from `JWT_ACCESS_SECRET`) and never returned again. `POST /integrations/:id/rotate-secret` issues a new one; the old one stops working at once.

Events (`GET /integrations/events`): `lead.unlocked`, `person.unlocked`, `export.completed`, `credits.low`, `credits.empty`. Payloads carry **ids and counts only**, never contact details. `POST /integrations/:id/test` sends a signed `integration.test` and reports the result.

Every delivery is `POST` JSON with headers `X-Orion-Event`, `X-Orion-Delivery` (the delivery id), `User-Agent: Orion-Webhooks/1.0` and

```
X-Orion-Signature: t=<unix seconds>,v1=<hex>
v1 = HMAC-SHA256(signing secret, "<t>." + raw request body)
```
Receivers should recompute `v1` over the raw body and reject a `t` more than 5 minutes old. The body also carries `deliveryId` and `callbackUrl`. Respond 2xx within 8 seconds.

**Retries:** a non-2xx answer, timeout or network error is retried after 30 s, 2 min, 10 min, 1 h, 6 h; after the sixth failed attempt the delivery is `DEAD` (kept 14 days, redeliverable by hand with `POST /integrations/:id/deliveries/:deliveryId/redeliver`). A `410 Gone` answer is final at once and switches the integration off. Delivery is **at least once**: a receiver must tolerate a repeat (use `X-Orion-Delivery` to de-duplicate). Order is not guaranteed.

## 3. Server-side request forgery protection

The target URL is typed in by a customer, so every outbound call goes through `net/safe-http.ts`:
- https only; no credentials in the URL; at most 500 characters;
- the host name is resolved by Orion and **every** address must be public (no loopback, private, link-local including the cloud metadata address, carrier-grade NAT, multicast or reserved ranges; IPv4-in-IPv6 forms are judged as the IPv4 address); the connection then uses that resolved address, so DNS rebinding cannot swap in a private one; IP-literal hosts are checked directly;
- redirects are **never followed** (a 3xx is a failed delivery);
- 8 second timeout, at most 64 KB of the response is read, no connection reuse.

The URL is checked when it is saved and again at every delivery. `INTEGRATIONS_ALLOW_PRIVATE_NETWORK=true` lifts the address and https rules for local development and tests only; it is **ignored when `NODE_ENV=production`**.

## 4. API callbacks (the receiver reports the outcome)

A 2xx only proves the request arrived. The receiver reports what it did with it: `POST /integrations/callbacks/:integrationId` with `{deliveryId, status: "PROCESSED" | "REJECTED", message?}`, signed exactly like Orion's own requests (`X-Orion-Signature` over `<t>.<raw body>` with the integration's signing secret). Requests outside a 5-minute window, with a bad signature, for an unknown integration, or for a delivery of another integration are refused (an unknown integration and a bad signature answer identically). The result appears in the delivery log and in validation.

## 5. CRM (HubSpot)

`POST /integrations {type:"HUBSPOT", name, credential}` with a HubSpot private-app access token (stored sealed, never returned). The token needs the CRM companies and contacts read and write scopes.

- `POST /integrations/:id/sync {limit?}` pushes new, changed and previously failed records (up to 200 per call; call again for the rest). Companies go first; each contact is created with an association to its company (association type 279, contact to company). A contact whose e-mail already exists in HubSpot is adopted and updated. Re-running sends only what changed (a hash per record is kept).
- A rate limit (429) stops the run; it resumes where it stopped and does **not** count as a failure. A rejected token (401/403) switches the integration off at once; replacing the token switches it back on.
- Only data the customer has **unlocked** is ever sent.

**Not verified against a live HubSpot account.** The request shapes follow HubSpot's published CRM v3 documentation; the duplicate-e-mail handling (409 with the existing id in the message) and the v4 "default association" path used for adopted contacts are handled defensively and could not be checked here. All paths are in `crm/hubspot.client.ts` so a change at HubSpot is a one-line fix. Run a sync against a HubSpot developer test account before relying on it.

## 6. Failure monitoring

Each delivery attempt and each sync run reports success or failure. `GET /integrations` shows `health.state`:

| State | Meaning |
|---|---|
| `HEALTHY` | No recent failures |
| `DEGRADED` | At least one failure in a row, or a dead delivery in the last 24 h |
| `FAILING` | Five or more failures in a row |
| `PAUSED` | Paused by the owner |
| `DISABLED` | Switched off after **10 failures in a row**, a 410, or a rejected CRM token. Nothing more is queued; the owner is e-mailed and the event is audited (`INTEGRATION_DISABLED`). `PATCH {status:"ACTIVE"}` switches it back on and clears the count |

`GET /integrations/:id/deliveries?status=` is the delivery log (attempts, last status code, last error, acknowledgement). A manual test does not count towards health. Administrators get `GET /integrations/admin/health`: every unhealthy integration across customers (with the owner's e-mail), counts by state, and the 7-day dead / queued / overdue delivery backlog.

## 7. Synchronisation validation

`POST /integrations/:id/validate`, and the result is kept on the integration (`lastValidation`).

- **CRM:** compares the customer's unlocked leads with what was pushed: `missing` (never pushed), `stale` (changed since), `failed` (last push failed), `orphaned` (pushed earlier, no longer a lead here; reported, never deleted at the CRM). With `{remote:true}` it also asks HubSpot (up to 100 records) whether pushed records still exist (`remoteMissing`) and still carry the same company name or contact e-mail (`remoteMismatch`). `consistent` is true only when all are zero.
- **Webhook:** reconciles a window of deliveries (`days`, up to 14): emitted, delivered, dead, still queued, overdue (queued more than 10 minutes late), processed or rejected by the receiver (callbacks), and delivered but never acknowledged. `consistent` is true when nothing is dead, overdue or rejected.

## 8. Configuration

| Variable | Purpose |
|---|---|
| `INTEGRATIONS_ENCRYPTION_KEY` | Optional key for sealing secrets and tokens (default: derived from `JWT_ACCESS_SECRET`). Changing it makes stored secrets unreadable |
| `API_PUBLIC_URL` (or `APP_URL`), `API_PREFIX` | Used to build the `callbackUrl` sent to receivers |
| `INTEGRATIONS_ALLOW_PRIVATE_NETWORK` | Development and tests only; ignored in production |
| `DISABLE_INTEGRATION_DISPATCHER=true` | Turns off the in-process delivery worker (it runs every 5 s; several API instances are safe, each delivery is claimed once) |

## 9. Limits

- Not built: native Salesforce / Zoho / Pipedrive connectors, OAuth-based CRM sign-in (a HubSpot private-app token is used), two-way sync of CRM changes back into Orion, deleting orphaned records at the CRM, a per-customer rate limit on events, event types beyond the five listed, and a frontend for any of this.
- Delivery payloads are kept in the database for retries (14 days). They hold ids and counts only.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) was not changed; these paths reach the API through its proxy when `BACKEND_API_URL` is set.
