# Incident response runbook

**Status: PROPOSED — NOT APPROVED.** Companion to `BACKUP_AND_DISASTER_RECOVERY.md`. Created 2026-10-07. Contact names/numbers are intentionally `NOT SET` — keep them in the vault, not here.

## 1. Severity

| Sev | Definition | Response | Update cadence |
|---|---|---|---|
| SEV1 | Full outage, data loss/corruption, confirmed breach or credential leak | Immediate, all hands | every 30 min |
| SEV2 | Major feature down (login, search, credits, billing, import), many users degraded | ≤ 30 min | every 60 min |
| SEV3 | Minor/partial, workaround exists | Next business day | daily |

## 2. Roles
Incident Commander (IC, decides and communicates) · Operations lead (hands on keyboard) · Communications lead (customers/status) · Scribe (timeline). One person may hold several roles in a small team, but the IC should not be the person debugging. Primary/backup on-call: **NOT SET**.

## 3. First 15 minutes
1. **Acknowledge** and open an incident channel/doc; note UTC start time.
2. **Assess:** `/health` endpoints (`HEALTH_CHECKS.md`), logs/metrics (`OBSERVABILITY.md`), recent deploys/migrations/config changes.
3. **Classify** severity; page the roles above.
4. **Stabilise:** stop the bleeding first — roll back the last release, disable the failing feature/job, pause import/queue workers.
5. **Preserve evidence** (logs, DB state) before destructive fixes.

## 4. Playbooks

**API down / 5xx spike** — check last deploy → roll back; check DB connectivity and pool (`DB_MAX_CONNECTIONS`); check Typesense/storage health; restart.

**Database unavailable or corrupted** — confirm with provider status; if data is corrupted, *stop writes* (scale API to 0), then follow `BACKUP_AND_DISASTER_RECOVERY.md` §5A. Data-loss window = incident time − backup/PITR time.

**Bad migration** — stop API → restore pre-migration backup to a new DB (§5A) → deploy previous release. See `MIGRATION_RUNBOOK.md`.

**Search broken / empty** — Typesense is derived: verify node health, re-index from Postgres; fall back to Postgres search (`apps/api/scripts/verify-postgres-search.ts`).

**Suspected breach / leaked secret** — treat as SEV1: rotate per `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` and `ACCOUNT_RECOVERY.md`, rotate JWT secrets (forces re-login), review access logs, restore from immutable backup if data was tampered. Assess notification duties (§6).

**Billing/credit discrepancy** — pause the credit scheduler, reconcile the ledger against provider events (`BILLING.md`), correct via ledger entries, never by silent row edits.

**Backup failure alert** — rerun `ops/backup/backup.sh`; if it still fails, SEV3 → SEV2 once a full day has been missed (RPO at risk).

## 5. Communication
- Internal: incident channel, updates at the cadence above.
- External: status page/banner + email for SEV1/SEV2 affecting customers. Template: *what is affected · since when (UTC) · what we're doing · next update time.* No speculation on cause until confirmed.

## 6. Data-breach obligations
If personal data may be exposed, the IC escalates to the data-protection owner (**NOT SET**) within hours. Regulatory notification windows (e.g. GDPR 72 h) run from awareness, not root-cause confirmation. This runbook does not decide legal obligations.

## 7. Resolution and post-incident review
Declare resolved only after: health green, error rate normal, a data integrity check done, backup job confirmed running. Within 5 working days publish a blameless review: timeline, impact, root cause, what went well/badly, **action items with owners and dates**. Update the DR plan's RTO/RPO table if measured numbers differed.

## 8. Quick reference
| Need | Where |
|---|---|
| Take a backup now | `ops/backup/backup.sh` |
| Restore | `ops/backup/restore.sh <file> <url>` |
| Drill | `ops/backup/verify-restore.sh <admin-url>` |
| Deploy/migrate | `MIGRATION_RUNBOOK.md`, `UAT_RELEASE_RUNBOOK.md` |
| Health / observability | `HEALTH_CHECKS.md`, `OBSERVABILITY.md` |
| Credential incident | `CREDENTIAL_ROTATION_EXECUTION_PLAN.md` |
