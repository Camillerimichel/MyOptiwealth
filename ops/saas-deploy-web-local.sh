#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
WEB_DIR="${APP_DIR}/apps/web"

cd "${APP_DIR}"

if [ -d "/root/.nvm/versions/node" ]; then
  NVM_NODE_BIN="$(ls -d /root/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
  if [ -n "${NVM_NODE_BIN:-}" ]; then
    export PATH="${NVM_NODE_BIN}:${PATH}"
  fi
fi

echo "[deploy-web-local] Source: ${WEB_DIR}"
echo "[deploy-web-local] Fast path: build web + restart pm2 myoptiwealth-saas-web"

cd "${WEB_DIR}"
if [ "${CLEAN_NEXT:-0}" = "1" ]; then
  rm -rf .next
fi

BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-420}"
timeout "${BUILD_TIMEOUT_SECONDS}" npm run build

cd "${APP_DIR}"
pm2 restart myoptiwealth-saas-web
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

wait_for_http "http://127.0.0.1:3002/login" "Web login"
echo "Deploy Web SaaS OK"
