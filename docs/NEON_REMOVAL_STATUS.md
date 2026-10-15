# Neon removal: status, migration policy and checklist

**Updated:** 2026-10-09 · **Goal:** local development uses the existing local PostgreSQL (`orion_db`); the Vercel production site keeps working; Neon is removed once a non-Neon production PostgreSQL provider is chosen and the data has been moved. **No production, Neon or Vercel change has been made.** Group A below is finished; Group B and C need approval.

## 1. What has been done (Step 2A and Group A)

| Area | Result |
|---|---|
| Local database | Verified backup and restore (`docs/LOCAL_DATABASE_PROTECTION.md`); allow-list, dry-run-by-default destructive scripts, confirmation and backup gates |
| User-visible wording | The four "saved to Neon" messages in the gateway, the admin activity text, and the dashboard card label now say "PostgreSQL" / "the database" (no behaviour change) |
| Comments and logs | Neon wording removed from the web libraries and pages, `admin-auth.controller.ts`, `queue.service.ts`, `verify-postgres-search.ts` and the scratch scripts' console labels |
| Environment templates | Unused `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` removed from `.env.production.example` and `apps/api/.env.example`; `DATABASE_URL`, `DB_MAX_CONNECTIONS` and `DB_IDLE_TIMEOUT_MS` kept; the production template is provider-neutral with a placeholder host (`db.example.com`) |
| Migration safety | `src/database/migration-journal.ts`, `__tests__/migration-journal.spec.ts` (13 tests) with `__tests__/migration-applied-baseline.json`, and `scripts/new-migration.ts` (`npm run db:migration:new`, `npm run db:migration:check`) |
| Gateway pooler rewrite | **Unchanged** (`ownus/src/lib/db.ts`), as agreed |
| Not touched | Applied migration SQL and timestamps, the database, the 19 pipeline tables, the staging suite, the `postgres` dependency, credentials, Vercel, historical incident documents |

## 2. Migration policy

**The trap.** Drizzle applies a migration only if its journal `when` is **greater than the newest `created_at` recorded in the target database**. A smaller value is skipped with no error. The journal has 16 entries (0008 to 0023) dated ahead of the calendar, up to 2027-01-09 (`1799500000000`), and the local database has applied all of them. A migration generated today with a 2026 date would never run on this database.

**Rules**
1. **Never change** the tag, `when` or SQL of an applied migration (0000 to 0023). `migration-journal.spec.ts` fails if any of them changes (the SQL is compared after normalising line endings, so a CRLF checkout does not matter). The two timestamp-rewrite options (editing the journal and the database's `created_at`) were rejected: they change migration metadata in every database and can re-run non-idempotent SQL.
2. **Create new migrations only with `npm run db:migration:new -- <name>`.** It checks the journal first, runs `drizzle-kit generate`, then sets the new entry's `when` to a value above every existing entry (currently `1799500000001`), and checks again. `--dry-run` shows the plan, `--print-next-when` prints the value, `--check` validates only. It never connects to a database and never applies anything.
3. If you ever run `drizzle-kit generate` directly, run `npm run db:migration:check` afterwards; the spec test also fails on a `when` that is not above the previous entry.
4. Apply with `npm run drizzle:migrate` after `npm run db:backup`. `drizzle:push` is gated by the Step 2A pre-flight and should not be used for normal changes.
5. A new migration must come with its snapshot (drizzle-kit creates it). The only migration without one is the hand-written `0003_seed_packages`.
6. New migrations are append-only and are not added to the baseline file.
7. A fresh database (a new provider) applies all 24 in order and is not affected by the future dates.

**Open items:** commit the untracked migrations (`0003` modification, `0004` to `0023`, 20 snapshots, the journal) in one reviewed commit (Group B); the committed `0003` text differs from the one applied locally only by a `--> statement-breakpoint` marker.

## 3. Neon references, categorised

### 3.1 Functional dependencies (do not remove yet)
| Where | What | When to change |
|---|---|---|
| `ownus/src/lib/db.ts` | Rewrites `-pooler.` to the direct host for the gateway (Vercel production). Possibly needed because a pooler can reject connection start-up options; unverified without touching Neon | At production cutover, after confirming the new provider's behaviour |
| `apps/api/src/database/migrate.ts`, `seed.ts`, `migration-target.ts`, `audit-migrations.ts`, `rehearsal-cli.ts`; `apps/api/scripts/audit-tables.ts`, `check-leads.ts`, `clean-fake-data.ts`, `clear-temporary-data.ts`, `verify-postgres-search.ts` | Same rewrite and the migration host-confirmation logic. No effect on `localhost` | Centralise or remove at cutover (Group C) |
| `apps/api/src/database/staging-guard.ts`, `test/setup-staging-env.ts`, `test/jest-staging.json`, script `test:e2e:staging` | Rehearsal suite that requires a remote host and refuses a local one | Group B decision: allow a local disposable rehearsal database, or keep remote-only |

### 3.2 Test fixtures that use a Neon-style host name (harmless; some test the rewrite)
`apps/api/src/database/__tests__/staging-guard.spec.ts`, `migration-rehearsal.spec.ts`, `tls.spec.ts`; `ownus/src/lib/__tests__/db-config.test.ts`, `admin-role.test.ts`, `scratch-scripts.test.ts`; wording in `people-review-concurrency.integration.spec.ts`, `test/helpers/test-app.helper.ts`, `test/setup-env.ts`. Change them together with the code in 3.1.

### 3.3 Dead configuration
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`: removed from the two templates (no code reads them). They may still be set in other environments (for example Vercel); harmless, remove when convenient. The living guide `docs/ENVIRONMENT_VARIABLES_GUIDE.md` may still list them.
- The `postgres` npm package in `apps/api/package.json` is never imported (Group B).
- `@neondatabase/serverless` appears only as an optional peer entry in `package-lock.json`; it is not installed.

### 3.4 Wording only (done)
Gateway messages, admin activity text, dashboard label, comments and log lines, scratch-script labels (see section 1).

### 3.5 Historical security-incident records (keep unchanged)
The `CREDENTIAL_*` documents, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`, `SECURITY_ASSESSMENT_2026-10-07.md`, `SECURITY_GAP_REPORT.md`, `SECURITY_REMEDIATION_SG02.md`, `SECURITY_TEST_RESULTS.md`, `PRIVACY_AUDIT_REPORT.md`. They describe what happened, so rewriting them would falsify the record.

### 3.6 Living operational documents (update after the provider is chosen)
`MIGRATION_RUNBOOK.md`, `UAT_RELEASE_RUNBOOK.md`, `ENVIRONMENT_VARIABLES_GUIDE.md`, `BACKUP_AND_DISASTER_RECOVERY.md`, `PRODUCTION_READINESS.md`, `TARGET_ARCHITECTURE.md`, `MIGRATION_REHEARSAL_PLAN.md`, `PHASE_A2_*` and `phase-a2/*`, `PRODUCTION_CHANGE_REQUEST_TEMPLATE.md`, `PRODUCTION_EVIDENCE_REPORT_TEMPLATE.md`, `PIPELINE_RUNTIME_RISK_REGISTER.md`, `DATABASE_OWNERSHIP_MATRIX.md`, `ORION_INTEGRATION_READINESS_REPORT.md`, and single mentions in the `PEOPLE_*` documents.

### 3.7 Untracked local artefact
`apps/api/staging-e2e.log` (untracked) still contains Neon host fragments from an earlier run. It is not in Git; delete it when you no longer need it (not done: no file deletions without your say).

## 4. Removal checklist

| # | Item | Group | Status |
|---|---|---|---|
| 1 | Protect local data: verified backup, restore test, script safeguards | 2A | **Done** |
| 2 | Neutral wording for UI labels, toasts, comments, logs | A | **Done** |
| 3 | Remove unused `DB_*` from the two env templates; provider-neutral production template | A | **Done** |
| 4 | Migration journal tests and the safe migration helper; policy written down | A | **Done** |
| 5 | Commit the migration files and the Step 2A and Group A changes (your review) | B | Pending approval |
| 6 | Staging suite: decide local disposable rehearsal database or remote-only; update `staging-guard.ts` and tests | B | Pending decision |
| 7 | Remove the unused `postgres` dependency (changes `package-lock.json`) | B | Pending approval |
| 8 | `docker-compose.yml`: stop mounting migrations 0000 to 0003 as init SQL (it conflicts with `drizzle:migrate`) or document that the native server is used | B | Pending decision |
| 9 | Align the local `import_batches.file_key` column (nullable locally, `NOT NULL` in the schema; `npm run db:audit` reports REVIEW_REQUIRED) | B | Pending decision |
| 10 | Decide what happens to the 19 tables that exist in `orion_db` but not in the Drizzle schema (`master_businesses`, `pipeline_jobs`, `schema_migrations`, `execution_logs`, and 15 more); the Orion app does not use them; a database built from migrations will not contain them | B | Pending decision |
| 11 | Choose the non-Neon production PostgreSQL provider | C | Not started |
| 12 | Build the production database from the migrations on the new provider (rehearse first) | C | Not started |
| 13 | Move production data from Neon to the new provider (needs read access to Neon; nothing is done here) | C | Not started |
| 14 | Point Vercel at the new database (environment variables, redeploy, health check) | C | Not started |
| 15 | Remove the gateway and script pooler rewrites; swap the Neon-style test fixtures | C | Not started |
| 16 | Update the living documents in 3.6; update `.env.production.example` if the provider needs different guidance | C | Not started |
| 17 | Revoke and delete the Neon project and credentials (after rotation records in `SECURITY_REMEDIATION_SG02.md` are complete) | C | Not started |

## 5. Risks to keep in view
- The Vercel production site still depends on whatever its environment points to (probably Neon); nothing in this work changes that.
- Neon production's migration state is unverified.
- The local database differs from a freshly built one (`file_key`, 19 extra tables).
- Local PostgreSQL 18.3 versus Docker Compose's PostgreSQL 16 and an unknown provider version.
- The migration files are uncommitted; they exist in the working tree and in the backups only.
