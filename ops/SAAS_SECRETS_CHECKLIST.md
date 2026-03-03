# MyOptiwealth SaaS Secrets Checklist

Use this checklist before first production deploy and after any credential rotation.

## API (`apps/api/.env`)

- `DATABASE_URL` uses a dedicated production role with strong password.
- `JWT_ACCESS_SECRET` is unique and at least 32 random bytes.
- `JWT_REFRESH_SECRET` is unique and at least 32 random bytes.
- `AES_SECRET_BASE64` is exactly 32 random bytes in base64.
- `SIGNATURE_WEBHOOK_TOKEN` is long, random, and stored outside git.
- `COOKIE_SECURE=true` in production.

## Optional integrations

- If `DOCUMENT_STORAGE_DRIVER=s3`, all S3 variables are set and tested.
- If Yousign/DocuSign enabled, API keys are stored encrypted in workspace settings.

## Web (`apps/web/.env.production`)

- `NEXT_PUBLIC_API_BASE_URL` points to HTTPS reverse proxy: `https://<domain>/api`.

## Runtime host

- `/etc/myoptiwealth-saas/healthcheck.env` exists if alerts are enabled.
- Alert webhook token is not echoed in shell history/scripts.
- `pm2 save` was executed after a successful deploy.

## Post-deploy verification

- `curl -fsS http://127.0.0.1:7000/api/health/ready`
- `curl -fsS http://127.0.0.1:7000/api/metrics`
- `curl -fsSI http://127.0.0.1:3000/`
