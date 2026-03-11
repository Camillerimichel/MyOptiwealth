#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
MODE="${1:-quick}"
PULL_MODE="0"

if [[ "${2:-}" == "--pull" ]] || [[ "${3:-}" == "--pull" ]]; then
  PULL_MODE="1"
fi

usage() {
  cat <<'TXT'
Usage:
  bash ops/release.sh [quick|web|full] [--pull]

Modes:
  quick  Build + restart web only (default, fastest)
  web    Same as quick (alias explicite)
  full   Deploy API + Web

Options:
  --pull  Autorise git pull --ff-only origin main (full uniquement)

Examples:
  bash ops/release.sh
  bash ops/release.sh web
  bash ops/release.sh full
  bash ops/release.sh full --pull
TXT
}

if [[ "${MODE}" == "-h" ]] || [[ "${MODE}" == "--help" ]]; then
  usage
  exit 0
fi

cd "${APP_DIR}"

case "${MODE}" in
  quick|web)
    echo "[release] mode=${MODE} -> web build + pm2 restart"
    exec "${APP_DIR}/ops/saas-deploy-web-local.sh"
    ;;
  full)
    if [[ "${PULL_MODE}" == "1" ]]; then
      echo "[release] mode=full pull=on -> full deploy with git pull"
      exec "${APP_DIR}/ops/saas-deploy.sh"
    fi
    echo "[release] mode=full pull=off -> full deploy without git pull"
    export SKIP_PULL=1
    exec "${APP_DIR}/ops/saas-deploy.sh"
    ;;
  *)
    echo "[release][error] unknown mode: ${MODE}" >&2
    usage >&2
    exit 1
    ;;
esac
