-- Simulation Captive Schema V1 (MySQL)
-- Extension tables only. Designed to work with the existing schema in src/db/migrate.js.

SET NAMES utf8mb4;

-- =========================================================
-- 1) Scenario / Run control
-- =========================================================

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  captive_id INT NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(190) NOT NULL,
  description TEXT NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  target_year INT NOT NULL,
  data_origin ENUM('synthetic','imported','mixed') NOT NULL DEFAULT 'synthetic',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_sim_scenarios_captive_code (captive_id, code),
  KEY idx_sim_scenarios_captive_status (captive_id, status),
  CONSTRAINT fk_sim_scenarios_captive
    FOREIGN KEY (captive_id) REFERENCES captives(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulation_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_label VARCHAR(120) NOT NULL,
  seed_value BIGINT NULL,
  status ENUM('queued','running','done','failed','canceled') NOT NULL DEFAULT 'queued',
  engine_version VARCHAR(64) NULL,
  notes TEXT NULL,
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_sim_runs_scenario_label (scenario_id, run_label),
  KEY idx_sim_runs_scenario_status (scenario_id, status),
  CONSTRAINT fk_sim_runs_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulation_parameters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  parameter_group ENUM('portfolio','distribution','claims','reinsurance','s2','governance') NOT NULL,
  parameter_key VARCHAR(120) NOT NULL,
  value_json JSON NOT NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_sim_params_scenario_group_key_from (scenario_id, parameter_group, parameter_key, effective_from),
  KEY idx_sim_params_scenario_group (scenario_id, parameter_group),
  CONSTRAINT fk_sim_params_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulation_run_checks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  check_code VARCHAR(80) NOT NULL,
  severity ENUM('info','warning','error') NOT NULL DEFAULT 'info',
  status ENUM('pass','fail') NOT NULL,
  metric_value DECIMAL(18,6) NULL,
  metric_json JSON NULL,
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sim_run_checks_run (run_id),
  KEY idx_sim_run_checks_status (status, severity),
  CONSTRAINT fk_sim_run_checks_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 2) Broker / Client simulation profiles (extends partners, clients)
-- =========================================================

CREATE TABLE IF NOT EXISTS partner_simulation_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  partner_id INT NOT NULL,
  scenario_id INT NOT NULL,
  broker_segment ENUM('top','core','tail') NOT NULL,
  pareto_weight DECIMAL(14,6) NOT NULL DEFAULT 1.000000,
  target_clients_count INT NULL,
  target_contracts_count INT NULL,
  target_gwp_amount DECIMAL(18,2) NULL,
  specialization_json JSON NULL,
  region_code VARCHAR(30) NULL,
  zone_code VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_partner_sim_profile (partner_id, scenario_id),
  KEY idx_partner_sim_profile_scenario_segment (scenario_id, broker_segment),
  CONSTRAINT fk_partner_sim_profile_partner
    FOREIGN KEY (partner_id) REFERENCES partners(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_partner_sim_profile_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_simulation_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  scenario_id INT NOT NULL,
  partner_id INT NULL,
  client_segment ENUM('particulier','pro','pme','sante','medical','autre') NOT NULL DEFAULT 'autre',
  geo_code VARCHAR(30) NULL,
  equipment_score DECIMAL(8,4) NULL,
  target_contracts_count INT NULL,
  risk_score DECIMAL(8,4) NULL,
  price_sensitivity DECIMAL(8,4) NULL,
  annual_revenue DECIMAL(18,2) NULL,
  payroll_amount DECIMAL(18,2) NULL,
  headcount INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_client_sim_profile (client_id, scenario_id),
  KEY idx_client_sim_profile_scenario_partner (scenario_id, partner_id),
  KEY idx_client_sim_profile_segment (scenario_id, client_segment),
  CONSTRAINT fk_client_sim_profile_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_client_sim_profile_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_client_sim_profile_partner
    FOREIGN KEY (partner_id) REFERENCES partners(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_branch_eligibility (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  scenario_id INT NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  eligibility_status ENUM('eligible','conditional','excluded') NOT NULL DEFAULT 'eligible',
  reason_code VARCHAR(60) NULL,
  max_limit DECIMAL(18,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_client_branch_elig (client_id, scenario_id, id_branch),
  KEY idx_client_branch_elig_scenario_branch (scenario_id, id_branch),
  CONSTRAINT fk_client_branch_elig_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_client_branch_elig_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_client_branch_elig_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 3) Contract coverage granularity + GWP transactions
-- =========================================================

CREATE TABLE IF NOT EXISTS contract_coverages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  programme_coverage_id INT NULL,
  coverage_label VARCHAR(160) NULL,
  limit_per_claim DECIMAL(18,2) NULL,
  limit_annual DECIMAL(18,2) NULL,
  deductible_amount DECIMAL(18,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_contract_coverages_contract_branch (contract_id, id_branch),
  KEY idx_contract_coverages_branch (id_branch),
  CONSTRAINT fk_contract_coverages_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contract_coverages_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_contract_coverages_programme_coverage
    FOREIGN KEY (programme_coverage_id) REFERENCES programme_coverages(id_coverage)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS premium_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  contract_id INT NOT NULL,
  contract_coverage_id BIGINT UNSIGNED NULL,
  transaction_type ENUM('ISSUED','ENDORSEMENT','CANCELLATION','EARNED') NOT NULL,
  accounting_date DATE NOT NULL,
  effective_date DATE NULL,
  amount_gross DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  tax_amount DECIMAL(18,2) NULL,
  commission_amount DECIMAL(18,2) NULL,
  brokerage_amount DECIMAL(18,2) NULL,
  source_ref VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_premium_tx_scenario_date (scenario_id, accounting_date),
  KEY idx_premium_tx_run_date (run_id, accounting_date),
  KEY idx_premium_tx_contract_date (contract_id, accounting_date),
  KEY idx_premium_tx_cov (contract_coverage_id),
  CONSTRAINT fk_premium_tx_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_premium_tx_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_premium_tx_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_premium_tx_contract_cov
    FOREIGN KEY (contract_coverage_id) REFERENCES contract_coverages(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 4) Claims lifecycle / reserves / CAT events
-- =========================================================

CREATE TABLE IF NOT EXISTS claim_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sinistre_id INT NOT NULL,
  sinistre_ligne_id INT NULL,
  event_type ENUM('OPEN','UPDATE','CLOSE','REOPEN','REJECT') NOT NULL,
  event_date DATETIME NOT NULL,
  status_after VARCHAR(40) NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_claim_events_sinistre (sinistre_id, event_date),
  KEY idx_claim_events_ligne (sinistre_ligne_id, event_date),
  CONSTRAINT fk_claim_events_sinistre
    FOREIGN KEY (sinistre_id) REFERENCES sinistres(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_claim_events_sinistre_ligne
    FOREIGN KEY (sinistre_ligne_id) REFERENCES sinistre_lignes(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cat_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  event_code VARCHAR(60) NOT NULL,
  event_date DATE NOT NULL,
  event_type ENUM('FLOOD','WIND','HAIL','FIRE','EARTHQUAKE','OTHER') NOT NULL DEFAULT 'OTHER',
  geo_scope_json JSON NULL,
  severity_index DECIMAL(10,4) NULL,
  loss_multiplier DECIMAL(10,4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_cat_event_run_code (run_id, event_code),
  KEY idx_cat_event_scenario_date (scenario_id, event_date),
  CONSTRAINT fk_cat_event_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cat_event_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS claim_reserve_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  sinistre_id INT NOT NULL,
  sinistre_ligne_id INT NULL,
  snapshot_date DATE NOT NULL,
  rbns_gross DECIMAL(18,2) NOT NULL DEFAULT 0,
  ibnr_gross DECIMAL(18,2) NOT NULL DEFAULT 0,
  expense_reserve_gross DECIMAL(18,2) NOT NULL DEFAULT 0,
  rbns_net DECIMAL(18,2) NULL,
  ibnr_net DECIMAL(18,2) NULL,
  case_outstanding_gross DECIMAL(18,2) NULL,
  paid_to_date_gross DECIMAL(18,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_claim_res_snap_run_date (run_id, snapshot_date),
  KEY idx_claim_res_snap_sinistre (sinistre_id, snapshot_date),
  KEY idx_claim_res_snap_ligne (sinistre_ligne_id, snapshot_date),
  UNIQUE KEY ux_claim_res_snap_line_date (sinistre_ligne_id, snapshot_date),
  CONSTRAINT fk_claim_res_snap_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_claim_res_snap_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_claim_res_snap_sinistre
    FOREIGN KEY (sinistre_id) REFERENCES sinistres(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_claim_res_snap_ligne
    FOREIGN KEY (sinistre_ligne_id) REFERENCES sinistre_lignes(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS claim_development_factors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  basis ENUM('REPORTING','PAYMENT','INCURRED') NOT NULL,
  development_period INT NOT NULL,
  factor_value DECIMAL(12,6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_claim_dev_factor (scenario_id, id_branch, basis, development_period),
  CONSTRAINT fk_claim_dev_factor_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_claim_dev_factor_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 5) Reinsurance (treaties and cessions)
-- =========================================================

CREATE TABLE IF NOT EXISTS reinsurance_treaties (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NULL,
  captive_id INT NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(190) NOT NULL,
  treaty_type ENUM('QUOTA_SHARE','XOL','STOP_LOSS','FRONTING') NOT NULL,
  counterparty_insurer_id INT NULL,
  inception_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  status ENUM('draft','active','expired','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_re_treaty_scenario_code (scenario_id, code),
  KEY idx_re_treaty_captive (captive_id),
  KEY idx_re_treaty_run (run_id),
  CONSTRAINT fk_re_treaty_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_treaty_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_re_treaty_captive
    FOREIGN KEY (captive_id) REFERENCES captives(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_treaty_counterparty
    FOREIGN KEY (counterparty_insurer_id) REFERENCES insurers(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reinsurance_treaty_scopes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  treaty_id BIGINT UNSIGNED NOT NULL,
  id_branch BIGINT(20) UNSIGNED NULL,
  programme_id INT NULL,
  priority_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_re_scope_treaty (treaty_id),
  KEY idx_re_scope_branch (id_branch),
  KEY idx_re_scope_programme (programme_id),
  CONSTRAINT fk_re_scope_treaty
    FOREIGN KEY (treaty_id) REFERENCES reinsurance_treaties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_scope_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_re_scope_programme
    FOREIGN KEY (programme_id) REFERENCES programmes(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reinsurance_treaty_terms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  treaty_id BIGINT UNSIGNED NOT NULL,
  term_type ENUM('CESSION_RATE','RETENTION','LIMIT','ATTACHMENT','AAL','AGG_LIMIT','REINSTATEMENT') NOT NULL,
  value_numeric DECIMAL(18,6) NULL,
  value_json JSON NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_re_terms_treaty_type (treaty_id, term_type),
  CONSTRAINT fk_re_terms_treaty
    FOREIGN KEY (treaty_id) REFERENCES reinsurance_treaties(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reinsurance_premium_cessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  treaty_id BIGINT UNSIGNED NOT NULL,
  premium_transaction_id BIGINT UNSIGNED NOT NULL,
  amount_ceded DECIMAL(18,2) NOT NULL,
  commission_reinsurance DECIMAL(18,2) NULL,
  net_cost DECIMAL(18,2) NULL,
  accounting_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_re_prem_cess_run_date (run_id, accounting_date),
  KEY idx_re_prem_cess_treaty (treaty_id),
  KEY idx_re_prem_cess_ptx (premium_transaction_id),
  CONSTRAINT fk_re_prem_cess_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_prem_cess_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_prem_cess_treaty
    FOREIGN KEY (treaty_id) REFERENCES reinsurance_treaties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_prem_cess_ptx
    FOREIGN KEY (premium_transaction_id) REFERENCES premium_transactions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reinsurance_claim_cessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  treaty_id BIGINT UNSIGNED NOT NULL,
  sinistre_id INT NOT NULL,
  sinistre_ligne_id INT NULL,
  event_date DATE NOT NULL,
  cession_type ENUM('PAID','RESERVE','RECOVERY') NOT NULL,
  amount_ceded DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_re_claim_cess_run_date (run_id, event_date),
  KEY idx_re_claim_cess_treaty (treaty_id),
  KEY idx_re_claim_cess_sinistre (sinistre_id),
  CONSTRAINT fk_re_claim_cess_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_claim_cess_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_claim_cess_treaty
    FOREIGN KEY (treaty_id) REFERENCES reinsurance_treaties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_claim_cess_sinistre
    FOREIGN KEY (sinistre_id) REFERENCES sinistres(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_claim_cess_sinistre_ligne
    FOREIGN KEY (sinistre_ligne_id) REFERENCES sinistre_lignes(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 6) Portfolio / concentration / Solvency II snapshots
-- =========================================================

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  captive_id INT NOT NULL,
  gwp_total DECIMAL(18,2) NULL,
  earned_premium_total DECIMAL(18,2) NULL,
  claims_paid_total DECIMAL(18,2) NULL,
  claims_incurred_total DECIMAL(18,2) NULL,
  rbns_total DECIMAL(18,2) NULL,
  ibnr_total DECIMAL(18,2) NULL,
  net_result_technical DECIMAL(18,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_portfolio_snap_run_date (run_id, snapshot_date),
  KEY idx_portfolio_snap_scenario_date (scenario_id, snapshot_date),
  CONSTRAINT fk_portfolio_snap_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_portfolio_snap_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_portfolio_snap_captive
    FOREIGN KEY (captive_id) REFERENCES captives(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portfolio_branch_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  contracts_count INT NULL,
  clients_count INT NULL,
  gwp_gross DECIMAL(18,2) NULL,
  gwp_net DECIMAL(18,2) NULL,
  earned_gross DECIMAL(18,2) NULL,
  earned_net DECIMAL(18,2) NULL,
  paid_gross DECIMAL(18,2) NULL,
  paid_net DECIMAL(18,2) NULL,
  incurred_gross DECIMAL(18,2) NULL,
  incurred_net DECIMAL(18,2) NULL,
  rbns_gross DECIMAL(18,2) NULL,
  ibnr_gross DECIMAL(18,2) NULL,
  cat_loss_gross DECIMAL(18,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_portfolio_branch_snap (run_id, snapshot_date, id_branch),
  KEY idx_portfolio_branch_snap_scenario (scenario_id, id_branch, snapshot_date),
  CONSTRAINT fk_portfolio_branch_snap_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_portfolio_branch_snap_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_portfolio_branch_snap_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS broker_concentration_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  partner_id INT NOT NULL,
  rank_by_gwp INT NULL,
  gwp_amount DECIMAL(18,2) NULL,
  gwp_share_pct DECIMAL(9,6) NULL,
  contracts_count INT NULL,
  clients_count INT NULL,
  hhi_contribution DECIMAL(18,8) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_broker_conc_snap (run_id, snapshot_date, partner_id),
  KEY idx_broker_conc_rank (run_id, snapshot_date, rank_by_gwp),
  CONSTRAINT fk_broker_conc_snap_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_broker_conc_snap_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_broker_conc_snap_partner
    FOREIGN KEY (partner_id) REFERENCES partners(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS s2_scr_inputs_non_life (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  id_branch BIGINT(20) UNSIGNED NOT NULL,
  premium_volume DECIMAL(18,2) NULL,
  reserve_volume DECIMAL(18,2) NULL,
  cat_exposure DECIMAL(18,2) NULL,
  counterparty_exposure DECIMAL(18,2) NULL,
  sigma_premium DECIMAL(10,6) NULL,
  sigma_reserve DECIMAL(10,6) NULL,
  corr_group_code VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_s2_inputs_run_date_branch (run_id, snapshot_date, id_branch),
  KEY idx_s2_inputs_scenario_date (scenario_id, snapshot_date),
  CONSTRAINT fk_s2_inputs_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_s2_inputs_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_s2_inputs_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS s2_scr_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  scr_non_life DECIMAL(18,2) NULL,
  scr_counterparty DECIMAL(18,2) NULL,
  scr_market DECIMAL(18,2) NULL,
  scr_operational DECIMAL(18,2) NULL,
  scr_bscr DECIMAL(18,2) NULL,
  scr_total DECIMAL(18,2) NULL,
  mcr DECIMAL(18,2) NULL,
  own_funds_eligible DECIMAL(18,2) NULL,
  solvency_ratio_pct DECIMAL(10,4) NULL,
  methodology_version VARCHAR(40) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_s2_results_run_date (run_id, snapshot_date),
  KEY idx_s2_results_scenario_date (scenario_id, snapshot_date),
  CONSTRAINT fk_s2_results_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_s2_results_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

