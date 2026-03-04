#!/usr/bin/env bash
set -euo pipefail

API_DIR="/var/www/myoptiwealth/apps/api"
APPLY="false"
YES="false"

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY="true" ;;
    --yes) YES="true" ;;
    *)
      echo "Usage: $0 [--apply] [--yes]" >&2
      exit 1
      ;;
  esac
done

cd "$API_DIR"
export APPLY YES

node <<'NODE'
const { PrismaClient } = require('@prisma/client');

const adminPattern = /^admin\.\d+@myoptiwealth\.local$/;
const viewerPattern = /^viewer\.\d+@myoptiwealth\.local$/;

(async () => {
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
  });

  const targets = users.filter((u) => adminPattern.test(u.email) || viewerPattern.test(u.email));

  if (!targets.length) {
    console.log('[ok] Aucun compte de test a supprimer.');
    await prisma.$disconnect();
    return;
  }

  console.log('Comptes cibles:');
  targets.forEach((u, i) => console.log(`${i + 1}. ${u.email}`));

  if (process.env.APPLY !== 'true') {
    console.log('\nDry-run termine. Relance avec --apply pour supprimer.');
    await prisma.$disconnect();
    return;
  }

  if (process.env.YES !== 'true') {
    process.stdout.write('\nConfirmer la suppression (yes/no): ');
    const stdin = await new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data.trim()));
    });
    if (String(stdin).toLowerCase() !== 'yes') {
      console.log('Annule.');
      await prisma.$disconnect();
      return;
    }
  }

  const ids = targets.map((u) => u.id);
  const deleted = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n[ok] users_deleted= ${deleted.count}`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
