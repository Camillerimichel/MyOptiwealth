#!/usr/bin/env bash
set -euo pipefail

API_DIR="/var/www/myoptiwealth/apps/api"

if [ ! -d "$API_DIR" ]; then
  echo "[error] Dossier API introuvable: $API_DIR" >&2
  exit 1
fi

cd "$API_DIR"

read -rp "Adresse email: " TARGET_EMAIL
if [ -z "$TARGET_EMAIL" ]; then
  echo "[error] Email vide" >&2
  exit 1
fi

export TARGET_EMAIL

EXISTS=$(node <<'NODE'
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({
    where: { email: process.env.TARGET_EMAIL },
    select: { id: true, email: true },
  });
  await prisma.$disconnect();
  process.stdout.write(user ? '1' : '0');
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
NODE
)

if [ "$EXISTS" != "1" ]; then
  echo "[error] Aucun utilisateur trouvé pour: $TARGET_EMAIL" >&2
  exit 2
fi

read -rsp "Nouveau mot de passe: " NEW_PASSWORD; echo
read -rsp "Confirmer mot de passe: " NEW_PASSWORD_CONFIRM; echo

if [ -z "$NEW_PASSWORD" ]; then
  echo "[error] Mot de passe vide" >&2
  exit 1
fi

if [ "$NEW_PASSWORD" != "$NEW_PASSWORD_CONFIRM" ]; then
  echo "[error] Les mots de passe ne correspondent pas" >&2
  exit 1
fi

export NEW_PASSWORD

node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

(async () => {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash(process.env.NEW_PASSWORD, 12);

  const result = await prisma.user.updateMany({
    where: { email: process.env.TARGET_EMAIL },
    data: {
      passwordHash: hash,
      refreshTokenHash: null,
    },
  });

  console.log('users_updated=', result.count);
  if (result.count !== 1) {
    console.error('[warn] Mise à jour inattendue (count != 1)');
    process.exitCode = 3;
  } else {
    console.log('[ok] Mot de passe mis à jour. Reconnexion requise.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
NODE
