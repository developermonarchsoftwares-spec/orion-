# SG-02 remediation: exposed credentials in the repository

**Updated:** 2026-10-09 · **Finding:** SG-02 in `SECURITY_GAP_REPORT.md` · **Overall status: OPEN (P0).** The Git remote is now credential-free and the working tree is clean, but nothing shows that any exposed credential was rotated, the exposing commits are on a publicly reachable repository, and a second pair of secrets (JWT signing secrets) was found in the same history during this pass.

Status labels used below: **COMPLETED** (verification evidence exists) · **PENDING** (not yet performed) · **UNVERIFIED** (evidence insufficient) · **BLOCKED** (needs access or approval that is not available).

No secret value, credential-bearing URL or token is written in this document. One disclosure about the work itself: while checking the committed `docker-compose.yml` I ran a command whose redaction pattern was too loose and it printed the **first 18 characters** of one JWT access secret to the terminal (a fragment of a value that is already in public Git history, not enough to use). It is not repeated anywhere, and that secret is treated as compromised in any case (section 7).

## 1. Exposure summary (paths and commits only)

### 1.1 Database credential (the original SG-02)

| Item | Detail | Status |
|---|---|---|
| What | A database URL with password for the managed PostgreSQL (Neon-hosted) **owner role**, pooled endpoint, one distinct secret value | |
| Files at HEAD and in history | `ownus/scratch_inspect_tables.js`, `scratch_test_db.js` (commit `1cdf261`, 2026-09-21); `scratch_test_profile_persistence.js` (`51e857d`, 09-22); `scratch_master_e2e_verification.js`, `scratch_test_notifications_integration.js` (`5859572`, 09-22); `scratch_test_app_preferences_persistence.js`, `scratch_test_single_device_login.js` (`58392f3`, 09-22) | |
| Reachability | All four commits are on `origin/main`. The repository answered HTTP 200 to an unauthenticated request on 2026-10-09 (publicly visible). No pull-request refs and no tags exist on the remote. | |
| Rotation of the credential | No evidence | **UNVERIFIED** |

### 1.2 JWT signing secrets (found in this pass)

| Item | Detail | Status |
|---|---|---|
| What | `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` as literal values in `docker-compose.yml`, commit `97a8eea` (2026-09-18), on `origin/main`; still present at HEAD (the working-tree file now uses `${...}` references, uncommitted) | |
| Local reuse | The values in your local `apps/api/.env` and `ownus/.env.local` are **identical** to the committed ones (hash comparison, no values shown) | confirmed |
| Production reuse | Whether Vercel production, preview, staging or any other shared environment uses the same values cannot be seen (Vercel hides sensitive values in the pulled env file) | **UNVERIFIED** |
| Earlier history | Older commits `2bc61f9` and `a5fc394` hold other JWT, OAuth, Redis, storage and search-key defaults in `apps/api/src/config/env.validation.ts`, and `f666911` has a mail-key-shaped value in `ownus/src/lib/__tests__/email-service.test.ts`; these looked like development defaults or test constants but were not individually validated | **UNVERIFIED** |

### 1.3 Git remote token

| Item | Detail | Status |
|---|---|---|
| Embedded token in `remote.origin.url` | Removed from the remote URL in this pass (section 4). The value was a single 30-character token not matching a recognised token prefix, so its type is unknown. | removal **COMPLETED** |
| Revocation of that token in GitHub | Not possible from here; the old value is no longer stored locally by Git configuration | **PENDING** (operator) |

### 1.4 Checked and clear

- Local `.env` files for the API and web app point at a local database (does not use the exposed database credential): **COMPLETED** (host class and hash comparison).
- Example env files (`.env.production.example`, `apps/api/.env.example`, `.env.docker.example`, `ops/backup/backup.env.example`) hold placeholders and documented local defaults only: **COMPLETED**.
- Build and report folders (`.next`, `dist`, `playwright-report`, `test-results`, `brag-output`, `showreel*`, `scratch`): no matches: **COMPLETED**.
- Frontend: only `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` exist; none secret-named: **COMPLETED**.
- CI workflow references no secrets: **COMPLETED**.
- The two commits that exist only on `origin/main` (`3f1ffd2` "invoice download", `72521a2` workflow and admin portal, one scratch file added) were fetched and scanned: no findings: **COMPLETED**.

## 2. Dependent configuration (names only)

| System | Uses the exposed database credential? | Uses the exposed JWT secrets? | Status |
|---|---|---|---|
| Local development | No | **Yes** (local files equal the committed values) | **COMPLETED** |
| Vercel project `orion-api` (root dir `ownus`): `DATABASE_URL`, `DB_*`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and others exist | Unknown | Unknown | **UNVERIFIED** |
| Staging, other hosts, the Python data-pipeline service (documented as sharing the database) | Unknown | Unknown | **UNVERIFIED** |
| Backup job (`BACKUP_DATABASE_URL`) | Unknown | n/a | **UNVERIFIED** |
| CI | No secrets used | No | **COMPLETED** |
| Docker Compose (local containers) | No (uses its own Postgres) | Used the committed literals at HEAD; working tree now reads environment variables | **PENDING** (commit the compose change) |

## 3. Credential rotation: operator checklist

Rotation is the primary control. Nothing in Git cleanup substitutes for it. **BLOCKED** for me: it needs the database provider's dashboard and hosting-environment access. Do not paste any new value into chat, tickets, scripts, source files or commit messages.

**3.1 Database owner-role password (do first)**
1. In the managed PostgreSQL dashboard, open the project and branch behind database `neondb`; note the role `neondb_owner`. Keep screenshots or exported logs as evidence.
2. Review connection history and query logs since **2026-09-21** for unfamiliar addresses, unusual volume, new roles, new functions or schema changes.
3. **Reset the owner role's password** in the dashboard (this immediately invalidates the exposed one for pooled and direct endpoints). Place the new connection string straight into each secret store below.
4. Create separate least-privilege roles (application, migrations, gateway via `GATEWAY_DATABASE_URL`, read-only backup) and stop using the owner role at runtime. This is the supported way to limit the blast radius of any future leak.
5. Update every consumer, then restart: Vercel project `orion-api` (Production, Preview and Development as applicable; mark values Sensitive; **redeploy**); the backup job; the data-pipeline service; any staging environment. Local development keeps its local database.
6. Verify the replacement is in use: `GET /api/v1/health` shows database `up` after the redeploy, and the provider's connection log shows only the new role session from your deployment addresses.
7. Confirm the old credential is dead from the provider side (the password reset in step 3; role list shows no stale roles). **Do not test the old secret.**
8. Check integrity (using the new credential): users with role ADMIN or SUPER_ADMIN are all expected; no unexpected recent users or role changes; review `audit_logs` since 2026-09-21; look for unexpected roles, functions and triggers.
9. Revoke all sessions at the database level as defence in depth: set `refresh_tokens` revoked and rotate each user's `activeSessionId` (the application already does this on password reset; a one-off operator script or SQL run by you is needed, not run here).
10. Breach assessment with counsel; the privacy runbook (`INCIDENT_RESPONSE_RUNBOOK.md` §6) mentions a 72-hour regulator window from awareness. This is not legal advice.

**3.2 Git hosting token**: revoke the token that was embedded in the remote (compare creation dates in the account's token settings; revoke any unrecognised), review the account security log for use since 2026-09-21, and authenticate from now on only through the credential manager or SSH.

**3.3 JWT secrets**: see section 7 (assessment and separate execution plan).

Evidence recorded so far for rotation: **none**. Status **UNVERIFIED**.

## 4. Changes made in this pass (all reversible, nothing committed or pushed)

| Change | Detail | Status |
|---|---|---|
| Git remote | `origin` (fetch and push) changed to the same repository address without any credential, using a command that never printed the old value. Intended address confirmed from the existing configuration (host and path), the git user account name, and an unauthenticated HTTP 200 on that path. Read access verified with `git ls-remote`; **push authentication through the credential manager was not tested** (no push was made) | **COMPLETED** (credential removed); push auth **UNVERIFIED** |
| Fetch | `git fetch origin` run to inspect the 2 commits missing locally (no merge or pull; your 363 uncommitted entries untouched) | **COMPLETED** |
| `ops/security/scan-secrets.mjs` | Added a detector for signing and encryption secret literals (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_OTP_SECRET`, `MFA_ENCRYPTION_KEY`, `INTEGRATIONS_ENCRYPTION_KEY`) assigned long non-placeholder values; three self-test cases added | **COMPLETED** |
| `.gitignore` | Fixed a problem in my previous rule: `ownus/scratch_*.js` would also have ignored `ownus/scratch_target.js`, the local-only database helper that the cleaned scratch scripts and their guard test require. Added a negation so it stays trackable. | **COMPLETED** |
| Earlier in this task (previous pass) | `package.json` scripts `test:secrets`, `test:secrets:history`; CI step in `.github/workflows/test.yml`; `.gitignore` scratch rules; this document | **COMPLETED** |

**Not changed:** the seven scratch files (your uncommitted edits already remove the secret; they now require `scratch_target.js`, which accepts only a local `SCRATCH_DATABASE_URL`), the 34 tracked `scratch*` files (deleting or untracking needs approval), `docker-compose.yml` (your uncommitted edit already uses environment references), any `.env` file, Git history. Nothing was deleted, stashed, reset or cleaned. **No database or provider was contacted with any exposed credential.**

**Important for committing:** `ownus/scratch_target.js`, `ownus/src/lib/__tests__/scratch-scripts.test.ts` and the modified scratch scripts must be committed together; the guard test imports the helper.

## 5. Git history: plan only (nothing rewritten)

**State (re-scanned this pass):** 16 findings, **3 distinct secret values** (the database password and two JWT secrets) across commits `1cdf261`, `51e857d`, `5859572`, `58392f3` and `97a8eea`, all on `origin/main`. `fix/vercel-build` is an ancestor of `main` and does not contain them. Local `main` is 0 commits ahead of and 2 behind `origin/main`; no unpushed work would be lost by a rewrite, but the 2 remote commits must be included.

**Effect of a rewrite, stated plainly:** it does not undo the exposure. The repository was public; clones, forks, caches and the hosting service's own copies keep the old commits. **Rotation (section 3) is the control; the rewrite only reduces future discovery.** Skipping the rewrite leaves a standing, discoverable leak, so it should be done or the risk accepted in writing.

**Procedure, executed only on your explicit approval:**
1. Complete rotation and confirm; also decide the JWT outcome (section 7).
2. Commit the working-tree cleanup first (scratch files plus helper and guard test, compose change, scanner, CI) on a branch so no uncommitted work is at risk; keep a patch backup (`git diff` or `git stash` are **not** used; use a branch and `git format-patch`).
3. Pull or rebase onto `origin/main` to include `3f1ffd2` and `72521a2`.
4. `git clone --mirror` the repository to an offline backup and keep it until verification ends.
5. Announce a push freeze; pause deployments that build from `main`.
6. On a fresh mirror clone run `git filter-repo --replace-text` with an expressions file kept **outside** the repository (it maps the three secret values to a placeholder and is deleted afterwards). Alternative: `--invert-paths` for the seven scratch files and `docker-compose.yml`'s history, which loses more history.
7. Run `npm run test:secrets:history`; it must report 0 findings before any push.
8. `git push --force-with-lease --all` (branches: `main`, `fix/vercel-build`; no tags exist).
9. Every collaborator discards old clones and re-clones; unpushed work is exported with `git format-patch` first and re-applied. Open pull requests: none exist. Forks (if any) keep old history.
10. Ask the hosting provider's support to purge cached views and unreferenced objects; check for forks.
11. Re-enable deployments; re-scan a fresh clone; record the result here.

Status: **PENDING** (awaiting approval).

## 6. Secret scanning and CI

| Capability | Result |
|---|---|
| Detects database URLs with passwords, managed-database password prefixes, mail and OAuth secrets, live payment keys, GitHub tokens, cloud keys, private-key blocks, hosting tokens, signing and encryption literals, secret-named `NEXT_PUBLIC_` variables, credentials in Git remote URLs | **COMPLETED** (11 self-test cases pass) |
| Never prints matched values | Output has type, path, line, commit and an 8-character fingerprint only. A search of the full history-mode output for known value prefixes returned 0 hits. Errors raise a generic message with no value. | **COMPLETED** |
| Exit code | Tree scan exits 1 on any finding (observed earlier when the remote embedded a token; 0 now); `--history` exits 1 unless `--report-only` (observed 1) | **COMPLETED** |
| False positives and fixtures | Ignores local and example hosts, common placeholder passwords, and test-fixture words; documented trade-off: a real secret containing a placeholder word is also ignored | **COMPLETED** (limitation recorded) |
| Scripts | `npm run test:secrets` and `npm run test:secrets:history` run as described | **COMPLETED** |
| CI | `.github/workflows/test.yml` runs the self-test and the tree scan on push and pull request | **COMPLETED** in configuration; **UNVERIFIED** in a real CI run (nothing was pushed) |
| Hosting-service secret scanning and push protection | Cannot be checked or set from here | **PENDING** (operator: repository Settings > Code security > enable **Secret scanning** and **Push protection**; free for public repositories; also review the Security tab for alerts the provider may already have raised) |
| Full history clean | **No.** A passing self-test and a clean tree do not establish a clean history | open |

## 7. JWT secret assessment (assessment only; nothing rotated)

**How tokens work (read from code):**
- The API signs access tokens with `JWT_ACCESS_SECRET` and refresh tokens with `JWT_REFRESH_SECRET` (HS256 through the JWT module, issuer and audience set; `auth-token.service.ts`, `jwt.strategy.ts`, `jwt-refresh.strategy.ts`).
- The web gateway **verifies and signs** access tokens with the same `JWT_ACCESS_SECRET` (`ownus/src/lib/gateway-auth.ts`, native login and admin OTP in `route.ts`).
- Keys **derived from `JWT_ACCESS_SECRET`** when no explicit key is set: password-reset, e-mail-verify and MFA-login purpose tokens; the OAuth state signature; the admin OTP HMAC (unless `ADMIN_OTP_SECRET`); the AES key for stored **MFA TOTP seeds** (unless `MFA_ENCRYPTION_KEY`); the AES key for stored **integration secrets** (unless `INTEGRATIONS_ENCRYPTION_KEY`) (`secret-box.util.ts`). The production template leaves the last three empty.

**Is rotation warranted?**
- **The JWT secrets are themselves exposed:** the same literals are in public Git history and in your local environment files. So **the secrets must be treated as compromised.**
- **If any shared environment (Vercel, staging, the pipeline) uses these values** (UNVERIFIED), anyone with the repository can forge an access token for any user id, including an administrator: role checks read the persisted role, so a forged token for an admin's id is accepted. That is a more direct takeover than the database leak. Rotation is then **urgent and warranted**.
- **If only local files use them,** rotation of shared environments is not needed for SG-02, but the local files and compose should still get new, untracked values.
- **Compounding with the database leak:** the leaked owner role could read the stored MFA seeds and integration secrets, which are encrypted with keys derived from the JWT access secret. If production used the public value, an attacker holding both could decrypt them. In that case those secrets also need replacing (users re-enrol MFA; integration owners re-enter secrets).

**Expected impact of rotating (for the separate execution plan):**
- Every issued access and refresh token stops working: all customers and admins must sign in again; the 7-day admin gateway cookie is invalid.
- API and gateway must receive the same new access secret **together** (and the new refresh secret on the API); mismatch breaks gateway-signed sessions.
- Password-reset and verification links issued before the change stop working; the OAuth state in flight fails (one retry).
- **Do not rotate `JWT_ACCESS_SECRET` blindly:** stored MFA seeds and integration secrets are encrypted with keys derived from it and would become unreadable (MFA lockout, broken integrations). Before the switch, re-encrypt those rows to new independent keys (`MFA_ENCRYPTION_KEY`, `INTEGRATIONS_ENCRYPTION_KEY`) with a one-off script that opens each with the old base and seals with the new key; or ask affected users to re-enrol. This script does not exist yet.
- Other verifiers: any service that verifies Orion tokens (the data pipeline, if it does) must be updated; Docker Compose local containers; CI uses none.

**Separate execution plan (not run):**
1. Establish which environments use the committed values (compare each environment's secret with the committed one by hash, locally by the operator).
2. Generate new 64-byte random values for access and refresh secrets in the hosting secret stores (never in files).
3. Write and test the re-encryption script on a copy of the data; run it in a maintenance window.
4. Set `MFA_ENCRYPTION_KEY` and `INTEGRATIONS_ENCRYPTION_KEY` (and optionally `ADMIN_OTP_SECRET`) so future JWT rotations do not affect stored secrets.
5. Deploy API and gateway together; verify sign-in, refresh, admin sign-in, MFA login and one integration delivery.
6. Add a startup refusal in production for a JWT secret that equals a committed value (code change, separate task).

Status: assessment **COMPLETED**; rotation **PENDING** and **BLOCKED** on step 1 (environment access).

## 8. Verification results (executed 2026-10-09)

**Run and passed**
| Check | Result |
|---|---|
| `node ops/security/scan-secrets.mjs --self-test` | 11 of 11 cases passed |
| `npm run test:secrets` | 0 findings in tracked and untracked non-ignored files and in Git configuration (after the remote fix) |
| Remote credential check | 0 userinfo entries in `remote.*.url`; `git remote -v` shows credential-free addresses; `git ls-remote` succeeded |
| Env templates | placeholders and documented local defaults only |
| Secret-bearing local files | `.env`, `.env.local`, `apps/api/.env`, `ownus/.env.local`, `.vercel/*.local` are untracked and ignored |
| `NEXT_PUBLIC_` names | only `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` |
| `apps/api` `npm run test:security` | 9 of 9 |
| `apps/api` `npm run test:unit -- config` | 2 suites, 11 tests |
| web: scratch-scripts, db-config, gateway-auth tests | 26 of 26 |
| `node ops/testing/inventory.mjs --check` | passed |
| `.gitignore` | new `scratch_*.js` files are ignored; `scratch_target.js` is not |

**Run, reporting an open problem (expected)**
| Check | Result |
|---|---|
| `npm run test:secrets:history` | 16 findings, 3 distinct secret values, 5 commits (section 5); exit code 1 without `--report-only` |
| HEAD content | still contains the 7 scratch-file credentials and the 4 compose JWT literals because the cleanup is uncommitted |

**Not run:** the full API unit, integration and e2e suites and the Playwright suite (none of this pass's changes touch application code, so they were not rerun; the previous pass's results stand); a real CI run; push authentication; any check that needs the provider's dashboard.

**Awaiting the operator:** rotation and revocation; Vercel and other environment updates; token revocation; approvals in section 9.

## 9. Operator actions and approvals still required

1. **Reset the database owner-role password** and complete section 3.1; record evidence here.
2. **Determine whether Vercel production, preview or staging use the committed JWT secrets**; if yes, run the JWT rotation plan (section 7) urgently; if no, create new untracked local values.
3. **Revoke the old Git hosting token** and confirm sign-in through the credential manager (push authentication is untested).
4. **Approve committing the cleanup** (scratch scripts plus `scratch_target.js` plus guard test, compose change, scanner, CI, `.gitignore`, `package.json`) in one commit so HEAD stops containing the credentials.
5. **Approve untracking or deleting the 34 tracked `scratch*` files** (`git rm --cached` keeps local copies).
6. **Approve and schedule the history rewrite** (section 5) or accept the risk in writing.
7. **Enable secret scanning and push protection** on the repository, and confirm whether it should be public.
8. Confirm whether the data pipeline, a staging environment and the backup job use any of the exposed values.

## 10. Status tracker

| Item | Status |
|---|---|
| Exposed database credential rotated | **UNVERIFIED** / BLOCKED (dashboard) |
| Old database credential confirmed unusable | **UNVERIFIED** |
| Vercel production and preview environments reviewed and updated | **PENDING** / BLOCKED (hosting access) |
| Staging, pipeline, backup job reviewed | **UNVERIFIED** |
| Tracked working tree free of known secrets | **COMPLETED** (committed HEAD still contains them: **PENDING** commit) |
| `.env.example` and templates placeholders only | **COMPLETED** |
| Local secret files untracked | **COMPLETED** |
| Git remote credential-free | **COMPLETED**; token revocation **PENDING** |
| Git history cleaned | **PENDING** (plan ready, awaiting approval) |
| Scanner and scripts | **COMPLETED**; CI real run **UNVERIFIED**; platform secret scanning **PENDING** |
| JWT secret assessment | **COMPLETED**; rotation **PENDING** / BLOCKED |
| Relevant tests | **COMPLETED** (section 8) |

**SG-02 stays OPEN.** It can be marked RESOLVED only when the rotation items are COMPLETED with evidence, the cleanup is committed, the token is revoked, history is rewritten and re-scanned clean (or the residual risk is accepted in writing), and the JWT outcome is decided.

## 11. Remaining risks

- The database owner credential may still be valid and is public.
- The JWT signing secrets may still be valid in shared environments and are public; forged tokens would bypass the whole API.
- Data confidentiality and integrity since 2026-09-21 cannot be established from the repository.
- Forks and caches keep old commits regardless of a rewrite.
- Other copies of these values (other machines, Vercel, the pipeline repository) are outside this scan.
