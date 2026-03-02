# QRT Production Guardrails Checklist

Implemented now:
- Webhook URL validation (`http/https` only).
- Webhook timeout (5s) with failed delivery logging.
- Event payload truncation protection in logs.
- Extended `/api/qrt/health` checks for all QRT tables and hash columns.
- Strict smoke pipeline available: `seed -> smoke:strict -> reset`.

Runbook before frontend release:
1. Start API target and validate `/health` + `/api/qrt/health`.
2. Run `npm run seed:qrt:smoke`.
3. Run strict smoke against target base URL.
4. Run `npm run reset:qrt:smoke`.
5. Confirm `/api/qrt/access` reflects expected role capabilities.

Recommended next hardening:
- Rate-limit replay and retention routes.
- Add webhook retry with exponential backoff.
- Add alert on `compliance.status != ok`.
- Add nightly smoke job in CI/CD environment.
