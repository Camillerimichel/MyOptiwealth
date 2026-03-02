#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 /var/backups/myoptiwealth/db_*.sql.gz" >&2
  exit 1
fi

BACKUP_FILE="$1"
APP_DIR="/var/www/myoptiwealth"
ENV_FILE="${APP_DIR}/.env"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore][error] Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[restore][error] Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "[restore][error] Set CONFIRM_RESTORE=YES to execute restore" >&2
  exit 1
fi

gzip -dc "$BACKUP_FILE" | mysql \
  --host="${DB_HOST:-127.0.0.1}" \
  --port="${DB_PORT:-3306}" \
  --user="${DB_USER}" \
  --password="${DB_PASS}" \
  "${DB_NAME}"

echo "[restore][ok] Restored $BACKUP_FILE into ${DB_NAME}"
