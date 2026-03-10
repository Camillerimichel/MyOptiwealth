# MyOptiWealth

Plateforme de pilotage risques/assurance (SaaS: `apps/web` + `apps/api`).

## Environnement production (VPS)
- Domaine: https://myoptiwealth.fr
- Frontend: PM2 `myoptiwealth-saas-web` (port 3002)
- API: PM2 `myoptiwealth-saas-api` (port 7000)
- Racine projet: `/var/www/myoptiwealth`

## Déploiement
- Standard (avec pull):
```bash
bash /var/www/myoptiwealth/ops/saas-deploy.sh
```
- Local (sans pull):
```bash
bash /var/www/myoptiwealth/ops/saas-deploy-local.sh
```
- Web uniquement (changement UI):
```bash
bash /var/www/myoptiwealth/ops/saas-deploy-web-local.sh
```
- CI/CD GitHub Actions (push sur `main`): `.github/workflows/deploy.yml`

## Compatibilité scripts legacy
- `ops/deploy.sh`, `ops/deploy-local.sh` et `ops/deploy-frontend.sh` redirigent désormais vers les scripts SaaS.

## Sauvegarde base
- Script backup: `/var/www/myoptiwealth/ops/backup-db.sh`
- Script restore: `/var/www/myoptiwealth/ops/restore-db.sh`
- Cron: `/etc/cron.d/myoptiwealth-db-backup` (03:15 UTC)
