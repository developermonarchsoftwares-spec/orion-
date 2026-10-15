# Performance, resource exhaustion and resilience review (Phase 29)

Date: 2026-10-13. Everything below was measured on one developer machine against disposable local databases (`orion_scratch_phase29`, `orion_scratch_phase29b`) with synthetic data. Nothing ran against production or Neon, no real payment was made, nothing was committed, pushed or deployed, no credential was printed. **The numbers are relative evidence from a single Windows 11 machine where the load generator, the API (one Node process), and PostgreSQL share the same CPU. They are not capacity figures for production hardware, and no target in this document has been met on production infrastructure.** CPU utilisation was not measured (only latency, throughput, process memory and database plans); no soak run was done.

## 1. Workload and resource inventory

| Operation | Size / limit found in code | Access pattern | Rate limit / timeout | Tests that exist |
|---|---|---|---|---|
| Discovery search (public-masked) | 20 per page, 100 max, page ≤ 100,000; free text is `ILIKE '%term%'` on name and legal name; location filters use `LOWER(col) = LOWER(x)` | one count plus one page query plus 5 enrichment reads (10 statements) | 60 per minute per address (route limit) | `discover-hardening`, `lead-discovery-unlock` |
| Unlock and credits | 1 credit per unlock; advisory lock plus `FOR UPDATE` on the wallet | one short transaction, about 15 statements | 30 per minute per address | `financial-integrity`, `pg-concurrency` |
| Customer reads (wallet, history, dashboard, saved items) | pages capped at 100 | 4 to 17 statements | default per-customer limit (20 per minute observed on the wallet route) | `database-security`, `api-contract` |
| Exports | 5,000 rows per export, 20,000 rows per day, one at a time per customer, 10 per minute | one query set, built in memory, sent as one buffer | route throttle plus concurrency gate | `export-security`, `scheduled-export-*` |
| Business CSV import | 5,000 rows, 10 million characters, 200 columns, 20 MB body (admin routes only) | processed inside the upload request, 2 statements per row for the preview | submit 10 per minute | `admin-import-pipeline`, `import-export` |
| People import | 10,000 rows, one run at a time (advisory lock), 3 attempts | queue job | queue retry bound | `people-*` suites |
| Duplicate detection | candidates capped at 20 per company | per-row lookups | inside import | `provenance-publishing` |
| Retention and privacy deletion | 20,000 rows per rule per run, batched `UPDATE/DELETE ... LIMIT` | sub-select batches | scheduled job | `privacy-*` suites |
| Audit logging and monitoring | one insert per audited action; in-process rolling statistics bounded (300 routes, 3,000 traces) | single-row inserts | n/a | `monitoring`, `audit-logging` |

## 2. Test environment and dataset

PostgreSQL 18.3 on the same machine; API from `dist` (`node dist/main.js`), `NODE_ENV=development`, pool of 20 connections (`DB_MAX_CONNECTIONS`), generated test secrets, `TRAFFIC_CONTROL_ENABLED=false` for throughput runs (the limiter is measured separately). Synthetic dataset (`p29_seed.sql`, 141 s to load, 249 MB): 100,000 companies (90 % published), 100,000 locations over 20 cities, 160,000 contacts, 100,000 scores, 39,836 websites, 30,000 GSTINs, 5,000 customers with wallets, 90,000 unlocks, 50,000 ledger rows, 30,000 people with roles. 300,000 audit rows were added for the retention test. Tools: the repository's `ops/testing/load-test.mjs` and small Node scripts kept outside the repository.

## 3. Database and query findings (representative plans, 100,000 companies)

| Query | Server execution | Plan |
|---|---|---|
| count, no filter | 7.5 ms | index-only scan on status |
| page 1, order by name, id | 0.2 ms | index scan on the name index |
| page 3,000 (offset 59,980) | 39 ms | index scan, 14,169 buffers: offset cost grows with the page number (capped at page 100,000) |
| count / page, `q` as `ILIKE '%text%'` | 91 ms / 62 ms | **sequential scan** of the table (leading wildcard: no index can help) |
| count / page, city and state with `LOWER()` | 43 ms / 141 ms | sequential scan of locations, then nested loop |
| count, five contact/score filters together | 121 ms | hash joins, parallel |
| unlock history, credit history, unlock lookup (per customer) | 0.1 to 0.7 ms | index scans |
| industry filter count | 3.4 ms | bitmap index scan |

Every per-customer query uses an index. Only the free-text and the location predicates are linear in the number of companies. **Evidence-based proposal, not applied:** trigram indexes (`pg_trgm`, GIN) on `businesses.name` and `legal_name`: on this dataset the `q` count falls from 94.5 ms to 11.9 ms (8 times), the two indexes add 10 MB to a 24 MB table, and a bulk insert of 20,000 rows takes 1,315 ms instead of 656 ms (2 times slower). At 100,000 companies the sequential cost is within the proposed targets (section 5), so the index is a decision for when the table is roughly ten times larger, and it needs the extension enabled on the production database and a rehearsed migration. A functional index on `LOWER(city)` has the same status.

## 4. Baseline measurements (before any change)

**Search over HTTP, sequential, one client (about 54 samples each)**

| Shape | p50 | p95 | p99 |
|---|---|---|---|
| no filter | 12 ms | 23 ms | 59 ms |
| free text `q` | 99 ms | 162 ms | 307 ms |
| city + hasEmail + hasWebsite | 65 ms | 170 ms | 172 ms |
| page 2,000 | 21 ms | 38 ms | 80 ms |

**Search over HTTP, a burst of 40 clients at once** (the 60 requests the per-address limit lets through): no filter p50 13 ms, p95 17 ms; page 2,000 p50 26 ms, p95 136 ms; score filter p50 14 ms, p95 47 ms; city combination p50 273 ms, p95 746 ms; **free text p50 993 ms, p95 1,691 ms, p99 1,974 ms** (40 requests in flight, each a table scan). This is the first bottleneck. It is bounded by the 60-per-minute-per-address route limit, which a distributed client population does not respect.

**Customer reads, 20 workers for 15 s**

| Route | Different customers: completed, p50 / p95 / p99 | One customer: completed, p50 / p95 |
|---|---|---|
| wallet | 6,407 (427 per s), 45 / 55 / 67 ms | 5,719, 51 / 60 ms |
| dashboard | 3,226 (215 per s), 90 / 104 / 115 ms | 2,240, 133 / 150 ms |
| unlock history | 3,468 (231 per s), 83 / 112 / 152 ms | 3,144, 93 / 120 ms |

A single client gets the wallet in 4 ms (p95 5.5 ms). The wallet read issued 8 statements, and the dashboard 17. The limiter itself is cheap: 20 workers hammering a limited route were refused at 2,300 per second with p95 11 ms.

## 5. Targets

`TESTING_STRATEGY.md` already proposes: search and discover p95 ≤ 800 ms at 20 concurrent clients, dashboard and credits p95 ≤ 600 ms at 20, error rate ≤ 1 %. **Status on this machine:** wallet, dashboard and history meet them with wide margin (p95 below 150 ms at 20 workers); search meets them sequentially and for every shape except free text under a 40-client burst (p95 1,691 ms). No target was verified on production-class hardware or against a production-size dataset; that remains a pre-release step.

## 6. Bottlenecks and resource-exhaustion findings, with fixes

| # | Finding (evidence) | Impact | Fix | Before → after |
|---|---|---|---|---|
| P-1 | **Pool self-deadlock at the daily rollover.** The first wallet read of a new day opened a transaction and, inside it, read the daily-allowance setting through the pool, so each rollover held one connection and waited for a second. 60 simultaneous first-reads against a pool of 20 left every connection waiting for another until the 15 s connection timeout. | Availability: at the UTC day change, any burst larger than the pool takes the whole API down for 15 s and fails most of those requests | The setting is read on the transaction's own connection (`dailyAmountOn`), in both places that did it (rollover and deduction) | pool 20, 60 simultaneous: **4 ok, 56 HTTP 500 after 15.3 s → 60 ok in 0.44 s**; 200 simultaneous: 200 ok in 0.96 s; pool 2, 10 simultaneous: 10 × 500 after 15.1 s → 10 ok in 0.11 s |
| P-2 | **Every wallet read took a row lock.** `getWallet` opened a transaction and `SELECT ... FOR UPDATE` on every call, even when nothing needed writing, so reads queued behind each other and behind the customer's own spending (8 statements per read). | Latency and throughput of the three most-called customer routes | A fast path: a wallet whose daily allocation is already today's is returned from one plain read; the locked path remains for the first read of a day and for a missing wallet | wallet 8 → 5 statements, dashboard 17 → 13; 20 customers: 6,407 → 7,570 completed, p50 45 → 37 ms, p95 55 → 47 ms; one customer: 5,719 → 7,710, p50 51 → 37 ms, p95 60 → 44 ms; dashboard (one customer) p50 133 → 115 ms |
| P-3 | **A lock wait could hold a pooled connection for 30 s** (the Phase 27 default) and a held row lock was answered with a 500. With a 2-connection pool, six unlock requests waiting on one customer's wallet row kept another customer waiting 8.8 s; with a pool of 20 and 30 waiters (more than the pool) another customer's read waited 2.96 s. | Availability: one stuck row lock can starve the pool | Default `lock_timeout` 30 s → 5 s (a lock is held for milliseconds normally). A lock timeout, statement timeout, deadlock, serialization failure, idle-in-transaction kill or server shutdown is now a **503 `DATABASE_BUSY` with `Retry-After: 2`**, a warning in the error tracker, never a 500 | 6 waiters, pool 20: other customer 52 ms (unaffected); waiters get 503 after the lock timeout instead of 500 |
| P-4 | **A killed import cannot be finished.** The upload is processed inside the request. A process killed 3.5 s into a 5,000-row upload left the batch `PROCESSING` for good with 4,542 rows never reached; `retry-failed` only re-ran `FAILED` rows. No partial business data was written and no connection was left idle in a transaction, so the failure was safe but permanent. | Integrity of a pipeline step; operator dead end | For a batch still `PROCESSING` and idle for 15 minutes, `retry-failed` runs the rows that were never reached (pending, normalized, validated) first, 1,000 per call, and keeps the batch resumable until every row is reached; a finished batch's rows are never touched and a recent run is refused (409) | real kill and recovery: 5 calls (6.8, 6.8, 6.1, 6.2, 3.3 s) reached all 5,000 rows; batch `COMPLETED`. Before: stranded |

## 7. Concurrency and integrity results (real PostgreSQL, over HTTP, pool of 20; the API's per-address limit was avoided by sending each request from its own loopback address)

| Scenario | Result |
|---|---|
| 60 customers x 5 distinct unlocks at once (300 requests) | 300 of 300 succeeded, wall 2.74 s (about 110 unlocks per s), p50 2.64 s; every wallet equals its parts, ledger equals unlock count equals lifetime spent |
| 1 customer, same company, 60 parallel requests | all 200, exactly one charged, balance 10 → 9 |
| 3 credits, 40 different companies at once | exactly 3 succeeded, 37 answered 402, balance 0, ledger consistent |
| 300 simultaneous requests (200 wallet reads + 100 unlocks) against a pool of 20 | 0 server errors in 1.04 s, a normal request afterwards 15 ms, no connection idle in a transaction |
| All database connections killed twice while 10 workers read the wallet at 240 per s | 10 requests in flight at the second wave got a 500; every other request succeeded; service continued without restart; the pool replaced the connections within the same second |
| Process killed during an import | no partial business rows, no idle transaction, batch resumable (P-4) |
| 6 simultaneous exports by one customer | 1 accepted, 5 answered 429 in 9 to 12 ms |

The existing opt-in suite `pg-concurrency` (12 parallel unlocks, payments, webhooks, refunds, saved leads, first-wallet creation, timeouts) ran again after the changes (section 9).

## 8. Import, export and retention

- **Export:** 5,000 rows (the cap) in 714 ms (CSV, 913 KB), 640 ms (XLSX, 248 KB), 70 ms (saved leads CSV). Process working set 117 MB → 182 MB after the first rounds and flat over three further rounds (no growth observed in this bounded test; not a soak). Concurrency gate holds (above). Formula-injection and suppression behaviour is covered by the unchanged `export-security` suite.
- **Import preview and submit (admin):** 500 rows 1.7 s; 2,000 rows 5.8 s; 5,000 rows 14.1 s for the preview (about 2.8 ms per row; 2 statements per row); submits 3.5 s, 7.0 s, 7.3 s. During a 14 s preview the event loop was not blocked (concurrent wallet reads p95 9 ms against 7 ms idle). 5,001 rows → 400; a 21 MB body → 413; an unreadable CSV → 400 with a readable report. Process working set rose from 113 MB to about 440 MB over three imports; whether it plateaus was not established (one run). The whole file is parsed in memory by design (cap 5,000 rows and 10 million characters); there is no streaming path.
- **Retention:** dry run over 300,000 audit rows counted in 53 ms; applying removed 20,000 rows (the per-run cap) in 430 ms while concurrent single-row inserts stayed at 1 ms median and 44 ms maximum. **A backlog of 212,500 rows remained**: each scheduled run handles at most 20,000 rows per rule, so a table that gains more than 20,000 old rows a day never catches up (R-064).
- Not exercised: a People import of the 10,000-row maximum, bundle imports, scheduled exports in bulk, integration delivery retries at volume, queue depth under sustained load.

## 9. Tests and results

Working tree, 2026-10-13. Commands from `apps/api` unless noted.

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `node ops/security/scan-secrets.mjs` (root) / `npm run test:inventory -- --check` | 0 findings / passed |
| `npm run test:unit` | 45 suites, 850 tests passed (the filter spec gained 7) |
| `npm run test:integration` | 41 of 42 suites passed, 1 skipped; 970 passed, 13 skipped, 0 failed |
| `npm run test:security` / `npm run test:perf` | 9 passed / 3 passed |
| `npm run test:e2e` with `CONCURRENCY_DATABASE_URL` set to the empty scratch database `orion_scratch_phase29b` (so the real-PostgreSQL suite ran) | 42 of 43 suites passed, none skipped; 666 passed, 3 todo, **1 failed**: `health-probes` "reports every dependency ... 503 when a configured one is down", the known timing-sensitive test; re-run alone three times: 20 of 20 passed each time; not changed |
| new `performance-resilience.e2e-spec.ts` | 5 passed. The rollover test **hung (timed out) before the pool-deadlock fix**, because the single-connection test engine cannot serve a second query while a transaction is open: it is a deterministic detector of that bug class |
| `import-export.e2e-spec.ts` | 20 passed, with two new tests (a run that died part-way is finished; a larger-than-one-call backlog stays resumable). Fail-first: with the new logic disabled the first test received 0 attempted rows instead of 2 |
| real-PostgreSQL suite `pg-concurrency` (inside the e2e run above) | 10 passed (7 existing, 3 added in Phase 27) after the credit changes |
| `all-exceptions.filter.spec.ts` / `pool-settings.spec.ts` | transient database codes answer 503 `DATABASE_BUSY` with `Retry-After` and no internal text; other codes stay 500; lock wait default is between 1 and 10 s |
| Load, concurrency, resilience and recovery runs | sections 4 to 8, against the scratch API and database, with the scripts kept outside the repository |

Not run: Playwright, lint, Docker, CI, the web app tests (no web code changed in this phase), any production or Neon database.

## 10. Recommended production monitoring

Alert on: HTTP 503 `DATABASE_BUSY` rate and the database codes `55P03`, `57014`, `25P03` in logs (the new limits make them visible); pool utilisation (connections in use against `DB_MAX_CONNECTIONS`, and waiting requests); `idle in transaction` sessions older than 10 s; p95 and p99 of search (free text and location filters separately) against the 800 ms target; row-lock waits on `user_wallets`; process memory over time during imports and exports; import batches in `PROCESSING` for more than 15 minutes (they are now resumable); audit-log growth against the 20,000-row retention cap; per-minute counts of 429 on search and unlock (a distributed client population shows as many addresses each under the limit).

## 11. Unresolved risks and approvals

| ID | Item | Needs |
|---|---|---|
| R-064 | Retention clears at most 20,000 rows per rule per run; a table gaining more than that per day grows without bound | Size against real audit volume; raise the cap or run more passes (config change) |
| R-065 | Free-text and location search are linear in the table size (91 ms at 100,000 rows; 8 times faster with trigram indexes; writes 2 times slower) | Approval for `pg_trgm`, a rehearsed migration, and a decision on write cost; revisit at about 500,000 companies |
| R-066 | Import preview/submit cost about 2.8 ms per row, 2 statements per row, inside one HTTP request (14 s at the maximum) | Optional: batch the per-row lookups; a client or proxy timeout under 15 s would cut a legitimate upload |
| R-067 | A refund calls the payment gateway inside the database transaction (holds a pooled connection and an advisory lock for the call) | Optional: call the gateway before the transaction; admin-only, low volume |
| R-068 | Per-address limits (60 searches, 30 unlocks per minute) do not bound a distributed population; behind a proxy they depend on `TRAFFIC_TRUSTED_IP_HEADER` | Confirm the production proxy header; consider per-customer limits for authenticated routes |
| R-069 | Every number here is from one machine with load generator, API and database together; no production hardware, no dataset above 100,000 companies, no soak, no CPU figures | A staging run on production-class infrastructure with the proposed targets before release |
| R-070 | Working set after imports (440 MB) not shown to plateau | A repeated-import soak with memory sampling |

Not run: Playwright, lint, Docker, CI, any production or Neon database, a soak or endurance test, a stress test beyond the bounded workloads above.
