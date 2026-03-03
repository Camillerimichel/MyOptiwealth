#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env in apps/api. Copy .env.example first." >&2
  exit 1
fi

echo "[db] prisma generate"
npm run prisma:generate

echo "[db] prisma migrate dev"
npm run prisma:migrate -- --name init_saas

echo "[db] prisma seed"
npm run prisma:seed

echo "[db] bootstrap complete"
