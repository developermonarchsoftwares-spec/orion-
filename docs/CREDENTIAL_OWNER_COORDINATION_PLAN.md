# Credential exposure: owner coordination plan and cutover decision criteria (RR-25, Phase 4)

**Status: COORDINATION MATERIAL ONLY. Nothing has been sent to anyone. No owner has responded. The database credential cutover is NOT READY.** Date prepared: 2026-10-03.

This document approves nothing, authorizes nothing, and leaves gates G-1 to G-10 untouched. `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` keeps its status `DRAFT — NOT APPROVED`. It does not claim that any administrator, owner or provider was contacted. All messages below are drafts for a human to review and send through their own channel.

Read and preserved (unchanged): `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md`, `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`, `CREDENTIAL_EXPOSURE_ASSESSMENT.md`, `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md` (questions DB-n, GH-n, DP-n, IO-n), `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`, `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md` (items and criteria R1 to R10), `CREDENTIAL_ASSESSMENT_CORRECTIONS.md` (D-1 to D-8, PC-1 to PC-9, timeline T1 to T4).

**No secret appears here, and none may be added to replies.** Evidence is described by title, date and private location; never by value.

## 0. How to use this plan
- A human (the incident owner, or whoever they delegate) sends the draft requests in §3 and records every reply in the tracker. This plan does not change tracker statuses; every item remains `UNANSWERED` until accepted evidence exists.
- Each action below has a stable ID (`CO-…`) and cites the tracker item that records its answer.
- Names, dates, responses and approvals are `NOT SET` until supplied by the people concerned. Nothing is invented.

### 0.1 Time sensitivity (decision for the incident owner)
The exposure continues until the credential is revoked, and some evidence expires (provider log retention, DB-6). "NOT READY" below describes the *planned, evidence-based cutover*; it is not advice to delay containment. If the administrator confirms the credential is valid and suspects misuse, the incident owner may decide, under their own authority and outside this plan, to take emergency action. That decision, and the gate approvals it would require, belong to the owners. Until then, the useful first moves are: name the owners (CO-IO-1), preserve logs (CO-IO-3), and get the validity and log-coverage answers (CO-DB-1, CO-DB-4).

## 1. What kind of statement is it? (fact, inference, owner-only)
Evidence classes are those of the earlier documents. This list keeps the three kinds apart.

**Facts established by local evidence**
- The seven tracked scripts `ownus/scratch_*.js` embed a credentialed URL for the role named `neondb_owner`; its password equals the one in the gitignored `apps/api/.env` and `ownus/.env.local` (in-memory comparison; no value recorded).
- 23 of 80 revisions contain the credential; first `1cdf261` (author time 2026-09-21 14:52:05 +0530); latest `72521a2` (2026-09-25).
- Five of the seven scripts contain write patterns; two contain none.
- The applications are configured to connect as `neondb_owner` through a pooled endpoint.
- No migration contains ownership, grant or role statements. Earlier audits recorded only that roles `neondb_owner` and `neon_service` were seen.
- The Vercel production snapshot (2026-09-17) has 70 names, 60 empty and 10 populated.
- Two author identities (41 and 39 commits); the second authored `1cdf261`.
- API `/api/v1/health` runs a read-only `SELECT 1` and also checks Typesense and storage; API liveness and the gateway's liveness and readiness do not touch the database.
- No CI workflow directory exists in either repository; the Pipeline working copy does not hold the exposed password.

**Inferences (not proven)**
- `neondb_owner` is an owner-level role and owns the objects (owner-level treatment is precautionary; DB-2).
- The credential existed before 2026-09-21 (local files dated 2026-09-19; snapshot 2026-09-17).
- The first credentialed commit was created on a clone other than this one and pushed between 14:52 and 21:58 +0530 on 2026-09-21 (T1 to T3; not a provider-side time).
- The second identity is a regular contributor whose clones probably hold the credential.
- Production may use the committed JWT values (their traits look generated; local development files use them).

**Only an administrator or owner can answer**
Validity; real privileges and ownership; `neon_service`; consumers; log retention and content; rehearsal branches; supported replacement process; repository visibility, access, forks, hidden refs, alerts and push events; who the second identity is; what the deployments hold; why the snapshot values are empty; other hosts and jobs; Typesense use; severity, approvers, window, communications and escalation.

---

## 2. Action lists by owner
These are read-only evidence actions unless a gate is named. Authorize versus execute is defined in `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §13.1; an executing administrator does not authorize their own change.
Every action: responsible role, evidence required, current status, and the decision the answer enables. Status for all: **NOT STARTED — tracker item `UNANSWERED`**.

### 2.1 Database administrator (named person: `NOT SET`)
| ID | Action | Tracker | Evidence required (no secrets) | Decision enabled by the answer |
|---|---|---|---|---|
| CO-DB-1 | Confirm whether the exposed credential is still valid, using the provider's role/password-change history (do not test by signing in) | DB-1 | date of last change; statement of whether the value current on 2026-09-19 was replaced | valid: urgency and emergency decision (§0.1); replaced: local files are stale and remaining risk shifts to what the old value could have done |
| CO-DB-2 | Confirm the affected role's actual attributes, privileges and ownership of schemas and objects | DB-2 | role list with attributes and ownership summary (names only), or approved Phase A2 checks C11a to C11g | confirms or removes owner-level treatment (D-1); sets the scope of the replacement role |
| CO-DB-3 | Identify `neon_service` and any other role present | DB-3 | role description and users | whether other roles are affected by, or share, the change |
| CO-DB-4 | Establish access-log coverage and limitations: which logs exist, retention, oldest available date, whether they cover the period from the credential's last change (or before 2026-09-17) | DB-6, IO-3 | retention setting and oldest date | whether misuse can be ruled in or out at all; short coverage becomes a recorded limitation |
| CO-DB-5 | Review the retained logs for unfamiliar sources, unexpected writes or DDL, role or extension changes, exports; state whether any of the five write-capable scratch scripts ran against production | DB-7 | statement with counts; raw logs preserved privately | incident handling versus routine cutover |
| CO-DB-6 | Identify known consumers of the role and any role sharing the password; report active connections by role and source category; endpoint types (pooled and direct) | DB-4, DB-5, DB-8 | consumer list by name and owner; counts | the complete consumer inventory (criterion R2, R4) |
| CO-DB-7 | List database branches (name, parent, date) and state whether any inherited the credential | DB-9 | branch list, yes/no | which branches to reset or delete (each deletion confirmed separately) |
| CO-DB-8 | Identify the supported replacement-credential process and the effect of a password reset on pooled and direct connections | DB-10 | provider documentation references and recommendation | strategy: staged replacement role versus owner reset |
| CO-DB-9 | Recommend a least-privilege replacement approach: required privileges on schemas, tables, sequences and defaults, and what still needs the owner (migrations, role administration), with the application owner | DB-11 | privilege outline (names only) | the role design reviewed under R5; whether owner credentials can be sealed |
| CO-DB-10 | Confirm backup or point-in-time recovery, and state window and abort conditions | DB-12, DB-13 | yes/no, retention, window | recovery path and the blank thresholds in the approval package |

### 2.2 GitHub repository owner (named person: `NOT SET`)
| ID | Action | Tracker | Evidence required | Decision enabled |
|---|---|---|---|---|
| CO-GH-1 | Confirm current and historical repository visibility, and when it last changed | GH-1 | settings page and audit-log entries (dates) | if ever public: treat as permanently disclosed; shapes the history-rewrite decision |
| CO-GH-2 | Review collaborators, teams, outside collaborators, deploy keys, apps, tokens | GH-2 | access list by role | who could have read the commits; who must be informed |
| CO-GH-3 | Review forks, mirrors, archives and clone or traffic data | GH-3 | counts | residual exposure that rotation alone must cover |
| CO-GH-4 | Review pull-request refs, closed and unmerged branches that keep the commits reachable | GH-5 | branches and PR numbers | scope of any later cleanup |
| CO-GH-5 | Review security and secret-scanning alerts and push-protection availability | GH-6 | alert list without secret text | whether earlier detection exists; capability for the separate scanning item |
| CO-GH-6 | Investigate the actual provider-side push timeline: push events, actor, and any later clone or fork | GH-7, GH-8 | push-event timestamps and actor type; whether hosted CI ran | converts T4 from "not established" to a documented time; sets the exposure start |
| CO-GH-7 | Identify the second commit-author identity through authorized internal coordination (who or what is behind it, which machines) | GH-4 | owner and machines by name (not the credential) | list of copies to purge (C-14); whether more people hold the credential |

### 2.3 Deployment owner (named person: `NOT SET`)
| ID | Action | Tracker | Evidence required | Decision enabled |
|---|---|---|---|---|
| CO-DP-1 | Confirm whether production or preview environments use the exposed database credential (per variable: role is `neondb_owner`; password matches, decided with the administrator) | DP-1, DP-2 | yes/no per variable and environment | whether a rotation changes production; which deployments are consumers (K-5 to K-8) |
| CO-DP-2 | Determine whether any deployed environment uses either committed JWT secret, and whether the API and gateway share the pair | DP-3 | yes/no per variable and environment | whether JWT rotation (separate item, G-6) is urgent |
| CO-DP-3 | Clarify the empty values in the Vercel snapshot with authoritative evidence: which variables exist per environment and which are marked sensitive | DP-4 | names with sensitive yes/no | whether the 2026-09-17 snapshot has any evidential value (D-4) |
| CO-DP-4 | Identify other hosts, scheduled jobs, workers, containers, queues and services that connect to the database; log exposure | DP-5, DP-7 | list by name and owner | completes the consumer inventory (K-15) |
| CO-DP-5 | Confirm whether any deployed instance uses Typesense and with which key | DP-6 | yes/no, instance names | whether the Typesense item (G-7) is needed |
| CO-DP-6 | Describe the secret-management mechanism and who can read and change values | DP-8 | description and named owners | how G-2 is executed and who approves it |
| CO-DP-7 | Confirm a designated, pre-existing, approved test account (no new account is to be created under G-1 to G-3) and an approved read-only database health check | DP-9 | yes/no and route name | the production validation method (R7); D-5 |

### 2.4 Incident owner (named person: `NOT SET`)
| ID | Action | Tracker | Evidence required | Decision enabled |
|---|---|---|---|---|
| CO-IO-1 | Establish incident severity, response ownership, and who is the named approver for each responsibility | IO-1, IO-4 | recorded severity with rationale; names in approval package §13 | who may act; the order of everything else |
| CO-IO-2 | Identify authorized approvers for each gate (G-1 database, G-2 deployments, G-3 local files) and for the separate revocation | IO-6 | named authorities | whether approval requests can be made at all |
| CO-IO-3 | Preserve provider, deployment and repository logs before any change | IO-3 | confirmation with date | protects evidence before retention expires |
| CO-IO-4 | Define the proposed change window and the communication requirements (developers, owners; users only if sign-out later) | IO-5, IO-7 | window, duration, contacts; plan | fills approval package P4, §9 |
| CO-IO-5 | Confirm the approval and escalation process (who is paged, who may stop the change, who decides external notification) | IO-2, IO-6 | process record | abort authority; external reporting decision |
| CO-IO-6 | Set closure criteria | IO-8 | accepted criteria | when the incident may close |
| CO-IO-7 | Resolve concurrent-work ownership (§6) | IO-9 | team confirmation | avoids mixing unrelated work into any remediation commit |

### 2.5 Suggested order for the human coordinator (for planning only)
1. CO-IO-1, CO-IO-2, CO-IO-3 (owners named; logs preserved).
2. CO-DB-1, CO-DB-2, CO-DB-4, CO-GH-1 (these decide urgency and exposure scope).
3. CO-DB-5 to CO-DB-9, CO-GH-2 to CO-GH-7, CO-DP-1 to CO-DP-7 (can run in parallel).
4. CO-IO-4, CO-IO-5, CO-IO-6 and the decision table in §5, then a request for G-1, G-2 and G-3 only if the criteria are met.

---

## 3. Draft hand-off messages (DRAFT — NOT SENT)
For a human to review, adapt and send. They contain no secret, and they ask for none.

**To the database administrator.** "A database connection credential for the role `neondb_owner` was found in tracked scratch scripts and in Git history (first commit 2026-09-21). Please answer the questions DB-1 to DB-13 in `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md` from the provider console. Do not test the credential by signing in. Do not change anything yet. First, please check how long access logs are kept and preserve what exists. Do not send passwords or connection strings; send dates, role names, counts and yes/no answers."

**To the GitHub repository owner.** "Please answer GH-1 to GH-8: repository visibility now and ever, who has or had access, forks and clones, hidden refs, security alerts and, above all, the push event times and actors for the commits that contain the credential. Please also help identify who is behind the second commit-author identity (one of the two identities that appear in the history). Do not send the credential; send dates, counts and names of owners."

**To the deployment owner.** "Please answer DP-1 to DP-9 from the live deployment settings: whether production or preview use the exposed database credential or the committed JWT values, what the empty values in the 2026-09-17 environment snapshot mean, which other hosts or jobs connect to the database, whether any Typesense instance is deployed, and whether an approved test account and read-only health check exist. Please answer with yes/no per variable, not with values."

**To the incident owner.** "Please name the incident owner and the approver for each role, set severity, preserve logs, propose a change window and communications, and decide the escalation and notification path (IO-1 to IO-9). Please also confirm who owns the uncommitted People-import work in the shared working tree."

## 4. Proposed correction matrix (PC-1 to PC-9)
Scope note: this matrix covers PC-1 to PC-9. PC-10 to PC-13 are documented in `CREDENTIAL_TARGET_VERIFICATION_REPORT.md` §10 (also `PROPOSED — NOT APPLIED`). Criterion R9 covers all thirteen.
All entries: **status `PROPOSED — NOT APPLIED`**. None of the original documents was edited. Every correction needs human review. Where a correction is only a wording fix that local evidence fully supports, external confirmation is not needed for the wording; the underlying question may still need an owner (shown in the last column).

| ID | Existing claim (document and place) | Proposed wording | Supporting local evidence | Kind | External confirmation needed for the wording? | Owner question still open | Human review | Status |
|---|---|---|---|---|---|---|---|---|
| PC-1 | Assessment §3.1.3; Plan Part II §II.1; Approval I1: `neondb_owner` "is the owner of the production database objects (read-only audit)" | "The configured application connection uses the role `neondb_owner`. Earlier audits recorded that roles `neondb_owner` and `neon_service` were seen. Object ownership and role attributes are **unconfirmed** (check C11 pending, DB-2). Owner-level treatment is precautionary." Class: INFERENCE | applications' configured role; no ownership or grant statements in migrations; docs record roles "seen" only; saved audit snapshots hold no role data | fact + inference | no | DB-2, DB-3 | required | PROPOSED — NOT APPLIED |
| PC-2 | Assessment §3.1.5 (also §4 item 12; Approval §1, I2): earliest `origin/main` reflog entry is 21:58 | Insert the four-part timeline: T1 author time 14:52:05; T2 local reflog 21:58:37 (pull); T3 remote known to hold the commit by then, as seen by this clone; T4 provider push time not established. Add that the commit has no local commit event and was authored under the second identity | commit and reflog metadata; 13 commits from `f9f6400` to `557a765` all by the second identity, pulled at 21:58:37 | fact + inference | no | GH-7 (T4) | required | PROPOSED — NOT APPLIED |
| PC-3 | Assessment §10 item 8: "Seven scratch scripts with write statements remain tracked" | "Five of the seven tracked scripts contain write statements; all seven embed the owner credential" | per-file write-pattern line counts: 5, 3, 3, 2, 1 and 0, 0 | fact | no | DB-7 (whether any ran against production) | required | PROPOSED — NOT APPLIED |
| PC-4 | Assessment §3.3, K-7, K-8: "the platform does not return sensitive values on pull" | "In the 2026-09-17 production snapshot 60 of 70 values are empty (including non-secret names) and 10 are populated (including one user-defined variable); the reason is unverified" | snapshot name and emptiness pattern (names only) | fact (pattern) + unresolved (reason) | no | DP-4 | required | PROPOSED — NOT APPLIED |
| PC-5 | Assessment §6 Phase 3.3 and §7.1; Plan Part II step 6; Approval §8 gateway row: "health endpoint", "sign-in with a disposable test identity", gateway "one read-only page" | Name `/api/v1/health` (read-only `SELECT 1`; also depends on Typesense and storage); state that API liveness and the gateway's liveness and readiness routes do not touch the database; require a pre-existing approved test account and no account creation under G-1 to G-3 | health controller and `DatabaseService.ping()`; gateway route returns a fixed response; no designated test account documented | fact | no | DP-9 | required | PROPOSED — NOT APPLIED |
| PC-6 | Assessment §4, §5: `neon_service` absent | Add `neon_service` to the unknowns (DB-3) and the inventory (K-19) | earlier audit lists it with `neondb_owner`; no other record | fact | no | DB-3 | required | PROPOSED — NOT APPLIED |
| PC-7 | Plan Part I §4 (line 88): `docker-compose.yml` holds "a localhost URL only" | "a compose-network URL (host `postgres`) that does not contain the exposed credential" | compose `DATABASE_URL` host class; scan found no exposed password in the file | fact | no | none | required | PROPOSED — NOT APPLIED |
| PC-8 | Assessment §3.4, K-18, §4: no mention of the second identity | Add the two-identity facts: counts and dates only, no names | 41 and 39 commits; 20 of 23 credential-bearing revisions and the first by the second identity; no merge commits | fact + inference | no | GH-4 (who and where) | required | PROPOSED — NOT APPLIED |
| PC-9 | Assessment §3.5 and approval status counts: "121 untracked entries" read as files | Note that `git status --porcelain` counts an untracked directory as one entry | Git behavior; People module is one directory entry | fact | no | none | required | PROPOSED — NOT APPLIED |

Review of each: reviewer `NOT SET`, decision `NOT SET`, date `NOT SET`. Applying a correction would be a separate edit after that review; it would not change the findings that the credential is exposed or that nothing was tested.

## 5. Cutover decision criteria (all NOT MET)
The cutover stays **NOT READY** while any row is unmet. Documents existing is not evidence. In the table below, "Responsible owner" names who supplies or confirms the evidence; it does **not** automatically mean the approver. Approval and execution follow `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §13.1.

| # | Criterion | Required evidence | Responsible owner | Current status | Consequence if unresolved | Evidence required to mark it met |
|---|---|---|---|---|---|---|
| R1 | Role privileges and ownership confirmed by the authorized administrator | DB-2, DB-3 | database administrator | **NOT MET**: unanswered | the replacement role may be over- or under-privileged; the severity stays a guess; ownership claims stay inferences | written role and ownership summary from the console, accepted by the incident owner; PC-1 reviewed |
| R2 | Credential status and known consumers assessed | DB-1, DB-4, DB-5, DB-8, DB-9, DP-1, DP-2, DP-5 | database administrator; deployment owner | **NOT MET** | an unknown consumer breaks at revocation or keeps using the old value; validity unknown so urgency cannot be set | answers to the eight items with a consumer list reconciled to K-1 to K-19 |
| R3 | Exposure scope and log limitations documented | DB-6, DB-7, GH-1 to GH-8, DP-3, DP-4, DP-7, IO-3 | database administrator; repository owner; deployment owner; incident owner | **NOT MET** | misuse can neither be found nor excluded; copies and holders unknown; no basis for the history decision | recorded conclusions for log coverage, visibility, push timeline and holders, with retention limits stated |
| R4 | Every known consumer has an owner and a validation plan | DB-4, DP-5, DP-8, GH-4; approval package §5 and §8 | incident owner with consumer owners | **NOT MET**: owner fields `NOT SET`; K-5 to K-8, K-12, K-15, K-18, K-19 unverified | a consumer is cut over without a test, or missed | owner named and a pass criterion written for each consumer, reconciled to the provider's active-connection view |
| R5 | Replacement role permissions reviewed | DB-10, DB-11 | database administrator and application owner supply and review the evidence (neither is thereby the approver) | **NOT MET** | the staged least-privilege path cannot be chosen; fallback is another owner-level credential | a privilege outline reviewed and accepted by both, with the owner credential's sealed use stated |
| R6 | Cutover and abort plans specific and feasible | DB-12, DB-13, IO-5; approval package §7 and §9 | incident owner; database administrator | **NOT MET**: window, thresholds, observation period, alert recipient and escalation are blank | no objective stop condition; changes proceed on judgment under pressure | filled approval package §7 and §9 with numbers, times and named people, accepted by the owners |
| R7 | Production validation method approved and not dependent on creating test data | DP-9; PC-5 | application owner; deployment owner | **NOT MET** | validation either cannot be done or writes data into production | named existing test account and read-only database check, approved in writing; gateway's own readiness not used as a database test |
| R8 | Each owner has explicitly approved their own responsibilities | IO-1, IO-6; approval package §13 | application owner; database administrator; deployment owner; incident owner | **NOT MET**: all approval fields `NOT SET` | no one is accountable; nothing may proceed | each role's signed decision in §13, each separate |
| R9 | Proposed corrections reviewed | PC-1 to PC-9 (corrections document §3) and PC-10 to PC-13 (target report §10) | incident owner (or delegate) | **NOT MET**: no reviewer | decisions rest on claims already shown to be too strong (for example D-1) | a decision recorded for each correction, applied only after review |
| R10 | Revocation has its own separate approval and a refusal-check plan | approval package §11 | the separate revocation approver authorizes revocation; the database administrator executes it and the refusal check and must not self-authorize, even if the same person holds both approval roles (any combined-role arrangement is recorded in advance under OD-1); the incident owner coordinates | **NOT MET**: not requested | revocation either happens without sign-off or the exposure never ends | a separate recorded approval after consumer sign-offs; refusal-check plan accepted |

### 5.1 What the eventual cutover plan must contain
The decision to approve is considered only when the approval package, completed with real answers, covers each of these. Current status shows where it stands.

| Requirement | Where in the approval package | Status today |
|---|---|---|
| Least-privilege replacement | §4 | approach described; role design and privileges **not defined** (DB-10, DB-11) |
| Complete consumer inventory | §5 | listed K-1 to K-19; several unverified |
| Per-consumer validation | §8 | criteria drafted; test account and approved check **not confirmed** (DP-9) |
| Abort criteria | §9.1 | drafted; thresholds blank |
| Monitoring | §9.2 | drafted; recipients and periods blank |
| Recovery planning | §10 | drafted; backup/restore not confirmed (DB-12) |
| Separately approved revocation | §11 | drafted; not requested |
| Approvals | §13 | all `NOT SET` |

The replacement credential has **not** been created or tested, and no production validation has been performed.

### 5.2 Outstanding approval blockers (consolidated)
1. No owner has been named or has responded (IO-1, IO-6; all tracker items unanswered). *Update 2026-10-04:* the user selected themselves for nine roles (`USER-SELECTED — PENDING VERIFICATION`), explicitly accepted the Incident Owner role only, and answered I-8 as `USER-CONFIRMED: SAME PERSON` (2026-10-04); these are user statements and selections, not verified authority (SV-1 to SV-7 are pending) and not approvals, and no other owner has been named or has responded.
2. Credential validity unknown (DB-1).
3. Role privileges and ownership unconfirmed (DB-2, DB-3).
4. Log coverage unknown, and not yet preserved (DB-6, IO-3).
5. Consumer inventory incomplete: deployments, other hosts, rehearsal branches, clones and the second identity (DB-4, DB-9, DP-1 to DP-5, GH-4).
6. Repository visibility, forks, hidden refs and push timeline unknown (GH-1 to GH-8).
7. Replacement role design not reviewed (DB-10, DB-11).
8. Window, thresholds, observation period, recipients and escalation blank (DB-13, IO-5).
9. Production validation method not approved (DP-9).
10. Corrections PC-1 to PC-9 (corrections document) and PC-10 to PC-13 (target report) not reviewed.
11. Revocation not separately approved.

## 6. Concurrent People-import work (preserved; not part of this remediation)
Observed through Git status and file metadata only; contents were not read.
- Orion `main` at `fe7307f`: 59 modified and 128 untracked porcelain entries (directory entries count once), nothing staged, no stashes, `.gitignore` unchanged; the eight `ownus/scratch_*.js` files remain tracked. Pipeline working copy: 29 entries, unchanged.
- Untracked People-import files observed changing on 2026-10-03: the 14 listed in `CREDENTIAL_ASSESSMENT_CORRECTIONS.md` §4 (11:05 to 11:18), plus two changes since: `docs/PEOPLE_EXPORT_IMPORT.md` (created 11:30:14, untracked) and `ownus/src/lib/__tests__/people-bundle-import.test.ts` (rewritten at 11:31:36, untracked). Nothing has changed in the working tree since 11:33 other than this task's documents; the peer session "Orion pipeline extension for People layer" was listed as idle (it was busy about 25 minutes earlier).
- The authorship and purpose of these files **REQUIRES TEAM CONFIRMATION**. They are not assumed to be accidental or related to this work. They were not read, edited, staged, committed, deleted, renamed, reformatted or reverted. The tree is currently quiet, so documentation work proceeded; had it been changing, work would have stopped at documentation review.
- Rule for any later remediation commit: stage only named paths; never bulk-add untracked files.

## 7. Separate future remediation activities
None begun. Each has its own prerequisites and its own approval; approval of one is not approval of another.
| Activity | Checklist | Gate | Prerequisites |
|---|---|---|---|
| Database credential cutover (replacement, deployment and local file updates) | C-3, C-4 | G-1, G-2, G-3 | R1 to R10 met; the owners' approvals |
| Revocation of the exposed credential | C-5 | G-1 (separate) | verified cutover; consumer sign-offs; refusal-check plan |
| Scratch-script cleanup (untrack the seven scripts; decide others individually) | C-6, C-8 | G-4 | cutover done; only named paths staged; People-import files untouched |
| `.gitignore` changes | C-7 | G-5 | C-6 committed; patterns reviewed |
| JWT rotation and removal of compose literals | C-9, C-10 | G-6 (G-9 to push) | DP-3 answered; sign-out window announced |
| Typesense key | C-11 | G-7 | DP-6 answered |
| Secret-scanning configuration | C-12 | G-10 | C-6 done; tool and alert owner chosen |
| Git history rewrite | C-13 | G-8, G-9 | revocation done; visibility, copies known; mirror backup; written decision |
| Pushes and remote branch changes | n/a | G-9 | the owner's explicit approval |
| Purge of other copies | C-14 | none | cutover done; evidence preserved |
| Application of the corrections PC-1 to PC-13 | n/a | none | human review |

## Completion note
This phase was local documentation review and coordination preparation. No message, email, ticket or request was sent, and no administrator or owner was contacted. No external service (Neon, PostgreSQL, GitHub, Vercel, Typesense or any other) was contacted, no credential was tested or changed, no secret value was printed or stored. No application code, configuration, environment file, database, `.gitignore`, deployment setting or Git history was changed; nothing was staged, committed, pushed, deleted, renamed or moved. No gate was approved and no tracker item was marked resolved. The only change is this new file.
