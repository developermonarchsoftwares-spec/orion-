# Credential assessment: evidence reconciliation and proposed corrections (RR-25, Phase 3)

**Status: PROPOSED CORRECTIONS ONLY. None is applied.** Date: 2026-10-03. The five earlier documents (`CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md`, `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`, `CREDENTIAL_EXPOSURE_ASSESSMENT.md`, `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md`, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`) were read and are **unchanged**; the approval package keeps its status `DRAFT — NOT APPROVED`. Nothing here approves any gate G-1 to G-10. Human review is required before any correction below is applied.

**No secret appears in this document.** Evidence reported here: paths, variable names, commit references, dates, counts and booleans. No external service was contacted and no credential was tested.

Evidence classes: **LOCAL FACT** (verified from files, code or Git metadata on this machine), **INFERENCE** (reasoned, not proven), **UNRESOLVED** (needs an owner). Owners are roles only; nobody was contacted and no answer is invented.

---

## 1. Exposure timeline: four different things
The earlier documents mention the first commit time, a reflog time and a "first seen on the remote" time. They are different kinds of evidence and must not be merged.

| # | What | Value for the first credential-bearing commit `1cdf261` | Kind of evidence | What it can establish | What it cannot establish |
|---|---|---|---|---|---|
| T1 | **Commit author timestamp** | 2026-09-21 14:52:05 +0530 (author and committer times are identical; no sign of a rewrite or rebase) | the author's own clock, recorded at commit time | the commit existed on the author's machine at about that time (if the clock is right) | that anything left that machine; the commit time can be set by the client |
| T2 | **Local reflog timestamp** | `origin/main` reflog entry at 2026-09-21 21:58:37 +0530, subject "pull: fast-forward" (this machine's `main` reflog shows the same second, "pull: Fast-forward") | this clone's own clock, recorded when this clone fetched | this clone first observed the remote tip that contains `1cdf261` (13 commits, all by the other author identity, from `f9f6400` to `557a765`) at that moment | when the provider received the push; any earlier push by another clone; the local clock's accuracy |
| T3 | **Earliest time the remote was known to contain the commit** | by 2026-09-21 21:58:37 +0530, *as observed by this clone* (an upper bound; the commit has no local "commit" event in this clone's `main` reflog, so it arrived by pull) | derived from T2 | the remote held the commit **no later than** this observation | the start of remote availability; it is not independent of the local clock |
| T4 | **Actual provider-side push time** | **NOT ESTABLISHED** | would come from the hosting provider's push or audit log | n/a | n/a. `REQUIRES ADMINISTRATOR/GITHUB OWNER CONFIRMATION` (tracker GH-7) |

Consequences: the interval **between T1 and T3 (2026-09-21 14:52 to 21:58 +0530)** is a bounded *inference* for when the push happened, not a fact. Local reflog timestamps are never treated as the push time. Exposure could also **precede** the commit: local env files holding the same credential were last modified on 2026-09-19 and the Vercel production snapshot is dated 2026-09-17, so the credential existed earlier and the provider-log window should start from the credential's last change (or before 2026-09-17 if that is unknown), not from T1.

Other local time facts, for context only: the first credential-bearing revision by the configured identity is `0410e07` (commit time 22:58:10); this machine's own push of it is recorded at 2026-09-21 22:58:14 +0530 (this clone's clock), after the pull described in T2, so it built on history the remote already held. The latest credential-bearing revision `72521a2` (2026-09-25) is only on `origin/main` as last fetched.

---

## 2. Reconciliation of D-1 to D-8
Each item: original claim, local evidence, what it proves, what remains unknown, owner, and whether a documentation correction is supported by local evidence.

### D-1. Role ownership and privileges
1. **Original claim.** Assessment §3.1.3 and Plan Part II §II.1: `neondb_owner` "is the owner of the production database objects (read-only audit)".
2. **Local evidence.**
   - The configured `DATABASE_URL` of the Orion API and of the gateway uses the role named `neondb_owner` (LOCAL FACT; in-memory comparison).
   - Neither the Orion migrations nor the Pipeline migrations contain any `OWNER TO`, `GRANT`, `REVOKE` or role-creation statement (searched). Objects created by migrations are therefore owned by whichever role ran them.
   - `DATABASE_OWNERSHIP_MATRIX.md` (line 160), `TARGET_ARCHITECTURE.md` (line 25) and `phase-a2/PHASE_A2_CHECKLIST.md` (lines 37, 69, 93) record only: "roles seen: `neondb_owner`, `neon_service`; only the inspecting connection was visible", dated 2026-10-01 as prior evidence, with the role and ownership check (C11a to C11g) still pending.
   - The saved audit snapshots `apps/api/before.json`, `before.clean.json` and `after.json` contain no role or ownership information (0 mentions); the audit code reads migration tables and counts, not roles.
3. **What it proves.** The applications are configured to run as `neondb_owner`. It is consistent with (but does not prove) that this role created and owns the objects, if migrations were run with that connection (INFERENCE).
4. **Unknown.** Actual ownership of schemas and objects; the role's attributes (creating roles, bypassing row-level security, replication, provider-level admin membership); other roles present; access to other databases or projects.
5. **Owner.** Database administrator (tracker DB-2, DB-3).
6. **Correction supported?** **Yes.** The cited "audit" shows roles seen, not ownership. See PC-1.

### D-2. The reflog does not establish the remote push time
1. **Original claim.** Assessment §3.1.5: the earliest `origin/main` reflog entry containing `1cdf261` is 2026-09-21 21:58 +0530; approval package D-2 restates the limitation.
2. **Local evidence.** See §1 above: T1 author time 14:52:05; T2 reflog 21:58:37 (pull); `1cdf261` was authored under the second of two author identities and arrived by pull; the pulled range `f9f6400..557a765` is 13 commits, all by that identity; no merge commits in the history.
3. **What it proves.** T3: the remote had the commit by 21:58:37 as seen by this clone. It also shows the commit was created on a clone other than this one (it has no local commit event).
4. **Unknown.** T4, the provider-side push time and actor; whether anyone accessed the repository between the push and now; whether earlier pushes of other credential-bearing material by other clones exist.
5. **Owner.** GitHub repository owner (tracker GH-7, GH-4).
6. **Correction supported?** **Yes, as a wording and clarity correction** (PC-2). The assessment's wording ("an interval bounded by...") is not wrong but does not separate T1 to T4 and does not note that the commit came from another clone.

### D-3. Only five of the seven credentialed scripts contain write statements
1. **Original claim.** Assessment §10 item 8: "Seven scratch scripts with write statements remain tracked". Plan Part II §II.4.1 and the approval package (F4) say five of seven.
2. **Local evidence.** Lines matching write patterns (insert into, update ... set, delete from, drop, alter table, truncate), per file: `scratch_master_e2e_verification.js` 5, `scratch_test_notifications_integration.js` 3, `scratch_test_single_device_login.js` 3, `scratch_test_app_preferences_persistence.js` 2, `scratch_test_profile_persistence.js` 1; `scratch_inspect_tables.js` 0 and `scratch_test_db.js` 0. These are counts of matching **lines**, not statements.
3. **What it proves.** Five of the seven contain write patterns; two do not. All seven embed the owner credential, so any of them could be edited to write.
4. **Unknown.** What each script does at run time; whether any was ever run against the production database; whether any helper function it calls writes.
5. **Owner.** Repository owner (script purpose); database administrator (execution history in provider logs, DB-7).
6. **Correction supported?** **Yes** (PC-3), for the one sentence in Assessment §10 item 8.

### D-4. Explanation for empty Vercel snapshot values is unverified
1. **Original claim.** Assessment §3.3: "the platform does not return sensitive values on pull" (stated as fact).
2. **Local evidence.** `.vercel/.env.production.local` (dated 2026-09-17, header "Created by Vercel CLI") has 70 variable names: **60 empty, 10 populated**.
   - The populated ten are `GOOGLE_CALLBACK_URL`, `VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `VERCEL_OIDC_TOKEN` and five build-tool settings (`NX_DAEMON`, `TURBO_CACHE`, `TURBO_DOWNLOAD_LOCAL_ENABLED`, `TURBO_REMOTE_ONLY`, `TURBO_RUN_SUMMARY`).
   - Of 15 secret-like names (secret, password, token, key, URL), 13 are empty; the two populated are `GOOGLE_CALLBACK_URL` (not a secret) and `VERCEL_OIDC_TOKEN` (issued by the platform).
   - Empty values also include plainly non-secret names such as `API_PREFIX`, `APP_NAME`, `CORS_ORIGINS`, `DB_HOST`, `DB_PORT`, `DB_SSL`, `JWT_ISSUER`, `JWT_AUDIENCE`.
3. **What it proves.** The snapshot lists these variable names for the production environment at the time of the pull, and shows that **at least one user-defined variable (`GOOGLE_CALLBACK_URL`) was returned with a value**, so the pull is not uniformly empty. It also shows emptiness is not limited to secret-looking names.
4. **Unknown.** Why 60 values are empty: marked sensitive (all of them would have to be, including plain configuration), set to empty, or unreadable to that pull for another reason. Whether the current live values match anything in the repository.
5. **Owner.** Deployment owner (tracker DP-4, DP-1, DP-3).
6. **Correction supported?** **Yes, as a weakening** (PC-4): replace the statement with the observed pattern and mark the reason unverified. The finding that the snapshot cannot show what production holds stands.

### D-5. Liveness does not exercise the database; test-account availability is unconfirmed
1. **Original claim.** Approval package D-5: the liveness route does not exercise the database; production test-account availability is unconfirmed. Assessment §6 Phase 3.3 and Plan Part II step 6 name a "sign-in with a disposable test identity" and "the health endpoint".
2. **Local evidence.**
   - API routes (`apps/api/src/modules/health/health.controller.ts`): `GET /api/v1/health` runs the database indicator, the Typesense indicator, the storage indicator and a memory check; `GET /api/v1/health/liveness` returns a fixed response with no database call.
   - The database indicator calls `DatabaseService.ping()`, which runs `SELECT 1` (read-only).
   - **New:** the gateway's own `health/liveness` and `health/readiness` routes (`ownus/src/app/api/v1/[...path]/route.ts` around line 3445) return a fixed "Orion Gateway Online" response without touching the database or the API.
   - No document or fixture names a designated production test account. The seed script creates one administrator from environment-supplied credentials (not a designated test account) and is not evidence that one exists in production.
3. **What it proves.** The comprehensive API health route does exercise the database with a read-only query, but also depends on Typesense, storage and memory, so a failure may not be a database problem and a pass depends on those too. Liveness (API) and readiness or liveness (gateway) prove nothing about the database.
4. **Unknown.** Whether a pre-existing, approved test account exists in production; whether the Typesense and storage indicators pass in production today; which authenticated read is acceptable as a post-cutover check.
5. **Owner.** Application owner (acceptable validation) and deployment owner (tracker DP-9).
6. **Correction supported?** **Yes** (PC-5), including the new gateway fact.

### D-6. `neon_service`
1. **Original claim.** Approval package D-6: `neon_service` is absent from the assessment's unknowns and inventory.
2. **Local evidence.** It appears in the same three documents as in D-1 as a role "seen" on 2026-10-01 together with `neondb_owner`. The Phase A2 checklist presumes that Neon-managed roles need not be application roles (presumption, not evidence). No saved query output shows its attributes. It does not appear in any env file, code or migration.
3. **What it proves.** A role by that name existed at the time of the earlier audit.
4. **Unknown.** Its purpose, attributes and privileges; whether it shares the password or can be affected by changes to `neondb_owner`.
5. **Owner.** Database administrator (tracker DB-3).
6. **Correction supported?** **Yes** (PC-6): add it to the inventory and unknowns. It is already tracked in the approval package (K-19) and the evidence request (DB-3).

### D-7. Compose "localhost URL only"
1. **Original claim.** Plan Part I §4 (line 88): `docker-compose.yml` holds "a localhost URL only".
2. **Local evidence.** The compose `DATABASE_URL` (line 76) targets the compose service host `postgres` on port 5432, database `orion_db`; it is a compose-network URL. The directory scan found no occurrence of the exposed password in `docker-compose.yml` (only the JWT values and the Typesense key literal).
3. **What it proves.** The compose file does not contain the exposed database credential; the wording "localhost" is imprecise.
4. **Unknown.** None relevant.
5. **Owner.** Repository owner (editorial).
6. **Correction supported?** **Yes** (PC-7).

### D-8. Additional clones or author identities
1. **Original claim.** Approval package D-8 and F8: the credential-bearing revisions have two author identities, so other clones or copies may exist.
2. **Local evidence.** Across all 80 revisions: **two identities**; the configured identity has 41 commits (author dates 2026-09-11 to 2026-09-24) and the other has 39 (2026-09-18 to 2026-09-25). Neither is a GitHub no-reply address. Of the 23 credential-bearing revisions, 20 are by the other identity (including `1cdf261`) and 3 by the configured one. There are no merge commits. Author and committer identities are the same on all 80 revisions. The other identity's 13 commits in the pulled range arrived here in one pull at 21:58:37.
3. **What it proves.** At least one other identity committed the credential-bearing revisions from a clone that is not this one and is a regular contributor (39 commits over eight days). That clone probably holds the credential, the code and local env files.
4. **Unknown.** Whether the second identity is another person or the same person on another machine or configuration; where its clones, backups and tooling copies are; whether it holds the production credential in env files; who else has access.
5. **Owner.** GitHub repository owner and the team (tracker GH-4); each holder for their own machine (checklist C-14).
6. **Correction supported?** **Yes** (PC-8), adding the contributor facts to Assessment §3.4 and K-18. Names and addresses are deliberately not recorded here.

---

## 3. Proposed corrections (not applied)
Applying any of these needs separate human review; none changes the findings that the credential is exposed, owner-level treatment is precautionary, and that nothing was tested.

| ID | Document and place | Current wording (summary) | Proposed wording | Supported by | Applied? |
|---|---|---|---|---|---|
| PC-1 | Assessment §3.1.3; Plan Part II §II.1; Approval I1 | "is the owner of the production database objects (read-only audit)" | "The configured application connection uses the role `neondb_owner`. Earlier audits recorded that roles `neondb_owner` and `neon_service` were seen. Object ownership and role attributes are **unconfirmed** (check C11 pending, tracker DB-2). Owner-level treatment is precautionary." Mark class INFERENCE | D-1 | no |
| PC-2 | Assessment §3.1.5 (and §4 item 12; Approval §1, I2) | "earliest entry ... is 21:58 (a fast-forward on pull)" | Insert the four-part timeline T1 to T4 of §1 of this document; add that the commit has no local commit event and was authored under the second identity | D-2, §1 | no |
| PC-3 | Assessment §10 item 8 | "Seven scratch scripts with write statements remain tracked" | "Five of the seven tracked scripts contain write statements; all seven embed the owner credential" | D-3 | no |
| PC-4 | Assessment §3.3, K-7, K-8 | "the platform does not return sensitive values on pull" | "In the 2026-09-17 production snapshot 60 of 70 values are empty (including non-secret names) and 10 are populated (including one user-defined variable); the reason is unverified (DP-4)" | D-4 | no |
| PC-5 | Assessment §6 Phase 3.3 and §7.1; Plan Part II step 6; Approval §8 (gateway row) | "health endpoint"; "sign-in with a disposable test identity"; gateway "one read-only page" | Name the comprehensive route `/api/v1/health` (read-only `SELECT 1`, also depends on Typesense and storage) and state that API liveness and the gateway's liveness and readiness routes do not touch the database; require a pre-existing approved test account and no account creation under G-1 to G-3 | D-5 | no |
| PC-6 | Assessment §4 and §5 | `neon_service` not listed | Add `neon_service` to the unknowns (DB-3) and the inventory (K-19) | D-6 | no |
| PC-7 | Plan Part I §4 (line 88) | "a localhost URL only" | "a compose-network URL (host `postgres`) that does not contain the exposed credential" | D-7 | no |
| PC-8 | Assessment §3.4, K-18, §4 | no mention of the second identity | Add the two-identity facts of D-8 (counts and dates only; no names) | D-8 | no |
| PC-9 | Assessment §3.5; Approval status counts | "121 untracked entries" read as files | Note that `git status --porcelain` collapses an untracked directory into one entry, so entry counts are not file counts (the People module directory, for example, is a single entry) | observation, §4 below | no |

Review of each proposal: reviewer `NOT SET`, decision `NOT SET`, date `NOT SET`.

Scope note (2026-10-03): this table holds PC-1 to PC-9. Further proposed corrections PC-10 to PC-13 are documented in `CREDENTIAL_TARGET_VERIFICATION_REPORT.md` §10 (status `PROPOSED — NOT APPLIED`). Criterion R9 covers all thirteen.

---

## 4. Working-tree observations (to protect unrelated work)
Observed through Git status and file metadata only; contents were not read.
- Orion `main` at `fe7307f`: 59 modified and 126 untracked porcelain entries (directory entries count once), none staged, no stashes, `.gitignore` unchanged, the eight `ownus/scratch_*.js` files still tracked.
- During this task and the previous one, **14 People-import files changed between 11:05 and 11:18 on 2026-10-03**, all untracked: in `apps/api/src/modules/people/` (`people.module.ts`, `dto/people-bundle-import.dto.ts`, `ingestion/people-import-job.service.ts`, `ingestion/bundle/people-bundle.manifest.ts`, `safe-zip.ts`, `people-bundle-import.controller.ts`, `people-bundle-import.service.ts`, `__tests__/people-bundle-fixtures.ts`, `people-bundle-validation.spec.ts`, `people-bundle-import.integration.spec.ts`) and in `ownus/src/` (`lib/people-import.ts`, `lib/__tests__/people-bundle-import.test.ts`, `components/admin/views/people-bundle-import.tsx`, `people-import-view.tsx`). Two have birth times of 11:15:00 and 11:18:20.
- None of these was written by this task (this task wrote only documents under `docs/`, the last at 11:25 and the earlier ones at 11:00 and 11:24).
- A peer Claude session named "Orion pipeline extension for People layer" was listed as busy and about 46 minutes old, and its subject matches. That is circumstantial. **Authorship and purpose of the changes: REQUIRES TEAM CONFIRMATION.** They are not assumed to be accidental or related to this remediation. They were not edited, staged, committed, deleted, moved, reformatted or reverted.
- Pipeline working copy: 29 porcelain entries, unchanged from the previous phase (including the 1 staged deletion that is not from this task).

---

## 5. Evidence gaps resolved locally versus still open
| Gap | Resolved by local evidence? | Result |
|---|---|---|
| D-1 ownership and privileges | **No** | stays open (DB-2); the earlier wording was too strong |
| D-2 remote push time | **No** | stays open (GH-7); three bounded observations (T1 to T3) documented |
| D-3 write statements | **Yes** | five of seven; counts per file |
| D-4 empty snapshot | **Partly** | pattern characterised (60 of 70 empty; at least one user variable populated); reason open (DP-4) |
| D-5 validation endpoint | **Partly** | route behavior established for the API and the gateway; test-account availability open (DP-9) |
| D-6 `neon_service` | **No** | open (DB-3) |
| D-7 compose wording | **Yes** | wording correction supported |
| D-8 identities | **Partly** | two identities and their commit footprint established; who and where open (GH-4) |

## Completion note
Read-only review. No external service was contacted, no credential was tested, validated, rotated or changed, and no secret value, author name or address was printed or stored. No database, configuration, code, environment file, `.gitignore`, deployment setting or Git history was changed; nothing was staged, committed, pushed, deleted, renamed or moved. The only change is this new file.
