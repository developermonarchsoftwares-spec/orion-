#!/usr/bin/env bash
# Restore a backup file into a TARGET database. Refuses to touch a non-empty database unless --force.
# Usage: restore.sh <backup-file> <target-database-url> [--force]
set -Eeuo pipefail
umask 077
FILE="${1:?backup file}"; TARGET="${2:?target database url}"; FORCE="${3:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/backup.env" ] && set -a && . "$HERE/backup.env" && set +a

[ -f "$FILE.sha256" ] && ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" )

WORK="$FILE"
if [[ "$FILE" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE to decrypt}"
  WORK="$(mktemp)"; trap 'rm -f "$WORK"' EXIT
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt --output "$WORK" "$FILE"
fi

TABLES="$(psql "$TARGET" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$TABLES" != "0" ] && [ "$FORCE" != "--force" ]; then
  echo "Target has $TABLES public tables. Re-run with --force to overwrite (objects are dropped first)." >&2; exit 2
fi
CLEAN=(); [ "$FORCE" = "--force" ] && CLEAN=(--clean --if-exists)
pg_restore --no-owner --no-privileges --exit-on-error "${CLEAN[@]}" --dbname="$TARGET" "$WORK"
echo "[restore] done. The restored database still holds everything that was deleted or suppressed AFTER this backup was taken."
echo "[restore] DO NOT start the API, queue workers or search re-index yet. Next: re-apply the deletion ledger (docs/BACKUP_AND_DISASTER_RECOVERY.md section 5, step 6):"
echo "[restore]   npm run db:ledger --prefix apps/api -- reapply --in <ledger file>   (dry run), then add --apply"
echo "[restore] Then run verify-restore.sh against the target before cutting traffic."
