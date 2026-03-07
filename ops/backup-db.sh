#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
ENV_FILE="${APP_DIR}/apps/api/.env"
LEGACY_ENV_FILE="${APP_DIR}/.env"
BACKUP_DIR="/var/backups/myoptiwealth-saas/db"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$LEGACY_ENV_FILE" ]; then
    ENV_FILE="$LEGACY_ENV_FILE"
  else
    echo "[backup][error] Missing ${APP_DIR}/apps/api/.env and ${APP_DIR}/.env" >&2
    exit 1
  fi
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup][error] DATABASE_URL is not defined in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#^.*/([^/?]+)(\\?.*)?$#\\1#')"
if [ -z "$DB_NAME" ]; then
  DB_NAME="myoptiwealth_saas"
fi
OUT_FILE="${BACKUP_DIR}/db_${DB_NAME}_${STAMP}.sql.gz"

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-privileges | gzip -9 > "$OUT_FILE"

find "$BACKUP_DIR" -type f -name 'db_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup][ok] $OUT_FILE"
