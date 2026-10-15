# Security and privacy risk register

**Prepared:** Phase 20, 2026-10-12 · Tree: HEAD `3cf08b3` plus uncommitted work · Classification of the release: **BLOCKED** (`PRODUCTION_READINESS_REPORT.md`).

## 1. Rules used
- **Severity is never lowered because a fix is hard.** Where a finding keeps its original severity from the gap report, that is stated. Where only a narrower residual remains, the residual's severity is given and the original is quoted.
- **Nothing is "accepted".** A risk is accepted only when its owner has authorised that in writing. No such authorisation exists in the repository, so earlier labels of "accepted risk pending approval" are replaced here by **OPEN, decision pending**. Owners are placeholders (`[ROLE]`) until named.
- **Type:** *Confirmed vulnerability* (exploitable weakness observed in code or test), *Confirmed gap* (a required control is not implemented), *Potential risk* (plausible, not demonstrated), *Unverified concern* (cannot be checked from here), *Process* (about how work is done).
- **Release impact:** *Blocks release*, *Blocks a feature*, *Fix before scale*, *Track*.
- Findings keep the IDs used in `SECURITY_GAP_REPORT.md` (SG-xx) where they exist; R-xxx is this register's numbering.

## 2. Summary

| Severity | Open | IDs |
|---|---|---|
| Critical | 2 | R-001, R-022 |
| High | 6 | R-002, R-003, R-004, R-006, R-008, R-024 (decision) |
| Medium | 16 open (R-005 closed in Phase 23; R-034 added in Phase 24; R-035, R-036 added in Phase 25) | R-035, R-036, R-034, R-007, R-010, R-011, R-012, R-013, R-014, R-016, R-019, R-021, R-023, R-025, R-029, R-030 |
| Low | 8 | R-041, R-009, R-015, R-017, R-018, R-020, R-026, R-027 |
| Informational | 1 | R-028 |
| **Closed in this phase** | 1 | R-031 (inaccurate earlier reports, corrected) |
| **Phase 32 addition** | 1 | R-086 (Low, found, fixed and tested in Phase 32; see `SECURITY_REGRESSION_VERIFICATION_REPORT.md`). The register now holds 86 entries. Also from Phase 32: the real-PostgreSQL suite (R-017) was measured to be the **only** guard for wallet-lock removal (0 of 126 default tests notice) and for the saved-lead lock (R-055), so R-017's severity should be read as Medium for those two controls |

Closed technical findings (SG-01, SG-03, SG-09, SG-10, SG-13, SG-19 to SG-25, AZ-01, CR-03 and the Phase 3 to 18 items) are in `SECURITY_REQUIREMENTS_TRACEABILITY.md` with their evidence; they are not repeated here.

## 3. Critical

### R-001 · Credentials exposed in Git history (SG-02 / SG-02b)
- **Type:** Confirmed vulnerability · **Severity:** Critical (original: Critical / High)
- **Component:** repository history, `docker-compose.yml`, hosting secrets
- **Evidence:** `npm run test:secrets:history` (Phase 19, 2026-10-12): 3 distinct secret values remain in history, including a database owner credential and the signing-secret defaults. The working tree is clean (`npm run test:secrets` 0 findings).
- **Impact:** if the repository was ever public, anyone with a clone can use any still-valid credential. A signing-secret match would allow forged sessions.
- **Remediation:** rotate the database owner credential and both JWT secrets; revoke the old Git host token; decide on a history rewrite (`SECURITY_REMEDIATION_SG02.md`); turn on secret scanning with push protection.
- **Status:** BLOCKED on operator action. · **Responsible:** `[OPERATOR / DATABASE OWNER]` · **Decision:** approve rotation and the history rewrite. · **Release impact:** Blocks release.

### R-022 · The release candidate is not in version control
- **Type:** Process / Confirmed gap · **Severity:** Critical (release blocker, not an attack path)
- **Component:** the whole repository
- **Evidence:** `git status`: 144 tracked files modified, about 499 untracked source, test, ops, CI and documentation files; 22 of 26 migrations untracked (HEAD's journal has 3 entries); `.github/workflows/test.yml` untracked; branch unpushed; `origin/main` has 2 commits the branch lacks (five files will conflict).
- **Impact:** a build from any commit lacks the security work and the schema it depends on; the work has no history, no review and no recovery except local copies (a documentation-destroying edit in Phase 16 was recoverable only because of an editor-tool history).
- **Remediation:** commit in the groups of the checkpoint's commit plan, review, merge `origin/main`, run CI.
- **Status:** OPEN · **Responsible:** `[RELEASE OWNER]` · **Decision:** approve commit grouping and the commit. · **Release impact:** Blocks release.

## 4. High

### R-002 · Production environment values unverified (GATE-02)
- **Type:** Unverified concern · **Severity:** High
- **Component:** Vercel project settings, API host
- **Evidence:** the pulled Vercel production file has the JWT secrets empty; no host was inspected. The API refuses to start on missing, short or placeholder secrets (tested, Phase 19), so a wrong value is an outage rather than a silent weakness; a **valid-looking value reused from the repository history** would not be caught by shape checks except for the known published ones.
- **Remediation:** set fresh secrets in the intended store; check presence and length only; follow runbook section 3.
- **Status:** BLOCKED · **Responsible:** `[OPERATOR]` + `[SECURITY APPROVER]` · **Decision:** confirm in the change request. · **Release impact:** Blocks release.

### R-003 · Production operations unproven: database, backups, alerts, restore at scale
- **Type:** Unverified concern · **Severity:** High
- **Component:** production database provider (not chosen), backup schedule, alert destinations
- **Evidence:** no production database or API host identified; no rehearsal on a target provider; only a 40 KB test restore (2 s); no alert has ever fired; backup schedule and bucket configuration unverified.
- **Remediation:** run runbook sections 4 and 6 on a production-size copy; prove one alert and one scheduled backup with ledger; time a restore.
- **Status:** BLOCKED · **Responsible:** `[OPERATOR / DR OWNER]` · **Decision:** choose provider and host. · **Release impact:** Blocks release.

### R-004 · Real payment integration absent (CR-03 / CR-05, GATE-03)
- **Type:** Confirmed gap · **Severity:** High
- **Component:** `payment/razorpay.service.ts` (`createOrder` creates a local id; no provider order)
- **Evidence:** `PRODUCTION_READINESS.md`; webhook and crediting logic tested against a simulation only (`financial-integrity.e2e-spec.ts` 26, `pg-concurrency` 7).
- **Impact:** real checkout cannot work; enabling payments on the current code would mis-credit or fail.
- **Remediation:** provider orders API, server-side order records, reconciliation, live keys.
- **Status:** OPEN · **Responsible:** `[ENGINEERING LEAD]` · **Decision:** keep payments disabled until done. · **Release impact:** Blocks a feature (payments).

### R-006 · The web gateway is a second backend (SG-06 / H-3)
- **Type:** Confirmed vulnerability class (design) · **Severity:** High (unchanged from the gap report)
- **Component:** `ownus/src/app/api/v1/[...path]/route.ts`
- **Evidence:** the gateway contains native handlers (62 per the route inventory) that re-implement business rules; deny-by-default route policy and many controls were added, but no HTTP-level object-level tests exist; behaviour when `BACKEND_API_URL` is unset in production is unverified.
- **Impact:** any rule fixed in the API can remain unfixed in the gateway; authorisation drift.
- **Remediation:** make the gateway a pure proxy, or test every native handler as the API is tested.
- **Status:** OPEN, decision pending (not accepted by any owner) · **Responsible:** `[ENGINEERING LEAD]` · **Decision:** retire or test. · **Release impact:** Fix before scale; blocks if `BACKEND_API_URL` is not guaranteed in production.

### R-008 · Removal requests from non-customers cannot be received or fully honoured (SG-05 residual, Phase 11)
- **Type:** Confirmed gap · **Severity:** High (SG-05 was High)
- **Component:** `data_subject_requests` (table only), `ContactSuppressionService`, exports
- **Evidence:** no service, route or UI creates or handles requests; the privacy notice does not mention business contacts. **Phase 22 progress:** a suppression now removes the contact from the detail page, unlock history and new exports (e2e test), expires stored export files, and the same happens on restore; `ContactSuppressionService` is registered in the module. Still open: files already downloaded cannot be recalled, CRM-sync exclusion is an untested `todo`, and there is still no intake.
- **Impact:** individuals named in company records have no channel; a removal is possible only if an operator runs the service; earlier exports keep the value. Legal exposure depends on jurisdiction (counsel).
- **Remediation:** finish Phase 11 (intake, verification, admin handling); define handling of earlier exports; publish a notice and channel.
- **Status:** OPEN · **Responsible:** `[ENGINEERING LEAD]`, `[PRIVACY OWNER]` · **Decision:** channel, verification standard, treatment of earlier exports. · **Release impact:** Blocks the people/contact features for launch unless an operator process is approved.

### R-024 · Retention, backup tail and legal-hold decisions are open (D-RET-1..9)
- **Type:** Unverified concern (decisions) · **Severity:** High
- **Component:** `DATA_RETENTION_POLICY.md`
- **Evidence:** nine decisions listed; financial retention, audit expiry, log retention, import payload period, 12-month backup tier, legal hold, CSV lifecycle, who runs suppressions, remote ledger apply.
- **Impact:** the privacy notice promises a 12-month backup tail and 3-year request records that depend on configuration nobody has verified; the right periods are not known.
- **Remediation:** obtain written decisions from the business owner and counsel; verify bucket lifecycle rules.
- **Status:** OPEN, decision pending · **Responsible:** `[BUSINESS OWNER]`, `[COUNSEL]` · **Decision:** D-RET-1..9. · **Release impact:** Blocks release of the privacy commitments as written.

## 5. Medium

| ID | Finding | Type | Component | Evidence | Impact | Remediation | Status | Responsible | Decision | Release impact |
|---|---|---|---|---|---|---|---|---|---|---|
| R-005 | Gateway status screen could publish a business from an UNREVIEWED source (SG-04 residual; original High, residual admin-only path rated Medium) | Confirmed vulnerability | `ownus/.../route.ts` status handler; trigger blocks REVOKED only | Phase 15 open item. **Phase 22:** confirmed in code (direct `UPDATE businesses SET status`), then guarded by `lib/publish-guard.ts`; `publish-guard.test.ts` 6 passed, mutation-proven | An administrator could publish unreviewed data around the source-trust gate | Done: refuse PUBLISHED when the recorded source is not APPROVED (record with no source unaffected). Remaining: HTTP-level test of the handler, or retire it (R-006) | **VERIFIED_CLOSED (Phase 23)** for the reported weakness: guard shown over real HTTP (15 of 15). Residual by design: a business with no recorded source can still be published from the screen; uncommitted | `[ENGINEERING LEAD]` | none | Closed once committed |
| R-007 | Administrator sign-in is a single factor plus an e-mailed code (SG-07) | Confirmed gap | `auth/admin-auth.controller.ts` | no second factor implemented | A phished or compromised admin mailbox plus password gives admin access | WebAuthn / TOTP for administrators | OPEN, decision pending | `[SECURITY APPROVER]` | choose factor | Fix before launch |
| R-010 | Remote disaster-recovery re-apply of the deletion ledger is refused by design | Confirmed gap | `scripts/deletion-ledger.ts` via `assertDestructiveAllowed` | Phase 16/19 | A production restore cannot follow the documented sequence without an approved exception | Approve a documented exception or a remote-safe procedure | OPEN | `[DR OWNER]` | D-RET-9 | Fix before launch |
| R-011 | Registration can proceed with e-mail unverified when `REQUIRE_EMAIL_VERIFICATION` is off (SG-11) | Confirmed gap | `auth.service.ts` registration path | plan evidence at `auth.service.ts:93` | Address squatting; weakens OAuth linking assumptions | Require verification in production | OPEN, decision pending | `[BUSINESS OWNER]` | policy | Fix before launch |
| R-012 | Audit trail is not tamper-evident, not shipped off-host, and its events never expire | Confirmed gap | `audit_logs` | application role can write and delete | An attacker with the application credential can erase evidence; indefinite retention of events | Append-only role, off-host shipping, expiry decision | OPEN | `[SECURITY APPROVER]` | D-RET-3 | Fix before launch |
| R-013 | No database `CHECK` constraints on wallets and no ledger uniqueness key (CR-02); reconciliation warnings unexplained (9 wallets, 5 expiry rows, 57 unlock charges without a row) | Confirmed gap / Unverified concern | `credit_*` tables | Phase 6 reconciliation on the local database | A code defect could corrupt balances without the database objecting | New migration; run `db:reconcile-credits` on a production copy | OPEN | `[ENGINEERING LEAD]` | approve migration | Fix before launch |
| R-014 | All rate limits are in-process (not shared between API instances) | Potential risk | `@Throttle`, traffic module | documented limitation | With two instances every limit doubles; lockout counters are database-backed, throttles are not | Table-backed or Redis counter | OPEN | `[ENGINEERING LEAD]` | before scaling out | Fix before scale |
| R-016 | After-unlock disclosure of personal/unknown contact values and proprietor PAN is a policy constant, default permissive | Potential risk | `DISCLOSURE_POLICY` | Phase 10 | Customers receive more than may be appropriate | Decide policy | OPEN, decision pending | `[PRIVACY OWNER]` | policy | Fix before launch |
| R-019 | Web CSP allows `'unsafe-inline'` scripts (SG-08) | Confirmed gap | `ownus/src/lib/security-headers.ts` | strict CSP is report-only | XSS would not be contained by CSP | Nonces + dynamic rendering | OPEN, decision pending | `[ENGINEERING LEAD]` | accept architecture change | Fix before launch |
| R-021 | Images are not reproducible from the lockfile; Node versions differ (Docker 20, CI 22, Vercel 24, verified on 24) | Confirmed gap | Dockerfiles, CI, `.vercel/project.json` | Phase 19 | A production image can contain versions nobody audited; behaviour on Node 20/22 unverified | `npm ci` with lockfiles, one Node version, `engines` | OPEN | `[ENGINEERING LEAD]` | choose version | Fix before launch |
| R-023 | CI has never run | Process | `.github/workflows/test.yml` (untracked) | two defects found and fixed in Phase 19 by hand | Unknown further first-run failures; no automated gate | Commit and run | OPEN | `[RELEASE OWNER]` | none | Blocks release (with R-022) |
| R-025 | Privacy notice does not cover people named in company records, sub-processors, transfers, age, breach commitment | Unverified concern (legal) | `privacy/page.tsx`, `terms/page.tsx` | page text reviewed in Phase 20 | Possible transparency gaps; jurisdiction-dependent | Counsel review | OPEN | `[COUNSEL]` | wording | Fix before launch |
| R-029 | Lock time of non-concurrent index builds (`businesses`, `saved_leads`) and trigger overhead on import are unmeasured | Potential risk | migrations `0004`, `0024`, `0025` | Phase 19 | Write outage or slow imports during migration | Rehearse on a production-size copy; schedule a window | OPEN | `[DATABASE OPERATOR]` | window | Fix before launch |
| R-030 | The documentation is untracked and unversioned | Process | `docs/` | a Phase 16 editing error truncated three documents; recovered from editor history, with sections 14 to 16 rebuilt as summaries | Silent loss of evidence | Commit the documents; never rewrite a file before reading it | OPEN (recovered) | `[RELEASE OWNER]` | none | Track |

## 6. Low and informational

| ID | Finding | Type | Evidence | Remediation | Status | Responsible |
|---|---|---|---|---|---|---|
| R-009 | Gateway passwords use PBKDF2 (210,000 iterations) while the API uses bcrypt | Potential risk | `ownus/src/lib/password.ts` | Align or retire gateway login | OPEN | `[ENGINEERING LEAD]` |
| R-015 | 11 inline-typed request bodies bypass DTO validation | Confirmed gap | P7-12 | Convert to DTO classes | OPEN | `[ENGINEERING LEAD]` |
| R-017 | The real-PostgreSQL concurrency suite is opt-in and not in CI | Process | `pg-concurrency.e2e-spec.ts` (skipped by default; 7 passed when enabled in Phase 20) | Run it in CI against a service database | OPEN | `[ENGINEERING LEAD]` |
| R-018 | No admin UI control to publish a batch | Confirmed gap | Phase 15 | Build or document the API procedure | OPEN | `[PRODUCT OWNER]` |
| R-020 | Operator-configured URLs (mail relay, error tracker, trace exporter) are not SSRF-guarded | Potential risk (by design) | Phase 8 | Accept in writing or guard | OPEN | `[SECURITY APPROVER]` |
| R-026 | Web lint: 352 errors (290 `no-explicit-any`, one `react-hooks/rules-of-hooks`); not in CI | Confirmed gap | Phase 19 clean-copy run | Fix the hooks error first; add lint to CI | OPEN | `[ENGINEERING LEAD]` |
| R-027 | Two moderate dependency advisories (`@nestjs/swagger`, `js-yaml`) | Confirmed vulnerability (moderate, dev-path dominated) | `npm audit --omit=dev`, Phase 19 | Upgrade when a fixed release exists | OPEN | `[ENGINEERING LEAD]` |
| R-086 | **Avatar URL host check was an incomplete string list (SG-24 residual; found in Phase 32).** Of 14 probes 9 were accepted and stored over HTTP: `[::1]`, `127.0.0.2`, `[::ffff:127.0.0.1]`, `169.254.1.1`, `100.64.0.1`, `[fd00::1]`, `[fe80::1]`, `localhost.`, `metadata.google.internal`. No server-side fetch of avatars exists, so the effect was a stored URL in the owner's browser, not an SSRF. | Confirmed vulnerability (Low; contradicted "private ranges blocked") | **Fixed and verified (Phase 32):** `avatar-validation.util.ts` uses the shared `parsePublicUrl`; 9 unit cases + `avatar-validation.e2e-spec.ts` (17); mutation-proven on both call sites | CLOSED once committed | `[ENGINEERING LEAD]` |
| R-028 | Hygiene: source maps in the API build; `/health` returns 503 for optional storage; startup log mentions Swagger | Informational | Phase 19 | Tidy | OPEN | `[ENGINEERING LEAD]` |

## 7. Closed in Phase 20

- **R-031 · Inaccurate statements in earlier reports.** Corrected, with the basis for each correction, in `SECURITY_REQUIREMENTS_TRACEABILITY.md` section 6 and in the errata added to `SECURITY_FINAL_REVIEW.md`, `PRODUCTION_READINESS.md` and `PRIVACY_COMPLIANCE.md`. Closed because the statements were replaced, not because the underlying controls changed.

## 8. Decisions that only a person can make (consolidated)
Rotation and history rewrite (R-001); commit and merge (R-022); host secrets (R-002); production database, API host, alert destination (R-003); payment integration scope (R-004); gateway future (R-006); privacy request channel and exports (R-008); retention decisions (R-024); admin second factor (R-007); remote ledger apply (R-010); e-mail verification default (R-011); audit tamper protection (R-012); wallet constraints (R-013); disclosure policy (R-016); CSP architecture (R-019); Node/Docker standard (R-021); counsel review (R-025); explicit acceptance, in writing, of any item the owner wishes to carry (R-020 and others).

## 9. Phase 22 changes to this register (2026-10-12)
- **R-005:** mitigated in the tree (guard + 6 tests), **not closed** (see row).
- **R-008:** partly advanced (see its Evidence line); severity unchanged (High); still open.
- **Untested controls found in Phase 21 (SG-25 password cap, L-7 admin logging): now tested** (`password-limits.spec.ts`, `password-length.e2e-spec.ts`, `admin-auth-logging.spec.ts`; each fails when the control is removed). The L-7 test is structural (it checks the source for `console.*`), not behavioural.
- No other finding changed status. Nothing was accepted.

## 10. Phase 23 changes to this register (2026-10-12)
- **R-005: VERIFIED_CLOSED** for the reported weakness (independent HTTP evidence). Residual by design: records with no recorded source. Still uncommitted.
- **R-032 (new, found and fixed in Phase 23), Medium, privacy:** People suppression left stored scheduled-export files containing the person's contact values downloadable (the Phase 22 expiry covered only company contacts). Fixed in `people-publishing.service.ts` and `people-write.service.ts`; evidence in `SECURITY_GAP_REPORT.md` section 21. **Closed with evidence.**
- **R-008:** stored-export expiry is now verified for company contacts, people and restore; **still High and open** (no intake, downloaded files cannot be recalled, CRM-sync exclusion untested).
- Observation, not a finding: `LoginDto.password` has no length cap; an oversized login password was measured to cost nothing extra and oversized bodies get HTTP 413 (NOT_REPRODUCED as a risk).
- Counts: Medium open 13 (R-005 closed); no other change.

## 11. Phase 24 changes to this register (2026-10-12)
- **R-033 (new, found and fixed in Phase 24), Medium, logging:** in the human-readable log format (the default outside production, selectable with `LOG_FORMAT`) a line break in untrusted text could start a forged log entry, and a secret-named field at the top level of a logged object (`password`, `token`) was only text-scrubbed, not redacted by key. Fixed in `structured-logger.ts`; the new tests failed before the fix. JSON output (production default) was already safe. **Closed with evidence.**
- **R-034 (new), Medium, detection gaps (confirmed absent, not exploited):** no event or rule exists for administrator role changes, for access to suppressed or unpublished records, for cross-customer object requests (answered 404 by design) or for session supersession (`SECURITY_MONITORING_PLAN.md` gaps G-2 to G-5). Decision needed on which of these are worth an event. **Open.**
- **R-003 (alerting part):** rules now exist and are tested to a local receiver; **production delivery is still unproven**, no destination configured, no on-call. **Still open (High).**
- **R-012:** unchanged; the plan states plainly that the audit trail is not tamper-evident.
- Quality note: the nine security alert rules use starting thresholds with no baseline (plan section 4); that is recorded as an unverified concern, not a finding.

## 12. Phase 25 changes to this register (2026-10-12)
Findings from the access-control review. Each was confirmed against the running code or by a failing test before any change.

| ID | Finding | Severity | Status |
|---|---|---|---|
| R-037 | **Administrator sessions could not be revoked.** `POST admin/auth/logout` only wrote an audit row (API) or cleared a cookie (gateway); the administrator token carried no session id, so neither logout nor a newer sign-in ended it, for up to 12 hours. Persisted role and status were already checked on every request, so suspension and demotion worked. | Medium | **Fixed and verified** (API 8 e2e tests, 2 failed before; gateway 17 of 17 HTTP checks with mutation proof). Tokens issued before the change expire naturally. Gateway proof is not a repository test |
| R-038 | **Administrator sign-in on the gateway's native path was not audited** (no failure, success or logout rows), so the Phase 24 rule `sec_admin_signin_failures` could not see it. Domain refusals likewise. | Medium | **Fixed** (events `ADMIN_OTP_FAILED`, `ADMIN_OTP_UNAUTHORIZED_DOMAIN`, `ADMIN_LOGIN_SUCCESS`, `ADMIN_LOGOUT`; the failure record holds no e-mail and no code). HTTP-verified, script outside the repository |
| R-039 | **Credit package create, update and delete were not audited, an unknown package id answered 200 as a silent no-op, and a malformed id reached the database.** Package prices decide what customers pay. | Medium | **Fixed and verified** (`CREDIT_PACKAGE_*` events with old and new values, 404, UUID validation; 5 mutations each fail a test) |
| R-040 | **Adjusting credits for an unknown account returned HTTP 500; an erased (anonymised) account could be given credits.** | Low | **Fixed and verified** (404 before any write) |
| R-035 | **No least-privilege tier.** All 83 privileged routes allow ADMIN and SUPER_ADMIN; SUPER_ADMIN has no unique capability, so any ADMIN can change prices, adjust any wallet, block addresses and approve data sources. Roles and status can only be changed in the database. | Medium | **Open, decision pending** (which operations become SUPER_ADMIN-only; the seeded first administrator is SUPER_ADMIN) |
| R-036 | **No segregation of duties on credit adjustments.** An ADMIN can credit their own wallet (probe: 201). It is audited and capped per call (`MAX_ADMIN_CREDIT_DELTA`) and throttled (30 per minute). | Medium | **Open, decision pending** |
| R-041 | Smaller observations: the gateway Google callback issued a session to a suspended/inactive account and accepted a missing `email_verified` (**fixed in code, not HTTP-tested because it needs Google**); the gateway `admin/users` view returns invented placeholder values (`phone`, `plan`, `totalSpent`); the seed script gives the first administrator 10,000 credits with no ledger row and falls back to a named individual's e-mail address in source; `admin/duplicates` (gateway fallback) and `monitoring/test-error` write no audit row; there is no documented break-glass procedure. | Low | Google items fixed; the rest **open** |

Corrections to earlier statements: **an audit-read view does exist** (gateway `GET admin/activity-logs`, administrators only, last 50 rows with the actor's e-mail and event details); "there is no general audit-read API" in the monitoring plan, runbook and earlier notes referred to the NestJS API only. **Admin account suspension and role changes** have no route and no audit (R-034, G-2). Google sign-in lets an administrator account authenticate without the one-time-code step; this is part of the single-factor concern in R-007 and was not changed.

## 13. Phase 26 changes to this register (2026-10-13)

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-042 | **CI is not a proven release gate.** The workflow cannot stop a push to `main` or a Vercel deployment unless branch protection, required checks and Vercel check settings exist; none can be verified from the repository. The repository has one visible GitHub identity, so a second reviewer may not exist. | High | **Open, owner action** (checklist in `CI_CD_SECURITY_REVIEW.md` s9) |
| R-043 | Docker builds use floating `node:20-alpine`, `npm install` and no lockfile; images are unscanned and unbuilt locally; Node 20 / 22 / 24 differ across Docker, CI and Vercel. Tested artifact differs from deployed artifact. | Medium | **Open** |
| R-044 | Dependency install scripts (`bcrypt`, `esbuild`, `@parcel/watcher`, `unrs-resolver`, `core-js`, `@scarf/scarf`) run during installs and builds. Scarf reporting switched off in CI. | Low | Accepted, monitored |
| R-045 | Web development toolchain has 5 high advisories (`braces` via `eslint-config-next`); the only suggested fix is a major downgrade. Build-time only. | Low | **Open**, decision pending |
| R-046 | No SBOM, signing or provenance for the project's artifacts; the web lockfile cannot produce an SBOM. | Low | **Open** |
| R-047 | `CODEOWNERS` and `dependabot.yml` added but inert until enabled in GitHub; one owner identity only. | Medium | **Open**, owner action |
| R-048 | The workflow has never executed on GitHub; its first run may expose other defects (the file was invalid YAML until this phase). | Medium | **Open** |

Fixed in this phase: invalid workflow syntax, tag-pinned actions, persisted checkout credential, cancelled `main` runs, missing signature/critical-audit/migration-journal checks, API image revision identifier.

## 13. Phase 27 changes to this register (2026-10-13)

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-049 | No restricted application database role; local runtime is a superuser, production role unknown | High | **Open, needs approval** (create roles when the production database exists) |
| R-050 | No separate migration connection or role | Medium | **Open** |
| R-051 | Cascading deletes (user, company) would remove financial history if run by hand | Medium | Open, runbook note |
| R-052 | 20 administrative foreign keys without an index | Low | Open |
| R-053 | Updates after an owner-checked fetch address the row by id only | Low | Open |
| R-054 | Quota checks (integrations, schedules, keys) are not atomic | Low | Open |
| R-055 | No unique index for company-level saved leads (duplicates are now prevented by a lock, not a constraint) | Low | Open, migration needs a data check |
| R-056 | New pool limits (60 s / 60 s / 30 s) might cut off a legitimate long statement | Low | Watch; configurable |
| R-057 | Idle-client error handler logs the raw error object (host and port, no credentials) | Low | Open |

Fixed in this phase: duplicate saved leads under concurrency (12 parallel saves left 10 rows), 500 on first-wallet race (and welcome credits missing from the ledger), 500 when saving an unknown company and saving of unpublished companies, 500 on non-integer or huge paging values (saved leads, discover search, billing history), unbounded bulk lists, no database statement/idle/lock limits, bound values and query strings in the error log.

## 14. Phase 28 changes to this register (2026-10-13)

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-058 | Four administrator import routes take unvalidated inline bodies (hand-checked; fenced by a test) | Low | Open |
| R-059 | The gateway's offline list shapes differ from the API's; saved-lead and wallet pages not re-checked offline | Low | Open, decision pending whether offline mode is supported |
| R-060 | 76 gateway call sites still treat a database failure as "no rows" (customer-facing writes were made strict) | Medium | Open (admin import and business admin writes remain) |
| R-061 | A retried unlock answers `alreadyUnlocked` with `creditsSpent: 0` | Low | Accepted, documented |
| R-062 | No runtime validation of API responses in the browser client | Low | Open |
| R-063 | The gateway and the API are two implementations of the same routes; divergence is a standing risk | Medium | Open |

Fixed in this phase: 500 responses from five API bodies with inline types (administrator OTP, provider link/unlink); 54 server errors in the gateway (null bodies, non-text names); the gateway reporting success (200 profile update, 201 registration with tokens, 200 saved lead) when the database refused the write or when the offline stand-in stored nothing; the gateway's offline unlock status always answering "not unlocked"; row values in the gateway's database error log; bare body-less 500s from gateway handlers.

## 15. Phase 29 changes to this register (2026-10-13)

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-064 | Retention clears at most 20,000 rows per rule per run; a table gaining more than that per day grows without bound (measured backlog 212,500 after one run) | Medium | Open, needs sizing against real volume |
| R-065 | Free-text and location search are linear in table size (91 ms at 100,000 companies; 8x faster with trigram indexes, writes 2x slower) | Low now, Medium at about 500,000 companies | Proposed, needs approval and a rehearsed migration |
| R-066 | Import preview and submit cost about 2.8 ms and 2 statements per row inside one request (14 s at the maximum) | Low | Open |
| R-067 | A refund calls the payment gateway inside a database transaction | Low | Open |
| R-068 | Per-address route limits do not bound a distributed client population; behind a proxy they depend on the trusted-header setting | Medium | Open |
| R-069 | All measurements come from one machine with load generator, API and database together; no production hardware, no dataset above 100,000 companies, no soak, no CPU figures | Medium | Open, staging run needed |
| R-070 | Process memory after imports (about 440 MB) not shown to plateau | Low | Open |

Fixed in this phase: pool self-deadlock at the daily rollover (56 of 60 requests failed after 15 s), a row lock on every wallet read, 30 s lock waits answered as 500, an import that could not be finished after a process kill. R-056 updated: the lock-wait default is 5 s, not 30 s.

## 16. Phase 30 changes to this register (2026-10-13)

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-071 | A restore undoes deletions, suppressions, withdrawals and suspensions made after the backup; privacy RPO equals the ledger interval, and the ledger was only written with the dump | High | Mitigated in code (ledger extended, `LEDGER_ONLY` mode); **open until the ledger job is scheduled** |
| R-072 | Restored database brings back revoked sessions and reverted passwords | High | Fixed (re-apply revokes all refresh tokens and replaces session identifiers); JWT secret rotation is a manual step |
| R-073 | Background jobs ran on the first start of a restored database before reconciliation | High | Fixed (`RESTORE_MODE`) |
| R-074 | The apply guard needs a verified backup of the target and refuses remote databases: the ledger cannot be re-applied to a restored production database with the tool | Medium | Open, needs an approved exception or change request |
| R-075 | MFA and integration secrets are encrypted with a key that falls back to the JWT access secret; rotating it after a restore makes them unreadable; keys are not in the backup document or validated | High | Open decision (set explicit keys, escrow them, consider requiring them) |
| R-076 | Payments made after the backup are missing from a restored database; no reconciliation tool | Medium | Open, manual procedure to write |
| R-077 | Old backups keep deleted data until expiry | Medium | Accepted (Phase 16) |
| R-078 | Search index, object storage, provider point-in-time recovery, production-scale timing and payment replay not tested | Medium | Open |

Fixed in this phase: database-unavailable conditions answered as 500 (now 503 with Retry-After).

## 17. Phase 31 changes to this register (2026-10-13)

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-079 | Probing other customers' objects was invisible (G-4) | Medium | Fixed (`OBJECT_PROBING` signal) |
| R-080 | An automatic address block also blocked health probes and the payment webhook | High | Fixed |
| R-081 | False "resolved" security alerts during a database outage | Medium | Fixed |
| R-082 | Registration and People review audit rows lacked the request id; social registration stored an e-mail address | Medium | Fixed |
| R-083 | Single-account password guessing is stopped by the lockout before any alert threshold is reached | Low | Open (tuning) |
| R-084 | Containment by database action leaves no audit row; access tokens outlive a refresh revocation by up to 15 minutes; no publication freeze; no investigator read route | Medium | Open, procedure documented |
| R-085 | No on-call, contacts or real alert destination; delivery, backup ping and CI failure notices never proven | High | Open, owner action |
| G-2 / R-034 | Role and status changes in the database are invisible (confirmed by simulation: an out-of-band role change took effect with no trace) | High | Open; a database trigger is proposed, needs approval and a migration |

Also still open: R-012 (audit log not tamper-evident, confirmed: UPDATE and DELETE accepted), G-3, G-5.
