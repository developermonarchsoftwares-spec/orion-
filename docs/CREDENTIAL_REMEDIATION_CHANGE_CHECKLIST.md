# Credential remediation: proposed change checklist (RR-25 and related secrets)

**Status: PROPOSED, nothing executed, nothing approved.** Date: 2026-10-02. Companion to `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md` (evidence and reasoning) and RR-25 in `PIPELINE_RUNTIME_RISK_REGISTER.md`.

Rules for every change below:
- Each change needs its **own explicit approval** from the stated approver. Approval of one change is not approval of any other.
- No secret value, password, token or complete connection string appears in this document, tickets, chat, logs or commits. Values live only in the provider and the deployment secret stores.
- **The exposed credential is never restored**, including as a rollback. Treat it as compromised until revoked.
- Nothing here removes files, edits `.gitignore`, changes provider settings, environment variables, CI or repository settings, rewrites history or pushes, until the matching approval is recorded.
- Unrelated working-tree changes and untracked files in both repositories are preserved at every step (no reset, clean, stash or checkout of existing work).

Affects legend: **L** local files; **P** provider credentials or provider settings; **D** deployment environment variables; **G** Git history or remote branches; **H** hosting/CI/security settings.

Evidence classes: **LOCAL FACT** (verified on this machine), **UNVERIFIED** (needs the provider, hosting platform or deployments), **PROPOSED**.

## Ordered summary
| # | Change | Affects | Approver | Gate |
|---|---|---|---|---|
| C-1 | Confirm affected role and consumers | P (read-only console) | database owner authorizes access; the database administrator performs the review | none beyond access |
| C-2 | Assess repository and provider exposure | H, P (read-only) | repository owner + database owner; the database administrator performs the provider review | none beyond access |
| C-3 | Create replacement credential or role; cut over | P, D, L | database owner / credential-change approver authorizes G-1; the database administrator executes and does not self-authorize | **G-1, G-2, G-3** |
| C-4 | Verify consumers on the new credential | D, L (read-only checks) | consumer owners | with C-3 |
| C-5 | Revoke the exposed credential | P | revocation approver authorizes (separate act); the database administrator executes and does not self-authorize | **G-1** (separate approval) |
| C-6 | Untrack the seven credentialed scripts | L, then G on push | repository owner | **G-4** |
| C-7 | Add `.gitignore` rules | L | repository owner | **G-5** |
| C-8 | Decide the remaining scratch scripts, one by one | L | repository owner | G-4/G-5 per script |
| C-9 | Rotate JWT signing secrets (API and gateway together) | D, L | application + deployment owners | **G-6** |
| C-10 | Remove secret literals from `docker-compose.yml` and config defaults | L, then G on push | repository owner | needs C-9 decision; **G-9** to push |
| C-11 | Typesense key: confirm use; rotate or restrict if a deployed instance uses the default | P (Typesense server), D | Typesense administrator | **G-7** |
| C-12 | Secret scanning: hosting settings, pre-commit, CI | H, L | repository owner | **G-10** |
| C-13 | Git history rewrite (optional, after C-5) | G | repository owner (written) | **G-8**, **G-9** |
| C-14 | Purge other copies (clones, backups, caches, logs) | L, others' machines | each holder | none |
| C-15 | Verification scan and RR-25 closure | L (read-only), documentation | repository owner | none |

Dependencies: C-1 and C-2 first. C-3 requires C-1. C-5 requires a verified C-4. C-6/C-7 can follow C-3 (not before: untracking does not reduce risk while the credential is valid). C-13 requires C-5 and a decision from C-2. C-12 can be done any time after C-6. C-9 and C-11 are independent of the database rotation but should be scheduled with it (§C-9).

---

## C-1. Confirm the affected role and consumers
- **Scope:** in the provider console (read-only): the role named in the exposed URL (`neondb_owner`, per the local comparison), the project, branch and endpoints, pooled vs direct, other roles; the deployment platform's environment variable *names* that hold database settings.
- **Prerequisites:** access for the authorized administrator; the consumer inventory in the plan (§II.2).
- **Approver:** database owner.
- **Validation:** written list of role, endpoints, consumers (names only), who uses each; no secrets in the note.
- **Rollback/recovery:** none needed (read-only).
- **Affects:** P (read-only).
- **UNVERIFIED until done:** whether the same role serves production and whether the pipeline or other instances use it.

## C-2. Assess repository and provider exposure
- **Scope:** repository visibility, collaborators, forks, clones, pull-request refs, security alerts; provider connection/audit logs since 2026-09-21; CI/deployment logs; any other place the value may have been copied.
- **Prerequisites:** repository owner and administrator access.
- **Approver:** repository owner and database owner.
- **Validation:** completed checklist (plan §II.3) with evidence that contains no secrets; a recorded conclusion on likely exposure.
- **Rollback/recovery:** none (read-only). If evidence of misuse appears, escalate as an incident before continuing.
- **Affects:** H, P (read-only).

## C-3. Replacement credential and cutover (gates G-1, G-2, G-3)
- **Exact proposed action:** per plan §II.2, either (A) reset the `neondb_owner` password and update every consumer in one window, or (B, preferred if practical) create a replacement least-privilege application role (design: `TARGET_ARCHITECTURE.md` §8), move the runtime consumers to it, then reset the owner credential and keep it sealed for migrations and break-glass. Then update `DATABASE_URL` in the deployment secret stores (**G-2**) and in `apps/api/.env` and `ownus/.env.local` on each developer machine (**G-3**). Include any `DB_*` variables a deployment uses.
- **Prerequisites:** C-1 and C-2 done; consumer inventory complete; maintenance window if connections will drop; secret store ready; named operator; Phase A2 record and rehearsal branches considered (plan §II.2.3-4); backup/recovery path confirmed.
- **Approver:** database owner / credential-change approver authorizes G-1 (the database administrator executes and does not self-authorize; approval package §13.1); owner of each deployment (G-2); each developer for their own files (G-3).
- **Validation:** non-destructive checks only: health endpoint, sign-in with a disposable test identity, a read-only audit by the operator, console view of active connections by credential. Never run scratch, seed or cleanup scripts to test.
- **Rollback/recovery:** correct the consumer's configuration to the *new* credential or issue another new one. Never re-enable the exposed credential. If a consumer cannot be moved in the window, extend the window and keep the old credential's lifetime as short as possible.
- **Affects:** P, D, L.

## C-4. Verify consumers before revocation
- **Scope:** every consumer from C-1 reports success on the new credential for at least one full usage cycle (including scheduled jobs and the gateway fallback paths).
- **Prerequisites:** C-3 complete.
- **Approver:** each consumer owner signs off.
- **Validation:** per-consumer evidence note; no errors referencing authentication; provider console shows no remaining sessions on the old credential, except those already identified.
- **Rollback/recovery:** as C-3 (forward fix only).
- **Affects:** D, L (read-only checks).

## C-5. Revoke the exposed credential (gate G-1, separate approval)
- **Exact proposed action:** make the exposed credential unusable (a password reset does this immediately; for a replacement-role strategy, remove the old role's privileges or disable it once nothing depends on it). Then confirm refusal through an authorized controlled test.
- **Prerequisites:** C-4 signed off; the old credential's remaining sessions identified.
- **Approver:** the revocation approver authorizes, as a separate act even if the same person as the credential-change approver (G-1). The database administrator executes the revocation and the refusal check and does not self-authorize (approval package §13.1).
- **Validation:** the old credential is refused; all consumers still healthy.
- **Rollback/recovery:** none by restoring the old credential. If something breaks, repair that consumer on the new credential.
- **Affects:** P.

## C-6. Untrack the seven credentialed scripts (gate G-4)
- **Exact proposed action:** one commit that removes from tracking (keeping the files on disk until the owner decides): `ownus/scratch_inspect_tables.js`, `ownus/scratch_master_e2e_verification.js`, `ownus/scratch_test_app_preferences_persistence.js`, `ownus/scratch_test_db.js`, `ownus/scratch_test_notifications_integration.js`, `ownus/scratch_test_profile_persistence.js`, `ownus/scratch_test_single_device_login.js`. `ownus/scratch_test_filter_queries.js` (no embedded credential) is handled in C-8. No history change; no push in this commit.
- **Prerequisites:** C-3 complete (so untracking is not mistaken for containment); the working tree reviewed so that only these paths are in the commit; unrelated work preserved (stage only these paths).
- **Approver:** repository owner.
- **Validation:** `git status` shows only the seven paths as removals; `git ls-files` no longer lists them; the working-tree files still exist; a scan of the working tree finds no credentialed remote URL.
- **Rollback/recovery:** revert the commit (this re-tracks the files, which still contain the revoked credential: acceptable only after C-5, otherwise delete the contents first).
- **Affects:** L; G once pushed.

## C-7. Add `.gitignore` rules (gate G-5)
- **Exact proposed text:** as in plan §II.4.3: `ownus/scratch_*.js`, `apps/api/before.json`, `apps/api/before.clean.json`, `apps/api/after.json`, `apps/api/*-result.txt`. Held back: `scratch/`, `ownus/scratch/`, `.claude/`.
- **Prerequisites:** C-6 committed (rules do not untrack committed files); owner reviewed which patterns could hide wanted files.
- **Approver:** repository owner.
- **Validation:** `git check-ignore` confirms the new patterns; `apps/api/src/database/migrations/meta/*_snapshot.json`, `_journal.json` and `docs/phase-a2/` remain tracked/unignored.
- **Rollback/recovery:** revert the commit.
- **Affects:** L.

## C-8. Decide the remaining scratch scripts individually
- **Scope:** `ownus/scratch_test_filter_queries.js`, the 10 files in `ownus/scratch/` and the 16 in `scratch/` (plan §II.4.2). Four scripts in each directory write to whatever `DATABASE_URL` points at.
- **Prerequisites:** C-3; owner decision for each script (keep, move to a documented tools folder with safeguards, or untrack).
- **Approver:** repository owner.
- **Validation:** each decision recorded; no script is run during the review; no secret appears in any kept script.
- **Rollback/recovery:** revert the individual commit.
- **Affects:** L.

## C-9. Rotate JWT signing secrets (gate G-6)
- **Exact proposed action:** generate two new random secrets (at least the length now used) outside the repository; set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` identically for the Orion API and the gateway in the deployment secret store; deploy both together; update local `apps/api/.env`. All users are signed out; password-reset links and admin OTP challenges issued before the change stop working.
- **Prerequisites:** decision, after C-2, on whether production ever used the committed values (UNVERIFIED); announced low-traffic window; a disposable test account holding pre-rotation tokens for the old-secret check; no dual-key support exists, so there is no grace period.
- **Approver:** application owner and deployment owner.
- **Validation:** replay the disposable account's pre-rotation access and refresh tokens: both return 401; a new sign-in succeeds; gateway and API accept each other's new tokens; no auth errors in logs.
- **Rollback/recovery:** forward only: fix configuration to the new values or generate another set; never restore the committed values.
- **Affects:** D, L.

## C-10. Remove secret literals from tracked configuration
- **Exact proposed action:** replace the JWT and Typesense literals in `docker-compose.yml` (lines 30, 81, 87-88, 116-117) with environment references; replace the committed default in `apps/api/.env.example` with a placeholder; keep the production rejection of the development Typesense key. No new secret is committed.
- **Prerequisites:** C-9 decided (otherwise the old values stay live); local `.env` updated so development still works.
- **Approver:** repository owner.
- **Validation:** secret scan of the tracked tree finds none of the old values; `docker compose config` (local, no secrets printed) resolves from the environment; application tests that use test-only secrets still pass.
- **Rollback/recovery:** revert the commit (the literals are then revoked/rotated values, so no live secret returns).
- **Affects:** L; G once pushed (**G-9**).

## C-11. Typesense key
- **Scope:** confirm whether any deployed environment sets `SEARCH_PROVIDER=typesense` (UNVERIFIED; the local value is `postgres`) and what key it uses. If it uses the committed development default, replace it with a random admin key and give the application a restricted search-only key.
- **Prerequisites:** Typesense administrator access; the instance identified.
- **Approver:** Typesense administrator (**G-7**).
- **Validation:** the restricted key can search and cannot create/delete collections; the old default is refused; indexing works with the admin key.
- **Rollback/recovery:** issue another new key; never re-enable the default.
- **Affects:** P (Typesense server), D.

## C-12. Secret scanning (gate G-10)
- **Exact proposed action:** enable hosting-side secret scanning and push protection if available; add a pre-commit scanner and a CI scan (plan §II.8) with custom rules for credentialed connection strings and secret-named variables, redacted output, and a reviewed fingerprint baseline.
- **Prerequisites:** C-6 done (so the scanner is not red on known files); tool chosen; owner of alerts named.
- **Approver:** repository owner.
- **Validation:** a seeded fake secret in a throw-away branch is blocked locally and in CI; real findings are redacted in logs.
- **Rollback/recovery:** disable the failing job/hook, fix rules; never use a baseline to silence an unreviewed finding.
- **Affects:** H, L.

## C-13. Git history rewrite (optional; gates G-8 and G-9)
- **Exact proposed action:** only after C-5 and a written decision: mirror backup; rewrite a fresh clone to drop the seven scripts (and, if chosen, scrub the compose and config secret literals) from all branches; force-with-lease push to named branches in a coordinated window; collaborators re-clone; verify.
- **Prerequisites:** credentials revoked (C-5); visibility and copies known (C-2); collaborator window; verified mirror backup; old and new tip commit IDs recorded.
- **Approver:** repository owner, in writing; separate approval for the force push.
- **Validation:** scan of every reachable ref finds none of the old values (comparison held by the administrator; counts only); the old commit IDs are unreachable; the application builds and tests pass from a fresh clone; hosting provider asked to purge caches if the repository was ever public.
- **Rollback/recovery:** restore the mirror backup to the remote (itself a force push); keep the backup until the owner closes the incident; note that a rewrite cannot recall copies others already hold and does not replace rotation.
- **Affects:** G.

## C-14. Purge other copies
- **Scope:** local clones and backups, IDE/assistant caches and transcripts, `.claude/` content, `playwright-report/` and `test-results/` (ignored but present), shell history, exported logs, CI and deployment build logs, archives, tickets.
- **Prerequisites:** C-3 (so purging does not hide evidence needed for C-2).
- **Approver:** each holder; coordinated by the repository owner.
- **Validation:** each holder confirms; spot scan of agreed locations finds no old value.
- **Rollback/recovery:** not applicable (information removal).
- **Affects:** L on other machines.

## C-15. Verification and closure
- **Scope:** re-run the in-memory credential scan on the working tree (and on history if C-13 was done); confirm that no tracked file contains a credentialed remote URL or the rotated secret values; update RR-25 with the outcome and residual exposure (forks, caches, copies).
- **Prerequisites:** C-3..C-7 (and C-9..C-12/C-13 as chosen).
- **Approver:** repository owner.
- **Validation:** zero matches in the working tree; residual items listed.
- **Rollback/recovery:** none (documentation).
- **Affects:** L (documentation).

---

## Approval gates (exact actions; stop before each)
| Gate | Action | Exact proposed action | Approval recorded? |
|---|---|---|---|
| G-1 | Change a database credential or provider setting | C-3 role creation/password reset; C-5 revocation. Authorized by the database owner / credential-change approver (revocation by the separate revocation approver); executed by the database administrator, who does not self-authorize (approval package §13.1). Resetting or deleting a staging/rehearsal branch and any other provider-setting change are separate G-1 actions, each needing its own explicit authorization naming the exact branch or setting | no |
| G-2 | Modify deployment environment variables | set the new database credential per deployment | no |
| G-3 | Change local environment files | `apps/api/.env`, `ownus/.env.local` on each machine | no |
| G-4 | Remove files from tracking | C-6: the seven listed scripts | no |
| G-5 | Change `.gitignore` | C-7: the five listed patterns | no |
| G-6 | Rotate JWT secrets | C-9 | no |
| G-7 | Rotate or restrict the Typesense key | C-11 (only if a deployed instance uses the default) | no |
| G-8 | Rewrite Git history | C-13 | no |
| G-9 | Push commits or change remote branches | any push of C-6, C-7, C-10 or C-13 | no |
| G-10 | Change CI or repository security settings | C-12 | no |

**Clarification (2026-10-03; wording only, no gate changed).** "Database owner" in this checklist is the person who *authorizes* G-1 actions (the credential-change approver); the database administrator *executes* them and does not authorize their own actions. Resetting or deleting a staging/rehearsal branch and any other provider-setting change are separate G-1 actions, each authorized separately. Deleting the Vercel project (V-11) falls under G-2; disabling the Vercel Git integration (V-10) under G-10. See `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §13.1. No approval is recorded.

**Alignment with approval package §13.1 (2026-10-03, second pass; wording only, no gate changed).** The G-1 approver wording in the ordered summary, C-3, C-5 and the G-1 gate row now follows §13.1: the **authorizer** (database owner / credential-change approver; the revocation approver for C-5, as a separate act) is distinct from the **database administrator who executes** and **must not self-authorize**. If one person would hold both roles, the incident owner must record that decision in advance (OD-1), naming the exact actions covered; it is not assumed. Staging/rehearsal branch reset or deletion and any other provider-setting change remain separate G-1 actions, each needing its own explicit authorization naming the exact branch or setting, and are not covered by the approval to create the replacement role. C-1 and C-2 are read-only steps; their approver cells now name the authorizing owner rather than the administrator who performs the review. The earlier clarification above is kept unchanged. All approval fields remain unset; no approval is recorded.
