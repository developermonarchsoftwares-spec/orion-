# Phase A2 approval readiness: read-only production evidence run

**Status: `DRAFT — NOT APPROVED`**

This document stays in this status until the owner completes every decision in it and signs §12. Nothing in it authorizes a connection to any database, the execution of any SQL, or any change. Every field marked `PENDING OWNER` is owner-controlled and unconfirmed; none has been filled in, assumed or inferred from logs.

- **Record ID:** `PENDING OWNER`
- **Source:** the owner-review revision of the approval record prepared in the Stage 1/Phase A2 conversation, plus the static review report.
- **Prepared:** 2026-10-02, Stage 2. No database was contacted and no SQL was executed in preparing this document.

---

## 1. Reviewed versions this record covers
This record applies **only** to these two exact files:

| File | SHA-256 | Size / lines |
|---|---|---|
| `docs/phase-a2/PHASE_A2_READONLY_EVIDENCE_CHECKS.sql` | `aba19a76cdf5fd61180e426340d6a282e57ec22510a44e8cee21535c4b195f82` | 54,010 B / 860 lines |
| `docs/phase-a2/PHASE_A2_CHECKLIST.md` | `88654eb918bc50b3cb4f0e9539214a4799fe9660a2067f84bca03d37090637af` | 19,420 B / 126 lines |

**Binding terms**
- **Any change** to either file, however small, **invalidates this approval and requires a new static review and a new owner sign-off**.
- A changed file is not covered by this record; the previous approval does not carry over to it.
- Immediately before the run the operator recomputes both hashes and compares them with the values above. If either differs, **the run does not start**.
- Static review verdict on these versions: READY FOR HUMAN APPROVAL, with conditions. That verdict is not an authorization.
- Neither file is tracked in git (they are untracked working-tree files), so the hash is the only version identity.

## 2. Checks in the originally proposed scope
These are conditionally proposed by the owner and become approved only when §12 is signed.

| Checks | Reads |
|---|---|
| C08a, C08b, C08c, C08c2, C08d | `public.import_batches` (aggregates only) |
| C09b | `public.pipeline_jobs` (aggregates only) |
| C09c | `public.execution_logs` (level counts and newest time only) |
| C09d, C13a, C13b, C14a, C14b | `public.businesses`, `public.users`, `public.credit_transactions` (counts, ranges and categorical values only) |
| C10a, C10b | `pg_stat_activity`, run with existing permissions only (see §9, A1 and A2) |

☐ Owner confirms the above is the approved six-table aggregate scope plus C10. `PENDING OWNER`

## 3. Decision: checks that read beyond the six-table scope
Mark exactly one box per row.

| Check | Reads | If excluded | Decision |
|---|---|---|---|
| C01, C01s | `drizzle.__drizzle_migrations` (IDs, timestamps, 8-hex hash prefixes) | No database-side evidence of Orion's applied migration history | ☐ APPROVE ☐ EXCLUDE `PENDING OWNER` |
| C02 | `public.schema_migrations` (file names, timestamps) | No database-side evidence of the pipeline's history, including the migration-013 discrepancy | ☐ APPROVE ☐ EXCLUDE `PENDING OWNER` |
| C13c | `public.accounts` (row count only) | The size of the pipeline's customer-account table stays unknown | ☐ APPROVE ☐ EXCLUDE `PENDING OWNER` |

**Excluded checks and how they may be skipped**
- An excluded check is skipped by **not executing its block**.
- The operator runs the file's existing blocks **unmodified and in file order**, leaving out only the excluded blocks.
- This omission is the only permitted deviation from running the file as written. It is not editing, splitting or reordering, because no block's text or order is altered, and it does not change the file or its hash.
- Any other deviation is prohibited under §10.

## 4. Mandatory check, and decision on the remaining metadata checks

### 4A. C00 is mandatory and cannot be excluded
**Check C00** reads the session read-only status, database name, server version, connected role and monitoring privilege.
- **It is not subject to approval or exclusion.** It is a required part of any run authorized by this record.
- C00 is the run's safeguard: it proves the server enforces read-only, shows which database and role are connected, and supplies `can_read_all_stats`, on which the C10 compensating rule (§9, A2) depends.
- **If C00 cannot run successfully, the evidence run must stop.** "Cannot run successfully" means any of:
  - C00 returns an error, a timeout, or no result;
  - `read_only` is not `on`;
  - `database_name` is not the approved database in §7.
- No other check may run, or continue, after such a C00 outcome.
- No substitute, edited or manual equivalent of C00 may be used.

### 4B. Decision: remaining metadata and catalogue checks
Excluding any of these does not affect C00, which still runs.

| Checks | Reads |
|---|---|
| C03a, C03b | Schemas and relation counts by owner |
| C04 | Existence of named objects |
| C05, C05b | Column comparison of seven shared tables |
| C06a, C06b, C06c | `import_batches` index and constraint structure |
| C07 | Enum labels |
| C09a | Activity counters, including tables outside the six |
| C11a–C11g | Role attributes, memberships, grants, default privileges, schema and database ACLs |
| C12a, C12b | View names, owners and dependents (no definitions) |

Decision for this class as a whole: ☐ APPROVE ☐ EXCLUDE `PENDING OWNER`
Or per check, if the owner wants only some excluded: `PENDING OWNER`

C03, C11 and C12 return role names and ACL strings. They contain no credentials.

## 5. Maintenance window
All fields are unapproved placeholders until supplied by the owner.

| Field | Value |
|---|---|
| Date | `PENDING OWNER` |
| Start time | `PENDING OWNER` |
| End time | `PENDING OWNER` |
| Time zone | `PENDING OWNER` |

- The run must not overlap any migration, DDL or deployment activity.
- It must finish inside the window.
- The operator cannot extend the window. When it ends, the run stops (§11).

## 6. People and role
| Role | Value |
|---|---|
| Named operator | `PENDING OWNER` |
| Intended Neon role used to connect | `PENDING OWNER` (existing permissions only) |
| Designated abort authority | `PENDING OWNER` |
| Abort contact during the window | `PENDING OWNER` |

## 7. Approved endpoint
| Field | Value |
|---|---|
| Approved **direct** production host (no `-pooler`) | `PENDING OWNER` |
| Database name | `PENDING OWNER` (the owner has described it as `neondb`; not confirmed here) |
| **Explicitly excluded: the rehearsal-branch endpoint** | **Must not be used.** Its host name begins `ep-patient-mouse-` (observed in the staging log, for reference only). Full host to be refused: `PENDING OWNER` |
| Pooled (`-pooler`) endpoint of any database | Excluded |

- No connection string, user name or password appears in this record or anywhere shared.
- The operator verifies the host and database name against this record, using host names only, before running.
- Database identity is never proven by a URL, hostname, branch name or environment variable alone; C00's `database_name` is checked in addition, and the Neon console is the authority on branch identity.

## 8. Output handling
| Field | Value |
|---|---|
| Storage location | `PENDING OWNER` |
| Permitted viewers (names or roles) | `PENDING OWNER` |
| Retention period and deletion date | `PENDING OWNER` |
| Sharing with the assistant | `PENDING OWNER`: ☐ permitted after the operator's redaction scan ☐ not permitted |

- The raw output file stays unedited, with its SHA-256 recorded.
- Free-text columns (`processing_status`, `publishing_status`, `stage`, `job_type`, `status`, `level`, `application_name`) are scanned for emails, tokens, URLs and file names before any sharing.

## 9. Acknowledgements
Each requires the owner's initials in §12.

☐ **A1. C10 visibility.** C10 runs with existing permissions only and has limited visibility. It **cannot prove the absence of other writers**: it is a snapshot, a periodic worker can be missed, pooled sessions blur identity, and absent rows are never evidence of "no pipeline running". Dated activity in C09 shows only when the last write occurred.

☐ **A2. C10 hidden-session counter.** The `hidden_client_sessions` counter in C10a is **considered unreliable**: it tests `datname IS NULL`, but `datname` and `usename` are probably visible to all callers, while `state` and `application_name` are the blanked columns. The package has not been corrected. **Compensating rule in force:**
- C10 conclusions are permitted only if C00's `can_read_all_stats` is `true`.
- If `can_read_all_stats` is `false`, C10 is incomplete regardless of C10a.
- `state IS NULL` rows in C10b, and `(none)` application names there, are read as "hidden", not "unset".

☐ **A3. Errors are findings.** SQL errors, permission failures (`42501`), missing objects or columns (`42P01`, `42703`) and timeouts (`57014`) are **findings to record**. No ad hoc fixes, query edits, splitting, reordering or retries are permitted without a new owner approval in writing. A dropped connection stops the run.

☐ **A4. Timeout compensation.** `lock_timeout` and `idle_in_transaction_session_timeout` are set in C00's block only, so the operator applies the session-level options from the review report before running.

☐ **A5. Expected results.** `import_batches.people_summary` reported as `MISSING_IN_DB` (pending migration 0006) and 15 unapplied journal entries are expected, not drift.

☐ **A6. Prior observations.** Earlier database observations are not evidence of the current production state.

## 10. Authorization boundary
This approval authorizes **only** the defined read-only evidence run: the checks approved in §2–§4, on the endpoint approved in §7, in the window approved in §5, by the operator named in §6.

**It does not authorize, and nothing in it may be read as authorizing, any of the following:**
- **Migrations:** no migration of any kind, on any database, including production, the rehearsal branch, or any other environment, and no running of either application's migration tooling.
- **DDL:** any schema change, including creating, altering or dropping tables, views, indexes, schemas (including `orion_pipeline`) or types.
- **Data changes:** inserts, updates, deletes, backfills, seeds, cleanups or any change to row contents.
- **Roles and grants:** creating roles, **modifying or revoking existing roles**, **modifying or revoking existing grants, privileges or default privileges**, changing memberships, schema or database ACLs, or ownership.
- **Application code changes** in either repository.
- **Worker, scheduler and server changes:** starting, stopping, pausing or reconfiguring any server, worker, scheduled job, watcher or process of either application.
- **Deployment changes:** deploying, redeploying or changing configuration, environment variables or infrastructure.
- **Query changes:**
  - **Any editing of the SQL**, in any way.
  - **Any splitting, merging or reordering of its statements or blocks.**
  - Any other change to the text, order, parameters or timeouts of a query in the reviewed file.
  - The only permitted deviation is omitting blocks for excluded checks as described in §3.
- **Retries, repairs and re-runs:** retrying any statement or block, repairing any error, running a corrected or replacement check, or re-running the package.
- **Run extensions:** running outside the approved window, or extending it.
- **Acting on results in the same session.**

**Any of these requires a separate approval in writing** from the owner. That approval must name the specific action. Neither this record, its signature, the evidence results, nor the static review report is such an approval.

## 11. Stop conditions
The operator stops the run and notifies the abort authority if any of these occur:
- C00 cannot run successfully (§4A), or does not show `read_only = on`.
- The host or database differs from §7.
- The host is the rehearsal endpoint or a pooled endpoint.
- Either file's SHA-256 differs from §1.
- A statement other than a SELECT is about to execute.
- Output contains personal data, a secret, a URL or a file name.
- Two or more timeouts occur.
- The connection drops.
- The window ends.

Stopping means no further check is run and nothing is retried or repaired. The operator reports only what was recorded.

## 12. Owner sign-off
**This record is not approved until every item below is completed and the owner signs.**

| Item | Value |
|---|---|
| Owner name | `PENDING OWNER` |
| §2 baseline scope confirmed | ☐ |
| §3 decisions made (C01/C01s, C02, C13c) | ☐ |
| §4A read: C00 is mandatory and cannot be excluded | ☐ |
| §4B decision made | ☐ |
| §5 maintenance window completed | ☐ |
| §6 operator, role, abort authority and contact completed | ☐ |
| §7 production endpoint and rehearsal endpoint completed | ☐ |
| §8 output handling completed | ☐ |
| Acknowledgements A1–A6 initialled | `PENDING OWNER` |
| §1 invalidation terms and §10 authorization boundary read and accepted | ☐ |
| Signature and date | `PENDING OWNER` |

---

## Appendix A. Outstanding owner decisions (summary)
Nothing below is decided. This list only collects what §§2–12 require.

1. §2: confirm the six-table aggregate scope plus C10.
2. §3: approve or exclude each of C01/C01s, C02, C13c.
3. §4B: approve or exclude the metadata/catalogue class (C03a, C03b, C04, C05, C05b, C06a–c, C07, C09a, C11a–g, C12a, C12b). C00 is not part of this decision.
4. §5: maintenance date, start time, end time, time zone.
5. §6: named operator, Neon role, abort authority, abort contact.
6. §7: verified direct production hostname, database name, full rehearsal hostname to refuse.
7. §8: output storage location, permitted viewers, retention/deletion date, sharing decision.
8. §9: initial A1–A6, including explicit acceptance of the C10a compensating rule (A2).
9. §12: record ID, owner name, signature and date.
10. Optional, separate: whether to authorize a corrected C10a (`state IS NULL`), which would change the SQL hash and require a new static review (§1).

## Appendix B. Integrity notes (committed vs working tree)
- Both Phase A2 files are untracked in the Orion repository (`docs/phase-a2/`); no committed version exists.
- The expected-data embedded in the SQL (18 journal entries with sha256 prefixes, 116 columns of seven shared tables, 14 pipeline migration file names) was verified equal to the repositories' working-tree files at the time of the static review. Orion migrations 0004–0017 and their snapshots are **uncommitted**, and the pipeline repository has **uncommitted modifications** (including `server.py` and `python_pipeline/migrate.py`), so the working tree is not a reproducible baseline.
- The SQL's pipeline file list reflects `migrations/` at pipeline HEAD `518c68f`, which has no uncommitted changes in that directory.

## Appendix C. Stage E readiness check (2026-10-02)
This appendix does not alter the record above, which remains `DRAFT — NOT APPROVED`.

- **File integrity:** the SQL and checklist still match the hashes in §1 exactly (verified by hash comparison; nothing was changed).
- **Prerequisites from the record, status:** scope baseline (§2) unconfirmed; C01/C01s, C02, C13c decisions (§3) not made; metadata class decision (§4B) not made; maintenance window (§5) not supplied; operator, Neon role, abort authority and contact (§6) not supplied; production host, database name and the full rehearsal host to refuse (§7) not supplied; output storage, viewers, retention and sharing decision (§8) not supplied; acknowledgements A1-A6 not initialled; owner name, record ID, signature and date not supplied. **No field of §§2-8 or §12 has been completed.**
- **C00 behavior:** documented as mandatory in §4A and §11 (any failure, timeout, no result, wrong database or `read_only` not `on` stops the run and no other check may run).
- **New caveat for the owner (see `PIPELINE_RUNTIME_RISK_REGISTER.md` RR-25):** credentials that appear to belong to the production-configured database role were found in tracked files that are on the remote. If the owner decides to rotate them, the role and password the operator uses in §6 will change; the approval record, the window and the abort plan should be settled with that sequence in mind. This caveat does not modify the reviewed files.
- **Phase A2 has not been run and must not be run until §12 is signed.**
