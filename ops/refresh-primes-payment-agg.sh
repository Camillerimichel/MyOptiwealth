#!/usr/bin/env bash
set -euo pipefail

cd /var/www/CAPTIVA

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-captiva}"
DB_USER="${DB_USER:-captiva}"
DB_PASS="${DB_PASS:-$(awk -F= '/^DB_PASS=/{print $2}' .env)}"

if [[ -z "${DB_PASS:-}" ]]; then
  echo "[refresh-primes-payment-agg] DB_PASS introuvable" >&2
  exit 1
fi

mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" <<'SQL'
CREATE TABLE IF NOT EXISTS contract_premium_payments_agg (
  contract_id INT(11) NOT NULL,
  total_paid DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  last_paid_on DATE DEFAULT NULL,
  payment_count INT(11) NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

TRUNCATE TABLE contract_premium_payments_agg;

INSERT INTO contract_premium_payments_agg (contract_id, total_paid, last_paid_on, payment_count)
SELECT
  cpp.contract_id,
  ROUND(COALESCE(SUM(cpp.amount), 0), 2) AS total_paid,
  MAX(cpp.paid_on) AS last_paid_on,
  COUNT(*) AS payment_count
FROM contract_premium_payments cpp
GROUP BY cpp.contract_id;
SQL

echo "[refresh-primes-payment-agg] OK"

