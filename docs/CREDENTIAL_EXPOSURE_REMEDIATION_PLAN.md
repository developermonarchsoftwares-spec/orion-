# Credential exposure remediation plan (RR-25)

**Status: PLAN ONLY, not approved, nothing executed.** Date: 2026-10-02 (Part I); detailed stage plans in Part II at the end. Repository: `D:\ownus`. This plan was prepared from local Git inspection and local file comparisons only. No database, cloud provider, Neon setting or remote repository was contacted. No file was deleted, no Git history was changed, nothing was staged, committed, stashed, reset or pushed, and no credential was rotated.

**No secret appears in this document.** Passwords, tokens and full connection strings were compared inside a script's memory and never printed, logged, copied or stored. Only file paths, line numbers, commit IDs, counts, booleans and variable *names* are reported.

Related: `PIPELINE_RUNTIME_RISK_REGISTER.md` (RR-25), `ORION_INTEGRATION_READINESS_REPORT.md`, `PHASE_A2_APPROVAL_READINESS.md`.

## 0. Evidence classes
| Class | Meaning |
|---|---|
| **LOCAL GIT FACT** | Verified from this repository's objects and refs on this machine |
| **LOCAL FILE FACT** | Verified from files on this machine (including gitignored ones) |
| **UNVERIFIED** | Cannot be established without contacting the remote, the database provider or the deployments: repository visibility, who cloned or forked it, whether the credential is still valid, whether it is used in production runtime, provider access logs |

Remote-tracking refs (`origin/*`) reflect the last fetch on this machine and may be stale; they are local facts about that state only.

## 1. Verified local facts
### 1.1 Affected files
Eight scratch files are tracked at `ownus/scratch_*.js`. **Seven contain a connection-string literal with an embedded user name and password; one does not** (this corrects RR-25's "eight files contain credentials"). In the seven files, every remote (Neon-class) credentialed literal carries the **same password as the production-configured role in the gitignored `apps/api/.env`** (in-memory boolean comparison).

| File (tracked, unchanged since added) | Introducing commit | Date | Credentialed literals (line: class) | Same password as `apps/api/.env`'s role |
|---|---|---|---|---|
| `ownus/scratch_inspect_tables.js` | `1cdf261` | 2026-09-21 | 3: remote | yes |
| `ownus/scratch_test_db.js` | `1cdf261` | 2026-09-21 | 4: remote, 5: remote, 6-8: local | yes (lines 4-5) |
| `ownus/scratch_master_e2e_verification.js` | `5859572` | 2026-09-22 | 3: remote | yes |
| `ownus/scratch_test_notifications_integration.js` | `5859572` | 2026-09-22 | 3: remote | yes |
| `ownus/scratch_test_app_preferences_persistence.js` | `58392f3` | 2026-09-22 | 3: remote | yes |
| `ownus/scratch_test_single_device_login.js` | `58392f3` | 2026-09-22 | 3: remote | yes |
| `ownus/scratch_test_profile_persistence.js` | `51e857d` | 2026-09-22 | 3: remote | yes |
| `ownus/scratch_test_filter_queries.js` | `bdbba4d` | 2026-09-21 | none (reads `DATABASE_URL` from the environment) | n/a |

Each file was added in exactly one commit and never modified, so every later commit contains it unchanged. All eight are identical to HEAD in the working tree.
Two further tracked scratch directories hold no credentialed literals but read `DATABASE_URL` from the environment: `ownus/scratch/` (10 files) and `scratch/` (16 files). They will act on whatever database the environment points at.

### 1.2 History
- 80 revisions are reachable from the local refs. **23 revisions contain a remote credentialed URL carrying the same password as the production-configured role** (64 revisions contain some remote credentialed URL, which also counts placeholders in documentation and example files).
- Earliest such revision: `1cdf261` (2026-09-21, "admin page import datas store in database"). Others, by date: `d0e108b`, `0410e07`, `557a765`, `32f1766`, `7333a5e`, `226a32e`, `bdbba4d`, `f793bbf` (2026-09-21); `5290cc4`, `72375f0`, `a098fd2`, `29e3cff`, `d4f706a`, `e3fca5b`, `58392f3`, `5859572`, `d061bcf`, `51e857d` (2026-09-22); `ec94b83` (2026-09-23); `3f1ffd2`, `fe7307f` (2026-09-24); `72521a2` (2026-09-25).
- The local `HEAD` (`fe7307f`) contains the files.

### 1.3 Local reachability
| Commit | Contained in local refs |
|---|---|
| `1cdf261` (earliest) | `main`, `origin/main` |
| `fe7307f` (HEAD) | `main`, `origin/main` |
| `72521a2` (latest) | `origin/main` only (local `main` is 0 ahead and 2 behind `origin/main` as of the last fetch) |
`fix/vercel-build` does not contain `1cdf261`. There are no tags and no stashes; the local reflog has 51 entries. The remote is hosted at `github.com`; the remote URL carries no embedded credentials. **Conclusion (local): the credentials are in commits that exist on `origin/main` as last fetched.** Whether anyone other than the owner can read that repository is UNVERIFIED.

### 1.4 Related exposures found while checking (variable names only; values not shown)
| Item | Fact | Class |
|---|---|---|
| `ownus/.env.local` (gitignored) | holds a `DATABASE_URL` with the **same role, password and host** as `apps/api/.env` (a second legitimate consumer to update on rotation) | LOCAL FILE FACT |
| `apps/api/.env` `DB_HOST`, `DB_USER`, `DB_PASSWORD` | do **not** equal the parts of its `DATABASE_URL` (they are not the exposed credential) | LOCAL FILE FACT |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | the values in the local `apps/api/.env` also appear in the tracked `docker-compose.yml` (45 revisions). Whether production uses the same values is UNVERIFIED; if it does, tokens could be forged by anyone who can read the repository | LOCAL FILE/GIT FACT + UNVERIFIED |
| `TYPESENSE_API_KEY` | the local value equals the development default committed in `apps/api/.env.example`, `src/config/*`, `seed.ts`, `typesense.provider.ts`, `docker-compose.yml` (80 revisions); it is the known development key. Whether production uses it is UNVERIFIED | LOCAL FACT + UNVERIFIED |
| Other secret-like names in `apps/api/.env` (`STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`) | no occurrence of their values in tracked working-tree files or in history | LOCAL FACT |
| Pipeline repository | no tracked file contains a remote credentialed URL (localhost defaults only) | LOCAL FACT |
These related items are outside RR-25's scope; they are listed so the owner can decide whether to rotate them in the same window (§5, R4).

## 2. Unverified
Repository visibility and access list; whether the repository was cloned, forked or mirrored; whether GitHub caches or pull-request refs expose the commits; whether the credential is still valid; whether the same credential is the one the production deployments use; whether the Neon access logs show use from unknown sources; whether CI or deployment logs printed the value; what the deployment platform's environment holds (the Vercel link exists under `.vercel/`, contents of its settings are not known).

## 3. Recommended exclusions (not applied; `.gitignore` files were not modified)
`.gitignore` only affects untracked files; it does **not** untrack files already committed (that needs a separate `git rm --cached`, §5 R6). Existing coverage: `.env`, `**/.env`, `.env.local`, `*.log`; `ownus/.gitignore` ignores `.env*`. Suggested additions, for review:
```
# scratch and ad hoc database scripts (they read or embed connection strings)
scratch/
ownus/scratch/
ownus/scratch_*.js
# generated rehearsal and audit output (counts only, but environment-specific)
apps/api/before.json
apps/api/before.clean.json
apps/api/after.json
apps/api/*-result.txt
apps/api/staging-e2e.log
# local assistant/tooling state
.claude/
```
Cautions: do **not** ignore `apps/api/src/database/migrations/meta/*_snapshot.json` (these are legitimate Drizzle snapshots that must stay tracked) or `docs/phase-a2/`; the tracked example files (`.env.example`, `.env.production.example`) must keep placeholders only. `.claude/` is the owner's decision. Playwright reports and test results are already ignored; check their local copies for credentials (§5, R8).

## 4. Legitimate configuration locations that need updating after an authorized rotation
Names only; no values.
| Location | Variable | Status |
|---|---|---|
| `apps/api/.env` (gitignored, local) | `DATABASE_URL` | holds the exposed role |
| `ownus/.env.local` (gitignored, local) | `DATABASE_URL` | holds the same role |
| Deployment platform environment for the Orion API and gateway (Vercel project linked under `.vercel/`; any other host) | `DATABASE_URL` (and, if used, `DB_*`) | UNVERIFIED: the owner must check the dashboard |
| `docker-compose.yml` | `DATABASE_URL` service environment | a local-development default; confirm it does not hold the exposed credential (it contains a localhost URL only) |
| Any operator workstation or runner used for migrations, seeds, audits and Phase A2 | `DATABASE_URL` / the Phase A2 role in the approval record (§6) | must use the post-rotation credential |
| Pipeline `.env` | `DATABASE_URL` | observed pointing at a local database, not this credential; confirm no deployed pipeline instance uses the exposed one (UNVERIFIED) |
| Templates | `.env.example`, `.env.production.example`, `apps/api/.env.example` | placeholders only; no change expected |
| Tests | `STAGING_DATABASE_URL`, `STAGING_CONFIRM_HOST` | staging only; not production |
Consumers that read `DATABASE_URL` from the environment and will pick up the new value without code changes: `apps/api/drizzle.config.ts`, `src/database/migrate.ts`, `seed.ts`, `src/config/*`, `apps/api/scripts/*.ts`, `ownus/src/lib/db.ts`, and the tracked `scratch/` scripts.

## 5. Remediation checklist (ordered; each item needs the stated approver)
Nothing here is done. Do not skip ahead: step R5 must follow R4's verified cutover.

**R0. Coordinate and pause.** Tell collaborators the credential is being replaced; pause pushes and new clones if possible; keep a list of who has local copies. *Approver: repository owner.*
**R1. Confirm the affected role (authorized database administrator).** In the provider console, identify which role(s) correspond to the exposed credential; whether the same role serves the production API, the gateway and any pipeline instance; whether other roles share the password; direct versus pooled endpoints. Record role names (not passwords). *Approver: database owner.*
**R2. Assess exposure.**
- Repository: visibility (public/private), collaborator list, forks, deploy keys and integrations, pull-request refs; the earliest possible exposure date is `1cdf261` (2026-09-21) and the push time is UNVERIFIED.
- Provider: connection and audit logs since 2026-09-21 for unfamiliar sources; last password change.
- Other: CI, deployment and build logs; screenshots; chat or ticket copies.
*Approver: database owner, repository owner.*
**R3. Rotate through the provider's approved workflow.** Either reset the role's password or create a replacement role and cut over; choose with the administrator based on R1 and the permission model in `TARGET_ARCHITECTURE.md` §8 (a replacement role is preferable when roles are being separated anyway). Generate the new credential in the provider, store it only in secret stores, never in chat, tickets or files. Schedule so that active connections (including pooled ones) are handled. *Approver: database owner; a production change.*
**R4. Update legitimate consumers and verify safely.** Order: put the new value in the deployment platform's secret store; update the local files `apps/api/.env` and `ownus/.env.local`; redeploy or restart; verify with non-destructive checks only (health endpoint, a login with a disposable test identity, a read-only query through an approved tool, `npm run db:audit` which is read-only). Do not run the scratch scripts or any seed or cleanup script to "test". Decide whether to rotate the related secrets in §1.4 in the same window (JWT secrets invalidate existing sessions; schedule accordingly). *Approver: owner of each consumer.*
**R5. Revoke the old credential.** After R4 is verified, ensure the exposed credential no longer works (a reset password does this automatically; for a new role, disable or drop the old role after confirming nothing still depends on it). Verify refusal of the old credential only through a controlled, authorized test. *Approver: database owner.*
**R6. Remove scratch files from tracking in a separate reviewed change.** One reviewed commit that untracks the seven files (and, as a separate decision, the remaining scratch directories) and adds the exclusions in §3. The files may be kept locally outside the repository if the owner wants. This does not remove them from history. *Approver: repository owner; no deletion until approved.*
**R7. Evaluate history cleanup (after R5).** Once the credential is revoked, history cleanup is hygiene, not containment. Options: leave history as is (acceptable only if the repository was always private and the secret is revoked); or rewrite history to drop the files from all branches with a history-filtering tool, force-push, and have every collaborator re-clone. Costs: breaks open pull requests and clones, shared hashes change, forks and cached views may retain the data, and the rewrite itself is a risky operation that needs a backup mirror and a coordination window. If the repository was ever public, treat the secret as permanently disclosed and rely on rotation. *Approver: repository owner; explicit written decision.*
**R8. Review other copies.** Local clones and backups of the repository, IDE and assistant session caches, `.claude/` and tool transcripts, `playwright-report/` and `test-results/` (ignored but present), shell history, exported logs, CI and deployment build logs, any uploaded archives. Remove or secure copies that contain the old value. *Approver: each holder.*
**R9. Prevent recurrence.**
- Secret scanning: a pre-commit scanner plus a CI check using a maintained rule set, with a custom rule for credentialed connection-string literals and an allow-list for documented placeholders; scan the full history once to baseline.
- Hosting-side secret scanning and push protection, where the plan supports it (verify availability).
- Convention: scripts read `DATABASE_URL` from the environment only; development uses a disposable database; production credentials exist only in the deployment secret store.
*Approver: repository owner.*
**R10. Close out.** Re-run the credential scan (no values printed) on the working tree and on history, record the result and residual exposure in RR-25, and confirm that the Phase A2 record and the rehearsal plan reference the post-rotation roles.

## 6. Risks, dependencies and rollback
| Item | Note |
|---|---|
| **Never restore the exposed credential** | Rollback of a failed cutover is a new, unexposed credential or a corrected configuration, never the old value. Keep the replacement role/password in the secret store until the cutover is accepted |
| Outage during rotation | active and pooled connections drop when a password is reset; schedule a window; verify before revoking the old one |
| Consumers unknown | the deployment platform's variables, any deployed pipeline instance or scheduled job may hold the old value; inventory before R3 (R1, R2); a missed consumer fails at R5 |
| Phase A2 | the operator's role and password in the approval record change with rotation; keep the record and the maintenance window consistent; do not run Phase A2 with the exposed credential if rotation is imminent |
| Rehearsal branches | a branch inherits the parent's roles in the provider; branches created before rotation hold the old credential until reset or deleted |
| Related secrets | rotating JWT secrets signs everyone out; rotating storage or mail keys needs matching provider changes |
| History rewrite | irreversible for downstream clones; take a mirror backup first; coordinate; not a substitute for rotation |
| Residual exposure | forks, caches and clones outside the owner's control cannot be recalled; rotation is the control |
| Evidence handling | do not paste the credential into tickets, chat or this repository while documenting the incident |

## 7. Proposed sequence of small, reviewable changes (none executed)
| # | Change | Type | Depends on |
|---|---|---|---|
| 1 | This plan and the RR-25 update (documents only) | documentation | none |
| 2 | R1-R2: confirm role, assess exposure | operational (read-only/admin console) | owner approval |
| 3 | R3-R5: rotate, update consumers, verify, revoke | production change (own change request) | 2 |
| 4 | R6: untrack the seven scratch files; add exclusions | one small commit | 3 |
| 5 | Untrack or relocate the remaining `scratch/` scripts | separate commit | 4, owner decision |
| 6 | Replace secret literals in `docker-compose.yml` (JWT secrets, Typesense key) with environment references and confirm production values differ | one commit | 3 |
| 7 | R9: secret scanning in pre-commit and CI; baseline scan | one commit | 4 |
| 8 | R7: history cleanup, only if chosen | coordinated operation | 3, 4, written decision |
| 9 | R8: purge other copies | operational | 3 |
| 10 | R10: verification scan and RR-25 closure | documentation | 3, 4, 7 |

## 8. Decisions and approvals needed
1. Authorize steps 2-3 (administrator access, rotation window, reset versus new role).
2. Confirm repository visibility and access, and the clones or forks that exist.
3. Approve the untracking commits (steps 4-5) and the exclusion list.
4. Decide on history cleanup after revocation.
5. Decide whether to rotate JWT secrets and treat the Typesense key in the same window.
6. Choose the secret-scanning tooling.

No part of this plan is performed until the owner approves it step by step.


---

# Part II. Detailed stage plans (second pass, 2026-10-02)

**Status: PLAN ONLY.** Part I (above) was reviewed and is preserved unchanged. This Part adds the rotation checklist for the authorized administrator, the exposure checklist, a per-file cleanup review, the JWT and Typesense assessments, the history-rewrite recommendation, the secret-scanning plan and the approval gates. The reviewable change list is in `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`.

Safety statement for this pass: no database, cloud provider, Typesense server or remote repository was contacted; no credential, environment file, tracked file, `.gitignore`, history, CI or setting was changed; nothing was staged, committed, stashed, reset or pushed. Secret values were compared in memory only and are not reproduced anywhere.

Evidence classes as in Part I (§0): **LOCAL GIT FACT**, **LOCAL FILE FACT**, **UNVERIFIED**; plus **PROPOSED** for actions not yet taken.

## II.1 New local fact that raises the severity
The credential in the seven files belongs to the role **`neondb_owner`** (user name comparison, in memory; a role name is not a secret). Earlier read-only audits (HIST, 2026-10-01) identified `neondb_owner` as the database owner role and showed no other application role in use. A credential for the owner role grants full read/write and DDL on every object in the database (and, on Neon, typically the ability to manage other roles; to be confirmed by the administrator). Treat the exposure as exposure of **full administrative database access**, not of a limited application account. Whether the credential is still valid and whether the same role is used by production remain UNVERIFIED.

## II.2 Stage 1: rotation checklist for the authorized database administrator
Nothing below is performed by this task. Never connect to the provider, create roles, reset passwords or edit environment files without the approvals in the change checklist.

### Before changing anything
1. **Confirm the affected role** in the provider console: it should be `neondb_owner` for the project/branch that hosts the production database. Record role names only. Confirm there is only one project/branch/endpoint set using it and note pooled and direct endpoints.
2. **Inventory legitimate consumers** (names only): `apps/api/.env` and `ownus/.env.local` (`DATABASE_URL`); the deployment platform's environment for the Orion API and gateway (the Vercel project linked under `.vercel/`; variable names to be read from its dashboard); any deployed pipeline instance; any migration, seed, audit or Phase A2 workstation or runner; scheduled jobs; CI (none found in the repository). Include the Phase A2 operator (§II.2.3) and all rehearsal branches (§II.2.4).
3. **Choose the replacement strategy** with the administrator:
   - *A. Reset the owner role's password and cut over all consumers at once.* Fastest revocation, but every connection drops and all consumers must change in the same window.
   - *B. Staged, least-privilege (preferred when practical):* first create a **replacement application role** (for example the `orion_app` role designed in `TARGET_ARCHITECTURE.md` §8) with only the privileges the Orion API and gateway need, move the runtime consumers to it, verify, and only then reset the `neondb_owner` password. The owner credential then exists only for migrations and break-glass, in a sealed store. Practicality depends on how much of the schema needs which privileges; a database role cannot hold two passwords, so a "second credential for the same role" is not an option. Dropping or demoting `neondb_owner` itself is normally not possible when it owns the objects.
   - The choice and the role design are the administrator's; this plan only records the trade-offs.
4. **Create the new secret only in the provider and the secret stores**; never in chat, tickets, the repository or this documentation.

### Cutover and verification (before revocation)
5. Update the secret in the deployment platform for each consumer, then update `apps/api/.env` and `ownus/.env.local` (names: `DATABASE_URL`; also `DB_HOST`, `DB_USER`, `DB_PASSWORD` if the deployment uses them: the local `DB_*` values were found not to equal the exposed credential).
6. Restart or redeploy; verify each consumer with non-destructive checks only: the API health endpoint; a sign-in with a disposable test identity; a read-only audit (`npm run db:audit`, which is read-only) run by the named operator; for the gateway, one read-only page. Do **not** use the scratch scripts or any seed/cleanup script to test.
7. Confirm in the provider console that active connections now use the new credential (administrator).
8. **Only then revoke the old credential** (password reset takes effect immediately; for a replacement-role strategy, remove the old privileges after confirming nothing still uses them). Verify refusal of the old credential through an authorized, controlled test by the administrator.

### Rollback (never restores the compromised credential)
9. If a consumer fails after cutover: fix its configuration to the *new* credential, or create another new credential. Do not re-enable the exposed one. Keep the new credential in the secret store until the cutover is accepted. If the old credential has not yet been revoked and a consumer cannot be moved in time, extend the window rather than reverting to it; the exposure continues until revocation, so keep that period as short as possible.

### II.2.3 Phase A2 operator
The approval record names the Neon role the operator uses (§6, currently `PENDING OWNER`). If the owner role is rotated, the operator's credential changes; settle the record, the window and the abort plan with that sequence in mind. Prefer that the operator use a **read-only** role rather than the owner role once one exists. Do not run Phase A2 using the exposed credential.

### II.2.4 Rehearsal branches
A database branch normally starts with the parent's roles and credentials. Any rehearsal branch created before rotation holds the exposed credential until the branch is reset or deleted: list existing branches and delete or reset them after rotation (administrator; separate confirmation for deletion). New rehearsal branches are created only after rotation and use branch-specific credentials where the console allows (`MIGRATION_REHEARSAL_PLAN.md` §15 G6).

## II.3 Stage 2: repository exposure checklist (for an authorized person)
No remote access was made. Tick each with evidence (screenshot or note without secrets):
- [ ] Repository visibility in the hosting settings (public, internal, private) and the date visibility last changed.
- [ ] Collaborators, teams, deploy keys, installed apps and tokens with read access; anyone with past access.
- [ ] Forks, mirrors and archives (including third-party mirrors if the repository was ever public); the fork list is visible in the repository's network/insights pages.
- [ ] Known local clones and where they live (laptops, CI runners, shared drives, backup tools).
- [ ] Pull requests and other refs (`refs/pull/*`) that may still expose the commits after a branch cleanup.
- [ ] Whether security alerts / secret-scanning alerts exist for the repository, and who received them.
- [ ] Provider connection and audit logs from 2026-09-21 (first commit containing the credential) to the rotation time, for unfamiliar sources, unexpected writes, role changes or new roles/extensions. Note that the first *push* time is unknown (UNVERIFIED); use the earlier of the first commit date and the repository creation date if the push time cannot be found.
- [ ] Whether any deployed environment (Vercel production/preview, other hosts, any pipeline instance) uses the exposed credential.
- [ ] CI/build/deployment logs that may have printed the value.
**Treat the credential as compromised until the administrator has completed remediation.** Absence of evidence in logs is not proof of non-use.

## II.4 Stage 3: tracked-scratch cleanup review (nothing executed)
### II.4.1 The seven credentialed scripts: remove from tracking
All seven embed the exposed credential and (from the scan of statements) most can **write** to the database: `scratch_master_e2e_verification.js`, `scratch_test_notifications_integration.js`, `scratch_test_single_device_login.js`, `scratch_test_app_preferences_persistence.js` and `scratch_test_profile_persistence.js` contain INSERT/UPDATE/DELETE statements; `scratch_inspect_tables.js` and `scratch_test_db.js` are inspection scripts. With the embedded owner credential these scripts could modify production. **Proposed action:** untrack all seven (proposed `git rm --cached`, files kept on disk until the owner decides) in one small reviewed commit; no history change in that commit.

### II.4.2 The other tracked scratch scripts: review individually, do not bulk-exclude
Counts only (no values). "Env" = reads configuration from the environment; "Writes" = contains INSERT/UPDATE/DELETE/DDL statements.
| Script(s) | Env | Writes | Notes | Proposed decision |
|---|---|---|---|---|
| `ownus/scratch_test_filter_queries.js` | yes | no | reads `DATABASE_URL`; no embedded credential | keep tracked or relocate; owner decision |
| `ownus/scratch/` read-only inspectors: `check_imported_businesses.js`, `inspect_business_locations.js`, `inspect_business_locations_schema.js`, `inspect_users_table.js`, `test_token_extraction.js`, `test_unlocked_lead_export_fields.js` | no or via helper | no | no embedded credential | review; candidates to keep as documented tools or untrack |
| `ownus/scratch/` with writes: `test_account_settings_persistence.js`, `test_google_auth_email_matching.js`, `test_insert_location.js`, `test_production_login.js` | partly | yes | `test_production_login.js` is named for production; it targets whatever the environment/URL it uses points at | review each; do not run; candidates to untrack |
| `scratch/` read-only: `check_business_locations.js`, `check_constraints.js`, `check_contacts_debug.js`, `inspect_db_schema.js`, `inspect_tables.js`, `inspect_user_schema.js`, `list_businesses.js`, `test_discover_filter_query.js`, `test_location_data_flow.js`, `fix_div.js`, `fix_linkedin_imports.js`, `fix_use_client.js` | most | no | source-edit helpers (`fix_*`) have no database use | review; keep or untrack individually |
| `scratch/` with writes: `backfill_locations.js`, `sync_user_unlocks.js`, `test_e2e_customer_filters.js`, `test_unlocked_export_query.js` | yes | yes (12-13 statements in two) | read `DATABASE_URL`; would write to whatever it points at | review; do not run without a disposable database; candidates to untrack |
No script has a hard-coded sign-in password literal (pattern check). Whether any script is still needed is the owner's decision; exclusion rules must not hide scripts the owner wants to keep.

### II.4.3 Proposed `.gitignore` additions (exact text, not applied)
```
# scratch / ad hoc database scripts (embed or read connection strings)
ownus/scratch_*.js
# generated rehearsal and audit output (environment-specific)
apps/api/before.json
apps/api/before.clean.json
apps/api/after.json
apps/api/*-result.txt
```
Held back pending review: `scratch/`, `ownus/scratch/` (rule only after each script is decided), `.claude/` (owner's decision). **Keep tracked:** `apps/api/src/database/migrations/meta/*_snapshot.json` and `_journal.json` (required by Drizzle) and `docs/phase-a2/`. `*.log` is already ignored (the local `staging-e2e.log`).
Because `.gitignore` does not untrack committed files, the rules take effect for the seven scripts only after the separate untracking commit. Do not commit `before.json`, `before.clean.json`, `after.json` unless their purpose is reviewed and approved (counts-only rehearsal snapshots; currently untracked and not ignored).

## II.5 Stage 4: JWT signing secrets
### Facts (LOCAL; values never shown)
- Variables: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. In the local `apps/api/.env` they equal the values committed in the tracked `docker-compose.yml`: lines 87-88 (service `api`) and 116-117 (service `web`) at HEAD.
- Committed in **45 revisions**, first `8dda755` (2026-09-18), last `72521a2` (2026-09-25); no other tracked file or history path contains them.
- Character traits of each (computed in memory): 88 characters, mixed case, digits and symbols, 47 distinct characters, no word-like parts. **These look like randomly generated secrets, not development placeholders**, which raises the chance that a deployment copied them. Whether production uses these values is **UNVERIFIED**.

### Code paths that use the secrets
- Orion API (NestJS): `apps/api/src/config/index.ts:36,38` (via `resolveSecret`); `auth/auth.module.ts:26`; `auth/services/auth-token.service.ts:44,67,122,137` (signing and verifying access and refresh tokens); `auth/strategies/jwt.strategy.ts:14` and `jwt-refresh.strategy.ts:11` (verification); `modules/oauth/services/oauth-state.service.ts:22` (OAuth state signing uses the access secret).
- Gateway (Next.js): `ownus/src/lib/gateway-auth.ts:28-34,95` (`accessSecret`, `refreshSecret`, derived reset and admin-OTP keys); `ownus/src/app/api/v1/[...path]/route.ts:273-295` (gateway login signs 24 h access and 7 d refresh tokens), `:550` (admin session token), `:1424-1425`.
- API tokens default to 15 min (access) and 7 d (refresh) (`config/index.ts:37,39`); the gateway issues 24 h access tokens. Refresh tokens are also stored as SHA-256 hashes in the database (`auth-token.service.ts:79`), but verification fails on the signature before any database lookup.

### Effect of changing them
- **All existing access tokens and refresh tokens stop verifying** (signature check), so every user is signed out and must authenticate again; sessions that rely on the `activeSessionId` single-device check restart.
- Password-reset links and admin OTP challenge cookies (keys derived from the access secret) become invalid; in-flight OAuth state values (15-minute lifetime) fail.
- There is **no multi-key (old and new) verification** in the code, so rotation is a hard cutover with no grace period.
- The API and the gateway must be given the same two values at the same time, or tokens issued by one are rejected by the other (the gateway and API share these variables by design).

### Coordination
Choose a low-traffic window; announce the sign-out; set new random values (generated outside the repository, at least the length now in use) in the deployment secret store for both the API and the gateway; deploy both together; communicate that users must sign in again; optionally purge expired refresh-token rows afterwards. Replace the committed values in `docker-compose.yml` with environment references in a separate change (change checklist C-8). Do not commit the new values.

### Verification that old secrets are no longer accepted
Because there is no dual-key support, the check is behavioural: before rotation, keep one *disposable test account's* access and refresh tokens (never a real user's); after rotation, replay them against an authenticated endpoint and the refresh endpoint and expect 401 on both; also confirm that new sign-ins succeed and that the gateway and API accept each other's new tokens. No old secret needs to be (or should be) retained for this test.

## II.6 Stage 5: Typesense key
### Facts
- **Committed (HEAD):** the development default is a literal in `apps/api/.env.example:30`, `apps/api/src/config/env.validation.ts:29`, `config/index.ts:27`, `database/seed.ts:395`, `modules/typesense/typesense.provider.ts:25` and `docker-compose.yml` lines 30 (service `typesense`, the server's own key) and 81 (service `api`). **Working tree:** the code now keeps the literal only in the untracked `apps/api/src/config/secrets.ts:34` (`DEV_ONLY_DEFAULTS.typesenseApiKey`) and refers to it elsewhere. Present in 80 revisions since `be1ae3e` (2026-09-11). The local `apps/api/.env` holds the same value. Another tracked file, `ownus/docker-compose.yml`, held it in 35 earlier revisions (last `bf5f52e`, 2026-09-18) and no longer exists at HEAD.
- Use: only when `SEARCH_PROVIDER=typesense`; the default is `postgres` (`env.validation.ts:23`) and the local value is `postgres`, so the application does not use Typesense locally. In production the code **rejects** the development value when Typesense is the provider (`env.validation.ts:30`, `config/index.ts:29-31`, `seed.ts:398`).
- Exposure: the compose file publishes the Typesense port on loopback only (`127.0.0.1:8108`, `docker-compose.yml:33`), so the key protects a local container not reachable from the network by default. By Typesense's design the key passed as the server's `API_KEY` is the administrative key (all collections and operations); this is documented product behavior, not something the repository configuration restricts. Its name contains "master". It is a development default: **low direct risk** unless a deployed Typesense instance was configured with it.
### Assessment and proposal
- Treat it as a *known* public default: never valid for any non-local Typesense server.
- If any deployed environment uses `SEARCH_PROVIDER=typesense`, confirm (platform dashboard, UNVERIFIED) that its key differs; if it equals this default, replace it with a randomly generated admin key and issue a **restricted search-only key** to the application for query paths; use the admin key only for indexing/seed. Keys are created on the Typesense server by its administrator.
- Verify a replacement safely: with the new restricted key confirm search succeeds and an administrative action (create/delete collection) is refused; with the old default confirm it is refused. Do this only against the server whose key was replaced, by its administrator. Do not connect to any Typesense server in this task.
- Repository change (separate): remove the literal default from the committed compose and config files and read it from the environment, keeping the existing production rejection.

## II.7 Stage 6: Git history remediation recommendation
Prepared separately from rotation. **History rewriting cannot replace credential rotation and cannot erase copies already held by others** (clones, forks, mirrors, caches, pull-request refs, CI artifacts, backups).
- **Recommendation (PROPOSED):** rotate and revoke first (R3-R5); untrack next (C-4); decide on a rewrite only after visibility and copies are known. If the repository was ever public, or has many clones/forks, a rewrite adds little beyond tidiness and costs coordination: rely on rotation. If the repository is and always was private with a small, known set of holders, a one-time rewrite that drops the seven scripts and scrubs the compose secret lines from all reachable history is reasonable hygiene.
- **Scope if rewritten:** remove the seven credentialed scripts from every branch/revision; scrub the two JWT lines and the Typesense key literal from `docker-compose.yml`, `apps/api/.env.example`, `apps/api/src/config/*`, `seed.ts`, `typesense.provider.ts` in all revisions only if the owner wants history to be clean of them (the Typesense default will remain visible in current code unless replaced). Keep all other history.
- **Backup and recovery:** first make a complete mirror of the repository (all refs) and verify that it restores; store it offline with restricted access (it contains the secrets); keep it until the owner confirms the rewrite and then dispose of it securely. Record the old and new tip commit IDs.
- **Mechanics (outline only, not run):** use a maintained history-filtering tool on a fresh mirror clone, never on the working repository; list the exact paths and text patterns to remove using file paths rather than secret values on the command line (patterns that contain secrets leak them through shell history and process lists); push with a force-with-lease to the branches the owner names, only during a coordinated window; also update or delete stale branches and pull-request refs that still hold the old commits.
- **Collaborators:** announce the window; pause pushes; everyone discards local clones and re-clones (do not merge old branches into the rewritten history, which would re-introduce the secrets); rebase or cherry-pick unmerged work onto the new history; check local reflogs and any backup tools.
- **Verification (values never pasted into commands):** scan the rewritten reachable history with the same in-memory comparison used here (compare against the old values held by the administrator, output counts only) and with a general scanner; confirm zero hits in every ref; confirm the old commit IDs are unreachable from all refs; ask the hosting provider to purge cached views and unreferenced objects if the repository was public.
- **Approval:** repository owner, written decision; explicit separate approval for the force-push.

## II.8 Stage 7: secret scanning (plan only; nothing installed or configured)
1. **Hosting-side scanning and push protection** (GitHub secret scanning, push protection): availability depends on the repository's visibility and plan (UNVERIFIED); enable if available, with alerts routed to named people. Do not change repository settings in this task.
2. **Local pre-commit scanner** (for example a maintained scanner such as gitleaks, run through the `pre-commit` framework or a husky hook): blocks commits of staged changes that match secret rules.
3. **CI scan** of every pull request diff and a scheduled scan of the full tracked tree and history; failing the build on findings; findings reported **redacted** (use the scanner's redaction option; never print match text in logs).
4. **Custom rules:** (a) connection strings with an embedded user name and a non-placeholder password; (b) assignments to variables named `*_SECRET`, `*_API_KEY`, `*_TOKEN`, `*_PASSWORD` with long literal values; (c) private-key headers. Allow-list only exact documented placeholders (for example the `.env.example` entries and the documented localhost defaults), by file path and a stable fingerprint, never by broad regex.
5. **Baseline handling:** a first full-history scan produces a findings list stored privately; every historical finding is reviewed by a human and either remediated (rotated/removed) or recorded with a reason; the baseline file stores fingerprints (not secret text) and has an owner and a review date. A baseline must never be used to silence an unreviewed finding; new findings outside the baseline fail the build.
6. **Handling a finding:** treat as an incident (rotate first, then clean up); never paste the matched value into tickets or chat.
7. **Conventions that reduce false positives and leaks:** scripts read `DATABASE_URL` from the environment only; development uses a disposable database; production credentials exist only in the deployment secret store; `.env.example` holds placeholders.

## II.9 Stage 9: approval gates (exact proposed actions)
Each gate needs its own explicit approval; approval of one is not approval of any other. The full per-change table is in `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`.
| Gate | Exact proposed action | Approver |
|---|---|---|
| G-1 | Change the `neondb_owner` credential or create a replacement role (provider console), per §II.2 | database owner/administrator |
| G-2 | Update deployment environment variables for the new database credential | owner of each deployment |
| G-3 | Update `apps/api/.env` and `ownus/.env.local` (local files) | the developer who owns the machine |
| G-4 | Untrack the seven credentialed scripts (`git rm --cached`) in one commit | repository owner |
| G-5 | Edit `.gitignore` as in §II.4.3 | repository owner |
| G-6 | Rotate JWT secrets (API and gateway together) | application owner + deployment owner |
| G-7 | Rotate or restrict the Typesense key (only if a deployed instance uses the default) | Typesense administrator |
| G-8 | Rewrite Git history | repository owner (written) |
| G-9 | Push commits / change remote branches | repository owner |
| G-10 | Change CI workflows or repository security settings | repository owner |
