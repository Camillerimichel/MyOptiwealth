CREATE TABLE IF NOT EXISTS alm_v2_configs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  captive_id INT NOT NULL,
  scenario_id INT NULL,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  is_default TINYINT(1) NOT NULL DEFAULT 1,
  methodology_version VARCHAR(60) NOT NULL DEFAULT 'alm-proxy-v2',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v2_cfg_captive_code (captive_id, code),
  KEY idx_alm_v2_cfg_captive_default (captive_id, is_default),
  CONSTRAINT fk_alm_v2_cfg_captive
    FOREIGN KEY (captive_id) REFERENCES captives(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v2_cfg_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_duration_buckets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT UNSIGNED NOT NULL,
  bucket_code VARCHAR(30) NOT NULL,
  label VARCHAR(120) NOT NULL,
  min_years DECIMAL(10,4) NOT NULL DEFAULT 0,
  max_years DECIMAL(10,4) NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v2_bucket_cfg_code (config_id, bucket_code),
  KEY idx_alm_v2_bucket_cfg_order (config_id, display_order),
  CONSTRAINT fk_alm_v2_bucket_cfg
    FOREIGN KEY (config_id) REFERENCES alm_v2_configs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_asset_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT UNSIGNED NOT NULL,
  asset_code VARCHAR(30) NOT NULL,
  label VARCHAR(120) NOT NULL,
  default_duration_years DECIMAL(10,4) NULL,
  liquidity_horizon_days INT NULL,
  risk_bucket VARCHAR(30) NULL,
  display_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v2_asset_cfg_code (config_id, asset_code),
  KEY idx_alm_v2_asset_cfg_order (config_id, display_order),
  CONSTRAINT fk_alm_v2_asset_cfg
    FOREIGN KEY (config_id) REFERENCES alm_v2_configs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_allocation_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT UNSIGNED NOT NULL,
  asset_class_id BIGINT UNSIGNED NOT NULL,
  duration_bucket_id BIGINT UNSIGNED NULL,
  target_weight_pct DECIMAL(9,4) NOT NULL,
  duration_years_override DECIMAL(10,4) NULL,
  liquidity_horizon_days_override INT NULL,
  comment_text VARCHAR(255) NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v2_alloc_cfg_asset (config_id, asset_class_id),
  KEY idx_alm_v2_alloc_cfg_order (config_id, display_order),
  CONSTRAINT fk_alm_v2_alloc_cfg
    FOREIGN KEY (config_id) REFERENCES alm_v2_configs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v2_alloc_asset
    FOREIGN KEY (asset_class_id) REFERENCES alm_v2_asset_classes(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v2_alloc_bucket
    FOREIGN KEY (duration_bucket_id) REFERENCES alm_v2_duration_buckets(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_branch_assumptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT UNSIGNED NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  holding_years_base DECIMAL(10,4) NOT NULL,
  holding_years_stress DECIMAL(10,4) NOT NULL,
  capital_lock_factor DECIMAL(10,4) NOT NULL DEFAULT 1.0,
  liquidity_need_pct DECIMAL(9,4) NOT NULL DEFAULT 0,
  weighting_mode VARCHAR(30) NOT NULL DEFAULT 'incurred_reserve',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v2_branch_cfg (config_id, id_branch),
  KEY idx_alm_v2_branch_cfg (config_id),
  CONSTRAINT fk_alm_v2_branch_cfg
    FOREIGN KEY (config_id) REFERENCES alm_v2_configs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v2_branch_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_id BIGINT UNSIGNED NOT NULL,
  orsa_set_id BIGINT UNSIGNED NULL,
  scenario_id INT NULL,
  run_id BIGINT UNSIGNED NULL,
  snapshot_date DATE NOT NULL,
  methodology_version VARCHAR(60) NOT NULL DEFAULT 'alm-proxy-v2',
  own_funds_base DECIMAL(18,2) NULL,
  scr_base DECIMAL(18,2) NULL,
  scr_peak_orsa DECIMAL(18,2) NULL,
  own_funds_to_allocate DECIMAL(18,2) NULL,
  weighted_holding_years_base DECIMAL(12,4) NULL,
  weighted_holding_years_stress DECIMAL(12,4) NULL,
  weighted_asset_duration_years DECIMAL(12,4) NULL,
  short_liquidity_need_amount DECIMAL(18,2) NULL,
  comments_json JSON NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v2_result_cfg_orsa_date (config_id, orsa_set_id, snapshot_date),
  KEY idx_alm_v2_result_cfg_date (config_id, snapshot_date),
  CONSTRAINT fk_alm_v2_result_cfg
    FOREIGN KEY (config_id) REFERENCES alm_v2_configs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v2_result_orsa
    FOREIGN KEY (orsa_set_id) REFERENCES orsa_run_sets(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_result_asset_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  result_id BIGINT UNSIGNED NOT NULL,
  asset_code VARCHAR(30) NOT NULL,
  asset_label VARCHAR(120) NOT NULL,
  duration_bucket_code VARCHAR(30) NULL,
  duration_bucket_label VARCHAR(120) NULL,
  target_weight_pct DECIMAL(9,4) NULL,
  duration_years DECIMAL(10,4) NULL,
  liquidity_horizon_days INT NULL,
  allocated_own_funds_amount DECIMAL(18,2) NULL,
  indicative_holding_years_base DECIMAL(12,4) NULL,
  indicative_holding_years_stress DECIMAL(12,4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alm_v2_res_asset_result (result_id),
  CONSTRAINT fk_alm_v2_res_asset_result
    FOREIGN KEY (result_id) REFERENCES alm_v2_results(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v2_result_duration_buckets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  result_id BIGINT UNSIGNED NOT NULL,
  bucket_code VARCHAR(30) NOT NULL,
  bucket_label VARCHAR(120) NOT NULL,
  target_weight_pct DECIMAL(9,4) NULL,
  allocated_own_funds_amount DECIMAL(18,2) NULL,
  avg_duration_years DECIMAL(10,4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alm_v2_res_bucket_result (result_id),
  CONSTRAINT fk_alm_v2_res_bucket_result
    FOREIGN KEY (result_id) REFERENCES alm_v2_results(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
