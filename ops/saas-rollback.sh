#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
API_DIR="${APP_DIR}/apps/api"
WEB_DIR="${APP_DIR}/apps/web"
RELEASES_BASE_DIR="/var/backups/myoptiwealth-saas/releases"

cd "${APP_DIR}"

if [ -d "/root/.nvm/versions/node" ]; then
  NVM_NODE_BIN="$(ls -d /root/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
  if [ -n "${NVM_NODE_BIN:-}" ]; then
    export PATH="${NVM_NODE_BIN}:${PATH}"
  fi
fi

bash "${APP_DIR}/ops/saas-predeploy-guard.sh"

if [ ! -d "${RELEASES_BASE_DIR}" ]; then
  echo "[rollback][error] releases dir missing: ${RELEASES_BASE_DIR}" >&2
  exit 1
fi

TARGET="${1:-latest}"
if [ "${TARGET}" = "latest" ]; then
  SNAPSHOT_DIR="$(ls -1dt "${RELEASES_BASE_DIR}"/* 2>/dev/null | head -n1 || true)"
else
  SNAPSHOT_DIR="${RELEASES_BASE_DIR}/${TARGET}"
fi

if [ -z "${SNAPSHOT_DIR}" ] || [ ! -d "${SNAPSHOT_DIR}" ]; then
  echo "[rollback][error] snapshot not found: ${TARGET}" >&2
  echo "[rollback][hint] available snapshots:" >&2
  ls -1 "${RELEASES_BASE_DIR}" 2>/dev/null || true
  exit 1
fi

API_TARBALL="${SNAPSHOT_DIR}/api-dist.tar.gz"
WEB_TARBALL="${SNAPSHOT_DIR}/web-next.tar.gz"

if [ ! -f "${API_TARBALL}" ] || [ ! -f "${WEB_TARBALL}" ]; then
  echo "[rollback][error] invalid snapshot (missing tarballs): ${SNAPSHOT_DIR}" >&2
  exit 1
fi

echo "[rollback] restoring snapshot: ${SNAPSHOT_DIR}"
rm -rf "${API_DIR}/dist" "${WEB_DIR}/.next"
mkdir -p "${API_DIR}/dist" "${WEB_DIR}/.next"

tar -xzf "${API_TARBALL}" -C "${API_DIR}"
tar -xzf "${WEB_TARBALL}" -C "${WEB_DIR}"

pm2 delete myoptiwealth-saas-api myoptiwealth-saas-web >/dev/null 2>&1 || true
pm2 startOrReload ops/ecosystem.saas.config.cjs
pm2 save

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-20}"
  local sleep_seconds="${4:-1}"
  local i

  for ((i=1; i<=attempts; i++)); do
    if curl --max-time 5 -fsS "$url" >/dev/null; then
      echo "[ok] ${label}"
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  echo "[rollback][error] ${label} not ready: ${url}" >&2
  return 1
}

wait_for_http "http://127.0.0.1:7000/api/health/ready" "API health"
wait_for_http "http://127.0.0.1:3002/" "Web home"

API_BASE_URL="http://127.0.0.1:7000/api" WEB_BASE_URL="http://127.0.0.1:3002" bash "${APP_DIR}/ops/saas-smoke.sh"

echo "[rollback] rollback complete"
pm2 ls
