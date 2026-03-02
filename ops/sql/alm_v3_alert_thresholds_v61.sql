ALTER TABLE alm_v3_profiles
  ADD COLUMN IF NOT EXISTS liq_alert_tension_threshold_eur DECIMAL(18,2) NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS liq_alert_vigilance_threshold_eur DECIMAL(18,2) NULL DEFAULT 500000.00,
  ADD COLUMN IF NOT EXISTS duration_alert_vigilance_abs_years DECIMAL(12,6) NULL DEFAULT 3.000000,
  ADD COLUMN IF NOT EXISTS duration_alert_tension_abs_years DECIMAL(12,6) NULL DEFAULT 5.000000;
