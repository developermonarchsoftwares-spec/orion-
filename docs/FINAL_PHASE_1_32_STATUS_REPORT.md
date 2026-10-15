# Orion: final status report, Phases 1 to 32

**Date:** 2026-10-13 · **Branch:** `chore/neon-removal-prep` · **HEAD:** `3cf08b3` (1 commit beyond `main`) · **Working tree:** 147 modified, 728 untracked (`git status --porcelain -uall`), 0 staged, no stash. This assessment changed no application code, schema or infrastructure and did not commit, push or deploy.

**Overall verdict: NOT READY FOR PRODUCTION. Classification BLOCKED.** Engineering verification on a developer machine is strong. The release candidate is not in version control, the credentials found in Git history are not rotated, and no production environment, payment integration, alert destination or production-scale restore exists or was evidenced.

## 0. Basis and limits of this assessment

- **Phase definitions.** The original phase prompts are not in the repository. Phases 1 to 32 are taken from the rows of `docs/ORION_CHECKPOINT.md` and the reconciliation in `docs/ORION_REMAINING_WORK_PLAN.md` (Phase 21). Earlier "Steps" (security audit, SG-02, Neon audit, 2A, 2B, groups A and B, dependency commit) are context, not numbered phases.
- **Verified facts** below come from commands run in this assessment (section 5) or from files read. **Unverified claims** are labelled. Statements copied from earlier reports are marked "reported".
- **Status rule.** *Verified Complete*: everything in the phase's scope is implemented and covered by tests or inspection I could re-check, and what remains is only external action, an owner decision, or a Low item. *Partially Complete*: a Medium or higher in-scope code, test or evidence gap remains. *Blocked*: the phase's objective cannot be achieved without something outside the repository. *Unable to Verify*: nothing defines or evidences the phase. *Not Implemented*: nothing exists.

## 1. Phase status matrix

| # | Phase | Status | Evidence and what keeps it from a higher status |
|---|---|---|---|
| 1 | Security re-audit and gap report | **Verified Complete** | `SECURITY_GAP_REPORT.md` exists; findings re-checked against source by later phases; one document-destruction incident (Phase 16) recovered and disclosed in Phase 20 (sections 14 to 16 rebuilt as summaries, labelled) |
| 2 | Remediation plan | **Verified Complete** | `SECURITY_REMEDIATION_PLAN.md` (31 findings, R0 to R11). Plan items R3, R8, R11 not started, R9 blocked, R10 never run: those are work items, not the plan |
| 3 | Secrets and production configuration | **Verified Complete** (repository scope) | SG-01 closed in code; production refuses placeholder or published secrets; `placeholder-secrets.spec` ran in the unit run. SG-02/02b rotation is an external action (section 7) |
| 4 | Authentication and sessions | **Partially Complete** | Lockout, uniform answers, TOTP replay, refresh replay, session binding tested and mutation-checked (`auth-hardening` 23, `admin-session` 8). Open: gateway native-login MFA refusal wiring untested; admin second factor not implemented (decision R-007) |
| 5 | Authorization | **Partially Complete** | 201 API routes inventoried; anonymous and customer refusal tested; API IDOR paths mutation-checked. Gateway native handlers (second backend, R-006) have no repository-level object-level HTTP tests |
| 6 | Credits, unlocks, billing | **Partially Complete** | Locks verified on real PostgreSQL (10/10). Not done: wallet `CHECK` constraints and ledger uniqueness (R-013), refund policy, real payments (R-004). Reconciliation warnings on the local database unexplained |
| 7 | API abuse prevention | **Verified Complete** (local scope) | Pagination bounds, input guard, per-route limits tested. Limits are in-process only (R-014, decision before scaling out); 4 admin import bodies unvalidated (R-058, Low) |
| 8 | SSRF and outbound requests | **Verified Complete** (local scope) | `safe-http` rules mutation-checked in Phase 32 (108 of 183 fail when disabled). No real DNS, TLS or egress filter tested (external) |
| 9 | Export security | **Verified Complete** (local scope) | `export-security` 17 (+1 todo), formula guard mutation-checked. Earlier downloads cannot be recalled (R-008) |
| 10 | Data classification and minimisation | **Verified Complete** (local scope) | `data-classification.spec` 40, `privacy-classification.e2e` 13 (+2 todo). After-unlock disclosure policy is an open decision (R-016) |
| 11 | Data-subject / removal-request intake | **Partially Complete** | Re-verified: `data_subject_requests` table (migration 0024) and `ContactSuppressionService` exist; **no intake service, route or UI** (only `schema/privacy.ts` references the table). R-008 |
| 12 | (undefined) | **Unable to Verify** | No definition, deliverable or checkpoint row anywhere; the only other "Phase 12" in the repository is a People-module numbering |
| 13 | Audit logging and incident response | **Verified Complete** (local scope) | Auth events audited, redactor, same-transaction credit-adjust audit, `INCIDENT_RESPONSE.md`. Audit is not tamper-evident or shipped off-host (R-012, needs a database role and decision) |
| 14 | Headers, production config, dependencies, deployment | **Partially Complete** | Dockerfile/CORS/CSP fixes tested; builds pass. CI never run, images never built (no Docker), web CSP still `'unsafe-inline'` (R-019 architecture change), Node versions differ (R-021) |
| 15 | Data provenance and publication | **Verified Complete** (local scope) | `provenance-publishing.e2e` 27, mutation-checked. No admin UI publish control (R-018, Low); existing sources are UNREVIEWED (behaviour change needing owner approval) |
| 16 | Retention, deletion, backup lifecycle | **Partially Complete** | Ledger, retention job, backup script exist and were run locally (Phases 19, 30). Retention decisions D-RET-1..9 open (R-024); no production restore; old backups keep deleted data (R-077) |
| 17 | Final verification (first) | **Partially Complete** | Superseded: counts were wrong (combined unit+integration figure), verdict "conditional" withdrawn in Phase 20. Replaced by Phases 19, 20, 32 evidence |
| 18 | Findings closure | **Partially Complete** | SG-03, SG-25, L-7 closed with evidence (SG-25/L-7 tests added in Phase 22). SG-24 closure was overstated and fixed in Phase 32 (R-086). "Accepted risk pending approval" labels were never authorised (corrected Phase 20) |
| 19 | Production readiness and rollback planning | **Blocked** | Report and runbook exist; verdict BLOCKED. No production target, no rehearsal, Docker unbuilt, host secrets unverified. Cannot be completed from the repository |
| 20 | Evidence, traceability, handover | **Verified Complete** | Traceability (84 rows), privacy traceability, risk register, handover exist; errata recorded. Rows have since been updated (Phases 22 to 32) |
| 21 | Checkpoint reconciliation and remaining-work discovery | **Verified Complete** | `ORION_REMAINING_WORK_PLAN.md` exists; reconciliation re-confirmed here for Phases 11 and 12 |
| 22 | Prioritised remediation | **Verified Complete** | R-005 guard, suppression expiry, SG-25/L-7 tests; independently re-verified in Phase 23 |
| 23 | Independent regression audit | **Verified Complete** | Found and fixed an incomplete fix (R-032); tests exist and pass |
| 24 | Security monitoring and alert validation | **Partially Complete** | Nine rules over the audit trail, tested with a local sink. **No alert ever reached a real destination** (R-085); detection gaps G-2, G-3, G-5 (R-034) |
| 25 | Access control and privileged operations | **Partially Complete** | Admin session revocation, audit and validation fixed and tested. No least-privilege tier (R-035), no segregation of duties on credit adjustments (R-036) |
| 26 | CI/CD and supply chain | **Partially Complete** | Workflow YAML repaired, actions pinned, CODEOWNERS/Dependabot files added. **Workflow has never run on GitHub**; branch protection, required checks, Vercel settings unverified (R-042, R-047, R-048); no SBOM (R-046) |
| 27 | Database security and transaction integrity | **Partially Complete** | Concurrency bugs fixed, timeouts set, tests pass on real PostgreSQL. No restricted application role or migration role (R-049, R-050, High) because no production database exists |
| 28 | API contract integrity and error handling | **Partially Complete** | 500s and false-success writes fixed on the API and gateway. 76 gateway call sites still hide database failures (R-060); two implementations of the routes (R-063) |
| 29 | Performance and resilience | **Partially Complete** | Pool deadlock, wallet fast path, import recovery fixed and measured. All numbers from one machine; no production-class run (R-069); trigram index undecided (R-065) |
| 30 | Disaster recovery validation | **Partially Complete** | Backup, restore, tamper refusal, ledger re-apply run on a 249 MB synthetic database; bugs fixed (R-071 to R-073). No production restore, no RTO/RPO approved, MFA/integration key dependency (R-075), remote ledger apply refused (R-074) |
| 31 | Incident simulation | **Partially Complete** | Simulated locally with a local alert receiver; four defects fixed (R-079 to R-082). No tamper evidence, no on-call, no real destination (R-085, R-012, R-084) |
| 32 | Security regression coverage and fixed-vulnerability verification | **Partially Complete** | See section 5 |

**Count: Verified Complete 13 (1, 2, 3, 7, 8, 9, 10, 13, 15, 20, 21, 22, 23) · Partially Complete 17 (4, 5, 6, 11, 14, 16, 17, 18, 24 to 32) · Blocked 1 (19) · Unable to Verify 1 (12) · Not Implemented 0.** "Verified Complete" always means within the local scope stated; none means verified in production.

## 2. Verified implementation and test evidence

Re-checked in this assessment:

- Every one of the 50 documents cited in the checkpoint exists; every spec file cited in the register, traceability and final review exists (Phase 32 script); the 12 test files named in the checkpoint rows for Phases 28 to 31 exist; `.github/workflows/test.yml`, `ops/backup/*.sh`, `ops/security/scan-secrets.mjs` exist.
- Git: branch, HEAD, counts above. **Only 2 of the 105 files in `docs/` are tracked.** The documents (one already destroyed and rebuilt once) exist only in the working tree.
- Phase 32 evidence, not repeated here: 27 mutations (23 detected), one new finding fixed (R-086), 21 new HTTP-level tests and 9 unit cases. See `SECURITY_REGRESSION_MATRIX.md` and `SECURITY_REGRESSION_VERIFICATION_REPORT.md`.

## 3. Consolidated unresolved findings (deduplicated; by severity and practical impact)

### Critical
| Finding | Entries merged | State |
|---|---|---|
| Credentials in Git history (database owner credential, two signing secrets); rotation unverified | R-001, SG-02/02b, R-002 (host values) | `test:secrets:history`: **3 distinct values** (re-run today). Blocked on operator |
| The release candidate is not in version control | R-022, R-023 (CI never run), R-030 (documents untracked), SR-DEP-05 | 147 modified + 728 untracked; 22 of 26 migrations untracked; branch unpushed; `origin/main` has 2 commits the branch lacks (5 files will conflict) |

### High
| Finding | Entries merged | State |
|---|---|---|
| Production environment, database, backups, alerts unproven | R-002, R-003, R-085, R-078, R-069 | No production target identified; no alert delivered anywhere real; no production-size restore |
| Real payments absent | R-004 (CR-03/05) | `createOrder` creates a local id; keep payments disabled |
| Web gateway is a second backend | R-006, R-063, R-060, R-059 | Native handlers lack repository-level HTTP tests; divergence risk standing |
| Removal requests from non-customers cannot be received | R-008, Phase 11 | No intake; earlier downloads cannot be recalled; CRM-sync exclusion still a `todo` |
| Retention and legal-hold decisions open | R-024, R-077 | D-RET-1..9 unanswered; privacy notice depends on unverified bucket rules |
| No restricted application or migration database role | R-049, R-050 | Runtime is a superuser locally; production role unknown |
| Recovery dependencies | R-075, R-074, R-071 (mitigated) | Encryption key falls back to the JWT secret; ledger re-apply refused on remote databases; privacy RPO = ledger interval and the ledger job is not scheduled |

### Medium (grouped)
- **Authentication and privilege:** admin single factor (R-007); e-mail verification optional (R-011); no least-privilege tier (R-035); self-credit allowed (R-036).
- **Data integrity:** no wallet `CHECK` / ledger uniqueness (R-013); no unique index for company-level saved leads (R-055, guarded only by a lock); non-atomic quotas (R-054).
- **Logging and detection:** audit not tamper-evident (R-012); detection gaps (R-034, G-2 role/status change leaves no trace); containment writes no audit row (R-084).
- **Supply chain and deployment:** floating Docker images, `npm install` without lockfile, Node 20/22/24 (R-021, R-043); CI not a proven gate, CODEOWNERS/Dependabot inert (R-042, R-047, R-048); web CSP `'unsafe-inline'` (R-019).
- **Scale and resilience:** in-process rate limits (R-014); distributed clients (R-068); retention cap vs volume (R-064); single-machine measurements (R-069).
- **Privacy and legal:** after-unlock disclosure policy (R-016); notice coverage and jurisdiction questions (R-025).
- **Operations:** lock time of index builds unmeasured (R-029); payments after a backup need manual reconciliation (R-076).

### Low / informational
R-009, R-015, R-017 (but see section 4), R-018, R-020, R-026 to R-028, R-044 to R-046, R-051 to R-053, R-056, R-057, R-058, R-061, R-062, R-065 to R-067, R-070, R-083.

No entry is "accepted": no owner has authorised any acceptance in writing.

## 4. Phase 32: regression coverage and test-quality gaps

- **Covered and mutation-proven (Phase 32):** session ending, suspended accounts, role checks, IDOR on integrations, saved leads, unlocks and exports, CSV formula guard, source-trust gating (API and web), suppression and stored-export expiry, address (SSRF) rules, e-mail log scrubbing, wallet row locks and saved-lead lock (real PostgreSQL only), OAuth unverified e-mail, avatar validation, cross-workflow suppression and logout.
- **Blind spots found:** (a) the default suites cannot see removal of the wallet row locks (0 of 126 tests); only the opt-in real-PostgreSQL suite does (3 of 10). That suite is **not in CI** and **refuses any non-empty database**, so every run needs a new one. Phase 32 recommends reading R-017 as Medium for these two controls. (b) The existing HTTP OAuth suite did not guard the unverified-e-mail rule (fixed). (c) Avatar validation had no test and was incomplete (fixed, R-086). (d) No cross-workflow test existed (fixed).
- **Remaining gaps:** controls proven only by historic mutations (Phases 3 to 10, 22 to 31) are PARTIAL in the matrix; gateway route handlers have no repository-level HTTP tests (proofs were scripts outside the repository); three `todo` tests (People export after consent withdrawal, CRM-sync exclusion, reviewer classification correction); two opt-in suites skipped by default (real-PostgreSQL concurrency 10, People review concurrency 13); `health-probes` fails in the full e2e run on a machine without Docker.
- **Phase 32 status: Partially Complete.** The matrix, report, fixes and new tests exist and were re-run today (all new tests pass). It is not complete because the Critical/High items above remain open and because the controls listed as PARTIAL were not all re-proven.

## 5. Exact test results (this assessment, 2026-10-13, working tree)

Machine: Windows 11, Node 24.11.1, PostgreSQL 18.3 local server, no Docker. Exit codes are those of the npm or node command.

| Kind | Command (from `apps/api` unless stated) | Exit | Result |
|---|---|---|---|
| Unit | `npm run test:unit` | 0 | 47 suites passed; **874 passed**, 0 failed, 0 skipped |
| Integration (in-memory PostgreSQL; includes restore, retention, suppression) | `npm run test:integration` | 0 | 43 passed, 1 skipped (opt-in); **979 passed**, 13 skipped, 0 failed |
| Security | `npm run test:security` | 0 | 1 suite, **9 passed** |
| Performance | `npm run test:perf` | 0 | 1 suite, **3 passed** |
| E2E (real Nest app over HTTP, in-memory PostgreSQL) | `npm run test:e2e:all` | **1** | 45 suites passed, 1 skipped, **1 failed**; **688 passed**, 10 skipped, 3 todo, **1 failed** (`health-probes`: `/health` returned 503) |
| Real-PostgreSQL concurrency (opt-in; fresh disposable database `orion_scratch_phase32_final`) | `CONCURRENCY_DATABASE_URL=<local scratch URL> jest --config ./test/jest-e2e.json pg-concurrency` | 0 | **10 passed** |
| Web | `npm test` in `ownus/` | 0 | **270 passed**, 0 failed |
| Static | `tsc --noEmit` API and web; `npx nest build`; `db:migration:check`; `test:inventory` | 0 each | clean; journal 26 entries consistent |
| Secrets | `npm run test:secrets` | 0 | 0 findings in the working tree and git config |
| Secrets (history) | `npm run test:secrets:history` | report-only | **3 distinct values remain** |

- **The one e2e failure** passed 20 of 20 in three isolated reruns during Phase 32; today I did not rerun it (not claimed as re-confirmed). It is timing- and environment-dependent (optional storage down). It is not a security property but it keeps the full e2e exit code at 1.
- **Recovery tests** here are the restore-recovery, restore-mode, retention and migration-recovery suites inside the unit and integration runs (in-memory PostgreSQL) plus the lock/concurrency suite on a real server. **`backup.sh`, `restore.sh` and `verify-restore.sh` were not re-run today**; their evidence is Phases 19 and 30 (reported, local, synthetic data).
- **Not run:** Playwright, web lint (352 known errors, not in CI), Docker builds, GitHub Actions, anything against Neon, Vercel, Typesense, MinIO, Redis, Razorpay, Google, Microsoft, or any deployed environment. **No local result is evidence of production behaviour.**
- Git was unchanged by the runs (147 modified / 728 untracked before and after).

## 6. Environmental limitations

One developer machine acts as load generator, API and database. Hermetic suites use a single-connection in-memory database that cannot show lock behaviour. The local server is used as the `postgres` superuser, so role isolation is untested. Real third parties and the production host were never contacted. The original phase prompts were not available (section 0).

## 7. Outstanding external, manual and production actions (none evidenced as done)

| Action | Owner | Why it cannot be verified here |
|---|---|---|
| Rotate the database owner credential and both JWT secrets; revoke the old Git host token; decide the history rewrite; enable secret scanning and push protection | operator / database owner | Needs the hosts and Git provider; history scan still finds 3 values |
| Verify production secrets (presence, length, not the published values) in the intended store | operator | No host inspected; the pulled Vercel file had the secrets empty |
| Choose and provision the production PostgreSQL provider; create application and migration roles; rehearse migrations (lock time); cut over | operator / DB owner | None exists |
| Live payment provider integration and keys | engineering + operator | Not implemented |
| Configure one real alert destination, roster and on-call; prove delivery; prove the backup ping and CI failure notice | operator | Only a local sink was used |
| Schedule backups with the deletion ledger; verify bucket privacy and lifecycle; run a production-size restore drill and approve RTO/RPO | operator / DR owner | Only synthetic 249 MB local drills |
| Run the CI workflow on GitHub; enable branch protection and required checks; set Vercel production-branch and preview rules; enable CODEOWNERS and Dependabot; two-factor on accounts | release owner | Workflow never executed; provider settings not visible |
| Build and scan the Docker images with the lockfiles; align Node versions | engineering | Docker daemon unavailable |
| Playwright suite on a preview; lint | engineering | Last Playwright run 2026-09-17, before hardening |
| Legal and privacy review: notice for people named in company records, sub-processors, transfers, retention periods, breach commitment, lawful basis for third-party contacts | counsel | No legal advice was given or claimed |
| Business decisions: D-RET-1..9, disclosure policy, source approval, admin second factor, least-privilege tiers, gateway future, offline mode | business owner / security approver | Decisions, not code |
| Network edge: block metadata and private ranges; trusted-proxy setting | operator | Outside the repository |

## 8. Evidence-based readiness verdict

| Area | Verdict | Basis |
|---|---|---|
| Local engineering quality (code, tests, builds) | **Strong** | Today: 874 unit, 979 integration, 9 security, 3 performance, 688 e2e (1 environmental failure), 10 real-PostgreSQL, 270 web; type checks and builds clean; secrets 0 in the tree |
| Security regression confidence | **Partially verified** | Phase 32: 23 of 27 mutations detected, blind spots known and documented |
| Version control and reviewability | **Not ready** | Release candidate uncommitted; 2 of 105 documents tracked |
| Credential hygiene | **Not ready** | 3 secret values in history, rotation not evidenced |
| Production operations (DB, backups, alerts, DR, payments) | **Unverified / blocked** | Nothing exists or was exercised outside the developer machine |
| **Overall** | **BLOCKED: not ready for production** | Two Critical items and seven High items unresolved; all require operator action, owner decisions, or committing the work |

## 9. Smallest prioritised set of remaining actions

1. **Commit the work and the documents** in the checkpoint's group plan (A2 to J), after reviewing the five files that conflict with `origin/main`. Closes R-022, R-030 and enables everything below. *(Needs your approval; not done.)*
2. **Rotate the credentials** (database owner, two JWT secrets, Git token), confirm host secrets, then decide the history rewrite. Closes R-001/R-002.
3. **Run the CI workflow once on a branch**, enable branch protection with the `fast` check required. Closes R-023/R-042/R-048.
4. **Decide the gateway:** retire the native handlers or add repository-level HTTP tests for them (R-006).
5. **Put the real-PostgreSQL suite in CI** against a per-run database (R-017), so lock removal is caught.
6. **When the production database exists:** create application and migration roles, rehearse migrations, run one production-size restore drill, configure and prove one real alert destination (R-003, R-049, R-050, R-085).
7. **Owner decisions:** D-RET-1..9, request intake (Phase 11), admin second factor, payments plan. Define or retire "Phase 12".

Nothing beyond this was started. No Phase 33 was created.
