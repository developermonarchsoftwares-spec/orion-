# Credential target verification report (RR-25)

**Status: LOCAL, READ-ONLY FINDINGS FOR HUMAN REVIEW. No rotation, revocation, test, connection or change was made. No approval gate is passed.** Date: 2026-10-03. Repository: `D:\ownus`.

**No secret appears here.** Hosts are shown only as labels (`H1`, `S1`), never as values. Passwords, tokens and connection strings were compared in memory and not printed. Counts, booleans, paths, variable names, dates and short code facts are reported.

Evidence classes: **FACT** (verified locally from files, code or Git metadata), **INFERENCE** (reasoned, not proven), **OWNER STATEMENT** (said by the owner, not checkable here), **UNKNOWN / OWNER-ONLY** (needs an authorized person).

---

## 1. Executive summary
**Target status: `TARGET UNCONFIRMED`.** Local evidence cannot show whether the endpoint behind the credential is a dedicated test database, a development branch, or the production database. It does show enough to say the credential is **not proven test-only and is production-capable**.

- **What the credential is:** the owner-level role `neondb_owner` (role name; privileges unconfirmed) on one pooled Neon endpoint, label **`H1`**, database name `neondb` (the provider default), AWS `us-east-2`.
- **One real target, everywhere:** `H1` is the only real remote endpoint in the seven scratch scripts, both env files and **all 80 revisions**. No separate test endpoint exists in any tracked file, env file or history. The other two hosts in tracked files (`H2`, `H3`, in `.env.production.example` and a guide, both from 2026-09-11) have placeholder credentials and do not have the shape of a real endpoint ID.
- **It is the configured application target:** `apps/api/.env` and `ownus/.env.local` both use `H1` as `DATABASE_URL`, and the application code reads only `DATABASE_URL` for its database. The discrete `DB_*` variables in `apps/api/.env` point at localhost and are not read by application code.
- **The project's own code treats it as production:** the staging test setup reads the host from `apps/api/.env` specifically "to learn the production HOST to refuse". That is a design assumption in uncommitted code, not provider evidence.
- **The data looks consumer-like, not empty:** a counts-only snapshot of the schema (2026-10-01; its target is not recorded) shows 57 users, 53 wallets, 468 credit transactions, 25 refresh tokens and 19 import batches. Whether those are real customers or test accounts is unknown.
- **New finding, contradicts an earlier assumption:** a second real Neon endpoint, label **`S1`** (same region, database `neondb`), was used on 2026-10-02 for a staging end-to-end run (12 suites, 116 tests passed, "18 migrations recorded"). `S1` is not in any env file, tracked file or history. It is consistent with a migrated rehearsal branch. Earlier documents said no rehearsal use was shown locally; that needs a correction (§9, PC-10). Whether `S1` inherited the credential is unknown.
- **What is not known:** whether the credential works today, its actual privileges, which Neon branch `H1` is, whether anything deployed (Vercel or elsewhere) uses it, repository visibility and access history, and whether the owner's "testing" origin means the database holds only test data.
- **Outcome:** decision-table row **C (uncertain)** applies now, with B (production-capable) the likelier reading. A (confirmed isolated test database) is **not supported**.
- **Least disruptive safe next step:** a short, read-only review in the Neon console and the repository settings by the owner or database administrator (§8, E-1 to E-10), plus preserving logs. Decide on rotation after that. If the answers confirm production access, leaving the credential unchanged leaves an unrevoked admin-level key in 23 pushed revisions (§6.3).

## 2. Evidence reviewed
- **Documents (all eight read; unchanged):** `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md`, `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`, `CREDENTIAL_EXPOSURE_ASSESSMENT.md`, `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md`, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`, `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md`, `CREDENTIAL_ASSESSMENT_CORRECTIONS.md`, `CREDENTIAL_OWNER_COORDINATION_PLAN.md`. Earlier completed audits were reused, not repeated.
- **New local checks this phase (read-only, in memory):**
  - Host, database name, ssl and channel-binding structure of every Postgres URL in the env files, tracked files at HEAD, docs and all history (labels and booleans only).
  - Application code that selects the database (`config/index.ts`, `database.service.ts`, `drizzle.config.ts`, `migrate.ts`, `seed.ts`, `ownus/src/lib/db.ts`, test setup, staging guard, rehearsal CLI).
  - A structure-only review of each of the seven scripts (operations, tables, side effects; no literals).
  - The counts-only snapshots `apps/api/before.json`, `before.clean.json`, `after.json` and the log `apps/api/staging-e2e.log` (hosts masked).
  - File metadata of `.vercel/`, the env files and the working tree.
- **Not touched:** application source of concurrent People-import work; env file values (compared, not shown).

## 3. Redacted configuration and reference inventory
### 3.1 Target identity (labels only)
| Label | What it is | Where it appears | Notes |
|---|---|---|---|
| `H1` | real Neon endpoint, pooled form, `us-east-2`, db `neondb`, owner role `neondb_owner`, `sslmode=verify-full`, `channel_binding=require` in the env files | `apps/api/.env`, `ownus/.env.local`, the seven scratch scripts, all 23 credential-bearing revisions | the only real endpoint with credentials anywhere in tracked or env files |
| `H2`, `H3` | provider-domain hosts with placeholder user and password | `.env.production.example`, `docs/ENVIRONMENT_VARIABLES_GUIDE.md` (both introduced 2026-09-11) | not real-endpoint-shaped; templates |
| `S1` | real Neon endpoint, different from `H1`, same region, db `neondb` | only in `apps/api/staging-e2e.log` (2026-10-02 01:22) | role not shown in the log; not in any env file, tracked file or history |
| `local` | `localhost`, `127.0.0.1`, compose host `postgres` | defaults in `drizzle.config.ts`, `migrate.ts`, `seed.ts`, `env.validation.ts`, `.env.example`, `docker-compose.yml`; `DB_*` in `apps/api/.env`; Pipeline `.env` | local databases |

### 3.2 Files that configure or use the database credential
| File | Role | Holds the credential? |
|---|---|---|
| `apps/api/.env` (gitignored) | `DATABASE_URL` → `H1`, owner role; `NODE_ENV=development`; `SEARCH_PROVIDER=postgres`; `STORAGE_PROVIDER=r2`; discrete `DB_*` → localhost | **yes** |
| `ownus/.env.local` (gitignored) | `DATABASE_URL` → `H1` | **yes** |
| `.env.local` (root), `.vercel/.env.*.local` | no database credential (other tokens by name; Vercel production values empty) | no |
| `apps/api/src/config/index.ts`, `env.validation.ts` | read `DATABASE_URL` (required in production) | reads env |
| `apps/api/drizzle.config.ts`, `src/database/migrate.ts`, `seed.ts`, `scripts/*.ts` | read `DATABASE_URL` | reads env |
| `ownus/src/lib/db.ts` | gateway database access reads `DATABASE_URL` | reads env |
| `apps/api/test/setup-staging-env.ts`, `src/database/staging-guard.ts` | read `STAGING_DATABASE_URL`; refuse any host equal to the `apps/api/.env` host (`H1`) or `STAGING_FORBIDDEN_HOSTS` | reads env |
| `ownus/scratch_*.js` (seven, tracked) | embed `H1` with the owner credential | **yes** (literal) |
| `ownus/scratch/` (10), `scratch/` (16), `ownus/scratch_test_filter_queries.js` | read `DATABASE_URL` from the environment | no literal; act on whatever the environment points at |
| `docker-compose.yml`, Dockerfiles | local compose host; no credential | no |

## 4. Database target assessment
### 4.1 The four questions
1. **Configured host and database.** `H1`, database `neondb` (provider default name), pooled; the same in `apps/api/.env`, `ownus/.env.local` and the seven scripts (`scratch_test_db.js` also has a direct form of the same host and three local URLs). Region `us-east-2`.
2. **Production endpoint, rehearsal branch, or separate test database?** Unconfirmed. A Neon host identifies an *endpoint*; the mapping from endpoint to branch exists only in the provider console, and an endpoint alone does not prove which branch it represents. Evidence by reading:

| Reading | Evidence for | Evidence against / limits |
|---|---|---|
| `H1` is the production database | the apps are configured to use it; the staging guard code treats the `apps/api/.env` host as production; its schema is the shared Orion + Pipeline schema, with Pipeline-written data (19 import batches, 15 pipeline jobs, 13 recorded Pipeline migrations on 2026-09-28 per the earlier audit); the role is the owner role; a Vercel production environment defines `DATABASE_URL` and `DB_*` by name | no document or file states the branch name; the audit tool does not record its target; the Vercel values are empty |
| `H1` is a development or "testing" branch or database | the owner says the credential was used for testing; the scripts are named `scratch_test_*`; `NODE_ENV=development` in the file; the owner does not intend to keep Vercel | the seven scripts and the configured application target are the *same* endpoint, so "testing" and the application's database are one database; no separate test endpoint exists in any file or history; a development branch can still hold copied production data |
| `H1` is an isolated, test-only database | none found | the shared Orion + Pipeline data, the owner role, the staging guard's assumption and the absence of any other configured endpoint all point away from it |
| `S1` is the rehearsal branch | used 2026-10-02 by the staging suite with the isolation proof "passed" and 18 migrations; `S1` differs from `H1` (the guard refuses equality); `after.json` (18 migrations, 15 added tables) matches a migrated copy of the `before.clean.json` state (all pre-existing table counts identical) | its role, parent and creation are unrecorded locally |

3. **Files and scripts that reference the credential:** §3.2.
4. **Does the evidence prove test-only or production-capable?** **It proves neither label.** It does establish that the credential is for the owner role on the endpoint the applications themselves use, so it is **production-capable by role and configuration**, and the owner's statement of a testing origin is an OWNER STATEMENT that does not establish isolation. Result: **`TARGET UNCONFIRMED`**.

### 4.2 Evidence the authorized database owner must supply (E-items; also §8)
- E-1: in the Neon console, the branch (name, ID, parent, default/primary flag, creation date) that owns the endpoint behind `H1`, and the same for `S1`.
- E-2: whether `H1`'s branch is the project's production (default) branch and whether any production service connects to it.
- E-3: the role list and attributes, ownership of the schemas and objects, and the status and last-change date of the `neondb_owner` password.
- E-4: whether the 57 `users` rows and other records are real customers, test accounts or a mix. **DEFERRED, UNRESOLVED (2026-10-03):** answering it needs a query, which is outside the approved scope; it requires a separate, explicit authorization and an approved procedure. Outcome A cannot be confirmed without it.
- E-5: whether `S1`'s branch was created from `H1`'s branch, and whether it accepts the same password.
- E-6: connection and audit log retention, and active connections by role and source.
- E-7: whether any deployment (Vercel or other) currently uses the credential.
- E-8: repository visibility now and ever, access list, forks, push events.
- E-9: the identity of the second commit author and where their clones are.
- E-10: the supported replacement process and the least-privilege role outline.

## 5. Confirmed facts versus assumptions and unknowns
### 5.1 Confirmed facts (local)
- F-1: the seven tracked scripts embed `H1` with the owner role `neondb_owner`; the password equals the one in `apps/api/.env` and `ownus/.env.local`.
- F-2: 23 revisions carry the credential (first `1cdf261`, author time 2026-09-21 14:52:05 +0530; last `72521a2`), reachable from `main` and `origin/main` as last fetched; the history contains no other real endpoint with credentials.
- F-3: the application and migration/seed tooling read only `DATABASE_URL`; the discrete `DB_*` variables in `apps/api/.env` are local and are not read by application code (only the staging setup reads `DB_HOST` to learn a host to refuse).
- F-4: the seven scripts, individually (§9.2): five contain write patterns against the `users` family of tables, two are read-only inspection.
- F-5: two of the seven print connection information at most in masked form (`scratch_test_db.js` masks the password; the other only prints a profile image URL); none writes the credential to a file. `scratch_test_db.js` disables TLS certificate verification for the provider host (`rejectUnauthorized: false`).
- F-6: the staging log (2026-10-02 01:22) records one run against `S1`, database `neondb`, "18 migrations recorded (isolation proof passed)", 12 suites and 116 tests passed. `S1` ≠ `H1`.
- F-7: the counts-only snapshots show 3 recorded Orion migrations and 54 tables before, 18 and 69 after, with identical row counts on every pre-existing table, and non-zero counts on 19 tables including `users` 57, `user_wallets` 53, `credit_transactions` 468, `refresh_tokens` 25, `saved_searches` 5, `deleted_leads` 97, `execution_logs` 119, `import_batches` 19.
- F-8: a Vercel link exists; the production snapshot (2026-09-17) lists `DATABASE_URL`, `DB_*`, JWT and Typesense variable names with empty values; this does not show current use.
- F-9: no CI workflow files exist in the Orion or Pipeline repositories; the Pipeline working copy holds a local database URL and not the exposed credential.

### 5.2 Reasonable inferences
- I-1: `H1` is the database that Orion and the Pipeline share, because the audit snapshots, the Pipeline's migrations and the app configuration describe one schema; the audit tool reads `DATABASE_URL`, and the only remote endpoint in `.env` is `H1`. (The snapshot's target is not recorded.)
- I-2: `S1` is a branch or copy of the `H1` state, migrated on 2026-10-01/02 (identical pre-existing counts; 15 added tables).
- I-3: because a Neon branch normally copies its parent's roles, `S1` may accept the exposed password. Unconfirmed.
- I-4: the seven scripts were run, at least in part, against `H1` (they have no other target and the owner says the credential was used for testing), so test rows likely exist in the `users` family of tables. Unconfirmed; the execution history is only in provider logs.
- I-5: the credential existed before 2026-09-21 (local env files dated 2026-09-19).

### 5.3 Unknown (owner-only)
Credential validity and last change; actual privileges and object ownership; which branch `H1` and `S1` are; whether data is customer or test; whether any service depends on the credential; whether Vercel or another host still uses it; repository visibility and access history; push times; second author's clones; log retention and findings.

**Not established by the available evidence:** current credential validity (no), actual role privileges and ownership (no), active services depending on it (no), whether Vercel or anything else still uses it (no), repository visibility or access history (no).

## 6. Risk assessment and limitations
### 6.1 Exposure channels (confirmed)
Seven tracked scripts; 23 pushed revisions on `main`/`origin/main`; two ignored env files on this machine (and, by inference, the second author's clone); no evidence the credential appears elsewhere locally (other generated output, the Pipeline working copy, build output).

### 6.2 What the credential would allow, if valid
Connecting as `neondb_owner` to `H1` permits, at minimum, whatever the role is allowed on the application schema; if it is the database owner as the name suggests, that is full read, write and schema change on all data, including users, wallets, credit transactions, refresh-token hashes and saved searches (F-7). The five write-capable scripts show the kind of changes it would permit (inserts and updates on `users`). No evidence of misuse exists locally, and local evidence cannot detect it.

### 6.3 Residual risk of leaving it unchanged (if production access is confirmed)
The credential would stay valid in `origin/main` history and wherever it was copied; anyone with past or present read access to the repository, a fork, a clone or a backup could use it; deleting or ignoring the scripts changes nothing for existing copies; recovery after a leak is cheaper than after misuse. The longer it stays valid, the longer the window for undetected use, and provider log retention may expire. Whether this is acceptable is the owner's decision once E-1 to E-8 are answered; it should not be made on the assumption that the origin of the credential was benign.

### 6.4 Limitations
Local evidence cannot see the provider, the hosting platform or the deployments. The snapshots and the log do not record who ran them or which role they used. The earlier audits are dated 2026-10-01 and are not current. The owner's statement about testing is accepted as a statement and not as proof of isolation. Counts of write patterns are line counts.

## 7. Decision table
| Outcome | Applies when | What the evidence says now | Required response |
|---|---|---|---|
| **A. Confirmed isolated test database** | E-1/E-2 show `H1`'s branch is a dedicated test or development branch with no production data or consumers; E-4 shows test data only; E-3 and E-5 confirm the role is confined to that branch; E-7 shows nothing deployed uses it | **not supported**: no separate test endpoint exists; the apps' own database is `H1`; the staging guard and shared schema point away | Document the evidence and the **residual Git-history exposure**; keep test credentials strictly separate from production (separate branch/project, environment-only variables, no literals); untrack and ignore the seven scripts (separate gates G-4, G-5); rotate the test password anyway if the branch is a copy of production data or if E-5 shows other branches share it; history cleanup remains optional (G-8) |
| **B. Production database or production-capable credential** | E-1/E-2 show `H1` is production or a branch holding production data, or E-3 shows owner-level rights, or E-1 shows production services connect | **likely**, not confirmed: owner role, shared schema, user-like data, the project's own guard | Treat as potentially exposed. Use the existing approval package for a **controlled, least-privilege replacement** (staged role, not another owner credential): the consumer inventory K-1 to K-19 plus `S1` (new, K-20), per-consumer validation, abort criteria, monitoring, recovery planning, and **separate approval for revoking** the old credential. Also address `S1` and any branch that inherited it (DB-9). Gates G-1, G-2, G-3 (separate G-1 approval for revocation) |
| **C. Target or permissions uncertain** | any of E-1 to E-10 unanswered | **applies today** | Keep the finding open. Do not claim the credential is safe and do not force a rotation decision. Obtain E-1 to E-10 (§8). Preserve logs first. Re-run this table when answered |

**Do not read A as the default because the credential was meant for testing.** The origin of a credential does not limit what it can do.

## 8. Recommended next actions and owners
No action below has been taken.

| # | Action | Owner | Gate | Note |
|---|---|---|---|---|
| 1 | Name the incident owner and approvers; preserve provider, deployment and repository logs | incident owner | none | evidence may expire |
| 2 | Run the read-only console checks E-1 to E-3, E-6 and E-10 (E-4 is deferred: it needs a query, which requires separate explicit authorization). You can find your own endpoint by comparing the start of the host in your `apps/api/.env` with the endpoint IDs shown in the console; do not paste the host or password into any message | database owner (you, if you hold console access) | none (read-only) | do not test the credential by signing in |
| 3 | Check repository visibility, access list, forks and push events (E-8) | repository owner | none (read-only) | if the repository was always private with a small trusted group, the risk picture changes materially |
| 4 | Confirm whether any deployment (Vercel project or other) still exists and still holds the credential (E-7); because Vercel is not permanent, also record whether the project is to be unlinked or deleted | deployment owner | none to confirm; **G-2** to change | a retired project is a consumer until its variables are removed or the project is deleted |
| 5 | Identify `S1`'s branch and whether it inherited the credential (E-5); reset or delete it later under separate confirmation | database owner | none to confirm | new local evidence |
| 6 | Identify the second commit author and their clones (E-9) | repository owner | none | |
| 7 | Decide A/B/C with the evidence | incident owner | none | §7 |
| 8 | If B: request G-1/G-2/G-3 for the staged replacement; revocation separately | per approval package | G-1, G-2, G-3 | the credential is a single-password role, so a password reset is the simplest revocation once all consumers (including `S1`-derived ones and your two env files) are ready |
| 9 | Until the decision: do not run any scratch script; keep the seven out of any future bulk `git add` | everyone | none | |

If, after the checks, the target is a test-only branch, the least disruptive path is A. If it is production, B is the proportionate response. Rotation is not recommended or rejected here before E-1 to E-4 are known.

## 9. Vercel and repository cleanup (proposals only; nothing applied)
### 9.1 Vercel
- Permanent Vercel hosting is out of scope. Historical configuration does not prove current use: the local link and snapshot (2026-09-11 to 2026-09-17) show only that a project and production variable names existed at that time.
- The owner must confirm: whether the Vercel project still exists and has deployments (production and preview); which database variables it holds and whether they equal the exposed credential (DP-1, DP-2); whether any other host (a new platform, containers, scheduled jobs) uses the credential; whether the project will be deleted or unlinked, and who does it (**G-2**).

### 9.2 The seven credentialed scripts, individually
All seven embed the owner credential for `H1`. Disposition for all: **untrack in one reviewed commit (G-4), keep local copies only if the owner wants them, never recreate with literals.**

| Script (introduced) | Purpose (from structure) | Operations (pattern counts) | Side effects | Proposed disposition |
|---|---|---|---|---|
| `scratch_inspect_tables.js` (1cdf261, 2026-09-21) | lists table structure from `information_schema` | SELECT 3 | none (read-only) | untrack; if needed, recreate reading `DATABASE_URL` from the environment |
| `scratch_test_db.js` (1cdf261) | tests connectivity to remote and local databases | SELECT 2 | read-only; prints the URL with the password masked; disables TLS certificate verification | untrack; do not keep as-is |
| `scratch_master_e2e_verification.js` (5859572, 2026-09-22) | 264-line end-to-end check across the database and HTTP endpoints | SELECT 5, INSERT 2, UPDATE 3, DDL 1 | writes to `users` and `user_wallets`; calls HTTP endpoints | untrack; highest-risk; never run against `H1` |
| `scratch_test_app_preferences_persistence.js` (58392f3) | tests saving app preferences | SELECT 3, INSERT 1, UPDATE 1 | writes to `users` | untrack |
| `scratch_test_notifications_integration.js` (5859572) | tests notification preferences | SELECT 4, INSERT 1, UPDATE 2 | writes to `users` | untrack |
| `scratch_test_profile_persistence.js` (51e857d) | creates or fetches a test user and tests profile persistence | SELECT 3, INSERT 1, UPDATE 1, DDL 1 | writes to `users`; calls HTTP endpoints | untrack |
| `scratch_test_single_device_login.js` (58392f3) | tests the single-device login rule | SELECT 5, INSERT 1, UPDATE 2 | writes to `users` | untrack |

`scratch_test_filter_queries.js` (no embedded credential) and the `scratch/` and `ownus/scratch/` directories are separate decisions (checklist C-8), one script at a time; four scripts in each write to whatever `DATABASE_URL` points at.

### 9.3 Proposed ignore rules (not applied; same as the plan, §II.4.3)
```
# scratch / ad hoc database scripts (embed or read connection strings)
ownus/scratch_*.js
# generated rehearsal and audit output (environment-specific)
apps/api/before.json
apps/api/before.clean.json
apps/api/after.json
apps/api/*-result.txt
```
Keep tracked: `apps/api/src/database/migrations/meta/*_snapshot.json` and `_journal.json`, and `docs/phase-a2/`. `apps/api/staging-e2e.log` is already covered by `*.log`.

### 9.4 What deleting or ignoring does and does not do
Deleting or untracking a file removes it from future commits only. A `.gitignore` rule only prevents untracked files from being added; it does not untrack files already committed. **Neither removes the contents from Git history**: all 23 revisions still hold the credential, as do forks, clones and caches. Only a history rewrite changes that, and even then it cannot recall copies others hold (separate gate G-8, not in this phase). Rotation is the control that makes the leaked value useless.

## 10. New findings and proposed corrections (not applied)
The earlier documents were not edited. These are proposed, require human review, and external confirmation of the facts they point to.

| ID | Document and place | Existing claim | Proposed correction | Local evidence | Status |
|---|---|---|---|---|---|
| PC-10 | Assessment §5 K-11, R-1; Plan Part II §II.2.4; Coordination plan §1 and tracker DB-9 follow-up | "no local evidence shows a rehearsal branch exists or was used; documents describe rehearsals as planned or gated" | "A staging end-to-end run was recorded against a second Neon endpoint (`S1`, not `H1`) on 2026-10-02 (12 suites, 116 tests passed, 18 migrations recorded). Its branch, parent, role and whether it inherited the exposed credential are unknown (DB-9, E-5)." Add `S1` as a consumer K-20 (unverified) | `apps/api/staging-e2e.log`; `after.json` vs `before.clean.json` | PROPOSED — NOT APPLIED |
| PC-11 | Assessment §5 K-5, K-6; Approval §5 | the applications' `DATABASE_URL` is a "potential" consumer without further detail | note that the application code reads only `DATABASE_URL` (the discrete `DB_*` variables in `apps/api/.env` are local and unused by the app), so one variable carries the credential in each deployment | config and staging-setup code | PROPOSED — NOT APPLIED |
| PC-12 | Assessment §3.1.3; Coordination plan §1 | owner-level treatment "precautionary" | add: the project's own staging guard reads the `apps/api/.env` host as the production host to refuse (a design assumption, not provider evidence); the counts-only snapshot shows 57 user rows | `test/setup-staging-env.ts`, `staging-guard.ts`; snapshots | PROPOSED — NOT APPLIED |
| PC-13 | Assessment §3 / Plan | the audit snapshots are "production evidence" or "rehearsal output" without a recorded target | state that the targets of `before.json`, `before.clean.json` and `after.json` are not recorded in the files; `after.json` is consistent with a migrated copy | snapshot structure | PROPOSED — NOT APPLIED |

PC-1 to PC-9 in `CREDENTIAL_ASSESSMENT_CORRECTIONS.md` stand and remain unapplied; PC-10 to PC-13 above are reviewed together with them under criterion R9 (PC-1 to PC-13). The cutover remains `NOT READY` and `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` remains `DRAFT — NOT APPROVED`; tracker items remain `UNANSWERED`.

## 11. Working tree and scope
Orion `main` at `fe7307f`; unrelated People-import changes in the shared tree were observed by path and metadata only and were not read, edited, staged, committed, deleted or reverted (authorship `REQUIRES TEAM CONFIRMATION`). The Pipeline working copy was not changed.

## Completion statement
**No credentials were tested** (no authentication attempt of any kind), and none was rotated, revoked, created or changed. **No external service was contacted** (no Neon, PostgreSQL, Vercel, GitHub, Typesense or other service; no network request was made). No message, ticket or request was sent to any owner. **No production, application, configuration or Git change was made**: no application code, environment file, `.gitignore`, deployment setting, migration or database change; no script, seed, migration or test was run; nothing was staged, committed, pushed, deleted, moved or renamed; no Git history was rewritten. No approval gate was passed. The only change is this new file.
