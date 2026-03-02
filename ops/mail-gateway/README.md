# CAPTIVA Mail Gateway

Service HTTP local pour recevoir les alertes QRT (`POST /qrt-alert`) puis les transmettre au provider mail.

## 1) Préparer la config

```bash
cd /var/www/CAPTIVA/ops/mail-gateway
cp .env.example .env
```

Remplir `.env` (token + provider).

## 2) Lancer en manuel

```bash
cd /var/www/CAPTIVA
set -a && source ops/mail-gateway/.env && set +a
node ops/mail-gateway/server.mjs
```

Healthcheck:

```bash
curl -s http://127.0.0.1:8787/health
```

## 3) Configurer CAPTIVA

Dans `/var/www/CAPTIVA/.env`:

```env
QRT_ALERT_EMAIL_WEBHOOK_URL=http://127.0.0.1:8787/qrt-alert
QRT_ALERT_EMAIL_WEBHOOK_TOKEN=change-me-long-random-token
```

Puis redémarrer le worker:

```bash
sudo systemctl restart qrt-ops-worker
```

## 4) Test endpoint

```bash
curl -s -X POST http://127.0.0.1:8787/qrt-alert \
  -H 'Content-Type: application/json' \
  -H 'x-captiva-token: change-me-long-random-token' \
  -d '{"to":["ops@captiva-risks.com"],"subject":"Test QRT","text":"hello"}'
```

## Notes

- Si `MAIL_PROVIDER=smtp`: envoi via SMTP.
- Si `MAIL_PROVIDER=brevo`: envoi API Brevo (`/v3/smtp/email`).
- Le token est optionnel techniquement, recommandé en production.
