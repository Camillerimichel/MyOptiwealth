#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
echo "[legacy] ops/deploy-local.sh redirige vers la stack SaaS (sans git pull)."
exec "${APP_DIR}/ops/saas-deploy-local.sh" "$@"
