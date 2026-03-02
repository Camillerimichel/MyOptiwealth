#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
cd "$APP_DIR"

echo "[deploy-local] Source unique: $APP_DIR"
echo "[deploy-local] Mode local: SKIP_PULL=1 (aucun git pull)"

export SKIP_PULL=1
exec "$APP_DIR/ops/deploy.sh" "$@"
