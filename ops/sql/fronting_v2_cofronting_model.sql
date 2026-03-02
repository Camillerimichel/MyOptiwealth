-- Co-fronting extension for Fronting V2 (A/B quote-shares and per-run allocations)

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS fronting_program_counterparties (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fronting_program_id BIGINT UNSIGNED NOT NULL,
  insurer_id INT NOT NULL,
  role_code ENUM('PRIMARY','SECONDARY','OTHER') NOT NULL DEFAULT 'PRIMARY',
  share_pct DECIMAL(9,4) NOT NULL,
  fee_share_pct DECIMAL(9,4) NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_fronting_program_insurer (fronting_program_id, insurer_id),
  KEY idx_fronting_cp_program_role (fronting_program_id, role_code),
  CONSTRAINT fk_fronting_cp_program FOREIGN KEY (fronting_program_id) REFERENCES fronting_programs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_cp_insurer FOREIGN KEY (insurer_id) REFERENCES insurers(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fronting_run_counterparty_allocations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fronting_adjustment_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  insurer_id INT NOT NULL,
  role_code ENUM('PRIMARY','SECONDARY','OTHER') NOT NULL DEFAULT 'PRIMARY',
  share_pct DECIMAL(9,4) NOT NULL,
  gross_premium_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  fronted_premium_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  retroceded_premium_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  fronting_fee_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  claims_handling_fee_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_paid_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_incurred_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  paid_net_to_captive_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  incurred_net_to_captive_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  counterparty_exposure_alloc DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_fronting_alloc_run_branch_insurer_date (run_id, snapshot_date, id_branch, insurer_id),
  KEY idx_fronting_alloc_adj (fronting_adjustment_id),
  CONSTRAINT fk_fronting_alloc_adj FOREIGN KEY (fronting_adjustment_id) REFERENCES fronting_run_adjustments(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_alloc_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_alloc_branch FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_fronting_alloc_insurer FOREIGN KEY (insurer_id) REFERENCES insurers(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

