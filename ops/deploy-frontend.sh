#!/usr/bin/env bash
set -euo pipefail

echo "[legacy] ops/deploy-frontend.sh redirige vers le déploiement Web SaaS."
exec /var/www/myoptiwealth/ops/saas-deploy-web-local.sh "$@"
