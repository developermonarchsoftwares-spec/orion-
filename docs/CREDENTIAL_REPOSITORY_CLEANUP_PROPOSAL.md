# Repository cleanup and history-remediation proposal (RR-25)

**Status: PROPOSAL ONLY. Nothing applied: no file untracked, deleted, moved or renamed; `.gitignore` unchanged; no commit, push or history change. No approval gate is passed.** Date: 2026-10-03. Companion to `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` (§7 waves 5 to 7) and the checklist items C-6, C-7, C-8, C-13 (gates G-4, G-5, G-8, G-9). Related: `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md` Part II §II.4 and §II.7.

**No secret appears here.** Only paths, counts, dates and structure are reported.

## 1. Facts this proposal relies on
- Seven tracked scripts embed a credentialed URL for the owner role on the endpoint the applications use: `ownus/scratch_inspect_tables.js`, `ownus/scratch_master_e2e_verification.js`, `ownus/scratch_test_app_preferences_persistence.js`, `ownus/scratch_test_db.js`, `ownus/scratch_test_notifications_integration.js`, `ownus/scratch_test_profile_persistence.js`, `ownus/scratch_test_single_device_login.js`. An eighth file, `ownus/scratch_test_filter_queries.js`, reads `DATABASE_URL` from the environment and holds no literal.
- 23 of 80 revisions contain the credential (first `1cdf261`, 2026-09-21; last `72521a2`, 2026-09-25), reachable from `main` and `origin/main` as last fetched.
- Five of the seven scripts contain write patterns against the `users` family of tables; two are read-only.
- The index is empty (nothing staged). The working tree has 59 modified and about 130 untracked entries, including unrelated People-import work whose authorship `REQUIRES TEAM CONFIRMATION`. `.gitignore` is unchanged.
- The existing test suites (`apps/api/test/*.e2e-spec.ts`, 12 suites run through the staging guard) have no spec named for notification preferences, app preferences or profile persistence; the auth, account-integrity and credit-wallet specs may overlap other scenarios (unverified).

## 2. Per-file review (nothing applied)
Common disposition: **remove from Git tracking in one reviewed commit (G-4); keep the working copy on disk until the owner decides; no bulk deletion; no history change in that commit.** The question "keep outside the repository?" is answered per file.

| File | What it does (from structure) | Risk | Keep outside the repo? | Reason and safe replacement |
|---|---|---|---|---|
| `ownus/scratch_inspect_tables.js` | reads table structure from `information_schema` | credential embedded; read-only | **No**; discard the local copy after rotation | superseded by `npm run db:audit` and the Phase A2 evidence checks; both read-only |
| `ownus/scratch_test_db.js` | tests connectivity to remote and local databases; masks the password in its output; disables TLS certificate verification | credential embedded; weak TLS setting | **No**; discard after rotation | a connectivity check is better done by the health route |
| `ownus/scratch_master_e2e_verification.js` | 264-line verification across the database and HTTP calls; inserts and updates `users` and `user_wallets` | credential embedded; writes; highest risk | **Only if the owner wants its scenarios**, as a sanitized copy outside the repository | rebuild its scenarios as a guarded staging spec that reads `STAGING_DATABASE_URL` and refuses the production host (the existing `staging-guard`); never run against the production endpoint |
| `ownus/scratch_test_app_preferences_persistence.js` | tests saving app preferences; inserts and updates `users` | credential embedded; writes | **Optional**, sanitized copy | scenario is not covered by a spec by name; port to a guarded staging spec if the behavior matters |
| `ownus/scratch_test_notifications_integration.js` | tests notification preferences; inserts and updates `users` | credential embedded; writes | **Optional**, sanitized copy | same |
| `ownus/scratch_test_profile_persistence.js` | creates or fetches a test user and tests profile persistence, with HTTP calls | credential embedded; writes | **Optional**, sanitized copy | same; creates test users, so use only on an isolated branch |
| `ownus/scratch_test_single_device_login.js` | tests the single-device login rule; inserts and updates `users` | credential embedded; writes | **Optional**, sanitized copy | may overlap the auth specs (unverified); check before porting |

"Sanitized copy" means: stored outside the repository (a private folder with restricted access), with no literal credential, reading `STAGING_DATABASE_URL` from the environment, refusing any host that equals the production host, and read-only unless a flag is set deliberately. A copy that still contains the old literal is harmless only after the credential is revoked, but must still not be recommitted. The recommendation for the disposition of local copies of the three "discard" and the four "optional" files is the owner's decision; this proposal does not delete anything.

`ownus/scratch_test_filter_queries.js`, the 10 files in `ownus/scratch/` and the 16 in `scratch/` are separate decisions (C-8), one at a time. Four scripts in each of the two directories write to whatever `DATABASE_URL` points at; do not run them while the environment points at the endpoint in question.

## 3. Proposed tracking commit (G-4) and ignore rules (G-5)
### 3.1 Sequence and prerequisites
1. Prerequisite: the database credential replacement has begun and, ideally, completed (untracking does not reduce risk while the exposed credential is valid).
2. Confirm the index is empty. Stage **only** the seven paths as removals from tracking while keeping the files on disk (the standard "remove from index, keep working copy" operation). Do not use any command that stages everything.
3. Before committing, list the staged paths and confirm the list is exactly the seven. Commit those only, as one commit. Do not push in this commit (G-9 is separate).
4. A separate later commit adds the ignore rules, after the first is in place.
5. Do not touch the modified or untracked files of other work. Owners of that work commit it separately.

### 3.2 Proposed `.gitignore` additions (not applied)
```
# scratch / ad hoc database scripts (embed or read connection strings)
ownus/scratch_*.js
# generated rehearsal and audit output (environment-specific, counts only)
apps/api/before.json
apps/api/before.clean.json
apps/api/after.json
apps/api/*-result.txt
```
Notes:
- The glob `ownus/scratch_*.js` also matches the eighth file `scratch_test_filter_queries.js`. Because that file is already tracked, the rule does not untrack it; it only stops new files of that pattern from being added. If the owner prefers precision, list the seven exact paths instead of the glob.
- Held back until each script is decided: `scratch/`, `ownus/scratch/`, `.claude/`.
- Keep tracked: `apps/api/src/database/migrations/meta/*_snapshot.json` and `_journal.json` (Drizzle needs them) and `docs/phase-a2/`. `*.log` is already ignored (this covers `apps/api/staging-e2e.log`).
- `.gitignore` only affects untracked files. It does **not** untrack committed files; the tracking commit does that.
### 3.3 Validation after approval
`git ls-files` no longer lists the seven; the files still exist on disk; the new patterns are reported as ignored by the ignore-check command; the migration snapshots, journal and `docs/phase-a2/` are still tracked; `git status` shows no accidental staging of other work.
### 3.4 Rollback
Revert the commit(s). This re-tracks the files, which still contain the credential: acceptable only after it is revoked; otherwise remove the literal first.

## 4. What untracking, ignoring or deleting does not do
Removing a file from tracking, deleting it, or ignoring it only changes future commits. **All 23 revisions still contain the credential**, as do forks, clones, caches, backups and any hosting provider copies. A `.gitignore` rule does not untrack committed files. Only a history rewrite changes the repository's own history, and even that cannot recall copies others already hold. The control that makes the exposed value useless is replacing and then revoking the credential (execution plan §4).

## 5. History-remediation proposal (separate; optional; not recommended before rotation)
### 5.1 Is it warranted?
Decide only after the database credential is revoked and these are known (tracker GH-1 to GH-8): repository visibility now and ever, collaborators, forks and clones, push events.
| Situation | Recommendation |
|---|---|
| Repository ever public, or many forks/clones | rely on rotation; a rewrite adds little beyond tidiness and costs coordination |
| Always private, small known set of holders | a one-time rewrite is reasonable hygiene |
| Visibility unknown | do not rewrite; first answer GH-1 |

### 5.2 Scope if chosen
- Remove the seven scripts from every branch and revision.
- Scrub the JWT lines and the Typesense key literal from `docker-compose.yml`, `apps/api/.env.example`, `apps/api/src/config/*`, `seed.ts` and `typesense.provider.ts` in all revisions, only if the owner wants history clean of them (the Typesense development default stays visible in current code unless replaced).
- Keep everything else. List paths and patterns by file path, never by secret value on a command line (values leak through shell history and process lists).

### 5.3 Prerequisites (all required)
1. Database credential revoked (plan N-9), JWT decision made, visibility and copies known.
2. **Uncommitted work protected first.** The working tree holds 59 modified and about 130 untracked entries, including the People-import work. Their owners commit or branch that work before any rewrite, because a rewrite requires everyone to re-clone and uncommitted work in an old clone is lost or must be moved by hand. This proposal does not commit it.
3. A complete mirror backup of the repository (all refs), verified to restore, stored privately and securely (it contains the secrets); old and new tip commits recorded.
4. A coordination window with pushes paused, and a written decision by the repository owner.
5. Separate approvals: G-8 (rewrite) and G-9 (force-push to named branches).

### 5.4 Outline (not executed)
Work on a fresh mirror clone with a maintained history-filtering tool, never in the working repository; remove the listed paths and scrub the listed lines; verify; push with a force-with-lease to the named branches only; delete or update stale branches and pull-request refs that keep old commits (`fix/vercel-build` has no commits of its own and is a candidate to delete, G-9); everyone re-clones and rebases unmerged work onto the new history (do not merge old branches in, which reintroduces the secrets); ask the hosting provider to purge cached views and unreferenced objects if the repository was ever public.

### 5.5 Verification and rollback
Scan every reachable ref of the rewritten repository with the same in-memory comparison used in the audits (values held by the administrator; output limited to counts); confirm the old commit IDs are unreachable; build and test from a fresh clone. Rollback is restoring the mirror (itself a force-push). Keep the backup until the owner closes the incident.

## 6. Protecting existing and concurrent work
- Nothing in this proposal stages, commits, deletes or rewrites anything. The People-import files and all other uncommitted changes are untouched.
- Any later commit must name its paths explicitly; never bulk-add untracked files; never use reset, clean, stash or checkout on the working tree.
- Authorship and purpose of the concurrent changes `REQUIRES TEAM CONFIRMATION`.

## 7. Approvals and blockers
| Item | Gate | Approver | Depends on |
|---|---|---|---|
| Untrack the seven scripts | G-4 | repository owner | credential replacement begun or complete; index empty; named paths only |
| `.gitignore` rules | G-5 | repository owner | tracking commit made; patterns reviewed |
| Decide remaining scratch scripts | G-4/G-5 per script | repository owner | one-by-one review |
| History rewrite | G-8 | repository owner (written) | revocation; GH answers; mirror backup; uncommitted work protected |
| Pushes and remote branch changes | G-9 | repository owner | each push approved separately |
Blockers today: no approver named; credential replacement not started; visibility and copies unknown; uncommitted work not separated.

## Completion statement
No file was changed, untracked, deleted, moved or renamed; `.gitignore` is unchanged; nothing was staged, committed or pushed; no history was rewritten; no scratch script was run; no external service was contacted; no credential was tested or changed. The People-import work was not read or touched. No approval gate was passed.
