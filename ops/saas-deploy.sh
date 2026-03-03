#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
API_DIR="${APP_DIR}/apps/api"
WEB_DIR="${APP_DIR}/apps/web"
RELEASES_BASE_DIR="/var/backups/myoptiwealth-saas/releases"
RELEASE_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_DIR="${RELEASES_BASE_DIR}/${RELEASE_TIMESTAMP}"

cd "${APP_DIR}"

if [ -d "/root/.nvm/versions/node" ]; then
  NVM_NODE_BIN="$(ls -d /root/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
  if [ -n "${NVM_NODE_BIN:-}" ]; then
    export PATH="${NVM_NODE_BIN}:${PATH}"
  fi
fi

bash "${APP_DIR}/ops/saas-predeploy-guard.sh"

if [ "${SKIP_PULL:-0}" != "1" ]; then
  git pull --ff-only origin main
fi

mkdir -p "${SNAPSHOT_DIR}"
echo "createdAt=${RELEASE_TIMESTAMP}" > "${SNAPSHOT_DIR}/release.info"
echo "gitHead=$(git rev-parse --short HEAD)" >> "${SNAPSHOT_DIR}/release.info"

if [ -d "${API_DIR}/dist" ]; then
  tar -czf "${SNAPSHOT_DIR}/api-dist.tar.gz" -C "${API_DIR}" dist
else
  TMP_API_DIR="$(mktemp -d)"
  mkdir -p "${TMP_API_DIR}/dist"
  tar -czf "${SNAPSHOT_DIR}/api-dist.tar.gz" -C "${TMP_API_DIR}" dist
  rm -rf "${TMP_API_DIR}"
fi
if [ -d "${WEB_DIR}/.next" ]; then
  tar -czf "${SNAPSHOT_DIR}/web-next.tar.gz" -C "${WEB_DIR}" .next
else
  TMP_WEB_DIR="$(mktemp -d)"
  mkdir -p "${TMP_WEB_DIR}/.next"
  tar -czf "${SNAPSHOT_DIR}/web-next.tar.gz" -C "${TMP_WEB_DIR}" .next
  rm -rf "${TMP_WEB_DIR}"
fi

echo "[deploy] Install + build API"
cd "${API_DIR}"
npm ci
npm run prisma:generate
npm run prisma:deploy
rm -rf dist tsconfig.tsbuildinfo
npm run build

echo "[deploy] Install + build Web"
cd "${WEB_DIR}"
npm ci
rm -rf .next
npm run build

cd "${APP_DIR}"
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

  echo "[error] ${label} not ready: ${url}" >&2
  return 1
}

wait_for_http "http://127.0.0.1:7000/api/health/ready" "API health"
wait_for_http "http://127.0.0.1:3002/" "Web home"

bash "${APP_DIR}/ops/saas-healthcheck.sh"
API_BASE_URL="http://127.0.0.1:7000/api" WEB_BASE_URL="http://127.0.0.1:3002" bash "${APP_DIR}/ops/saas-smoke.sh"

tar -czf "${SNAPSHOT_DIR}/api-dist.tar.gz" -C "${API_DIR}" dist
tar -czf "${SNAPSHOT_DIR}/web-next.tar.gz" -C "${WEB_DIR}" .next
echo "status=success" >> "${SNAPSHOT_DIR}/release.info"

echo "Deploy SaaS OK from ${APP_DIR}"
echo "Rollback snapshot: ${SNAPSHOT_DIR}"
pm2 ls
