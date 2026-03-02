#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
ENV_FILE="${APP_DIR}/.env"
BACKUP_DIR="/var/backups/myoptiwealth"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[backup][error] Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/db_${DB_NAME}_${STAMP}.sql.gz"

mysqldump \
  --host="${DB_HOST:-127.0.0.1}" \
  --port="${DB_PORT:-3306}" \
  --user="${DB_USER}" \
  --password="${DB_PASS}" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  "${DB_NAME}" | gzip -9 > "$OUT_FILE"

find "$BACKUP_DIR" -type f -name 'db_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup][ok] $OUT_FILE"
