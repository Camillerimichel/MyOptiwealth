-- Geo/CAT concentration extensions for simulation runs

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS geo_zones (
  code VARCHAR(30) PRIMARY KEY,
  country_code CHAR(2) NOT NULL DEFAULT 'FR',
  region_name VARCHAR(120) NULL,
  zone_type ENUM('region','department','postal_cluster','custom') NOT NULL DEFAULT 'region',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contract_geo_exposures (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  contract_id INT NOT NULL,
  contract_coverage_id BIGINT UNSIGNED NOT NULL,
  client_id INT NOT NULL,
  partner_id INT NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  geo_code VARCHAR(30) NOT NULL,
  insured_value DECIMAL(18,2) NULL,
  cat_weight DECIMAL(10,6) NOT NULL DEFAULT 1.000000,
  premium_gross DECIMAL(18,2) NULL,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_contract_geo_expo (run_id, contract_coverage_id, geo_code, snapshot_date),
  KEY idx_contract_geo_expo_geo (run_id, geo_code, snapshot_date),
  KEY idx_contract_geo_expo_branch (run_id, id_branch, snapshot_date),
  CONSTRAINT fk_contract_geo_expo_scenario FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_contract FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_cov FOREIGN KEY (contract_coverage_id) REFERENCES contract_coverages(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_partner FOREIGN KEY (partner_id) REFERENCES partners(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_branch FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_contract_geo_expo_zone FOREIGN KEY (geo_code) REFERENCES geo_zones(code)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cat_event_zone_impacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cat_event_id BIGINT UNSIGNED NOT NULL,
  geo_code VARCHAR(30) NOT NULL,
  intensity_factor DECIMAL(10,6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_cat_event_zone (cat_event_id, geo_code),
  KEY idx_cat_event_zone_geo (geo_code),
  CONSTRAINT fk_cat_event_zone_impacts_event FOREIGN KEY (cat_event_id) REFERENCES cat_events(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cat_event_zone_impacts_zone FOREIGN KEY (geo_code) REFERENCES geo_zones(code)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cat_concentration_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  geo_code VARCHAR(30) NOT NULL,
  property_contracts_count INT NOT NULL DEFAULT 0,
  property_clients_count INT NOT NULL DEFAULT 0,
  property_gwp_gross DECIMAL(18,2) NOT NULL DEFAULT 0,
  property_sum_insured DECIMAL(18,2) NOT NULL DEFAULT 0,
  property_gwp_share_pct DECIMAL(12,8) NULL,
  property_si_share_pct DECIMAL(12,8) NULL,
  cat_event_count INT NOT NULL DEFAULT 0,
  cat_impacted_contracts_count INT NOT NULL DEFAULT 0,
  cat_impacted_gwp_gross DECIMAL(18,2) NOT NULL DEFAULT 0,
  weighted_cat_exposure DECIMAL(18,2) NOT NULL DEFAULT 0,
  hhi_contribution DECIMAL(18,10) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_cat_conc_snap (run_id, snapshot_date, geo_code),
  KEY idx_cat_conc_snap_rank (run_id, snapshot_date, property_gwp_gross),
  CONSTRAINT fk_cat_conc_snap_scenario FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cat_conc_snap_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cat_conc_snap_zone FOREIGN KEY (geo_code) REFERENCES geo_zones(code)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

