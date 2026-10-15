# Security regression coverage and fixed-vulnerability verification (Phase 32)

**Date:** 2026-10-13 · **Tree:** branch `chore/neon-removal-prep`, HEAD `3cf08b3`, nothing staged, all work uncommitted · **Reviewer stance:** independent; no finding was treated as fixed because a report said so.
**Matrix:** `SECURITY_REGRESSION_MATRIX.md` (finding → remediation → test → result → mutation → gap).
**Overall regression confidence: PARTIALLY VERIFIED** (reasons in section 7).

## 1. Findings reviewed

| Population | Count | How it was used |
|---|---|---|
| Register entries `SECURITY_RISK_REGISTER.md` | **85** (R-001 to R-085) | all classified (matrix s3); 13 fixed-in-code entries traced to tests |
| Traceability rows `SECURITY_REQUIREMENTS_TRACEABILITY.md` | **84** (48 verified / 19 partial / 11 not verified / 6 blocked before this phase) | cited test files checked: **every cited spec file exists** (script over the three review documents) |
| Controls in the matrix (code-controlled findings, with test and result) | **31 rows** | tests read, executed, and for 27 controls deliberately broken (mutation) |
| New finding from this phase | **1** (F32-01, below) | added as R-086 |

Method: read the register and traceability, `git status` (146 modified, 723 untracked with `-uall`, nothing staged, no stash, HEAD unchanged) and the relevant source; ran suites narrowest first; then for each critical or high control **changed the production code in the way an attacker or a careless edit would, ran the tests, and restored the file** (SHA-256 verified on every restore). Skipped and `todo` tests were enumerated by search.

## 2. Coverage summary (matrix s4)

- 31 matrix rows: **18 GUARDED, 12 PARTIAL, 1 EXT/BLOCKED** (first word of each Status cell).
- 27 labelled mutations (28 runs): **23 detected**; 4 not detected, each explained:
  - M-E (status check in `RolesGuard`) and M-L1 (advisory lock in unlock): **equivalent mutants**, another layer enforces the same property (`JwtStrategy`; unique index `lead_unlocks_user_business_idx` plus the wallet row lock).
  - M-C2 (OAuth unverified e-mail, existing HTTP suite): **a real blind spot**, closed by a new test.
  - M-L2h (wallet row locks removed, default suites): **a known structural blind spot**, 0 of 126 default tests notice (the real-PostgreSQL suite does, 3 of 10).
- 2 mutation attempts were discarded as invalid and not counted (empty-database guard in the PG suite; a mutation that did not compile).

## 3. Tests executed (working tree, this phase)

All run from the repository root or `apps/api` as shown. "Real logic" states what the suite actually exercises.

| # | Command | Exit | Result | Real logic or mock |
|---|---|---|---|---|
| 1 | `npm run test:security` (apps/api) | not captured (summary read) | 1 suite, 9 passed | static/regression checks of repository files |
| 2 | `npm run test:unit` (first run, before any change) | **0** | 47 suites, 865 passed | functions and services; collaborators mocked where stated per test (e.g. OAuth unit uses mocked repositories) |
| 3 | `npm run test:integration` (first run) | **0** | 43 suites passed, 1 skipped; **979 passed, 13 skipped**, 0 failed | real services on in-memory PostgreSQL (PGlite), real SQL and triggers; the skipped suite needs `ADMIN_URL` (opt-in) |
| 4 | `npm run test:e2e:all` (after the fix and the new tests) | **1** | 45 suites passed, 1 skipped, **1 failed**; **688 passed**, 10 skipped, 3 todo, 1 failed | full Nest application over HTTP (supertest) on PGlite; OAuth providers and mail are test doubles |
| 5 | `jest ... health-probes` alone, 3 reruns | n/a | 20 of 20 passed each time | see s5 W7 |
| 6 | After the fix: `test:unit`, `test:integration`, `test:security`, `test:perf` | summary read | unit **874 passed** (47 suites); integration **979 passed**, 13 skipped; security 9; perf 3 | as above |
| 7 | `npm test` in `ownus/` | summary read | **270 passed**, 0 failed | web library code (node:test); no route handler over HTTP |
| 8 | `pg-concurrency.e2e-spec.ts` with `CONCURRENCY_DATABASE_URL` on a fresh `orion_scratch_phase32_base` | summary read | **10 passed** | real PostgreSQL 18.3 server, real pool, overlapping transactions |
| 9 | `tsc --noEmit` (API, web); `nest build`; `npm run test:secrets`; `db:migration:check`; `test:inventory` | **0** each | clean; secrets 0 findings in the tree; journal 26 entries consistent; inventory ok | static |
| 10 | `npm run test:secrets:history` (read-only, report-only) | n/a | **3 distinct secret values remain in Git history** | static; unchanged since Phase 19 |

Counts reconcile with Phase 31: e2e 677 then (667 hermetic + 10 real-PostgreSQL) plus 21 new = 688 hermetic; unit 865 + 9 = 874. The new e2e total excludes the 10 real-PostgreSQL tests because that suite was skipped in run 4 by design.

Not run: Playwright (`test:browser`), web lint (352 known errors, not in CI), Docker, GitHub Actions, any deployed environment, `backup.sh`/`restore.sh`, any test against Neon, Vercel, Typesense, MinIO, Redis, Razorpay, Google, Microsoft.

## 4. Security properties verified in this phase

Each was verified by a test that reaches the real boundary **and** by breaking the control and seeing a test fail (mutation code in brackets; details in the matrix).

1. A logged-out or superseded session cannot reach export, unlock, wallet or history, and its refresh token is dead [M-D, M-X2].
2. A suspended or inactive account loses access on the next request, customer and administrator [M-E2]. A customer cannot reach privileged routes [M-R1].
3. Refresh-token replay is refused and ends the session family [M-I5].
4. A provider e-mail that is not verified can neither create an account nor link to an existing one, and the existing account is unchanged [M-C, M-C3].
5. Another customer's integration, saved lead, unlock state and unlocked-leads export are unreachable [M-I1, M-I2, M-H, M-F].
6. CSV formula injection is neutralised in exports [M-I3].
7. Source trust gates publication, on the API and on the web gateway's status screen [M-G, M-W1].
8. A suppressed identity cannot be re-ingested [M-I4], stored export files that held it are expired [M-S3], and a person suppressed **after** a customer unlocked them is absent from on-demand export, list, detail, company view, bulk export and unlock, with no charge [M-X1] (new).
9. Wallet row locks and the saved-lead lock hold under real concurrency [M-L2, M-P1], on real PostgreSQL only.
10. SSRF address rules refuse private, loopback, link-local, mapped, unique-local and metadata addresses [M-S1]; avatar URLs now use the same rules [M-A, M-B].
11. Free-text log messages are scrubbed of e-mail addresses [M-S2].

## 5. Test-quality weaknesses (and what was done)

| ID | Weakness | Evidence | Action |
|---|---|---|---|
| W1 | Avatar validation was tested only as a function. Neither call in `user.service.ts` had any test. | grep: the only test mentioning `avatar` was the util spec | **Fixed:** `avatar-validation.e2e-spec.ts` (17), mutation-proven both ways |
| W2 | The unverified OAuth e-mail rule had only a unit test with mocked repositories. The whole HTTP OAuth suite stayed green with the rule removed. | M-C2: 0 of 16 | **Fixed:** `oauth-unverified-email.e2e-spec.ts` (2), mock provider gained an "unverified" scenario |
| W3 | Cross-workflow bypasses had no test (each control was tested inside its own workflow). | no test combined suppression or logout with export, list, detail and unlock | **Fixed:** `cross-workflow-regression.e2e-spec.ts` (2), mutation-proven |
| W4 | The real-PostgreSQL suite is opt-in, not in CI (R-017), and **refuses any non-empty database**, so a second run on the same database fails every test (10 of 10). Any experiment must create a new database each time. | observed in this phase; my first lock experiment was invalid for this reason and was discarded | Documented here and in the matrix. Not changed: the guard is deliberate. Recommend running it in CI against a service database created per run |
| W5 | The default suites cannot see removal of wallet row locks. | M-L2h: 0 of 126 default tests fail; PG suite: 3 of 10 | Known (R-017), now measured. No change |
| W6 | Some defence-in-depth checks cannot be told apart from the layer in front of them (`RolesGuard` status check; unlock advisory lock). | M-E, M-L1 | Informational. The outcome is protected; nothing to fix |
| W7 | `health-probes` failed once in the full e2e run (`/health` answered 503); it passed 20 of 20 in each of 3 isolated reruns. `/health` includes optional storage, which is down because Docker is off. | run 4 vs run 5 | Pre-existing, documented in the checkpoint since Phase 10. Not a security property. It still makes the full e2e exit code non-zero |
| W8 | Wiring gaps in the web gateway: the route handler is not tested over HTTP in the repository (R-006). The Phase 22/23 HTTP proof was a script outside the repository. | matrix rows R-005, AUTH-01..03 | Open |
| W9 | Mocks: the OAuth unit test mocks repositories and token service; the OAuth e2e uses test-double providers; mail is a double. Real providers were never contacted. | source | Inherent; stated in the matrix |
| W10 | Skipped or todo tests: `pg-concurrency` (opt-in, 10), `people-review-concurrency` integration (opt-in via `ADMIN_URL`, 13), `placeholder-secrets` (skips if commit `03075bd` is not in history; it ran), 3 `todo` (People export after consent withdrawal PR-02; CRM-sync exclusion; reviewer correction of a classification). | search for `.skip`, `.todo`, `describe.skip` | Listed, none hidden |

Cleanup and isolation: the new tests create unique-tagged users and businesses and remove them in `afterAll` (the suppression register is append-only by design; the People test deletes its person row). A failing assertion fails the test: demonstrated by the mutations. The `cross-workflow` wallet check includes `expect(...).toEqual(expect.any(Number))` so a missing field cannot make the equality pass vacuously.

## 6. Confirmed findings and fixes

### F32-01 (R-086) · Avatar URL host check incomplete · Low · fixed
- **Behaviour:** `validateAvatarImage` blocked private hosts with a list of strings and prefixes. Of 14 probe URLs, **9 were accepted**: `https://[::1]/`, `https://127.0.0.2/`, `https://[::ffff:127.0.0.1]/`, `https://169.254.1.1/`, `https://100.64.0.1/`, `https://[fd00::1]/`, `https://[fe80::1]/`, `https://localhost./`, `https://metadata.google.internal/`. Over HTTP both `POST /user/avatar` and `PATCH /user/profile` answered **200 and stored them** (13 of 17 new tests failed on the old code).
- **Impact:** Low. Orion never fetches an avatar server-side (searched), so this is a stored URL shown in the owner's browser, not a server-side request. It does contradict "private/internal ranges blocked" in SG-24 / SR-SSRF-03, which were recorded as closed and verified.
- **Fix:** the https branch now calls the shared `parsePublicUrl` (the Phase 8 value-based classifier). Error codes are preserved. Dead blocklist removed. One file changed: `apps/api/src/common/utils/avatar-validation.util.ts`.
- **Tests:** 9 unit cases added to `avatar-validation.util.spec.ts`; new `test/avatar-validation.e2e-spec.ts` (17). After the fix: unit 874, e2e 688 (plus the 10 PG), all green. Mutations M-A and M-B (remove either call) fail 15 of 17.

### F32-02 · F32-03 · F32-04 · coverage gaps closed (no vulnerability found)
Avatar wiring (W1), OAuth HTTP boundary (W2) and cross-workflow behaviour (W3) were correct but unguarded. The behaviour was correct in all cases tested; nothing was changed in production code for them.

### No regression found
No previously fixed control regressed: every existing suite passed, and every mutation of a fixed control that has a test was detected, except the four explained in s2.

### Corrections to earlier statements
- `SECURITY_REQUIREMENTS_TRACEABILITY.md` SR-SSRF-03 ("VERIFIED") and the SG-24 "closed" status in `SECURITY_FINAL_REVIEW.md` were overstated until this phase. SR-SSRF-03 evidence is updated; the final-review note is in the remediation plan section 22.
- SR-AUTH-07 cited `oauth.e2e-spec.ts` as evidence for the unverified-e-mail rule; that suite does not cover it (M-C2). The row now cites the new test.

## 7. Remaining critical and high gaps (not closed by Phase 32)

| Item | Why it remains |
|---|---|
| R-001 / R-002 credentials in history, host secrets | operator action; history scan still reports 3 distinct values |
| R-022 / R-023 release candidate uncommitted, CI never run | this phase adds one code file edit, three new test files and two edited test files, all uncommitted; nothing was committed (instruction) |
| R-003, R-004, R-085 production operations, real payments, alert destination | EXT |
| R-006 gateway is a second backend | native handlers have unit tests but no repository-level HTTP tests; web mutation M-W1 shows the unit tests work, not that the route calls them |
| R-017 lock tests not in CI | locks that stop double-charging and duplicate saved leads are guarded only when the opt-in suite is run on a fresh database |
| R-049 / R-050 no restricted application or migration role | needs a production database |
| R-008 removal-request intake, earlier downloads | feature absent; CRM-sync exclusion is still a `todo` |
| Phase 4 / 25 gateway wiring | native-login MFA refusal and admin session on the gateway are proven by scripts outside the repository |
| Historic-only mutation proof | Phase 3 to 10, 22 to 31 controls not re-mutated in this phase (matrix marks them PARTIAL) |

## 8. Environment limitations

Windows 11, Node 24.11.1, PostgreSQL 18.3 local server reached as the `postgres` superuser (so database-role isolation was not tested), no Docker, no Typesense, MinIO or Redis, no network calls to third parties, no GitHub Actions, no deployed environment, one machine. Hermetic suites run on PGlite (a single connection), which cannot show lock behaviour. Clock-sensitive and load-sensitive suites ran on a shared developer machine.

Disposable databases created in this phase and **kept** (empty apart from test rows; drop when unwanted, never `orion_db`): `orion_scratch_phase32`, `orion_scratch_phase32_base`, `orion_scratch_phase32_mutlock`, `orion_scratch_phase32_mutrow`, `orion_scratch_phase32_mutsave`. No test connected to `orion_db`: the hermetic suites run on in-memory PGlite with `DATABASE_URL` forced to an unreachable address (`test/setup-env.ts`), and the real-PostgreSQL suite connected only to the scratch databases above. The one-off script that **created** the scratch databases connected to the server's maintenance database `postgres` using the local credentials already in `apps/api/.env` (values never printed or stored), issued only `CREATE DATABASE` and a catalogue `SELECT`, and never selected `orion_db`.

## 9. Files changed

Production code (1): `apps/api/src/common/utils/avatar-validation.util.ts`.
Tests (new): `apps/api/test/avatar-validation.e2e-spec.ts`, `apps/api/test/cross-workflow-regression.e2e-spec.ts`, `apps/api/test/oauth-unverified-email.e2e-spec.ts`.
Tests (edited): `apps/api/src/common/utils/__tests__/avatar-validation.util.spec.ts` (+9 cases), `apps/api/test/mocks/mock-oauth-providers.ts` (one "unverified e-mail" scenario).
Docs: new `SECURITY_REGRESSION_MATRIX.md` and this report; updated `ORION_CHECKPOINT.md`, `SECURITY_RISK_REGISTER.md` (R-086), `SECURITY_REQUIREMENTS_TRACEABILITY.md` (SR-SSRF-03, SR-AUTH-07), `SECURITY_REMEDIATION_PLAN.md` (section 22).
Temporary files (mutation harness, probe scripts, logs) lived in the session scratchpad; none remain in the repository (checked).

## 10. Reproducing it

```bash
cd apps/api
npm run test:unit && npm run test:integration && npm run test:security
npm run test:e2e:all                       # expect health-probes to be the only failure on a machine without Docker
npx tsc --noEmit -p tsconfig.json && npx nest build
node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config ./test/jest-e2e.json avatar-validation oauth-unverified-email cross-workflow --runInBand --forceExit
# real-PostgreSQL suite: create a NEW empty database named orion_scratch_<x> on the local server for each run, then
#   CONCURRENCY_DATABASE_URL=<its url>  node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config ./test/jest-e2e.json pg-concurrency --runInBand --forceExit
cd ../../ownus && npm test
cd .. && npm run test:secrets && npm run test:secrets:history
```

### Mutation catalogue (each: file, exact change; apply, run the named suites, restore)
| M | File | Change |
|---|---|---|
| A | `modules/user/user.service.ts` | `const validatedImage = validateAvatarImage(image);` → `const validatedImage = image;` |
| B | same | `(rawAvatar ? validateAvatarImage(rawAvatar) : rawAvatar)` → `rawAvatar` |
| C, C2, C3 | `modules/oauth/oauth.service.ts` | `if (!profile.isEmailVerified) {` → `if (false) {` |
| D, X2 | `auth/strategies/jwt.strategy.ts` | `payload.sessionId !== activeSessionId` → `false` |
| E | `auth/guards/roles.guard.ts` | `persisted.status !== 'ACTIVE'` → `false` |
| E2 | `auth/strategies/jwt.strategy.ts` | `user.status === UserStatus.SUSPENDED \|\| user.status === UserStatus.INACTIVE` → `false` |
| R1 | `auth/guards/roles.guard.ts` | `if (!requiredRoles.includes(persisted.role as UserRole)) {` → `if (false) {` |
| F | `modules/export/export.service.ts` | in `unlockedLeads`, delete the line `.where(eq(schema.leadUnlocks.userId, userId))` |
| G | `modules/import/services/source-trust.service.ts` | last return of `assess()` → `return { allowed: true, trust, overrideUsed: false, code: 'APPROVED' };` |
| H | `modules/unlock/unlock.service.ts` | the `eq(schema.leadUnlocks.userId, userId),` inside the locked re-check (about line 78) → `undefined,` |
| I1 | `modules/integrations/integrations.service.ts` | `and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId))` → `eq(schema.integrations.id, id)` |
| I2 | `modules/saved-leads/saved-leads.service.ts` | `existing && existing.userId === userId` → `existing` |
| I3 | `common/utils/csv-security.util.ts` | `if (FORMULA_TRIGGER.test(str)) {` → `if (false) {` |
| I4 | `modules/people/suppression/people-suppression.ts` | first line of `findSuppressionMatch`: add `if (identity) return null;` |
| I5 | `auth/services/auth.service.ts` | `if (storedToken.isRevoked) {` → `if (false) {` |
| L1 | `modules/unlock/unlock.service.ts` | the `pg_advisory_xact_lock` call → `await tx.execute(sql\`SELECT 1\`);` |
| L2, L2h | `modules/credit/credit.service.ts` | every `.for('update')` removed |
| P1 | `modules/saved-leads/saved-leads.service.ts` | the `pg_advisory_xact_lock` call in `upsertLead` → `SELECT 1` |
| S1 | `modules/integrations/net/safe-http.ts` | first line of `isBlockedAddress`: add `if (address) return false;` |
| S2 | `common/observability/scrub.ts` | delete `.replace(EMAIL, '[email]')` |
| S3 | `modules/people/people-publishing.service.ts` | delete `await expireStoredExports(tx);` (about line 358) |
| X1 | `modules/people/people.service.ts` | replace the body of `CUSTOMER_VISIBLE_ROLE` with an empty typed array |
| W1 | `ownus/src/lib/publish-guard.ts` | `ds.trust_status = 'APPROVED'))` → `ds.trust_status = ds.trust_status))` |

Pitfalls found while doing this: the source files use CRLF line endings (multi-line patterns must include `\r\n`); a mutation that does not compile makes the suite report zero tests, which is not detection; the real-PostgreSQL suite needs a fresh database per run.
