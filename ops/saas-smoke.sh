#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:7000/api}"
WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:3002}"

check_200() {
  local url="$1"
  local label="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [ "$code" != "200" ]; then
    echo "[smoke][error] ${label} expected 200 got ${code} (${url})" >&2
    exit 1
  fi
  echo "[smoke][ok] ${label}"
}

check_status_in() {
  local url="$1"
  local label="$2"
  local allowed_csv="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [[ ",${allowed_csv}," != *",${code},"* ]]; then
    echo "[smoke][error] ${label} expected one of [${allowed_csv}] got ${code} (${url})" >&2
    exit 1
  fi
  echo "[smoke][ok] ${label} (${code})"
}

check_401() {
  local url="$1"
  local label="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [ "$code" != "401" ]; then
    echo "[smoke][error] ${label} expected 401 got ${code} (${url})" >&2
    exit 1
  fi
  echo "[smoke][ok] ${label}"
}

check_200 "${API_BASE_URL}/health/ready" "API ready"
check_200 "${API_BASE_URL}/metrics" "API metrics"
check_status_in "${WEB_BASE_URL}/" "Web home" "200,301,302,307,308"
check_401 "${API_BASE_URL}/projects" "Auth guard on /projects"

echo "[smoke] MyOptiwealth SaaS smoke tests passed"
