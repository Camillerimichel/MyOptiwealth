# MyOptiWealth

Plateforme de pilotage risques/assurance (SaaS: `apps/web` + `apps/api`).

## Environnement production (VPS)
- Domaine: https://myoptiwealth.fr
- Frontend: PM2 `myoptiwealth-saas-web` (port 3002)
- API: PM2 `myoptiwealth-saas-api` (port 7000)
- Racine projet: `/var/www/myoptiwealth`

## Déploiement
- Commande unique (recommandée):
```bash
bash /var/www/myoptiwealth/ops/release.sh
```
- Full (sans pull):
```bash
bash /var/www/myoptiwealth/ops/release.sh full
```
- Full (avec pull):
```bash
bash /var/www/myoptiwealth/ops/release.sh full --pull
```
- Web uniquement (changement UI, alias du mode par défaut):
```bash
bash /var/www/myoptiwealth/ops/release.sh quick
```
- CI/CD GitHub Actions (push sur `main`): `.github/workflows/deploy.yml`

## Sauvegarde base
- Script backup: `/var/www/myoptiwealth/ops/backup-db.sh`
- Script restore: `/var/www/myoptiwealth/ops/restore-db.sh`
- Cron: `/etc/cron.d/myoptiwealth-db-backup` (03:15 UTC)
