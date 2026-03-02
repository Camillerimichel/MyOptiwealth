# MyOptiWealth

Plateforme de pilotage risques/assurance (frontend Next.js + API Node/Express + MySQL).

## Environnement production (VPS)
- Domaine: https://myoptiwealth.fr
- Frontend: PM2 `myoptiwealth-frontend` (port 3401)
- API: PM2 `myoptiwealth-api` (port 3400)
- Racine projet: `/var/www/myoptiwealth`

## Démarrage local/serveur
```bash
cd /var/www/myoptiwealth
npm install
npm run build
pm2 start /var/www/myoptiwealth/ecosystem.config.cjs
```

## Déploiement
- Manuel local (sans pull):
```bash
bash /var/www/myoptiwealth/ops/deploy-local.sh
```
- CI/CD GitHub Actions (push sur `main`): `.github/workflows/deploy.yml`

## Sauvegarde base
- Script backup: `/var/www/myoptiwealth/ops/backup-db.sh`
- Script restore: `/var/www/myoptiwealth/ops/restore-db.sh`
- Cron: `/etc/cron.d/myoptiwealth-db-backup` (03:15 UTC)
