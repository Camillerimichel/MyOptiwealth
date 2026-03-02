#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
cd "$APP_DIR"

bash "$APP_DIR/ops/predeploy-guard.sh"

if [ "${SKIP_PULL:-0}" != "1" ]; then
  git pull --ff-only
fi

BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-600}"
if [ "${CLEAN_NEXT:-1}" = "1" ]; then
  rm -rf .next
fi
timeout "$BUILD_TIMEOUT_SECONDS" npm run build
# Next.js can keep stale runtime manifests after reload; prefer hard restart for frontend.
pm2 startOrReload ecosystem.config.cjs --only myoptiwealth-api
pm2 restart myoptiwealth-frontend
pm2 save

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-15}"
  local sleep_seconds="${4:-1}"
  local i

  for ((i=1; i<=attempts; i++)); do
    if curl --max-time 5 -fsS "$url" >/dev/null; then
      echo "[ok] $label"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "[error] $label not ready: $url" >&2
  return 1
}

wait_for_http "http://127.0.0.1:3400/health" "API health"
wait_for_http "http://127.0.0.1:3401/" "Frontend page"

echo "Deploy OK from $APP_DIR"
pm2 ls
