# Orion security and privacy handover

**Prepared:** Phase 20, 2026-10-12 · **For:** the next maintainer and the release owner · **Tree assessed:** branch `chore/neon-removal-prep`, HEAD `3cf08b3`, plus uncommitted work (144 modified and about 499 untracked files; **nothing here is in a commit**)

> **Release-readiness classification: BLOCKED.**
> This is an assessment, not deployment authorisation, a security certification or a statement of legal compliance. It follows the three-value scale: BLOCKED (a critical or mandatory blocker remains), CONDITIONALLY READY, READY FOR DEPLOYMENT REVIEW.

Reading order: this document, then `SECURITY_REQUIREMENTS_TRACEABILITY.md` (what is verified and how), `SECURITY_RISK_REGISTER.md` (what is open), `PRIVACY_COMPLIANCE_TRACEABILITY.md`, `PRODUCTION_READINESS_REPORT.md`, `PRODUCTION_DEPLOYMENT_RUNBOOK.md`, `ORION_CHECKPOINT.md` (full change log).

## 1. Executive summary

Over twenty phases the application code was audited and hardened: authentication and sessions, authorisation, secret handling, request validation and abuse limits, outbound-request safety, credit and payment integrity, export controls, data provenance and publication, classification and masking, privacy requests and retention, audit logging, headers and configuration, backups and restoration. Most of those controls are implemented and are covered by automated tests that pass on a developer machine (section 5). Several controls are not implemented (for example an intake channel for removal requests, an administrator second factor, tamper-evident audit logs).

**The release is blocked for reasons that are not about code quality:**
1. The hardened work has never been committed, reviewed, pushed or run through CI (R-022, R-023).
2. Credentials that were exposed in Git history have not been rotated (R-001).
3. Production secrets, the production database, the API host, backups and alerting are unverified or do not exist yet (R-002, R-003).
4. Payments cannot work against a real provider (R-004).

Everything below distinguishes four kinds of statement: **implemented in code**, **verified by tests that were actually run**, **dependent on external configuration** (hosts, consoles, people), and **requiring legal review**.

## 2. Scope of the security and privacy work

| Area | Work done (phase) | Where to read more |
|---|---|---|
| Audit and plan | Phase 1 audit, Phase 2 remediation plan | `SECURITY_GAP_REPORT.md`, `SECURITY_REMEDIATION_PLAN.md` |
| Secrets and configuration | Phase 3, 14 | `SECURITY.md`, `ENVIRONMENT_VARIABLES_GUIDE.md` |
| Authentication, sessions | Phase 4, 18 | traceability s2.1 |
| Authorisation | Phase 5 | `AUTHORIZATION_ROUTE_INVENTORY.md` |
| Credits, billing, unlocking | Phase 6 | `BILLING.md`, traceability s2.6 |
| API abuse prevention | Phase 7 | `API_PROTECTION.md` |
| SSRF and ingestion URLs | Phase 8 | traceability s2.5 |
| Exports | Phase 9 | `IMPORT_EXPORT.md` |
| Classification and minimisation | Phase 10 | `DATA_CLASSIFICATION.md`, `PRIVACY.md` |
| Privacy requests, suppression, retention | Phase 11 (partial), 16 | `DATA_RETENTION_POLICY.md`, `PRIVACY_COMPLIANCE.md` |
| Audit logging, incident response | Phase 13 | `INCIDENT_RESPONSE.md` |
| Headers, CORS, dependencies | Phase 14 | `SECURITY.md` s6 to s9 |
| Provenance and publication | Phase 15 | `DATA_PROVENANCE.md` |
| Release verification | Phase 17, 19 | `PRODUCTION_READINESS_REPORT.md` |
| Closure review | Phase 18, 20 | this document and its companions |

Not in scope and not done: penetration testing of a deployed system, load testing, accessibility, a third-party audit, legal review, anything on a real provider or host.

## 3. Verified security controls (summary)

84 requirements are traced in `SECURITY_REQUIREMENTS_TRACEABILITY.md`. At the time of writing: **48 VERIFIED, 19 PARTIALLY VERIFIED, 11 NOT VERIFIED, 0 FAILED, 6 BLOCKED, 0 NOT APPLICABLE** (updated in Phase 25; it was 46 / 17 / 9 / 0 / 6 after Phase 24). "Verified" means implemented and covered by passing evidence in the stated scope (local machine, in-memory and disposable PostgreSQL); it never means verified in production.

Examples of controls with direct, current evidence: login lockout and uniform failures; HS256-only token verification; atomic admin one-time codes; every non-public API route refusing anonymous callers and every role route refusing customers; cross-user isolation of exports, unlocks, wallet and invoices; production refusing missing/placeholder/short secrets and localhost CORS (executed against the compiled API); SSRF address rules (145 unit tests); charge-once unlocks and payments under real concurrent connections (7 tests on PostgreSQL 18.3); export caps and formula guard; no publication without an approved source; account erasure and contact suppression that survive a restore once the deletion ledger is re-applied (executed end to end with real `pg_dump`/`gpg` on test data).

## 4. Requirements traceability summary

| Group | Rows | Verified | Partly | Not verified | Blocked |
|---|---|---|---|---|---|
| Authentication and sessions | 10 | 7 | 2 | 1 | 0 |
| Authorisation and isolation | 9 | 6 | 2 | 1 | 0 |
| Secrets | 6 | 3 | 1 | 0 | 2 |
| Input validation and API protection | 6 | 4 | 2 | 0 | 0 |
| SSRF | 4 | 2 | 1 | 1 | 0 |
| Credits, billing, exports | 10 | 4 | 3 | 2 | 1 |
| Provenance and publication | 6 | 4 | 1 | 1 | 0 |
| Privacy, deletion, suppression, retention | 9 | 6 | 2 | 1 | 0 |
| Backup and restoration | 5 | 2 | 1 | 1 | 1 |
| Logging and incident response | 9 | 4 | 3 | 2 | 0 |
| Headers and configuration | 4 | 3 | 1 | 0 | 0 |
| Dependencies, build, deployment | 6 | 3 | 0 | 1 | 2 |
| **Total** | **84** | **48** | **19** | **11** | **6** |

(Group counts were tallied by script from the status column of `SECURITY_REQUIREMENTS_TRACEABILITY.md`. If you change a row, re-tally.)

## 5. Test and build evidence

**Nothing below is a historical number presented as fresh.** Each line says when and where it was executed.

### 5.1 Executed in Phase 20 (2026-10-12, working tree, this machine)
| Command (from `apps/api`) | Suites | Result |
|---|---|---|
| `jest --config ./test/jest-e2e.json --runInBand` on `admin-auth api-hardening audit-logging auth-hardening authorization export-security financial-integrity privacy-classification provenance-publishing ssrf-ingestion security-headers security-hardening` (matches 13 files) | 13 | **217 passed, 0 failed, 0 skipped, 4 todo** |
| `jest --config test/jest-unit.config.js` on 15 security-related unit files | 15 | **413 passed, 0 failed** |
| `jest --config test/jest-integration.config.js` on `retention-lifecycle privacy.integration people-suppression import-url-safety` | 3 | **47 passed, 0 failed** |
| `CONCURRENCY_DATABASE_URL=<empty disposable local database> jest --config ./test/jest-e2e.json pg-concurrency` | 1 | **7 passed, 0 failed** on PostgreSQL 18.3 with real overlapping connections |

### 5.2 Executed in Phase 19 (2026-10-12), clean copy of the tree without environment files, installed from the lockfiles
`npm ci` (root and `ownus`); `npx tsc --noEmit` for API and web; `npm --prefix apps/api run build`; `npm --prefix ownus run build`; API eslint (0 errors); `npm run test:unit` (802 passed, 1 skipped); `npm run test:integration` (945 passed, 13 skipped); `npm run test:e2e` (581 passed, 7 skipped, 4 todo, 0 failed); in the working tree `npm test --prefix ownus` (258 passed), `npm run test:security` (9 passed), `npm run test:perf` (3 passed), `npm run test:secrets` (0 findings), `npm run test:inventory -- --check` (passed). `npm audit --omit=dev --audit-level=high`: root 2 moderate, web 0. Manual: compiled API in production mode (5 refusals, headers, health, CORS); migrations fresh (26, 68 tables, 0 drift) and upgrade over data; backup, restore, tamper refusal, ledger re-apply.

### 5.3 Not re-run in Phase 20
The full unit, integration and e2e suites, the web suite and both production builds were **not** re-run: Phase 20 changed documentation only, no code or configuration. The Phase 19 results stand as the latest full execution.

### 5.4 Not run at all
Playwright browser suite; Docker image builds; CI (never run); any test against a preview or production deployment; real Google, Microsoft, Razorpay, Typesense, object-storage, Vercel or Neon behaviour; production-scale restore; any alert.

### 5.5 Known flaky test
`health-probes.e2e-spec.ts` is timing-sensitive under load. It failed in some earlier full runs, passed in isolation and in the Phase 19 full run.

### 5.6 Was production behaviour tested?
**No.** Production-mode behaviour was exercised only by running the compiled API locally with `NODE_ENV=production` against a disposable database.

### 5.7 Executed in Phase 22 (2026-10-12, working tree, after the remediation changes)
| Command | Result |
|---|---|
| `npx tsc --noEmit -p apps/api/tsconfig.json`, `-p ownus/tsconfig.json` | clean, clean |
| `npm run test:inventory -- --check`, `npm run test:secrets` | passed; 0 findings |
| `npm run test:unit --prefix apps/api` | 43 suites, **809 passed**, 0 failed |
| `npm run test:integration --prefix apps/api` | 39 suites passed (1 skipped); **947 passed**, 13 skipped, 0 failed |
| `npm run test:security --prefix apps/api` | 9 passed |
| `npm run test:e2e:all --prefix apps/api` | 33 suites passed (1 skipped), **584 passed**, 7 skipped, 3 todo, **1 failed**: `health-probes` (timing-sensitive); re-run alone twice: 20 of 20 passed both times |
| `npm test --prefix ownus` | **264 passed**, 0 failed |
| `npm --prefix apps/api run build`, `npm --prefix ownus run build` | both passed |
Not run: lint (its script auto-fixes files), Playwright, Docker, CI. The opt-in real-PostgreSQL concurrency suite was not re-run (no code it covers changed).

### 5.8 Executed in Phase 23 (2026-10-12, working tree, after one correction)
| Command / check | Result |
|---|---|
| Real HTTP run of the built web app (`next start`) on a disposable database, signed admin token (script in the Phase 23 scratch area, not in the repository) | 15 of 15 checks passed (gateway publish guard) |
| `jest --config ./test/jest-e2e.json scheduled-export` (2 new files, 4 tests) | passed after the correction; the People test **failed on the Phase 22 code** |
| `npx tsc --noEmit` API and web; `npm run test:inventory -- --check`; `npm run test:secrets` | clean; passed; 0 findings |
| `npm run test:unit --prefix apps/api` | 43 suites, **809 passed** |
| `npm run test:integration --prefix apps/api` | 39 suites passed (1 skipped); **950 passed**, 13 skipped, 0 failed |
| `npm run test:security --prefix apps/api` | 9 passed |
| `npm run test:e2e:all --prefix apps/api` | 35 suites passed (1 skipped); **588 passed**, 7 skipped, 3 todo, **1 failed** (`health-probes`, timing-sensitive; 20 of 20 on two isolated reruns) |
| `npm test --prefix ownus` | **264 passed** |
| `npm --prefix apps/api run build`, `npm --prefix ownus run build` | both passed |
Not run: lint, Playwright, Docker, CI.

### 5.9 Executed in Phase 24 (2026-10-12, working tree)
| Command / check | Result |
|---|---|
| `npx tsc --noEmit` API and web; `npm run test:inventory -- --check`; `npm run test:secrets` | clean; passed; 0 findings |
| `npm run test:unit --prefix apps/api` | 45 suites, **840 passed** |
| `npm run test:integration --prefix apps/api` | 40 suites passed (1 skipped); **962 passed**, 13 skipped |
| `npm run test:security --prefix apps/api` | 9 passed |
| `npm run test:e2e:all --prefix apps/api` | 37 suites passed (1 skipped); **598 passed**, 7 skipped, 3 todo, **1 failed** (`health-probes`; 20 of 20 on two isolated reruns) |
| `npm test --prefix ownus` | **264 passed** |
| API and web production builds | both passed |
Alert delivery: tested to a local receiver and a test sink only. **No real destination exists; production delivery is not verified.**

## 6. Outstanding risk register summary

Full detail: `SECURITY_RISK_REGISTER.md`.
- **Critical (2):** R-001 exposed credentials not rotated; R-022 release candidate uncommitted.
- **High (6):** R-002 host secrets unverified; R-003 production operations unproven; R-004 real payments absent; R-006 gateway is a second backend; R-008 no intake or full honouring of removal requests (Phase 22: suppression now covered end to end for detail, unlock history, new exports and stored export files; intake, downloaded files and CRM sync still open); R-024 retention and backup-tail decisions open.
- **Medium (14):** admin second factor, gateway publish bypass (R-005: **verified closed** in Phase 23; R-032, a People-suppression gap in the Phase 22 stored-export fix, found and fixed in Phase 23), remote ledger re-apply, e-mail verification default, tamper-evident audit, wallet constraints, in-process rate limits, disclosure policy, CSP `unsafe-inline`, Docker/Node alignment, CI never run, privacy notice gaps, migration lock times, untracked documentation.
- **Low / informational (8).**
- No risk is recorded as "accepted": no owner has accepted any in writing.

## 7. Privacy and compliance limitations

Full detail: `PRIVACY_COMPLIANCE_TRACEABILITY.md`.
- Orion is **not** certified or declared compliant with GDPR, CCPA/CPRA, DPDP or any other regime. Technical controls exist for customer access, export, erasure, consent and retention; they have been tested only on disposable databases.
- People named in company records are data subjects who have **no channel** to ask for removal; the intake workflow (Phase 11) was never built; exports made earlier are not re-filtered; the privacy notice does not mention them.
- Deleted data remains in backups for up to about 12 months and cannot be scrubbed; a restore is safe only if the deletion ledger is re-applied.
- Retention periods for financial records, audit events, logs and import payloads are undecided; no statutory period has been asserted anywhere.
- Legal entity details, sub-processors, transfers, minimum age and breach-notification commitments are missing from the pages. Nine jurisdiction questions for counsel are listed in section 5 of the privacy traceability document.

## 8. Operational documentation and recovery readiness

| Need | Document | State |
|---|---|---|
| Environment configuration | `ENVIRONMENT_VARIABLES_GUIDE.md`, `.env.production.example`, runbook s3 | Names only; production values unverified |
| Secret responsibilities | runbook s1 and s3, `CREDENTIAL_*` documents | Owners "NOT SET" |
| Build and test commands | runbook s2.3, section 5 above | Verified on Node 24 |
| Migrations | `MIGRATION_RUNBOOK.md`, runbook s4 | Verified on disposable databases; production state unknown |
| Backup and restore | `BACKUP_AND_DISASTER_RECOVERY.md`, `ops/backup/*`, runbook s11 | Verified at test scale; no RTO/RPO evidence |
| Monitoring and escalation | `OBSERVABILITY.md`, `HEALTH_CHECKS.md`, `INCIDENT_RESPONSE*.md` | Documented; alerts never seen to fire; contacts are placeholders |
| Privacy request processing | `PRIVACY_COMPLIANCE.md` s5, `PEOPLE_SUPPRESSION.md` | Customer flow built; non-customer flow not built |
| Finding remediation | `SECURITY_RISK_REGISTER.md`, `SECURITY_REMEDIATION_PLAN.md` | Current |
| Deployment and rollback | `PRODUCTION_DEPLOYMENT_RUNBOOK.md` | Draft, unapproved, nothing executed on production |

Rollback reality: Drizzle has no down-migrations; reverting code does not reverse a migration; the runbook's recovery options are forward-fix, targeted restore, or full restore.

## 9. Production-readiness status

**BLOCKED.** To reach CONDITIONALLY READY the release owner must at least: commit and review the work and get CI green (R-022, R-023); rotate the exposed credentials (R-001); verify host secrets (R-002); identify and rehearse the production database and API host (R-003). To reach READY FOR DEPLOYMENT REVIEW the open High items must be fixed or explicitly decided by their owners, and the runbook's smoke tests must pass on a preview deployment.

## 10. Required manual actions and approvals

| # | Action | Role |
|---|---|---|
| 1 | Approve and perform the commit grouping; merge `origin/main`; push a branch; run CI | `[RELEASE OWNER]` |
| 2 | Rotate the database owner credential and both JWT secrets; revoke the old Git token; decide on rewriting history; enable secret scanning with push protection | `[OPERATOR]`, `[SECURITY APPROVER]` |
| 3 | Set fresh production secrets in the intended stores; verify presence and length only | `[OPERATOR]` |
| 4 | Choose the production database and API host; rehearse migrations on a production-size copy; record lock times | `[OPERATOR]`, `[DATABASE OPERATOR]` |
| 5 | Schedule encrypted backups with the ledger; configure bucket privacy, versioning and lifecycle; prove an alert; run a timed restore drill | `[OPERATOR]`, `[DR OWNER]` |
| 6 | Decide D-RET-1..9, the disclosure policy, the admin second factor, e-mail verification, gateway future, CSP architecture | `[BUSINESS OWNER]`, `[COUNSEL]`, `[SECURITY APPROVER]` |
| 7 | Finish the removal-request workflow and publish a notice and a channel; have counsel review the pages | `[PRIVACY OWNER]`, `[COUNSEL]`, `[ENGINEERING LEAD]` |
| 8 | Keep payments disabled until a real provider integration and live keys exist | `[ENGINEERING LEAD]` |
| 9 | Approve the behaviour changes listed in the runbook (imports wait for an administrator; existing sources start UNREVIEWED) | `[BUSINESS OWNER]` |

## 11. Recommended remediation priorities

1. Version control and CI (R-022, R-023): everything else depends on having a reviewable release candidate.
2. Credential rotation and host secrets (R-001, R-002): the largest real-world exposure.
3. Production target and operations (R-003, R-029, R-021): choose, rehearse, measure.
4. Removal-request workflow (R-008) and the retention/backup decisions (R-024): the privacy commitments the notice already makes.
5. Gateway future and publish bypass (R-006, R-005), administrator second factor (R-007), audit protection (R-012), wallet constraints (R-013).
6. Hygiene: CSP nonces, lint debt, inline DTOs, advisories, Docker alignment.

## 12. Handover checklist for the next maintainer

- [ ] Read this document, the risk register and the checkpoint (`ORION_CHECKPOINT.md`, sections 1, 2 and 7).
- [ ] Confirm the state: `git status`, `git log -1`, `git diff --cached --name-only` (expect nothing staged), `git stash list` (expect none).
- [ ] Rebuild the evidence: `npm ci`, `npm --prefix ownus ci`, `npm --prefix packages/shared run build`, both `tsc` checks, both builds, `npm run test:unit`, `npm run test:integration`, `npm run test:security`, `npm run test:e2e`, `npm --prefix ownus test`, `npm run test:secrets`, and the opt-in concurrency suite against an empty disposable local database.
- [ ] Never run a script with `--apply`, and never connect to or change a shared or production database, without the approvals in section 10. The destructive scripts refuse non-local databases and need `CONFIRM_DESTRUCTIVE_DATABASE` plus a backup under 24 hours old.
- [ ] Never edit an applied migration; create new ones with `npm run db:migration:new --prefix apps/api -- <name>`; check with `db:migration:check` and `db:audit`.
- [ ] Keep the documents under version control. In Phase 16 an editing script opened three documents for writing before reading them and truncated them; they were recovered from the editor's file history (sections 1 to 13) and sections 14 to 16 were rebuilt as summaries and labelled as such. **Read before writing; commit documents.**
- [ ] Do not paste secrets into documents, tickets or chat. Evidence files here contain no credentials; `.vercel/.env*.local` and `apps/api/.env` are git-ignored local files with real values and must stay that way.
- [ ] Re-tally `SECURITY_REQUIREMENTS_TRACEABILITY.md` section 3 after changing any row.
- [ ] Fill the placeholders (`[ROLE]`, "NOT SET") in the runbook, the incident documents and the register as people are named.
- [ ] Remove scratch databases when no longer wanted (never `orion_db`): `orion_scratch_phase6_*`, `orion_scratch_phase19_*`, `orion_scratch_phase20_conc`, `orion_db_restore_verify_*`.

## 13. Documentation integrity note (read this)
Three documents (`SECURITY_GAP_REPORT.md`, `SECURITY_REMEDIATION_PLAN.md`, `SECURITY_TEST_PLAN.md`) were truncated by an error of mine in Phase 16 and later phases appended to the truncated files without noticing. In Phase 20 they were rebuilt from the editor's saved history (sections 1 to 13, original text) plus rebuilt summaries of Phases 13 to 15 (sections 14 to 16, **reconstructed, shorter than the originals**, labelled in the files) plus the Phase 16 to 18 sections that survived. Details that existed only in the lost text of Phases 13 to 15 are gone. The other documents were compared with their saved history; none had shrunk.
