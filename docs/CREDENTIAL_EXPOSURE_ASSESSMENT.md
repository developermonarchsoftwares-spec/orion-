# Credential exposure assessment and database cutover planning (RR-25, Phase 1)

**Status: ASSESSMENT AND PLAN ONLY. Nothing executed, nothing approved.** Date: 2026-10-03. Repository: `D:\ownus` (plus read-only local inspection of the Pipeline working copy). Companion documents, preserved unchanged by this phase: `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md` (Parts I and II), `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md` (C-1..C-15), RR-25 in `PIPELINE_RUNTIME_RISK_REGISTER.md`. Terminology, evidence classes and approval gates **G-1 to G-10** are those of the existing documents. This phase did not execute or approve any gate.

**No secret appears in this document.** Passwords, tokens, keys and connection strings were compared only inside a script's memory. This document reports file paths, variable *names*, commit references, dates, counts and booleans.

## 1. Purpose and scope
**Purpose:** establish, from local evidence only, what is needed to plan a safe replacement of the exposed database credential, and prepare a non-executable checklist for the authorized database administrator.

**In scope:** the affected role, possible validity, every potential consumer, confirmed versus unverified consumers, owner-only questions about the repository, the provider log window, rehearsal branches, and the cutover checklist with validation, abort and recovery criteria.

**Out of scope (separate future work, §9):** scratch-script cleanup, `.gitignore` changes, JWT rotation and configuration cleanup, Typesense changes, history rewriting, secret-scanning configuration, deployment or cloud changes. None was started.

**Evidence classes:** **LOCAL GIT FACT**, **LOCAL FILE FACT** (verified on this machine, including gitignored files), **UNVERIFIED** (cannot be established locally). Items that cannot be settled locally are marked `REQUIRES ADMINISTRATOR/GITHUB OWNER CONFIRMATION`.

## 2. Evidence reviewed and methods
| Source | Used for |
|---|---|
| The two remediation documents (read in full) | existing findings, gates, terminology |
| `git` metadata (refs, reflogs, `merge-base`, `ls-files`, `check-ignore`, `status`) | exposure range, tracked/ignored status, local push records |
| Env files on disk, parsed in memory (`apps/api/.env`, `ownus/.env.local`, root `.env.local`, `.vercel/.env.*.local`, Pipeline `.env`) | variable names, role/host/password equality booleans, file dates |
| Source search for variable names (`DATABASE_URL`, `STAGING_*`, `DB_*`) | consumer discovery |
| Directory scan of `D:\ownus` (excluding `node_modules`, `.git`) and the Pipeline working copy (excluding `storage`, `.git`, virtual environments) for any file holding a value equal to the exposed password or to the local JWT values | additional local copies |
| Existing docs (`DATABASE_OWNERSHIP_MATRIX.md`, `MIGRATION_REHEARSAL_PLAN.md`, `TARGET_ARCHITECTURE.md`, `PHASE_A2_APPROVAL_READINESS.md`) | role design, rehearsal and Phase A2 context |

Methods and limits: no network call was made. No database, Neon, Typesense, Vercel or Git remote was contacted, and no credential was tested. No `git fetch`, `pull` or `push` was run, so `origin/*` refs reflect the last fetch on this machine. The comparison scripts live outside the repository and printed no values.

## 3. Confirmed local findings
### 3.1 The credential and its role
| # | Finding | Class |
|---|---|---|
| 3.1.1 | The seven credentialed scripts under `ownus/scratch_*.js` (listed in plan Part I §1.1 and checklist C-6) embed a remote credentialed URL whose **role is `neondb_owner`** and whose password equals that of the `DATABASE_URL` in the gitignored `apps/api/.env`. The same role, password and host are in the gitignored `ownus/.env.local`. | LOCAL FILE/GIT FACT |
| 3.1.2 | The endpoint in `apps/api/.env` and `ownus/.env.local` is a **pooled** endpoint (the host name carries the provider's pooler marker); the scripts use the same host once the pooler marker is normalised. The administrator must treat pooled and direct endpoints as one credential. | LOCAL FILE FACT |
| 3.1.3 | `neondb_owner` is the owner role of the production database objects (read-only audit recorded in the ownership documents, 2026-10-01). A credential for the owner role grants full read, write and DDL on every object it owns. | LOCAL DOC FACT (from earlier read-only audit) |
| 3.1.4 | In the 23 revisions that contain the credential, the earliest is `1cdf261` (committer time 2026-09-21 14:52 +0530) and the latest is `72521a2` (2026-09-25, on `origin/main` only as last fetched). These revisions are reachable from `main` and `origin/main`; `fix/vercel-build` does not contain `1cdf261`. | LOCAL GIT FACT |
| 3.1.5 | The earliest entry in this machine's `origin/main` reflog whose tip contains `1cdf261` is 2026-09-21 21:58 +0530 (a fast-forward on pull). Earlier pushes from other clones, if any, would not appear locally. | LOCAL GIT FACT |

**Privileges (item 1 of the evidence list).** Locally established: the role owns the application objects. **Not** established locally, and marked `REQUIRES ADMINISTRATOR/GITHUB OWNER CONFIRMATION`: the role's provider-level attributes (for example membership in the provider's administrative role, ability to create or alter roles, bypass of row-level security, access to other databases in the project), and the list of other roles that exist.

### 3.2 Validity
Whether the credential still works **cannot be established locally and was not tested**. The password in the local env files may have been changed at the provider since 2026-09-19 (the date those files were last modified); the local files would then be stale. The credential is treated as **possibly valid and compromised until the administrator completes remediation**. Absence of evidence is not evidence of invalidity.

### 3.3 Consumers (summary; detail in §5)
- Two local files hold the exposed credential: `apps/api/.env` and `ownus/.env.local` (both gitignored, last modified 2026-09-19).
- The seven tracked scratch scripts embed it.
- **New this phase.** A Vercel project is linked (`.vercel/project.json`; identifiers not reproduced). A pulled snapshot of the production environment, `.vercel/.env.production.local` (file dated 2026-09-17), lists variables named `DATABASE_URL`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `DB_SSL`, `DB_MAX_CONNECTIONS`, `DB_IDLE_TIMEOUT_MS`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `TYPESENSE_API_KEY`, but **every one of those values is empty in the snapshot** (the platform does not return sensitive values on pull). So the snapshot confirms that a Vercel *production* environment defined these variable names as of 2026-09-17. It does **not** show what they contain, and it predates the first credential commit. It cannot establish that production uses (or does not use) the exposed credential or the committed JWT values.
- Neither repository contains a CI workflow directory (no `.github`), so no CI configuration in either repository references the credential. Hosted CI, build logs and the deployment platform's own settings are not visible locally.
- The Pipeline's `.env` points at a local database with a different role, password and host; no file in the Pipeline working copy (excluding `storage`) holds the exposed password.

### 3.4 Other local copies (relevant to later purge work)
The directory scan found the exposed password only in: `apps/api/.env`, `ownus/.env.local` (both untracked, ignored) and the seven tracked scratch scripts. It was **not** found in `apps/api/dist`, `.vercel/output`, other generated output or any other file. The local JWT values appear in `apps/api/.env`, `ownus/.env.local` (both ignored) and the tracked `docker-compose.yml`. Local-only files `.env.local` (root; names `VERCEL_OIDC_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, no database variable) and `.vercel/.env.development.local` (name `VERCEL_OIDC_TOKEN`) are gitignored and hold other tokens that the later purge step should consider (they are outside RR-25's database credential).

### 3.5 Working-tree state
The Orion repository is on `main` at `fe7307f` with 59 modified and 121 untracked entries (180 before this document), none staged, no stashes. `.gitignore` is unchanged. The eight `ownus/scratch_*.js` files are still tracked. The Pipeline working copy shows 29 entries (28 changed or untracked, 1 staged deletion), more than the 27 recorded earlier; none of that is from this task, and it was not touched.

## 4. Unknowns requiring administrator or GitHub owner confirmation
Each item is `REQUIRES ADMINISTRATOR/GITHUB OWNER CONFIRMATION`.

**Database administrator (provider console):**
1. Whether the exposed credential is still valid, and when the `neondb_owner` password was last changed.
2. The role's actual attributes and privileges, other roles that exist, and whether other roles share the password.
3. The project, branch and endpoint set (pooled and direct) that the credential reaches.
4. **Provider access logs.** Review connection and audit logs from the credential's last change (or, if unknown, from before 2026-09-17, when the production snapshot was pulled) to the rotation time. At minimum cover **2026-09-21 14:52 +0530 (first credentialed commit) onward**. Look for unfamiliar source addresses, unusual hours, unexpected writes or DDL, role or extension changes, new roles, and connections through the pooled and direct endpoints. A log retention shorter than this window is itself a finding to record.
5. Which consumers actually connect with the credential now (active sessions by role and source).
6. **Rehearsal branches** (§5, R-1).

**GitHub (repository) owner:**
7. Repository visibility now and at any earlier time, and when visibility last changed.
8. Collaborators, teams, deploy keys, installed apps and tokens with read access, including past collaborators.
9. Forks, mirrors and archives; clone counts if available; whether third parties could have copied the repository if it was ever public.
10. Pull-request refs and other hidden refs that keep the commits reachable.
11. Security alerts, secret-scanning alerts and who received them.
12. The first **push** time of the credential commits (local evidence gives only the earlier bound in 3.1.5).

**Deployment owner (Vercel project and any other host):**
13. The values (or at least whether they match the exposed credential and the committed JWT and Typesense values) held by the production and preview environments for the variables named in 3.3. The platform must be consulted by an authorized person; the local snapshot cannot answer this.
14. Whether any other host, scheduled job or deployed Pipeline instance connects to the database.
15. Whether hosted build or deployment logs printed any of the values.

## 5. Credential-consumer inventory
Status: **confirmed** = established from local evidence that the consumer holds or embeds the exposed credential; **potential** = a consumer that probably uses the credential or the same role but local evidence cannot show it; **unverified** = existence or configuration unknown.

| ID | Consumer | Variable (names only) | Status | Basis |
|---|---|---|---|---|
| K-1 | `apps/api/.env` (local, gitignored) | `DATABASE_URL` | **confirmed** (holds it) | in-memory comparison |
| K-2 | `ownus/.env.local` (local, gitignored) | `DATABASE_URL` | **confirmed** | in-memory comparison |
| K-3 | Seven tracked scripts `ownus/scratch_*.js` (see C-6) | embedded literal | **confirmed** | comparison and Git |
| K-4 | Git history, 23 revisions on `main`/`origin/main` | embedded literal | **confirmed** | Git |
| K-5 | Orion API at runtime (Nest, `src/config`, `database`) | `DATABASE_URL` | **potential** | reads the env variable; which value the deployed instance holds is not shown locally |
| K-6 | Gateway database access (`ownus/src/lib/db.ts`) | `DATABASE_URL` | **potential** | reads the same variable |
| K-7 | Vercel production environment | `DATABASE_URL`, `DB_*` | **unverified** (variable names exist as of the 2026-09-17 snapshot; values not retrievable locally) | snapshot has empty values |
| K-8 | Vercel preview/development environments | same | **unverified** | only a `VERCEL_OIDC_TOKEN` name is in the development snapshot |
| K-9 | Migration, seed and audit tooling (`drizzle.config.ts`, `src/database/migrate.ts`, `seed.ts`, `scripts/*.ts`, `audit-migrations.ts`) | `DATABASE_URL` | **potential** (anything the operator runs with the local env uses K-1) | source search |
| K-10 | Phase A2 operator | role in the approval record (`PENDING OWNER`) | **potential** | approval record unsigned; operator role not yet named |
| K-11 | Rehearsal/staging tooling (`staging-guard.ts`, `rehearsal-cli.ts`) | `STAGING_DATABASE_URL`, `STAGING_CONFIRM_HOST`, `STAGING_FORBIDDEN_HOSTS`, `STAGING_TARGET_HOST` | **potential** | none of these is set in any local env file or process environment, so no local use is shown |
| K-12 | Rehearsal database branches | provider-held credentials | **unverified** | see R-1 |
| K-13 | `docker-compose.yml` services | `DATABASE_URL` | **not a consumer** (confirmed) | the `DATABASE_URL` there targets the compose service host `postgres`; no file hit for the exposed password |
| K-14 | Pipeline working copy (`.env`, `docker-compose.yml`, code) | `DATABASE_URL`, `POSTGRES_*` | **not a consumer** (confirmed locally) | local database, different role/password/host; no file contains the password |
| K-15 | A deployed Pipeline instance, scheduled jobs, hosted CI | unknown | **unverified** | not visible locally; no CI workflow files in either repository |
| K-16 | Dockerfiles (`apps/api`, `ownus`) | none | **not a consumer** (confirmed) | no database variable or secret in them |
| K-17 | Tracked examples (`.env.production.example`, `apps/api/.env.example`) | placeholders | **not a consumer** | no credential value |
| K-18 | Developer machines, clones, backups, IDE/assistant caches | any copy of K-1..K-4 | **unverified** | only this machine was inspected |

### R-1. Could a rehearsal branch have inherited the credential?
- A Neon-type database branch normally starts with its parent's roles and passwords, so **any rehearsal branch created from the production branch before rotation would hold the exposed credential** until it is reset or deleted (design assumption recorded in the rehearsal plan; the provider's behavior is to be confirmed by the administrator).
- Local evidence: no branch name or identifier appears in the repository, env files or commit messages; the only local Git branch besides `main` is `fix/vercel-build` (a Git branch, not a database branch); no `STAGING_*` variable is configured locally. The documents describe branch rehearsals as planned or gated, not as completed. This neither shows that a branch exists nor that none does.
- **Status: UNVERIFIED, `REQUIRES ADMINISTRATOR/GITHUB OWNER CONFIRMATION`.** The administrator lists every branch under the project, records creation dates and parents, and treats each branch created from the production branch as holding the exposed credential until reset or deleted (deletion needs its own confirmation).

## 6. Database cutover checklist (proposed; not executable by this phase)
For the authorized database administrator. **Do not create the replacement role or credential, connect to a database, or perform a cutover under this document.** Each numbered action that changes something belongs to a gate in §8 and needs its own approval. Never write a secret value into a ticket, chat, file or log.

### Phase 0. Preconditions (no changes)
- [ ] 0.1 Named administrator, named operator and named owners for each consumer (K-5..K-12, K-15).
- [ ] 0.2 §4 items 1-6 and 13-14 answered, or an explicit written decision to proceed with them open.
- [ ] 0.3 Maintenance window agreed and announced; the abort criteria in §7 agreed in advance.
- [ ] 0.4 Secret store ready for the new credential (deployment platform secret store plus the administrator's vault); no plaintext copies.
- [ ] 0.5 Phase A2 record and rehearsal plan reviewed so they refer to post-rotation roles (plan Part II §II.2.3-4).
- [ ] 0.6 Recovery path confirmed (§7.3): backup or point-in-time recovery availability for the database, noted before any change.

### Phase 1. Confirm role, privileges, consumers (C-1; read-only console)
- [ ] 1.1 Confirm the affected role is `neondb_owner` for the production project/branch, with its endpoints (pooled and direct).
- [ ] 1.2 Record the role's attributes and privileges, other roles, and whether any shares the password.
- [ ] 1.3 Reconcile the consumer inventory (§5) with the provider's active-connection view and the deployment platform's variable *names*.
- [ ] 1.4 Review provider logs for the window in §4 item 4 and record findings. If misuse is suspected, escalate as a security incident before continuing; preserve logs.

### Phase 2. Choose and prepare a replacement (C-3 preparation; gate G-1 to act)
- [ ] 2.1 Prefer a **least-privilege replacement application role** (for example `orion_app` per `TARGET_ARCHITECTURE.md` §8) for the runtime consumers K-5/K-6 rather than another owner-level credential, where the schema permissions allow. The owner credential then exists only for migrations and break-glass, in a sealed store. Where that is not feasible in one window, a reset of the owner password (all consumers cut over together) is the fallback; the administrator decides. A role holds one password, so "two valid credentials for the same role" is not an option.
- [ ] 2.2 Define the replacement's privileges from what the Orion API and gateway actually need (tables, sequences, schemas), and review it with the application owner.
- [ ] 2.3 Generate the new secret in the provider and store it only in the secret stores.
- [ ] 2.4 Decide the treatment of any rehearsal branch (R-1) and the Phase A2 operator role.

### Phase 3. Controlled cutover (C-3, C-4; gates G-1, G-2, G-3)
- [ ] 3.1 Configure each consumer's secret through the platform's approved secret mechanism, not through files in the repository (K-5..K-9 as applicable, then local `apps/api/.env` and `ownus/.env.local` on each developer machine).
- [ ] 3.2 Redeploy or restart one consumer at a time.
- [ ] 3.3 Test **each consumer individually**, non-destructively and without exposing credentials: health endpoint; sign-in with a disposable test identity; a read-only audit by the named operator (`npm run db:audit` is read-only); for the gateway, one read-only page. Do not run scratch, seed or cleanup scripts to test.
- [ ] 3.4 In the provider console confirm active connections are now on the new credential, and note any session still on the old one with its source.
- [ ] 3.5 Hold for at least one full usage cycle (including scheduled jobs and the gateway fallback paths); each consumer owner signs off in writing.

### Phase 4. Revocation (C-5; gate G-1, a **separate** approval)
- [ ] 4.1 Explicit written approval from the database owner to revoke, after Phase 3 sign-off.
- [ ] 4.2 Revoke the exposed credential: a password reset on `neondb_owner` takes effect immediately; for a replacement-role strategy, remove the old privileges once nothing depends on them.
- [ ] 4.3 **Verify the old credential is no longer accepted** through an authorized, controlled check performed by the administrator (a single refused sign-in attempt from an approved place, expecting an authentication failure on both pooled and direct endpoints). This phase must not be performed by an assistant or an automated script.
- [ ] 4.4 Confirm all consumers remain healthy after revocation.

### Phase 5. Evidence and documentation
- [ ] 5.1 Record: who did what and when, role names, consumer list, log-review conclusion, test results (without secrets).
- [ ] 5.2 Update the incident documentation (plan, checklist, RR-25) with the outcome and residual exposure (forks, caches, copies).
- [ ] 5.3 Plan the follow-on work in §9 (each with its own approval).

## 7. Validation, abort and recovery criteria
### 7.1 Validation (each must pass)
- Every consumer in §5 marked confirmed or potential reports successful operation on the new credential, with no authentication errors in its logs.
- Health endpoint passes; a disposable test identity can sign in; the read-only audit completes with the expected counts.
- Provider console shows no remaining use of the old credential except sessions already identified and closed.
- After revocation: the old credential is refused (Phase 4.3) and all consumers remain healthy.

### 7.2 Abort criteria (stop and do not proceed to the next phase)
- Any consumer fails authentication on the new credential and cannot be fixed within the window.
- Provider logs show activity that suggests the credential was used by an unknown party (switch to incident handling and preserve logs).
- A consumer not in the inventory appears in the active-connection view (inventory incomplete; resolve before revocation).
- Unexpected errors or performance regression on the replacement role that cannot be resolved by adjusting that role's privileges in the window.
- The maintenance window ends before Phase 3 sign-off.
- Revocation is **never** performed if any Phase 3 sign-off is missing.

### 7.3 Rollback of application configuration versus recovery after revocation
These are different, and neither restores the compromised credential.
- **Rollback of application configuration (before revocation):** if a consumer misbehaves after a configuration change, correct that consumer's configuration to the *new* credential, or issue another new credential. Do **not** re-enable the exposed credential as a rollback; if more time is needed, extend the window (the exposure continues until revocation, so keep it short). Application-level rollback may restore the previous *code or non-secret configuration* but never the old secret.
- **Recovery after revocation:** the old credential is gone. If something breaks, repair the affected consumer on the new credential or create another new credential or role. Do not assume the old credential can safely be restored: it is compromised, and restoring it would reopen the exposure. If data or schema were harmed (for example by misuse found in Phase 1.4), recover using the provider's backup or point-in-time recovery through a separate, approved database change request.

## 8. Approval gates required before execution
No gate was approved by this phase, and approval of one gate is not approval of any other. Actions marked "none" are read-only and need only the stated access.

| Gate | Action in this plan | Approver | Phase |
|---|---|---|---|
| none (read-only) | Phase 0-1 review in the provider console and hosting settings (C-1, C-2) | database administrator; repository owner | 0-1 |
| **G-1** | Create the replacement role/credential or reset the `neondb_owner` password (C-3); revoke the exposed credential (C-5, separate approval) | database owner | 2-4 |
| **G-2** | Set the new database credential in each deployment environment | owner of each deployment | 3 |
| **G-3** | Update `apps/api/.env` and `ownus/.env.local` | developer who owns each machine | 3 |
| G-4 to G-10 | Not part of this plan; see §9 | as in the checklist | later |

## 9. Separate future work items (not part of this phase)
Each has its own prerequisites and approval. None may be folded into the database cutover approval.
| Item | Checklist | Gate | Prerequisites | Approver |
|---|---|---|---|---|
| Scratch-script cleanup (untrack seven credentialed scripts; review the rest individually) | C-6, C-8 | G-4 (G-5 per rule) | cutover completed (C-3); working tree reviewed so only the named paths are in the commit | repository owner |
| `.gitignore` changes | C-7 | G-5 | C-6 committed; owner reviewed patterns | repository owner |
| JWT rotation and removal of literals from `docker-compose.yml` | C-9, C-10 | G-6 (and G-9 to push) | decision on whether production used the committed values (§4 item 13); announced sign-out window | application and deployment owners |
| Typesense key | C-11 | G-7 | a deployed Typesense instance identified | Typesense administrator |
| Git history rewrite | C-13 | G-8, G-9 | C-5 revoked; visibility and copies known (§4 items 7-12); mirror backup; written decision | repository owner (written) |
| Secret-scanning configuration | C-12 | G-10 | C-6 done; tool chosen; alert owner named | repository owner |
| Deployment or cloud changes beyond secrets | per change request | G-2 or a new gate | change request | deployment owner |
| Purge of other copies (including the local `VERCEL_OIDC_TOKEN` and `RESEND_API_KEY` files, assistant caches, shell history) | C-14 | none | C-3; evidence preserved first | each holder |

## 10. Outstanding risks
1. **The owner credential may still be valid and widely copied.** Until revocation, it grants full administrative access to the production database; every day of delay extends exposure. Severity is higher than in a limited-privilege account.
2. **Repository visibility, forks and clones are unknown.** If the repository was ever public, treat the credential and the committed JWT values as permanently disclosed; rotation is the only control.
3. **Production may use the committed JWT values** (their traits look generated; the local development files use them). The local production snapshot shows only empty values, so this stays unverified; if true, anyone who can read the repository could forge sessions until the secrets are rotated.
4. **Incomplete consumer inventory.** A consumer not found here (deployed pipeline, scheduled job, hosted CI, preview environment) fails at revocation or keeps using the old credential. Mitigate with the provider's active-connection view (Phase 3.4) and the abort criteria.
5. **Rehearsal branches may inherit the credential** (R-1).
6. **Outage during cutover** (pooled and direct connections drop on a password reset). Mitigate with the window, ordered consumer updates and Phase 3 tests.
7. **Phase A2 and rehearsal operators** must not use the exposed credential; the approval record is still draft and unsigned.
8. **Seven scratch scripts with write statements remain tracked** and embed the credential; until revoked, anyone with repository access could run them against the production database.
9. **Other tokens on disk.** `VERCEL_OIDC_TOKEN`, `RESEND_API_KEY` and similar values live in gitignored local files; they are outside RR-25 but should be handled in the purge step.
10. **Log retention.** If the provider keeps logs for a shorter period than the exposure window, misuse may be undetectable; record this as a finding.
11. **Uncommitted baseline.** Both repositories have large uncommitted changes (Orion 180 entries; Pipeline 29), so any future untracking or `.gitignore` commit must stage only the named paths.

### Proposed factual refinements to earlier documents (not applied)
The two remediation documents were not modified. The evidence below refines, and does not contradict, earlier statements; the owner can decide whether to fold them in.
- Plan Part I §2 and §4 and Part II §II.2 say the contents of the Vercel link were unknown. Refinement: a local production snapshot (2026-09-17) lists the relevant variable *names* with empty values (§3.3); this adds K-7 as a named, still unverified consumer.
- Plan Part I §4 says `docker-compose.yml` holds "a localhost URL only". Evidence: its `DATABASE_URL` uses the compose service host name `postgres`, not `localhost`; it does not contain the exposed password. Proposed wording: "a compose-network URL without the exposed credential".
- Plan Part II §II.5 states the local JWT values equal the committed ones for `apps/api/.env`. Evidence adds that `ownus/.env.local` also holds identical values.
- Additional local copies for the purge step: root `.env.local` and `.vercel/.env.*.local` hold other tokens by name (§3.4).
- Pipeline working copy now shows 29 entries (earlier note: 27); unrelated to this incident.

## Completion summary
This phase was read-only investigation and planning. **No credential was tested, validated, rotated, revoked, created or changed. No database, Neon project, Typesense server, cloud provider, Vercel account or remote Git repository was contacted, and no network request was made.** No secret value, password, token or connection string was printed, copied, logged or stored in any file. No application code, configuration, environment file, migration, schema or `.gitignore` was modified; no file was deleted or untracked; no history was rewritten; nothing was staged, committed, stashed, reset, cleaned or pushed; no scratch script, migration, seed or test was run. No approval gate was approved. The unrelated working-tree changes in both repositories were present and were preserved. The only change in this phase is this new file.
