#!/usr/bin/env bash
# Restore drill: restores the newest backup into a scratch database and checks it. Measures actual RTO.
# Usage: verify-restore.sh <scratch-admin-url> [backup-file]   (scratch server must allow CREATE DATABASE)
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/backup.env" ] && set -a && . "$HERE/backup.env" && set +a
ADMIN="${1:?scratch server admin url (db=postgres)}"
FILE="${2:-$(ls -1t "${BACKUP_DIR:-$HERE/backups}"/daily/orion_*.dump* | grep -v '\.sha256$' | head -1)}"
DB="restore_drill_$(date -u +%s)"
START=$(date +%s)
psql "$ADMIN" -qc "create database $DB"
URL="$(echo "$ADMIN" | sed -E "s#(://[^/]+)/[^?]*#\1/$DB#")"
trap 'psql "$ADMIN" -qc "drop database if exists $DB" || true' EXIT
"$HERE/restore.sh" "$FILE" "$URL"
echo "[verify] tables: $(psql "$URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
for t in users credit_packages; do
  psql "$URL" -Atc "select '$t', count(*) from $t" 2>/dev/null || { echo "[verify] FAIL core table $t missing"; exit 1; }
done
echo "[verify] NOTE this drill does not apply the deletion ledger; a real recovery must (docs/BACKUP_AND_DISASTER_RECOVERY.md section 5 step 6)"
echo "[verify] migrations applied: $(psql "$URL" -Atc 'select count(*) from drizzle.__drizzle_migrations')"
echo "[verify] PASS  file=$(basename "$FILE")  measured_restore_seconds=$(( $(date +%s) - START ))"
