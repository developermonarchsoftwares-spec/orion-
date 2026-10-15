# Database credential cutover: approval package (RR-25)

## STATUS: DRAFT — NOT APPROVED

**Nothing in this package has been executed.** No replacement credential or role has been created or tested, no credential has been rotated or revoked, no consumer has been changed, and no administrator or owner has reviewed or signed this package. Every name, date, privilege, threshold and test result that this package leaves blank stays blank until the responsible person supplies it. Date prepared: 2026-10-03.

References: `CREDENTIAL_EXPOSURE_ASSESSMENT.md` (§ numbers cited as *Assessment §*), `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md` (*Plan Part I / II*), `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md` (*Checklist C-n*), `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md` (question IDs DB-n, GH-n, DP-n, IO-n), RR-25 in `PIPELINE_RUNTIME_RISK_REGISTER.md`, `TARGET_ARCHITECTURE.md` §8 (role design). Terminology and gates **G-1 to G-10** are those of the Checklist. This package concerns the database credential only (gates **G-1, G-2, G-3**). JWT, Typesense, scratch cleanup, `.gitignore`, secret scanning, history rewrite and pushes are separate (§Scope separation).

**No secret appears in this document.**

---

## 1. Incident summary and evidence references
- **What:** a database connection credential for the role `neondb_owner` is embedded in seven tracked scratch scripts under `ownus/scratch_*.js`, and is therefore present in 23 Git revisions on `main`/`origin/main` (Assessment §3.1; Plan Part I §1). The same credential is in two local gitignored env files (`apps/api/.env`, `ownus/.env.local`).
- **When (local evidence only):** earliest credential-bearing commit `1cdf261`, commit time 2026-09-21 14:52 +0530 (a client-set time); latest `72521a2` (2026-09-25). This machine first saw `1cdf261` on the remote on 2026-09-21 at 21:58 +0530, by pulling. The actual push time and any external access are not known (Appendix A, D-2).
- **Where it is used (local evidence):** the Orion API and the gateway read `DATABASE_URL`; the local env files hold the exposed credential; the deployed values are unknown (Assessment §3.3, §5).
- **Priority:** the credential is for a role named as the database owner (§3). Treat it as compromised until the administrator completes remediation.

## 2. Confirmed facts versus unresolved questions
Evidence classes: **LOCAL FACT** (verified here from files or Git), **INFERENCE** (reasoned from local facts, not proven), **UNRESOLVED** (needs an administrator, GitHub owner or deployment owner).

### 2.1 Confirmed (local facts)
| # | Fact | Source |
|---|---|---|
| F1 | The seven scripts embed a remote credentialed URL for role `neondb_owner`; the password equals that in `apps/api/.env` (in-memory comparison; no values recorded) | Assessment §3.1.1 |
| F2 | The same role, password and host (pooled endpoint) are in `ownus/.env.local` | Assessment §3.1.2 |
| F3 | 23 revisions contain the credential; reachable from `main` and `origin/main` (as of the last fetch); `fix/vercel-build` does not contain the first one | Assessment §3.1.4 |
| F4 | Five of the seven scripts contain write statements (insert, update or delete: counts per script 5, 2, 3, 1, 3); two (`scratch_inspect_tables.js`, `scratch_test_db.js`) contain none | Appendix A, D-3 |
| F5 | No file in the Pipeline working copy contains the exposed password; the Pipeline `.env` targets a local database with a different role, password and host | Assessment §3.3 |
| F6 | A Vercel production snapshot dated 2026-09-17 lists variables named `DATABASE_URL`, `DB_*`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TYPESENSE_API_KEY`, all with empty values | Assessment §3.3 |
| F7 | No CI workflow directory exists in either repository; the Dockerfiles and `docker-compose.yml` do not hold the exposed credential (the compose `DATABASE_URL` targets the compose host `postgres`) | Assessment §3.3, K-13, K-16 |
| F8 | The credential-bearing revisions were authored under two identities (20 under an identity different from the one configured here, including the first; 3 under the configured one) | Appendix A, D-2 |
| F9 | The API's comprehensive health route (`/api/v1/health`) includes a database indicator together with Typesense, storage and memory indicators; the liveness route (`/api/v1/health/liveness`) does not touch the database | `apps/api/src/modules/health/health.controller.ts` |
| F10 | `npm run db:audit` points at `src/database/audit-migrations.ts`, which contains no write statements and is marked read-only in its comments | `apps/api/package.json`, source |

### 2.2 Inferences (not proven; do not treat as fact)
- I1: `neondb_owner` is a database-owner-level role. Local documents show only that roles named `neondb_owner` and `neon_service` were seen, and that only the inspecting connection was visible. Object ownership and role attributes are **not** confirmed (Appendix A, D-1). The priority in §3 is precautionary.
- I2: The first credentialed commit was probably created on a clone other than this one and pushed between its commit time and 2026-09-21 21:58 +0530 (§1, D-2). Commit times are client-set; this is not provider-side evidence.
- I3: Local env files were last modified on 2026-09-19, so the credential existed before the first credentialed commit; if the administrator confirms the credential is older, the exposure window and the log window start earlier.
- I4: The production environment could hold the committed JWT values or the exposed database credential; the empty snapshot values neither show nor rule this out.

### 2.3 Unresolved (full list with owners: `CREDENTIAL_ADMIN_EVIDENCE_REQUEST.md`)
Credential validity and last change (DB-1); the role's actual privileges and attributes (DB-2); `neon_service` (DB-3); the complete consumer list (DB-4, DP-5); provider logs and retention (DB-6, DB-7); active connections (DB-8); rehearsal branches (DB-9); the supported least-privilege path (DB-10, DB-11); repository visibility, forks, access, hidden refs and push times (GH-1 to GH-7); deployed values for the database and JWT variables and the meaning of the empty snapshot (DP-1 to DP-4); other deployed hosts and jobs (DP-5); Typesense use (DP-6); identity of the second commit author and their clones (GH-4). **Missing evidence is recorded as unresolved, never as absence of exposure.**

## 3. The affected role and why an owner-level credential warrants priority
- **Role:** `neondb_owner` (role name only; a role name is not a secret).
- **Why priority (precautionary):** if it is the database owner, the credential can read, change and delete every application table and alter the schema, and may be able to manage other roles; a leak of it exposes all customer, billing and content data and permits silent modification. It is also shared by the Orion API, the gateway and (per local files) developers, so a single leak affects every consumer. Five tracked scripts that embed it contain write statements.
- **What is not known:** its actual privileges (DB-2) and whether it is still valid (DB-1). The priority does not depend on validity: a valid credential is an emergency, an invalid one still needs confirmation that every consumer has moved.
- **Design target:** applications should not run as the owner (`TARGET_ARCHITECTURE.md` §8: separate application role, migrator role, optional reader; the owner kept as a sealed break-glass credential).

## 4. Proposed least-privilege replacement approach
Proposed only; the database administrator decides after DB-2, DB-10 and DB-11 are answered.
1. **Preferred (staged):** create a replacement **application role** with only the privileges the Orion API and gateway need (the privilege list is the administrator's output from DB-11, not defined here), move the runtime consumers to it, verify (§8), then reset the `neondb_owner` credential so the owner credential exists only for migrations and break-glass, in a sealed store.
2. **Fallback (single window):** reset the `neondb_owner` password and update all consumers together. Fastest revocation, but every connection drops and all consumers must change in the same window. It leaves applications running as the owner, so it is a stopgap, not the target state.
3. A role holds one password, so "two valid credentials for the same role" does not exist; dropping or demoting an owner that owns objects is normally not possible. These are constraints to confirm with the administrator (DB-10).
4. A separate **migrator** role and a read-only role for evidence checks are part of the design target but not required for this cutover. Phase A2 and any rehearsal must not use the exposed credential.
5. **Not created, not tested, not named.** This package does not name the replacement role's password, privileges or creation date; any such entry appears only in §13 once the administrator supplies it.

## 5. Consumer inventory (status as of 2026-10-03)
Status: **confirmed** (holds or embeds the exposed credential, from local evidence); **potential**; **unverified**; **not a consumer** (confirmed locally). IDs match Assessment §5.

| ID | Consumer | Variable names | Status | Needs (owner confirmation) |
|---|---|---|---|---|
| K-1 | `apps/api/.env` (local) | `DATABASE_URL` | confirmed | developer owning the machine (G-3) |
| K-2 | `ownus/.env.local` (local) | `DATABASE_URL` | confirmed | same |
| K-3 | Seven tracked `ownus/scratch_*.js` | embedded | confirmed | separate work item (G-4) |
| K-4 | Git history, 23 revisions | embedded | confirmed | separate work item (G-8) |
| K-5 | Orion API, deployed | `DATABASE_URL`, `DB_*` | potential | DP-1, DP-2 |
| K-6 | Gateway database access (`ownus/src/lib/db.ts`) | `DATABASE_URL` | potential | DP-1, DP-2 |
| K-7 | Vercel production environment | `DATABASE_URL`, `DB_*` | unverified (names exist; values empty in the snapshot) | DP-1, DP-4 |
| K-8 | Vercel preview and development environments | same | unverified | DP-2 |
| K-9 | Migration, seed and audit tooling run from developer machines or runners | `DATABASE_URL` | potential | developer owners; DB-4 |
| K-10 | Phase A2 operator | role in the approval record (currently `PENDING OWNER`) | potential | incident owner; must not use the exposed credential |
| K-11 | Rehearsal and staging tooling | `STAGING_DATABASE_URL`, `STAGING_CONFIRM_HOST`, `STAGING_FORBIDDEN_HOSTS`, `STAGING_TARGET_HOST` (none set locally) | potential | DB-9 |
| K-12 | Database rehearsal branches | provider-held | unverified | DB-9 |
| K-13 | `docker-compose.yml` services | `DATABASE_URL` | not a consumer | none |
| K-14 | Pipeline working copy | `DATABASE_URL`, `POSTGRES_*` | not a consumer (locally) | none |
| K-15 | Deployed Pipeline instance, scheduled jobs, hosted CI, other hosts | unknown | unverified | DB-4, DP-5, GH-8 |
| K-16 | Dockerfiles | none | not a consumer | none |
| K-17 | Tracked example env files | placeholders | not a consumer | none |
| K-18 | Other clones, backups, caches, the second author identity's machines | any copy | unverified | GH-4 |
| K-19 | `neon_service` | provider-managed role | unverified | DB-3 |

Rule: **no revocation (§11) until every consumer marked confirmed or potential is on the new credential and every unverified one is resolved or knowingly accepted in writing by the incident owner.**

## 6. Preconditions for execution
All must be recorded as met (with evidence reference and date) before gate G-1 is requested.
| # | Precondition | Evidence | Met? |
|---|---|---|---|
| P1 | The evidence request has been answered for at least DB-1, DB-2, DB-4, DB-6, DB-9, DB-10, DB-11, DP-1, DP-2, DP-5, or the incident owner has accepted each open item in writing | answers file | `[ ]` |
| P2 | Provider logs preserved and reviewed (DB-6, DB-7); if misuse is suspected, incident escalation precedes the cutover | note | `[ ]` |
| P3 | Strategy chosen (§4) and the replacement role's privilege outline approved by the application owner and database administrator | approved outline | `[ ]` |
| P4 | Maintenance window agreed, announced and abort criteria (§9) accepted | calendar entry | `[ ]` |
| P5 | Secret stores ready (each deployment's approved mechanism, DP-8; administrator's vault); no plaintext route (no chat, ticket, file or repository) | owner statement | `[ ]` |
| P6 | Named operator, and named owner for every consumer in §5 | §13 | `[ ]` |
| P7 | Recovery path confirmed: backup or point-in-time recovery available and who starts it (DB-12) | statement | `[ ]` |
| P8 | Validation tools agreed: a pre-existing designated test account (not created under this approval) and a read-only database health check (DP-9); `db:audit` run by the named operator only against the target agreed | statement | `[ ]` |
| P9 | Phase A2 record and rehearsal plan reviewed so they refer to post-cutover roles; every existing rehearsal branch identified (DB-9) with a decision (reset or delete, each deletion confirmed separately) | note | `[ ]` |
| P10 | Developers informed that `apps/api/.env` and `ownus/.env.local` will change (G-3); scratch scripts must not be run | message | `[ ]` |
| P11 | Working trees: no remediation commit is made as part of this cutover; unrelated changes preserved | statement | `[ ]` |

## 7. Proposed implementation sequence (not executed; each action needs its gate)
Operator and approver names are filled in §13 only. Times, thresholds and durations marked **[set by approver]** are intentionally blank.

| Step | Action | Who | Gate |
|---|---|---|---|
| S0 | Open the maintenance window; announce; freeze deployments and pushes to the affected services; start monitoring (§9) | incident owner | none |
| S1 | Record the baseline: active connections by role and source; health result; audit counts (read-only `db:audit` by the operator) | operator, administrator | none (read-only) |
| S2 | Create the replacement application role or prepare the owner reset, per §4 | database administrator executes, after authorization by the database owner / credential-change approver (§13.1) | **G-1** |
| S3 | Place the new secret in the first consumer's secret store only; no plaintext copy | owner of that deployment | **G-2** |
| S4 | Redeploy or restart that consumer; run its validation (§8) | consumer owner and operator | none beyond S3 |
| S5 | Repeat S3 and S4 one consumer at a time in an order agreed in advance (lowest-impact first, gateway and API together if they must agree) | consumer owners | **G-2** per deployment |
| S6 | Update `apps/api/.env` and `ownus/.env.local` on each developer machine | each developer | **G-3** |
| S7 | Confirm in the provider console that all expected connections use the new credential; list any remaining session on the old one with its source | administrator | none |
| S8 | Hold for the agreed observation period **[set by approver]**, covering at least one cycle of scheduled jobs and the gateway fallback paths; each consumer owner signs off in writing | consumer owners | none |
| S9 | Request separate authorization to revoke (§11) | incident owner | **G-1 (separate)** |
| S10 | Revoke the exposed credential; administrator performs the controlled refusal check (§11) | administrator executes, after the revocation approver authorizes (§13.1) | **G-1 (separate)** |
| S11 | Re-run validation (§8) on every consumer; close the window; record evidence (§12) | operator, incident owner | none |

If the owner password is reset as a fallback (§4.2), S2 and S10 become a single action on a single credential and S3 to S7 must complete inside the window; the separate-authorization requirement of §11 still applies and the administrator must state beforehand how long connections stay broken.

## 8. Per-consumer validation criteria
Each test is non-destructive and exposes no credential. Do not run scratch, seed, cleanup or write-capable scripts as tests.

| Consumer | Passes when |
|---|---|
| Orion API (K-5) | the **comprehensive** health route reports the `database` component healthy (the liveness route does not exercise the database and is not sufficient); no authentication errors in its logs; one sign-in with the pre-approved designated test account succeeds and one authenticated read returns expected data |
| Gateway (K-6) | one read-only page that needs the database loads; no database authentication error in its logs |
| Vercel production and preview (K-7, K-8) | the deployed build reports the variable names present; the deployment's logs show no authentication failure; the same checks as above pass for that environment |
| Local `apps/api/.env`, `ownus/.env.local` (K-1, K-2) | the developer's local app starts against its intended database; no authentication error (a developer who normally uses a local database needs no change) |
| Migration, seed and audit tooling (K-9) | `db:audit` completes read-only with the baseline counts; no migration or seed is run to test |
| Phase A2 operator (K-10) | uses the agreed post-cutover role; the approval record names it |
| Rehearsal branches (K-11, K-12) | each is deleted or reset by the administrator only after its own explicit authorization as a provider-setting change (§13.1; deletion confirmed separately), or documented as holding no exposed credential |
| Any consumer found later (K-15, K-18, K-19) | owner confirms it uses the new credential before revocation |
| Provider side (S7) | no active session on the old credential other than those already identified and accepted |
| After revocation (S10, S11) | the old credential is **refused** on both the pooled and the direct endpoints (administrator-run, controlled); every consumer above remains healthy |

## 9. Abort criteria and monitoring requirements
### 9.1 Abort criteria (stop; do not advance to the next step)
- A consumer fails authentication on the new credential and is not fixed within **[set by approver]** minutes.
- Provider logs or connection views show activity by an unknown party (switch to incident handling; preserve logs).
- A connection from a consumer not in §5 appears.
- The comprehensive health route reports the database component unhealthy on a consumer after cutover and the cause is not configuration.
- Error rate or latency on the API or gateway exceeds **[set by approver]** against the S1 baseline.
- Privileges of the replacement role prove insufficient and cannot be corrected inside the window without granting owner-level rights.
- The window ends before S8 sign-off.
- **Revocation is never performed if any S8 sign-off is missing.**

### 9.2 Monitoring requirements (required during the window and the observation period)
- Provider: active connections by role and source; failed authentications; connection counts per endpoint (pooled and direct).
- API and gateway: health route result, authentication errors, 5xx rate, latency, queue and scheduled-job success.
- Alerting recipient: **[named in §13]**; escalation path: **[set by incident owner]**.
- Continue to watch for any use of the old credential after revocation for **[set by approver]**; any attempt is an incident signal, not a reason to restore it.

## 10. Application-configuration rollback versus post-revocation recovery
Neither restores the exposed credential.
- **Rollback of application configuration (before revocation).** A failed change is corrected by pointing the affected consumer at the *new* credential, or by issuing another new credential. Code or non-secret configuration may be rolled back to the previous version; the secret may not. If a consumer cannot be moved in time, extend the window (exposure continues until revocation, so keep it short) rather than putting the old credential back.
- **Recovery after revocation.** The exposed credential no longer works and is never reinstated. If something breaks, repair the consumer on the new credential or create another new credential or role. If data or schema were harmed (for example misuse found in P2), recover through the provider's backup or point-in-time restore under a separate, approved database change request.
- **Keep** the new credential in the secret store until the cutover is accepted; keep the administrator's break-glass access sealed and logged.

## 11. Separate authorization for revoking the old credential
- Revocation is a **separate decision from the cutover**, under gate G-1, and requires its own recorded approval **after** S8 sign-offs. Approval of S2 to S8 is not approval of revocation.
- Required for the approval: all consumer owners' written sign-offs; remaining old-credential sessions identified; a statement of what will be done (password reset, or removal of the old role's privileges); the planned refusal check; rollback understanding (§10).
- The refusal check is performed by the database administrator in a controlled way (one refused authentication attempt on each endpoint type); it is not delegated to an assistant or automated script.

## 12. Evidence to retain after execution
Store privately with restricted access; no secret values.
- The answered evidence request and the preserved provider and deployment logs (with the time ranges reviewed).
- The approved role-privilege outline and the strategy decision.
- A dated record of each step S0 to S11: who, what, when, and the result of each validation in §8 (pass or fail, no secrets).
- Provider-console views (redacted) of connections before, during and after, and of the revocation.
- The refusal-check result for both endpoint types.
- Sign-offs of each consumer owner and the revocation authorization.
- List of rehearsal branches and decisions; list of consumers and their final status.
- Updates to the incident documents and RR-25; residual exposure (copies, forks, caches, clones) recorded as residual, not resolved.

## 13. Approval record
No approval is recorded: every Decision is `NOT APPROVED` and every Date is `NOT SET`. Names are `NOT SET` except those the user selected on 2026-10-04, shown as `Subash A. V. — USER-SELECTED — PENDING VERIFICATION`; a selection is not verified authority, not an acceptance and not an approval. Approval of one line is not approval of any other.

| Role | Responsibility | Name | Decision | Date | Conditions |
|---|---|---|---|---|---|
| Database administrator (executes) | role and privileges; **executes** G-1 actions after authorization (role creation, owner-credential change) and performs the refusal check; does not authorize own actions | Subash A. V. — USER-SELECTED — PENDING VERIFICATION | NOT APPROVED | NOT SET | Authority unverified (incident tracker §10); §13.1 arrangement (decision sheet §1.1a) covers read-only evidence only, not this change action |
| Application owner | privilege outline; consumer behavior; validation | NOT SET | NOT APPROVED | NOT SET | NOT SET |
| Deployment owner | secret stores and environments; G-2 | NOT SET | NOT APPROVED | NOT SET | NOT SET |
| Incident owner | window, abort, monitoring, evidence, acceptance of open items | Subash A. V. — USER-SELECTED — PENDING VERIFICATION | NOT APPROVED | NOT SET | Role acceptance recorded 2026-10-04 (decision sheet §1.1a); authority unverified (incident tracker §10); not approval of the decisions in this row |
| Developer machine owners | G-3 (local env files), each for their own machine | NOT SET | NOT APPROVED | NOT SET | NOT SET |
| Revocation approver (separate) | G-1: **authorizes** S9 and S10 (the database administrator executes S10 and the refusal check) | Subash A. V. — USER-SELECTED — PENDING VERIFICATION | NOT APPROVED | NOT SET | Authority unverified (incident tracker §10); §13.1 arrangement (decision sheet §1.1a) covers read-only evidence only, not this change action |
| Database owner / credential-change approver | G-1: **authorizes** creation of the replacement role / credential and the strategy (named "database owner" in the checklist and G-1 wording) | Subash A. V. (selected as credential-change approver) — USER-SELECTED — PENDING VERIFICATION | NOT APPROVED | NOT SET | Authority unverified (incident tracker §10); §13.1 arrangement (decision sheet §1.1a) covers read-only evidence only, not this change action; I-8: USER-CONFIRMED: SAME PERSON (2026-10-04): the user states they are the Neon project/database owner and the credential-change approver; not verified |
| Neon account / project owner | grants Neon console access (read-only review now; any later change access) | Subash A. V. (selected as console access grantor) — USER-SELECTED — PENDING VERIFICATION | NOT APPROVED | NOT SET | Authority unverified (incident tracker §10); §13.1 arrangement (decision sheet §1.1a) covers read-only evidence only, not this change action; the user states they are the Neon project/database owner (USER-CONFIRMED, 2026-10-04); not verified |
| Provider-setting changes, including staging/rehearsal branch reset or deletion | G-1 (provider setting): each branch or setting authorized **separately**, naming it exactly | NOT SET | NOT APPROVED | NOT SET | NOT SET |

Named operator for S1, S4, S8, S11: NOT SET. Alert recipient and escalation (§9.2): NOT SET. Replacement role name, privilege outline reference and creation date: NOT SET (not created). Observation period, thresholds and window: NOT SET.

### 13.1 Authorize versus execute (proposed control; to be confirmed by the incident owner)
- **Authorizes:** the database owner / credential-change approver (the "database owner" of the checklist and the G-1 wording) authorizes G-1 create; the revocation approver authorizes revocation as a separate act; each deployment owner authorizes G-2 for their deployment; each developer authorizes G-3 for their own machine; the repository owner authorizes G-4, G-5, G-8, G-9 and G-10.
- **Executes:** the database administrator performs G-1 actions in the provider console and the controlled refusal check; the person who sets a deployment variable performs G-2; the committer performs G-4, G-5 and G-9 actions.
- **No self-authorization is assumed.** A database administrator does not authorize their own change. If one person holds both roles, the incident owner must record that decision in advance (OD-1), naming the exact actions covered; it is not assumed here.
- **Separate actions:** resetting or deleting a staging/rehearsal branch, and any other provider-setting change, are separate G-1 actions. Each needs its own explicit authorization naming the exact branch or setting, and is not covered by the approval to create the replacement role.
- **Console access:** the Neon account / project owner grants console access. Whether that person is the incident owner or the credential-change approver is a question for them (OD-2), not an inference.
- **Administrative access is not authorization.** Having administrator or owner rights on a system (for example Neon console, GitHub, Vercel or a provider account) does not by itself authorize rotating or revoking a credential or changing a provider setting. Those authorizations are recorded separately under the credential-change approver and revocation approver rows above.
- Names are `NOT SET` except those the user selected on 2026-10-04 (`USER-SELECTED — PENDING VERIFICATION`): Subash A. V. for the incident owner, Neon database administrator, credential-change approver, revocation approver and Neon console access grantor roles. One person holding several roles keeps each responsibility and its own approval act: the database administrator does not authorize their own change, and the combined-role arrangement required above is recorded **only for read-only evidence actions** (decision sheet §1.1a, 2026-10-04); it covers no change action and is not approval for any individual action. **I-8 (2026-10-04): USER-CONFIRMED: SAME PERSON**: the user states they are the Neon project/database owner and the credential-change approver. This answers the identity question only; it verifies no permission, establishes no formal authority and approves no action, and the responsibilities stay distinct acts. Verification evidence is listed in the incident tracker (§10, SV-1 to SV-7). No approval is recorded.

**Document status: DRAFT — NOT APPROVED.**

## Scope separation (separate work items, each with its own prerequisites and approval)
| Item | Checklist | Gate | Depends on |
|---|---|---|---|
| Scratch-script cleanup | C-6, C-8 | G-4 | cutover complete |
| `.gitignore` changes | C-7 | G-5 | C-6 committed |
| JWT rotation and compose literals | C-9, C-10 | G-6 (G-9 to push) | DP-3 answered; sign-out window |
| Typesense key | C-11 | G-7 | DP-6 answered |
| Secret scanning | C-12 | G-10 | C-6 done |
| History rewrite | C-13 | G-8, G-9 | revocation done; GH answers; written decision |
| Deployment or cloud changes beyond the secrets in §7 | per change request | G-2 or new | change request |
| Purge of other copies | C-14 | none | cutover complete; evidence preserved |

---

## Appendix A. Review of the assessment: discrepancies and proposed corrections
The existing documents were **not** modified. Each item states the evidence and a proposed correction for the owner to accept or reject. Proposed corrections are **not applied**.

| ID | Where | Finding | Evidence | Proposed correction (not applied) |
|---|---|---|---|---|
| D-1 | Assessment §3.1.3, Plan Part II §II.1 | The statement that `neondb_owner` "is the owner of the production database objects (read-only audit)" is stronger than the cited evidence. The ownership matrix, the target architecture and the Phase A2 checklist record only that roles named `neondb_owner` and `neon_service` were seen and that only the inspecting connection was visible; object ownership and attributes are queued for check C11 | `DATABASE_OWNERSHIP_MATRIX.md` line 160, `TARGET_ARCHITECTURE.md` line 25, `phase-a2/PHASE_A2_CHECKLIST.md` lines 37, 69, 93 | Reword to: "the role name indicates a database-owner role; ownership and attributes are unconfirmed (C11 pending); owner-level treatment is precautionary". The severity treatment stands |
| D-2 | Assessment §3.1.5 | The `origin/main` reflog time is this clone's own clock and records when this clone fetched or pushed, not when the hosting provider received a push. The entry at 2026-09-21 21:58 is a fast-forward on **pull**, so the remote already held `1cdf261` by then; this machine's `main` reflog has no commit event for `1cdf261`, and the commit was authored under a different identity from the one configured here (20 of the 23 credential-bearing revisions share it; there are two identities across all 80 revisions). The commit time (14:52) is client-set. So the push happened elsewhere, probably between 14:52 and 21:58 (+0530), but that is an inference and the provider-side time is unknown | local reflog, authorship counts | State that the interval is an inference; add the second-identity fact; add GH-4 and GH-7. Note also that exposure could precede the commit (the credential existed by 2026-09-19 locally; Assessment §4 item 4 already widens the log window) |
| D-3 | Assessment §10 item 8 | "Seven scratch scripts with write statements" is inconsistent with Plan Part II §II.4.1 and the evidence: five of seven contain write statements (pattern counts 5, 2, 3, 1, 3); two contain none | per-file statement counts | "Five of the seven tracked scripts contain write statements; all seven embed the owner credential" |
| D-4 | Assessment §3.3 | "The platform does not return sensitive values on pull" is stated as fact; it is an inference. Empty values could mean sensitive values withheld, intentionally empty values, or variables unset for that environment, and the file is dated 2026-09-17. Only the platform can say | snapshot shape (every secret-like variable empty; names present) | Reword as "values are empty, possibly because they are marked sensitive; unverified (DP-4)" |
| D-5 | Assessment §6 Phase 3.3 (and Plan II.2) | "Sign-in with a disposable test identity" assumes such an account exists in production; creating one is a production write needing its own approval. The comprehensive health route, not the liveness route, exercises the database (F9) | health controller | Require a pre-existing designated test account (DP-9) and name the comprehensive route; no account is created under G-1 to G-3 |
| D-6 | Assessment §4, §5 | `neon_service` (seen with `neondb_owner`) is absent from the unknowns and the inventory | earlier audit records | Add K-19 and DB-3 (done here, not in the assessment) |
| D-7 | Plan Part I §4 | `docker-compose.yml` is described as "a localhost URL only"; it uses the compose host `postgres` and does not contain the exposed password | compose line 76 (credential redacted in review) | "a compose-network URL without the exposed credential" (already proposed in Assessment §10) |
| D-8 | Assessment §3.4, §4 | The second commit author identity means other clones or copies of the credential and the JWT values may exist beyond this machine; not reflected | authorship counts | Add to K-18 and GH-4 (done here) |
| D-9 | Assessment §6 | Cutover steps lacked sequencing detail, per-consumer pass criteria, observation period, thresholds, ownership and a monitoring plan | review | Provided in §6 to §9 of this package; thresholds deliberately left for the approvers |

**Consistency check.** The gate numbering, the consumer IDs K-1 to K-18 (K-19 added here), the evidence classes and the rollback rule (never restore the exposed credential) are consistent across the four documents. Counts (7 scripts, 23 revisions, 80 revisions, 8 tracked `scratch_*.js` files) match the repository state on 2026-10-03.

## Completion note
Prepared from existing local files and Git metadata, plus read-only local file inspection, on 2026-10-03. No external service was contacted (no database provider, Typesense, Vercel, GitHub or any remote), no credential was tested or changed, no secret value was printed or stored, and no application code, configuration, environment file, migration, `.gitignore` or deployment setting was changed. Nothing was staged, committed, pushed or rewritten, and nothing was deleted or untracked. Unrelated working-tree changes in both repositories were preserved.
