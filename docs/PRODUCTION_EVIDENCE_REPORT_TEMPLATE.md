# Production evidence report (TEMPLATE, blank)

**Status: TEMPLATE. No results are recorded in this file.** It is completed by the authorized operator, after the Phase A2 approval record (`docs/PHASE_A2_APPROVAL_READINESS.md`) has been signed by the owner and the read-only evidence run has been performed. Every field below is a placeholder. Do not fill any field from memory, from earlier audits or from logs: write `NOT RUN`, `NOT AVAILABLE` or `UNKNOWN` instead.

Never put into this report: connection strings, passwords, tokens, query text from database sessions, client addresses, customer names or records, object keys or paths, file names, or view/function definitions.

## 0. Fact classification (use on every statement)
| Label | Meaning | Rule |
|---|---|---|
| **OBSERVED** | Present in this run's output, with a check ID | Always cite the check ID |
| **HISTORICAL** | From an earlier audit (2026-10-01 or before) | Never present as current; compare with OBSERVED |
| **INFERENCE** | A reasoned conclusion from OBSERVED facts | State the reasoning; do not promote to fact |
| **UNKNOWN** | Not established | Name the evidence that would settle it |

A missing activity row is never proof that a service is not running. No finding in this report is permission to fix it.

## 1. Run metadata
| Field | Value |
|---|---|
| Approval record ID | `[ ]` |
| Operator (named in the record) | `[ ]` |
| Neon role used (from C00 `connected_role`) | `[ ]` |
| Maintenance window approved (date, start, end, time zone) | `[ ]` |
| Actual start / end (with time zone) | `[ ] / [ ]` |
| Run completed inside the window | ☐ yes ☐ no |
| Output file name and SHA-256 | `[ ]` |
| Output storage location, viewers, retention (from the record) | `[ ]` |

## 2. Endpoint verification
| Field | Value |
|---|---|
| Approved direct production host (record §7) | `[ ]` |
| Host used for the run (host name only) | `[ ]` |
| Host matches the record | ☐ yes ☐ no |
| Host is the rehearsal endpoint | ☐ no ☐ yes (STOP) |
| Host is a pooled (`-pooler`) endpoint | ☐ no ☐ yes (STOP) |
| C00 `database_name` | `[ ]` |
| C00 `read_only` | `[ ]` (must be `on`) |
| C00 `server_version`, `server_time_utc` | `[ ] / [ ]` |
| C00 `can_read_all_stats`, `is_pg_monitor` | `[ ] / [ ]` |
| Branch/environment identity confirmed in the Neon console by | `[ ]` (name, time) |

Database identity is not proven by the hostname or URL alone.

## 3. File hash verification
| File | Expected SHA-256 (record §1) | Recomputed before run | Match |
|---|---|---|---|
| `PHASE_A2_READONLY_EVIDENCE_CHECKS.sql` | `aba19a76cdf5fd61180e426340d6a282e57ec22510a44e8cee21535c4b195f82` | `[ ]` | ☐ |
| `PHASE_A2_CHECKLIST.md` | `88654eb918bc50b3cb4f0e9539214a4799fe9660a2067f84bca03d37090637af` | `[ ]` | ☐ |

A mismatch means the run did not start.

## 4. Checks executed, excluded and failed
One row per check ID. Blocks were run unmodified and in file order; only owner-excluded blocks were omitted.

| Check | Scope decision (record) | Executed | Result (`OK`, `ERROR <SQLSTATE>`, `TIMEOUT 57014`, `NOT RUN`) | Notes |
|---|---|---|---|---|
| C00 (mandatory) | mandatory | `[ ]` | `[ ]` | |
| C01, C01s | `[approve/exclude]` | `[ ]` | `[ ]` | |
| C02 | `[ ]` | `[ ]` | `[ ]` | |
| C03a, C03b | `[ ]` | `[ ]` | `[ ]` | |
| C04 | `[ ]` | `[ ]` | `[ ]` | |
| C05, C05b | `[ ]` | `[ ]` | `[ ]` | |
| C06a, C06b, C06c | `[ ]` | `[ ]` | `[ ]` | |
| C07 | `[ ]` | `[ ]` | `[ ]` | |
| C08a, C08b, C08c, C08c2, C08d | six-table scope | `[ ]` | `[ ]` | |
| C09a | `[ ]` | `[ ]` | `[ ]` | |
| C09b, C09c, C09d | six-table scope | `[ ]` | `[ ]` | |
| C10a, C10b | six-table scope + C10 limits | `[ ]` | `[ ]` | |
| C11a–C11g | `[ ]` | `[ ]` | `[ ]` | |
| C12a, C12b | `[ ]` | `[ ]` | `[ ]` | |
| C13a, C13b | six-table scope | `[ ]` | `[ ]` | |
| C13c | `[ ]` | `[ ]` | `[ ]` | |
| C14a, C14b | six-table scope | `[ ]` | `[ ]` | |

### 4.1 SQLSTATE, permission and timeout findings
Errors are findings. Record them; do not fix, retry or edit queries.

| Check | SQLSTATE (e.g. 42P01, 42703, 42501, 57014, 08006) | First message line (no statement text, no connection detail) | Interpretation |
|---|---|---|---|
| `[ ]` | `[ ]` | `[ ]` | `[ ]` |

Stop conditions triggered (record §11): `[none / list]`. Run stopped early: ☐ no ☐ yes, at `[check]`.

## 5. Migration history comparison
### 5.1 Orion (Drizzle) history: C01, C01s
| Item | OBSERVED value | HISTORICAL (2026-10-01) for comparison only |
|---|---|---|
| History rows | `[ ]` | 3 |
| Newest applied `created_at` | `[ ]` | 1789061231383 |
| Journal entries applied / pending | `[ ] / [ ]` | 3 / 15 |
| Rows not in the journal (`in_journal = false`) | `[ ]` | 0 |
| Hash prefix mismatches | `[ ]` | 0 |

Expected, not drift (record A5): entries 0003–0017 unapplied until a migration is approved and run. Anything newer than 1796500000000 means a newer journal was applied.

### 5.2 Pipeline (`schema_migrations`): C02
| Version | In current repo | Recorded | Applied at (UTC) | Note |
|---|---|---|---|---|
| `[ ]` | `[ ]` | `[ ]` | `[ ]` | |

Discrepancy summary, including migration 013 and 014: `[ ]`. Names recorded but absent from the repository: `[ ]`. Repository names not recorded (would run at a pipeline auto-migrate): `[ ]`. Duplicate names without `.sql`: `[ ]`.

## 6. Schema and ownership findings
| Item | Check | OBSERVED |
|---|---|---|
| Schemas present; `orion_pipeline` exists | C03a | `[ ]` |
| Relations by owner and kind | C03b | `[ ]` |
| Boundary objects present (People tables, published views, queue/OTP tables) | C04 | `[ ]` |
| Column differences vs Orion snapshot 0017 (counts per table; findings `MISSING_IN_DB`, `EXTRA_IN_DB`, `TYPE_DIFFERS`, nullability) | C05, C05b | `[ ]` |
| Extra NOT NULL columns without a default (inserts would fail) | C05 | `[ ]` |
| Enum labels (`import_status`, `business_status`, etc.) | C07 | `[ ]` |
| Views and views depending on `orion_published_businesses` | C12a, C12b | `[ ]` |

## 7. Shared-table compatibility
| Table | Orion columns missing in DB | Extra DB columns | Type/nullability differences | Compatibility concern observed | Check |
|---|---|---|---|---|---|
| `users` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | C05, C13a |
| `credit_transactions` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | C05, C13b |
| `saved_searches` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | C05 |
| `businesses` | `[ ]` | `[ ]` | `[ ]` | `[ ]` (status type and values) | C05, C14 |
| `business_history` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | C05 |
| `duplicate_clusters` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | C05 |
| `import_batches` | `[ ]` (expected: `people_summary`) | `[ ]` | `[ ]` | `[ ]` | C05, C06, C08 |

### 7.1 Publication-state evidence (C14)
`businesses.status` is only a **proposed** publication authority. Record the cross-tab and disagreement counts without concluding who writes which flag.
| Item | OBSERVED |
|---|---|
| `status` × `publishing_status` × `stage` groups | `[ ]` |
| Orion `PUBLISHED`, pipeline not | `[ ]` |
| Pipeline `PUBLISHED`, Orion not | `[ ]` |
| Both `PUBLISHED` | `[ ]` |
| Rows with `published_at` / `unpublished_at` | `[ ]` |
| Column type of `businesses.status` (enum or varchar) | `[ ]` (C05) |

## 8. `import_batches` findings (C06, C08)
**Do not assume `file_key` equals `r2_object_key`.** Equality of values on some rows is not proof of semantic equivalence. Report patterns only; never values.

| Item | OBSERVED |
|---|---|
| Rows by `status` × `processing_status` (C08a) | `[ ]` |
| `file_key` NULL / `r2_object_key` NULL counts (C08a) | `[ ] / [ ]` |
| Rows with both keys equal / differing (C08a) | `[ ] / [ ]` |
| `file_key` prefix classes (`imports/`, `raw/`, `<other>`, NULL) (C08b) | `[ ]` |
| `r2_object_key` prefix classes (C08b) | `[ ]` |
| `r2_uri` scheme classes (`r2`, `local-r2`, other, NULL) (C08b) | `[ ]` |
| Rows whose URI ends with their key (C08a) | `[ ]` |
| Checksum shape and duplicate groups (C08c, C08c2) | `[ ]` |
| `*_rows` vs `*_records` counter differences (C08d) | `[ ]` |
| Indexes: expected Orion set; pipeline `idx_import_batches_active_checksum` and others present? (C06a) | `[ ]` |
| Foreign keys into `import_batches` and delete actions (C06c) | `[ ]` |
| `processing_status` values that no code in either repository writes (e.g. `SUPERSEDED`) | `[ ]` (UNKNOWN until explained) |

Semantics still unresolved after this run: `[ ]`. Evidence needed to resolve them: `[ ]`.

## 9. Role and permission findings (C00, C11)
| Item | OBSERVED |
|---|---|
| Existing roles and attributes (C11a) | `[ ]` |
| Memberships (C11b) | `[ ]` |
| Owners of tables/views by schema (C03b, C11c, C11d) | `[ ]` |
| Explicit grants by grantee and privilege (C11c) | `[ ]` |
| Relations with only default (owner) privileges (C11d) | `[ ]` |
| Default privileges (C11e), schema and database ACLs (C11f, C11g) | `[ ]` |
| Do the two applications appear to share one role? | `[ ]` (INFERENCE unless a role per application is shown) |
| Neon-managed roles seen (not application roles) | `[ ]` |
| Limits: roles not visible, permission errors | `[ ]` |

## 10. Pipeline activity evidence and C10 limitations
Dated writes show when something last wrote, not which process wrote or whether anything runs now.

| Item | Check | OBSERVED |
|---|---|---|
| Table activity counters since last statistics reset | C09a | `[ ]` (counters can be reset by a compute restart) |
| `pipeline_jobs` by type/status, newest created/updated/heartbeat, distinct workers | C09b | `[ ]` |
| `execution_logs` rows by level, newest time | C09c | `[ ]` |
| Newest writes on `businesses`, `users`, `credit_transactions` | C09d | `[ ]` |
| Sessions: all / client / this session | C10a | `[ ]` |
| Sessions by role, application name, state | C10b | `[ ]` |
| C00 `can_read_all_stats` | C00 | `[ ]` |

**C10 interpretation rules (record A1, A2)**
- C10 uses existing permissions only. It is a snapshot; it cannot prove the absence of other writers. Pooling and limited statistics visibility reduce certainty further.
- The C10a `hidden_client_sessions` counter is considered unreliable. If C00 `can_read_all_stats` is `false`, C10 is **incomplete**, whatever C10a says.
- Rows with `state IS NULL`, and `(none)` application names in C10b, are treated as **hidden**, not unset.
- **Conclusion allowed from C10:** `[ ]`. **Not allowed:** that no pipeline process or other writer is active.

## 11. Confirmed facts, historical observations, inferences and unknowns
| Class | Statement | Evidence (check ID or source) |
|---|---|---|
| OBSERVED | `[ ]` | `[ ]` |
| HISTORICAL | `[ ]` | `[ ]` (state date; not current) |
| INFERENCE | `[ ]` | `[ ]` (reasoning) |
| UNKNOWN | `[ ]` | `[ ]` (evidence needed) |

## 12. Risks, unresolved questions and recommended next steps
Rank by severity and operational impact. An audit finding is not permission to fix it: every change needs a separate written approval.

| # | Risk or question | Severity | Evidence | Recommended next step (analysis only) | Approval needed before any change |
|---|---|---|---|---|---|
| 1 | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

### 12.1 Questions that must be answered before architecture planning proceeds
1. `[ ]`
2. `[ ]`

### 12.2 Whether architecture planning can proceed
☐ Yes ☐ No ☐ Conditionally: `[ ]` (reason; evidence supporting it).

## 13. Statement of scope compliance
- All executed blocks were SELECT-only inside `BEGIN READ ONLY`: ☐ confirmed by the operator
- No statement was edited, split, reordered, retried or repaired: ☐ confirmed
- No migration, DDL, data change, role/grant change, worker/server change or deployment occurred: ☐ confirmed
- The output was scanned for personal data, secrets, URLs and file names before sharing: ☐ confirmed

Operator: `[ ]` Date/time: `[ ]` Signature: `[ ]`
