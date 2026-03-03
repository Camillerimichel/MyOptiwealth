# MyOptiwealth SaaS Apps

This folder contains the generated V1 SaaS foundation aligned with `MYOPTIWEALTH_SAAS_SPECIFICATION.md`.

- `api`: NestJS + Prisma multi-tenant backend.
- `web`: Next.js App Router frontend shell.

## Quick start

### API

1. `cd apps/api`
2. `npm install`
3. `cp .env.example .env`
4. `npm run prisma:generate`
5. `npm run prisma:migrate`
6. `npm run start:dev`

### Web

1. `cd apps/web`
2. `npm install`
3. `NEXT_PUBLIC_API_BASE_URL=http://localhost:7000/api npm run dev`

## Docker compose (dev stack)

From `apps/`:

1. `docker compose -f docker-compose.saas.yml up -d`
2. `docker compose -f docker-compose.saas.yml exec api npm run db:bootstrap`

## Production deploy

Production deployment assets (PM2, Nginx, systemd, healthcheck) are documented in:

- `../ops/README_SAAS_DEPLOY.md`
