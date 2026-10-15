# Database security, data isolation and transaction integrity review (Phase 27)

Date: 2026-10-13. Scope: the PostgreSQL access model, ORM and raw SQL, customer data isolation, transactions and concurrency, schema and migrations, field minimisation, and database-facing abuse limits. All tests ran against in-memory PostgreSQL (PGlite) or a disposable local scratch database (`orion_scratch_phase27`) with synthetic accounts. No production or Neon database was contacted, no role or credential was created, changed or rotated, no migration was added, nothing was committed, pushed or deployed, and no credential value was printed.

## 1. Database access model

| Aspect | Evidence | Finding |
|---|---|---|
| Credentials | one `DATABASE_URL` read from the environment (`config`, `database.provider.ts`); no literal in source (secret scan: 0 findings) | Good. Real values exist only in git-ignored env files. |
| TLS | `database/tls.ts`: a remote host always uses verified TLS; `sslmode`, `ssl`, `uselibpqcompat` in the URL are stripped so a URL cannot weaken it; only localhost runs without TLS (unit tested) | Good. |
| Runtime role | local development connects as the server's superuser (`postgres`, `rolsuper = true`; the server has one other role, `wateruser`, belonging to another project) | **Not least privilege locally.** The production role is unknown; historic evidence (`DATABASE_OWNERSHIP_MATRIX.md`) shows only an owner role and a service role at the old host. Nothing in the repository creates a restricted runtime role. |
| Migration role | there is no separate migration URL: `migrate.ts`, `seed.ts` and the audit tools use the same `DATABASE_URL` | Open (R-050): the running API can drop tables if the role it uses owns them. |
| Row-level security | 0 tables use it | Isolation is application-layer only (section 3). Acceptable for one application; it means a SQL injection or a missed `WHERE userId` has no second line of defence. |
| Pool | `max` 20 (`DB_MAX_CONNECTIONS`), idle 30 s, connect timeout 15 s | Adequate for one API instance; each additional instance multiplies the connection count against the server's limit (not checkable here). |
| **Server-side limits (new)** | before this phase: none. The pool had no statement, idle-in-transaction or lock timeout, so one slow or abandoned statement held a connection and its row locks until the process was restarted | **Fixed** (`database/pool-settings.ts`, applied in `database.provider.ts`): `statement_timeout` 60 s, `idle_in_transaction_session_timeout` 60 s, `lock_timeout` 5 s (30 s when first written; lowered in Phase 29), client `query_timeout` 65 s. Changed with `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`; 0 switches one off; an unusable value keeps the default. Migrations and tooling use their own connections and are not limited. |
| Deliberate exception | the People import run lock keeps one transaction open for the whole run and a second import waits on the lock (`people-import-job.service.ts`). The new limits would have ended both (silently dropping mutual exclusion) | The limits are lifted for that one transaction with `SET LOCAL` (ends at COMMIT). Verified on a real server. |
| Error exposure | the HTTP response is generic outside development/test (existing tests). **The server log was not**: a failed statement's message is "Failed query: <sql> params: <every bound value>" (observed in this phase's own run: bound values appeared in the log), and the log line included the query string | **Fixed** (`safeErrorText` in `all-exceptions.filter.ts`): logs and the error tracker receive the server error code, table, column and constraint only; the URL is logged without its query string. |

## 2. Query safety

- 287 uses of `sql`, `execute` or `query` in 53 files were reviewed by pattern. Raw SQL fragments (`sql.raw`) occur at six sites; at each, the raw part is a constant or a literal alias written in code (`people-metrics` date column, `contactEligibleForRoleSql('pc','cp')`, the company-name normaliser's column references, privacy retention table names). User text always reaches the database as a bound parameter.
- Sorting is an allowlist everywhere it exists (discover fallback and PostgreSQL provider, People review queue `IsIn`, Typesense sort rebuilt from an allowlist; Typesense values are quoted and the published-only clause is fixed and first). LIKE wildcards are escaped.
- Test: 13 hostile strings (quote breakers, `DROP TABLE`, `UNION SELECT password_hash`, `pg_sleep`, wildcards, a NUL byte, 5,000 characters, emoji, a JSON operator object) through seven query inputs (`q`, `city`, `industry`, `sortBy`, suggestions, business slug, saved-lead filters) plus a hostile saved search that is then run: 0 server errors, the `users` table intact, a search with `' OR '1'='1` returns no more than an empty search.
- **Defect found and fixed: non-integer and extreme paging values caused database errors (HTTP 500).** `limit=1.5` on saved leads and discover search, and `page=1e30` or `99999999999999999999` on saved leads and billing history, overflowed the offset or sent a fraction to `LIMIT`. Fixed with integer validation and ceilings on the two DTOs and `boundedPage` in billing history. Six customer lists were probed with ten bad values each: 0 server errors after the fix (14 before).
- **Defect found and fixed: unbounded bulk lists.** `bulk-save` and `bulk-delete` accepted any number of identifiers (bounded only by the 100 KB body limit, about 2,500 sequential saves of three queries each). Now at most 100 per request (HTTP 400 above).

## 3. Customer data isolation

Every customer-owned read or write was traced from the authenticated user (`@CurrentUser`, a signed token whose role and status are re-read from the database) to the query. Customer identity never comes from the body, query or a header. Result:

- Saved leads, saved searches, integrations, export jobs and schedules, invoices and billing history, credit history, unlock history, API keys, privacy requests: each lookup by identifier includes the owner (`userId`), or fetches then compares it, and answers 404 for another customer's row. Update/delete statements that follow an owner-checked fetch address the row by primary key only; the owner column is immutable, so this is safe, but it is a defence-in-depth gap (R-053, Low).
- Bulk delete filters on `userId` as well as the identifiers. A client-supplied `userId` in a body is refused (unknown property); in a query it is ignored.
- Test with two synthetic customers: B cannot read, run, change or delete A's saved lead (single and bulk), saved search (all four verbs), export schedule, invoice (JSON and HTML), export download or integration (get, delete, rotate); A's data is unchanged afterwards; A's unlock is invisible to B and the profile stays masked for B.
- Not covered by new tests, already covered earlier: export and billing isolation (`export-security`, `billing`, `financial-integrity`), People unlock and masking (`people-customer-contract`).
- Background jobs (scheduled exports, retention, queue) take the owner from the stored row, not from a request.

## 4. Transactions and concurrency

Reviewed: unlock (company and person), credit deduction/addition/adjustment, payment verification and refund, saved leads, wallet creation, People import and suppression. The pattern is consistent: a transaction, `SELECT ... FOR UPDATE` on the wallet, an advisory lock per (customer, item) or per payment, a re-check inside the lock, and unique indexes as the backstop. The existing opt-in real-PostgreSQL suite (`pg-concurrency`) proves it with overlapping connections; the hermetic suites run on a single-connection engine and cannot (documented in that spec).

Defects found with a failing test on a real server first, then fixed:

| # | Finding | Evidence | Fix |
|---|---|---|---|
| T-1 | **Duplicate saved leads.** The unique index covers only person leads (`WHERE person_id IS NOT NULL`); a company-level lead had none, and the save was find-then-insert. 12 parallel saves of one company by one customer left **10 rows**. A parallel person-lead save lost the race as a database error. | real PostgreSQL, before fix | find-or-create inside a transaction under a per-(customer, company, person) advisory lock (`saved-leads.service.ts`). After: exactly 1 row. A unique index remains the better backstop; it needs a data check first (section 5). |
| T-2 | **First wallet creation raced.** `ensureWallet` was find-then-insert; 10 parallel first reads raised unique violations (HTTP 500). Its welcome 5 credits had no ledger row, so the ledger did not add up to the balance. | real PostgreSQL, before fix: 10 of 10 calls failed or duplicated | one transaction: insert with `ON CONFLICT DO NOTHING`, read the winner when the insert lost, write the welcome ledger row only for the winner (`credit.repository.ts`). After: 1 wallet, 0 errors. |
| T-3 | **Saving a company that does not exist was a 500** (foreign-key violation), and a draft or archived company could be saved (its existence confirmed to the caller). | e2e, before fix | a new lead requires a published company; otherwise 404. Existing leads can still be edited. |

Verified unchanged: parallel unlocks of one company charge once; parallel unlocks never overspend; a payment verified or a webhook delivered many times credits once; parallel refunds reverse once; a purchase racing spends keeps ledger and balance equal (7 existing real-server tests, plus 3 new).

Not changed, recorded: quota checks (maximum integrations, schedules, API keys) are count-then-insert, so parallel requests can exceed a cap by a few (R-054, Low); there is no retry on a deadlock or serialization failure because the code uses the default isolation level with explicit locks, and the lock order is consistent (person lock, then customer-person lock, then wallet), so no deadlock was observed in the concurrency suite; no idempotency key is accepted from clients (duplicate payment and unlock protection is by natural key).

## 5. Schema and migration safety

- Applied migrations 0000 to 0025 were not touched and **no migration was added**. A fresh database built from the files passes `npm run db:audit`: 68 tables, 0 missing, 0 drift, hash mismatches none.
- Unique and foreign keys cover the intended relationships (wallet per user, unlock per user and company or person, payment id, invoice per payment).
- **Cascades:** deleting a `users` row cascades to wallets, ledger, payments, invoices and unlocks, and deleting a `businesses` row cascades to unlocks. No application code hard-deletes users, businesses or people (privacy erasure anonymises; companies are archived), so this is reachable only by someone running SQL by hand. Financial history must not be removed that way; runbook note added (R-051).
- 20 foreign-key columns have no leading index (all administrative, review or audit columns, e.g. `people_conflict_links.person_id`, `company_people.reviewed_by_id`). Only a parent delete or an admin filter scans them. Not changed (R-052, Low).
- **Recommended, not applied:** a partial unique index `saved_leads (user_id, business_id) WHERE person_id IS NULL`. Existing duplicates must be counted first (`SELECT user_id, business_id, count(*) FROM saved_leads WHERE person_id IS NULL GROUP BY 1,2 HAVING count(*) > 1`), merged by the owner of the data, and the migration rehearsed (`MIGRATION_REHEARSAL_PLAN.md`). The advisory lock above removes the cause in the meantime.

## 6. Sensitive data and minimisation

- Property names in 15 customer responses (account, profile, wallet and ledger, unlock history, saved leads and searches, subscription, billing history, invoices, export history and schedules, integrations, dashboard, privacy requests) were scanned for credential-like names (`password`, `hash`, `digest`, `refresh token`, `secret`, `otp`, `salt`, `mfa`, recovery codes): none. The login response carries the issued tokens by design and nothing else of that kind. The only match is the boolean `hasPassword`, which is a flag, not a value.
- A deleted or suppressed person, an unpublished company and a withdrawn contact remain excluded from search, saved-lead summaries, exports and unlock history (existing suppression and publication suites; unchanged and still passing).
- Repository reads use `select()` (whole rows) in several services and map to a response shape afterwards; the mapped responses were checked rather than the queries. Loading a full `users` row into memory occurs in a few services (integrations, exports, privacy) and the password hash is not logged (structured logger redaction, Phase 24).

## 7. Tests and results

Commands run from `apps/api` unless noted (working tree, 2026-10-13):

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `node ops/security/scan-secrets.mjs` (root) | 0 findings |
| `npm run test:inventory -- --check` (root) | passed |
| `npm run test:unit` | 45 suites, 843 tests passed (the filter spec gained 3) |
| `npm run test:integration` | 41 of 42 suites passed, 1 skipped; 969 passed, 13 skipped, 0 failed. A first run had 1 failure: the People import run lock test asserted the exact statement list; the three deliberate `SET LOCAL` statements were added to the expectation (not weakened) and it passes |
| `npm run test:security` | 9 passed |
| `npm run test:perf` | 3 passed |
| `npm run test:e2e` | 39 of 41 suites passed, 1 skipped (opt-in real-server suite), 1 failed; 638 passed, 10 skipped, 3 todo, **1 failed**: `health-probes` "reports every dependency ... 503 when a configured one is down", the known timing-sensitive test. Re-run alone three times: 20 of 20 passed each time. It was not changed |
| new `database-security.e2e-spec.ts` | 14 tests passed (13 on its first run, after fixes, plus the unknown-company test). Before the fixes: 3 of 13 failed (14 server errors on paging, a 413 where a 400 was intended, and the `hasPassword` flag, which is a boolean and was excluded in the test, not in the code) and the unknown-company test failed |
| `pg-concurrency` against the scratch database `orion_scratch_phase27` (`CONCURRENCY_DATABASE_URL`, empty local database, migrations applied by the spec) | 10 passed (7 existing, 3 new). Before the fixes the saved-lead test left 10 rows and the wallet test failed |
| `npm run db:audit` on the freshly migrated scratch database | 68 tables, 0 missing, no drift, no hash mismatch, hardened tables compatible |
| Read-only catalogue queries on the scratch database | 20 unindexed foreign keys (administrative); 0 tables with row-level security; roles: a superuser and an unrelated one |

Fail-first evidence: paging (14 server errors), unknown company (500), saved-lead race (10 rows from 12), wallet race (10 of 10 failed or duplicated) and the log content were each reproduced before the fix. The timeout test is a mechanism test (it proves the settings take effect on a real server), not a fail-first test.

Not run: Playwright, lint, Docker, CI, web app tests (no web code changed), any production or Neon database, a restricted-role run.

## 8. Unresolved risks and manual actions

| ID | Item | Owner action |
|---|---|---|
| R-049 | Runtime database role is a superuser locally and unknown in production; no restricted application role exists | When the production database exists: create an application role (DML only, no DDL, not the owner), a separate migration role, and put them in two URLs. Needs approval; nothing was created. |
| R-050 | No separate migration connection | Same as above; add a migration URL to the deploy procedure. |
| R-051 | Cascading deletes would remove financial history if a user or company row were deleted by hand | Never delete those rows with SQL; use the privacy erasure and archive paths. |
| R-052 | 20 administrative foreign keys unindexed | Revisit when tables grow. |
| R-053 | Updates after an owner-checked fetch address the row by id only | Optional defence in depth. |
| R-054 | Quota checks are not atomic | Optional lock per customer. |
| R-055 | Company-level saved leads have no unique index | Count duplicates, then a rehearsed migration (section 5). |
| R-056 | Pool limits are new defaults (60 s / 60 s / 5 s; the lock wait was 30 s until Phase 29 measured why that is too long) | Watch the first week of production logs for `57014` (statement timeout) and `25P03`; raise the setting if a legitimate bounded import is cut off. |
| R-057 | The idle-client `pool.on('error')` handler prints the raw error object | Low; the object holds connection details (host, port), not credentials. |

Not run: any test against a production or Neon database, a load test, a restore, a run with a restricted role (none exists), Playwright, lint, Docker, CI.
