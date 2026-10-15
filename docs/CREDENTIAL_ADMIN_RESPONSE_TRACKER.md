# Credential exposure: response tracker and approval-readiness criteria (RR-25, Phase 3)

**Status: NO RESPONSES RECEIVED. Every item below is `UNANSWERED`. The database cutover is NOT READY for approval consideration.** Date prepared: 2026-10-03. This tracker approves nothing, authorizes nothing, and changes no status of `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (`DRAFT — NOT APPROVED`). Gates G-1 to G-10 are untouched.

Companion documents: `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md` (the questions in full, with reasons), `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (the approval package), `CREDENTIAL_ASSESSMENT_CORRECTIONS.md` (reconciliation of D-1 to D-8 and proposed corrections), `CREDENTIAL_EXPOSURE_ASSESSMENT.md`, `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md`, `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`.

**No secret appears in this tracker, and none may be added.** Evidence references point to a private location by title and date (for example a restricted folder or ticket number). Never paste a password, token, key, connection string or `.env` content, or a screenshot that shows one.

## Rules for using this tracker
1. **Statuses.**
   - `UNANSWERED`: no accepted evidence yet, or only a partial answer.
   - `ANSWERED`: the responsible role supplied evidence that directly answers the question, and the incident owner accepted it.
   - `NOT APPLICABLE`: the question does not apply, with a written reason accepted by the incident owner.
2. A partial answer, a verbal answer without a reference, or "CANNOT DETERMINE" stays `UNANSWERED`; record what was said in *Follow-up*. Missing evidence is never read as absence of exposure.
3. Do not change a status on the strength of local documents alone. Local facts are noted under *Follow-up* as context and do not answer the question.
4. Each status change is logged in the change log at the end with date, who recorded it, and the evidence reference. Do not invent people, dates or responses.
5. Nobody answers by testing the exposed credential or by connecting to systems on their own initiative; changes need the gates in the approval package.

Legend: **Responsible role** is a role, not a person; names are filled in by the incident owner (`NOT SET` until then).

---

## A. Database administrator
Named person: Subash A. V. — `USER-SELECTED — PENDING VERIFICATION` (selected 2026-10-04; authority unverified, incident tracker §10 SV-1).

| ID | Question | Required evidence | Responsible role | Status | Evidence ref | Follow-up |
|---|---|---|---|---|---|---|
| DB-1 | Is the credential for `neondb_owner` that was current on 2026-09-19 still valid? When was its password last changed? | provider role or password-change history, stated as a date (no sign-in test) | database administrator | UNANSWERED | none | Local files with the credential were last modified 2026-09-19; they may be stale. Treat as possibly valid until answered |
| DB-2 | What are the attributes and privileges of `neondb_owner`, and does it own the schemas and objects? | role list with attributes and ownership summary (names only); Phase A2 checks C11a to C11g if approved | database administrator | UNANSWERED | none | Resolves D-1. Local docs say only that the role was "seen"; migrations contain no ownership or grant statements |
| DB-3 | What is `neon_service`: purpose, attributes, users, effect of changes to `neondb_owner`? | provider documentation reference or console description | database administrator | UNANSWERED | none | Resolves D-6 |
| DB-4 | Which applications, hosts, jobs and people connect as `neondb_owner`? Does any other role share the password? | consumer list by name and owner; yes/no for shared password | database administrator with consumer owners | UNANSWERED | none | Compare with inventory K-1 to K-19 in the approval package |
| DB-5 | Which endpoints are in use (pooled and direct), and how many per project and branch? | endpoint types and counts | database administrator | UNANSWERED | none | Local files use a pooled endpoint |
| DB-6 | Which access, connection and audit logs exist and what is the retention period? Do they reach back to the credential's last change (or before 2026-09-17)? | retention setting and oldest available date | database administrator | UNANSWERED | none | Short retention is itself a finding. Preserve logs before any change |
| DB-7 | In the retained logs, any use from unfamiliar sources or times, unexpected writes or DDL, new roles or extensions, large exports? Was any of the five write-capable scratch scripts run against production? | statement with counts; raw logs preserved privately | database administrator | UNANSWERED | none | If misuse is suspected, escalate as an incident before the cutover |
| DB-8 | Active connections now, by role and source category | counts by role and source type | database administrator | UNANSWERED | none | Identifies unknown consumers |
| DB-9 | Which database branches exist (names, parents, dates)? Did any inherit `neondb_owner` and its password? | branch list with parent and date; yes/no for inheritance | database administrator | UNANSWERED | none | No branch is named anywhere locally; no `STAGING_*` setting is configured locally. Mapped to R2 **Update 2026-10-04 (user-supplied, not independently verified):** branch `orion-migration-rehearsal` exists with parent `production`; the rehearsal endpoint ID is `ep-patient-mouse-aeklhgtl` (pooled; role shown as `neondb_owner`); which branch the application endpoint belongs to and whether the rehearsal branch inherited the role password remain unverified (incident tracker §10.1). The statement above that no branch is named locally predates this and is kept as history. |
| DB-10 | What is the safest supported replacement process: reset the owner password, or create a least-privilege role? What happens to pooled and direct connections on reset, and how fast? | provider documentation references and the administrator's recommendation | database administrator | UNANSWERED | none | Feeds approval package §4 |
| DB-11 | Which privileges does a least-privilege application role need, and which operations still need the owner (migrations, role administration)? | privilege outline (names, not secrets) | database administrator with application owner | UNANSWERED | none | Required for readiness criterion R5 |
| DB-12 | Is backup or point-in-time recovery available, with what retention, and who can start a restore? | yes/no, retention, named role | database administrator | UNANSWERED | none | Recovery path (approval package P7). Mapped to R6 |
| DB-13 | What maintenance window and abort conditions does the administrator require? | window and conditions | database administrator | UNANSWERED | none | Fills the blank thresholds in approval package §9 |

## B. GitHub repository owner
Named person: Subash A. V. — `USER-SELECTED — PENDING VERIFICATION` (selected 2026-10-04; admin rights unverified, incident tracker §10 SV-2).

| ID | Question | Required evidence | Responsible role | Status | Evidence ref | Follow-up |
|---|---|---|---|---|---|---|
| GH-1 | Is the repository public, internal or private now? Has it ever been public? When did visibility last change? | settings page and audit-log entry (dates) | repository owner | UNANSWERED | none | If it was ever public, treat the credential as permanently disclosed |
| GH-2 | Who has or had access: collaborators, teams, outside collaborators, deploy keys, apps, tokens, integrations? | role and access-type list | repository owner | UNANSWERED | none | |
| GH-3 | How many forks, mirrors and archives exist; any outside the organisation? Clone or traffic data? | counts from network and insights pages | repository owner | UNANSWERED | none | Copies cannot be recalled |
| GH-4 | Who or what is behind each of the two author identities (41 and 39 commits)? Was `1cdf261` created on another machine? Where do that identity's clones and backups live? | owners and machines by name (not the credential) | repository owner and the team | UNANSWERED | none | Resolves D-8. Local facts: 20 of the 23 credential-bearing revisions and the first are by the second identity; identity names and addresses are intentionally not recorded here |
| GH-5 | Do pull-request refs, closed or unmerged branches keep the credential-bearing commits reachable? | branches and PRs by number | repository owner | UNANSWERED | none | Local refs: `main`, `origin/main`, `fix/vercel-build` (the last does not contain `1cdf261`); no tags |
| GH-6 | Are there security or secret-scanning alerts? Who received them? Is push protection available and on? | alert list without secret text; plan capability | repository owner | UNANSWERED | none | Needed for the separate scanning item (G-10). Covered by R3 through the range GH-1 to GH-8 |
| GH-7 | What do audit or security logs show about when the credential-bearing commits were first **pushed**, from which actor, and about any clone, fork or access afterwards? | push-event timestamps and actor type | repository owner | UNANSWERED | none | Resolves D-2. Local data gives only T1 (author time 2026-09-21 14:52:05 +0530) and T3 (known on the remote by 2026-09-21 21:58:37 +0530 as seen by this clone); T4 (provider push time) is **not established** |
| GH-8 | Did any hosted CI or workflow run for these commits, and could its logs contain the values? | yes/no and location | repository owner | UNANSWERED | none | No workflow files exist in either repository |

## C. Deployment owner
Named person: `NOT SET`. The user did not select a deployment owner; Subash A. V. selected themselves as Vercel account administrator and hosting/application infrastructure owner (`USER-SELECTED — PENDING VERIFICATION`, SV-3, SV-4). Whether that covers the deployment-owner role is unconfirmed.

| ID | Question | Required evidence | Responsible role | Status | Evidence ref | Follow-up |
|---|---|---|---|---|---|---|
| DP-1 | Do production environments use the same database credential that is in the scratch scripts? (per variable: role is `neondb_owner`? password matches?) | yes/no per variable; match decided via the provider's history if comparison is not appropriate | deployment owner with database administrator | UNANSWERED | none | Local snapshot cannot answer (values empty) |
| DP-2 | Same question for preview and development environments and any other project or team linked to the database | yes/no per environment | deployment owner | UNANSWERED | none | Preview environments often copy production |
| DP-3 | Does production (or preview) use either committed JWT secret? Are the API and gateway set to the same pair? | yes/no per variable and environment | deployment owner | UNANSWERED | none | Local development files use the committed values; production unknown |
| DP-4 | Interpretation of the Vercel snapshot: why are 60 of 70 values empty? Which variables exist per environment and which are marked sensitive? | list of names with sensitive yes/no | deployment owner | UNANSWERED | none | Resolves D-4. Local pattern: 60 empty, 10 populated (including one user-defined variable, `GOOGLE_CALLBACK_URL`); reason unverified |
| DP-5 | Which other services, jobs, hosts, containers, functions, queues or integrations connect with `neondb_owner` (deployed Pipeline, cron, workers, backups, reporting)? | list by name and owner | deployment owner | UNANSWERED | none | No such consumer is visible locally; the Pipeline working copy points at a local database |
| DP-6 | Is the Typesense development key used by any deployed instance? Is `SEARCH_PROVIDER` set to `typesense` anywhere deployed? Which instances exist and who administers them? | yes/no, instance names | deployment owner / Typesense administrator | UNANSWERED | none | Local value of `SEARCH_PROVIDER` is `postgres`. Unmapped to R1 to R10; feeds G-7 only |
| DP-7 | Do build or deployment logs, preview comments or exported logs contain any of the values? Can retention be changed? | yes/no | deployment owner | UNANSWERED | none | |
| DP-8 | Which secret-management mechanism does each deployment use; who can read and change values? | description and named owners | deployment owner | UNANSWERED | none | Defines the cutover mechanism and G-2 approvers |
| DP-9 | Is there a designated, pre-existing, approved test account, and an approved read-only database health check (the comprehensive route, not liveness)? | yes/no and the route name | deployment owner with application owner | UNANSWERED | none | Resolves D-5. Local facts: the API's `/api/v1/health` runs a read-only `SELECT 1` but also needs Typesense and storage; API liveness and the gateway's liveness and readiness do not touch the database; no test account is documented |

## D. Incident owner
Named person: Subash A. V. — `USER-SELECTED — PENDING VERIFICATION` (selected and accepted 2026-10-04; authority pending verification, incident tracker §10 SV-5).

| ID | Question | Required evidence | Responsible role | Status | Evidence ref | Follow-up |
|---|---|---|---|---|---|---|
| IO-1 | Who is the incident owner, and who is the named approver for each role (database administrator, application owner, deployment owner)? | names recorded in the approval package §13 | incident owner | UNANSWERED | none | The user selected themselves for several roles (`USER-SELECTED — PENDING VERIFICATION`); Incident Owner acceptance and a read-only-evidence-only combined-role arrangement were recorded 2026-10-04 (decision sheet §1.1a); verification of authority (incident tracker §10) remains pending; I-8 was answered 2026-10-04 as `USER-CONFIRMED: SAME PERSON` (the user states they are the Neon project/database owner and the credential-change approver; unverified); other approver fields are `NOT SET`. Also name: the credential-change approver (authorizes) separately from the executing database administrator, the Neon account/project owner (grants console access), and the other owners listed in the decision sheet §1.1 |
| IO-2 | Who must be informed externally (security contact, customers, regulators), and who decides? | decision record | incident owner | UNANSWERED | none | Decided outside this tracker |
| IO-3 | Are provider, deployment and repository logs being preserved before any change? | preservation confirmation with date | incident owner | UNANSWERED | none | Preserve before DB-6 retention expires |
| IO-4 | **Incident severity**: what severity is assigned, on what basis, and by whom? | severity record with rationale | incident owner | UNANSWERED | none | Local basis only: the credential is for a role named `neondb_owner` that the applications use; owner-level treatment is precautionary until DB-2 is answered |
| IO-5 | **Change window**: when, for how long, and who is on call during the cutover? | window, duration and contacts | incident owner with deployment owner | UNANSWERED | none | Needed for approval package P4 |
| IO-6 | **Approval authority**: who may approve each gate (G-1 database, G-2 deployments, G-3 local files) and who may approve revocation separately? | named authorities | incident owner | UNANSWERED | none | No approval has been given for any gate. Authorize versus execute: approval package §13.1; staging-branch reset or deletion needs its own authorization |
| IO-7 | **Communications**: who informs developers (local env file changes, do not run scratch scripts), users (only if sign-out later), and how are status updates handled? | communication plan | incident owner | UNANSWERED | none | JWT sign-outs are a separate item (G-6) |
| IO-8 | **Closure criteria**: what must be true to close the incident (revocation verified, consumers healthy, copies purged, residual exposure accepted, scanning in place)? | written criteria | incident owner | UNANSWERED | none | Draft criteria are in section F of this tracker |
| IO-9 | Are the uncommitted People-import changes in the Orion working tree (14 files changed 11:05 to 11:18 on 2026-10-03) known to the team, and who owns them? | team confirmation | incident owner / team | UNANSWERED | none | `REQUIRES TEAM CONFIRMATION`. Unrelated to this remediation as far as local evidence shows; preserved untouched. See corrections document §4 |

---

## E. Approval-readiness criteria for the database cutover
A cutover **can be considered for approval only when every criterion is met with accepted evidence.** Documents existing is not evidence. Missing evidence stays an explicit blocker. None of these is met today.

| # | Criterion | Needed evidence (tracker IDs) | Status | Blocker today |
|---|---|---|---|---|
| R1 | The affected role's privileges and ownership are confirmed by the authorized administrator | DB-2, DB-3 | **NOT MET** | DB-2 and DB-3 unanswered; local docs only show roles "seen" |
| R2 | The credential's current status and known consumers are assessed | DB-1, DB-4, DB-5, DB-8, DB-9, DP-1, DP-2, DP-5 | **NOT MET** | validity unknown; consumer list unconfirmed; Vercel values unreadable locally |
| R3 | Exposure scope and access-log limitations are documented | DB-6, DB-7, GH-1 to GH-8, DP-3, DP-4, DP-7, IO-3 | **NOT MET** | visibility, push time, log retention and second-identity clones unknown |
| R4 | Every known consumer has an owner and a validation plan | DB-4, DP-5, DP-8, GH-4; approval package §5 and §8 | **NOT MET** | owner fields `NOT SET` or user-selected pending verification; consumers K-5 to K-8, K-12, K-15, K-18, K-19 unverified |
| R5 | The replacement role's required permissions have been reviewed | DB-10, DB-11 | **NOT MET** | no privilege outline; no reviewer |
| R6 | The cutover and abort plans are specific and feasible | DB-12, DB-13, IO-5; approval package §7 and §9 | **NOT MET** | thresholds, observation period, window, alert recipient and escalation are blank |
| R7 | The production validation method is approved and does not assume permission to create test data | DP-9; corrections D-5 | **NOT MET** | no approved test account or approved read-only check; the gateway's own readiness route does not test the database; the plan must not create an account under G-1 to G-3 |
| R8 | The application owner, database administrator, deployment owner and incident owner have each explicitly approved their own responsibilities; the credential-change approver (who authorizes G-1) is named separately from the database administrator (who executes) | IO-1, IO-6; approval package §13 and §13.1 | **NOT MET** | no approval is recorded; names are user-selected pending verification or `NOT SET`; every decision is `NOT APPROVED` |
| R9 | The proposed corrections PC-1 to PC-9 (`CREDENTIAL_ASSESSMENT_CORRECTIONS.md` §3) and PC-10 to PC-13 (`CREDENTIAL_TARGET_VERIFICATION_REPORT.md` §10) have been reviewed and accepted or rejected by a human | corrections document §3; target report §10 | **NOT MET** | review fields `NOT SET` |
| R10 | Revocation has its own separate approval and refusal-check plan | approval package §11 | **NOT MET** | not requested; would follow verified sign-off only |

**Mapping notes (2026-10-03).** DB-9 is listed under R2 (rehearsal branches as consumers; branch identity) and DB-12 under R6 (recovery path). GH-6 is covered by R3 through the range GH-1 to GH-8. DP-6 (Typesense) is intentionally unmapped to R1 to R10 and feeds gate G-7 only. The deferred users-count request (AE-6 / target report E-4) has no tracker item and is unmapped. Adding or correcting a mapping marks no criterion met: R1 to R10 remain `NOT MET`.

**Overall: NOT READY.** The criteria also do not authorize anything: when all are met, the incident owner may *request* approval at G-1, G-2 and G-3; each is still given separately.

### Draft closure criteria (for IO-8; to be accepted by the incident owner)
- Exposed credential revoked and refusal verified by the administrator on pooled and direct endpoints.
- Every consumer healthy on the replacement credential, with sign-offs.
- Provider-log review completed and conclusions recorded; any suspected misuse handled.
- Rehearsal branches reset or deleted, or documented as clean.
- Separate items decided and tracked: scratch cleanup, `.gitignore`, JWT, Typesense, secret scanning, history rewrite, copy purge.
- Residual exposure (forks, clones, caches, copies) recorded as residual, not as resolved.

## Change log
| Date | Item(s) | Change | Recorded by | Evidence ref |
|---|---|---|---|---|
| 2026-10-03 | all | tracker created; every item `UNANSWERED`; criteria R1 to R10 `NOT MET` | documentation task (no person named) | none |
| 2026-10-03 | R2, R6, R8, R9; DB-9, DB-12, DP-6, GH-6; IO-1, IO-6 | documentation correction round: criterion evidence lists and R9 scope aligned with the other credential documents; mapping notes added; no status changed (all items `UNANSWERED`, R1 to R10 `NOT MET`) | documentation task (no person named) | none |
| 2026-10-04 | IO-1, R4, R8; sections A, B, C, D | recorded the user's role selections as `USER-SELECTED — PENDING VERIFICATION`; no item answered, no criterion met, no approval recorded | documentation task (selections communicated by the user) | none |
| 2026-10-04 | IO-1; section D | recorded the Incident Owner acceptance and a read-only-evidence-only combined-role arrangement (decision sheet §1.1a); IO-1 stays `UNANSWERED`; no item answered, no criterion met, no approval recorded | documentation task (confirmed by Subash A. V.) | none |
| 2026-10-04 | IO-1 | recorded the user's I-8 answer `USER-CONFIRMED: SAME PERSON` (identity answer only); IO-1 stays `UNANSWERED`; no item answered, no criterion met, no approval recorded | documentation task (confirmed by Subash A. V.) | none |
| 2026-10-04 | DB-9 | recorded the user's Neon branch details (branch parent `production`, rehearsal endpoint ID) as a dated follow-up; DB-9 stays `UNANSWERED`; no item answered, no criterion met, no approval recorded | documentation task (evidence supplied by the user) | incident tracker §10.1 |

## Completion note
Prepared from local files and Git metadata only. No external service was contacted, no credential was tested, no response was invented, and no person, date or approval was recorded that was not supplied. No application code, configuration, environment file, database, `.gitignore`, deployment setting or Git history was changed; nothing was staged, committed, pushed, deleted or moved.
