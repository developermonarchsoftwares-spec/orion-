# Credential remediation: execution-readiness review (RR-25)

**Status: REVIEW ONLY. Nothing executed. Nothing approved. All gates G-1 to G-10 remain unapproved.** Date: 2026-10-03. Repository: `D:\ownus`.

Built on (preserved, unchanged): `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` (credential inventory CR-1 to CR-16, per-credential plans, Neon steps N-0 to N-11, Vercel checklist V-1 to V-14, waves 0 to 8), `CREDENTIAL_REPOSITORY_CLEANUP_PROPOSAL.md`, `CREDENTIAL_TARGET_VERIFICATION_REPORT.md` (`TARGET UNCONFIRMED`; E-1 to E-10), `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (`DRAFT — NOT APPROVED`), `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md` (39 items, all `UNANSWERED`; criteria R1 to R10, all `NOT MET`). `CREDENTIAL_PREEXECUTION_CHECKLIST.md` **does not exist**; its purpose is covered by §8 of this review and nothing was created under that name. The completed inventory is not repeated; credential IDs are cited.

**No secret appears here.** Only paths, counts, dates, booleans and classes.

## 1. Readiness at a glance
| # | Workstream | Can it start now? | Why | Gates |
|---|---|---|---|---|
| WS1 | Neon target and privilege verification | **Yes, as read-only owner action** (needs a person with console access; no gate) | purely read-only console and settings review | none |
| WS2 | Database credential replacement (if required) | **No, blocked** | depends on WS1 outcome, owners, secret store, window | G-1, G-2, G-3 (revocation separate G-1) |
| WS3 | Other credential remediation by actual exposure and use | **No, blocked** (decision rules ready) | needs deployment evidence and hosting choice | G-2, G-6, G-7 |
| WS4 | Permanent hosting selection and Vercel retirement | **No, blocked** | platform not chosen | G-2, G-10 |
| WS5 | Scratch-script cleanup and secret scanning | **Preparation only** | untracking should follow WS2 start; scanning needs tool choice | G-4, G-5, G-9, G-10 |
| WS6 | GitHub pre-push review | **Review ready; push not ready** | local state analyzed; prerequisites open | G-9 |

Cutover status: **NOT READY** (R1 to R10 `NOT MET`). Fixing that is WS1's job.

## 2. WS1 Neon target and privilege verification
**Purpose:** convert `TARGET UNCONFIRMED` into a recorded decision (target report §7: A isolated test, B production-capable, C uncertain).

| Field | Content |
|---|---|
| Prerequisites | Named person with Neon console access (`NOT SET`); incident owner named (tracker IO-1); log preservation started (IO-3) |
| Responsible owner | Database owner/administrator (may be you if you hold console access) |
| Approval required | None for viewing in the provider console. Running the Phase A2 read-only SQL (C11 role and ownership checks) needs the Phase A2 approval record, which is `DRAFT — NOT APPROVED`; prefer console views first |
| What to establish (read-only) | (a) branch (name, ID, parent, default/primary flag, creation date) behind the endpoint of the configured `DATABASE_URL` (`H1`) and behind `S1` (the 2026-10-02 staging endpoint); (b) role list with attributes and object ownership; `neon_service` purpose; (c) last password change of `neondb_owner`, and whether the 2026-09-19 value is still current (do not test by signing in); (d) log retention and oldest date; (e) active connections by role and source; (f) all branches with parents and creation dates, and whether any inherited the exposed password; (g) **deferred and unresolved (AE-6):** what the `users` rows (57 in the counts snapshot) are would need a query, which is outside the approved scope; it requires a separate, explicit authorization and an approved procedure and is not requested in the first message; (h) backup/point-in-time recovery availability; (i) supported replacement process |
| Validation method | A written summary with dates, role names, counts and yes/no only, reviewed by the incident owner; tracker items DB-1 to DB-13 updated with an evidence reference; target report §7 re-evaluated |
| Rollback | Not applicable (read-only). Stop conditions: unfamiliar sources, unexpected writes, role changes, large exports, or retention shorter than the exposure window are escalated as an incident before any change |
| Exit | R1, R2 (partly), R3 (partly) can be assessed; outcome A/B/C recorded |
| Do not | sign in with the exposed credential; run scratch scripts; paste hosts or passwords into messages |

## 3. WS2 Database credential replacement (if required)
**Decision rule:** required for outcome **B** (production or production-capable) and, until WS1 proves otherwise, treated as the working assumption. For outcome **A** it reduces to changing that test branch's password and separating test from production credentials. Never an owner-level credential for the application.

| Field | Content |
|---|---|
| Prerequisites | WS1 done and accepted; replacement-role privilege outline reviewed by the administrator and the application owner (DB-10, DB-11); consumer inventory reconciled to the provider's active-connection view (K-1 to K-19, `S1`); destination secret store identified (WS4 decision, or the current store until then); window, abort thresholds, observation period and alert recipients filled in (approval package §7 and §9); recovery path confirmed (DB-12); approved test account and read-only validation route (DP-9); log preservation done |
| Responsible owner | **Authorizes:** database owner / credential-change approver (role creation); the separate revocation approver (revocation); each deployment owner (variables); each developer (own env files). **Executes:** the database administrator (role creation and the refusal check; never self-authorized) and whoever sets each deployment variable. Incident owner: window and abort. "Responsible owner" here does not by itself mean approver (approval record §13.1) |
| Approval required | **G-1** to create the role (and later, **separately**, to revoke, even if the same person holds both approval roles; any combined-role arrangement is recorded in advance under OD-1); the database administrator must not self-authorize; staging-branch reset or deletion and other provider-setting changes are separate G-1 actions, each needing its own authorization; **G-2** per deployment; **G-3** per machine. Approver names are `NOT SET` today except the user-selected ones in decision sheet §1.1 (`USER-SELECTED — PENDING VERIFICATION`); no approval is recorded |
| Sequence | Plan steps N-2 to N-11: rehearse grants on an isolated branch; create `orion_app` (and optionally `orion_migrator`); move consumers one at a time; observation period; separate revocation approval; controlled refusal check; deal with `S1` and other inheriting branches (deletion confirmed separately) |
| Validation method | Per consumer: `GET /api/v1/health` database component up (not the liveness routes); one authenticated read with the approved existing account; `db:audit` read-only by the named operator; provider view shows only the new role from applications; after revocation the old credential is refused on both pooled and direct endpoints (administrator-run). Matrix in execution plan §8 |
| Rollback | Before revocation: fix grants or point a consumer to a working **new** credential; never re-enable the exposed credential. After revocation: repair forward; data harm via the provider's backup/PITR under a separate approved change. Application configuration rollback and post-revocation recovery are distinct (approval package §10) |
| Impact | Seconds to minutes per consumer restart; fallback (owner password change) drops all connections once; no effect on user sessions |
| Never | recreate, delete, reset or migrate the database; use scratch/seed/cleanup scripts as tests; run migrations as part of this |

## 4. WS3 Other credentials, by actual exposure and use
No emergency rotation is justified by Git evidence for most of these; the triggers below decide.

| Credential (ID) | Git exposure | Trigger to rotate now | Default timing | Owner and gate | Validation | Rollback |
|---|---|---|---|---|---|---|
| JWT access and refresh (CR-3, CR-4) | **Exposed**: committed in 45 revisions | Production (or preview) uses the committed values (DP-3), or the repository was ever public | With the hosting move; earlier if DP-3 says yes | application + deployment owners, **G-6** (G-2 for variables; G-9 to remove literals from the repository) | pre-rotation test-account tokens fail (401) on API and refresh endpoint; new sign-in works; gateway and API accept each other's tokens | forward only: fix to the new pair; never restore the committed values |
| Typesense (CR-5) | **Public development default** in 80 revisions | A deployed Typesense instance uses it (DP-6) | Only if deployed use is found; otherwise just remove the literal from tracked config later | Typesense administrator, **G-7** | restricted key searches, cannot administer; old default refused | issue another key |
| Redis (CR-6) | none | Evidence of copy or leak (for example logs, shared screens); or the provider/host changes | At the hosting move | Redis owner + deployment owner, G-2 | API starts; harmless queue job completes | issue another credential |
| Object storage (CR-7) | none | same; also if the Pipeline shares the keys | At the hosting move with bucket-scoped keys | storage owner + deployment owner, G-2 | read an existing non-sensitive object; test-prefix write/delete | issue another key; keep `file_key`/`r2_object_key` semantics |
| Google (CR-8), Microsoft (CR-9) | none | OAuth redirect URIs change anyway when leaving Vercel | At the hosting move | application + OAuth console owner, G-2/G-3 | sign-in with a test account | restore previous redirect URIs, keep new secret |
| Resend (CR-10) | none | same trigger as Redis | At the hosting move | email owner, G-2/G-3 | one test message to an owner address | issue another key |
| Razorpay (CR-11) | none; not set locally | Live keys found in any deployment you do not control | Owner decision first; outside active sales | payment owner, G-2 | test-mode transaction and webhook | new keys only |
| Seed administrator (CR-13) | none | Administrator account created with a known seed value | After WS2 | application owner | read-only review of administrator accounts | n/a (account changes by owner) |
| Vercel tokens (CR-12) | none in Git | none; local tokens already expired | Local cleanup at retirement | each developer | n/a | n/a |

Gap this review adds: the tracker has no rows for CR-6 to CR-11 owners or for the Vercel Git integration. Proposed additions are listed in §9 (not applied).

## 5. WS4 Permanent hosting selection and Vercel retirement
| Field | Content |
|---|---|
| Prerequisites | **Hosting platform and secret store chosen (not decided anywhere)**. Selection criteria to weigh, without choosing here: encrypted secret store with audit log and per-environment values; runs a Next.js gateway and a Nest API (with background workers); reachable from the database region (AWS us-east-2 per the host class), the Redis and the object storage; domain and TLS; stable webhook and OAuth URLs; logs/retention controls; cost; exit path. A staging environment on the new platform validated with the §8 matrix |
| Responsible owner | Application owner (selection), deployment owner (execution), incident owner (sequencing) |
| Approval required | **G-2** for every variable placed or removed; **G-10** for removing the Vercel Git integration; **G-6** where JWT values are issued at the move; DNS/domain changes by the domain owner |
| Retirement checklist | Execution plan §6 V-1 to V-14. Unchanged |
| Validation method | The new environment passes the §8 matrix; sign-in, payments (test mode), email, uploads, and the Google redirect all work on the new URLs; Vercel shows no traffic (V-2); evidence preserved (V-7) before deletion |
| Rollback | **Rolling traffic back to Vercel is only safe if the Vercel project's variables already hold the new credentials**; plan to update Vercel's variables to the new values (G-2) while it still runs, so a DNS rollback never revives an exposed credential. After project deletion there is no rollback; keep the old project until acceptance |
| Local-state point | `fix/vercel-build` is an ancestor of `main` (0 own commits) and holds a `vercel.json` with only `$schema`, `framework`, `buildCommand`, `outputDirectory` (no environment block, no crons). Deleting that branch is G-9 and is optional |
| Pre-push risk | If the Vercel Git integration is still active, a push to `main` may trigger a build or deployment of whatever is pushed. The integration's status is UNKNOWN; confirm it (V-1, V-10) before WS5/WS6 push anything |

## 6. WS5 Scratch-script cleanup and secret scanning
| Field | Content |
|---|---|
| Prerequisites | WS2 begun (preferably completed): untracking does not reduce risk while the exposed credential is valid. A clean, isolated working copy for the commits (§7). Decisions on local copies and ignore pattern style (OD-9). Secret-scanner choice (OD-12). Authors of unrelated uncommitted work informed |
| Responsible owner | Repository owner |
| Approval required | **G-4** (untrack the seven), **G-5** (`.gitignore`), **G-9** (each push), **G-10** (scanner in CI, hosting-side scanning or push protection) |
| Cleanup steps | Per cleanup proposal §3: one commit that removes the seven from tracking, naming the paths explicitly; a later commit with the ignore rules; no history change; no push inside these commits. Per-file dispositions in cleanup proposal §2 |
| New local finding | When the untracking commit reaches another clone by pull, Git **deletes the working copy of those tracked files** there. Anyone who wants a local copy (the optional sanitized copies, §2 of the cleanup proposal) must copy it outside the repository **before** pulling. This includes your own clone |
| Secret scanning | Plan per remediation plan §II.8: hosting-side scanning/push protection (availability UNKNOWN), a local pre-commit scanner, a CI scan of every pull request and the full tree, custom rules for credentialed connection strings and secret-named variables, redacted output, and a reviewed fingerprint baseline. **Local fact:** the repository has no active Git hooks (only sample hooks; no `core.hooksPath`) and no CI workflows, so nothing currently blocks a secret commit |
| Validation method | After G-4: `git ls-files` no longer lists the seven; files still on disk; `git diff --cached --name-only` before committing equals exactly the seven paths. After G-5: the ignore-check command reports the new patterns; migration snapshots, journal and `docs/phase-a2/` still tracked. Scanner: a deliberately fake secret in a throw-away branch is blocked locally and in CI; real findings are redacted |
| Rollback | Revert the commit (re-tracks the files; acceptable only after the credential is revoked). Scanner: disable the failing hook/job, fix rules; never use a baseline to silence an unreviewed finding |
| History rewrite | Separate decision (cleanup proposal §5, G-8, G-9); not before revocation; needs visibility and copy answers (GH-1 to GH-8) and a mirror backup; unrelated uncommitted work must be committed or branched by its owners first |

## 7. WS6 GitHub pre-push review
**Nothing is pushed or fetched by this review.** Facts from local Git only.

### 7.1 Local state
- `main` at `fe7307f` tracks `origin/main`; **0 commits unpushed**; **2 commits behind** as of the last fetch (`3f1ffd2` 2026-09-24, `72521a2` 2026-09-25, both by the second author identity). The remote may have moved since (no fetch was made).
- The 2 incoming commits touch 8 paths. An in-memory scan found **none of the known secret values and no credentialed Postgres URL** in them. They add `scratch/test_linkedin_e2e.js`, a further scratch script (to be reviewed individually under C-8).
- **3 of the 8 incoming paths overlap tracked files modified locally** (`ownus/src/app/admin/monarch/page.tsx`, `ownus/src/components/admin/admin-sidebar.tsx`, `ownus/src/lib/api-client.ts`). A pull or merge in this working tree would conflict or be refused, and the rules here forbid reset, clean and stash. So **do not pull in this working tree**.
- The working tree has 59 modified and about 133 untracked entries, including the People-import work (authorship `REQUIRES TEAM CONFIRMATION`). The index is empty.
- `origin` is an `https` remote whose URL includes a user part but no password and nothing token-shaped (credentials come from the machine's credential store, which was not inspected). Git identity (`user.name`, `user.email`) is set; commit signing is unset.
- No active Git hooks, no CI workflow files. Two author identities exist in history (41 and 39 commits).
- `fix/vercel-build` is a local and remote branch with no commits of its own.

### 7.2 Recommended approach (proposed)
Make the remediation commits in a **separate, clean checkout of `origin/main`** (a second clone or a separate Git worktree), so the 59 modified and untracked files in this working tree are never touched, staged or merged. The seven untracking steps, the `.gitignore` commit and any removal of config literals are done there, with explicit paths. This needs a fetch from GitHub (external contact) and so its own approval, as does creating the worktree or clone (local Git metadata/disk change).

### 7.3 Pre-push checklist (each item to be recorded before any push)
| # | Check | Evidence | Status |
|---|---|---|---|
| P-1 | Push approved by the repository owner for named branch and commits (G-9) | approval record | not requested |
| P-2 | Exactly the intended paths are in the commit (`git diff --cached --name-only` matches the approved list) | listing | n/a |
| P-3 | A secret scan of the commit diff finds nothing (in-memory comparison against the administrator's values, or a scanner); output limited to counts | scan result | n/a |
| P-4 | Author identity is the intended one; commit message contains no secret | log | n/a |
| P-5 | No other work is included; unrelated files untouched | status of the clean checkout | n/a |
| P-6 | The remote branch state is known (fetched in the clean checkout), the commit sits on top of the current remote tip; **no force-push** | fetch result | n/a |
| P-7 | Branch protection/required reviews and push permissions known (GH) | settings | **UNKNOWN** |
| P-8 | **Vercel Git integration status known**; auto-deploy of `main` will not deploy an unfinished state | V-1/V-10 | **UNKNOWN** |
| P-9 | Hosting-side secret scanning/push protection availability known | GH-6 | **UNKNOWN** |
| P-10 | Nothing in the push re-publishes a removed credential (the untracking commit adds none; the history still holds them) | scan | n/a |
| P-11 | Rollback is a revert commit, never a force-push; if a wrong secret is pushed, treat it as a new exposure and rotate | procedure agreed | agreed in this review |
| P-12 | Collaborators told that pulling the untracking commit deletes their on-disk copies of the seven scripts (copy first) | message sent by a human | not sent |

Responsible owner: repository owner. Approval: G-9 per push. Rollback: revert commit.

## 8. Consolidated pre-execution checklist (replaces the missing file)
Before the first operational action (G-1/G-2/G-3), every line must be recorded as met with evidence. None is met today.
1. Incident owner and all approvers named (OD-1).
2. Log preservation confirmed (IO-3).
3. WS1 complete; outcome A/B/C recorded; role attributes, ownership, validity, branches, consumers known.
4. Replacement role privilege outline reviewed (R5); backup/PITR confirmed (R6, DB-12).
5. Destination secret store and hosting platform chosen (OD-4) or an interim store agreed.
6. Window, abort thresholds, observation period, alert recipients, escalation filled in (R6).
7. Approved test account and read-only validation route (R7).
8. All approver fields in the approval package filled by the people themselves (R8).
9. Corrections PC-1 to PC-9 (corrections document §3) and PC-10 to PC-13 (target report §10) reviewed (R9).
10. A separate plan for revocation approval (R10).
11. Unrelated concurrent work separated from remediation commits; clean checkout approach agreed (OD-8).
12. Vercel Git integration status known (P-8).

## 9. Tracker gaps (proposed additions, not applied)
The tracker was preserved. Proposed new rows, to add after human review: owners and evidence for Redis, object-storage, OAuth, email and payment credentials (CR-6 to CR-11); Vercel Git integration status and auto-deploy; branch protection and push permissions (P-7); hosting-side secret scanning availability (P-9); retention of Vercel logs. The proposed corrections PC-10 to PC-13 (second endpoint `S1`, single `DATABASE_URL` variable, project-guard assumption, unrecorded snapshot targets) remain unapplied in the target report.

## 10. Sequence and parallelism
WS1 first and alone. WS2 and WS4 selection can proceed in parallel after WS1; WS5 preparation (clean checkout, decisions) can happen any time, but its pushes wait for P-8 and P-7. WS3 follows WS2 and the platform decision. The exposure continues until the database credential is revoked, and logs may expire, so WS1 and log preservation are the time-sensitive items.

## 11. Exact blockers
### 11.1 Needs your decision (owner decisions)
| ID | Decision |
|---|---|
| OD-1 | Name the incident owner and the approvers: database administrator, application owner, deployment owner, repository owner; and who may approve revocation separately |
| OD-2 | Authorize WS1 (read-only console and settings review) and say who performs it and who preserves logs |
| OD-3 | Adopt the working posture "treat `H1` as production-capable until WS1 proves otherwise" (recommended) |
| OD-4 | Choose the permanent hosting platform and its secret store |
| OD-5 | Tell us whether live payments (Razorpay) and Google/Microsoft sign-in exist today |
| OD-6 | Set the change window and the acceptable interruption (per-consumer restart; JWT sign-out) |
| OD-7 | Rotate the JWT pair together with the hosting move (recommended) or earlier |
| OD-8 | Use a clean checkout of `origin/main` for remediation commits (recommended), and say who commits the existing uncommitted work |
| OD-9 | For the seven scripts: keep sanitized copies outside the repository or discard; ignore by glob or by the seven exact paths |
| OD-10 | Defer the history-rewrite decision until after revocation (recommended) |
| OD-11 | Say whether the Vercel Git integration should be disabled **before the first push** (G-10) |
| OD-12 | Choose the secret-scanning approach (hosting-side, pre-commit, CI) |
| OD-13 | Team to confirm authorship and purpose of the People-import work (`REQUIRES TEAM CONFIRMATION`) |
| OD-14 | Separately: say whether the Vercel project is to be deleted **after** migration, validation and evidence preservation (G-2) |

### 11.2 Needs administrator or owner evidence
| ID | Evidence (no secrets) | Tracker |
|---|---|---|
| AE-1 | Branch behind `H1` and `S1`: name, ID, parent, default flag, creation date; whether `S1` inherited the exposed password | DB-9; target report E-1, E-2, E-5 |
| AE-2 | Role attributes, ownership of schemas/objects, `neon_service` | DB-2, DB-3 |
| AE-3 | Whether the credential current on 2026-09-19 is still valid; last password change | DB-1 |
| AE-4 | Log retention and review results | DB-6, DB-7 |
| AE-5 | Consumer list; active connections by role and source; deployed use of the credential, JWT values and Typesense | DB-4, DB-8, DP-1, DP-2, DP-3, DP-5, DP-6 |
| AE-6 | **DEFERRED, UNRESOLVED:** what the 57 `users` rows are; needs a query, so it requires a separate, explicit SQL authorization and an approved procedure | target report E-4 |
| AE-7 | Supported replacement process, privilege outline, backup/PITR | DB-10, DB-11, DB-12 |
| AE-8 | Repository visibility now and ever, access list, forks/clones, push events, security alerts, branch protection | GH-1 to GH-3, GH-6, GH-7, P-7 |
| AE-9 | Who is the second commit-author identity and where their clones are | GH-4 |
| AE-10 | Vercel inventory: projects, deployments, domains, variable names with sensitive flags, Git integration and auto-deploy status, log retention | DP-4, V-1 to V-7, P-8 |
| AE-11 | Approved existing test account and read-only validation route | DP-9 |
| AE-12 | Owners/providers for Redis, object storage, OAuth, email and payments, and whether any deployment holds their values | new rows (§9) |

Cutover remains `NOT READY` until AE-1 to AE-5, AE-7 and AE-11 are answered (AE-6 is deferred and not required for the cutover decision) and OD-1 to OD-4 and OD-6 are decided.

## 12. Revalidation note (2026-10-03 12:41)
The request for this review was received a second time. The existing content was kept and rechecked against the local repository; **no finding, blocker or decision list was changed.**
- Facts rechecked and unchanged: `main` at `fe7307f`, 0 unpushed and 2 behind `origin/main` as of the last fetch (no fetch was made); index empty; `.gitignore` unchanged; no stashes; 59 modified and 133 untracked porcelain entries; the eight `ownus/scratch_*.js` files still tracked; Pipeline working copy 29 entries.
- The other credential documents have not changed since this review was written.
- `CREDENTIAL_PREEXECUTION_CHECKLIST.md` still does not exist (§8 covers it).
- **Concurrent work is still active.** Since the review was written, People-import paths kept changing (`apps/api/src/modules/people/ingestion/people-import-job.service.ts`, `apps/api/src/modules/people/__tests__/people-import-run-lock.integration.spec.ts`, `ownus/src/lib/people-import.ts`, `ownus/src/lib/__tests__/people-bundle-import.test.ts`, `docs/PEOPLE_EXPORT_IMPORT.md`). They were not read or touched; authorship `REQUIRES TEAM CONFIRMATION`. This reinforces OD-8 and checks P-2 and P-5: any future remediation commit must be made in a clean checkout with explicit paths, and must never include these files.
- Status of the six workstreams, the blockers OD-1 to OD-13 and AE-1 to AE-12, and the `NOT READY` cutover status are unchanged.

## 13. Correction round (2026-10-03)
Documentation corrections applied after a consistency check; no finding changed and no gate, approval or criterion status changed. (1) AE-6 / the users-count request is deferred and unresolved because it needs SQL, which is outside the approved scope (§2 WS1 (g), §11.2). (2) Criterion R9 covers PC-1 to PC-9 (corrections document §3) and PC-10 to PC-13 (target report §10) everywhere (§8 item 9). (3) DB-9 is mapped to R2 and DB-12 to R6 in the tracker; DP-6 is intentionally unmapped; GH-6 is covered by R3 (§8 item 4). (4) Authorize versus execute and the missing owner fields are defined in `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §13 and §13.1 and `CREDENTIAL_OWNER_DECISION_SHEET.md` §1.1. (5) OD-11 now covers only disabling the Vercel Git integration before the first push; deleting the Vercel project is the new decision OD-14 (§11.1). The blockers in §11 are otherwise unchanged; read "OD-1 to OD-13" in §12 as "OD-1 to OD-14".

## 14. Correction round 2 and open items (2026-10-04)
**Applied (wording only; no finding, gate, approval or criterion status changed):** I-1 application-owner draft message added (`CREDENTIAL_OWNER_COORDINATION_PACKAGE.md` §2.5, `DRAFT — NOT SENT`); I-2 explicit no-change boundary in all drafts, with a no-credential-testing line for the GitHub-owner and deployment-owner messages (package §2.1 to §2.5); I-3 deployment-owner item 1 reworded to report variable names, locations and confirmed consumers, not values (package §2.3); I-5 authorizer/executor wording (package §4.3); I-6 WS2 "Responsible owner" and "Approval required" rows (§3 above); I-7 responsibility wording for R5 and R10 (`CREDENTIAL_OWNER_COORDINATION_PLAN.md` §5).

**Open, not resolved, awaiting owner decision:**
- **I-4:** AE-1 (inheritance) and AE-2 (object ownership and attributes) may not be answerable from console views alone. They stay unresolved when evidence cannot be obtained without further authorization; the prohibition on SQL and on credential testing is unchanged and no Phase A2 SQL is authorized (Phase A2 record is `DRAFT — NOT APPROVED`).
- **I-8:** whether the "database owner" and the "credential-change approver" are the same person is flagged for owner confirmation (OD-1); no role assignment is made or inferred. **Update 2026-10-04:** answered by the user as `USER-CONFIRMED: SAME PERSON` ("I am the Neon project/database owner and the credential-change approver"). This is an identity statement only. It is not independently verified, establishes no formal authority and approves no action; SV-1 to SV-7 remain pending and the combined-role arrangement still covers read-only evidence actions only (decision sheet §1.1a). The original entry above is kept as audit history. (This reference was in this document; `PHASE_A2_APPROVAL_READINESS.md` contains no I-8 reference and is unchanged.)
- **I-9:** tracker row DB-9 (follow-up) and the exposure assessment (K-11, R-1) still state that no staging setting or rehearsal use is shown locally, which conflicts with `CREDENTIAL_TARGET_VERIFICATION_REPORT.md` §1 and PC-10. PC-10 remains `PROPOSED — NOT APPLIED`; the conflict is recorded here for later review and is not reconciled.
- **I-10:** the AE/OD tracking lives in the coordination package §3 and the decision sheet, not in the tracker, and sheet §4 omits AE-9, AE-10 and AE-12. No redesign or mapping change was made.
- **Flagged for a later, separately approved correction (not edited):** the similar approver wording in `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` CR-1, item 9.

**Pre-push audit (2026-10-04; read-only; status `BLOCKED`, release safety not established).** No values were printed; People-import paths were excluded from content scanning and must be scanned by their owners before any commit.
- **Local state:** `main` at `fe7307f` tracking `origin/main` (GitHub, https; the URL carries no password or token); 0 commits unpushed; 2 behind as of the last fetch (no fetch made); index empty; 59 modified and 138 or more untracked entries, about 50 of them People-import paths.
- **Sensitive history:** the exposed database credential is in 23 revisions on `main` and `origin/main` (seven `ownus/scratch_*.js` scripts); the committed JWT pair is in 45 revisions (`docker-compose.yml`); the Typesense development default is in 80. No private-key header, GitHub, AWS or Slack token, or JWT-shaped token was found. The Redis, storage, Google and Resend values and the Vercel tokens were not found in tracked files, history, or scanned untracked files. Two placeholder-like literals were flagged for owner review: a hard-coded demo key in `ownus/src/app/(app)/settings/page.tsx` (all 80 revisions) and a fake Razorpay-shaped test fixture (untracked).
- **Publishing risk:** pushing the current branch adds no new commits, but the credentials are already reachable in remote history, and any new commit built on this history carries them. Credential replacement and revocation (G-1), JWT rotation (G-6) and any history decision (G-8) are unresolved, so nothing here makes a push safe.
- **Private by default:** the 14 `CREDENTIAL_*` documents, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`, `PHASE_A2_APPROVAL_READINESS.md` and `phase-a2/` carry internal security and production-evidence detail and should not go into the application repository. Untracked local artifacts (`apps/api/before.json`, `before.clean.json`, `after.json`, `.claude/`, `brag-output/`, `showreel*/`, about 62 MB of media) are not ignored.
- **`.gitignore` gaps (proposed, not applied):** `.env.production`, `.env.staging`, `.env.development` and the `apps/api` equivalents; `*.pem`, `*.key`, `secrets.json`, `*.sql` dumps; the audit outputs above; `.claude/`; generated media directories; the scratch directories pending the cleanup decisions.
- **Checks:** `tsc --noEmit` passed with 0 errors for `apps/api` and `ownus` (including uncommitted work). Lint (`apps/api` runs with `--fix`), jest suites (35 of 59 specs touch database drivers or URLs) and builds were not run.
- **Follow-up (2026-10-04):** the redacted history-reachability findings, the credential remediation matrix, the file classification, the proposed publication scope and the further lint results are in `CREDENTIAL_RELEASE_READINESS_PLAN.md`; the status remains `BLOCKED`.

## Completion statement
Review only. **No external service was contacted** (including GitHub: no fetch, pull or push), **no credential was tested or changed**, no secret value was printed, no file other than this new document was created or changed, no migration, seed, scratch script or test was run, nothing was staged, committed, pushed, deleted, moved or renamed, no Git history was rewritten, and the concurrent People-import work was not read or touched. No approval gate was passed. Git facts come from local refs as last fetched.
