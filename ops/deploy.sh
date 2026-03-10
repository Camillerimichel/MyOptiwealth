#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
echo "[legacy] ops/deploy.sh redirige vers la stack SaaS (apps/api + apps/web)."
exec "${APP_DIR}/ops/saas-deploy.sh" "$@"
