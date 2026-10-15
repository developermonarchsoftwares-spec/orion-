# Credential remediation and GitHub release readiness plan (RR-25)

**Status: `BLOCKED`. Plan and audit only. Nothing executed, nothing approved, nothing published.** Date: 2026-10-04. Repository: `D:\ownus`.

**No secret appears here.** Findings are redacted: paths, variable names, short commit IDs, dates and counts only. Nothing in this document tested a credential, contacted a remote or provider, ran SQL, staged a file, committed, rewrote history or touched the concurrent People-import work.

## 1. Role of this document
It adds what the existing records did not hold in one place: the redacted history-reachability findings, the per-credential remediation matrix, the file classification and proposed publication scope, and the check results. It **supplements and does not replace** `CREDENTIAL_INCIDENT_OWNER_ACTION_TRACKER.md` (actions IA-01 to IA-25, authoritative for status), `CREDENTIAL_OWNER_DECISION_SHEET.md`, `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md`, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (approval record), `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` (credential plans CR-1 to CR-16, steps N-0 to N-11), `CREDENTIAL_REPOSITORY_CLEANUP_PROPOSAL.md` and `CREDENTIAL_EXECUTION_READINESS_REVIEW.md` §14. If a status here differs from the tracker, the tracker governs.

### 1.1 Status vocabulary (used consistently)
| Label | Meaning | Where it applies today |
|---|---|---|
| `USER-SELECTED — PENDING VERIFICATION` | the user chose themselves for a role; not verified authority | nine roles for Subash A. V. (decision sheet §1.1) |
| `USER-CONFIRMED` | an explicit statement or acceptance by the user; still not verified authority and not an approval | Incident Owner acceptance (2026-10-04); I-8 `USER-CONFIRMED: SAME PERSON` (2026-10-04) |
| `PENDING VERIFICATION` | evidence of access or authority not yet supplied | SV-1 to SV-7 |
| `NOT AUTHORIZED` | no authorization recorded | read-only Neon review (decision sheet §1.2); any Phase A2 SQL |
| `NOT APPROVED` | no approval recorded | all rows of the approval record; G-1 to G-10; revocation |
| `BLOCKED` | cannot proceed until a named prerequisite exists | this plan's push status; IA-23 (AE-6) |

## 2. Current state (read-only)
- `main` at `fe7307f` (2026-09-24), tracking `origin/main` (GitHub over https; the URL carries no password or token). **0 commits unpushed; 2 behind** `origin/main` as of the last local fetch record (2026-09-29; no fetch was made). Index empty. 59 modified and 141 untracked entries (361 files once directories are expanded). `.gitignore` unchanged. No stashes, no tags, no active Git hooks.
- Remote-tracking refs recorded locally: `origin/main` and `origin/fix/vercel-build`. Anything the real remote holds beyond that record (other branches, pull-request refs, forks, caches) is **unknown** without contacting it.

## 3. Ownership documentation (reconciled)
| Item | State |
|---|---|
| Incident Owner | Subash A. V.: `USER-SELECTED — PENDING VERIFICATION`; acceptance `USER-CONFIRMED` 2026-10-04 (this role only; the other eight roles are not accepted) |
| Other selected roles | Neon database administrator; GitHub/repository administrator; Vercel account administrator; credential-change approver; separate revocation approver; Phase A2 read-only review authorizer; Neon console access grantor; hosting/application infrastructure owner: all `USER-SELECTED — PENDING VERIFICATION` |
| I-8 | `USER-CONFIRMED: SAME PERSON` (2026-10-04): identity statement only; not proof of permissions or formal authority; approves nothing |
| Combined-role arrangement | recorded for read-only evidence actions only (IA-06 to IA-10, IA-12 to IA-16), after the read-only review is authorized and the SV items are satisfied; no change action, no SQL covered |
| Unselected roles | deployment owner, application owner, Typesense, Redis, storage, OAuth, email, payment/webhook and domain/DNS owners: `NOT SET` / `UNASSIGNED` |

### 3.1 SV-1 to SV-7: permitted local evidence check
Only local files and Git configuration can be read here. They show that a Vercel project link file exists on this machine and that a Git author identity and a GitHub remote are configured. **None of that establishes administration rights, ownership, or authority**, so SV-1 to SV-7 all remained `PENDING VERIFICATION` at that check. **Update 2026-10-04:** user-supplied Neon details (project, default branch, the rehearsal branch and its parent, the rehearsal endpoint ID) are recorded in tracker §10.1. SV-1 is now `IN PROGRESS`, not satisfied: the account's role and the production endpoint mapping are missing. SV-2 to SV-7 are unchanged. The screenshots were not available to the documentation task, so the evidence is user-supplied and not independently verified. Evidence has to come from the person viewing the provider and repository settings (tracker §10).

### 3.2 IA-01 completion criteria (stays `IN PROGRESS`)
| Criterion (tracker §9) | State |
|---|---|
| minimum sheet rows filled and dated by the people themselves | **not met**: names are entered, but the "Date decided" cells are blank except the Incident Owner row |
| approval-record names set by them | partly: names entered as `USER-SELECTED`; dates `NOT SET`; decisions `NOT APPROVED` |
| I-8 answered | met (`USER-CONFIRMED`, unverified) |
| combined-role arrangement recorded in advance naming exact actions | met (read-only evidence only) |
| no role inferred | met |

### 3.3 Dated role entries that are still incomplete (read from the records, 2026-10-04)
- **Decision sheet §1.1, "Date decided":** only the Incident Owner row is dated (2026-10-04). The eight other selected rows have a name but **no date**: Neon database administrator; GitHub/repository owner; database owner / credential-change approver; revocation approver; Neon account/project owner (console access grantor); hosting platform owner; Vercel account administrator; application infrastructure administrator. Twelve roles remain unnamed (deployment owner, application owner, developer machine owners, provider-setting approver, and the Typesense, Redis, storage, OAuth, email, payment, payment/webhook and domain/DNS owners). Contact-channel cells are blank on every row.
- **Decision sheet §1.1a:** "Authority verified (SV-5)" is blank.
- **Decision sheet §1.2:** the person performing the Neon console review, the person preserving logs, the authorization start and end times, and the scope-record location are blank; the authorization status is `NOT AUTHORIZED`.
- **Decision sheet §1.3, §1.4, §1.4a, §1.5:** the change window, hosting and secret-store decisions, the Vercel decisions and the working-posture decisions are all blank.
- **Approval record §13:** every row's Date is `NOT SET` and every Decision is `NOT APPROVED`; five rows carry the name as `USER-SELECTED — PENDING VERIFICATION`.
- **Not satisfied by any of this:** dating an entry is a record of when the user stated it. It is not verification of authority, and it approves nothing. No date is entered by the documentation task on the user's behalf; the user dates their own entries.

### 3.4 Evidence checklist for SV-1, SV-5 and SV-7
The authorized owner views these in their own sessions. Nothing here is collected automatically, and nothing is recorded as verified until the evidence exists; then the entry in tracker §10 and decision sheet §1.1a gets a date, the viewer's name, and a private evidence reference (a title and location, never content). **Access to a console, a Git identity, a role title and the I-8 answer are not evidence of authority.** Exact page names differ by provider; use the members, roles, branches and billing views the console offers.

| SV | What to look at | Where the owner obtains it | What counts as evidence (no secrets) | What it does not prove |
|---|---|---|---|---|
| SV-1 Administrative access to the correct Neon project and database | the organization and project that hold the application database; the account's role in that organization and in the project; the branch list (default flag, creation dates) with each branch's endpoint identifiers; the database name on the intended branch | the Neon console, signed in by the user themselves: organization or project members and roles, project settings, branches, databases | a redacted note or screenshot showing the account and its role (owner or admin), the project name or ID, and which branch each endpoint belongs to, identified by the console and not by a URL alone; dated, with the viewer's name | authority to approve credential changes (SV-5); that the credential is valid |
| SV-5 Authority to approve credential replacement and revocation | who is the organization's owner and billing holder; whether anyone else owns the data or the account (a client, employer or co-founder); who is entitled to decide on credential changes and incident notification | the Neon organization's billing and owner settings; company, client or contract documents; a written statement from every account holder or data owner that names the person who may approve credential changes and revocation | a dated written statement (kept privately) from the account holder or data owner, or evidence that the user is the sole holder, plus the approval record §13 rows completed and dated by the people themselves | formal authority is not proven by the I-8 answer, the role selection, or console access |
| SV-7 Ability to grant Neon console access | whether the account can manage project members; who has access now and with which role | the Neon console members or invitations view, viewed only (no invitation sent, no access changed) | a redacted view showing the member-management controls available to the account and the current member list with roles; dated | permission to grant access to anyone: granting is a provider-setting change under a separate G-1 authorization |
Order that makes sense: SV-1 and SV-7 first (viewing), then SV-5 (authority), then SV-6 (the written review authorization in decision sheet §1.2), then SV-2, SV-3 and SV-4. IA-01 stays `IN PROGRESS` until every documented criterion is met, which requires dated entries by the people themselves and the verification of authority.

## 4. Credential remediation matrix
**No credential has been confirmed live**: local env files show configuration, not current validity or deployed use. Order of work: database credential, then JWT secrets, then others only if live use or exposure is found. Detailed steps, validation and rollback are in `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` (§3 per credential, §4 database steps, §8 validation matrix); this table adds the live-usage status and the owner and approver as currently recorded. Rollback is always forward: **never restore an exposed credential**.

| Priority | CR | Credential | Live usage verified? | Depends on it (known / unverified) | Owner and required approver (current record) | Replacement and update sequence | Approval before revocation |
|---|---|---|---|---|---|---|---|
| 1 | CR-1 | Neon owner-role database credential | **No** (validity, branch identity, role privileges and deployed use unknown) | Orion API, gateway, migration/audit tooling, local env files, seven scratch scripts; Vercel and any other host unverified | Executor: Subash A. V. as Neon administrator; approver: Subash A. V. as credential-change approver; separate revocation approver: Subash A. V.; all `USER-SELECTED — PENDING VERIFICATION`; no approval | staged least-privilege role, consumers moved one at a time (plan §4 N-0 to N-11); owner credential sealed afterwards | separate G-1 revocation approval after R1 to R10, all consumer sign-offs and the refusal-check plan; **NOT APPROVED** |
| 1 | CR-2 | Staging endpoint credential (second Neon endpoint used 2026-10-02) | **No** (role shown as `neondb_owner` in a user-supplied masked connection string, tracker §10.1; password inheritance and validity unknown) | staging suite only | same persons; any branch reset or deletion is a separate G-1 action | after CR-1; deletion separately authorized | not applicable until CR-1 is revoked |
| 2 | CR-3, CR-4 | JWT access and refresh secrets (committed in `docker-compose.yml`) | **No** (production use unknown; local development files use the committed values) | API and gateway, which must hold the same pair; reset links, admin OTP cookies and OAuth state derive from the access secret | application owner and deployment owner: `UNASSIGNED` (not selected); Subash A. V. holds Vercel and infrastructure roles only | with the hosting move; hard cutover, every user signs in again (plan CR-3) | G-6: **NOT APPROVED** |
| 3 | CR-5 | Typesense development key (public default in the repository) | **No** (any deployed instance unverified; local search provider is PostgreSQL) | search only if the provider is Typesense | Typesense administrator `UNASSIGNED` | replace only if a deployed instance uses it | G-7: **NOT APPROVED** |
| 4 | CR-6 to CR-11 | Redis, storage keys, OAuth secrets, email key, payment keys and webhook secret | **No**; none found in tracked files or history | API and gateway; providers unidentified | owners `UNASSIGNED` | fresh values at the hosting move; sooner only on evidence of exposure | each owner's own approval; **NOT APPROVED** |
| 5 | CR-12, CR-13 | Vercel local tokens; seed administrator password | local Vercel tokens already expired; seed use unknown | Vercel CLI; first administrator account | Subash A. V. (Vercel administrator) `USER-SELECTED`; application owner `UNASSIGNED` | local cleanup under its own approval; review administrator accounts after CR-1 | none to revoke / owner decision |

### 4.1 Database and staging credentials: what is known (values never shown)
Affected credentials: **CR-1**, the Neon owner-role credential (role `neondb_owner`, the pooled endpoint the applications use, database `neondb`), and **CR-2**, the credential of the second Neon endpoint used for the staging run on 2026-10-02 (its role is not recorded). **Confirmed live usage: none.** Every row below is configuration evidence only (a local file or code that reads an environment variable), or unverified.

| Consumer (approval record §5) | Evidence that it depends on the credential | Live usage | Update step (cutover §4.2) | Executor / authorizer (current record) |
|---|---|---|---|---|
| K-1 `apps/api/.env`, K-2 `ownus/.env.local` | local files hold it (configuration only) | not applicable (local) | step 10 | the file's owner; G-3 |
| K-3 seven scratch scripts, K-4 Git history | the literal is embedded | n/a | G-4 untracking, G-8 decision | repository administrator `USER-SELECTED`; separate approvals |
| K-5 Orion API (deployed), K-6 gateway database access | code reads `DATABASE_URL` | **unverified** (what the deployed value is) | steps 8 and 9 | deployment owner `UNASSIGNED`; Vercel and infrastructure roles `USER-SELECTED`; G-2 |
| K-7, K-8 Vercel production, preview, development | variable names existed in a 2026-09-17 snapshot with empty values | **unverified** | steps 8 and 9 | Vercel administrator `USER-SELECTED`; G-2 |
| K-9 migration, seed, audit tooling | code reads `DATABASE_URL` | n/a (runs only when someone runs it) | step 10 | operator `UNASSIGNED` |
| K-10 Phase A2 operator | record §6 allows only "existing permissions" | none run | IA-25 decision | `USER-SELECTED` authorizer; not authorized |
| K-11, K-12 staging tooling and the second endpoint's branch | log of a staging run on 2026-10-02; branch `orion-migration-rehearsal` with parent `production` is user-supplied (tracker §10.1), mapping and inheritance unverified | the run happened; current validity **unknown** | step 12 and CR-2 | Neon administrator `USER-SELECTED`; each branch reset or deletion a separate G-1 action |
| K-15 other hosts, jobs, CI; K-18 other clones; K-19 `neon_service` | none known | **unverified** | after the inventory (IA-14 to IA-16) | `UNASSIGNED` |

### 4.2 Ordered cutover checklist (consolidates the existing plan steps N-0 to N-11 and approval record §7; nothing executed)
Authorizer approves; executor performs; **an executor never self-authorizes** (approval record §13.1). The recorded combined-role arrangement covers read-only evidence only, so every change step below needs its own dated written authorization naming the exact action, and any self-authorization for it recorded in advance. Currently: credential-change approver and revocation approver are both `USER-SELECTED — PENDING VERIFICATION`, with no approval.

| Step | Action | Authorizer, executor | Gate | Validation | Rollback or abort |
|---|---|---|---|---|---|
| 1 | preserve provider, deployment and repository logs (IA-05) | incident owner; log preserver `UNASSIGNED` | none | dated confirmation, retention and oldest date recorded | n/a |
| 2 | verify authority (SV-1, SV-5, SV-7, SV-6) and complete dated entries (IA-01) | the user | none | evidence recorded per §3.4 | n/a |
| 3 | read-only Neon review: branch identity, role attributes (console-visible only), consumers, backup, replacement process (IA-06 to IA-11) | review authorizer; Neon administrator | none (read-only; arrangement scope) | answers recorded or `CANNOT DETERMINE`; no SQL, no credential test | n/a |
| 4 | decide A, B or C (target report §7) and the Phase A2 connection question (IA-25); window, thresholds, observation period (OD-6) | incident owner | none | decisions recorded | n/a |
| 5 | review the least-privilege role outline with the application owner (`UNASSIGNED`) | credential-change approver; Neon administrator | none | R5 and R6 evidence accepted | n/a |
| 6 | rehearse the grants on an isolated branch (a database-writing test, so separately authorized) | credential-change approver; Neon administrator | G-1 for any provider change | staging suite passes with the non-owner role | delete or reset the branch (separate authorization) |
| 7 | create the replacement application role (and migrator role if chosen) | credential-change approver; Neon administrator | **G-1** | role list matches the approved outline | forward fix; never re-enable the exposed credential |
| 8 | put the new secret in the first consumer's secret store; restart; validate | deployment owner `UNASSIGNED`; executor | **G-2** | health route's database component up (not liveness); one authenticated read with the approved account; no auth errors | correct the consumer to the new credential |
| 9 | repeat per consumer in the agreed order; gateway and API together if they must agree | same | **G-2** per deployment | as step 8 per consumer | as step 8 |
| 10 | update `apps/api/.env`, `ownus/.env.local` (or switch to a local database) | each file's owner | **G-3** | local app starts; no scratch scripts run | restore a working new credential |
| 11 | provider view: connections by role; any application session on the owner credential is a missed consumer; observation period; consumer sign-offs | Neon administrator; consumer owners | none | none remain except break-glass; written sign-offs | extend the window |
| 12 | handle the staging endpoint's branch and any branch that inherited the credential | credential-change approver (each action separately); Neon administrator | **G-1** per action | branch list | n/a |
| 13 | **separate revocation authorization**, then change the owner credential and seal it; controlled refusal check on pooled and direct endpoints | revocation approver; Neon administrator | **G-1 (revoke)** | exposed credential refused; consumers healthy | repair forward on the new credential; restore from backup under a separate approved change |
| 14 | evidence retention; update documents; then untrack the scripts and add ignore rules in a clean checkout | repository administrator | G-4, G-5, G-9 | per-path review and a fresh scan | revert the commit (only after revocation) |
Confirmed live usage is required at no step to be *assumed*; steps 3 and 11 are where it is actually established.

### 4.3 JWT secrets and the Typesense default: verification requirements (items stay pending)
| Item | What must be verified first | Where and by whom | Approvers and executors (current record) | Session impact | Post-change validation |
|---|---|---|---|---|---|
| JWT access and refresh secrets (CR-3, CR-4) | which deployments (Vercel production, preview, development; any other host; the compose file) run the API and gateway; whether the pair deployed is the committed one, established only through an owner-approved procedure that does not print or compare values; whether the API and gateway hold the same pair; production user and session volume | deployment inventory (IA-14 to IA-16) by the Vercel administrator and infrastructure owner, `USER-SELECTED`; usage question DP-3 `UNANSWERED` | G-6 approvers: application owner and deployment owner, both `UNASSIGNED`; execution at the hosting move | hard cutover, no old-and-new key support: every access token (API 15 min, gateway 24 h) and refresh token (7 d) stops working, password-reset links and admin OTP cookies stop working, in-flight OAuth state (15 min) fails; users sign in again | with an approved existing test account: pre-change tokens return 401, a fresh sign-in works, the API and gateway accept each other's tokens, no auth errors in logs |
| Typesense development default (CR-5) | whether `SEARCH_PROVIDER` is `typesense` in any deployed environment and whether a server uses the default key; the local value is `postgres` | deployment inventory; Typesense administrator `UNASSIGNED` | G-7: Typesense administrator `UNASSIGNED` | none while PostgreSQL search is used; a brief search interruption otherwise | search succeeds with a restricted key, administrative actions are refused, the old default is refused |
Both stay `NOT APPROVED` and unverified until usage and authorization are established. Both literals remain in Git history regardless of any later file change.

## 5. Git history: redacted findings and remediation plan
### 5.1 What is reachable from the recorded remote (no network contact)
| Category | Revisions | First, last | Reachable from `origin/main` | Reachable from local `main` | In `origin/fix/vercel-build` | Files |
|---|---|---|---|---|---|---|
| Exposed database credential | 23 | `1cdf261` (2026-09-21), `72521a2` (2026-09-25) | 23 | 21 (two exist only on the remote-tracking ref: `3f1ffd2`, `72521a2`) | 0 | seven `ownus/scratch_*.js`, still at the tip of `main` and `origin/main` |
| JWT access and refresh secrets | 45 each | `8dda755` (2026-09-18), `72521a2` | 45 | 43 | 0 | `docker-compose.yml`, still at the tip |
| Typesense development default (public, not a live secret by itself) | 80 | `be1ae3e` (2026-09-11), `72521a2` | 80 | 78 | 3 | six tracked files, still at the tip |
No private-key header, GitHub, AWS, Slack or JWT-shaped token was found. The Redis, storage, Google and Resend values and the Vercel tokens were not found in tracked files, history or scanned untracked files. Two placeholder-like literals need owner review: a hard-coded demo key in `ownus/src/app/(app)/settings/page.tsx` (all 80 revisions) and a fake Razorpay-shaped fixture in an untracked test file. 20 of the 23 credential commits were authored under one identity and 3 under the other, so the second contributor's clone also holds them (GH-4). **Deleting a file from the latest revision removes nothing from these commits.** The two remote-only commits mean a real rewrite would first need a fetch (external contact, separately authorized).

### 5.2 Publication consequences
Pushing the current branch adds no new commits, but the credentials are already reachable in remote history; any new commit on this history carries them. The database credential and JWT secrets are therefore treated as exposed until replaced and revoked. A history rewrite is **not** a substitute for rotation and cannot recall copies others hold.

### 5.3 Remediation plan (nothing executed; rewrite stays blocked)
| Step | Prerequisite | Approval | State |
|---|---|---|---|
| 1. replace and revoke CR-1; rotate JWT with the hosting move | SV evidence, R1 to R10, window, validation method | G-1 (create, then revoke separately), G-2, G-3, G-6 | `BLOCKED` |
| 2. assess repository visibility, collaborators, forks, pull-request refs, push events | read-only GitHub review (IA-12, IA-13) | none (read-only; needs SV-2) | `PENDING VERIFICATION` |
| 3. untrack the seven scripts and add ignore rules in a clean checkout of `origin/main`, by explicit paths | step 1 begun; OD-8, OD-9 | G-4, G-5, then G-9 per push | `BLOCKED` |
| 4. decide on a rewrite | steps 1 and 2 complete; GH-1 to GH-8 answered; the second contributor's clones known | written decision, G-8 and G-9 | `BLOCKED` |
| 5. if chosen: mirror backup; rewrite a fresh clone dropping the seven scripts and scrubbing the compose secret lines; force-with-lease to named branches; everyone re-clones; People-import and other uncommitted work committed or branched by their owners first | step 4; coordination window | G-8, G-9 | `BLOCKED` |
| 6. verify: redacted scan of every reachable ref; old commit IDs unreachable; fresh-clone build | step 5 | none | not started |
Rebase, amend, force-push and any contact with the remote are not performed here.

## 6. Release scope (classification by path name only; People paths counted, never listed)
| Category | Modified | Untracked | Proposed handling |
|---|---|---|---|
| A. Concurrent People-import work | 0 by name | 151 files (paths containing "people") | **owners' review and own scan before any commit**; not inspected here. Other uncommitted files may also belong to that work: authorship `REQUIRES TEAM CONFIRMATION` |
| B. Incident-response and production-evidence documents (19 files: the 15 `CREDENTIAL_*` files including this plan, `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md`, `PHASE_A2_APPROVAL_READINESS.md`, `phase-a2/PHASE_A2_CHECKLIST.md`, `phase-a2/PHASE_A2_READONLY_EVIDENCE_CHECKS.sql`) | 0 | 19 | **private; do not publish** without explicit review |
| C. Other operations and security documents: `DATABASE_OWNERSHIP_MATRIX`, `FILE_KEY_MIGRATION_PROPOSAL`, `MIGRATION_REHEARSAL_PLAN`, `MIGRATION_RUNBOOK`, `ORION_INTEGRATION_READINESS_REPORT`, `PIPELINE_RUNTIME_RISK_REGISTER`, `PRODUCTION_CHANGE_REQUEST_TEMPLATE`, `PRODUCTION_EVIDENCE_REPORT_TEMPLATE`, `PRODUCTION_READINESS`, `TARGET_ARCHITECTURE`, `GATEWAY_SECURITY` | 0 | 11 | private by default; publish only after a sanitizing review |
| D. Required migrations and schema snapshots | 2 (`0003_seed_packages.sql`, `_journal.json`) | 15 (`0017` SQL and snapshots `0004` to `0017`) | publication candidates; Drizzle needs the journal and snapshots; owner review |
| E. Secret-default or test-secret files: `apps/api/src/config/secrets.ts`, `apps/api/test/helpers/test-secrets.ts`, `apps/api/test/setup-env.ts`, `apps/api/test/setup-staging-env.ts` | 0 | 4 | review before publishing: they hold development-only and fake test values, including the public Typesense default already in history |
| F. Generated media, audit outputs, local tooling, binaries (`brag-output/`, `showreel/`, `showreel2/` about 62 MB; `apps/api/before.json`, `before.clean.json`, `after.json`; `.claude/`; `apps/api/test/fixtures/pipeline-split-bundle.zip`) | 0 | 118 | **do not publish** (the zip fixture's owner to confirm) |
| G. Dependency manifests: `apps/api/package.json`, `package-lock.json` | 2 | 0 | review the dependency changes first |
| H. Candidate application tests | 6 | 20 | candidates after owner review (listed paths in the audit; includes the fake Razorpay-shaped fixture) |
| I. Candidate application source and configuration (`apps/api/src`, `ownus/src`) | 48 | 22 | candidates after per-path owner review |
| J. Tracked scratch and credential-bearing scripts (34 files; the seven credentialed `ownus/scratch_*.js`) | not modified | n/a | **do not publish**; untrack under G-4 |
| Unclassified | `docs/ORION_IMPORT_TEMPLATE.csv` | `docs/DECISION_MAKER_INTELLIGENCE.md` | owner decision; the latter likely belongs to the People work (`REQUIRES TEAM CONFIRMATION`) |

### 6.1 Proposed publication scope (a proposal; nothing staged or committed)
- **Candidates, subject to per-path owner review and a fresh redacted scan of each commit:** categories D, H and I (non-People), in small reviewed commits made in a clean checkout of `origin/main`, naming explicit paths. Authorship of the broader uncommitted baseline is not established, so none of it is assumed to belong to one change.
- **Held back:** A (owners), B, C, E until reviewed, F, G until the dependency review, J, and every file the owners have not reviewed.
- **Not in scope at all:** credentials, env files, provider tokens, audit outputs.
- The per-file list must be frozen only at review time, because the working tree is still changing; regenerate it with read-only commands (`git status --porcelain`, `git ls-files --others --exclude-standard`) and re-scan each commit.

### 6.2 Proposed `.gitignore` additions (not applied; needs approval, G-5)
```
# environment files that may hold real values (examples such as .env.production.example stay tracked)
.env.production
.env.staging
.env.development
**/.env.production
**/.env.staging
**/.env.development
# key and credential material
*.pem
*.key
*.p12
*.pfx
secrets.json
# database dumps (not migrations)
dump*.sql
backup*.sql
*.dump
# audit outputs and local tooling
apps/api/before.json
apps/api/before.clean.json
apps/api/after.json
apps/api/*-result.txt
.claude/
# generated media (owner decision)
brag-output/
showreel/
showreel2/
# credential-bearing scratch scripts (after they are untracked, G-4)
ownus/scratch_*.js
```
Already covered: `.env`, `.env.local` and variants, `.vercel`, `*.log`, `dist`, `.next`, `node_modules`, `coverage`, test reports. `.gitignore` does not untrack committed files. Do not ignore `*.sql` broadly (it would hide the migrations) or the Drizzle snapshots.

## 7. Checks (2026-10-04)
| Check | Result |
|---|---|
| Secret scan over 80 revisions, HEAD, `origin/main`, modified files (58 of 59) and untracked files (129 of 360; People paths, binaries and assets skipped) | known exposure confirmed as in section 5.1; nothing new; People-import files **not scanned** (owners must) |
| `tsc --noEmit` (`apps/api`, `ownus`) | passed, 0 errors each (includes uncommitted work); nothing written |
| ESLint without `--fix` | `apps/api`: 329 files, 0 errors, 0 warnings. `ownus`: 357 errors and 450 warnings in 70 non-People files (mostly `no-explicit-any`, `no-require-imports`, hook rules); no People-path findings; existing lint debt, no files changed |
| Jest suites | **skipped**: 35 of 59 specs reference database URLs or drivers; the `ownus` test glob includes the concurrent People tests |
| `next build` / `nest build` | **skipped**: a build can execute server code with real local env values; the Nest build writes output |
| `db:audit`, `db:rehearsal`, staging tests | **skipped**: they connect to databases |
| `apps/api` `npm run lint` | **skipped** as written: it passes `--fix` |
Safe next checks once the owners review: lib tests that do not read the environment, run per file, not the People tests.

### 7.1 Checks to repeat, and why none of the results is security clearance
| When | Check | Why |
|---|---|---|
| after any credential or history change | the full redacted secret scan over every reachable revision, HEAD, `origin/main` and the working tree | the known exposure should disappear from remediated refs; passing does not prove other secrets are absent |
| before each commit | a scan of the staged diff only, plus `git diff --cached --name-only` against the approved path list | prevents an unreviewed or sensitive file entering a commit |
| before each push | type checks (`tsc --noEmit` for `apps/api` and `ownus`) and ESLint without `--fix`; a comparison with the recorded `ownus` baseline (357 errors, 450 warnings, existing lint debt) so no new findings appear | type checks and lint are quality signals, not security evidence |
| after owner review | lib tests that do not read the environment, run per file | the broad suites touch database drivers or include the concurrent People tests |
| only with authorization | the staging suite, builds and `db:*` tooling, on an isolated branch and a build without real secrets | they connect to databases or execute server code |
| People-import files | each owner's own scan and review | excluded here; their absence from these scans is a gap |
The `ownus` lint debt and the skipped suites are recorded as open items, not as clearance.

## 8. Exact next actions and approvals
| # | Action | Owner (current record) | Approval or gate | State |
|---|---|---|---|---|
| 1 | complete the dated role entries and collect SV-5, SV-1, SV-7 evidence (IA-01) | Subash A. V. | none | `IN PROGRESS` |
| 2 | record the read-only review authorization (decision sheet §1.2) after SV-5 and SV-6 | Subash A. V. as authorizer | none (read-only) but needs verified authority | `NOT AUTHORIZED` |
| 3 | decide the Phase A2 connection question (IA-25 / I-11) | Subash A. V. | Phase A2 record, `DRAFT — NOT APPROVED` | open; no SQL authorized |
| 4 | read-only evidence: Neon (IA-06 to IA-10), GitHub (IA-12, IA-13), Vercel and infrastructure (IA-14 to IA-16) | Subash A. V. | none for viewing; arrangement scope applies | `UNANSWERED` |
| 5 | decide OD-4, OD-8, OD-11, OD-14 (hosting; clean checkout; Vercel integration before any push; project fate) | Subash A. V. | none | `UNANSWERED` |
| 6 | credential replacement, then separately revocation | Subash A. V. (selected) | **G-1**, G-2, G-3; revocation a separate approval | `NOT APPROVED` |
| 7 | JWT rotation with the hosting move | application and deployment owners `UNASSIGNED` | **G-6** | `NOT APPROVED` |
| 8 | untrack the seven scripts; `.gitignore` additions | Subash A. V. (repository administrator, selected) | **G-4**, **G-5** | `NOT APPROVED` |
| 9 | People-import and other concurrent work reviewed, scanned and committed separately by their owners | team (`REQUIRES TEAM CONFIRMATION`) | their own review | not started |
| 10 | per-path publication review, fresh scan per commit, then push | repository owner | **G-9** per push (plus G-8 only if a rewrite is chosen) | `BLOCKED` |

## 9. Conditions for `READY TO PUSH` (none met)
Exposed credentials replaced and revoked with verification (G-1); JWT secrets replaced (G-6); repository visibility and access assessed (IA-12); history decision recorded and, if chosen, executed and verified (G-8); incident documents and other private categories excluded; every file in the push scope owner-reviewed and re-scanned, People-import files scanned by their owners; `.gitignore` gaps closed (G-5); Vercel auto-deploy status known and the integration decision made (OD-11); required checks passed; explicit push approval recorded (G-9). A clean working tree, passing type checks or consistent documentation does not satisfy any of these.

## Appendix A. Precise proposed publication list (snapshot 2026-10-04; nothing staged)
Generated from `git diff --name-only` and `git ls-files --others --exclude-standard` by path name only. The working tree is still changing; **re-generate and re-review at commit time**. People-import paths are excluded and never listed. Being listed here does **not** mean approved: every path needs per-path owner review and a fresh redacted scan, in small commits made in a clean checkout of `origin/main`, naming explicit paths (never a bulk add).

### A.1 Candidates for eventual publication (after review)
**Application source and configuration** (70: 48 modified tracked, 22 new untracked)
```
# modified (tracked)
apps/api/src/app.module.ts
apps/api/src/auth/admin-auth.controller.ts
apps/api/src/auth/guards/roles.guard.ts
apps/api/src/auth/strategies/jwt-refresh.strategy.ts
apps/api/src/auth/strategies/jwt.strategy.ts
apps/api/src/common/filters/all-exceptions.filter.ts
apps/api/src/config/env.validation.ts
apps/api/src/config/index.ts
apps/api/src/database/database.service.ts
apps/api/src/database/migrate.ts
apps/api/src/database/schema/engagement.ts
apps/api/src/database/schema/enums.ts
apps/api/src/database/schema/imports.ts
apps/api/src/database/schema/index.ts
apps/api/src/database/seed.ts
apps/api/src/main.ts
apps/api/src/modules/credit/credit.repository.ts
apps/api/src/modules/credit/credit.scheduler.ts
apps/api/src/modules/credit/credit.service.ts
apps/api/src/modules/discover/discover.module.ts
apps/api/src/modules/discover/discover.service.ts
apps/api/src/modules/discover/dto/discover.dto.ts
apps/api/src/modules/import/import.module.ts
apps/api/src/modules/import/repositories/duplicate-review.repositories.ts
apps/api/src/modules/import/repositories/import.repositories.ts
apps/api/src/modules/import/services/admin-import.service.ts
apps/api/src/modules/import/services/import-pipeline.service.ts
apps/api/src/modules/import/services/publishing.service.ts
apps/api/src/modules/oauth/services/oauth-state.service.ts
apps/api/src/modules/payment/payment.controller.ts
apps/api/src/modules/payment/payment.service.ts
apps/api/src/modules/payment/razorpay.service.ts
apps/api/src/modules/queue/queue.constants.ts
apps/api/src/modules/saved-leads/dto/saved-leads.dto.ts
apps/api/src/modules/saved-leads/saved-leads.repository.ts
apps/api/src/modules/saved-leads/saved-leads.service.ts
apps/api/src/modules/typesense/typesense.provider.ts
apps/api/src/modules/unlock/unlock.service.ts
ownus/src/app/(app)/credits/page.tsx
ownus/src/app/(app)/discover/[id]/page.tsx
ownus/src/app/(app)/discover/page.tsx
ownus/src/app/admin/monarch/page.tsx
ownus/src/app/api/v1/[...path]/route.ts
ownus/src/components/admin/admin-header.tsx
ownus/src/components/admin/admin-sidebar.tsx
ownus/src/components/discover/business-drawer.tsx
ownus/src/lib/api-client.ts
ownus/src/types/admin.ts
```
```
# new (untracked)
apps/api/src/common/http/upload-body-limit.ts
apps/api/src/database/audit-migrations.ts
apps/api/src/database/migration-audit.ts
apps/api/src/database/migration-target.ts
apps/api/src/database/rehearsal-checks.ts
apps/api/src/database/rehearsal-cli.ts
apps/api/src/database/staging-guard.ts
apps/api/src/modules/business/company-resolution/company-matching.ts
apps/api/src/modules/business/company-resolution/company-resolution.module.ts
apps/api/src/modules/business/company-resolution/company-resolution.types.ts
apps/api/src/modules/business/company-resolution/company-resolver.service.ts
apps/api/src/modules/import/controllers/import-operations.controller.ts
apps/api/src/modules/import/dto/import-operations.dto.ts
apps/api/src/modules/import/services/import-operations.service.ts
apps/api/src/modules/import/services/upload-validation.ts
ownus/src/components/admin/views/data-quality-metrics-view.tsx
ownus/src/components/admin/views/upload-operations-view.tsx
ownus/src/lib/admin-account.ts
ownus/src/lib/admin-role.ts
ownus/src/lib/gateway-auth.ts
ownus/src/lib/password.ts
ownus/src/lib/unlock-business.ts
```

**Tests** (26: 6 modified tracked, 20 new untracked)
```
# modified (tracked)
apps/api/test/admin-auth.e2e-spec.ts
apps/api/test/admin-import-pipeline.e2e-spec.ts
apps/api/test/credit-wallet.e2e-spec.ts
apps/api/test/helpers/test-app.helper.ts
apps/api/test/jest-e2e.json
apps/api/test/security-hardening.e2e-spec.ts
```
```
# new (untracked)
apps/api/src/config/__tests__/config-hardening.spec.ts
apps/api/src/database/__tests__/migration-audit.spec.ts
apps/api/src/database/__tests__/migration-rehearsal.spec.ts
apps/api/src/database/__tests__/migrations-fresh-db.spec.ts
apps/api/src/database/__tests__/staging-guard.spec.ts
apps/api/src/modules/business/company-resolution/__tests__/company-resolution.integration.spec.ts
apps/api/src/modules/credit/__tests__/credit-scheduler-lifecycle.spec.ts
apps/api/src/modules/discover/__tests__/discover-hardening.integration.spec.ts
apps/api/src/modules/import/__tests__/import-module-wiring.spec.ts
apps/api/src/modules/import/__tests__/import-operations.integration.spec.ts
apps/api/src/modules/import/__tests__/import-template.spec.ts
apps/api/src/modules/payment/__tests__/payment-hardening.integration.spec.ts
apps/api/src/modules/payment/__tests__/payment-webhook-rawbody.integration.spec.ts
apps/api/test/admin-authorization.e2e-spec.ts
apps/api/test/helpers/pglite-db.ts
apps/api/test/jest-staging.json
ownus/src/lib/__tests__/admin-role.test.ts
ownus/src/lib/__tests__/gateway-auth.test.ts
ownus/src/lib/__tests__/password.test.ts
ownus/src/lib/__tests__/unlock-business.test.ts
```

**Required migrations and schema snapshots (Drizzle needs the journal and snapshots)** (17: 2 modified tracked, 15 new untracked)
```
# modified (tracked)
apps/api/src/database/migrations/0003_seed_packages.sql
apps/api/src/database/migrations/meta/_journal.json
```
```
# new (untracked)
apps/api/src/database/migrations/0017_queue_jobs_admin_otps.sql
apps/api/src/database/migrations/meta/0004_snapshot.json
apps/api/src/database/migrations/meta/0005_snapshot.json
apps/api/src/database/migrations/meta/0006_snapshot.json
apps/api/src/database/migrations/meta/0007_snapshot.json
apps/api/src/database/migrations/meta/0008_snapshot.json
apps/api/src/database/migrations/meta/0009_snapshot.json
apps/api/src/database/migrations/meta/0010_snapshot.json
apps/api/src/database/migrations/meta/0011_snapshot.json
apps/api/src/database/migrations/meta/0012_snapshot.json
apps/api/src/database/migrations/meta/0013_snapshot.json
apps/api/src/database/migrations/meta/0014_snapshot.json
apps/api/src/database/migrations/meta/0015_snapshot.json
apps/api/src/database/migrations/meta/0016_snapshot.json
apps/api/src/database/migrations/meta/0017_snapshot.json
```

### A.2 Candidates only after a specific review
**Secret-default and test-secret files (development-only and fake values; the Typesense default is already public in history)** (4: 0 modified tracked, 4 new untracked)
```
# new (untracked)
apps/api/src/config/secrets.ts
apps/api/test/helpers/test-secrets.ts
apps/api/test/setup-env.ts
apps/api/test/setup-staging-env.ts
```

**Dependency manifests (review the dependency changes first)** (2: 2 modified tracked, 0 new untracked)
```
# modified (tracked)
apps/api/package.json
package-lock.json
```

**Tracked environment examples** (placeholders only; review before any publication): `.env.production.example`, `apps/api/.env.example`.

### A.3 Do not publish
**Sensitive incident-response and production-evidence documents (private)** (19: 0 modified tracked, 19 new untracked)
```
# new (untracked)
docs/CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md
docs/CREDENTIAL_ADMIN_RESPONSE_TRACKER.md
docs/CREDENTIAL_ASSESSMENT_CORRECTIONS.md
docs/CREDENTIAL_EXECUTION_READINESS_REVIEW.md
docs/CREDENTIAL_EXPOSURE_ASSESSMENT.md
docs/CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md
docs/CREDENTIAL_INCIDENT_OWNER_ACTION_TRACKER.md
docs/CREDENTIAL_OWNER_COORDINATION_PACKAGE.md
docs/CREDENTIAL_OWNER_COORDINATION_PLAN.md
docs/CREDENTIAL_OWNER_DECISION_SHEET.md
docs/CREDENTIAL_RELEASE_READINESS_PLAN.md
docs/CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md
docs/CREDENTIAL_REPOSITORY_CLEANUP_PROPOSAL.md
docs/CREDENTIAL_ROTATION_EXECUTION_PLAN.md
docs/CREDENTIAL_TARGET_VERIFICATION_REPORT.md
docs/DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md
docs/PHASE_A2_APPROVAL_READINESS.md
docs/phase-a2/PHASE_A2_CHECKLIST.md
docs/phase-a2/PHASE_A2_READONLY_EVIDENCE_CHECKS.sql
```

**Other operations and security documents (private until sanitized)** (11: 0 modified tracked, 11 new untracked)
```
# new (untracked)
docs/DATABASE_OWNERSHIP_MATRIX.md
docs/FILE_KEY_MIGRATION_PROPOSAL.md
docs/GATEWAY_SECURITY.md
docs/MIGRATION_REHEARSAL_PLAN.md
docs/MIGRATION_RUNBOOK.md
docs/ORION_INTEGRATION_READINESS_REPORT.md
docs/PIPELINE_RUNTIME_RISK_REGISTER.md
docs/PRODUCTION_CHANGE_REQUEST_TEMPLATE.md
docs/PRODUCTION_EVIDENCE_REPORT_TEMPLATE.md
docs/PRODUCTION_READINESS.md
docs/TARGET_ARCHITECTURE.md
```

**Local environment files** (ignored, never publish): `.env.local`, `apps/api/.env`, `ownus/.env.local`, `.vercel/`.

**Tracked scratch and credential-bearing scripts (34):** the seven credentialed scripts (to be untracked under G-4): `ownus/scratch_inspect_tables.js`, `ownus/scratch_master_e2e_verification.js`, `ownus/scratch_test_app_preferences_persistence.js`, `ownus/scratch_test_db.js`, `ownus/scratch_test_notifications_integration.js`, `ownus/scratch_test_profile_persistence.js`, `ownus/scratch_test_single_device_login.js`; the remaining tracked scratch files are `ownus/scratch_test_filter_queries.js` (environment-only), 16 files in `scratch/` and 10 in `ownus/scratch/` (each to be decided individually).

**Generated media, audit outputs, local tooling and binaries (118 files):** `.claude/` (1), `apps/api/after.json` (1), `apps/api/before.clean.json` (1), `apps/api/before.json` (1), `apps/api/test/fixtures/pipeline-split-bundle.zip` (1), `brag-output/` (24), `showreel/` (20), `showreel2/` (69). The zip fixture's owner must confirm what it is.

### A.4 Unrelated or unclassified work (owner decision)
**Documents outside the incident and operations sets (the `.md` file likely belongs to the People layer: `REQUIRES TEAM CONFIRMATION`)** (2: 1 modified tracked, 1 new untracked)
```
# modified (tracked)
docs/ORION_IMPORT_TEMPLATE.csv
```
```
# new (untracked)
docs/DECISION_MAKER_INTELLIGENCE.md
```

### A.5 Concurrent People-import work
151 files whose paths contain "people" (modified or untracked) are **not listed, inspected, scanned, staged or moved**. Their owners must review and scan them and decide their own commits. Other uncommitted files above may also belong to that work; authorship of the broader uncommitted baseline is not established (`REQUIRES TEAM CONFIRMATION`).

## Completion statement
Planning and read-only audit only. No database or provider was contacted; no credential was tested, rotated, revoked or printed; no SQL, migration, seed or data write ran; no permission, provider setting or deployment changed; `.gitignore` was not modified; nothing was staged, committed, pushed, rewritten or published; the People-import files were not inspected, edited, staged or moved. **Status: BLOCKED.**
