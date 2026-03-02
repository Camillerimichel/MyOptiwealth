-- ORSA comparison tables (aggregate-level comparison between simulation runs)

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS orsa_run_sets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(190) NOT NULL,
  base_run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  status ENUM('draft','done','archived') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_orsa_set_scenario_code (scenario_id, code),
  KEY idx_orsa_set_scenario_status (scenario_id, status),
  CONSTRAINT fk_orsa_set_scenario FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_orsa_set_base_run FOREIGN KEY (base_run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orsa_run_set_members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orsa_set_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  stress_code VARCHAR(32) NOT NULL, -- BASE / ADVERSE / SEVERE
  display_order INT NOT NULL DEFAULT 1,
  assumption_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_orsa_set_member (orsa_set_id, run_id),
  UNIQUE KEY ux_orsa_set_stress (orsa_set_id, stress_code),
  CONSTRAINT fk_orsa_member_set FOREIGN KEY (orsa_set_id) REFERENCES orsa_run_sets(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_orsa_member_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orsa_run_comparison_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orsa_set_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  stress_code VARCHAR(32) NOT NULL,
  snapshot_date DATE NOT NULL,
  gwp_total DECIMAL(18,2) NULL,
  claims_paid_total DECIMAL(18,2) NULL,
  claims_incurred_total DECIMAL(18,2) NULL,
  rbns_total DECIMAL(18,2) NULL,
  ibnr_total DECIMAL(18,2) NULL,
  premium_ceded_total DECIMAL(18,2) NULL,
  claims_ceded_total DECIMAL(18,2) NULL,
  scr_non_life DECIMAL(18,2) NULL,
  scr_counterparty DECIMAL(18,2) NULL,
  scr_market DECIMAL(18,2) NULL,
  scr_operational DECIMAL(18,2) NULL,
  scr_total DECIMAL(18,2) NULL,
  mcr DECIMAL(18,2) NULL,
  own_funds_eligible DECIMAL(18,2) NULL,
  solvency_ratio_pct DECIMAL(10,4) NULL,
  property_cat_loss_gross DECIMAL(18,2) NULL,
  property_cat_exposure_s2 DECIMAL(18,2) NULL,
  property_geo_hhi DECIMAL(18,8) NULL,
  top_broker_gwp_share_pct DECIMAL(10,6) NULL,
  top20_broker_gwp_share_pct DECIMAL(10,6) NULL,
  methodology_version VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_orsa_comp_set_run_date (orsa_set_id, run_id, snapshot_date),
  KEY idx_orsa_comp_set_stress (orsa_set_id, stress_code, snapshot_date),
  CONSTRAINT fk_orsa_comp_set FOREIGN KEY (orsa_set_id) REFERENCES orsa_run_sets(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_orsa_comp_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

