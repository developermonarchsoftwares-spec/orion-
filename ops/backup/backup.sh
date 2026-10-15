#!/usr/bin/env bash
# Logical PostgreSQL backup: dump -> checksum -> (encrypt) -> (upload) -> prune -> verify.
set -Eeuo pipefail
umask 077   # backups and temporary files are readable by the running account only
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/backup.env" ] && set -a && . "$HERE/backup.env" && set +a
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-$HERE/backups}"
MANIFEST="${BACKUP_DIR:-$HERE/backups}/backup-manifest.log"   # one line per event: time, event, file name, size, checksum. No data, no keys.
RETAIN_DAILY="${RETAIN_DAILY:-7}"; RETAIN_WEEKLY="${RETAIN_WEEKLY:-4}"; RETAIN_MONTHLY="${RETAIN_MONTHLY:-12}"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly,ledger}
log() { printf '%s	%s
' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$BACKUP_DIR/backup-manifest.log"; }

ping() { [ -n "${1:-}" ] && curl -fsS -m 10 -o /dev/null "$1" || true; }
trap 'echo "backup FAILED" >&2; log "FAILED line=$LINENO"; ping "${BACKUP_PING_FAIL_URL:-}"' ERR

TS="$(date -u +%Y%m%dT%H%M%SZ)"

# --- deletion ledger as a function, so it can also run alone (LEDGER_ONLY=true; see below) ---
export_ledger() {
  # Deletion ledger: digests and opaque ids of everything deleted or suppressed so far, kept OUTSIDE the dump so a restore can re-apply it
  # (docs/BACKUP_AND_DISASTER_RECOVERY.md section 5). Requires Node and the repository; skipped (with a warning in the manifest) when unavailable.
  if [ "${BACKUP_SKIP_LEDGER:-false}" != "true" ]; then
    LEDGER="$BACKUP_DIR/ledger/orion_ledger_${TS}.json"
    if ( cd "$HERE/../../apps/api" && DATABASE_URL="$BACKUP_DATABASE_URL" npm run --silent db:ledger -- export --out "$LEDGER" >/dev/null ); then
      if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
        gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --symmetric --cipher-algo AES256 --output "$LEDGER.gpg" "$LEDGER"
        rm -f "$LEDGER"; LEDGER="$LEDGER.gpg"
      fi
      ( cd "$(dirname "$LEDGER")" && sha256sum "$(basename "$LEDGER")" > "$(basename "$LEDGER").sha256" )
      log "LEDGER $(basename "$LEDGER")"
    else
      echo "[backup] WARNING: deletion ledger NOT written; a restore of this backup cannot re-apply later deletions automatically" >&2
      log "WARNING ledger-missing"
    fi
  fi
}

# LEDGER_ONLY=true writes only the deletion ledger (digests and ids, no dump). Run it far more often than the dump (for example every 15 minutes from cron):
# the ledger is what a restore uses to redo deletions made after the backup, so how often it is written is how much privacy-relevant change can be
# undone by a restore (Phase 30).
if [ "${LEDGER_ONLY:-false}" = "true" ]; then export_ledger; echo "[backup] ledger only: done"; exit 0; fi
OUT="$BACKUP_DIR/daily/orion_${TS}.dump"

echo "[backup] dumping -> $OUT"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL" --file="$OUT"
pg_restore --list "$OUT" >/dev/null            # structural sanity check

if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "[backup] WARNING: BACKUP_PASSPHRASE_FILE is empty, this backup is NOT encrypted (not acceptable for production)" >&2
  log "WARNING unencrypted"
fi
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "[backup] encrypting"
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
      --symmetric --cipher-algo AES256 --output "$OUT.gpg" "$OUT"
  rm -f "$OUT"; OUT="$OUT.gpg"
fi
( cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
( cd "$(dirname "$OUT")" && sha256sum -c "$(basename "$OUT").sha256" >/dev/null )   # the checksum just written matches the file on disk
log "CREATED $(basename "$OUT") bytes=$(wc -c < "$OUT") sha256=$(cut -d' ' -f1 "$OUT.sha256") encrypted=$([ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && echo yes || echo no)"

export_ledger

# Promote copies: Sunday -> weekly, 1st of month -> monthly
[ "$(date -u +%u)" = 7 ] && cp "$OUT" "$OUT.sha256" "$BACKUP_DIR/weekly/"
[ "$(date -u +%d)" = 01 ] && cp "$OUT" "$OUT.sha256" "$BACKUP_DIR/monthly/"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  EP=(); [ -n "${BACKUP_S3_ENDPOINT:-}" ] && EP=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  echo "[backup] uploading to s3://$BACKUP_S3_BUCKET"
  aws "${EP[@]}" s3 cp "$OUT" "s3://$BACKUP_S3_BUCKET/postgres/daily/" --only-show-errors
  aws "${EP[@]}" s3 cp "$OUT.sha256" "s3://$BACKUP_S3_BUCKET/postgres/daily/" --only-show-errors
  if [ -n "${LEDGER:-}" ] && [ -f "$LEDGER" ]; then   # the ledger is stored beside, never inside, the dump
    aws "${EP[@]}" s3 cp "$LEDGER" "s3://$BACKUP_S3_BUCKET/postgres/ledger/" --only-show-errors
    aws "${EP[@]}" s3 cp "$LEDGER.sha256" "s3://$BACKUP_S3_BUCKET/postgres/ledger/" --only-show-errors
  fi
  log "UPLOADED $(basename "$OUT")"
fi

prune() { # dir keep pattern: removes the oldest files beyond `keep`, records each removal, and confirms the file is gone
  { ls -1t "$1"/$3 2>/dev/null || true; } | { grep -v '\.sha256$' || true; } | tail -n +"$(($2 + 1))" | while read -r f; do   # an empty folder is not an error
    rm -f "$f" "$f.sha256"
    if [ -e "$f" ]; then log "PRUNE-FAILED $(basename "$f")"; else log "EXPIRED $(basename "$f")"; fi
  done
}
prune "$BACKUP_DIR/daily" "$RETAIN_DAILY" 'orion_*.dump*'
prune "$BACKUP_DIR/weekly" "$RETAIN_WEEKLY" 'orion_*.dump*'
prune "$BACKUP_DIR/monthly" "$RETAIN_MONTHLY" 'orion_*.dump*'
prune "$BACKUP_DIR/ledger" "${RETAIN_LEDGER:-30}" 'orion_ledger_*'
# Remote retention should be enforced with a bucket lifecycle rule (see docs/BACKUP_AND_DISASTER_RECOVERY.md §3).

log "OK $(basename "$OUT")"
echo "[backup] OK $(basename "$OUT") $(du -h "$OUT" | cut -f1)"
ping "${BACKUP_PING_OK_URL:-}"
