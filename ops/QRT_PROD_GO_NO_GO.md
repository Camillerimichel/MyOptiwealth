# QRT Go/No-Go (Prudent)

## 1) Configuration
- `JWT_SECRET` fort (>= 24 chars), non partagé.
- `QRT_ALERT_EMAIL_WEBHOOK_URL` pointant vers le provider mail de prod.
- Variables DB prod (`DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASS`) vérifiées.

## 2) Schéma et données
- Lancer migration sur prod.
- Vérifier tables QRT présentes (`qrt_schedules`, `qrt_tasks`, `qrt_alert_rules`, `qrt_alert_deliveries`, `qrt_incident_watch`, `jobs`).
- Vérifier colonnes d'escalade présentes (`min_escalation_level`, `max_escalation_level`).

## 3) Astreinte et comptes
- Créer/valider comptes opérationnels (ops/risk/direction).
- Remplacer toutes les adresses `.local` par des adresses réelles.
- Rejouer le seed astreinte:
  - `ONCALL_L1=... ONCALL_L2=... ONCALL_L3=... npm run seed:qrt:oncall`

## 4) Vérifications techniques
- Contrôle readiness:
  - `npm run verify:qrt:prod`
- Contrôle escalade L1->L2->L3:
  - `npm run verify:qrt:oncall`
- Smoke QRT:
  - `npm run smoke:qrt`

## 5) Opérations
- Exécuter worker en service permanent (`npm run ops:qrt:run`) via PM2/systemd.
- Surveiller logs worker + statut jobs `qrt.alert.email` + endpoint `/api/qrt/health`.
- Plan de rollback prêt (dump DB + procédure de retour version).

### Exemple systemd (recommandé)
- Installer l'unité:
  - `sudo cp ops/systemd/qrt-ops-worker.service /etc/systemd/system/`
- Créer le dossier de logs:
  - `sudo mkdir -p /var/log/captiva && sudo chown -R www-data:www-data /var/log/captiva`
- Activer et démarrer:
  - `sudo systemctl daemon-reload`
  - `sudo systemctl enable qrt-ops-worker`
  - `sudo systemctl start qrt-ops-worker`
- Vérifier:
  - `sudo systemctl status qrt-ops-worker --no-pager`
  - `tail -f /var/log/captiva/qrt-ops-worker.log`

## Décision
- `GO` si `verify:qrt:prod` = `ok:true` et aucun warning bloquant métier.
- `NO-GO` si au moins 1 `error` ou si recipients de test (`.local`) restent actifs.
