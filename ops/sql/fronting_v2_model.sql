-- V2 Fronting model (parameters + computed adjustments)

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS fronting_programs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  primary_fronting_insurer_id INT NOT NULL,
  secondary_fronting_insurer_id INT NULL,
  fronting_share_pct DECIMAL(9,4) NOT NULL DEFAULT 100.0000,
  retrocession_to_captive_pct DECIMAL(9,4) NOT NULL DEFAULT 95.0000,
  fronting_fee_pct DECIMAL(9,4) NOT NULL DEFAULT 5.0000,
  claims_handling_fee_pct DECIMAL(9,4) NOT NULL DEFAULT 2.0000,
  minimum_fronting_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  effective_from DATE NOT NULL,
  effective_to DATE NOT NULL,
  status ENUM('draft','active','inactive') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_fronting_program_run_branch (run_id, id_branch),
  KEY idx_fronting_program_scenario (scenario_id),
  CONSTRAINT fk_fronting_program_scenario FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_program_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_program_branch FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_program_primary_insurer FOREIGN KEY (primary_fronting_insurer_id) REFERENCES insurers(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_program_secondary_insurer FOREIGN KEY (secondary_fronting_insurer_id) REFERENCES insurers(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fronting_run_adjustments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fronting_program_id BIGINT UNSIGNED NOT NULL,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  gross_premium DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_paid DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_incurred DECIMAL(18,2) NOT NULL DEFAULT 0,
  fronted_premium DECIMAL(18,2) NOT NULL DEFAULT 0,
  retroceded_to_captive_premium DECIMAL(18,2) NOT NULL DEFAULT 0,
  fronting_fee_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  claims_handling_fee_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  premium_net_to_captive_after_fees DECIMAL(18,2) NOT NULL DEFAULT 0,
  paid_net_to_captive DECIMAL(18,2) NOT NULL DEFAULT 0,
  incurred_net_to_captive DECIMAL(18,2) NOT NULL DEFAULT 0,
  estimated_counterparty_exposure DECIMAL(18,2) NOT NULL DEFAULT 0,
  assumption_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_fronting_adj_run_branch_date (run_id, id_branch, snapshot_date),
  KEY idx_fronting_adj_program (fronting_program_id),
  CONSTRAINT fk_fronting_adj_program FOREIGN KEY (fronting_program_id) REFERENCES fronting_programs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_adj_scenario FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_adj_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_adj_branch FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

