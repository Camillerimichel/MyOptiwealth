# QRT API Contract (Frozen v1)

Base path: `/api/qrt`

Auth:
- Bearer JWT required.
- Roles allowed on QRT routes: `admin`, `cfo`, `risk_manager`, `actuaire`, `conseil`.

Core endpoints:
- `GET /access`: current roles + QRT capabilities.
- `GET /health`, `GET /dashboard`, `GET /compliance/status`.
- Facts: `POST /facts/build`, `GET /facts`, `GET /facts/diff`, `GET /facts/diff.csv`, `POST /validate`.
- Exports: `POST /export/xbrl-lite`, `GET /export/latest`, `GET /export/list`, `GET /export/latest/download`, `GET /export/latest/bundle`.
- Lifecycle: `POST /export/publish`, `POST /export/:id/unpublish`, `POST /export/:id/lock`, `DELETE /export/:id`, `POST /export/clone`.
- Published/locked read: `GET /export/published/latest`, `GET /export/locked/latest`, `GET /export/locked/latest/download`.
- Integrity: `GET /export/:id/verify-integrity`.
- Guardrails: `GET /guardrails`, `PUT /guardrails`, `POST /guardrails/check`.
- Governance: `GET /governance`, `PUT /governance`.
- Approvals: `GET /approvals`, `POST /approvals/request`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`.
- Submission: `POST /submissions/prepare`, `GET /submissions`, `POST /submissions/:exportId/mark-submitted`, `GET /submissions/:id/download`.
- Workflow: `POST /workflow/full`, `POST /workflow/full/preview`, `GET /workflow/list`, `GET /workflow/:workflowRequestKey`, `POST /workflow/:workflowRequestKey/retry`, `POST /workflow/:workflowRequestKey/retry-auto`, `DELETE /workflow/:workflowRequestKey`.
- Workflow reports/timeline: `GET /workflow/:workflowRequestKey/report`, `GET /workflow/:workflowRequestKey/report/download`, `GET /workflow/:workflowRequestKey/timeline`, `GET /workflow/:workflowRequestKey/timeline.csv`.
- Workflow runs monitoring: `GET /workflow/runs`, `GET /workflow/runs/:id`.
- Monthly closure: `POST /closure/monthly`.
- Comparison: `GET /comparison/real-vs-simulation`.
- Webhooks/events: `GET /webhooks`, `POST /webhooks`, `PUT /webhooks/:id`, `DELETE /webhooks/:id`, `GET /events`, `POST /events/:id/replay`.
- Retention/archive: `POST /retention/run`, `GET /archive/logs`.
- Operational planning: `GET /schedules`, `POST /schedules`, `PATCH /schedules/:id`, `POST /schedules/:id/run-now`.
- Operational tasks: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`.
- Alerts: `GET /alerts/rules`, `POST /alerts/rules`, `PATCH /alerts/rules/:id`, `GET /alerts/deliveries`, `POST /alerts/scan`.

Common response shape:
- Success: `{ ok: true, ... }`
- Error: `{ error: "<error_code>" }` with HTTP 4xx/5xx.

Main blocking error codes (front handling mandatory):
- `invalid_token_scope`, `forbidden`
- `snapshot_date_invalid`, `invalid_export_id`, `workflow_request_key_invalid`
- `qrt_export_not_found`, `qrt_workflow_not_found`, `submission_not_found`
- `qrt_validation_failed`
- `guardrails_breach_blocking_publish`, `guardrails_breach_blocking_workflow`
- `double_validation_required`
- `qrt_export_locked`, `qrt_export_must_be_published_before_lock`

Pagination:
- List endpoints expose `page`, `limit`, `total` when applicable.

Files:
- Download routes return binary (`xml`, `zip`, `csv`) with `Content-Disposition`.
