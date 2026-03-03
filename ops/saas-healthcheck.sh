#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:7000/api}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
ALERT_WEBHOOK_TOKEN="${ALERT_WEBHOOK_TOKEN:-}"

ready_code=$(curl -s -o /tmp/myoptiwealth_ready.json -w "%{http_code}" "${API_BASE_URL}/health/ready" || true)
metrics_code=$(curl -s -o /tmp/myoptiwealth_metrics.txt -w "%{http_code}" "${API_BASE_URL}/metrics" || true)

status="ok"
message="MyOptiwealth SaaS healthcheck ok"

if [ "${ready_code}" != "200" ] || [ "${metrics_code}" != "200" ]; then
  status="error"
  message="MyOptiwealth SaaS healthcheck failed: ready=${ready_code} metrics=${metrics_code}"
fi

if [ "${status}" = "error" ]; then
  echo "${message}" >&2
  if [ -n "${ALERT_WEBHOOK_URL}" ]; then
    payload=$(cat <<JSON
{"service":"myoptiwealth-saas","status":"${status}","message":"${message}","checkedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON
)

    if [ -n "${ALERT_WEBHOOK_TOKEN}" ]; then
      curl -sS -X POST "${ALERT_WEBHOOK_URL}" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${ALERT_WEBHOOK_TOKEN}" \
        -d "${payload}" >/dev/null || true
    else
      curl -sS -X POST "${ALERT_WEBHOOK_URL}" \
        -H "Content-Type: application/json" \
        -d "${payload}" >/dev/null || true
    fi
  fi
  exit 1
fi

echo "${message}"
