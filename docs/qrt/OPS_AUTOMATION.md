# QRT Operations Automation

## Scripts

- `npm run ops:qrt:tick`
  - Scans active schedules due now.
  - Enqueues `jobs.type = 'qrt.schedule.execute'`.

- `npm run ops:qrt:run`
  - Processes queued QRT jobs:
  - `qrt.schedule.execute`
  - `qrt.alert.email`

- `npm run ops:qrt:once`
  - Runs tick then run in one shot.

## Scheduling model

Data table: `qrt_schedules`

Fields used:
- `job_code`: `monthly_closure | retry_auto | retention | submission_prepare | alerts_scan`
- `frequency`: `hourly | daily | weekly | monthly`
- `hour_utc`, `minute_utc`, optional `day_of_week`, `day_of_month`
- `payload_json`
- `next_run_at`, `last_run_at`, `last_status`, `last_error`

## Tasks model

Data table: `qrt_tasks`
- statuses: `todo | in_progress | done | blocked`
- priorities: `low | normal | high | critical`
- due date and optional links to export/workflow.

## Alerts model

Rules table: `qrt_alert_rules`
- event/severity to recipients mapping.
- cooldown to avoid mail storms.

Deliveries table: `qrt_alert_deliveries`
- queued/sent/failed lifecycle.
- provider response and error log.

## Email provider

Required env:
- `QRT_ALERT_EMAIL_WEBHOOK_URL`

Expected payload sent by worker:
- `to` (array of emails)
- `subject`
- `text`
- `event_code`
- `severity`

## Recommended cron / PM2

Every minute:
- `npm run ops:qrt:once`

Or split:
- minute tick: `npm run ops:qrt:tick`
- minute run: `npm run ops:qrt:run`
