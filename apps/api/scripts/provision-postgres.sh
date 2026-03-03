#!/usr/bin/env bash
set -euo pipefail

DB_ROLE="${DB_ROLE:-myoptiwealth_saas}"
DB_PASS="${DB_PASS:-myoptiwealth_saas_2026}"
DB_NAME="${DB_NAME:-myoptiwealth_saas}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 1
fi

sudo -u postgres psql <<SQL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}') THEN
    CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '${DB_PASS}' CREATEDB;
  ELSE
    ALTER ROLE ${DB_ROLE} WITH LOGIN PASSWORD '${DB_PASS}' CREATEDB;
  END IF;
END
$$;
SQL

sudo -u postgres psql -tc "SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_ROLE}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')" | sudo -u postgres psql

echo "PostgreSQL provisioned: role=${DB_ROLE} db=${DB_NAME}"
