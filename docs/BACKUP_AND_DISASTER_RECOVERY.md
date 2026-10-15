# Backup & disaster recovery plan

**Status: PROPOSED — NOT APPROVED.** RTO/RPO values below are proposed targets; they become commitments only after the owner signs off (record in `DOCUMENT_CONTROL_REGISTER.md`). Measured values from restore drills (§8) replace proposals. Created 2026-10-07.

Never put connection strings, passwords or keys in this document.

## 1. Scope and criticality

| Asset | Source of truth? | Recovery method | Tier |
|---|---|---|---|
| PostgreSQL (`orion_db`: users, credits, billing, imports, leads) | **Yes** | Restore from dump / provider PITR | 1 |
| Object storage (R2/S3/MinIO: uploads, exports) | **Yes** | Bucket versioning + replication | 2 |
| Typesense search index | No — derived | Rebuild from Postgres (re-index job); snapshot optional | 3 |
| Secrets / env (`.env.production`) | Yes | Secret manager / password vault, not git | 1 |
| Code & migrations | Yes | Git remote | — |

## 2. RTO / RPO targets (proposed)

| Tier | RPO (max data loss) | RTO (max downtime) | How RPO is met |
|---|---|---|---|
| 1 Postgres | **≤ 15 min** with provider PITR/WAL; **≤ 24 h** fallback (daily dump) | **≤ 4 h** | PITR (Neon/Supabase/RDS) + nightly `ops/backup/backup.sh` |
| 2 Object storage | ≤ 24 h | ≤ 8 h | Versioning + cross-region/second-bucket replication |
| 3 Typesense | n/a (rebuildable) | ≤ 8 h | Re-index from Postgres |

If the managed Postgres provider has no PITR, the **real** RPO is 24 h — raise the dump frequency (e.g. every 4 h via cron) to lower it.

## 3. Automated backup strategy

- **Script:** `ops/backup/backup.sh` — `pg_dump -Fc`, structural check (`pg_restore --list`), optional AES-256 GPG encryption, SHA-256 checksum, off-site upload, local pruning, success/failure ping.
- **Schedule:** daily 02:00 UTC (`0 2 * * * /opt/orion/ops/backup/backup.sh >> /var/log/orion-backup.log 2>&1`) or a scheduled CI/cron job. Use `0 */4 * * *` if RPO must be tighter and PITR is unavailable.
- **Config:** copy `ops/backup/backup.env.example` → `backup.env` (git-ignored). Use a dedicated read-only DB role.
- **Off-site:** upload to a bucket in a **different account/region** than production, with versioning and Object Lock/immutability if available (ransomware protection).
- **Encryption:** set `BACKUP_PASSPHRASE_FILE`; store the passphrase in the vault **separately from the backups**. A backup that can't be decrypted is not a backup.
- **Objects:** enable bucket versioning, and replicate (`rclone sync`/provider replication) to the backup bucket.
- **Typesense:** no backup required; optionally `POST /operations/snapshot?snapshot_path=…` to shorten re-index time.
- **Monitoring:** `BACKUP_PING_*` URLs alert if a backup fails **or does not run** (dead-man's switch). Pings carry no data.
- **Manifest (Phase 16):** every run appends to `backups/backup-manifest.log` (time, CREATED / UPLOADED / EXPIRED / PRUNE-FAILED / FAILED / WARNING, file name, size, checksum, encrypted yes/no). It contains no data and no keys; keep it with the backups. A missing line for a day is a missed backup.
- **Permissions (Phase 16):** the scripts run with `umask 077`; dumps, ledgers and the temporary decrypted file are readable by the running account only. Bucket permissions, public-access block and versioning cannot be checked from the repository: verify them in the provider console (checklist in `DATA_RETENTION_POLICY.md` §7).
- **Deletion ledger (Phase 16):** each run also writes `ledger/orion_ledger_<time>.json` (encrypted with the same passphrase), a digest-only record of everything deleted or suppressed so far. It is stored beside the dump, never inside it. `BACKUP_SKIP_LEDGER=true` disables it (not recommended). Without a ledger a restore silently resurrects deleted data.

## 4. Retention policy

| Class | Kept | Where |
|---|---|---|
| Daily | 7 | local + remote |
| Weekly (Sunday) | 4 | local + remote |
| Monthly (1st) | 12 | remote |

Local pruning is done by the script; enforce the same on the remote bucket with a lifecycle rule (daily prefix expire 7 d, weekly 28 d, monthly 365 d). Longer legal/compliance retention overrides this; deletion requests for personal data (see `PEOPLE_SUPPRESSION.md`) must be re-applied after any restore (§5 step 6).

**Deleted data stays in old backups until they expire** (up to ~12 months with this schedule). Backups cannot be selectively scrubbed; encrypting them does not make them compliant with a deletion request, it only limits who can read them. The privacy notice must say so, and the ledger (§5) ensures a restore does not put that data back into service. Whether a 12-month monthly tier is acceptable is decision D-RET-5.

## 5. Recovery procedures

**A. Restore to a new database (default, safest)**
1. Declare the incident and freeze deploys (see `INCIDENT_RESPONSE_RUNBOOK.md`).
2. Provision an empty Postgres (or use provider PITR to a point before the fault).
3. Pick the backup: latest good file in `daily/` (or remote `postgres/daily/`). Verify checksum.
4. `ops/backup/restore.sh <file> <NEW_DATABASE_URL>`
5. Confirm schema: `drizzle.__drizzle_migrations` matches `apps/api/src/database/migrations/meta/_journal.json`; run `npm run drizzle:migrate --prefix apps/api` only if the backup predates newer migrations (see `MIGRATION_RUNBOOK.md`).
6. **Re-apply deletions BEFORE anything can read the data** (API, queue workers and search re-index stay stopped until this is done):
   1. Pick the newest ledger file (`ledger/` locally or `postgres/ledger/` remotely), verify its `.sha256`, decrypt it if `.gpg`.
   2. Dry run: `npm run db:ledger --prefix apps/api -- reapply --in <ledger.json>` — prints what would change and changes nothing.
   3. Apply: `CONFIRM_DESTRUCTIVE_DATABASE=<db> npm run db:ledger --prefix apps/api -- reapply --in <ledger.json> --apply` (one transaction; safe to repeat). **Today this script refuses a remote database**; applying it to a restored production database needs an approved change request or a guard exception (decision D-RET-9).
   4. Confirm the audit entry `POST_RESTORE_RECONCILED` exists and that no `privacy_requests` row is still PENDING for an erased account.
   5. Only then start the API and queue workers, and run the Typesense re-index (step 8).
   Anything deleted *after the ledger was generated* is not in it: re-run the operator's request log for that window by hand.
   Also reconcile credits/billing events since the backup timestamp against the payment provider.
7. Point `DATABASE_URL` at the new database, restart the API, check `/health` (`HEALTH_CHECKS.md`).
8. Re-index Typesense from Postgres **after step 6**; verify search. Pending queue jobs restored from the backup must not run before step 6.
9. Verify uploads exist in object storage for restored rows; restore missing objects from bucket versions.
10. Lift the freeze; record timeline, data-loss window and follow-ups.

**B. In-place restore** — only when the database is corrupted and a new one is impossible: `restore.sh <file> <URL> --force` (drops and recreates objects). Take a fresh dump of the damaged state first.

**C. Single-table recovery** — restore into a scratch DB, then `pg_dump -t <table> | psql` into production inside a transaction.

## 6. Rollback procedures

| Change | Rollback |
|---|---|
| API/web release | Redeploy previous image/tag or Vercel "Promote previous deployment"; no data action needed if migrations were additive. |
| Schema migration | Drizzle has no down-migrations. Before every production migration: run `backup.sh` (or take a provider snapshot) and note its filename in the change request. If the migration breaks the app: stop API, restore (§5A) to a new DB, redeploy previous release. Prefer expand/contract migrations (add → backfill → switch → drop later) so rollback is just a code redeploy. |
| Bad data import | Use the import batch rollback/suppression tooling if present, else single-table recovery (§5C). |
| Config/secret change | Revert in the secret manager; restart. For leaked credentials follow `CREDENTIAL_ROTATION_EXECUTION_PLAN.md`. |

## 7. Disaster scenarios

| Scenario | Response | Expected recovery |
|---|---|---|
| Accidental delete / bad migration | Provider PITR to just before, or §5A/§5C | < 1 h – 4 h |
| DB provider outage | Wait for provider SLA if < RTO; else §5A into another provider/region from latest dump | ≤ 4 h |
| Region/provider loss | Restore dump from off-site bucket into alternate region; redeploy API there; update DNS | ≤ 4–8 h |
| Ransomware / compromised credentials | Isolate, rotate **all** secrets, restore from immutable off-site copy | ≤ 8 h |
| Typesense loss | Re-index | ≤ 8 h, search degraded meanwhile |
| Loss of backup passphrase | Unrecoverable encrypted backups — keep 2 vault copies owned by different people | — |

## 8. Testing

- **Monthly restore drill:** `ops/backup/verify-restore.sh <scratch-admin-url>` restores the newest backup into a throwaway DB, checks tables/migrations, and prints measured restore seconds. Record it below.
- **Quarterly:** full DR exercise (new region/provider, deploy, search re-index, smoke test) with a stopwatch against RTO.
- **After any change** to the backup process or schema tooling.

| Date | Backup file | Measured restore time | Result | Run by |
|---|---|---|---|---|
| 2026-10-12 | encrypted dump of a 40 KB **test** database (local PostgreSQL 18.3, disposable) | 2 s (not representative; no RTO can be derived) | PASS: checksum, decrypt, restore, tamper refused, ledger re-apply (dry run + apply + repeat) verified. Production-scale drill: NOT RUN | Phase 19 (automated) |

## 9. Ownership

| Role | Person |
|---|---|
| DR owner | NOT SET |
| Backup operator | NOT SET |
| Backup passphrase custodians (2) | NOT SET |
| Approver of this plan | NOT SET |

## 10. Phase 30 validation and changes to section 5 (2026-10-13)

Full report: `DISASTER_RECOVERY_VALIDATION_REPORT.md`. A restore of a 249 MB synthetic database was run for real (restore 21 s; whole drill 71 s of machine time on one developer machine; not a production figure and not an RTO). Where this section differs from section 5, this section applies:

1. **Start nothing yet** still holds, and is now enforceable: start the API with `RESTORE_MODE=true`. It answers requests but runs no queue worker, scheduled export, webhook delivery, credit rollover, retention or token clean-up. Unset it and restart only after step 6 and the verification.
2. **The ledger must be fresh.** The ledger written with the dump contains nothing the dump does not already contain; it cannot redo a deletion made after the dump (measured: 0 of 5 exposures closed). Write it far more often than the dump: `LEDGER_ONLY=true ops/backup/backup.sh` (every 15 minutes suggested), to the same protected store. The ledger now also lists withdrawn companies (archived or rejected) and suspended accounts (ids only).
3. **`reapply --apply` also ends sessions:** it revokes every refresh token and replaces every account's session identifier (once per ledger). Then rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` in the host to end any access token still in circulation, **but only if `MFA_ENCRYPTION_KEY` and `INTEGRATIONS_ENCRYPTION_KEY` are set to their own values**: when they are empty the encryption key is derived from `JWT_ACCESS_SECRET`, and rotating it makes every stored MFA secret and integration credential unreadable. Keep both keys in the secret store, escrowed separately from the backups, and never in a backup.
4. **The apply guard needs a verified backup of the target database.** For a freshly restored local copy run `npm run db:backup` against it first (about 29 s here). A remote database is refused by the tool: applying the ledger to a restored production database needs an approved change request (open item R-074).
5. **After the data-loss window:** reconcile payments and purchases made after the dump against the payment provider's records (no tool exists); accounts that changed their password after the dump have the old password again; run `npm run db:reconcile-credits` and compare with the source if it is still readable.
6. Restore drills table (section 8) gains: 2026-10-13, encrypted dump of a 249 MB synthetic database, restore 21 s, full drill 71 s, PASS: row counts and key hashes equal in 68 tables, 0 orphans over 95 foreign keys, publication states preserved, ledger re-apply and session reset verified. Production-scale drill: NOT RUN.
