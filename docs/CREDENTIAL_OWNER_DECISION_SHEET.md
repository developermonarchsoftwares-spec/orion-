# Credential remediation: owner decision sheet (OD-1, OD-2 and related)

**Status: PARTLY SELECTED, NOT COMPLETED.** On 2026-10-04 Subash A. V. selected themselves for nine roles; they are recorded below as `USER-SELECTED — PENDING VERIFICATION`. A selection is not verified authority and not an authorization or approval. The Incident Owner role was explicitly accepted, and a combined-role arrangement for read-only evidence actions only was recorded, on 2026-10-04 (§1.1a); neither is verified authority or an approval. Every other field is blank. Nothing here is a decision, an authorization or an approval until the responsible person completes it and records it. No gate is passed. **The database cutover is NOT READY.** Date prepared: 2026-10-03.

This sheet is the one genuinely missing piece in the existing set. The Priority 1 messages, the AE/OD tracking rows and the gate map **already exist** and are reused by reference, not copied: `CREDENTIAL_OWNER_COORDINATION_PACKAGE.md` (§1 priorities, §2 drafts, §3 tracking, §4 gates), `CREDENTIAL_ADMIN_RESPONSE_TRACKER.md` (39 items, R1 to R10), `CREDENTIAL_EXECUTION_READINESS_REVIEW.md` (§11 OD/AE), `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (§13 approval record, `DRAFT — NOT APPROVED`) and `CREDENTIAL_ROTATION_EXECUTION_PLAN.md`.

**How to use it.**
1. Fill the blank fields yourself. Only the role selections the user communicated on 2026-10-04 are pre-filled, each marked `USER-SELECTED — PENDING VERIFICATION`; nothing else is pre-filled or invented; unknowns stay `NOT SET`.
2. Never write a password, token, key, host name or connection string here.
3. Completing this sheet does **not** approve anything. After it is filled, a human copies the answers into the tracker (IO-1, IO-3 to IO-6) and the approval record (§13). Each gate (G-1 to G-10) still needs its own explicit approval with its evidence (§4).
4. One person may hold several roles. That is allowed, but write it down. Approval of one step is never approval of another.

---

## 1. Decision sheet (to be completed by you)
### 1.1 People and authorities (OD-1)
| Role | Name | Contact channel | Date decided | Notes or limits | Tracker / approval refs |
|---|---|---|---|---|---|
| Incident owner (the person with overall administrative authority to coordinate the incident across all affected systems) | Subash A. V. | `________` | 2026-10-04 | `USER-SELECTED — PENDING VERIFICATION`. Acceptance recorded 2026-10-04 (§1.1a). Authority unverified (SV-5) | IO-1, IO-4; approval §13 |
| Database administrator (Neon): **executes** G-1 actions and the refusal check after authorization; does not authorize own actions | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. Executes only; does not authorize own actions unless the §13.1 combined-role arrangement is recorded (§1.1a). Access unverified (SV-1) | AE-1 to AE-7; approval §13, §13.1 |
| GitHub / repository owner | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. Admin rights unverified (SV-2) | AE-8, AE-9; G-4, G-5, G-8, G-9, G-10 |
| Deployment owner (current Vercel project and any other current host) | `________` | `________` | `________` | NOT selected by the user. May be covered by the Vercel account administrator and infrastructure roles below; confirm (not inferred) | AE-5, AE-10, AE-12; G-2 |
| Application owner (also required by approval §13) | `________` | `________` | `________` | | AE-7, AE-11; G-6 |
| Database owner / credential-change approver: **authorizes** G-1 create (replacement role / credential); is not the executor unless recorded under approval §13.1 | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. Selected as the credential-change approver. Authorizes G-1 create only after authority is verified (SV-5) and an explicit, evidenced approval is recorded; no approval is granted. I-8 answered `USER-CONFIRMED: SAME PERSON` (2026-10-04): the user states they are the Neon project/database owner and the credential-change approver; this is not verified, and the two responsibilities stay distinct acts | **G-1** (create); approval §13, §13.1 |
| Revocation approver (a **separate** approval act, even if the same person; authorizes, and the database administrator executes) | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. A separate approval act from the credential-change approval even though the same person is selected; no approval is granted; needs R10 and consumer sign-offs | **G-1** (revoke); approval §11, §13.1, R10 |
| Developer machine owners (each for their own files) | `________` | `________` | `________` | | **G-3** |
| Neon account / project owner (grants Neon console access) | Subash A. V. (as Neon console access grantor) | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. The user states they are the Neon project/database owner (`USER-CONFIRMED: SAME PERSON`, 2026-10-04); Neon account ownership is not stated; not verified (SV-1, SV-7) | OD-2; approval §13.1 |
| Provider-setting approver: staging/rehearsal branch reset or deletion and any other provider-setting change (each authorized **separately**, naming the exact branch or setting) | `________` | `________` | `________` | | **G-1** (provider setting); plan N-10; approval §13.1 |
| Typesense administrator (only if a deployed instance exists) | `________` | `________` | `________` | | DP-6; **G-7** |
| Redis credential owner | `________` | `________` | `________` | | AE-12; CR-6 |
| Object-storage credential owner | `________` | `________` | `________` | | AE-12; CR-7 |
| OAuth credential owner (Google / Microsoft consoles) | `________` | `________` | `________` | | AE-12; CR-8, CR-9 |
| Email credential owner (Resend) | `________` | `________` | `________` | | AE-12; CR-10 |
| Payment credential owner (Razorpay) | `________` | `________` | `________` | | AE-12; CR-11 |
| Payment / webhook owner (webhook URL and secret) | `________` | `________` | `________` | | AE-12; CR-11 |
| Domain / DNS owner | `________` | `________` | `________` | | OD-4; plan V-8 |
| Hosting platform owner (permanent platform, once chosen) | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. The permanent platform is not yet chosen (OD-4) | OD-4; plan WS4 |
| Vercel account administrator (if different from the deployment owner) | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. Vercel account and project rights unverified (SV-3) | AE-10; plan V-1 to V-14 |
| Orion application infrastructure administrator (runtime hosts, containers and secret store of the current environment; if different from the deployment owner) | Subash A. V. | `________` | `________` | `USER-SELECTED — PENDING VERIFICATION`. Control of hosts, containers and secret store unverified (SV-4) | AE-5, AE-12 |

**Authorization versus execution (proposed control; see `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` §13.1).** The person who **authorizes** a change is recorded separately from the person who **executes** it. The database administrator executes and does not authorize their own actions. If one person must hold both roles, that is a decision for the incident owner to record in advance (OD-1); it is not assumed. It was recorded on 2026-10-04 for read-only evidence actions only (§1.1a); no change action is covered. Staging-branch reset or deletion and any other provider-setting change are separate actions, each needing its own explicit authorization. Administrative access to a system is not by itself authorization to rotate or revoke a credential; those authorizations are recorded in the credential-change approver and revocation approver rows (approval record §13.1).

### 1.1a Incident Owner acceptance and combined-role arrangement
| Field | Entry |
|---|---|
| Incident Owner (user-selected) | Subash A. V. — `USER-SELECTED — PENDING VERIFICATION` |
| Incident Owner accepts the role and its responsibilities (yes / no) | **Yes.** Confirmed explicitly by Subash A. V. in this conversation on 2026-10-04. Coordination role only; it authorizes nothing and does not verify authority |
| Date accepted | 2026-10-04 |
| Authority verified (SV-5, incident tracker §10) | `________` |
| I-8: is the "database owner" a separate person from the credential-change approver? | **`USER-CONFIRMED: SAME PERSON`**, dated 2026-10-04. The user states: "I am the Neon project/database owner and the credential-change approver." This answers the identity question only. It verifies no permission, establishes no formal authority (SV-1, SV-5) and approves no action; the database-owner and credential-change-approver responsibilities stay distinct acts, and the credential-change approval, the revocation approval and the Phase A2 authorization are not granted |
| Roles proposed for one person | Incident Owner; Neon database administrator; GitHub/repository administrator; Vercel account administrator; credential-change approver; separate revocation approver; Phase A2 read-only review authorizer; Neon console access grantor; hosting/application infrastructure owner |
| Exact actions covered if the Neon administrator may also authorize their own change (approval record §13.1) | **Read-only evidence actions only:** viewing and collecting evidence in the Neon console (IA-06 to IA-10), GitHub (IA-12, IA-13) and the Vercel and infrastructure inventory (IA-14 to IA-16), and only after the read-only review is authorized (IA-02, decision sheet §1.2) and the matching SV items are satisfied. **No change action is covered**: each of G-1 to G-10 (role creation, revocation, branch reset or deletion, deployment or local env changes, untracking, `.gitignore`, JWT, pushes, CI and integrations) needs its own dated written authorization naming the exact action before execution, and any self-authorization for such an action must be recorded separately in advance. No SQL is covered, including Phase A2 |
| Combined-role arrangement recorded in advance by the Incident Owner (date) | 2026-10-04 (confirmed by Subash A. V. as Incident Owner) |
Status: **ACCEPTED (confirmed explicitly by Subash A. V. on 2026-10-04), and the combined-role arrangement is RECORDED for read-only evidence actions only.** Neither is verified authority (SV-5 is pending) and neither is an approval or an authorization. The arrangement is not automatic approval for any individual action and covers no change action: the Neon administrator still does not authorize their own change; the credential-change approval, the revocation approval and the Phase A2 read-only review authorization remain separate recorded acts that are **not granted**; incident coordination, system administration, each authorization and the execution of approved actions remain distinct responsibilities with their own evidence and approval requirements. **Acceptance is recorded for the Incident Owner role only:** the other eight selected roles remain `USER-SELECTED — PENDING VERIFICATION` and no acceptance of any of them is recorded; accepting the Incident Owner role is not acceptance of any other role.

### 1.2 Read-only review authorization (OD-2)
| Field | Entry |
|---|---|
| Read-only review authorizer (the person who grants the authority) | Subash A. V. — `USER-SELECTED — PENDING VERIFICATION` (authority unverified; SV-6) |
| Person who grants Neon console access (the Neon account / project owner) | Subash A. V. — `USER-SELECTED — PENDING VERIFICATION` (ability unverified; SV-7) |
| Is that person the same as the incident owner? as the credential-change approver? (yes / no / unknown for each; not inferred) | As proposed: yes, the same user-selected person as the incident owner and the credential-change approver (not verified; the acts stay separate). I-8: `USER-CONFIRMED: SAME PERSON` (2026-10-04) for the Neon project/database owner and the credential-change approver |
| Person performing the Neon console review | `________` |
| Person preserving logs | `________` |
| Date and time authorization takes effect | `________` |
| Authorization ends | `________` |
| Where the scope below was recorded (private location, no content) | `________` |

**Scope of the read-only review (proposed text; accept, edit or strike):**
- *Permitted:* **view** (do not change) in the Neon console and project settings: branches (names, IDs, parents, default flag, creation dates) behind the application endpoint and the staging endpoint; roles, their attributes and ownership summaries; the date of the last password change for `neondb_owner`; connection and audit log retention and the logs themselves; active connections by role and source; backup / point-in-time recovery status; the provider's documented replacement process.
- *Forbidden:* signing in with, or otherwise testing, the exposed credential; creating, resetting, revoking or deleting any role, password, branch or setting; running **any** SQL against production, including read-only or aggregate queries such as a count of the `users` rows (any future read-only SQL requires a separate, explicit authorization and the applicable approved procedure, for example the Phase A2 record, which is `DRAFT — NOT APPROVED`; none is authorized here); running scratch scripts, migrations, seeds or tests; copying any secret into a message.
- *Deferred (unresolved):* AE-6, what the `users` rows are, was removed from the first message because answering it needs a query. It stays unresolved until a separate authorization exists; outcome A of the target report cannot be confirmed without it (E-4).
- *Log preservation (do first):* export or snapshot provider connection/audit logs, deployment and build logs, and the repository audit log to a private, access-restricted location; record the retention period and the oldest available date; do not edit or delete anything to "tidy" logs.
- *Report immediately to the incident owner, before doing anything else:* unfamiliar sources, unexpected writes or DDL, role or extension changes, large exports, or retention shorter than the exposure window.

Authorization status: **NOT AUTHORIZED.** The authorizer is user-selected and pending verification (SV-6); no authorization exists until the authorizer completes the fields above and the authority is verified. Selecting an authorizer is not authorization to run any SQL. (Read-only viewing needs no gate, but it needs this authority.)

### 1.3 Change window (OD-6; tracker IO-5)
| Field | Entry |
|---|---|
| Start (date, time, time zone) | `________` |
| End | `________` |
| Maximum acceptable interruption per consumer | `________` |
| Observation period before revocation (approval §7 S8) | `________` |
| On-call contact during the window | `________` |
| Who may stop the change (abort authority) | `________` |
| Escalation path | `________` |
| Alert recipient (approval §9.2) | `________` |
| Approved by (name, date) | `________` |
Status: **NOT SET. No window is approved.**

### 1.4 Hosting and secret-store decisions (OD-4, OD-5, OD-7; AE-10, AE-12; Vercel actions are separate, see §1.4a)
| Decision | Entry |
|---|---|
| Permanent hosting platform | `________` |
| Permanent secret store (per-environment values, audit log, who can read/change) | `________` |
| Interim secret store until the platform is live (if different) | `________` |
| Region / proximity to the database, Redis and object storage considered? (yes/no, notes) | `________` |
| Domains / URLs that will replace the `*.vercel.app` callback and webhook URLs | `________` |
| Are live payments (Razorpay) in use today? (OD-5) | yes / no / unknown `____` |
| Is Google or Microsoft sign-in in use today? (OD-5) | yes / no / unknown `____` |
| JWT rotation timing: with the hosting move (recommended) or earlier? (OD-7) | `________` |
| Vercel actions: OD-11 and OD-14 are separate decisions (see §1.4a) | see §1.4a |
| Decided by (name, date) | `________` |
Status: **NOT DECIDED.**

### 1.4a Vercel actions (two separate decisions)
| ID | Decision | Decision (yes / no / other) | Executing owner | Authorizing owner | Gate | Timing and prerequisites | Date decided |
|---|---|---|---|---|---|---|---|
| OD-11 | Disable the Vercel Git integration so a push cannot trigger a build or deployment | `____` | `________` (deployment owner on the Vercel side; repository owner for GitHub app permissions) | `________` | **G-10** (plan V-10) | **before the first push of any commit**; auto-deploy status must be known first (AE-10, P-8) | `____` |
| OD-14 | Delete the Vercel project after migration | `____` | `________` (deployment owner) | `________` | **G-2** (plan V-11) | only **after** the replacement host is validated and traffic moved (V-8), credentials replaced (V-9) and logs/evidence preserved (V-7); deleting the project revokes nothing | `____` |
Neither decision implies the other. Status: **NOT DECIDED.**

### 1.5 Working posture and other near-term decisions (for completeness)
| ID | Decision | Entry |
|---|---|---|
| OD-3 | Treat the configured endpoint as production-capable until the read-only review proves otherwise (recommended) | yes / no `____` |
| OD-8 | Make remediation commits in a clean checkout of `origin/main`, by explicit paths; who commits the existing uncommitted work | `________` |
| OD-9 | Seven scripts: keep sanitized copies outside the repository or discard; ignore by glob or exact paths | `________` |
| OD-10 | Defer the history-rewrite decision until after revocation (recommended) | yes / no `____` |
| OD-12 | Secret-scanning approach | `________` |
| OD-13 | Who owns the uncommitted People-import work (`REQUIRES TEAM CONFIRMATION`) | `________` |

---

## 2. Review of OD-1 and OD-2
### OD-1 Incident owner and authorized approvers
- **Why first:** every other item needs an accountable owner to receive requests and to approve or refuse. Today no approval is recorded in the approval package: decisions are `NOT APPROVED`, and names are `NOT SET` except the user-selected ones (`USER-SELECTED — PENDING VERIFICATION`).
- **Minimum acceptable answer:** a named incident owner; a named person (or role) able to approve **G-1 create** and, separately, **G-1 revoke**; a named approver for **G-2** (each deployment) and **G-3** (each developer machine); names for the database administrator, repository owner and deployment owner. Same person for several roles is acceptable if recorded.
- **Watch for:** separation of approval from execution (the person who approves revocation should not be the only person who verifies it); the revocation approval must be a separate recorded act after consumer sign-offs; a role you cannot fill yet should be marked `NOT SET`, not guessed.
- **If unanswered:** no gate can be requested and no administrator request has an accountable recipient. All workstreams except preparation stay blocked.
### OD-2 Authority for the read-only Neon review and log preservation
- **Why:** it is the only step that can turn `TARGET UNCONFIRMED` into outcome A, B or C, and provider log retention may expire.
- **Minimum acceptable answer:** the authorizer, the person performing the review, the person preserving logs, and the scope in §1.2 (accepted as written or edited).
- **Watch for:** the review stays view-only and does not test the credential; findings that suggest misuse must reach the incident owner before any change; the person reviewing needs console access and must not paste hosts or secrets into messages.
- **If unanswered:** AE-1 to AE-7 cannot be obtained; the target stays unconfirmed and the exposure continues.

## 3. Priority 1 messages (reused, not duplicated)
All drafts remain **`NOT SENT`**. Send them yourself after filling the bracketed placeholders; the wording is in `CREDENTIAL_OWNER_COORDINATION_PACKAGE.md`.
| Rank | Ask | Message | Recipient | Items | Sent |
|---|---|---|---|---|---|
| 1 | Name incident owner and approvers | §2.4 items 1 to 3 | incident owner (you) | OD-1 | NOT SENT |
| 2 | Authorize the read-only review; preserve logs | §2.4 item 2 and §2.1 item 1 | incident owner; Neon administrator | OD-2, AE-4, IO-3 | NOT SENT |
| 3 | Is the 2026-09-19 credential still valid? When was the password last changed? (no sign-in test) | §2.1 item 2 | Neon administrator | AE-3 (DB-1) | NOT SENT |
| 4 | Log retention and review results | §2.1 item 1 | Neon administrator | AE-4 (DB-6, DB-7) | NOT SENT |
| 5 | Branch behind each endpoint; did the staging branch inherit the password? | §2.1 item 3 | Neon administrator | AE-1 (DB-9; E-1, E-2, E-5) | NOT SENT |
| 6 | Repository visibility now and ever; access; forks/clones; push events | §2.2 items 1 to 4 | GitHub owner | AE-8 (GH-1 to GH-3, GH-7) | NOT SENT |
Recommended send order: 1 and 2 first (to you / the incident owner), then 3 to 5 together to the Neon administrator, and 6 in parallel to the GitHub owner. Nothing here was sent.

## 4. Mapping and evidence before any gate
Each response, mapped to its references, with the evidence that must be on record before the related gate may even be **requested**. None is satisfied today.
| Response (ID) | Tracker | Criterion | Gate it feeds | Evidence required (no secrets) | Recorded? |
|---|---|---|---|---|---|
| OD-1 | IO-1, IO-6 | R8 | all gates (who may approve) | named owner and approvers, dated, in approval §13 | no |
| OD-2 | IO-3 | R3 | none (read-only) | dated authorization with scope; log preservation confirmation | no |
| AE-3 | DB-1 | R2 | G-1 (urgency; emergency decision) | last password-change date and validity statement from the console | no |
| AE-4 | DB-6, DB-7 | R3 | G-1 (misuse check) | retention period, oldest date, review conclusion | no |
| AE-1 | DB-9 | R2 (DB-9 is listed under R2 in the tracker) | G-1 (target) | branch names, IDs, parents, default flag, creation dates; inheritance yes/no | no |
| AE-8 | GH-1 to GH-3, GH-7 | R3 | G-8, G-9 (later), informs G-1 urgency | visibility history, access list, forks, push events | no |
| AE-2 | DB-2, DB-3 | R1 | G-1 | role attributes, ownership, `neon_service` | no |
| AE-5 | DB-4, DB-8, DP-1 to DP-3, DP-5 (DP-6 is unmapped to R1 to R10; it feeds G-7 only) | R2, R4 | G-1, G-2 | consumer list, active connections, deployed use | no |
| AE-7 | DB-10 to DB-12 | R5 (DB-10, DB-11); R6 (DB-12) | G-1 | replacement process, privilege outline, backup/PITR | no |
| AE-6 | E-4 (no tracker item) | unmapped to R1 to R10 | not required for G-1; needed to confirm outcome A | **DEFERRED, UNRESOLVED:** removed from the first message because it needs a query; requires a separate, explicit SQL authorization and an approved procedure | no |
| AE-11 | DP-9 | R7 | G-1, G-2 | approved test account and read-only health route | no |
| OD-6 | IO-5 | R6 | G-1, G-2, G-3 | approved window, thresholds, observation period (§1.3) | no |
| OD-4 | n/a | n/a | G-2 (destination), G-10 | platform and secret store (§1.4) | no |
| OD-7 | n/a | n/a | G-6 | JWT timing decision | no |
**Mapping notes:** adding or correcting a mapping marks no criterion met; R1 to R10 remain `NOT MET`. DP-6 and E-4/AE-6 are intentionally unmapped to R1 to R10.
**Gates remain unapproved.** G-1 to G-10 each require, in addition to the evidence: a named approver, a dated explicit approval, and (for the cutover) criteria R1 to R10 met. G-1 revocation additionally needs R10 and all consumer sign-offs. The evidence column above is the minimum; the full list is in `CREDENTIAL_OWNER_COORDINATION_PACKAGE.md` §4.2 and §4.3.

## 5. Next-step summary
- **Decisions you must make:** OD-1 and OD-2 first (§1.1, §1.2); then OD-6 and OD-4 (§1.3, §1.4), OD-3, OD-5, OD-7, OD-8 to OD-14 (§1.4a, §1.5).
- **Questions the administrators must answer (Priority 1):** validity and last change (AE-3); log retention and findings (AE-4); branches behind the two endpoints and inheritance (AE-1); repository visibility, access, push events (AE-8).
- **Evidence required before any gate:** §4 table; for the cutover, R1 to R10 all met.
- **Actions blocked pending approval:** creating or revoking any database role or credential (G-1); changing deployment variables (G-2); changing local env files (G-3); untracking the seven scripts (G-4); `.gitignore` edits (G-5); JWT rotation (G-6); Typesense changes (G-7); history rewrite (G-8); any push or remote branch change (G-9); CI, scanning, Git-integration or repository-security changes (G-10); the hosting move and Vercel retirement; any use of the exposed credential for testing.
- **Status:** cutover **NOT READY**; tracker 39 of 39 `UNANSWERED`; R1 to R10 `NOT MET`; no approval recorded (role names are `USER-SELECTED — PENDING VERIFICATION` where selected, otherwise `NOT SET`).

## Completion statement
Planning document only. Blank by design except the role selections the user communicated on 2026-10-04, recorded as `USER-SELECTED — PENDING VERIFICATION`; no date, decision, authorization or approval was entered. No message was sent and no external service was contacted. No credential was tested, displayed, rotated or revoked. No SQL, migration, seed, scratch script, test or deployment was run. No application code, configuration, database object, Git history or `.gitignore` was changed; nothing was staged, committed or pushed. The People-import files were not read or touched. All existing documents were preserved; the cutover remains `NOT READY`. The only file created is this sheet.
