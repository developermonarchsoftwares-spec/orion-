# Credential remediation: owner coordination package (RR-25)

**Status: DRAFT MATERIAL. NOTHING HAS BEEN SENT. No owner has responded. No gate is approved. The database cutover is NOT READY.** Date prepared: 2026-10-03.

This is a short, send-ready companion to `CREDENTIAL_OWNER_COORDINATION_PLAN.md` (longer action lists, preserved). It uses the IDs of `CREDENTIAL_EXECUTION_READINESS_REVIEW.md` §11 (**OD-n** owner decisions, **AE-n** administrator/owner evidence), the tracker `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md` (DB-n, GH-n, DP-n, IO-n; criteria R1 to R10) and gates **G-1 to G-10** of `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md`. Nothing in the existing documents was changed.

**For the human sender.** Send the messages yourself, through your own channel. Replace bracketed placeholders (`[NAME]`, `[DATE]`). Never add a password, token, key, host name or connection string to a message or a reply, and ask recipients not to either. Replies carry dates, role names, counts and yes/no answers. Keep replies in a private, access-restricted place and record the location (not the content) in the tracker's *Evidence ref* column.

---

## 1. Prioritized unanswered questions
All items are `UNANSWERED`. Priority reflects time-sensitivity and how many other items depend on it.

### Priority 1: time-sensitive or blocking everything else
| Rank | ID | Question | Who | Why first |
|---|---|---|---|---|
| 1 | OD-1 | Who is the incident owner, and who are the named approvers (database administrator, application owner, deployment owner, repository owner; and who may approve revocation separately)? | you | nobody can approve or answer without named owners |
| 2 | OD-2 + tracker IO-3 | Authorize the read-only console review and say who preserves provider, deployment and repository logs before anything changes | you / incident owner | log retention may expire; evidence must be kept first |
| 3 | AE-3 (DB-1) | Is the database credential that was current on 2026-09-19 still valid, and when was the `neondb_owner` password last changed? (Do not test by signing in.) | Neon administrator | sets urgency and whether an emergency decision is needed |
| 4 | AE-4 (DB-6, DB-7) | How long are access and connection logs kept, how far back do they go, and do they show unfamiliar sources, unexpected writes or role changes? | Neon administrator | whether misuse can be ruled in or out at all |
| 5 | AE-1 (DB-9; E-1, E-2, E-5) | Which Neon branch sits behind the application's endpoint and behind the second endpoint used on 2026-10-02 for staging; is either the default (production) branch; did the staging branch inherit the password? | Neon administrator | converts `TARGET UNCONFIRMED` into outcome A, B or C |
| 6 | AE-8 (GH-1, GH-2, GH-3, GH-7) | Repository visibility now and ever, who has or had access, forks and clones, and the times and actors of the pushes that first contained the credential | GitHub owner | the only source for the real exposure timeline |

### Priority 2: needed to design the safe replacement
| Rank | ID | Question | Who |
|---|---|---|---|
| 7 | AE-2 (DB-2, DB-3) | The role's attributes and privileges, who owns the schemas and objects, and what `neon_service` is | Neon administrator |
| 8 | AE-5 (DB-4, DB-8, DP-1, DP-2, DP-3, DP-5, DP-6) | Which services, hosts and jobs connect as that role; active connections by role and source; whether any deployment uses the exposed database credential, the committed JWT values or the Typesense development key | Neon administrator + deployment owner |
| 9 | AE-7 (DB-10, DB-11, DB-12) | The supported replacement process, the privilege outline for a least-privilege application role, and whether backup or point-in-time recovery is available | Neon administrator + application owner |
| 10 | AE-11 (DP-9) | An approved existing test account (no new accounts) and a read-only way to check database health after the change | application owner + deployment owner |
| 11 | OD-3 | Adopt the working posture "treat the configured endpoint as production-capable until proven otherwise" | you |
| 12 | OD-6 | Change window and the interruption you can accept | you |
| 13 | OD-4 | Choose the permanent hosting platform and secret store | you |

### Priority 3: needed before cleanup, hosting move and pushes
| Rank | ID | Question | Who |
|---|---|---|---|
| 14 | AE-10 (DP-4; V-1 to V-7) | Vercel inventory: projects, deployments, domains, variable names with sensitive flags, Git integration and auto-deploy status, log retention | deployment owner |
| 15 | AE-9 (GH-4) | Who is the second commit-author identity and where do their clones live | GitHub owner / team |
| 16 | AE-6 (E-4) | **DEFERRED, UNRESOLVED:** what the 57 `users` rows are (customers or test accounts). Removed from the first message because answering needs a query; any read-only SQL needs a separate, explicit authorization and an approved procedure | Neon administrator (once authorized) |
| 17 | AE-12 | Owners and providers for Redis, object storage, OAuth, email and payments; whether any deployment holds their values | deployment owner |
| 18 | OD-5 | Do live payments (Razorpay) and Google/Microsoft sign-in exist today? | you |
| 19 | OD-7 | Rotate the JWT pair with the hosting move (recommended) or earlier | you |
| 20 | OD-8 | Use a clean checkout of `origin/main` for remediation commits (recommended); who commits the existing uncommitted work | you / repository owner |
| 21 | OD-9 | Seven scratch scripts: keep sanitized copies outside the repository or discard; ignore rule by glob or exact paths | you / repository owner |
| 22 | OD-11 | Disable the Vercel Git integration **before the first push**? (G-10) | you / repository owner + deployment owner |
| 22b | OD-14 | **Separately:** delete the Vercel project **after** migration, validation and evidence preservation? (G-2) | you / deployment owner |
| 23 | OD-12 | Choose the secret-scanning approach | you / repository owner |
| 24 | OD-10 | Defer the history-rewrite decision until after revocation (recommended) | you / repository owner |
| 25 | OD-13 | Team to confirm authorship and purpose of the People-import work (`REQUIRES TEAM CONFIRMATION`) | team |
| 26 | AE-8 (GH-6, GH-8; P-7, P-9) | Security alerts, whether hosted CI ran, branch protection, push permissions, whether push protection is available | GitHub owner |

---

## 2. Draft messages (DRAFT — NOT SENT)
Each message is self-contained and short. Bracketed items are for the sender to fill.

### 2.1 To the Neon (database) administrator
**Subject:** Orion database credential exposure: read-only evidence request (no changes yet)

Hi [NAME],

A database connection credential for the role `neondb_owner` was found in tracked scratch scripts and in Git history (first commit 2026-09-21, last 2026-09-25) and in local environment files. We do not yet know whether it is still valid, what it can do, or which Neon branch it reaches. We are not asking you to change anything yet: no credential rotation, revocation, migration, production change or other cutover action is authorized yet.

Please, from the Neon console and settings only:
1. **First**, check how long access and connection logs are kept and preserve what exists (AE-4).
2. Tell us when the `neondb_owner` password was last changed and whether the value current on 2026-09-19 is still valid. Please do not test it by signing in (AE-3).
3. Tell us which branch sits behind the application's endpoint and behind the staging endpoint used on 2026-10-02 (names, IDs, parents, creation dates, default branch or not), and whether the staging branch inherited the password (AE-1).
4. Give us the role list with attributes, who owns the schemas and objects, and what `neon_service` is (AE-2).
5. Tell us which applications, hosts and jobs connect as this role, and the active connections by role and source (AE-5).
6. Tell us the supported process to replace the credential, what a least-privilege application role would need, and whether backup or point-in-time recovery is available (AE-7).

Please reply with dates, role and branch names, counts and yes/no only, using the console and settings views alone: please do not run any SQL queries, and if you think a query is needed, tell [INCIDENT OWNER] first. Do not send passwords, tokens, host names or connection strings. If you cannot determine something, say `CANNOT DETERMINE` and why. If you see unfamiliar sources, unexpected writes or role changes, tell [INCIDENT OWNER] right away before doing anything else.

Thanks, [SENDER]

### 2.2 To the GitHub repository owner
**Subject:** Orion repository: exposure timeline and access evidence (read-only)

Hi [NAME],

Seven tracked scratch scripts and 23 commits on `main` contain a database credential (first commit 2026-09-21 14:52 +0530 by its author's clock; this machine first saw it on the remote at 2026-09-21 21:58 +0530, which is not a provider-side time). We need the real exposure picture. No credential rotation, revocation, migration, production change or other cutover action is authorized yet, and none is being requested of you. Please check, without changing any setting:
1. Repository visibility now, whether it has ever been public, and when visibility last changed (AE-8).
2. Collaborators, teams, outside collaborators, deploy keys, installed apps and tokens with read access, past and present.
3. Forks, mirrors and archives, and any clone or traffic data.
4. The push events and actors (with timestamps) that first contained the credential commits, from the audit or security log.
5. Pull-request refs and unmerged branches that keep those commits reachable.
6. Security or secret-scanning alerts, whether push protection is available, branch protection and push permissions, and whether hosted CI ran for these commits.
7. Who is behind the second commit-author identity (two identities appear in the history; the second authored the first credential commit) and where their clones are (AE-9).
Please reply with dates, counts, roles and yes/no. Do not send the credential or any token. Please do not test, sign in with or otherwise use the credential, and do not ask anyone else to. Do not rewrite history, delete branches or change settings; those are separate approvals.

Thanks, [SENDER]

### 2.3 To the deployment owner
**Subject:** Orion deployments: what uses which credentials (read-only), and Vercel status

Hi [NAME],

We plan to replace exposed credentials and move off Vercel permanently. Before changing anything we need to know what the live environments hold. No credential rotation, revocation, migration, production change or other cutover action is authorized yet (including any redeployment), and none is being requested of you. Please answer from the live settings, with yes/no, not values:
1. Which production and preview environments (and any other project linked to the database) hold variables for a database connection (names such as `DATABASE_URL` and `DB_*`)? Please report the **variable names, the environments where they exist, and the services you have confirmed use them**, which may include the `neondb_owner` role (AE-5). Do **not** reveal or compare credential values. Any matching of those settings against the exposed credential must be coordinated through the Neon administrator and the authorized owners using an approved procedure; please do not attempt it yourself.
2. Do any environments use the **JWT signing secrets committed in `docker-compose.yml`**? Are the API and gateway set to the same pair?
3. Is a Typesense instance deployed, and does it use the development default key?
4. A local snapshot of the Vercel production variables (2026-09-17) lists the database, JWT and Typesense variable names with empty values. Are they marked sensitive, intentionally empty, or unset, and which variables exist per environment? (AE-10)
5. List the Vercel projects, deployments, domains and integrations, and say **whether the Git integration still auto-deploys `main`** (we must know before the first push).
6. Which other hosts, jobs, workers or services connect to the database or to Redis, object storage, email, OAuth or payment providers, and who owns each (AE-12)?
7. Is there an approved existing test account and a read-only database health check we can use for validation without creating data? (AE-11)
Please do not change, delete or redeploy anything, do not send or compare values, and do not test, sign in with or otherwise use the credential. Preserve deployment and build logs.

Thanks, [SENDER]

### 2.4 To the incident owner
**Subject:** Orion credential incident: owners, authorities, window and decisions

Hi [NAME],

Please confirm or decide the following so the work can be scheduled. Nothing is approved and nothing has been executed; no credential rotation, revocation, migration, production change or other cutover action is authorized yet.
1. Name the incident owner and the person for each role: the database owner / credential-change approver (who **authorizes**) separately from the database administrator (who **executes**), application owner, deployment owner, repository owner, the Neon account/project owner, and the Typesense, Redis, storage, OAuth, email, payment, domain/DNS and hosting owners where they apply; and who may approve **revocation** of the old credential separately (OD-1).
2. Authorize the read-only console review; name who performs it, who preserves logs, and who grants the Neon console access (the Neon account/project owner), and say whether that person is different from you and from the credential-change approver (OD-2).
3. Adopt the working posture "treat the configured endpoint as production-capable until proven otherwise" (OD-3), and set severity and the escalation and external-notification path.
4. Choose the permanent hosting platform and secret store (OD-4); tell us whether live payments and Google/Microsoft sign-in exist (OD-5).
5. Set the change window and acceptable interruption (OD-6); say whether to rotate JWT with the hosting move (OD-7).
6. Agree that remediation commits are made in a clean checkout of `origin/main` by explicit paths, and who commits the existing uncommitted work (OD-8). Decide the fate of the seven scripts' local copies and ignore-rule style (OD-9), the history-rewrite timing (OD-10), disabling the Vercel Git integration before the first push (OD-11), separately deleting the Vercel project after migration (OD-14), and the secret-scanning approach (OD-12).
7. Ask the team to confirm who owns the uncommitted People-import work in the shared tree (OD-13).
8. Define closure criteria (see the tracker).
Each approval is separate: approving one step is not approving another.

Thanks, [SENDER]

### 2.5 To the application owner
**Status: DRAFT — NOT SENT.**
**Subject:** Orion credential incident: privilege outline and validation method (read-only; no changes yet)

Hi [NAME],

A database connection credential for the role `neondb_owner` was found in tracked scratch scripts and in Git history, and a controlled replacement with a least-privilege application role is being planned. No credential rotation, revocation, migration, production change or other cutover action is authorized yet, and none is being requested of you. Please do not test, sign in with or otherwise use the exposed credential, do not run SQL against production, and do not send any password, token, host name or connection string.
1. With the Neon administrator, outline what the Orion API and the gateway actually need from the database at run time (which tables, sequences and schemas they read or write), as distinct from what only schema migrations need. Names only, from your knowledge of the application and its documentation; no queries (AE-7, tracker DB-11).
2. Identify an approved, existing test account (not a real customer, and no new account is to be created) and a read-only way to check that the application can reach its database after a change, using the comprehensive API health route rather than the liveness routes (AE-11, tracker DP-9). Say if you have neither.
3. Review the per-consumer validation criteria in `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §8 and tell us whether each is acceptable and whether any would write data into production.
Please reply with names, dates and yes/no only. If you cannot determine something, say `CANNOT DETERMINE` and why. Reviewing these items does not make you the approver of anything; approvals are recorded separately (approval record §13).

Thanks, [SENDER]

---

## 3. Response-tracking table
Status of every row: **UNANSWERED**. "Sent" is `NOT SENT` until a human sends it. Fill *Evidence ref* with a private location title and date, never the content. Update the main tracker as well after review.

### 3.1 Evidence (AE)
| ID | Evidence needed | Tracker / report refs | Responsible role | Message | Sent | Response date | Evidence ref | Status | Follow-up |
|---|---|---|---|---|---|---|---|---|---|
| AE-1 | Branches behind the app endpoint and the staging endpoint; inheritance | DB-9; E-1, E-2, E-5 | Neon administrator | §2.1 item 3 | NOT SENT | NOT SET | NOT SET | UNANSWERED | decides outcome A/B/C; R2 (via DB-9) |
| AE-2 | Role attributes, ownership, `neon_service` | DB-2, DB-3 | Neon administrator | §2.1 item 4 | NOT SENT | NOT SET | NOT SET | UNANSWERED | resolves D-1, D-6 |
| AE-3 | Credential validity, last password change | DB-1 | Neon administrator | §2.1 item 2 | NOT SENT | NOT SET | NOT SET | UNANSWERED | sets urgency |
| AE-4 | Log retention and review | DB-6, DB-7, IO-3 | Neon administrator | §2.1 item 1 | NOT SENT | NOT SET | NOT SET | UNANSWERED | preserve first |
| AE-5 | Consumers, active connections, deployed use of DB credential, JWT, Typesense | DB-4, DB-8, DP-1, DP-2, DP-3, DP-5, DP-6 | Neon administrator + deployment owner | §2.1 item 5, §2.3 items 1 to 3 | NOT SENT | NOT SET | NOT SET | UNANSWERED | completes inventory (R2, R4); DP-6 unmapped to R1 to R10 (feeds G-7); whether a deployment uses the exposed credential is established only through an approved matching procedure, not by comparing values (§2.3 item 1) |
| AE-6 | What the `users` rows are (deferred) | E-4 | Neon administrator (once authorized) | none (removed from the first message) | NOT SENT | NOT SET | NOT SET | UNANSWERED | **DEFERRED, UNRESOLVED:** needs a separate, explicit SQL authorization and an approved procedure; unmapped to R1 to R10 |
| AE-7 | Replacement process, privilege outline, backup/PITR | DB-10, DB-11, DB-12 | Neon administrator + application owner | §2.1 item 6; §2.5 item 1 | NOT SENT | NOT SET | NOT SET | UNANSWERED | R5 (DB-10, DB-11); R6 (DB-12, recovery path) |
| AE-8 | Visibility, access, forks, push events, alerts, branch protection | GH-1 to GH-3, GH-5 to GH-8; P-7, P-9 | GitHub owner | §2.2 | NOT SENT | NOT SET | NOT SET | UNANSWERED | resolves D-2 timeline (T4) |
| AE-9 | Second author identity and clones | GH-4 | GitHub owner / team | §2.2 item 7 | NOT SENT | NOT SET | NOT SET | UNANSWERED | resolves D-8 |
| AE-10 | Vercel inventory, variable names/sensitivity, Git integration, logs | DP-4; V-1 to V-7; P-8 | deployment owner | §2.3 items 4, 5 | NOT SENT | NOT SET | NOT SET | UNANSWERED | resolves D-4; push safety |
| AE-11 | Approved test account and read-only validation route | DP-9 | application owner + deployment owner | §2.3 item 7; §2.5 item 2 | NOT SENT | NOT SET | NOT SET | UNANSWERED | R7 |
| AE-12 | Owners/providers for Redis, storage, OAuth, email, payments; deployed values | proposed new tracker rows | deployment owner | §2.3 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED | WS3 |

### 3.2 Decisions (OD)
| ID | Decision | Decider | Message | Sent | Decision date | Record ref | Status |
|---|---|---|---|---|---|---|---|
| OD-1 | Incident owner and approvers named | you / incident owner | §2.4 item 1 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-2 | Authorize read-only review; who performs; who preserves logs | you / incident owner | §2.4 item 2 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-3 | Treat the endpoint as production-capable until proven otherwise | you | §2.4 item 3 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-4 | Hosting platform and secret store | you / application owner | §2.4 item 4 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-5 | Live payments and sign-in? | you | §2.4 item 4 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-6 | Change window and acceptable interruption | you / incident owner | §2.4 item 5 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-7 | JWT rotation timing | you | §2.4 item 5 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-8 | Clean-checkout approach; who commits existing work | you / repository owner | §2.4 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-9 | Local copies of the seven scripts; ignore style | you / repository owner | §2.4 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-10 | History-rewrite timing | you / repository owner | §2.4 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-11 | Disable the Vercel Git integration before the first push (G-10) | you / repository owner + deployment owner | §2.4 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-12 | Secret-scanning approach | you / repository owner | §2.4 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-13 | Authorship of People-import work | team | §2.4 item 7 | NOT SENT | NOT SET | NOT SET | UNANSWERED |
| OD-14 | Delete the Vercel project after migration (G-2); separate from OD-11 | you / deployment owner | §2.4 item 6 | NOT SENT | NOT SET | NOT SET | UNANSWERED |

Counts: 12 evidence items and 14 decisions (OD-14 added to separate deleting the Vercel project from OD-11), **0 answered**. AE-6 is deferred and unresolved.

---

## 4. Evidence and approval gates required before execution
Nothing below has been requested or granted. Approval of one gate is not approval of another. Approver fields are `NOT SET` except the names the user selected on 2026-10-04 in the decision sheet (`USER-SELECTED — PENDING VERIFICATION`); no approval is recorded.

### 4.1 Read-only steps (no gate)
Workstream 1 (read-only review in the Neon console and settings, GitHub settings, Vercel project) and log preservation need access by the right person but no gate. Running the Phase A2 read-only SQL needs the Phase A2 approval record, currently `DRAFT — NOT APPROVED`. Any other SQL, including an aggregate count of the `users` rows (AE-6), likewise needs a separate, explicit authorization and an approved procedure; none is authorized by this package.

### 4.2 Evidence that must exist before the first operational request
| Required before | Evidence | Satisfied by | Criterion |
|---|---|---|---|
| Requesting G-1 (create role) | role attributes, ownership, validity, branches, consumers known; privilege outline reviewed; backup/PITR confirmed; logs preserved | AE-1 to AE-5 and AE-7 (AE-6 is deferred and not required for G-1) | R1, R2, R3, R5, R6 |
| Requesting G-1/G-2/G-3 | window, abort thresholds, observation period, alert recipients, escalation filled in; approved validation method; approvers named | OD-1, OD-2, OD-6, AE-11 | R4, R6, R7, R8 |
| Any approval at all | corrections PC-1 to PC-9 (corrections document §3) and PC-10 to PC-13 (target report §10) reviewed (accept or reject) | incident owner | R9 |
| Revocation | all consumer sign-offs, remaining sessions identified, refusal-check plan | after cutover | R10 |
| Hosting move | platform chosen and staging validated | OD-4 | WS4 |
| First push of anything | Vercel auto-deploy status known; branch protection and permissions known; clean checkout agreed | AE-10, AE-8, OD-8 | P-7, P-8 |

### 4.3 Gates (all unapproved)
| Gate | Action | Approver (role) | Evidence needed first | Approval recorded |
|---|---|---|---|---|
| G-1 | Create replacement role / change a database credential (create); revoke old credential (**separate** approval); staging-branch reset or deletion and any other provider-setting change are **separate G-1 actions**, each authorized separately | database owner / credential-change approver **authorizes**; database administrator **executes** (approval record §13.1) | AE-1 to AE-5 and AE-7, OD-1, R1 to R8 (AE-6 is deferred and not required); for revocation also R10 | no |
| G-2 | Change deployment variables (per deployment); delete the Vercel project after migration (OD-14) | each deployment owner authorizes; the person who sets the variable executes | AE-5, AE-10, OD-4; for project deletion also OD-14 | no |
| G-3 | Update `apps/api/.env` and `ownus/.env.local` on a machine | each developer | notice that scratch scripts must not run; OD-8 | no |
| G-4 | Untrack the seven scripts (explicit paths) | repository owner | credential replacement begun; OD-8, OD-9 | no |
| G-5 | Edit `.gitignore` | repository owner | G-4 commit made; OD-9 | no |
| G-6 | Rotate JWT secrets (API and gateway together) | application owner + deployment owner | DP-3 answered; OD-7; sign-out window | no |
| G-7 | Replace or restrict the Typesense key | Typesense administrator | DP-6 shows deployed use | no |
| G-8 | Rewrite Git history | repository owner (written) | revocation; AE-8, AE-9; mirror backup; OD-10 | no |
| G-9 | Push commits / change remote branches | repository owner | P-1 to P-12 of the readiness review | no |
| G-10 | Change CI, hosting-side scanning, Git integrations or repository security settings | repository owner | OD-11, OD-12, AE-8 | no |

**Authorize versus execute:** the designated approver **authorizes** the action; the database administrator **executes** G-1 actions but **must not self-authorize**. **Revocation requires its own separate authorization**, even if the same person holds both approval roles (credential-change approver and revocation approver); any combined-role arrangement must be recorded in advance under OD-1, naming the exact actions it covers, and is not assumed here. Staging-branch reset or deletion and any other provider-setting change remain separate G-1 actions, each authorized separately. See `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §13.1. Approver and executor names are `NOT SET` except the user-selected ones in decision sheet §1.1 (`USER-SELECTED — PENDING VERIFICATION`); no approval is recorded; a combined-role arrangement is recorded only for read-only evidence actions (decision sheet §1.1a). The role fields (including the Neon account/project owner and the other credential owners) are in `CREDENTIAL_OWNER_DECISION_SHEET.md` §1.1.

### 4.4 Do not
Do not send values in any message; do not test the exposed credential; do not pull in the shared working tree; do not stage, commit or push from the current tree; do not touch the People-import files.

## Completion statement
Documentation only. **No message, email, ticket or request was sent, and no external service was contacted** (including Neon, GitHub and Vercel; no fetch or push). No credential was tested, revealed or changed. No application code, configuration, database object, migration, Git history or `.gitignore` was edited. The People-import files were not read, edited, staged, moved, deleted or reverted. The readiness review and all other documents were preserved. No gate was approved or executed. The only file created is this document.
