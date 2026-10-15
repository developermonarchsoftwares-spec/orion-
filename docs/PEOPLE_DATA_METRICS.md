# Data quality & pipeline metrics (Phase 6.14)

Internal, **read-only**, admin-only (SUPER_ADMIN, ADMIN) observability over existing data. It stores nothing, has no status or lifecycle, and computes no score, ranking or prediction. It returns counts, durations and machine codes only: never contacts, names, payloads, source configuration, reviewer data or text.

* `GET /internal/people-metrics/overview?from&to`
* `GET /internal/people-metrics/problem-batches?from&to&page&limit` (paginated, newest first, ties by id)

Customers 403, anonymous 401, data managers 403. Admin UI: sidebar **Data Quality Metrics**.

## Date range
`from` / `to`: ISO 8601, inclusive at both ends, omitted = all time; invalid or inverted ranges are 400. The range applies to the **creation time** of what is counted: events (import batches, quarantine rows, observations, conflicts by first detection, publish queue, acquisition runs, suppression registry) and, for state sections, the people / roles created in the range *as they stand now* (`asOf`).

## Metrics (all derived with aggregate SQL)
| Section | Source | Facts |
| --- | --- | --- |
| acquisition | `import_batches`, `people_ingestion_quarantine` | uploads, by status; rows total / processed / accepted / rejected / duplicates; People received / created / updated / skipped / quarantined / rejected / errors; quarantine by status and top reason codes |
| companyResolution | keyed `people_observations` | matched, not found, ambiguous |
| identity | keyed observations, `people_suppressions` | suppression hits, duplicate identity attempts (`AMBIGUOUS_IDENTITY`), registry size |
| contacts | `people`, `person_contacts`, open contact conflicts | people with e-mail / phone / LinkedIn / any, missing contacts (suppressed people excluded) |
| review | `company_people` | pending, approved, rejected, quarantined, published |
| verification | `company_people` | verified, partially verified, unverified, disputed (`CONFLICTED`), stale (stored `STALE`, or `VERIFIED` older than the existing 365-day window) |
| classification | `company_people` | classified vs `UNKNOWN`, decision makers, by classification source and taxonomy version |
| conflicts | `people_conflicts` | open by type, open and resolved totals |
| pipelineHealth | batches, `publish_queue`, `people_acquisition_runs` | failed batches, batches with People errors, failed rows, publish failures / retries, batch processing seconds (average, p95, max), acquisition runs by status with retries |

Company-resolution and identity figures come from keyed observations (the keyed upload and source paths); unkeyed writes have none.

## Performance
Every figure is one aggregate statement (`count(*) FILTER`, `sum`, `percentile_cont`); the 16 statements run concurrently and no table is loaded into the application. Range filters use existing indexes where they exist (`import_batches_created_at_idx`, `company_people_review_idx`); the others are scans of creation time on tables that are small relative to the people tables. No index was added: nothing here was profiled as slow. If `people_observations` or `people_ingestion_quarantine` grow large, add `created_at` indexes then.

## Non-goals
Quality or lead scores, ranking, ML, alerts, new statuses, customer exposure, external providers.
