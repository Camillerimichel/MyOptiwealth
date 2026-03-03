# MyOptiwealth SaaS Deploy (apps/api + apps/web)

## 1) Prerequisites

- Path: `/var/www/myoptiwealth`
- Node.js 22+
- npm
- pm2
- PostgreSQL reachable by `apps/api/.env`
- Environment files present:
  - `apps/api/.env`
  - `apps/web/.env.production` (at minimum `NEXT_PUBLIC_API_BASE_URL=https://__DOMAIN__/api`)
  - Use templates:
    - `apps/api/.env.production.example`
    - `apps/web/.env.production.example`

## 2) Deploy commands

- Standard deploy (with git pull):
```bash
cd /var/www/myoptiwealth
bash ops/saas-deploy.sh
```

- Local deploy (no git pull):
```bash
cd /var/www/myoptiwealth
bash ops/saas-deploy-local.sh
```

## 3) PM2

- Ecosystem file: `ops/ecosystem.saas.config.cjs`
- Process names:
  - `myoptiwealth-saas-api`
  - `myoptiwealth-saas-web`

Useful commands:
```bash
pm2 ls
pm2 logs myoptiwealth-saas-api --lines 100
pm2 logs myoptiwealth-saas-web --lines 100
```

Optional boot persistence with systemd:
```bash
cp ops/systemd/myoptiwealth-saas-pm2.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now myoptiwealth-saas-pm2.service
```

## 4) Nginx reverse proxy

Template file:
- `ops/nginx/myoptiwealth-saas.conf`

Install:
```bash
cp ops/nginx/myoptiwealth-saas.conf /etc/nginx/sites-available/myoptiwealth-saas.conf
ln -s /etc/nginx/sites-available/myoptiwealth-saas.conf /etc/nginx/sites-enabled/myoptiwealth-saas.conf
nginx -t && systemctl reload nginx
```

## 5) Healthcheck scheduling

Option A (recommended): systemd timer
```bash
cp ops/systemd/myoptiwealth-saas-healthcheck.service /etc/systemd/system/
cp ops/systemd/myoptiwealth-saas-healthcheck.timer /etc/systemd/system/
mkdir -p /etc/myoptiwealth-saas
cat >/etc/myoptiwealth-saas/healthcheck.env <<ENV
API_BASE_URL=http://127.0.0.1:7000/api
# ALERT_WEBHOOK_URL=
# ALERT_WEBHOOK_TOKEN=
ENV
systemctl daemon-reload
systemctl enable --now myoptiwealth-saas-healthcheck.timer
```

Option B: cron
```bash
crontab -l > /tmp/current.cron || true
cat /tmp/current.cron ops/cron/myoptiwealth-saas.cron | crontab -
```

## 6) Smoke tests

Run post-deploy smoke tests manually:
```bash
API_BASE_URL=http://127.0.0.1:7000/api WEB_BASE_URL=http://127.0.0.1:3002 bash ops/saas-smoke.sh
```

## 7) Rollback

Each deploy creates a snapshot in:
- `/var/backups/myoptiwealth-saas/releases/<timestamp>`

Rollback to latest snapshot:
```bash
cd /var/www/myoptiwealth
bash ops/saas-rollback.sh
```

Rollback to a specific snapshot:
```bash
cd /var/www/myoptiwealth
bash ops/saas-rollback.sh 20260303T090000Z
```

## 8) Secrets checklist

Before go-live, validate:
- `ops/SAAS_SECRETS_CHECKLIST.md`
