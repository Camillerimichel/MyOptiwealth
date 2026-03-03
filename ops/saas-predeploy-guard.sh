#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
API_DIR="${APP_DIR}/apps/api"
WEB_DIR="${APP_DIR}/apps/web"
ECOSYSTEM_FILE="${APP_DIR}/ops/ecosystem.saas.config.cjs"

if [ "${PWD}" != "${APP_DIR}" ]; then
  echo "[guard][error] mauvais repertoire courant: ${PWD} (attendu: ${APP_DIR})" >&2
  exit 1
fi

for path in "${API_DIR}" "${WEB_DIR}" "${ECOSYSTEM_FILE}"; do
  if [ ! -e "${path}" ]; then
    echo "[guard][error] chemin manquant: ${path}" >&2
    exit 1
  fi
done

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[guard][error] pm2 introuvable dans PATH" >&2
  exit 1
fi

echo "[guard][ok] predeploy SaaS conforme (${APP_DIR})"
