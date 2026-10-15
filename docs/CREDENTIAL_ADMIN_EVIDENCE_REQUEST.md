# Credential exposure: evidence request for administrators and owners (RR-25, Phase 2)

**Status: REQUEST ONLY. Nothing has been answered, and no remediation is authorized by this request.** Date prepared: 2026-10-03. Related: `CREDENTIAL_EXPOSURE_ASSESSMENT.md` (what was found locally), `CREDENTIAL_EXPOSURE_REMEDIATION_PLAN.md`, `CREDENTIAL_REMEDIATION_CHANGE_CHECKLIST.md` (gates G-1 to G-10), `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (the approval package these answers feed).

## How to answer (read first)
1. **Do not send any secret.** Do not paste or attach passwords, connection strings, tokens, API keys, JWT secrets, `.env` contents or screenshots that show them. Answer with yes/no, dates, counts, names of roles, names of variables and names of systems. If a console screen shows a secret, redact it before sharing.
2. **Do not test the exposed credential to answer a question.** In particular do not attempt to sign in with it to see whether it still works. Use the provider's own role, password-change and log views. If you believe a test is necessary, say so; it would be a separate, approved activity.
3. **Reading is not changing.** Every request below is a read-only look at a console, setting or log. Do not rotate, revoke, create, delete, re-link or change anything while answering. Changes need the approvals described in the approval package.
4. **If you cannot answer, say so** (write `CANNOT DETERMINE` and the reason, for example "logs not retained that long"). A missing answer is recorded as unresolved. It is not read as "no exposure".
5. Reply in the response fields below or in a separate note that cites the question IDs. Keep the reply in a private channel with restricted access.

**Why these questions.** Locally, the credential for the database role `neondb_owner` was found in seven tracked scripts, in 23 Git revisions (first commit time 2026-09-21 14:52 +0530; last 2026-09-25), and in two local ignored env files. Whether the credential is still valid, who could read the repository, and what the deployments hold cannot be established from this machine. Please do not treat any statement here as confirmation of misuse; the aim is to find out.

**Known time anchors (all +0530 as recorded on this machine):** credentials existed locally by 2026-09-19 (local env files last modified); a local snapshot of the Vercel production environment is dated 2026-09-17; the first commit containing the credential has commit time 2026-09-21 14:52 (a client-set time); this machine first saw that commit on the remote at 2026-09-21 21:58. These are local observations, not provider-side facts.

---

## A. Database administrator (provider console and database)
Respondent: `NOT SET` · Date answered: `NOT SET`

| ID | Question | Why it matters | Acceptable evidence (no secrets) | Response |
|---|---|---|---|---|
| DB-1 | Is the credential for `neondb_owner` that was current on 2026-09-19 still valid? When was the password for this role last changed or reset? | decides urgency, whether the exposed value is still live, and how stale the local env files are | the console's role or password-change history, stated as a date; do not test by signing in | `[ ]` |
| DB-2 | What are the attributes and privileges of `neondb_owner`? Does it own the application schemas and objects (tables, sequences, views, functions)? Can it create or alter roles, bypass row-level security, or reach other databases or projects? Which provider-managed administrative group is it a member of? | confirms the severity and what a replacement role must not inherit. The existing documents show only that roles named `neondb_owner` and `neon_service` were seen; object ownership and attributes are not confirmed | a role list with attributes and ownership summary (names only), or the read-only role evidence checks C11a to C11g in the Phase A2 checklist if the owner has approved running them | `[ ]` |
| DB-3 | What is the role `neon_service`, who or what uses it, and could it be affected by a change to `neondb_owner`? | it appeared with `neondb_owner` in earlier audits and is not in the consumer inventory | provider documentation reference or console description (names only) | `[ ]` |
| DB-4 | Which applications, hosts, jobs and people are known to connect as `neondb_owner` (the Orion API, the gateway, migration or seed runs, audit runs, a deployed Pipeline, backup or reporting tools, developer machines, rehearsal branches)? Does any other role share this password? | the consumer inventory must be complete before any cutover or revocation | a list of consumers by name and owner; yes/no for shared passwords | `[ ]` |
| DB-5 | Which endpoints are in use (pooled and direct) and how many are there per project and branch? | a replacement must cover both | endpoint types and counts (no host names needed) | `[ ]` |
| DB-6 | What access, connection and audit logs are available? What is the **retention period**? Do they cover at least from the credential's last change (or, if unknown, from before 2026-09-17) to today? | decides whether misuse can be detected at all; short retention is itself a finding | the retention setting and the oldest available date | `[ ]` |
| DB-7 | Within the retained logs, was the role used from any source, region or time that is unfamiliar? Any unexpected writes, schema changes, role or extension changes, new roles, or large exports? | exposure assessment | a short statement and counts; keep the raw logs preserved, do not share them with secrets | `[ ]` |
| DB-8 | What connections are active right now, by role and source type (application host, developer address, unknown)? Is that information available? | identifies unknown consumers | counts by role and source category | `[ ]` |
| DB-9 | Which database **branches** exist in the project (names, parents, creation dates)? Was any branch created from the production branch, for rehearsal or any other purpose? Did it inherit `neondb_owner` and its password? Does the provider give branch-specific credentials or reset them on branch creation? | a branch normally starts with the parent's roles, so it may still accept the exposed credential | list of branches with parent and date; yes/no for inheritance | `[ ]` |
| DB-10 | What is the safest **supported** process to replace the credential: reset the owner password, or create a least-privilege application role and move consumers to it? Does the provider allow both? What happens to existing pooled and direct connections on a password reset, and how long does it take to take effect? | selects the strategy (cutover approval package §4) | provider documentation references and the administrator's recommendation | `[ ]` |
| DB-11 | For a least-privilege role: which privileges would it need on the application schemas (tables, sequences, default privileges), and which operations still require the owner (migrations, role administration)? Can the owner credential be kept sealed for migrations and break-glass? | defines the replacement role's scope | a privilege outline (names, not secrets) | `[ ]` |
| DB-12 | Is a backup or point-in-time recovery available for the production database, with what retention, and who can start a restore? | recovery path if misuse or a failed change is found | yes/no and retention | `[ ]` |
| DB-13 | What maintenance window and abort conditions does the administrator require? | cutover planning | window and conditions | `[ ]` |

---

## B. GitHub repository owner
Respondent: `NOT SET` · Date answered: `NOT SET`

| ID | Question | Why it matters | Acceptable evidence | Response |
|---|---|---|---|---|
| GH-1 | Is the repository public, internal or private **now**? Has it **ever** been public, even briefly? When did visibility last change? | if it was ever public, treat the credential as permanently disclosed | settings page and the audit log entry (dates) | `[ ]` |
| GH-2 | Who has or had access: collaborators, teams, outside collaborators, deploy keys, installed apps, personal tokens with read access, and integrations such as the deployment platform? Who has been removed and when? | defines who could have read the commits | list of roles and access type; names only if appropriate | `[ ]` |
| GH-3 | How many forks, mirrors, archives and watchers exist? Are any outside the organisation? Is clone or traffic data available? | copies cannot be recalled | counts from the network and insights pages | `[ ]` |
| GH-4 | The 23 credential-bearing revisions were authored under **two** identities (20 under an identity different from the one configured on this machine, including the first one, 1cdf261; 3 under the configured identity). Who are the people or systems behind each identity, and on which machines do their clones live? Was 1cdf261 created on a machine other than this one? | the first credentialed commit reached this machine only by pulling; other clones and local copies of the credential may exist | names of owners and machines (not the credential) | `[ ]` |
| GH-5 | Do pull requests, closed branches or other hidden refs (for example pull-request refs) keep the credential-bearing commits reachable? Are there unmerged branches containing them? | cleanup after rotation must cover these | list of branches and PRs by number | `[ ]` |
| GH-6 | Does the repository have security alerts or secret-scanning alerts? Which were raised, when, and who received them? Is push protection available and enabled? | evidence of earlier detection and of what the plan supports | alert list (without secret text), plan capability | `[ ]` |
| GH-7 | What does the audit or security log show about when the credential-bearing commits were first **pushed** (per-push times), from which accounts or tokens, and about any clone, fork or access event after that? | the only precise exposure start; local data gives only an interval (commit time 2026-09-21 14:52, first seen on the remote by this machine at 21:58 +0530) | push event timestamps and actor type | `[ ]` |
| GH-8 | Was any CI run or workflow in the hosting account run for these commits, and could its logs contain the values? (No workflow files exist in the repository itself.) | logs may hold copies | yes/no and where | `[ ]` |

---

## C. Deployment owner (Vercel project and any other host)
Respondent: `NOT SET` · Date answered: `NOT SET`

Locally there is a link to a Vercel project and a snapshot of the production environment (dated 2026-09-17). The snapshot lists variable **names** for the database, the JWT secrets and the Typesense key, but their values are empty there. Please answer from the live project settings.

| ID | Question | Why it matters | Acceptable evidence (no secrets) | Response |
|---|---|---|---|---|
| DP-1 | Do the **production** environments (Orion API and gateway, and any other project) use the same database credential that is in the repository's scratch scripts? Answer by comparing, without disclosing: for each of `DATABASE_URL` and each `DB_*` variable, state whether the role is `neondb_owner` and whether the password matches the exposed one (the administrator can answer match/no match from the provider's change history if comparing is not appropriate) | decides whether a rotation affects production | yes/no per variable; role name only | `[ ]` |
| DP-2 | Same question for **preview** and **development** environments, and for any other project or team linked to the same database | preview deployments often copy production values | yes/no per environment | `[ ]` |
| DP-3 | Does production use either of the JWT values committed in `docker-compose.yml` (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)? Same for preview. Are the API and the gateway set to the same pair? | forged sessions are possible if they match; rotation signs everyone out | yes/no per variable and environment | `[ ]` |
| DP-4 | Why are the values empty in the pulled snapshot: are the variables marked sensitive, intentionally empty, or unset in that environment? List, by name, which variables exist in each environment and which are marked sensitive | the snapshot cannot be interpreted without this | list of names with a sensitive yes/no | `[ ]` |
| DP-5 | What other services, scheduled jobs, hosts, containers, serverless functions, queues or integrations connect to the database with `neondb_owner`: a deployed Pipeline instance, cron or background workers, analytics, backup or reporting tools? | missed consumers fail at revocation | list by name and owner | `[ ]` |
| DP-6 | Is the Typesense development key (the literal default committed in the repository) used by any deployed instance? Is `SEARCH_PROVIDER` set to `typesense` anywhere deployed? Which Typesense instances exist and who administers them? | decides whether the Typesense item is needed | yes/no, instance names | `[ ]` |
| DP-7 | Do build or deployment logs, preview comments or exported logs contain any of the values? Is a log retention or deletion setting available? | other copies | yes/no | `[ ]` |
| DP-8 | Which secret-management mechanism does each deployment use, who can read the values, and who can change them? | defines the cutover mechanism and approvers (G-2) | description and named owners | `[ ]` |
| DP-9 | Is there a designated, pre-existing test account (not a real customer) approved for post-cutover sign-in checks? Is there a read-only way to check the database component of the API's health (the comprehensive health check, not the liveness probe)? | validation without creating production data | yes/no and the route name | `[ ]` |

---

## D. Incident owner (coordination)
Respondent: `NOT SET`

| ID | Question | Response |
|---|---|---|
| IO-1 | Who is the incident owner and the named approver for each role in the approval package (database administrator, application owner, deployment owner)? | `[ ]` |
| IO-2 | Has this been reported to anyone else who must know (security contact, customers, regulators), and by whom? Decide outside this document | `[ ]` |
| IO-3 | Are logs and evidence being preserved before any remediation change (provider logs, deployment logs, repository audit log)? | `[ ]` |

## What happens with the answers
They are recorded in `DATABASE_CREDENTIAL_CUTOVER_APPROVAL.md` (confirmed facts versus unresolved questions) and used to update the incident documents. No remediation step is taken on the basis of this request alone. Every change (credential, deployment variables, local env files, untracking, `.gitignore`, JWT, Typesense, history, pushes, CI or security settings) needs its own explicit approval at the corresponding gate G-1 to G-10.

## Completion note
Prepared from local files and Git metadata only. No external service was contacted, no credential was tested, and no secret value appears in this request.
