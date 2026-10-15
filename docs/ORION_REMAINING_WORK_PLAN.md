# Orion remaining work plan (Phase 21 reconciliation)

**Assessed:** 2026-10-12 · **Method:** read-only inspection of the repository, the checkpoint, the security documents and the code, plus four cheap commands executed during this assessment (section 6.1). Nothing was changed except this file and one checkpoint row. Phase prompts were **not** assumed to have been executed; each row below rests on what is in the tree and the evidence that exists.

## 1. Current repository and checkpoint status

| Item | Value (checked 2026-10-12) |
|---|---|
| Branch / HEAD | `chore/neon-removal-prep` / `3cf08b3` (dependency fix). Unpushed, no upstream |
| Working tree | 144 tracked files modified, 324 untracked entries in `git status --short` (many directories collapsed; about 499 untracked source, test, ops, CI and documentation files when listed individually in Phase 19). Staged: 0. Stash: none |
| Not in any commit | **All** Phase 3 to 21 work: hardened code, tests, 22 of 26 migrations, `.github/workflows/test.yml`, `ops/`, and every document written since Phase 1 |
| `origin/main` | 2 commits ahead of the branch (five files will conflict) |
| Authoritative checkpoint | `docs/ORION_CHECKPOINT.md` (single file, header says last updated 2026-10-12, Phases 1 to 20, **BLOCKED**) |
| Authoritative current security picture | `SECURITY_RISK_REGISTER.md` (open items), `SECURITY_REQUIREMENTS_TRACEABILITY.md` (what is verified), `PRODUCTION_READINESS_REPORT.md` (verdict and evidence), entry point `ORION_SECURITY_PRIVACY_HANDOVER.md` |
| Release classification | **BLOCKED** (unchanged by this assessment) |

### 1.1 Expected documents: present and missing
Present: gap report, remediation plan, test plan, test results, audit reports, privacy audit, final review, risk register, requirements traceability, privacy traceability, production readiness (two files), deployment runbook, handover, retention policy, incident response (two files), backup/DR, SG-02 remediation, 13 `CREDENTIAL_*` documents, People module documents.
**Missing or never produced:** any definition or deliverable for security **Phase 11** (request intake design) and **Phase 12** (no row in the checkpoint, no document; the only "Phase 12" text in the repository is an older People-module review-screen phase, a different numbering); an independent penetration-test report; a Record of Processing Activities; a sub-processor list; any CI run log.

### 1.2 Documentation conflicts (not silently resolved)
| Conflict | Where | Recommendation |
|---|---|---|
| Two "phase" numberings: People-module phases (6.x, 12, 13) and the security phases (1 to 21) | `PEOPLE_*.md` vs checkpoint | Say "security Phase N" in new text; no rewrite of history |
| `PRODUCTION_READINESS.md` (2026-10-07 note plus a Phase 17 section) and `PRODUCTION_READINESS_REPORT.md` (Phase 19) | `docs/` | Keep both; the first now carries a "superseded in part" banner |
| `SECURITY_FINAL_REVIEW.md` (CONDITIONALLY READY, closure matrix) vs risk register and traceability | `docs/` | The review carries a Phase 20 erratum; treat it as history |
| Checkpoint section 7 still holds stale or contradictory items: item 2 (SG-01) is marked closed in a list titled "open decisions"; items 19 to 21 say the Phase 17 gate passed and recommend finishing Phase 11 "before Phase 17"; section 6 commit plan statuses were never updated; section 2 working-tree counts are from Phase 18 | `ORION_CHECKPOINT.md` | Minimal reconciliation: mark items 2, 20, 21 as superseded by item 22; refresh section 6 and the section 2 counts when the commit is made. Not done here (history is preserved) |
| Three security documents contain **reconstructed** summaries for Phases 13 to 15 | gap report s14-16, remediation plan s14-16, test plan s12-14 | Keep the labels; if the original text ever turns up, restore it |
| Many overlapping credential and privacy documents (13 `CREDENTIAL_*`, `PRIVACY.md`, `PRIVACY_COMPLIANCE.md`, `PRIVACY_AUDIT_REPORT.md`, `PIPELINE_RUNTIME_RISK_REGISTER.md`) | `docs/` | Leave; point to the register as the single list of open risks |
| `SECURITY_TEST_RESULTS.md` dates from 2026-10-09 and predates every hardening phase | `docs/` | Treat as history; the test plan sections hold later results |
| ~~One traceability row was overstated: `SR-AUTH-08`~~ | `SECURITY_REQUIREMENTS_TRACEABILITY.md` | **Resolved in Phase 22:** tests added for SG-25 and L-7 (W-22); the row now cites them |

## 2. Phase reconciliation

Status words as specified. "Scope" is the narrowest reading of what the phase delivered; open items are named, not hidden.

| Phase | What the tree shows | Status | Notes / evidence |
|---|---|---|---|
| Pre-phase: local import fix, full verification (2026-10-08/09) | Code and tests exist | VERIFIED_COMPLETE | historical results; reproduced in suites |
| 1 Security audit and re-audit | `SECURITY_GAP_REPORT.md`, audit reports | VERIFIED_COMPLETE | sections 1-13 restored from history (see 1.2) |
| SG-02 credential step | Remote token removed; scanner `ops/security/scan-secrets.mjs` + CI step; rotation not done | IN_PROGRESS (rotation BLOCKED) | history scan still shows 3 values (executed in Phase 19) |
| Neon audit, DB safeguards (Step 2A/2B), backups, safety copy | `db-guard.ts`, scripts, journal guard | VERIFIED_COMPLETE (local scope) | Neon removal itself BLOCKED (no target) |
| Dependency commit `3cf08b3` | Committed | VERIFIED_COMPLETE | only commit of the whole effort; audit 2 moderate |
| 2 Remediation plan | `SECURITY_REMEDIATION_PLAN.md` | VERIFIED_COMPLETE as a plan | plan items R3, R8, R9, R10, R11 not delivered (below) |
| 3 Secrets and production configuration | `config/secrets.ts`, `env.validation.ts`, OAuth simulation gate | VERIFIED_COMPLETE (code) | host values BLOCKED (EXT) |
| 4 Authentication and sessions | `auth/*` | VERIFIED_COMPLETE with open items | admin second factor NOT STARTED (R3 of the plan) |
| 5 Authorization | guards, route inventory, tests | VERIFIED_COMPLETE (API) | gateway handlers lack object-level tests |
| 6 Credits, unlocks, billing | locks, validation, reconcile script | VERIFIED_COMPLETE (locks, 7 real-PostgreSQL tests) | wallet constraints, refund policy NOT STARTED; real payments BLOCKED |
| 7 API abuse prevention | guard, pagination, throttles | VERIFIED_COMPLETE | limits in-process only |
| 8 SSRF and ingestion URLs | `safe-http.ts`, `public-url.util.ts` | VERIFIED_COMPLETE (unit/e2e scope) | no real DNS/TLS/egress test |
| 9 Export security | export service, CSV guard | VERIFIED_COMPLETE | 2 `todo` tests = open requirement |
| 10 Classification and minimisation | `data-classification.ts` | VERIFIED_COMPLETE | disclosure policy undecided |
| 11 Data-subject requests and suppression | table, trigger, `ContactSuppressionService` (added in Phase 16) | **IN_PROGRESS** | no intake service, route, UI or tests for the request workflow; no checkpoint row exists for this phase |
| 12 (no definition found) | nothing | **NOT STARTED** | scope unknown; do not treat as done |
| 13 Audit logging, incident response | audit events, redactor, docs | VERIFIED_COMPLETE | audit tamper protection, off-host shipping NOT STARTED |
| 14 Headers, configuration, dependencies, deployment | headers, CORS, `.dockerignore`, CI file | IMPLEMENTED_NOT_VERIFIED for CI and containers; VERIFIED_COMPLETE for headers/config | CI never run (two defects found and fixed by hand in Phase 19); no image ever built; Node 20/22/24 mix |
| 15 Provenance and source trust | `0025_source_trust`, publishing rules | VERIFIED_COMPLETE (API path) | gateway status screen bypass; no admin UI; behaviour change unapproved |
| 16 Retention, deletion, backup lifecycle | retention job, ledger, backup scripts | VERIFIED_COMPLETE (test scale) | production parts BLOCKED; produced the documentation incident (below) |
| 17 Final verification and release readiness | report sections in several documents | IMPLEMENTED_NOT_VERIFIED | its test counts were wrong ("1,726 unit"), verdict superseded; underlying results reproduced in Phase 19 |
| 18 Findings closure | OAuth e-mail check, avatar validation, password length cap, admin logging | IMPLEMENTED (partly verified) | SG-03, SG-24 have tests; **SG-25 and L-7 have none** (IMPLEMENTED_NOT_VERIFIED) |
| 19 Production readiness | report, runbook, 5 defects fixed | VERIFIED_COMPLETE (assessment) | verdict BLOCKED |
| 20 Evidence, traceability, handover | four documents, errata, recovery of three documents | VERIFIED_COMPLETE (documentation) | one row overstated (1.2); recovered documents contain rebuilt summaries |

### 2.1 Plan items (R-numbers of the remediation plan) with no delivering phase
| Item | Status |
|---|---|
| R3 admin second factor, token storage/redirect hardening | NOT STARTED (admin factor); token handling not re-examined in this assessment |
| R5 company-contact controls | IN_PROGRESS (register and trigger built; export filtering and intake missing) |
| R6 gateway short-term controls | IN_PROGRESS (route policy built; no object-level tests) |
| R8 privacy documents and public removal route | NOT STARTED (pages reviewed, not changed; no route) |
| R9 image build | BLOCKED (Docker daemon unavailable) |
| R10 CI proves itself | IMPLEMENTED_NOT_VERIFIED (never run) |
| R11 independent penetration test of staging | NOT STARTED (no staging exists) |

### 2.2 Work documented but not implemented
Admin second factor; removal-request intake; tamper-evident/off-host audit; wallet `CHECK` constraints and ledger key; refund policy for unlocked leads; shared rate-limit store; CSP nonces; admin publish control; real payment orders; audit expiry and log retention enforcement.

### 2.3 Implemented but not tested
SG-25 password cap; L-7 admin logging; the two new CLI scripts against a real server beyond the Phase 19 manual run; the gateway's native handlers over HTTP; Typesense search; object storage; Docker images; CI.

### 2.4 Tests that failed, were skipped or could not run
Opt-in real-PostgreSQL suite skipped by default (passed when enabled); `health-probes` e2e is timing-sensitive (failed in some loaded runs, passed in others); 13 integration and 7 e2e tests skipped by design; 4 `todo` tests are open requirements; Playwright suite not run since 2026-09-17 (see 6); the remote-only staging suite is not runnable locally.

### 2.5 Findings marked fixed without sufficient evidence (corrected in Phase 20, listed so they stay visible)
SG-04, SG-05, SG-14, SG-18 (closed in Phase 18 text, actually partial); SG-02b/SG-06/SG-07/SG-08/SG-11 (labelled "accepted", never accepted); SG-25 and L-7 (closed with no dedicated test).

### 2.6 Uncommitted / needing review
Everything in section 1. Additionally, the three recovered documents deserve a read-through by their owner because Phases 13 to 15 are summaries.

## 3. Verified completed work (within the local scope; no production verification exists)
Authentication and session controls; API authorisation and customer isolation; production configuration refusals; request guard, pagination, rate limits; SSRF address rules and URL sanitising; charge-once unlock/payment/refund under real concurrent connections; export caps, formula guard and download headers; provenance and publication gates (API); classification and masking; account erasure; contact suppression and re-entry blocking; retention job; deletion ledger and restore (test scale); audit events; API headers and CORS; dependency state (2 moderate); fresh and upgrade migrations with zero drift; clean-copy builds. Evidence and dates: `SECURITY_REQUIREMENTS_TRACEABILITY.md`. Totals there: 76 requirements, 45 verified, 15 partly, 10 not, 0 failed, 6 blocked.

## 4. Unverified or incomplete work
See sections 2.2, 2.3 and 5. In short: everything that needs a host, a provider, a person or a decision; the request-intake workflow; the admin second factor; the gateway's second backend.

## 5. Outstanding findings

### 5.1 Critical and High (confirmed against the register and the code)
| ID | Sev | Evidence | Component | Status | Production impact | Required action | Local or external |
|---|---|---|---|---|---|---|---|
| R-001 (SG-02/02b) | Critical | `npm run test:secrets:history` executed in Phase 19: 3 distinct values in history; scan of the tree: 0 findings (re-executed now) | repository history, DB owner role, JWT secrets | BLOCKED | Credential exposure persists; forged sessions possible if a signing secret is still live | Rotate DB owner password and both JWT secrets; revoke old Git token; decide history rewrite; enable push protection | **External** (operator) |
| R-022 | Critical | `git status`: 144 modified, 324 untracked entries, HEAD journals 3 of 26 migrations | whole repository | OPEN | Nothing deployable exists in Git | Commit in the checkpoint's groups, review, merge `origin/main`, push a branch | **Local action, needs approval** |
| R-002 (GATE-02) | High | pulled Vercel file has JWT secrets empty; no host inspected | Vercel / API host | BLOCKED | Outage on wrong value; reuse of exposed values | Set fresh secrets; check presence only | External |
| R-003 | High | no target DB/host; no alert fired; only a 40 KB restore | production operations | BLOCKED | Failures unnoticed; unknown recovery time | Choose provider/host; rehearse; prove alert and backup; timed restore | External |
| R-004 (CR-03/05) | High | `createOrder` creates a local id | payment module | OPEN | Real payments cannot work | Provider orders, order records, live keys; keep disabled | Local build + external keys |
| R-006 (SG-06) | High | 62 native gateway handlers; no HTTP-level object tests | `ownus/.../route.ts` | OPEN, decision pending | Authorisation drift between two backends | Proxy-only or test every native handler | Local, needs decision |
| R-008 (SG-05 residual) | High | no request service/route; 2 `todo` tests | privacy workflow, exports | OPEN | People named in records have no channel; earlier exports keep values | Finish Phase 11; decide export treatment; publish notice | Local + decision + counsel |
| R-024 | High | D-RET-1..9 unanswered; backup lifecycle unverified | retention policy | OPEN, decision pending | Notice promises periods nobody has verified | Written decisions; verify bucket rules | External |

### 5.2 Medium (14) and Low (7), informational (1)
Medium: R-005 gateway publish bypass; R-007 admin single factor; R-010 remote ledger apply refused; R-011 e-mail verification default; R-012 audit not tamper-evident; R-013 no wallet constraints plus reconciliation warnings; R-014 in-process rate limits; R-016 disclosure policy; R-019 CSP `unsafe-inline`; R-021 Docker/Node reproducibility; R-023 CI never ran; R-025 privacy notice gaps; R-029 migration lock times unmeasured; R-030 documents untracked. Low: R-009, R-015, R-017, R-018, R-020, R-026, R-027. Informational: R-028. Details, owners and decisions: `SECURITY_RISK_REGISTER.md`. **New from this assessment, appended to the register by reference, not edited into it:** SG-25 and L-7 untested (Low, task W-22); checkpoint section 7 stale items (Low, documentation).
No severity was lowered. No item has been accepted by an owner.

## 6. Test and build gaps

### 6.1 Executed during this assessment (2026-10-12)
| Command | Result |
|---|---|
| `npm run test:secrets` | 0 findings (working tree and git config) |
| `npm run db:migration:check` (apps/api) | consistent: 26 entries, newest `when` 1799500000002 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | clean |
| `npx tsc --noEmit -p ownus/tsconfig.json` | clean |

### 6.2 Historical (not re-run now)
| Check | Last execution | Result |
|---|---|---|
| API unit / integration / e2e (clean copy) | Phase 19, 2026-10-12 | 802 / 945 / 581 passed; 1 / 13 / 7 skipped; 0 failed; e2e 4 todo |
| Web unit | Phase 19 | 258 passed |
| Security / performance | Phase 19 | 9 / 3 passed |
| Security subset, unit subset, integration subset, real-PostgreSQL concurrency | Phase 20 | 217 + 4 todo / 413 / 47 / 7 passed, 0 failed |
| API and web production builds, lint | Phase 19 | builds pass; API lint 0 errors; web lint 352 errors (not in CI) |
| Migrations fresh and upgrade, `db:audit` | Phase 19 | 68 tables, 0 drift; no row lost |
| Backup, restore, tamper refusal, ledger re-apply | Phase 19 | worked at 40 KB test scale |
| Playwright browser suite (10 spec folders under `tests/`) | report dated 2026-09-17, **before any hardening** | 57 passed, 4 failed, 3 skipped; **not run since**; its behaviour on the hardened code is unknown |

### 6.3 Not run
Playwright on current code; load test (`ops/testing/load-test.mjs`); remote-only staging suite; Docker image builds; CI; any preview or production check; real Google/Microsoft/Razorpay/Typesense/storage; production-scale restore and alert test; independent penetration test.

### 6.4 Coverage gaps
Gateway native handlers over HTTP; SG-25 and L-7; two `todo` requirements (suppression in exports); live Typesense; web UI flows after hardening (browser suite); concurrency suite not in CI; scripts folder not type-checked by `tsc`/CI.

## 7. Production deployment blockers
B1 uncommitted release candidate (R-022/R-023); B2 unrotated credentials (R-001); B3 unverified host secrets (R-002); B4 real payments (R-004, feature gate only); B5 no production database or API host, no rehearsal (R-003); B6 no alert or production-scale restore evidence (R-003). Plus decisions that gate launch of the privacy commitments (R-008, R-024).

## 8. External approvals and manual actions
Operator: rotation, host secrets, provider and host choice, backups with ledger, bucket privacy and lifecycle, alert destination, restore drill, network egress filter. Release owner: commit approval, merge, CI. Business owner: D-RET-1..9, admin second factor, e-mail verification default, disclosure policy, gateway future, behaviour changes (imports wait for an administrator; existing sources start UNREVIEWED). Counsel: pages, jurisdiction questions, retention periods, sub-processors. Written owner acceptance for any risk that is to be carried.

## 9. Prioritised remediation sequence

Ordered by confirmed security risk first, then by dependency. "W" numbers are tasks, not phases. Each has acceptance criteria.

| # | Task | Why now | Acceptance criteria | Dependency |
|---|---|---|---|---|
| W-1 | Rotate exposed credentials; verify host secrets (R-001, R-002) | Largest real-world exposure; unblocks everything | New values live in the intended stores; old DB owner password and JWT secrets no longer work (tested with a harmless connection and a token signed with the old secret); `test:secrets:history` finding list handled per the SG-02 plan; recorded in the change request without values | Operator access |
| W-2 | Commit the work in reviewable groups, merge `origin/main`, push a branch (R-022) | Without it nothing else can be deployed or reviewed | Every file in the checkpoint commit plan committed or explicitly excluded (179 media files); no secrets in the diff (`test:secrets` 0); branch builds from a clean clone; documents committed | Approval of grouping |
| W-3 | Run CI on that branch and fix first-run failures (R-023) | Establishes an independent gate | Workflow green on the branch; secret scan, audit, type checks, builds and all suites pass in CI | W-2 |
| W-4 | Choose production database and API host; rehearse migrations on a production-size copy; record lock times (R-003, R-029) | Deployment has no target | `db:rehearsal` before/after compare ok; `db:audit` no findings; lock and import-throughput numbers recorded; written runbook steps filled for the chosen host | W-1, owner decision |
| W-5 | Finish the removal-request workflow and decide treatment of earlier exports (R-008) | Largest privacy gap; two todo tests | Intake route/form with identity verification; admin handling calls `ContactSuppressionService`; todo tests become passing tests; notice and channel published; end-to-end test of request → suppression → re-import refused | Owner + counsel decisions |
| W-6 | Decide D-RET-1..9; verify bucket lifecycle and backup schedule; run a timed restore with ledger on the target (R-024, R-003) | Privacy notice promises depend on it | Decisions written; lifecycle rules observed in the console; restore time recorded; alert proven to fire once | W-4 |
| W-7 | Gateway: make it a pure proxy or add object-level HTTP tests; close the status-screen publish bypass (R-006, R-005) | Authorisation drift; unreviewed publication | Either no native business handlers remain, or each has tests equal to the API's; publishing an UNREVIEWED source's business through any path is refused (test) | Decision |
| W-8 | Administrator second factor (R-007) | Single-factor admin | Admin sign-in needs a second factor; enrolment and break-glass documented; tests; lockout-safe rollout | Decision |
| W-9 | Wallet `CHECK` constraints and ledger uniqueness migration; run reconciliation on a production copy (R-013) | DB-level financial integrity | New migration (never edit applied ones); constraints applied on a copy without violations; `db:reconcile-credits` hard checks pass; warnings explained | W-4 |
| W-10 | Audit hardening: append-only role, off-host shipping, expiry decision (R-012) | Evidence can be erased by the app credential | Application role cannot update/delete audit rows (test); shipping verified; expiry set | Decision D-RET-3 |
| W-11 | Payments (R-004) only if payments are to launch | Feature gate | Provider order creation, server-side order records, reconciliation, live keys, webhook against the provider's test mode then live | Business decision |
| W-12 | Shared rate-limit store before more than one API instance (R-014) | Limits double per instance | Counters shared across two instances in a test | Scale decision |
| W-13 | Container and runtime alignment (R-021): one Node version, `npm ci` with lockfiles, `engines` | Reproducible images | Image builds from the lockfile; verified on the chosen Node; scripts folder added to type checks | Docker available |
| W-14 | Re-run the Playwright suite on the current code; fix tests or product regressions (6.2) | UI flows untested since before hardening | Suite runs against a local stack; failures triaged and fixed or recorded | Local stack |
| W-15 | Preview-deployment checks: headers, cookies, CORS, runbook section 6 smoke tests (R-019 evidence) | Production-only behaviour | All smoke tests pass on the preview | W-3, W-4 |
| W-16 | Independent penetration test of staging (plan R11) | No external test has ever been done | Report received; critical/high findings fixed or owned | W-15 |
| W-17 | Privacy pages reviewed by counsel; sub-processor list; RoPA (R-025) | Legal accuracy | Counsel sign-off recorded; pages updated | Counsel |
| W-18 | Decisions with small code changes: disclosure policy (R-016), e-mail verification default (R-011), CSP nonces (R-019), inline DTOs (R-015) | Hardening | Each decision recorded; change tested | Owner |
| W-19 | Hygiene: web lint errors (fix the `rules-of-hooks` error first), advisories, source maps, `/health` semantics, concurrency suite in CI (R-026, R-027, R-028, R-017) | Low risk | Lint errors reduced to an agreed baseline and enforced in CI | none |
| W-20 | Add the real-PostgreSQL concurrency suite to CI | Only evidence for lock correctness | Runs against a service database in CI | W-3 |
| W-21 | Reconcile the checkpoint (section 1.2): mark stale items superseded, refresh section 2 and the commit plan | Single source of truth | Checkpoint sections 2, 6 and 7 consistent with this plan | W-2 |
| ~~W-22~~ | **DONE in Phase 22 (uncommitted):** tests for SG-25 (unit boundary + HTTP) and L-7 (structural) | Evidence honesty | Tests exist, pass, and fail when the control is removed (mutation-proven); row updated | none |

Meaningful work remains, so this is a plan, not a closing statement. The verified scope (local, disposable databases) is otherwise complete; the remaining items are decisions, external actions and the specific engineering tasks above.

## 10. Recommended next action
Approve **W-2** (commit grouping) and start **W-1** (rotation) in parallel with the operator; both are prerequisites for every deployment step. The only engineering work that needs no decision and carries confirmed risk is **W-22** (a small test) and, once the commit exists, **W-3**.

## 11. Limits of this assessment
It is read-only apart from this file and one checkpoint row. Four commands were executed (6.1). Everything else is read from files or earlier reports and is labelled historical. No host, provider or production system was contacted. The status classifications are judgements from the evidence available on this machine.

## 12. Progress log (Phase 22, 2026-10-12)
| Task | Result |
|---|---|
| W-22 | Done (see table). |
| W-7 (partly) | R-005 mitigated in the tree: the gateway status screen refuses PUBLISHED for a business whose recorded source is not APPROVED. **Not done:** HTTP-level handler test; retiring or fully testing the native handlers (R-006 stays open). |
| W-5 (partly) | Suppression now removes the contact from detail, unlock history and new exports (tested), expires stored export files on suppression and on restore, and the service is registered in the module. **Not done:** the intake workflow, treatment of files already downloaded, CRM-sync exclusion test. |
| All other tasks | Unchanged: each needs a decision, an external action, or Docker/CI/hosts (W-1 to W-4, W-6, W-8 to W-21). |
Everything remains uncommitted; the release classification is still BLOCKED.

## 13. Progress log (Phase 23, 2026-10-12)
| Task | Result |
|---|---|
| W-7 (part) | R-005 verified closed over real HTTP. R-006 (the gateway as a second backend) is unchanged and open. |
| W-5 (part) | Stored-export expiry now covers company contacts, people and restore, independently verified; one incomplete fix (People) was corrected. Still open: intake, downloaded files, CRM-sync test. |
| New small follow-ups | Turn the Phase 23 HTTP script for the gateway guard into a repository test once the Next route can be exercised in CI; add a CRM-sync exclusion test with a HubSpot double. |
All other tasks unchanged; everything remains uncommitted; BLOCKED.

## 14. Progress log (Phase 24, 2026-10-12)
| Task | Result |
|---|---|
| Monitoring (new, from the Phase 24 brief) | Nine security alert rules added on the existing alert pipeline and tested; plan and runbook written (`SECURITY_MONITORING_PLAN.md`, `SECURITY_MONITORING_RUNBOOK.md`). **Delivery to a real destination is not proven**; that is part of W-4/W-6 and the operator tasks in the runbook section 9.1. |
| New follow-up | W-23: decide which missing detections to add (administrator role changes, suppressed-record probing, cross-customer 404 counting, session supersession): risk R-034. |
| Logging | Two logger weaknesses found and fixed (R-033). |
Everything remains uncommitted; BLOCKED.

## 15. Progress log (Phase 25, 2026-10-12)
| Task | Result |
|---|---|
| W-8 (administrator second factor) | **Unchanged and open.** Related: administrator sessions are now revocable (R-037 fixed). |
| New W-24 | Decide least privilege between ADMIN and SUPER_ADMIN and segregation of duties for credit adjustments (R-035, R-036). Acceptance: written decision; the chosen operations restricted by `@Roles(SUPER_ADMIN)`; tests that an ADMIN is refused and a SUPER_ADMIN allowed. |
| New W-25 | Turn the gateway HTTP checks (publish guard, administrator session flow) into repository tests that start the built web app, once CI exists (W-3). |
| New W-26 | Audit role and account-status changes (R-034 G-2) after deciding where they are made. |
Everything remains uncommitted; BLOCKED.
