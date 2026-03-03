#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/myoptiwealth"
TARGET_EMAIL="${1:-admin@captiva.local}"

cd "${APP_DIR}"

if [ ! -f ".env" ]; then
  echo "[error] Fichier .env introuvable dans ${APP_DIR}" >&2
  exit 1
fi

set -a
source .env
set +a

for key in DB_HOST DB_PORT DB_NAME DB_USER DB_PASS; do
  if [ -z "${!key:-}" ]; then
    echo "[error] Variable ${key} manquante dans .env" >&2
    exit 1
  fi
done

if [ -z "${NEW_PASSWORD:-}" ]; then
  read -rsp "Nouveau mot de passe pour ${TARGET_EMAIL}: " NEW_PASSWORD
  echo
fi

if [ -z "${NEW_PASSWORD}" ]; then
  echo "[error] Mot de passe vide" >&2
  exit 1
fi

export NEW_PASSWORD TARGET_EMAIL

node <<'NODE'
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  const hash = await bcrypt.hash(process.env.NEW_PASSWORD, 10);
  const [res] = await conn.execute(
    'UPDATE users SET password_hash = ? WHERE email = ?',
    [hash, process.env.TARGET_EMAIL],
  );

  console.log('users_updated=', res.affectedRows);
  if (res.affectedRows === 0) {
    console.error(`[warn] Aucun utilisateur trouve pour ${process.env.TARGET_EMAIL}`);
    process.exitCode = 2;
  }

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
