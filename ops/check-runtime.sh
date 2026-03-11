#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
cd "$APP_DIR"

echo "== MyOptiWealth runtime check =="
echo "Expected source directory: $APP_DIR"
echo

echo "== PM2 process (myoptiwealth-saas-web) =="
if PM2_WEB_DESC="$(pm2 describe myoptiwealth-saas-web 2>&1)"; then
  printf '%s\n' "$PM2_WEB_DESC" | sed -n '1,80p'
  echo
  echo "== PM2 web cwd (extracted) =="
  printf '%s\n' "$PM2_WEB_DESC" | rg "exec cwd" || true
  echo
else
  echo "PM2 process myoptiwealth-saas-web introuvable."
  echo
fi

echo "== PM2 process (myoptiwealth-saas-api) =="
if PM2_API_DESC="$(pm2 describe myoptiwealth-saas-api 2>&1)"; then
  printf '%s\n' "$PM2_API_DESC" | sed -n '1,80p'
  echo
  echo "== PM2 api cwd (extracted) =="
  printf '%s\n' "$PM2_API_DESC" | rg "exec cwd" || true
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
echo "Deploy web quickly: /var/www/myoptiwealth/ops/release.sh quick"
echo "Deploy full (sans pull): /var/www/myoptiwealth/ops/release.sh full"
echo "Deploy full (avec pull): /var/www/myoptiwealth/ops/release.sh full --pull"
