# People acquisition orchestration (Phase 6.9)

Makes registered sources safe to run at scale. `adapter → batch → limits/budget → ingestion (observations) → result → checkpoint`. No real source, no network, no Redis, no new queue: the existing Postgres queue (`QueueService`, queue `people-acquisition`) only wakes a worker with `{ runId }`; the run table is the authoritative state.

## Audit
Already existing and reused: source registry gate (`assertUsable`: registered, enabled, terms acknowledged) and policy; `IPeopleSourceAdapter` (`records()`, optional `fetch(cursor)`, declared but unused until now); Phase 6.2 observation identity (source, record, content, run); per-record failure isolation inside `PeopleIngestionService`; the `queue_jobs` queue (WAITING/ACTIVE/COMPLETED/FAILED, no cancel). Missing: a run identity, limits, budget, bounded retry, checkpoint, ownership. Added: migration `0016_people_acquisition_runs` (one table) and `AcquisitionOrchestratorService`.

## Run lifecycle
`QUEUED → RUNNING → COMPLETED | FAILED`, plus `CANCELLED` (QUEUED/RUNNING only). `FAILED → QUEUED` by `resumeRun` (optionally with a higher record limit or budget). COMPLETED and CANCELLED are final. A run records source, source version, limits, counters, cost units, opaque cursor, times and a failure code. Its `batch_ref` (`acq-<id>`) is the observation run id: record history stays in `people_observations`, nothing is duplicated.

## Limits, rate, budget
Per run (snapshotted): `maxRecords` (≤ the ingestion cap of 10 000), `batchSize` (≤ 1000, ≤ maxRecords), `maxCostUnits`, `maxRetries` (≤ 10), `backoffBaseMs`, `batchIntervalMs`. Invalid limits are refused at creation; a `records()` source that supplies more than `maxRecords` fails with `OVERSIZED_RUN` before anything is processed. Rate limit: `maxRunsPerHour` per source, checked under a per-source advisory lock when a run is created. Budget: records and **declared cost units** (`costUnitsPerRecord` on the adapter; no declaration = zero; no currency). A batch that would exceed the budget is not started: the run FAILs with `BUDGET_EXHAUSTED`, resumable with a higher budget. Throttling inside adapters / the network is not implemented.

## Safety gates
Refused safely at creation and re-checked before every batch: unregistered, disabled, terms not acknowledged. Source policy stays authoritative (applied by ingestion).

## Retry
Only transient failures are retried: an unexpected `PROCESSING_ERROR` of a record, an adapter `fetch`/`records()` that throws a non-`BusinessException`, or ingestion throwing one. Bounded (`maxRetries`) with deterministic backoff `base × 2^(attempt−1)` (no jitter, capped at 60 s). Never retried: invalid records, quarantine decisions, identity or company ambiguity, suppression, malformed data, any `BusinessException`. A record whose transient failure survives every retry is counted (`records_failed`) and never aborts the batch; resuming the run retries it.

## Checkpoint / resume
Counters and the cursor are written after every batch, in an owner-checked atomic UPDATE. A paged source (`fetch(cursor)`) resumes at the stored cursor exactly as returned (never invented); the cursor moves only when a whole page is done. A `records()`-only source (CSV/JSON/manual) has no cursor: on resume records already finished in this run are recognised through their observation (INGESTED, or QUARANTINED for a deterministic reason) and skipped (`records_skipped`), so they are neither re-processed nor re-charged.

## Idempotency
Replays reuse Phase 6.2 identity and the writers' own uniqueness: no duplicate people, roles, contacts, evidence or observations (tested, including replaying a finished run).

## Concurrency
`QUEUED → RUNNING` is one conditional UPDATE; exactly one caller wins, the other gets `RUN_NOT_STARTABLE`. Each checkpoint requires the worker's `claim_token` and `RUNNING`; a cancelled or taken-over worker is fenced out and stops. A worker that died is recovered when its lease (5 min, renewed per checkpoint) expires. A duplicate queue wake-up is a no-op. PGlite cannot prove parallel timing; tests prove the double-start and fencing logic deterministically.

## Failure isolation and security
One bad record never aborts a batch. The run row holds no records, payloads, credentials or tokens, failure text is capped at 300 characters and never contains record content. Nothing is exposed to customers; the upload → company import → People bridge is untouched and independent.

## Non-goals
Real external sources, scraping, source ranking/trust, conflict resolution, freshness policy, review triage, customer contract changes, Redis, new queue infrastructure, an admin API for runs, network throttling inside adapters.
