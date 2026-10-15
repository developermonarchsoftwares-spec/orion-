# Migration rehearsal plan: isolated Neon branch

**Status: PLAN ONLY, not approved, not executed.** Date: 2026-10-02. Nothing in this document connects to a database, creates a branch, runs SQL or deploys anything. Executing any step needs the written authorization named in §10. A passing rehearsal never grants permission for a production change; that needs the separate change request (`PRODUCTION_CHANGE_REQUEST_TEMPLATE.md`).

Related: `TARGET_ARCHITECTURE.md` (what is being rehearsed), `DATABASE_OWNERSHIP_MATRIX.md`, `PIPELINE_RUNTIME_RISK_REGISTER.md`, `MIGRATION_RUNBOOK.md` (§9, §12-§15: the earlier Orion-only rehearsal and staging suite), `PHASE_A2_APPROVAL_READINESS.md`.

## 0. Evidence labels
**WT** working tree; **HEAD** committed; **HIST** earlier audit observation (2026-10-01), not current; **RUNTIME?** needs verification against the real environment. "Verified" below always means verified by a named person against the named source.

## 1. Purpose and scope
Prove, on a disposable copy of the real data, that the target architecture can be introduced without data loss or customer-visible regression:
- both applications' migration journals applied in the decided order, and in the opposite order to expose collisions;
- the `orion_pipeline` schema, the six People tables, the versioned read-only views, and the role/permission model;
- both applications running together: imports, publication, People views, accounts, credits, saved searches, unlocks and exports;
- failure drills: migration failure, concurrent runners, worker stop, shutdown.

Out of scope: any production change; any action on the source (parent) branch.

## 2. Preconditions (all must hold before the first command)
| # | Precondition | Evidence required |
|---|---|---|
| P-1 | Both repositories are reproducible from commits: the Orion migration set (0003-0017 and snapshots) and the pipeline changes are committed on a named branch (owner decides how; this plan does not) | commit IDs recorded for both repositories; `git status` clean for the rehearsed paths |
| P-2 | Phase A2 evidence report accepted; owner decisions recorded (ownership, publication authority, People option A/B/C, customer-layer fate, `import_batches` contract) | decision record IDs |
| P-3 | Contracts exist as files: `published_people_v1`, tombstone view, column-owner contract, publication state machine | file hashes |
| P-4 | Pipeline-side hardening needed to rehearse safely is done and approved: a staging guard equivalent to Orion's `staging-guard` (§4), `AUTO_MIGRATE` off by default, fatal migration failures, schema-qualified People migration | code review record |
| P-5 | A named operator, a named verifier (second person), an abort authority, and a window | written record |
| P-6 | Recoverability for the *parent* is confirmed independently (§6); the rehearsal never touches it | restore-test record |

If P-1 or P-4 is not met the rehearsal does not start: the pipeline's tests and benchmarks default to `DATABASE_URL` (RR-16) and its auto-migration is uncommitted (RR-01), so running them is unsafe without the guards.

## 3. Branch identity and parent verification
Identity is never inferred from a hostname, URL, branch name, environment variable or `.env` content alone.

1. **In the Neon console (authority):** record, by the verifier, the project, the branch name, the branch id, the **parent branch**, the creation time, and the endpoint host for the branch. Confirm the branch was created from the intended parent at the intended point in time. Take a dated screenshot that contains no connection string.
2. **Host separation:** the branch endpoint host must differ from the production endpoint host recorded in the approval record, and from any pooled (`-pooler`) form of production.
3. **Database-side corroboration (read-only, after connecting, via the guard):** `current_database()`, server version, and a snapshot of migration histories and table counts (`npm run db:rehearsal -- snapshot`, plus the pipeline's `schema_migrations`). A branch is a copy, so these must **equal** the parent's snapshot taken at branch time. Equality corroborates "copy of the parent"; it does not prove which endpoint is the branch, which is why the console record is the authority.
4. **Positive proof for Orion tooling:** the existing staging guard requires the connected database to record exactly the journal's migrations; it does not apply before the Orion migrations have been rehearsed, so the first run uses the baseline snapshot comparison above.
5. Any doubt about identity stops the rehearsal.

## 4. Connection variables and guards
- **Explicit staging variables only:** `STAGING_DATABASE_URL` and `STAGING_CONFIRM_HOST` (already enforced for Orion by `apps/api/src/database/staging-guard.ts` and `test/setup-staging-env.ts`, both uncommitted). The pipeline needs the same: refuse to run unless the host equals `STAGING_CONFIRM_HOST`, is not on the production deny-list, is not local, and (for rehearsal) the database records the expected baseline. The deny-list is read from configuration supplied by the owner, not from a `.env` default.
- **No fallback to `.env`:** `apps/api/.env` (production per the owner) and the pipeline's `.env` must never supply the target. Both applications load `.env` via dotenv; it does not override variables already set, but it **does fill every other variable** (R2 keys, e-mail keys, OAuth ids). The rehearsal therefore sets every external variable explicitly to a neutral value (local storage, no mail key, no OAuth, test-only payment secrets) as the Orion staging setup already does.
- **Per-role connection strings** (§7) are provided only through the shell/secret store of the operator; never printed, logged, committed or sent to an assistant.
- **No production host reachable by name:** the rehearsal workstation or runner should not hold production credentials at all during the run.

## 5. Known baseline
Recorded before the first change, and preserved afterwards:
- commit IDs and hashes of both migration sets; the exact files of the rehearsed change;
- `drizzle.__drizzle_migrations` rows and `public.schema_migrations` rows (names, timestamps) of the branch, equal to the parent snapshot;
- table counts of every public table (`db:rehearsal snapshot`), the credit packages, pricing settings, `NULL file_key` count, and role/ACL inventory (Phase A2 C11);
- migration histories are never edited, reset or re-baselined. If the pipeline's history diverges from its repository (HIST: a recorded `013` name absent from commits), the divergence is recorded and carried, not "fixed", during the rehearsal unless the decided plan says otherwise.

## 6. Backups and recoverability
- **The rehearsal branch** is disposable: recovery = discard and recreate from the parent. Discarding it needs separate confirmation (never automatic).
- **The parent (production)** must have a restore-tested recovery path *before* any production change request is raised (restore a backup or point-in-time copy to a throw-away branch and compare snapshots; `MIGRATION_RUNBOOK.md` §9.4). The rehearsal records the achieved restore time.
- Retention of rehearsal evidence and the branch (it contains a copy of customer data) is set by the owner; the branch is treated as sensitive, with no production secrets copied into it.

## 7. Rehearsal sequence
Run each variant on a **fresh branch of the same parent** unless noted. Variants: **V1** Orion migrations, then pipeline migrations; **V2** pipeline first, then Orion (to confirm the predicted loud failure/collision behaviour on the old design and absence of collision on the new one).

| Step | Action | Acceptance | Abort when |
|---|---|---|---|
| R0 | Verify branch identity (§3), guards (§4), commit IDs and file hashes | all match the plan | any mismatch |
| R1 | Baseline snapshot and read-only audit (`db:audit`, `db:rehearsal snapshot`, pipeline history compare) | equals parent snapshot | difference |
| R2 | Apply Orion migrations (decided set) with the guarded command and explicit host confirmation | exit 0; `db:rehearsal compare` ok; `db:audit` shows only accepted drift | non-zero exit, unexpected change |
| R3 | Apply the pipeline migrations (schema `orion_pipeline`, six People tables) with the pipeline's guarded runner | exit 0; no object created in `public` by the pipeline migration; history recorded | non-zero exit, any `public` change not in the plan |
| R4 | Create the proposed roles and grants on the branch; run the permission matrix (§8.3) | every allowed action succeeds; every forbidden action is denied with `42501` | any unexpected allow/deny |
| R5 | Create `published_people_v1` and the tombstone view; run contract tests; run the view-replace test | explicit columns; no `SELECT *`; grants survive `CREATE OR REPLACE`; a `DROP/CREATE` is shown to lose grants (to justify the rule) | contract test failure |
| R6 | Application tests together (§8) | all pass; no customer-visible regression | any failure not explained by test data |
| R7 | Failure drills (§9) | each drill ends in the expected safe state | unsafe end state |
| R8 | Collect evidence, write the report, confirm no change to the parent, request branch disposition | report complete | missing evidence |

Never run the pipeline's tests or benchmarks against the branch unless the guard (P-4) is in place; they delete and insert rows.

## 8. Test coverage
### 8.1 Both applications together
Use disposable test identities and data only. No real payments, mail or storage calls (neutral configuration, §4).
| Area | Scenario | Pass criterion |
|---|---|---|
| Imports | Orion admin CSV import and a pipeline ingestion batch, interleaved, both writing `import_batches` | each batch carries its declared origin; Orion metrics unchanged for pre-existing rows; no write outside the column-owner contract |
| Publication | pipeline marks a business ready; the agreed hand-off sets Orion `status`; Orion discovery shows it; unpublish/duplicate/withdrawn paths | visibility changes only through the contract; the pipeline never writes `status`; `DUPLICATE` handled per the state machine |
| People views | Orion reads `published_people_v1`; unpublished, stale, ended, suppressed and deleted records disappear; tombstone view reports removals | exact filter semantics; no contact values exposed |
| Accounts | Orion signup/login/OAuth/admin OTP; pipeline customer routes disabled | no writes to `users` by the pipeline; admin RBAC from the persisted role |
| Credits | Orion purchase verification (test secrets), unlock, export; pipeline add-credits route returns an authentication/feature-off error | ledger balances equal expected; single writer; no pipeline write to `credit_transactions` |
| Saved searches | create/update/delete in Orion | one writer; pre-existing rows unchanged |
| Counts | `db:rehearsal compare` before/after for untouched tables | row counts of existing tables unchanged except declared new tables |

### 8.2 Existing suites to run (with their guards)
Orion: hermetic suites (`npm test`, `npm run test:e2e` in `apps/api`; `npm test` in `ownus`), then `npm run test:e2e:staging` against the branch (guarded). Pipeline: only the suites that can be pointed at the branch through its new guard; hazardous scripts excluded (RR-16).

### 8.3 Role-permission matrix (on the branch only)
For each proposed role (`TARGET_ARCHITECTURE.md` §8) test: connect; read/write allowed objects; attempt each forbidden action (DDL, access to the other application's tables, base-table access behind the views, `DELETE FROM businesses` for the pipeline unless granted, sequence usage). Expected denials are recorded with SQLSTATE `42501`.

## 9. Failure drills
| Drill | Expected safe end state |
|---|---|
| Migration with a deliberate error (disposable test file, not a production migration) | non-zero exit; nothing recorded; the application is not started by the deployment step |
| Two runners at once | second waits or refuses (advisory lock); no double apply |
| Edited applied pipeline migration file | refused (checksum) |
| Kill a worker mid-job | job is recovered once; no duplicate side effects (idempotency test) |
| Stop signal to server and worker | in-flight job finished or released; connections closed within the bound |
| Orion pool shutdown ordering | no queries after the pool closes (the scheduler/pool regression test) |
| Unauthorized request to a pipeline mutating route | 401/403, no write |

## 10. Authorizations required
| Action | Authority |
|---|---|
| Creating the rehearsal branch | database owner, in writing, naming the parent |
| Connecting from the operator's workstation or runner | database owner / operator per the approval record |
| Applying migrations on the branch | database owner, naming the commit IDs and file hashes |
| Creating roles/grants on the branch | database owner |
| Running the application suites | owners of both applications |
| Discarding the branch | database owner, separately |
| Anything on production | not covered; see the change request |

## 11. Success criteria
1. Branch identity and parent verified in the console and corroborated by the baseline snapshot.
2. Both migration sets apply in the decided order; the opposite order behaves as predicted (loud, atomic failure or no collision on the new design); no destructive statement ran; no `DROP VIEW … CASCADE`.
3. `db:rehearsal compare` shows only the declared changes; existing table counts, credit packages and balances unchanged.
4. Permission matrix passes exactly.
5. Views satisfy the contract tests; publication, People, accounts, credits and saved-search scenarios pass.
6. Failure drills end safely.
7. Evidence is complete and free of secrets and customer data.

## 12. Abort and rollback criteria
**Abort immediately** on: identity or host mismatch; the connected database is not the recorded branch; a guard refusal that is not understood; any statement affecting an object outside the plan; unexpected count changes in existing tables; a failed drill with an unsafe end state; secrets or customer data in output; the window ending.
**Rollback** for the rehearsal = stop, preserve the evidence, and (only on written confirmation) discard and recreate the branch. The parent is never modified; if there is any sign it was, stop and escalate.

## 13. Evidence to collect (no secrets, no customer data)
Console record of branch/parent (screenshot without URLs); commit IDs and file hashes; before/after snapshots and `compare` output; `db:audit` output; migration runner output; role/ACL inventory before and after; permission-matrix results with SQLSTATE; contract-test results; application test summaries with exit codes; drill results; timings and lock waits per statement; the report listing deviations and unresolved items.

## 14. What this plan does not authorize
Connecting to the branch or production; creating or discarding a branch; running migrations, seeds, tests or benchmarks; changing roles, grants, schemas or views; deploying; or any production action.

## 15. Gap review against the required rehearsal properties (third pass, 2026-10-02)
Each required property was checked against §§1-14. Where the plan was thin, the closing requirement is stated here and is binding on the plan.

| Required property | Covered by | Gap found | Closing requirement |
|---|---|---|---|
| Independent verification of the branch and its parent | §3 | none | unchanged |
| Proof that the application targets the intended branch | §3.3, §4, §8.2 (Orion staging helper) | Only Orion's *test* helper proves the target; the running Orion API/gateway and the pipeline server/worker have no such proof | **G1:** every process used in R6 must, at start, compare `current_database()`, the host and the recorded migration count with the values in the rehearsal record and refuse otherwise; the operator records each process's reported identity. Until the pipeline has an equivalent guard (P-4), its processes are not started against the branch |
| Explicit staging-only environment variables and fail-closed guards | §4 | none for Orion; pipeline guard not yet written | **G2:** the pipeline guard (explicit staging variable, confirmed host, deny-list, not local, expected baseline) is a precondition, not an option |
| Reproducible baseline for both repositories | P-1, §5 | The minimum file set was not named | **G3:** the baseline must include at least the files listed in `ORION_INTEGRATION_READINESS_REPORT.md` §6; the rehearsal record states the commit IDs |
| Migration history reconciliation | §5 (carry, do not edit) | Reconciliation was a note, not a step | **G4 (new step R1b before R2):** compare each repository's journal with the history recorded on the branch (Orion: `drizzle.__drizzle_migrations` by timestamp; pipeline: `schema_migrations` by name, including the recorded `013` that matches no commit, and duplicates without `.sql`); list what each runner would apply; the owner decides, in writing, whether divergences are carried or reconciled. No history row is edited without that decision |
| Review of destructive view changes and dependencies | R5 (view tests) | No pre-migration review of the five `DROP VIEW … CASCADE` statements | **G5 (new step R1c before R3):** on the branch, list every view and its dependents (`pg_depend`/`pg_rewrite`, names only), map each `DROP VIEW … CASCADE` in the pipeline migrations to the objects it would remove, and require the migration to be rewritten without `CASCADE` before it is run |
| Regression testing of imports, People views, publication, accounts, credits, saved searches | §8.1 | none | unchanged |
| Rollback criteria and evidence collection | §12, §13 | none | unchanged |

Additional requirements:
- **G6 Credentials on a branch.** A database branch normally starts with the parent's roles. Treat branch credentials as production-equivalent until shown otherwise: verify in the Neon console what the branch inherited, reset or replace them for the branch if possible, and never use the production connection string for the branch. If the credentials found in tracked files (risk register RR-25) have not been rotated, the rehearsal must not be used as evidence that those credentials are safe.
- **G7 External side effects.** Besides the Orion neutral configuration (§4), set the pipeline's R2 variables empty and its local storage directory to a scratch path, so no object-store call can occur; confirm no mail or OAuth provider is configured.
- **G8 Customer data in the branch.** The branch is a copy of production data. Access is limited to the named operator and verifier; test identities only; no exports leave the environment; the owner sets retention and deletion (§6), and deletion is confirmed separately.
- **G9 Order of variants.** V1 and V2 each use a fresh branch from the same parent; neither may reuse a branch on which a migration has already run.
