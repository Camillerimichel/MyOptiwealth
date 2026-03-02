# Tâches Automatiques (Cron / Jobs)

Recensement des tâches automatiques observées sur le serveur et dans l'application CAPTIVA.

Date de mise à jour: 2026-02-25

## Cron système (root)

Source: `crontab -l`

### Sauvegarde base de données
- Horaire: `15 2 * * *` (tous les jours à `02:15`)
- Commande: `/root/backups/db-backup.sh >> /root/backups/db-backup.log 2>&1`
- Objet: sauvegarde quotidienne de la base

### Healthcheck serveur
- Horaire: `0 7 * * *` (tous les jours à `07:00`)
- Commande: `/root/backups/healthcheck.sh`
- Objet: contrôle de santé de l'environnement

### Rappel certificat (ponctuel)
- Horaire: `0 10 14 4 *` (14 avril à `10:00`)
- Commande: `logger 'Rappel: vérifier/renouveler certifs captiva-risks.com avant échéance du 24 avril 2026'`
- Objet: rappel opérationnel

### Refresh agrégat paiements primes (nouveau)
- Horaire: `30 3 * * *` (toutes les nuits à `03:30`)
- Commande: `/var/www/CAPTIVA/ops/refresh-primes-payment-agg.sh >> /var/log/captiva/primes-payment-agg-refresh.log 2>&1`
- Objet: reconstruire l'agrégat `contract_premium_payments_agg` pour accélérer l'écran `Primes`
- Log: `/var/log/captiva/primes-payment-agg-refresh.log`

## Jobs applicatifs CAPTIVA (asynchrones)

### Worker de jobs (PM2)
- Processus: `captiva-jobs`
- Script: `/root/apps/captiva-api/src/jobs/runner.js`
- Statut observé: `online`
- Rôle: exécuter les jobs en base (`jobs`, `report_jobs`, etc.)

Note:
- Ce worker PM2 n'est pas une cron système.
- Il tourne actuellement depuis `/root/apps/captiva-api` (constat serveur).

## Tâches planifiées via l'application (base de données)

### Rapports planifiés
- Endpoint: `POST /api/reports/schedule`
- Les demandes sont enregistrées en base (`jobs`, `report_jobs`) avec `scheduled_at`
- Exécution assurée par `captiva-jobs`

## Performance Primes (mécanisme automatique associé)

### Table d'agrégats
- Table: `contract_premium_payments_agg`
- Usage: remplacer l'agrégation à la volée sur `contract_premium_payments` dans `src/routes/primes.js`

### Script de refresh manuel / cron
- Script: `ops/refresh-primes-payment-agg.sh`
- Exécution manuelle:
```bash
/var/www/CAPTIVA/ops/refresh-primes-payment-agg.sh
```

## Index SQL ajoutés pour accélération (Primes)

Script de déploiement:
- `ops/sql/primes_payment_perf_v1.sql`

Ajouts principaux:
- `contract_premium_payments(contract_id, paid_on, amount)`
- `contract_premium_payments(paid_on, contract_id, amount)`
- `contracts(programme_id, statut, created_at, id)`

## Points de vigilance

- Si des paiements primes sont modifiés en journée, l'agrégat peut être en léger décalage jusqu'au refresh nocturne.
- Si besoin d'un recalcul immédiat après import massif:
```bash
/var/www/CAPTIVA/ops/refresh-primes-payment-agg.sh
```

