#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
cd "$APP_DIR"

echo "== MyOptiWealth runtime check =="
echo "Expected source directory: $APP_DIR"
echo

echo "== PM2 process (myoptiwealth-frontend) =="
if PM2_DESC="$(pm2 describe myoptiwealth-frontend 2>&1)"; then
  printf '%s\n' "$PM2_DESC" | sed -n '1,80p'
  echo
  echo "== PM2 cwd (extracted) =="
  printf '%s\n' "$PM2_DESC" | rg "exec cwd" || true
  echo
else
  echo "PM2 inaccessible from current shell/context."
  echo "Run as the same user that owns PM2 (usually root on this server)."
  echo
fi

echo "== Current git commit =="
git rev-parse --short HEAD
git log -1 --pretty=format:'%h %ad %s' --date=iso
echo
echo

echo "== Reminder =="
echo "Deploy local changes without pull: /var/www/myoptiwealth/ops/deploy-local.sh"
