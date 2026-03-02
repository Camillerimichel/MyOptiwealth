# QRT UI Flow Priority

## 1) Monitoring first
- Pages: Health, Dashboard, Compliance.
- APIs: `/health`, `/dashboard`, `/compliance/status`, `/workflow/runs`, `/events`, `/archive/logs`.
- Goal: give immediate production visibility.

## 2) Workflow and exports
- Build/validate/export draft, publish, lock.
- APIs: `/facts/*`, `/validate`, `/export/*`, `/workflow/full`, `/workflow/list`, `/workflow/:key`.
- Goal: end-to-end operational run.

## 3) Four-eyes governance
- Governance toggle + approvals queue.
- APIs: `/governance`, `/approvals*`, `/export/:id/lock`.
- Goal: enforce approval before lock.

## 4) Submission and integrity
- Prepare package, mark submitted, download package, verify hashes.
- APIs: `/submissions*`, `/export/:id/verify-integrity`.
- Goal: regulator-ready handoff.

## 5) Ops controls
- Guardrails settings, webhook management, event replay, retention.
- APIs: `/guardrails*`, `/webhooks*`, `/events/:id/replay`, `/retention/run`.
- Goal: autonomous operations and incident recovery.
