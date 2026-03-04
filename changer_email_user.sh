#!/usr/bin/env bash
set -euo pipefail

API_DIR="/var/www/myoptiwealth/apps/api"

if [ ! -d "$API_DIR" ]; then
  echo "[error] Dossier API introuvable: $API_DIR" >&2
  exit 1
fi

FROM_EMAIL="${1:-}"
TO_EMAIL="${2:-}"

if [ -z "$FROM_EMAIL" ] || [ -z "$TO_EMAIL" ]; then
  echo "Usage: $0 <ancien_email> <nouvel_email>" >&2
  echo "Exemple: $0 admin@captiva.local admin@optiwealth.fr" >&2
  exit 1
fi

cd "$API_DIR"
export FROM_EMAIL TO_EMAIL

node <<'NODE'
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  const from = process.env.FROM_EMAIL;
  const to = process.env.TO_EMAIL;

  const target = await prisma.user.findUnique({
    where: { email: to },
    select: { id: true, email: true },
  });

  if (target) {
    console.error(`[error] Le nouvel email existe deja: ${to}`);
    process.exit(2);
  }

  const result = await prisma.user.updateMany({
    where: { email: from },
    data: {
      email: to,
      refreshTokenHash: null,
    },
  });

  console.log('users_updated=', result.count);

  if (result.count === 0) {
    console.error(`[warn] Aucun utilisateur trouve pour ${from}`);
    process.exitCode = 3;
  }

  const updated = await prisma.user.findUnique({
    where: { email: to },
    select: { id: true, email: true },
  });
  console.log('updated_user=', updated);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
NODE
