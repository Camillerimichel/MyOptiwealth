# QRT Role Access Matrix

Roles in scope:
- `admin`
- `cfo`
- `risk_manager`
- `actuaire`
- `conseil`

Capabilities (backend source: `GET /api/qrt/access`):
- `qrt_read`: admin, cfo, risk_manager, actuaire, conseil
- `qrt_build_and_export`: admin, cfo, risk_manager, actuaire
- `qrt_publish_and_lock`: admin, cfo, risk_manager
- `qrt_governance_config`: admin, cfo, risk_manager
- `qrt_approve`: admin, cfo, risk_manager
- `qrt_submission`: admin, cfo, risk_manager, actuaire
- `qrt_webhooks_manage`: admin, cfo, risk_manager
- `qrt_retention_run`: admin, cfo

Frontend rule:
- Every action button must be gated on `capabilities` from `/api/qrt/access`.
- Do not infer permissions from labels only.
