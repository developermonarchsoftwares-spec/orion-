# Production change request (TEMPLATE, blank)

**Status: TEMPLATE. Not a request, not an approval.** One request per change step, smallest first. Filling this template does not authorize anything. A passing rehearsal does not grant permission for a production change; only the owner's separate written approval in §15 does, and only for exactly what is written here.

Every field is a placeholder. Write `PENDING OWNER` or `NOT PROVIDED` rather than guessing. Never put into this document: connection strings, passwords, tokens, customer data, query output with customer content, object keys or file names.

Related: `TARGET_ARCHITECTURE.md`, `MIGRATION_REHEARSAL_PLAN.md`, `DATABASE_OWNERSHIP_MATRIX.md`, `PIPELINE_RUNTIME_RISK_REGISTER.md`, `MIGRATION_RUNBOOK.md`.

## 1. Identification
| Field | Value |
|---|---|
| Request ID | `[ ]` |
| Title (one step only) | `[ ]` |
| Requester | `[ ]` |
| Date prepared | `[ ]` |
| Status | `DRAFT — NOT APPROVED` |
| Depends on (rehearsal report ID, Phase A2 evidence report ID, decision record IDs) | `[ ]` |

## 2. Purpose and change summary
Why this change, which ownership or contract decision it implements, and the exact outcome. One step only (for example: "create roles", "create schema `orion_pipeline`", "apply migration set X", "create view Y").
`[ ]`

## 3. Exact target
| Field | Value |
|---|---|
| Neon project and branch name (as shown in the Neon console) | `[ ]` |
| Branch id and parent (console record) | `[ ]` |
| Endpoint host used (host name only; direct endpoint; no pooler) | `[ ]` |
| Database name | `[ ]` |
| Verified by (name) and how (console record, not URL) | `[ ]` |
| State fingerprint expected immediately before the change (migration history rows, table counts, package rows, role inventory), with the snapshot file hash | `[ ]` |
| Explicitly excluded targets (rehearsal branch, any other branch) | `[ ]` |

Identity is never proven by a hostname, URL, branch name or environment variable alone.

## 4. Exact files and SQL
No inline or ad hoc SQL. Everything to be applied is a committed file, reviewed, with its hash.
| Order | Repository | Path | Commit ID | SHA-256 | Executed by (role) |
|---|---|---|---|---|---|
| 1 | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

- Migration journals touched, and the exact entries added: `[ ]`
- Statements that are destructive (drops, type changes, `DROP VIEW`, `DELETE`, `TRUNCATE`): `[none / list]`. Each requires its own justification in §10 and a dependency report. `DROP … CASCADE` is not permitted.
- The same files, in the same order and at the same hashes, were applied in the rehearsal: ☐ yes (rehearsal ID `[ ]`)

## 5. Objects affected
| Object (schema.name) | Kind | Action | Owner after change | Dependents checked (views, functions, code) |
|---|---|---|---|---|
| `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

Roles, grants, default privileges, schemas and views affected: `[ ]`. Application configuration or environment changes required: `[ ]`.

## 6. Preconditions (all must be true; record the evidence)
| # | Precondition | Evidence |
|---|---|---|
| 1 | Both repositories reproducible from the named commits | `[ ]` |
| 2 | Phase A2 evidence accepted and still current (re-checked on the day) | `[ ]` |
| 3 | Rehearsal succeeded on a verified branch with the same files | `[ ]` |
| 4 | Restore-tested backup or recoverable snapshot taken immediately before the change; restore time measured | `[ ]` |
| 5 | Writers frozen as agreed (pipeline server, workers, watchers stopped or disabled with `AUTO_MIGRATE` off; Orion maintenance mode if needed); freeze verified | `[ ]` |
| 6 | No overlapping migration, DDL or deployment | `[ ]` |
| 7 | Guards in place: target confirmation, deny-list, migrator role (not an application role) | `[ ]` |
| 8 | Approver list (§15) available during the window | `[ ]` |
| 9 | Credential hygiene: no credentialed production URL is tracked in either repository or its pushed history, or the exposure was handled by a recorded rotation; the roles used are the post-rotation ones | `[ ]` |

## 7. Backup and recovery plan
| Item | Value |
|---|---|
| Backup/snapshot method and identifier | `[ ]` |
| When taken (relative to the change) and by whom | `[ ]` |
| Restore verified how (restore to a throw-away branch, compare snapshots) | `[ ]` |
| Expected restore time | `[ ]` |
| Data written after the backup that would be lost on restore | `[ ]` |
| Recovery limits (no down-migrations exist unless provided here) | `[ ]` |

## 8. Expected impact and downtime
| Item | Value |
|---|---|
| Customer-visible effect | `[ ]` |
| Expected downtime or read-only period | `[ ]` |
| Services stopped, restarted, in what order | `[ ]` |
| Communication to customers and teams | `[ ]` |

## 9. Locking and compatibility risks
| Statement or file | Lock taken | Tables affected and size | Expected duration | Blocking risk | Mitigation (timeouts, order, `lock_timeout`) |
|---|---|---|---|---|---|
| `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

Compatibility: old and new application versions against old and new schema (deployment order that never leaves a running version without a column it needs): `[ ]`. Migration-history effects on each runner (Drizzle skips by timestamp; the pipeline by file name): `[ ]`.

## 10. Risk and justification for destructive or irreversible steps
`[ ]` (for each: what could be lost, how it is detected, how it is undone).

## 11. Deployment sequence
| Step | Action | Owner (person) | Check before proceeding | Stop if |
|---|---|---|---|---|
| 1 | Verify target identity and hashes | `[ ]` | `[ ]` | mismatch |
| 2 | Freeze writers and verify | `[ ]` | `[ ]` | `[ ]` |
| 3 | Take and verify backup | `[ ]` | `[ ]` | not verified |
| 4 | Apply file(s) in order with the migrator role | `[ ]` | `[ ]` | non-zero exit or unexpected output |
| 5 | Post-change verification (§12) | `[ ]` | `[ ]` | any failure |
| 6 | Re-enable writers in the agreed order | `[ ]` | `[ ]` | `[ ]` |
| 7 | Monitoring period | `[ ]` | `[ ]` | `[ ]` |

## 12. Verification steps and acceptance
| Check | Method (read-only where possible) | Expected result | Result (filled during execution) |
|---|---|---|---|
| Migration history | audit of both histories | exactly the planned entries | `[ ]` |
| Table counts and package rows unchanged | `db:rehearsal compare` | only declared changes | `[ ]` |
| Schema and ownership | catalogue checks | matches the contract | `[ ]` |
| Roles and grants | permission matrix against the real roles (allowed and denied) | exact | `[ ]` |
| Views | contract tests; dependents intact | exact | `[ ]` |
| Application smoke tests (login, discovery, unlock, credits, saved searches, import, People view) | disposable test identities only | pass | `[ ]` |
| Error rates and logs | monitoring | within the agreed bounds for `[ ]` minutes | `[ ]` |

## 13. Rollback or forward-recovery strategy
| Item | Value |
|---|---|
| Strategy (restore from backup, forward fix, or both) | `[ ]` |
| Trigger conditions | `[ ]` |
| Who decides, and by when | `[ ]` |
| Steps | `[ ]` |
| What cannot be undone | `[ ]` |
| Evidence preserved before any rollback | `[ ]` |

## 14. Stop conditions and responsible people
Stop at once (and notify the abort authority) if: identity or hash mismatch; a freeze cannot be verified; backup not verified; any unexpected statement output; non-zero exit; unexpected row-count change; a security or privilege anomaly; secrets or customer data in output; the window ends.

| Role | Name |
|---|---|
| Operator | `PENDING OWNER` |
| Verifier (second person) | `PENDING OWNER` |
| Abort authority and contact | `PENDING OWNER` |
| Database owner | `PENDING OWNER` |
| Orion owner / pipeline owner | `PENDING OWNER` / `PENDING OWNER` |
| Window (date, start, end, time zone) | `PENDING OWNER` |

## 15. Approvals (separate, written, per request)
| Approver | Scope approved | Decision | Signature / date |
|---|---|---|---|
| Database owner | exactly §3-§5 as written | ☐ approve ☐ reject | `PENDING OWNER` |
| Orion application owner | compatibility of the change | ☐ approve ☐ reject | `PENDING OWNER` |
| Pipeline application owner | compatibility of the change | ☐ approve ☐ reject | `PENDING OWNER` |
| Security reviewer | roles, grants, exposure | ☐ approve ☐ reject | `PENDING OWNER` |

This request authorizes nothing outside §3-§5. It does not authorize any other migration, DDL, data change, role/grant change, deployment or retry. Any change to a listed file, hash or target invalidates the approval and requires a new review.

## 16. Execution record (completed during and after the change)
Start/end times: `[ ]`. Deviations: `[ ]`. Outputs stored at: `[ ]` (no secrets). Verification results: `[ ]`. Rollback invoked: ☐ no ☐ yes, details `[ ]`. Follow-up items and owners: `[ ]`. Closed by / date: `[ ]`.
