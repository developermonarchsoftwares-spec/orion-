# Health check infrastructure (Orion API)

Applies to `apps/api`, base path `/api/v1/health`. No database migration. Code: `src/modules/health/`.

## 1. Endpoints

All endpoints are **public** (a load balancer or orchestrator calls them without credentials), answer `Cache-Control: no-store`, and are **never rate-limited**, neither by the protection layer (`API_PROTECTION.md`) nor by the older global per-address throttler (a probe answered with 429 would make a load balancer pull a healthy instance). A public caller sees status and latency only; an administrator (Bearer token) also gets `details` (database pool figures, Redis version and mode, search collection count). A failure is reported as a fixed `reason` code, never as raw error text (which can carry host names, user names or credentials).

| Endpoint | Question it answers | Status codes |
|---|---|---|
| `GET /health/live` (also `/liveness`) | Is the process running and responsive? | 200 `ok`; 503 `unresponsive` if the event loop is blocked for over 5 s |
| `GET /health/ready` (also `/readiness`) | Should this instance receive traffic? | 200 `ok` or `degraded`; 503 `unavailable` or `shutting_down` |
| `GET /health/database` | Is PostgreSQL answering? | 200 `up`; 503 `down` |
| `GET /health/typesense` | Is the Typesense search cluster answering? | 200 `up` or `skipped`; 503 `down` |
| `GET /health/redis` | Is Redis answering? | 200 `up` or `skipped`; 503 `down` |
| `GET /health/storage` | Is object storage answering? | 200 `up`; 503 `down` |
| `GET /health` | Application health: every dependency and memory in one report (the Terminus report) | 200 or 503 |

Unknown dependency names answer 404.

### Liveness and readiness are different on purpose
- **Liveness** looks at nothing outside the process. Restarting the service cannot repair a database, so a database outage must not make an orchestrator restart every instance. It fails only if the event loop is wedged (`LIVENESS_MAX_LAG_MS`, default 5000), which a restart does fix.
- **Readiness** asks whether to send traffic here. Required: the database always; the search cluster when Typesense is the search provider; Redis when `REDIS_REQUIRED=true`; storage when `READINESS_REQUIRES_STORAGE=true`. A dependency that is down but not required makes the answer `degraded` (still 200, still ready). From the moment a shutdown signal arrives it answers 503 `shutting_down`, so the load balancer stops sending new requests; set `HEALTH_SHUTDOWN_DRAIN_SECONDS` to keep the process alive that long first (default 0).

Example readiness body:
```json
{ "status": "degraded", "ready": true, "timestamp": "…",
  "checks": {
    "database":  { "name": "database",  "status": "up",      "latencyMs": 3.1, "required": true },
    "typesense": { "name": "typesense", "status": "skipped", "latencyMs": null, "reason": "search_provider_is_postgres", "required": false },
    "redis":     { "name": "redis",     "status": "skipped", "latencyMs": null, "reason": "not_configured", "required": false },
    "storage":   { "name": "storage",   "status": "down",    "latencyMs": 2.0, "reason": "unreachable", "required": false } } }
```
`reason` is one of `unreachable`, `timeout`, `auth_failed`, `connection_refused`, `tls_error`, `protocol_error`, `error`, `not_configured`, `search_provider_is_postgres`.

## 2. Probe traffic cannot hurt the dependencies
Each check is bounded by `HEALTH_CHECK_TIMEOUT_MS` (default 2000), so a hung dependency makes a probe answer `down` / `timeout` instead of hanging. Simultaneous probes share one running check, and a result is reused for `HEALTH_CACHE_MS` (default 2000; `0` disables reuse). The endpoints are public and exempt from rate limits, so this is what keeps a flood of probes from becoming a flood of database queries.

## 3. Redis: read this
**Nothing in the application uses Redis today.** The job queue runs on PostgreSQL, and no Redis client library is installed. The Redis endpoint exists so that monitoring is in place the moment one is added: with no Redis configured it answers 200 `skipped` / `not_configured` (the empty `REDIS_*` placeholders in the deployment env files count as "not configured"). When configured it connects, authenticates, selects the database, sends `PING` and reads the version from `INFO`:

`REDIS_URL=redis://[user:password@]host[:port][/db]` (`rediss://` for TLS), or `REDIS_HOST`, `REDIS_PORT` (6379), `REDIS_PASSWORD`, `REDIS_USERNAME`, `REDIS_DB` (0), `REDIS_TLS`. The probe is tested against a fake Redis server (authentication, wrong password, bad database, INFO forbidden, slow, silent, refused, malformed replies); **TLS (`rediss://`) is implemented with Node's standard TLS client but was not exercised** against a real server here.

## 4. Typesense
With PostgreSQL as the search provider (the default) there is no cluster: the endpoint says `skipped` and readiness does not require it. With `SEARCH_PROVIDER=typesense` it is required, and `/health/typesense` pings it (administrators also see the collection count). Deeper search monitoring (index drift, disk and memory) is in `OBSERVABILITY.md`.

## 5. Using them

Kubernetes:
```yaml
livenessProbe:  { httpGet: { path: /api/v1/health/live,  port: 4000 }, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /api/v1/health/ready, port: 4000 }, periodSeconds: 5,  timeoutSeconds: 4, failureThreshold: 2 }
```
Keep `timeoutSeconds` above `HEALTH_CHECK_TIMEOUT_MS`. Load balancer / uptime monitor: point the target group at `/health/ready`. `docker-compose.yml` keeps using `/health/liveness` for the container check (unchanged); the web container waits on the database through its own `depends_on`, so readiness is not needed there.

## 6. Behaviour of the existing `/health` report
`/health` is the Terminus report it always was (database, search, storage and heap, 503 if any is down), now including Redis. Two things to know: storage counts as **critical** in `/health` (a storage outage turns it 503) but only **optional** for `/health/ready`, which is the endpoint to use for traffic decisions; and a skipped component used to disappear from the report because Terminus only lists results whose status is exactly `up` or `down`: it is now listed as `up` with a `note` such as `skipped_postgres_active`.

## 7. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HEALTH_CHECK_TIMEOUT_MS` | 2000 | Longest one dependency check may take |
| `HEALTH_CACHE_MS` | 2000 | How long a result is reused |
| `LIVENESS_MAX_LAG_MS` | 5000 | Event-loop delay at which liveness fails |
| `HEALTH_SHUTDOWN_DRAIN_SECONDS` | 0 | Keep serving (not ready) this long after a shutdown signal |
| `REDIS_REQUIRED` | false | Make readiness depend on Redis (only when one is configured) |
| `READINESS_REQUIRES_STORAGE` | false | Make readiness depend on object storage |
| `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_USERNAME` / `REDIS_DB` / `REDIS_TLS` | none | Redis to check |

## 8. Limits
- Results are per instance; each instance answers for itself.
- Readiness checks reachability, not correctness: it does not verify that the schema is migrated or that data is present.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) has no health endpoints of its own here.
