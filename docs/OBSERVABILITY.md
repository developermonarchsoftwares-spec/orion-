# Monitoring and observability (Orion API)

Applies to `apps/api`. No database migration. Code: `src/common/observability/` (the building blocks) and `src/modules/monitoring/` (the reports, dashboard and alerts).

The pieces are dependency-free: there is no Sentry SDK and no OpenTelemetry SDK installed. Each is implemented against its documented wire format (see the notes on what that does and does not give you).

## 1. Structured logging

`LOG_FORMAT=json|pretty` (default `json` in production, `pretty` otherwise) and `LOG_LEVEL=debug|info|warn|error`. In JSON mode every log call is one line on stdout (warnings and errors on stderr):

```json
{"timestamp":"…","level":"info","service":"orion-api","context":"HTTP","message":"GET /api/v1/credit/wallet 200 14ms","requestId":"…","traceId":"…","spanId":"…","userId":"…","event":"http_request","method":"GET","route":"/api/v1/credit/wallet","path":"/api/v1/credit/wallet","status":200,"durationMs":14}
```
- Inside a request every line carries `requestId`, `traceId`, `spanId` and (when signed in) `userId`, which is how a log line is tied to a trace and to an error report.
- There is one access-log line per request: the **route pattern** (`/api/v1/exports/:id/download`), never the raw URL with its query string. A 5xx is logged as an error, a request slower than `SLOW_REQUEST_MS` (default 1000) as a warning with `slow:true`, health and metrics polling at debug level. (Silent under `NODE_ENV=test` unless `ACCESS_LOG=true`.) The client address is logged as `ip`.
- Messages, fields and stack text are scrubbed of e-mail addresses, bearer tokens, JWTs, `password=`/`token=` pairs, connection strings, key prefixes (`whsec_`, `rzp_live_` …) and long digit runs before they are written.

## 2. Distributed tracing

W3C Trace Context: an incoming `traceparent` (from the web gateway, a browser or a caller) is continued and its sampling flag honoured; otherwise a trace starts here. Every response carries `traceparent` and `x-trace-id`.

- **Spans:** one server span per request (named by method and route pattern, with status and user id), a child span for every database query (named by operation only, `db.select`, never the SQL or its parameters) and for outbound calls (`http.client`, with the target host). `tracer.withSpan(name, attrs, fn)` adds your own.
- **Sampling:** `TRACE_SAMPLE_RATE` (default 1 outside production, 0.1 in production). Spans of every request are kept in memory regardless (newest 3000) for the dashboard; only sampled ones are exported.
- **Export:** set `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`), optional `OTEL_EXPORTER_OTLP_HEADERS` (`key=value,key=value`) and `OTEL_SERVICE_NAME`. Sampled spans are sent as OTLP/HTTP JSON every 5 seconds to any OpenTelemetry collector or compatible backend (Tempo, Jaeger, Honeycomb, Datadog, …). A failed batch is counted and dropped, never retried forever.
- **Admin:** `GET /monitoring/traces` (slowest recent requests) and `GET /monitoring/traces/:traceId` (the spans held for one trace).
- **Continuing across services:** the mail relay call carries `traceparent`. For a full end-to-end trace the web gateway must forward the `traceparent` header to this API.

Limits: this is not the OpenTelemetry auto-instrumentation suite. Spans exist for HTTP requests, PostgreSQL queries and outbound webhook / CRM / alert calls; not for the search client, object storage or queue jobs (a queue job is not linked to the trace of the request that created it). The in-memory span store is per instance.

## 3. Metrics (Prometheus)

`GET /api/v1/metrics`, text exposition format. **Never public:** send `Authorization: Bearer <METRICS_TOKEN>` (set `METRICS_TOKEN`, at least 16 characters, for the scraper) or an administrator token; otherwise 401. Example scrape job:

```yaml
- job_name: orion-api
  metrics_path: /api/v1/metrics
  authorization: { type: Bearer, credentials: <METRICS_TOKEN> }
  static_configs: [{ targets: ['api.example.com'] }]
```

| Metric | Meaning |
|---|---|
| `http_requests_total{method,route,status_class}` | Requests (route is the pattern or `unmatched`: bounded) |
| `http_request_duration_seconds` (histogram), `http_requests_in_flight` | Latency, concurrency |
| `db_query_duration_seconds{operation}`, `db_slow_queries_total`, `db_query_errors_total` | Database latency (slow = `DB_SLOW_QUERY_MS`, default 500) |
| `db_pool_connections{state}`, `db_pool_max_connections`, `db_up`, `db_ping_seconds`, `db_size_bytes`, `db_server_connections{state}` | Pool and server |
| `outbound_request_duration_seconds{target}`, `outbound_request_errors_total{target}` | Webhooks, HubSpot, alert webhook |
| `queue_jobs{queue,status}`, `queue_oldest_waiting_seconds`, `queue_stuck_jobs` | Queues |
| `search_up{provider}`, `search_documents{collection}` | Search |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `nodejs_heap_limit_bytes`, `process_cpu_percent`, `nodejs_eventloop_lag_p99_seconds`, `process_uptime_seconds`, `app_info` | The process |
| `errors_captured_total{source}`, `traffic_limited_total{reason}`, `tracing_spans_total` | Errors, protection layer, tracing |

A metric stops adding label combinations at 500 (counted in `orion_metrics_dropped_series_total`), so a label fed by user input cannot grow memory.

## 4. Error tracking (Sentry)

Set `SENTRY_DSN` (also `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_SAMPLE_RATE`, `SENTRY_MAX_EVENTS_PER_MINUTE`). Reported: unexpected exceptions (5xx that are bugs), failed upstreams (502 and similar, as warnings), a queue job that fails its last attempt, and fatal process errors. **Not** reported: client errors (4xx) and deliberate 503s such as "payments not configured".

Each report carries the error type, a scrubbed message, the stack (paths relative to the app), the method and path (query values removed, ids generalised), headers with `Authorization`, cookies and API keys dropped, the **user id only** (no e-mail or name), the request id, the trace id (so Sentry links to the trace), release and environment. Never the request or response body. Repeats are grouped: at most 5 reports per distinct error per minute and `SENTRY_MAX_EVENTS_PER_MINUTE` (default 60) overall; a 429 from Sentry is honoured. Sentry being slow or down never affects a customer response.

**Fatal errors:** an uncaught exception or unhandled promise rejection is logged, reported (level `fatal`), given up to 2 seconds to leave the process, and then the process **exits with status 1**, exactly as Node does by default. (This was verified with a real process, including a slow receiver.)

`POST /monitoring/test-error` (administrator) sends a warning-level test event; `GET /monitoring/errors` lists recent captured errors even when no DSN is set.

What this is not: the full Sentry SDK. There are no breadcrumbs, release health, source maps, profiling or session replay. The envelope format follows Sentry's published developer documentation and is tested against a local receiver, **not against a live Sentry project**: send the test event after configuring the DSN. To get the SDK's extras, install `@sentry/node` and report from it; `captureException` in `common/observability/error-tracker.ts` is the one place to change.

## 5. System dashboard and health reports

`GET /api/v1/monitoring/dashboard` is a single page with no data of its own: it asks for an **administrator access token** (kept for the browser tab only) and refreshes `GET /monitoring/overview` every 10 seconds. It shows status, alerts, request rate / error rate / latency, process memory, CPU and event-loop delay, database, queues, search, slow routes, recent errors and tracing. Everything is inserted as text, never HTML.

| Report | Contents |
|---|---|
| `GET /monitoring/overview` | Everything below in one call (`?fresh=true` bypasses the 10-second cache) |
| `GET /monitoring/database` | Reachability and latency; pool (total / idle / waiting / max); server connections by state, the longest-running query and the oldest idle-in-transaction connection; locks waiting; size; cache hit ratio; commits, rollbacks, deadlocks, temp files; top tables by dead tuples; migrations applied. Statistics views the database does not offer (an embedded or tightly managed server) are reported as `null`, with a note |
| `GET /monitoring/queues` | Per queue: counts by status, oldest waiting job, jobs stuck active for over 10 minutes, completed / failed in the last hour, failure rate, status; recent failures (queue, job, attempts, **scrubbed** error). Job data is never shown |
| `GET /monitoring/search` | Typesense: health, version, memory / disk use, latency, per-collection document counts, **drift** between indexed documents and published businesses, sync failures in the last 24 h. With the default PostgreSQL search there is no cluster: it says so |
| `GET /monitoring/alerts` | The alerts firing now |

## 6. Alerts

| Alert | Fires when |
|---|---|
| `http_errors` | 5xx rate over 5 minutes above 1% (warning, ≥50 requests) or 5% (critical, ≥20 requests) |
| `http_latency` | p95 above 2 s (warning) or 5 s (critical) |
| `event_loop`, `heap` | Event-loop delay p99 above 200 ms / 1 s; heap use above 85% / 95% of the limit |
| `db_down`, `db_slow`, `db_pool`, `db_connections`, `db_idle_tx`, `db_locks` | Unreachable; ping over 500 ms; requests waiting with the pool full; over 80% of server connections; a transaction idle over 5 minutes; more than 3 lock waits |
| `queue_stuck`, `queue_backlog`, `queue_failures` | Per queue: a job active over 10 minutes; oldest waiting job over 5 min (warning) / 15 min (critical); 5 or more failures in an hour |
| `search_down`, `search_drift`, `search_disk`, `search_memory` | Cluster unreachable; index differs from the database by over 5%; disk or memory over 90% |
| `error_tracking_off` | Production without `SENTRY_DSN` (informational) |

Overall status: any critical alert is `CRITICAL`, any warning `DEGRADED`, otherwise `OK`. Set `MONITORING_ALERT_WEBHOOK_URL` (a Slack-compatible incoming webhook; the body is `{text, alerts}`) and a message is sent once when an alert starts, once when it resolves, and as a reminder every 6 hours while a critical one persists. The URL goes through the same outbound-request guard as customer webhooks (https only unless the private-network flag is on).

## 7. Configuration

| Variable | Purpose |
|---|---|
| `LOG_FORMAT`, `LOG_LEVEL`, `SLOW_REQUEST_MS`, `ACCESS_LOG` | Logging |
| `TRACE_SAMPLE_RATE`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | Tracing |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_SAMPLE_RATE`, `SENTRY_MAX_EVENTS_PER_MINUTE` | Error tracking |
| `METRICS_TOKEN` | Bearer token for the Prometheus scraper |
| `DB_SLOW_QUERY_MS` | Slow-query threshold |
| `MONITORING_ALERT_WEBHOOK_URL` | Alert notifications |
| `APP_VERSION`, `GIT_SHA` | Reported as the release and shown in the dashboard |

## 8. Limits

- Everything held in memory (rolling statistics, recent spans and errors, alert state) is **per instance** and starts empty after a restart. With several instances, scrape each one (Prometheus does this) and let the backends aggregate.
- Rolling percentiles are estimated from a histogram (accurate to the bucket width), not exact.
- Database statistics depend on what the server exposes; a managed database may hide some of them.
- Not built: log shipping, uptime checks from outside, synthetic transactions, anomaly detection, an incident or on-call workflow, a frontend beyond the dashboard page.
- The Next.js gateway (`ownus/src/app/api/v1/[...path]/route.ts`) is not instrumented and has its own logging.
