# API protection and traffic control (Orion API)

Applies to `apps/api`. Migration: `0022_traffic_control`. Code: `apps/api/src/modules/traffic/`.

**On by default everywhere except `NODE_ENV=test`.** Switch the whole feature off with `TRAFFIC_CONTROL_ENABLED=false`. Read section 8 before deploying behind a gateway or load balancer.

## 1. Layers, in the order a request meets them

1. **Address deny rules** (403 `IP_BLOCKED`), then the **admin-route allow-list** (403 `ADMIN_IP_RESTRICTED`).
2. **Active blocks** on the address (429 `TEMPORARILY_BLOCKED`, with `Retry-After`).
3. **Bot and scanner detection** (below).
4. **Address rate limits**: a per-second burst cap and a per-hour cap (429 `RATE_LIMITED`, `Retry-After`).
5. **The signed-in user**: block check, then plan-based limits (below).
6. **Honeypot** and **CAPTCHA** on the sign-up / sign-in / reset forms.
7. The pre-existing global throttler (100 requests per minute per address) and the stricter per-route `@Throttle` limits on authentication routes stay in place beneath all of this.

Every refusal is JSON with a stable `errorCode`. Where waiting helps, `Retry-After` is set (and is accurate: waiting that long works).

## 2. Rate limits and throttling

| Limit | Default | Variable |
|---|---|---|
| Per address, per second (burst) | 25 | `RATE_LIMIT_IP_BURST_PER_SECOND` |
| Per address, per hour | 3000 | `RATE_LIMIT_IP_PER_HOUR` |
| Per user, per minute (free plan) | 120 | `RATE_LIMIT_USER_PER_MINUTE` |
| Per user, per day (free plan) | 5000 | `RATE_LIMIT_USER_PER_DAY` |
| Per user, per second (burst) | 20 (×plan, at most ×4) | `RATE_LIMIT_USER_BURST_PER_SECOND` |
| Per user, requests in flight at once | 10 | `RATE_LIMIT_USER_MAX_CONCURRENT` |

The sliding window avoids a double burst at a window boundary. Limits are counted per **API process**: with N instances behind a load balancer the effective limit is up to N times the figure. Blocks and rules (below) are shared through the database.

Never limited: the health check and the payment webhook (its signature is verified), CORS pre-flight requests, and addresses on a global allow rule.

## 3. User-based limits

A customer's allowance comes from their plan (see `BILLING.md`): free ×1, starter ×2, growth ×4, agency ×8, enterprise ×16 of the per-minute and per-day figures. An administrator can replace it for one user: `PUT /traffic/users/:userId/limits {perMinute?, perDay?, note?}` (a `null` keeps the plan value), `DELETE` to go back to the plan. Administrators themselves are not subject to the user limits. Authenticated responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (the per-minute window; these are the IETF draft names, so they do not collide with the `X-RateLimit-*` headers the existing global throttler writes). `GET /traffic/my-limits` shows a customer their allowance and use.

## 4. IP-based restrictions (administrators)

`GET/POST /traffic/ip-rules`, `DELETE /traffic/ip-rules/:id`. A rule is a single address or a CIDR range (IPv4 or IPv6), with a reason and an optional expiry.

| Action / scope | Effect |
|---|---|
| `DENY` / `GLOBAL` | Every request from the range is refused. Wins over an allow |
| `ALLOW` / `GLOBAL` | Trusted: skips rate limits, bot checks and automatic blocks (use for partners and for the web gateway, see §8) |
| `ALLOW` / `ADMIN` | Once any exists, the admin routes (any path with an `admin` segment, and `/traffic/*`) answer only to these ranges. Ordinary routes are unaffected |

**Lock-out protection:** a `DENY` that covers your own address, a `0.0.0.0/0` deny, and the **first** admin allow-list entry if it does not contain your own address are all refused (409 `WOULD_LOCK_OUT_YOU`). You also cannot block your own address or user. Rules and blocks are cached for up to 5 seconds on other instances.

## 5. Abuse prevention

A **strike** engine turns repeated misbehaviour into an automatic block. Points within 10 minutes (`ABUSE_STRIKE_WINDOW_SECONDS`) add up; at 10 points (`ABUSE_STRIKE_THRESHOLD`) the address or user is blocked, for **5 minutes**, then **30 minutes**, **2 hours** and **24 hours** for each further offence within 24 hours. Blocks are stored in the database (shared), audited (`TRAFFIC_AUTO_BLOCK`) and visible at `GET /traffic/blocks`; `DELETE /traffic/blocks/:id` lifts one, `POST /traffic/blocks` places one by hand (address or user, up to 30 days).

| Behaviour | Points |
|---|---|
| Attack-tool user agent (sqlmap, nikto, nmap, masscan, gobuster, …) | 5, and 403 `BOT_BLOCKED` |
| Probe for secrets / admin panels (`/.env`, `/.git`, `/wp-login.php`, `..%2f`, …) | 3, answered with an ordinary 404 |
| Honeypot field filled in | 5 |
| Oversized URL (over 4000 characters) | 2 |
| More than 30 unknown URLs (404) per minute (`ABUSE_404_PER_MINUTE`) | 2 each beyond that |
| Each request over an address limit / each user burst or per-minute overrun | 1 |
| Each failed sign-in from the address | 1 |
| Failed CAPTCHA | 1 |

**Sign-in lockout (credential stuffing):** 8 failed sign-ins for one e-mail in 15 minutes (`LOGIN_LOCK_AFTER_FAILURES`, `LOGIN_LOCK_WINDOW_MINUTES`) lock that e-mail for 15 minutes (`LOGIN_LOCK_MINUTES`): 429 `ACCOUNT_TEMPORARILY_LOCKED`, even for the right password. It behaves identically for an e-mail that is not registered, so it reveals nothing, and the block stores only a one-way hash of the e-mail. A successful sign-in clears the count. An administrator can lift a lock from `GET/DELETE /traffic/blocks`.

## 6. Bot protection

- **Attack-tool user agents** are blocked; ordinary HTTP clients (curl, python-requests, axios) and empty user agents are **not**, because integrations use them. Add patterns with `BLOCKED_USER_AGENTS` (comma-separated regular expressions).
- **Honeypot:** the sign-up, sign-in, forgot-password and reset-password bodies accept an optional `website` field. Put it in the form as a hidden input that real users never fill; a filled value is refused (400 `INVALID_REQUEST`) and costs 5 strike points.
- **CAPTCHA:** set `CAPTCHA_PROVIDER` (`turnstile`, `hcaptcha` or `recaptcha`) and `CAPTCHA_SECRET_KEY`. The browser sends the widget's token in the **`X-Captcha-Token`** header. It is required for sign-up and password reset always, and for sign-in only after 3 recent failures for that address or e-mail (`LOGIN_CAPTCHA_AFTER_FAILURES`). Missing: 403 `CAPTCHA_REQUIRED`; wrong: 403 `CAPTCHA_FAILED`; provider unreachable: 503 unless `CAPTCHA_FAIL_OPEN=true`. Nothing is required until a provider is configured.

The CAPTCHA verification follows each provider's documented `siteverify` call but **has not been run against a live provider account** here; try it with the provider's test keys first.

## 7. Monitoring and audit

`GET /traffic/limits` (the settings in force, never secrets), `GET /traffic/stats` (what the protections did since this instance started, and the most-limited addresses and users). Administrator actions (`TRAFFIC_IP_RULE_CREATED / DELETED`, `TRAFFIC_BLOCK_CREATED / RELEASED`, `TRAFFIC_USER_LIMIT_SET / CLEARED`) and every automatic block are written to the audit log.

## 8. Deploying behind a gateway or load balancer (read this)

All address-based protection depends on seeing the **real client address**.

- Behind a reverse proxy, `main.ts` trusts one hop in production, so the address is the client entry of `X-Forwarded-For`.
- If every customer reaches the API through **one or a few servers** (for example the web gateway forwarding browser requests), the API sees only those servers. Address limits would then treat all customers as one client. Either add the gateway's egress addresses as `ALLOW` / `GLOBAL` rules (trusted, so no address limits or blocks apply to them), or set **`TRAFFIC_TRUSTED_IP_HEADER`** (for example `x-real-ip`, `cf-connecting-ip`) to the header the proxy fills with the real client address. Set the header **only if the API can be reached only through that proxy**, otherwise anyone can claim any address.
- User limits and sign-in lockout do not depend on the address.

## 9. Limits

- Rate counters are per process (see §2); there is no Redis. A shared counter store is the next step if you run many instances.
- No geo-blocking, no device fingerprinting, no machine-learning bot scoring, and no automatic blocking of whole ranges.
- Plan multipliers and base figures are defaults chosen here, not a product decision: tune them.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) has its own login / forgot-password handlers and its own small rate limiter; they do not use any of this.
