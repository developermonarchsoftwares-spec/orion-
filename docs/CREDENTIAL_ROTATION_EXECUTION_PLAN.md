# Credential replacement and Vercel retirement: execution plan (RR-25)

**Status: PLAN ONLY. Nothing executed. No credential was created, changed, tested or revoked. No approval gate is passed.** Date: 2026-10-03. Repository: `D:\ownus`.

Companion documents (preserved, unchanged): `CREDENTIAL_TARGET_VERIFICATION_REPORT.md`, `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md`, `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md` (C-1..C-15), `CREDENTIAL_EXPOSURE_ASSESSMENT.md`, `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md`, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (`DRAFT — NOT APPROVED`), `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md`, `CREDENTIAL_OWNER_COORDINATION_PLAN.md`, `CREDENTIAL_ASSESSMENT_CORRECTIONS.md`, and the repository cleanup proposal `CREDENTIAL_REPOSITORY_CLEANUP_PROPOSAL.md`. Gates **G-1 to G-10** are those of the checklist. Credential IDs here are `CR-n`; consumer IDs `K-n` are those of the approval package.

**No secret appears here.** Values were compared only in memory. This document reports variable names, file paths, counts, dates, booleans and classes.

Evidence classes: **FACT** (verified locally), **INFERENCE** (reasoned, not proven), **OWNER STATEMENT**, **UNKNOWN / OWNER-ONLY**.

## 1. Summary and priorities
Goal: replace exposed credentials with new ones, retire Vercel, keep local development working, and protect production data.

1. **Neon database credential (CR-1, CR-2): highest priority.** It is an owner-level role (`neondb_owner`) on the endpoint the applications use. Its privileges, validity, branch and consumers are unconfirmed. Replacement is staged and least-privilege; revocation is separate. No database is recreated, deleted, reset or migrated as part of this.
2. **JWT secrets (CR-3, CR-4):** committed in `docker-compose.yml` across 45 revisions; production use unknown. Rotation signs everyone out, so it is scheduled with the hosting move, after the database cutover and not before the impact is approved.
3. **Other application secrets (CR-6 to CR-12):** no exposure found in Git for any of them; they exist only in ignored local files. They need fresh values for the new hosting environment anyway and are rotated at that move, not as emergency actions. The two exceptions to check first are Typesense (a known public development default, CR-5) and anything an owner finds in Vercel.
4. **Vercel (CR-13):** retire after the replacement host is validated and the credentials above are replaced. Deleting a Vercel project does **not** revoke any credential the project held.
5. **Repository (separate proposal):** untrack the seven scripts and add ignore rules after the database cutover; history rewrite is a separate, later decision.

Not decided anywhere in the documents, and needed from you before anything is scheduled (§9.3): the **replacement hosting platform** and its secret store, the **database administrator** and approvers, and the **change window**.

## 2. Credential inventory (Phase 1)
Exposure evidence refers to what local files and Git show. "Known consumers" are those established locally; others are UNKNOWN / OWNER-ONLY.

| ID | Credential | Purpose | Local references (names, paths) | Known consumers | Permissions established? | Exposure evidence | Proposed remediation |
|---|---|---|---|---|---|---|---|
| CR-1 | Neon owner-role credential (role `neondb_owner`, pooled endpoint `H1`, database `neondb`) | database access for Orion API, gateway, migrations, audits; Pipeline schema shared | `DATABASE_URL` in `apps/api/.env`, `ownus/.env.local` (gitignored); literal in seven `ownus/scratch_*.js`; code reads `DATABASE_URL` in `config/index.ts`, `drizzle.config.ts`, `migrate.ts`, `seed.ts`, `scripts/*.ts`, `ownus/src/lib/db.ts` | K-1 to K-4 confirmed (local files, scripts, history); K-5 to K-8, K-15, K-18, K-19 unverified; staging guard refuses this host | **No.** Role name suggests owner; attributes and ownership unconfirmed | **FACT:** in 23 pushed revisions (2026-09-21 to 09-25) and two ignored env files. Validity, access and misuse UNKNOWN | §3 CR-1 and §4: staged least-privilege replacement; separate revocation |
| CR-2 | Credential for the staging/rehearsal endpoint `S1` (same region, database `neondb`, 18 migrations) | staging end-to-end suite via `STAGING_DATABASE_URL` | not in any env file, tracked file or history; recorded only in `apps/api/staging-e2e.log` (host, masked) | the staging suite (`test:e2e:staging`) | No (role not shown in the log) | no literal found locally. **INFERENCE:** a branch of the `H1` state, so it may accept the CR-1 password | confirm the branch and role; reset or delete the branch after CR-1 is replaced (separate confirmation for deletion) |
| CR-3 | JWT access-token signing secret `JWT_ACCESS_SECRET` | signs and verifies access tokens (API 15 min, gateway 24 h); also the source for reset-link and admin-OTP keys and OAuth state | `apps/api/.env`, `ownus/.env.local`; literal in `docker-compose.yml` (services `api`, `web`); code: `config/index.ts`, `auth/*`, `oauth-state.service.ts`, `ownus/src/lib/gateway-auth.ts`, gateway route | API, gateway; production unknown | n/a | **FACT:** committed in 45 revisions. 88 random-looking characters. Production use UNKNOWN | §3 CR-3 |
| CR-4 | JWT refresh-token secret `JWT_REFRESH_SECRET` | signs and verifies refresh tokens (7 d) | same files | API, gateway | n/a | **FACT:** committed in 45 revisions, same files. Production use UNKNOWN | §3 CR-3 (rotate together) |
| CR-5 | Typesense API key `TYPESENSE_API_KEY` | admin key for the search server when `SEARCH_PROVIDER=typesense` (default `postgres`; local value `postgres`) | literal development default in `apps/api/.env.example`, `env.validation.ts`, `docker-compose.yml`; (working tree) `config/secrets.ts` | Typesense indexing/search only if provider is Typesense; deployed use UNKNOWN | n/a | **FACT:** a known public development default in 80 revisions; production code rejects it when Typesense is the provider | §3 CR-5 |
| CR-6 | Redis URL with embedded user and password (`REDIS_URL`; `rediss:` TLS, remote host, password 62 characters) | queue backend (BullMQ queue module) | `apps/api/.env` only | Orion API queue/workers; deployed use UNKNOWN | No | **FACT:** not in any tracked file or any revision. Local ignored file only | §3 CR-6: replace with the new host's Redis credential; rotate old after cutover |
| CR-7 | Object-storage keys `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (`STORAGE_PROVIDER=r2`, remote endpoint) | upload/download of imported files and exports | `apps/api/.env`; config `env.validation.ts` (rejects `minioadmin` in production) | Orion API; the Pipeline's R2 variable is empty locally | No (scope of the token unknown) | **FACT:** not in Git; local ignored file only | §3 CR-7: scoped replacement for the new host |
| CR-8 | Google OAuth client secret `GOOGLE_CLIENT_SECRET` (and client ID, callback URL) | Google sign-in | `apps/api/.env`; callback URL in both env files and the Vercel snapshot is a `*.vercel.app` URL | Orion API; gateway callback | No | **FACT:** not in Git; local ignored file only | §3 CR-8: new secret and redirect URIs for the new host |
| CR-9 | Microsoft OAuth client secret `MICROSOFT_CLIENT_SECRET` | Microsoft sign-in | empty in `apps/api/.env`; example files hold placeholders | none locally | n/a | no value locally; deployed value UNKNOWN | §3 CR-8 note: only if enabled in a deployment |
| CR-10 | Resend API key `RESEND_API_KEY` | transactional email | `apps/api/.env`, `ownus/.env.local`, root `.env.local` (same value in all three; 22 code references) | API and gateway | No | **FACT:** not in Git; three local ignored files | §3 CR-9 |
| CR-11 | Razorpay `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | payments and webhook verification | none set locally; code in `modules/payment/*`; examples in `.env.production.example` | payment module; deployed keys UNKNOWN | No (test vs live unknown) | no value locally or in Git | §3 CR-10: owner decision first; webhook URL tied to the old host |
| CR-12 | Vercel artifacts: `VERCEL_OIDC_TOKEN` (root `.env.local`, `.vercel/.env.*.local`), project link (`.vercel/project.json`), project environment variables, Git integration | Vercel CLI/runtime access | local ignored files | the Vercel project (existence unverified) | n/a | **FACT:** all three local tokens are short-lived and **expired** (issued 2026-09-11 and 2026-09-17, 12-hour lifetimes); production variable values were empty in the snapshot; project contents UNKNOWN | §6 retirement checklist |
| CR-13 | Seed administrator password `ADMIN_SEED_PASSWORD` (and the seed email default) | creates the first administrator account | read by `seed.ts`; unset locally | whoever ran the seed | n/a | no value locally or in Git; whether the seed ran against `H1` UNKNOWN | verify administrator accounts after cutover; change passwords of any seeded administrator if the seed was used with a weak value (owner) |
| CR-14 | Local development defaults (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `DB_PASSWORD`, development storage keys) | local containers only | `docker-compose.yml`, example files, `config/secrets.ts` | local development | n/a | **FACT:** public by design; production config rejects `minioadmin`; the local `DB_PASSWORD` is a plain default word | no rotation; keep out of any non-local environment |
| CR-15 | Pipeline repository secrets | Pipeline database, R2 | Pipeline `.env`: `POSTGRES_PASSWORD` (default word), `R2_SECRET_ACCESS_KEY` (empty) | Pipeline local run | n/a | **FACT:** no real secret locally; does not hold the CR-1 credential | none now; apply the same rules if it later gets real credentials |
| CR-16 | Git hosting credentials (remote URL, saved tokens, deploy keys) | push/pull | remote URL carries no embedded credential (earlier fact); credential helpers not inspected | developers | n/a | UNKNOWN | repository owner reviews access (GH-2) |

Not credentials of this task: customer passwords (stored as hashes), refresh-token rows (hashes in the database). They are database content and are protected by CR-1.

## 3. Replacement plan per credential (Phase 2)
Each credential lists the nine required items. Nothing below is executed. Every action that changes a credential, a deployment variable or a local env file needs the stated gate and approver. "Old credential" means the value currently in use or exposed. Rollback or recovery **never restores a credential that was exposed**.

### CR-1 Neon database credential (priority 1)
| # | Item | Plan |
|---|---|---|
| 1 | What to replace | The `neondb_owner` credential that applications use, with a **dedicated least-privilege application role** for runtime. The owner credential is then changed (password change of the role, not a database reset) and sealed for migrations and break-glass. |
| 2 | Where generated | In the Neon console by the authorized administrator: role creation and password generation happen at the provider, never in chat, tickets, files or the repository. The secret goes straight into the destination secret store. |
| 3 | Permissions and design | Roles per `TARGET_ARCHITECTURE.md` §8: `orion_app` (runtime: data read/write on the Orion tables and use of their sequences; no schema changes, no role management, no ownership), `orion_migrator` (schema changes, used only for approved migration runs), and the sealed owner for break-glass. Exact grants come from the administrator's output (DB-2, DB-11, Phase A2 checks C11a to C11g) and are reviewed by the application owner. No owner-level credential is created for the application. The Pipeline gets its own roles later; it does not use this credential (local fact). |
| 4 | Configurations to update | `DATABASE_URL` in: the destination environment's secret store for the Orion API and the gateway; `apps/api/.env` and `ownus/.env.local` on each developer machine (or switch these to a local database, §5); migration/seed/audit runners; Phase A2 operator record; `STAGING_DATABASE_URL` consumers. Runtime uses the pooled endpoint; migrations use the direct endpoint. |
| 5 | Validation | Per consumer, non-destructive only: API `GET /api/v1/health` (its database component runs a read-only `SELECT 1`; **not** the liveness route and not the gateway's liveness/readiness, which do not touch the database); one authenticated read through a pre-approved existing test account (no account creation); `db:audit` (read-only) run by the named operator; a read-only gateway page; the provider's view of connections by role. No scratch, seed or cleanup script is used to test. |
| 6 | Downtime and user impact | Staged route: each consumer restarts once to pick up the new secret (seconds to minutes per consumer); users see a brief interruption at most. Fallback (password change of the owner role without a replacement role): all connections drop; plan a short window. Sessions are unaffected (JWT unchanged). |
| 7 | Rollback and recovery | Before revocation: point the consumer back to a working **new** credential or fix the replacement role's grants; never re-enable the exposed credential. After revocation: repair on the new credential; harm to data is recovered by the provider's backup or point-in-time restore under a separate approved change. Keep the replacement secret in the store until acceptance. |
| 8 | When the old credential can be revoked | Only after every confirmed or potential consumer (K-1 to K-19, plus CR-2/`S1`) has been validated on the new credential, the observation period has passed with owners' written sign-offs, remaining sessions on the old credential are identified, and a **separate** approval is recorded. Revocation is a password change of the owner role or removal of its use; the administrator then checks refusal on both pooled and direct endpoints. |
| 9 | Approval | Database owner (G-1, create and revoke separately); each deployment owner (G-2); each developer for their own machine (G-3); incident owner for window and abort. All `NOT SET` today. |

**Preconditions before any operational change (blockers):** the administrator confirms the target branch of `H1` and `S1`, the role's attributes and ownership, validity, log retention, consumers and branches (tracker DB-1 to DB-13, GH, DP). Until then the target is `TARGET UNCONFIRMED` and this plan stays unexecuted.

### CR-2 Staging/rehearsal endpoint `S1`
| # | Item | Plan |
|---|---|---|
| 1 | Replace | Whatever credentials `S1`'s branch holds, if it is a copy of the `H1` state. |
| 2 | Generated | Neon console, administrator. |
| 3 | Permissions | A non-owner test role scoped to the rehearsal branch; the staging guard already refuses any host equal to the production host. |
| 4 | Update | `STAGING_DATABASE_URL` (set per run, not stored in `.env`), `STAGING_CONFIRM_HOST`. |
| 5 | Validate | Re-run the staging suite against the branch only (a database-writing test, so its own approval). |
| 6 | Impact | none for users. |
| 7 | Rollback | recreate the branch from a clean source. |
| 8 | Revoke | the administrator resets or deletes the branch after CR-1 is replaced; **deletion needs its own confirmation**. |
| 9 | Approval | database owner (G-1). |
Use `S1` first to rehearse the replacement role's grants (a copy, not production), if the administrator confirms it is isolated.

### CR-3 and CR-4 JWT access and refresh secrets
| # | Item | Plan |
|---|---|---|
| 1 | Replace | both secrets, together. Not changed until impact and cutover are approved. |
| 2 | Generated | on a trusted workstation with a cryptographically secure generator, at least the length now used (the code enforces 16 minimum; production currently uses 88 characters); placed directly into the secret store; never typed into chat or committed. |
| 3 | Permissions | n/a (signing keys). Use different values for access and refresh, and different values per environment. |
| 4 | Update | the destination secret store for the **API and the gateway at the same time** (they must share the pair); `apps/api/.env` and `ownus/.env.local`; remove the literals from `docker-compose.yml` (read from the environment) and from `apps/api/.env.example` (placeholder) in a separate commit (checklist C-10, needs G-9 to push). |
| 5 | Validate | with a disposable existing test account: pre-rotation access and refresh tokens must fail (401) after rotation; a fresh sign-in succeeds; the gateway and the API accept each other's new tokens; no auth errors in logs. |
| 6 | **Impact** | there is no old-and-new key support, so it is a hard cutover with no grace period. **Access tokens:** all invalid; users re-authenticate (API tokens last 15 minutes, gateway tokens 24 hours). **Refresh tokens:** all invalid (signature check precedes the database lookup); every user signs in again. **Password-reset links:** keys derive from the access secret, so links issued before the change stop working. **Admin OTP challenge cookies:** same, stop working. **OAuth state values** (15-minute lifetime): in-flight sign-ins fail and must restart. Announce the sign-out. |
| 7 | Rollback | forward only: correct configuration to the new values or generate another set; never restore the committed values. |
| 8 | Revoke | the old values become useless the moment nothing accepts them; no separate revocation exists. Remove them from the repository tip in the same change series; history still holds them (cleanup proposal). |
| 9 | Approval | application owner and deployment owner (G-6); G-9 to push the literal removal. Production use of the committed values is UNKNOWN (DP-3). If the destination environment is new and gets fresh values from the start, the rotation coincides with the hosting move and costs no extra sign-out. |
Order: after the database cutover; coordinate with the hosting move (§7).

### CR-5 Typesense API key
| # | Item | Plan |
|---|---|---|
| 1 | Replace | only if a deployed Typesense instance uses the development default. Local development keeps a locally generated key. |
| 2 | Generated | on the Typesense server by its administrator (an admin key for indexing and a restricted search-only key for queries). |
| 3 | Permissions | application query paths use the search-only key; the admin key is used only for indexing/seed. |
| 4 | Update | the Typesense deployment and the API's `TYPESENSE_API_KEY`; remove the literal default from tracked config and read it from the environment (the production rejection stays). |
| 5 | Validate | search succeeds with the restricted key; administrative actions are refused; the old default is refused (administrator only, against the replaced server). |
| 6 | Impact | none while `SEARCH_PROVIDER=postgres`; a brief search interruption if Typesense is in use. |
| 7 | Rollback | issue another new key; never re-enable the default. |
| 8 | Revoke | delete the default key on the server once the new keys work. |
| 9 | Approval | Typesense administrator (G-7), and only after confirming whether any deployment uses it (DP-6). The local value is `postgres`, so the application uses PostgreSQL search locally. |

### CR-6 Redis credential
| # | Item | Plan |
|---|---|---|
| 1 | Replace | the credential in `REDIS_URL` with one for the new hosting environment. |
| 2 | Generated | in the Redis provider's console by its owner (provider not identified locally). |
| 3 | Permissions | a dedicated user/password for the Orion API queue only, if the provider allows; TLS (`rediss`) kept. |
| 4 | Update | destination secret store; `apps/api/.env`. |
| 5 | Validate | API starts and the queue health or a harmless queue operation succeeds; no connection errors in logs. |
| 6 | Impact | queue consumers reconnect; in-flight jobs may retry; schedule outside peak import runs. |
| 7 | Rollback | issue another new credential. |
| 8 | Revoke | once workers run on the new credential and queues are drained. |
| 9 | Approval | Redis owner and deployment owner (G-2). No exposure found in Git; do this at the hosting move or earlier if the owner prefers. |

### CR-7 Object-storage keys (R2)
| # | Item | Plan |
|---|---|---|
| 1 | Replace | a new key pair for the new environment. |
| 2 | Generated | the storage provider's console (`STORAGE_PROVIDER=r2`; confirm the provider), scoped to the specific bucket. |
| 3 | Permissions | object read/write on the one bucket; no account-level or bucket-admin rights; separate keys per environment. |
| 4 | Update | destination secret store; `apps/api/.env`. |
| 5 | Validate | a read of an existing non-sensitive object and a write/delete of an object in a test prefix, by the owner, in the destination environment only. |
| 6 | Impact | uploads/downloads fail only between key change and restart. |
| 7 | Rollback | issue another new key. |
| 8 | Revoke | after the destination environment works and no other consumer (including the Pipeline) is found. Keep `file_key` and `r2_object_key` semantics unchanged. |
| 9 | Approval | storage owner and deployment owner (G-2). No exposure found in Git. |

### CR-8 and CR-9 OAuth client secrets
Google client secret (set locally) and Microsoft (empty locally). The current Google callback URL points at a `*.vercel.app` address in both env files and in the Vercel snapshot, so the move off Vercel **requires** changing the authorised redirect URIs and the callback URL setting.
1. **Replace:** create a new client secret for the Google client (or a new client) once the new host's URL is known; add the new redirect URIs; keep old URIs only until cutover.
2. **Generated:** the provider's OAuth console by its owner.
3. **Permissions:** unchanged scopes (sign-in/profile only).
4. **Update:** destination secret store; `GOOGLE_CALLBACK_URL`, `APP_URL` and CORS settings; local files.
5. **Validate:** a sign-in with a test account from the new host.
6. **Impact:** Google sign-in unavailable during the switch; email/password sign-in unaffected.
7. **Rollback:** restore the previous redirect URIs while keeping the new secret.
8. **Revoke:** delete the old client secret and the Vercel redirect URIs after cutover.
9. **Approval:** application owner and OAuth console owner (G-2/G-3). Microsoft: only if enabled in a deployment (UNKNOWN).

### CR-10 Resend API key
Replace with a new key scoped to sending, created in the Resend dashboard for the new environment; update the destination store and the three local files (the same value sits in `apps/api/.env`, `ownus/.env.local` and root `.env.local`; keep one source of truth). Validate by sending one message to an owner-controlled address. Impact: email stops between key change and restart. Rollback: issue another key. Revoke the old key after validation. Approver: email-service owner and deployment owner (G-2/G-3). No exposure found in Git.

### CR-11 Razorpay
Not set locally; deployed keys and test/live mode are UNKNOWN. **Owner decision first.** If live keys exist in a deployment, treat them as sensitive: new keys and a new webhook secret are generated in the Razorpay dashboard, the webhook endpoint is changed to the new host's URL, and the old keys are revoked after a test-mode transaction check. Impact: payment capture or webhook verification fails during the switch; schedule outside active sales and reconcile pending webhooks. Rollback: new keys only. Approver: finance/payment owner and deployment owner (G-2). No code or file change here.

### CR-13 Seed administrator and application accounts
After the database cutover, the owner reviews administrator accounts and sessions through approved, read-only means and changes any password that was set from a seed with a known value. No account changes are made in this plan.

### CR-12, CR-14 to CR-16
CR-12 is handled by §6. CR-14 and CR-15 need no rotation. CR-16: the repository owner reviews collaborators, tokens and deploy keys (GH-2).

## 4. Neon replacement sequence (staged; none executed)
Follows `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §7; gates in the last column. The database is never recreated, deleted, reset or migrated.

| Step | Action | Who | Validation or exit | Gate |
|---|---|---|---|---|
| N-0 | Answers to E-1 to E-10 (target branch of `H1` and `S1`, role attributes, ownership, validity, logs, consumers, branches, repository, hosting); logs preserved | incident owner, administrator | tracker items answered; criteria R1 to R10 met | none (read-only) |
| N-1 | Decide A/B/C with the evidence (target report §7) | incident owner | recorded decision | none |
| N-2 | Rehearse the replacement role's grants on the isolated branch (`S1` or a fresh copy) using the application's test suite there | administrator, application owner | health database component up; staging suite passes with the non-owner role | G-1 for any provider change |
| N-3 | Create `orion_app` (and `orion_migrator` if wanted) on the target branch; grant only the reviewed privileges; keep the owner unchanged | administrator | role list and grants match the reviewed outline | **G-1** |
| N-4 | Put the `orion_app` secret in the first destination environment's store; restart that consumer | consumer owner | health database component up; one authenticated read with the approved account | **G-2** |
| N-5 | Repeat for each consumer in an agreed order (API and gateway together if needed) | consumer owners | §8 matrix | **G-2** per deployment |
| N-6 | Update the local files or switch to a local database (§5) | developers | local app starts | **G-3** |
| N-7 | Provider view: active connections by role; any session on the owner credential from an application is a missed consumer | administrator | none remain except break-glass | none |
| N-8 | Observation period (value set by approvers) covering scheduled jobs; owner sign-offs | owners | written sign-offs | none |
| N-9 | **Separate approval**, then change the `neondb_owner` password and seal the new owner secret; controlled refusal check of the exposed credential on both endpoints | administrator | exposed credential refused; consumers healthy | **G-1 (separate)** |
| N-10 | Reset or delete the `S1` branch and any other branch that inherited the credential | administrator | branch list | G-1; deletion confirmed separately |
| N-11 | Record evidence; update tracker and RR-25 | incident owner | documents updated | none |

Fallback (if a least-privilege role is not feasible in the first window): N-3 is replaced by changing the owner password and updating every consumer in one window. This leaves applications on an owner credential and should be followed by the staged route.

Abort criteria, monitoring and thresholds are those of the approval package §9 and remain blank until the approvers fill them.

## 5. Keeping local development working
- **Goal:** developers never need a remote production-capable credential.
- **Default local mode:** point `DATABASE_URL` at the compose PostgreSQL (`postgresql://…@localhost:5432/orion_db` style, per the existing `docker-compose.yml` and the code defaults). The local database is created and migrated locally from the committed migrations. This is the local container only; it does not touch Neon.
- **Optional remote development:** a dedicated development branch with its own non-owner role and its own password, in a file outside the repository; never the production branch.
- **Search and storage:** `SEARCH_PROVIDER=postgres` locally (already so); local storage provider for files; locally generated dev secrets for JWT and Typesense that are not the committed values.
- **Env file hygiene:** `.env` files stay ignored; examples carry placeholders only; one source of truth for shared values (`RESEND_API_KEY` currently sits in three files).
- **Until the cutover is decided:** the current `apps/api/.env` points at `H1`. Do **not** run migrations, seeds, scratch scripts or database-writing tests with it. `db:audit` is read-only but still connects to `H1`; run it only when intended.
- **Validation after switching:** the local app starts, the health route shows the database up, the unit and integration tests that use the local database pass. Staging tests run only against `STAGING_DATABASE_URL` through the guard.
- **Impact:** developers re-create local data; no effect on production.
All of this needs G-3 for each machine's files and is not applied by this plan.

## 6. Vercel retirement checklist
Permanent Vercel deployment is out of scope. Historical configuration does not prove current use: the local link and snapshot (2026-09-11 to 2026-09-17) show only that a project and variable names existed. **Do not delete anything until the items below are verified by an authorized owner.**

| # | Check or action | Owner | Evidence or exit | Gate |
|---|---|---|---|---|
| V-1 | List Vercel projects, deployments (production, preview), domains, team members, tokens and integrations | deployment owner | inventory (names only) | none (read-only) |
| V-2 | Confirm whether live traffic, DNS or custom domains still point at Vercel | deployment owner | DNS and domain list | none |
| V-3 | Confirm the **replacement hosting platform** and its secret store are chosen and validated (not yet decided) | application and deployment owners | validated environment (§8) | G-2 |
| V-4 | List project environment variable names for production, preview, development; mark which hold database, JWT, storage, mail, OAuth, payment, Typesense values | deployment owner | names with sensitive flags (DP-4) | none |
| V-5 | Identify external dependencies on the Vercel URL: Google/Microsoft redirect URIs (Google callback currently a `*.vercel.app` URL), Razorpay webhook URL, email links, CORS, third-party allow-lists, uptime monitors | application owner | list | none |
| V-6 | Check for Vercel-held data or features: cron jobs, serverless data, KV/Blob/Edge Config, analytics, logs, preview comments | deployment owner | list; export anything needed | none |
| V-7 | Preserve evidence first: build and deployment logs (they may contain values), access logs, project audit log | incident owner | preserved copies | none |
| V-8 | Move traffic: update DNS and callback/webhook/redirect URLs to the new host; validate sign-in, payments, email, uploads | owners | §8 matrix | G-2 |
| V-9 | Replace credentials per §3 so that Vercel's copies are useless (database, JWT, storage, Redis, mail, OAuth, payments) | owners | per-credential validation | G-1/G-2/G-6 |
| V-10 | Disable auto-deploy and remove the Git integration (no more builds from the repository) | repository owner / deployment owner | integration removed | G-10 |
| V-11 | Remove project variables, then delete the project, only after V-8 and V-9 | deployment owner | project gone | G-2 |
| V-12 | Remove third-party trust (any provider federation to Vercel, OIDC trust) | provider owners | list | G-1 (provider settings) |
| V-13 | Local cleanup (separate approval): the ignored `.vercel/` directory and expired token lines in root `.env.local` | each developer | files removed | local deletion, own approval |
| V-14 | Remote branch `fix/vercel-build` is 75 commits behind `main` with none of its own; propose deleting it with the owner's decision | repository owner | branch list | G-9 |
Deleting the project removes a consumer and its logs; it does **not** revoke database, JWT, storage, Redis, mail, OAuth or payment credentials. `ownus/public/vercel.svg` is only an image asset.

## 7. Overall sequence and dependencies
| Wave | Activity | Credentials | Depends on | Gates |
|---|---|---|---|---|
| 0 | Evidence, owners named, logs preserved, target confirmed, hosting platform chosen | all | none | none |
| 1 | Neon staged replacement and separate revocation (§4) | CR-1, CR-2 | wave 0 and R1 to R10 | G-1, G-2, G-3 |
| 2 | New hosting environment prepared with fresh values: JWT pair, Redis, storage, mail, OAuth, payments; validated in parallel with Vercel | CR-3, CR-4, CR-6 to CR-11 | wave 1 (database) | G-2, G-6, G-7 if needed |
| 3 | Traffic move; old values retired as each is replaced | CR-3 to CR-11, CR-12 | wave 2 validated | G-2, G-6 |
| 4 | Vercel retirement (§6) | CR-12 | wave 3 | G-2, G-10 |
| 5 | Repository cleanup: untrack, ignore rules, literal removal | repository | wave 1 | G-4, G-5, G-9 |
| 6 | Secret scanning in pre-commit and CI | repository | wave 5 | G-10 |
| 7 | Optional history rewrite and copy purge | repository | waves 1 to 3; visibility known | G-8, G-9 |
| 8 | Verification scan and RR-25 closure | all | all | none |
Waves 5 and 6 can start after wave 1; wave 2 and wave 5 do not depend on each other. Rotating JWT with the hosting move avoids a second forced sign-out.

## 8. Validation matrix (per service, after each replacement)
| Service | Check | Never |
|---|---|---|
| Orion API | `/api/v1/health` database component up (also needs Typesense, storage, memory checks to pass or be understood); one authenticated read via the approved test account; logs free of auth errors | liveness alone; creating accounts; scratch or seed scripts |
| Gateway | a read-only page that needs the database; API token acceptance across gateway and API after JWT change | the gateway's liveness/readiness as a database test |
| Queue / workers | start without connection errors; a harmless job completes | draining or replaying production jobs |
| Storage | read of an existing non-sensitive object; test-prefix write/delete | touching real customer files |
| Email | one test message to an owner address | bulk send |
| OAuth | sign-in with a test account from the new host | real users as tests |
| Payments | test-mode transaction and webhook receipt | live transactions |
| Provider side | connections by role show only the new roles | testing the exposed credential |

## 9. Approvals, blockers and decisions
### 9.1 Gate map (none passed)
G-1 database role/credential create and revoke (database owner); G-2 deployment variables (each deployment owner); G-3 local env files (each developer); G-4 untrack seven scripts; G-5 `.gitignore`; G-6 JWT rotation; G-7 Typesense; G-8 history rewrite; G-9 pushes and remote branch changes; G-10 CI/security settings, Git integrations. Approval of one is not approval of another. Every approver field in the approval package is `NOT SET`.

### 9.2 Blockers (today)
1. No owner named or responded; tracker 39 items `UNANSWERED`; criteria R1 to R10 `NOT MET`. *Update 2026-10-04:* the user selected themselves for nine roles (`USER-SELECTED — PENDING VERIFICATION`), explicitly accepted the Incident Owner role only, and answered I-8 as `USER-CONFIRMED: SAME PERSON` (2026-10-04); these are user statements and selections, not verified authority (SV-1 to SV-7 are pending) and not approvals, and no other owner has been named or has responded.
2. Target branch of `H1` and `S1`, credential validity, role attributes and ownership unknown (`TARGET UNCONFIRMED`).
3. Production use of the committed JWT values, of Typesense, and of the exposed database credential in any deployment unknown.
4. Replacement hosting platform and secret store not chosen.
5. Log retention and evidence preservation not confirmed.
6. Thresholds, window, observation period, alert recipients blank.
7. No approved production test account or read-only validation route confirmed.
8. Concurrent uncommitted work (59 modified, 130 untracked entries, People-import changes by unconfirmed authors) must be protected before any commit.

### 9.3 Decisions needed from you
- Who is the database administrator and who approves each gate (can be you, but name it).
- Replacement hosting platform and secret store.
- Whether the exposed `H1` is production or a development branch (you can check this read-only in the provider console).
- Whether payments (Razorpay) and Google/Microsoft sign-in are live today.
- Whether to rotate JWT with the hosting move (recommended) or earlier.

## 10. Gaps in existing documents (documented, not invented)
- The documents never name the destination hosting platform; this plan is platform-neutral.
- The target report found a second endpoint (`S1`) that earlier documents did not list; correction PC-10 is proposed there and is still unapplied. This plan treats `S1` as CR-2.
- Redis, storage, OAuth, mail and payment credentials were not in the earlier consumer inventory (which was database-centered); they are added here as CR-6 to CR-11 with local facts only.
- The earlier documents describe JWT impact for access/refresh/reset/OTP/OAuth; this plan adopts that analysis unchanged.
- Provider-specific procedures (exact console steps, password change effects, branch behavior) are unverified assumptions to be confirmed by the administrator (DB-10).
No existing document was edited.

## Completion statement
Planning only. **No credentials were tested** (no authentication attempt), and none was created, rotated, revoked or deleted. **No external service was contacted** (no Neon, GitHub, Vercel, Typesense, Redis, storage, email, OAuth or payment provider; no network request). No `.env`, `.env.local`, deployment configuration or secret was changed; no migration, seed, scratch script or database-writing test was run; no application code or database permission was modified. Nothing was staged, committed, pushed, deleted, moved or renamed, no Git history was rewritten, and the concurrent People-import work was not read or touched. No approval gate was passed. The new files are this plan and `CREDENTIAL_REPOSITORY_CLEANUP_PROPOSAL.md`.
