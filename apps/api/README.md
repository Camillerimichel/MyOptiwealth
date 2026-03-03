# MyOptiwealth API

NestJS modular backend with:

- JWT auth (access 15m / refresh 7d)
- Refresh token hash persistence
- TOTP 2FA flow
- AES-256-GCM encryption service for secrets
- Workspace multi-tenancy
- Audit log service
- Modules: auth, crm, projects, tasks, calendar (ICS), emails, documents, finance, timesheet, dashboard
- Refresh token is delivered in `HttpOnly` cookie (`/api/auth`) and access token in response payload.
- `POST /emails/sync` triggers IMAP synchronization from workspace settings.
- Project creation supports `missionType` and auto-generates base/variant template tasks.
- `POST /documents/upload` supports multipart upload to local storage or S3.
- `POST /documents/:id/send-signature` creates a signature request (`MOCK`/`YOUSIGN`/`DOCUSIGN` mode).
- `POST /documents/signature/webhook` updates signature state with `x-signature-webhook-token` and `x-workspace-id`.
- `GET/POST /workspaces/settings/current` lets admins manage encrypted IMAP and signature credentials.
- `GET /metrics` exposes Prometheus-like metrics.
- `GET /health`, `/health/live`, `/health/ready`, `/health/details` expose health probes.

Prisma schema includes mandatory `workspaceId` on business tables.

## Database bootstrap (PostgreSQL)

1. Provision Postgres role/database: `npm run db:provision`
2. Copy env: `cp .env.example .env`
3. Run bootstrap (dev): `npm run db:bootstrap`
4. Run deploy flow (prod): `npm run db:deploy`

This executes:

- `prisma generate`
- `prisma migrate dev --name init_saas`
- `prisma db seed`

Seed defaults:

- Email: `admin@myoptiwealth.local`
- Password: `ChangeMe123!`
- Workspace: `MyOptiwealth Demo Workspace`
