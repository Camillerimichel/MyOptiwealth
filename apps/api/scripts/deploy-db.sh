#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env in apps/api. Copy .env.example first." >&2
  exit 1
fi

echo "[db] prisma generate"
npm run prisma:generate

echo "[db] prisma migrate deploy"
npm run prisma:deploy

echo "[db] prisma seed"
npm run prisma:seed

echo "[db] deploy complete"
