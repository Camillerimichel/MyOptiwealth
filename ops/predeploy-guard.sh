#!/usr/bin/env bash
set -euo pipefail

EXPECTED_DIR="/var/www/CAPTIVA"
FORBIDDEN_PATH="/root/apps/frontend"
SERVICE_FILE="/etc/systemd/system/captiva-frontend-deploy.service"

if [ "${PWD}" != "${EXPECTED_DIR}" ]; then
  echo "[guard][error] mauvais repertoire courant: ${PWD} (attendu: ${EXPECTED_DIR})" >&2
  exit 1
fi

for path in "${EXPECTED_DIR}/ops" "${EXPECTED_DIR}/ecosystem.config.cjs"; do
  if [ -e "${path}" ] && rg -n --fixed-strings "${FORBIDDEN_PATH}" "${path}" --glob '!predeploy-guard.sh' >/dev/null 2>&1; then
    echo "[guard][error] reference interdite detectee dans ${path}: ${FORBIDDEN_PATH}" >&2
    exit 1
  fi
done

if [ -f "${SERVICE_FILE}" ] && rg -n --fixed-strings "${FORBIDDEN_PATH}" "${SERVICE_FILE}" >/dev/null 2>&1; then
  echo "[guard][error] reference interdite detectee dans ${SERVICE_FILE}: ${FORBIDDEN_PATH}" >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[guard][error] pm2 introuvable dans PATH" >&2
  exit 1
fi

PM2_DESC="$(pm2 describe captiva-frontend 2>&1 || true)"
if [ -z "${PM2_DESC}" ] || printf '%s\n' "${PM2_DESC}" | rg -q "Process or Namespace captiva-frontend not found"; then
  echo "[guard][error] process PM2 captiva-frontend introuvable" >&2
  exit 1
fi

if ! printf '%s\n' "${PM2_DESC}" | rg -q "exec cwd\s+│\s+${EXPECTED_DIR}"; then
  echo "[guard][error] exec cwd PM2 invalide pour captiva-frontend (attendu: ${EXPECTED_DIR})" >&2
  exit 1
fi

echo "[guard][ok] predeploy conforme (${EXPECTED_DIR})"
