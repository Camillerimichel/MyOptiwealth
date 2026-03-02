-- V3 ALM Data Foundation
-- Socle pour inventaire d'actifs, flux quotidiens (actifs/passifs) et snapshots ALM journaliers

CREATE TABLE IF NOT EXISTS alm_v3_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  captive_id INT NOT NULL,
  scenario_id INT NULL,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  is_default TINYINT(1) NOT NULL DEFAULT 1,
  base_currency CHAR(3) NOT NULL DEFAULT 'EUR',
  valuation_timezone VARCHAR(60) NOT NULL DEFAULT 'Europe/Paris',
  methodology_version VARCHAR(60) NOT NULL DEFAULT 'alm-v3-foundation',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_profiles_captive_code (captive_id, code),
  KEY idx_alm_v3_profiles_captive_default (captive_id, is_default),
  CONSTRAINT fk_alm_v3_profiles_captive
    FOREIGN KEY (captive_id) REFERENCES captives(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_profiles_scenario
    FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_strata (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  strata_code VARCHAR(40) NOT NULL,
  label VARCHAR(160) NOT NULL,
  purpose VARCHAR(120) NULL,
  display_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_strata_profile_code (profile_id, strata_code),
  KEY idx_alm_v3_strata_profile_order (profile_id, display_order),
  CONSTRAINT fk_alm_v3_strata_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_asset_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  asset_code VARCHAR(40) NOT NULL,
  label VARCHAR(160) NOT NULL,
  parent_asset_code VARCHAR(40) NULL,
  asset_family VARCHAR(60) NULL,
  default_duration_years DECIMAL(10,4) NULL,
  default_liquidity_days INT NULL,
  default_volatility_pct DECIMAL(9,4) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_asset_classes_profile_code (profile_id, asset_code),
  KEY idx_alm_v3_asset_classes_profile_order (profile_id, display_order),
  CONSTRAINT fk_alm_v3_asset_classes_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_duration_buckets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  bucket_code VARCHAR(30) NOT NULL,
  label VARCHAR(120) NOT NULL,
  min_years DECIMAL(10,4) NOT NULL DEFAULT 0,
  max_years DECIMAL(10,4) NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_dur_bucket_profile_code (profile_id, bucket_code),
  KEY idx_alm_v3_dur_bucket_profile_order (profile_id, display_order),
  CONSTRAINT fk_alm_v3_dur_bucket_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_counterparties (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  counterparty_type ENUM('issuer','bank','custodian','broker','fund_manager','reinsurer','fronting_insurer','other') NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(255) NOT NULL,
  country_code CHAR(2) NULL,
  rating_agency VARCHAR(20) NULL,
  rating_value VARCHAR(20) NULL,
  internal_rating VARCHAR(20) NULL,
  group_name VARCHAR(160) NULL,
  lei VARCHAR(30) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_counterparty_profile_code (profile_id, code),
  KEY idx_alm_v3_counterparty_type (profile_id, counterparty_type),
  CONSTRAINT fk_alm_v3_counterparty_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_instruments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  instrument_code VARCHAR(100) NOT NULL,
  instrument_name VARCHAR(255) NOT NULL,
  instrument_type ENUM('cash','term_deposit','bond_fixed','bond_floating','fund','equity','repo','money_market_fund','other') NOT NULL,
  asset_class_id BIGINT UNSIGNED NOT NULL,
  issuer_counterparty_id BIGINT UNSIGNED NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  isin VARCHAR(20) NULL,
  ticker VARCHAR(32) NULL,
  issue_date DATE NULL,
  maturity_date DATE NULL,
  coupon_rate_pct DECIMAL(9,6) NULL,
  coupon_frequency VARCHAR(20) NULL,
  day_count_convention VARCHAR(30) NULL,
  callable_flag TINYINT(1) NOT NULL DEFAULT 0,
  inflation_linked_flag TINYINT(1) NOT NULL DEFAULT 0,
  default_duration_years DECIMAL(10,4) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_instr_profile_code (profile_id, instrument_code),
  KEY idx_alm_v3_instr_profile_type (profile_id, instrument_type),
  KEY idx_alm_v3_instr_maturity (maturity_date),
  CONSTRAINT fk_alm_v3_instr_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_instr_asset_class
    FOREIGN KEY (asset_class_id) REFERENCES alm_v3_asset_classes(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_instr_issuer
    FOREIGN KEY (issuer_counterparty_id) REFERENCES alm_v3_counterparties(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_cash_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  strata_id BIGINT UNSIGNED NULL,
  account_code VARCHAR(80) NOT NULL,
  label VARCHAR(180) NOT NULL,
  iban_masked VARCHAR(64) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  bank_counterparty_id BIGINT UNSIGNED NULL,
  account_type ENUM('operating','claims','collateral','investment','tax','fronting','reinsurance','other') NOT NULL DEFAULT 'operating',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_cash_account_profile_code (profile_id, account_code),
  KEY idx_alm_v3_cash_account_strata (strata_id),
  CONSTRAINT fk_alm_v3_cash_account_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_cash_account_strata
    FOREIGN KEY (strata_id) REFERENCES alm_v3_strata(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_cash_account_bank
    FOREIGN KEY (bank_counterparty_id) REFERENCES alm_v3_counterparties(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  strata_id BIGINT UNSIGNED NULL,
  instrument_id BIGINT UNSIGNED NOT NULL,
  portfolio_code VARCHAR(80) NULL,
  position_status ENUM('active','closed','suspended') NOT NULL DEFAULT 'active',
  opened_on DATE NOT NULL,
  closed_on DATE NULL,
  accounting_classification VARCHAR(40) NULL,
  book_currency CHAR(3) NOT NULL DEFAULT 'EUR',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_alm_v3_positions_profile_status (profile_id, position_status),
  KEY idx_alm_v3_positions_instr (instrument_id),
  KEY idx_alm_v3_positions_strata (strata_id),
  CONSTRAINT fk_alm_v3_positions_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_positions_strata
    FOREIGN KEY (strata_id) REFERENCES alm_v3_strata(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_positions_instr
    FOREIGN KEY (instrument_id) REFERENCES alm_v3_instruments(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_position_lots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  position_id BIGINT UNSIGNED NOT NULL,
  lot_code VARCHAR(80) NULL,
  trade_date DATE NOT NULL,
  settlement_date DATE NULL,
  quantity DECIMAL(20,8) NOT NULL DEFAULT 0,
  nominal_amount DECIMAL(20,2) NULL,
  unit_cost DECIMAL(20,8) NULL,
  accrued_interest_at_purchase DECIMAL(20,2) NULL,
  transaction_cost_amount DECIMAL(20,2) NULL,
  transaction_currency CHAR(3) NOT NULL DEFAULT 'EUR',
  source_system VARCHAR(60) NULL,
  source_ref VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_alm_v3_lots_position (position_id),
  KEY idx_alm_v3_lots_trade_date (trade_date),
  CONSTRAINT fk_alm_v3_lots_position
    FOREIGN KEY (position_id) REFERENCES alm_v3_positions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_position_valuations_daily (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  valuation_timestamp DATETIME NOT NULL,
  quantity_eod DECIMAL(20,8) NOT NULL DEFAULT 0,
  dirty_price_pct DECIMAL(12,6) NULL,
  clean_price_pct DECIMAL(12,6) NULL,
  market_value_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  book_value_amount DECIMAL(20,2) NULL,
  accrued_interest_amount DECIMAL(20,2) NULL,
  unrealized_pnl_amount DECIMAL(20,2) NULL,
  fx_rate_to_base DECIMAL(18,8) NULL,
  modified_duration_years DECIMAL(12,6) NULL,
  macaulay_duration_years DECIMAL(12,6) NULL,
  convexity DECIMAL(16,8) NULL,
  ytm_pct DECIMAL(12,6) NULL,
  stress_haircut_pct DECIMAL(9,4) NULL,
  source_system VARCHAR(60) NULL,
  source_ref VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_val_position_date (position_id, business_date),
  KEY idx_alm_v3_val_profile_date (profile_id, business_date),
  KEY idx_alm_v3_val_timestamp (valuation_timestamp),
  CONSTRAINT fk_alm_v3_val_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_val_position
    FOREIGN KEY (position_id) REFERENCES alm_v3_positions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_asset_cashflows (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NULL,
  instrument_id BIGINT UNSIGNED NULL,
  cash_account_id BIGINT UNSIGNED NULL,
  business_date DATE NOT NULL,
  event_timestamp DATETIME NOT NULL,
  settlement_date DATE NULL,
  flow_type ENUM('purchase','sale','coupon','dividend','redemption','repo_interest','management_fee','custody_fee','tax','collateral_in','collateral_out','fx','other') NOT NULL,
  direction ENUM('in','out') NOT NULL,
  amount_amount DECIMAL(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  amount_base_ccy DECIMAL(20,2) NULL,
  fx_rate_to_base DECIMAL(18,8) NULL,
  quantity_impact DECIMAL(20,8) NULL,
  source_system VARCHAR(60) NULL,
  source_ref VARCHAR(120) NULL,
  booking_ref VARCHAR(120) NULL,
  comment_text VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alm_v3_asset_cf_profile_date (profile_id, business_date),
  KEY idx_alm_v3_asset_cf_position (position_id, business_date),
  KEY idx_alm_v3_asset_cf_type (flow_type, business_date),
  KEY idx_alm_v3_asset_cf_ts (event_timestamp),
  CONSTRAINT fk_alm_v3_asset_cf_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_asset_cf_position
    FOREIGN KEY (position_id) REFERENCES alm_v3_positions(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_asset_cf_instr
    FOREIGN KEY (instrument_id) REFERENCES alm_v3_instruments(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_asset_cf_cash_account
    FOREIGN KEY (cash_account_id) REFERENCES alm_v3_cash_accounts(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_cash_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  event_timestamp DATETIME NOT NULL,
  movement_type ENUM('premium_in','claim_out','reinsurance_in','reinsurance_out','fronting_fee_out','commission_out','tax_out','opex_out','capital_call_in','dividend_out','asset_transfer_in','asset_transfer_out','investment_in','investment_out','other') NOT NULL,
  direction ENUM('in','out') NOT NULL,
  amount_amount DECIMAL(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  amount_base_ccy DECIMAL(20,2) NULL,
  fx_rate_to_base DECIMAL(18,8) NULL,
  counterparty_id BIGINT UNSIGNED NULL,
  source_entity VARCHAR(60) NULL,
  source_entity_id BIGINT NULL,
  source_ref VARCHAR(120) NULL,
  comment_text VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alm_v3_cash_mv_profile_date (profile_id, business_date),
  KEY idx_alm_v3_cash_mv_account_date (cash_account_id, business_date),
  KEY idx_alm_v3_cash_mv_type (movement_type, business_date),
  KEY idx_alm_v3_cash_mv_ts (event_timestamp),
  CONSTRAINT fk_alm_v3_cash_mv_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_cash_mv_account
    FOREIGN KEY (cash_account_id) REFERENCES alm_v3_cash_accounts(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_cash_mv_counterparty
    FOREIGN KEY (counterparty_id) REFERENCES alm_v3_counterparties(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_cash_balances_daily (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  opening_balance_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  inflows_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  outflows_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  closing_balance_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  closing_balance_base_ccy DECIMAL(20,2) NULL,
  fx_rate_to_base DECIMAL(18,8) NULL,
  snapshot_timestamp DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_cash_bal_day (cash_account_id, business_date),
  KEY idx_alm_v3_cash_bal_profile_date (profile_id, business_date),
  CONSTRAINT fk_alm_v3_cash_bal_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_cash_bal_account
    FOREIGN KEY (cash_account_id) REFERENCES alm_v3_cash_accounts(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_liability_cashflows_daily (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  event_timestamp DATETIME NOT NULL,
  cashflow_type ENUM('premium_in','premium_refund_out','claim_paid_out','claim_recovery_in','reinsurance_premium_out','reinsurance_recovery_in','fronting_fee_out','claims_handling_fee_out','broker_commission_out','tax_out','opex_out','capital_in','dividend_out','other') NOT NULL,
  direction ENUM('in','out') NOT NULL,
  amount_amount DECIMAL(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  amount_base_ccy DECIMAL(20,2) NULL,
  fx_rate_to_base DECIMAL(18,8) NULL,
  id_branch BIGINT(20) UNSIGNED NULL,
  programme_id INT NULL,
  contract_id INT NULL,
  partner_id INT NULL,
  client_id INT NULL,
  sinistre_id INT NULL,
  sinistre_ligne_id INT NULL,
  reglement_id INT NULL,
  treaty_id BIGINT UNSIGNED NULL,
  source_table VARCHAR(60) NULL,
  source_pk BIGINT NULL,
  source_ref VARCHAR(120) NULL,
  comment_text VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alm_v3_liab_cf_profile_date (profile_id, business_date),
  KEY idx_alm_v3_liab_cf_type (cashflow_type, business_date),
  KEY idx_alm_v3_liab_cf_branch (id_branch, business_date),
  KEY idx_alm_v3_liab_cf_contract (contract_id, business_date),
  KEY idx_alm_v3_liab_cf_sinistre (sinistre_id, business_date),
  KEY idx_alm_v3_liab_cf_ts (event_timestamp),
  CONSTRAINT fk_alm_v3_liab_cf_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_branch
    FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_programme
    FOREIGN KEY (programme_id) REFERENCES programmes(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_partner
    FOREIGN KEY (partner_id) REFERENCES partners(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_sinistre
    FOREIGN KEY (sinistre_id) REFERENCES sinistres(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_sin_ligne
    FOREIGN KEY (sinistre_ligne_id) REFERENCES sinistre_lignes(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_reglement
    FOREIGN KEY (reglement_id) REFERENCES reglements(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_liab_cf_treaty
    FOREIGN KEY (treaty_id) REFERENCES reinsurance_treaties(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_orsa_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  orsa_set_id BIGINT UNSIGNED NOT NULL,
  link_role ENUM('base','scenario_source','comparison') NOT NULL DEFAULT 'comparison',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_orsa_link (profile_id, orsa_set_id, link_role),
  KEY idx_alm_v3_orsa_link_profile (profile_id, active),
  CONSTRAINT fk_alm_v3_orsa_link_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_orsa_link_set
    FOREIGN KEY (orsa_set_id) REFERENCES orsa_run_sets(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT UNSIGNED NOT NULL,
  orsa_set_id BIGINT UNSIGNED NULL,
  run_code VARCHAR(100) NOT NULL,
  run_label VARCHAR(255) NULL,
  run_type ENUM('daily_snapshot','backfill','projection','stress') NOT NULL DEFAULT 'daily_snapshot',
  status ENUM('draft','running','completed','failed') NOT NULL DEFAULT 'draft',
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  as_of_timestamp DATETIME NOT NULL,
  scenario_json JSON NULL,
  methodology_version VARCHAR(60) NOT NULL DEFAULT 'alm-v3-foundation',
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_runs_profile_code (profile_id, run_code),
  KEY idx_alm_v3_runs_profile_dates (profile_id, date_from, date_to),
  KEY idx_alm_v3_runs_orsa (orsa_set_id),
  CONSTRAINT fk_alm_v3_runs_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_runs_orsa
    FOREIGN KEY (orsa_set_id) REFERENCES orsa_run_sets(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_daily_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  snapshot_timestamp DATETIME NOT NULL,
  total_assets_mv DECIMAL(20,2) NOT NULL DEFAULT 0,
  total_assets_bv DECIMAL(20,2) NULL,
  total_cash_base_ccy DECIMAL(20,2) NOT NULL DEFAULT 0,
  total_liability_inflows DECIMAL(20,2) NOT NULL DEFAULT 0,
  total_liability_outflows DECIMAL(20,2) NOT NULL DEFAULT 0,
  net_liability_cashflow DECIMAL(20,2) NOT NULL DEFAULT 0,
  liquidity_buffer_available DECIMAL(20,2) NULL,
  liquidity_need_1d DECIMAL(20,2) NULL,
  liquidity_need_7d DECIMAL(20,2) NULL,
  liquidity_need_30d DECIMAL(20,2) NULL,
  duration_assets_weighted DECIMAL(12,6) NULL,
  duration_liabilities_proxy DECIMAL(12,6) NULL,
  duration_gap DECIMAL(12,6) NULL,
  own_funds_proxy DECIMAL(20,2) NULL,
  stress_peak_scr_ref DECIMAL(20,2) NULL,
  comments_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_snap_run_date (run_id, business_date),
  KEY idx_alm_v3_snap_profile_date (profile_id, business_date),
  CONSTRAINT fk_alm_v3_snap_run
    FOREIGN KEY (run_id) REFERENCES alm_v3_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_snap_profile
    FOREIGN KEY (profile_id) REFERENCES alm_v3_profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_daily_strata_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  strata_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  assets_mv DECIMAL(20,2) NOT NULL DEFAULT 0,
  cash_balance DECIMAL(20,2) NOT NULL DEFAULT 0,
  inflows_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  outflows_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  net_cashflow_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  duration_assets_weighted DECIMAL(12,6) NULL,
  liquidity_buffer DECIMAL(20,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_snap_strata (snapshot_id, strata_id),
  KEY idx_alm_v3_snap_strata_date (strata_id, business_date),
  CONSTRAINT fk_alm_v3_snap_strata_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES alm_v3_daily_snapshots(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_snap_strata_strata
    FOREIGN KEY (strata_id) REFERENCES alm_v3_strata(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_daily_asset_class_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  asset_class_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  market_value_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  book_value_amount DECIMAL(20,2) NULL,
  share_of_assets_pct DECIMAL(9,4) NULL,
  duration_weighted_years DECIMAL(12,6) NULL,
  liquidity_horizon_days_weighted DECIMAL(12,4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_snap_asset_class (snapshot_id, asset_class_id),
  KEY idx_alm_v3_snap_asset_class_date (asset_class_id, business_date),
  CONSTRAINT fk_alm_v3_snap_asset_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES alm_v3_daily_snapshots(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_snap_asset_class
    FOREIGN KEY (asset_class_id) REFERENCES alm_v3_asset_classes(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_daily_duration_ladder (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  duration_bucket_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  assets_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  liability_outflows_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  net_gap_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  cumulative_gap_amount DECIMAL(20,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_duration_ladder (snapshot_id, duration_bucket_id),
  KEY idx_alm_v3_duration_ladder_date (duration_bucket_id, business_date),
  CONSTRAINT fk_alm_v3_duration_ladder_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES alm_v3_daily_snapshots(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_alm_v3_duration_ladder_bucket
    FOREIGN KEY (duration_bucket_id) REFERENCES alm_v3_duration_buckets(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_daily_liquidity_ladder (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  horizon_code VARCHAR(20) NOT NULL,
  horizon_days INT NOT NULL,
  liquidity_sources_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  liquidity_uses_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  net_liquidity_gap_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
  cumulative_liquidity_gap_amount DECIMAL(20,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_alm_v3_liq_ladder (snapshot_id, horizon_code),
  CONSTRAINT fk_alm_v3_liq_ladder_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES alm_v3_daily_snapshots(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alm_v3_run_checks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NULL,
  check_code VARCHAR(80) NOT NULL,
  severity ENUM('info','warning','error') NOT NULL DEFAULT 'info',
  status ENUM('pass','fail','warn') NOT NULL DEFAULT 'pass',
  metric_value DECIMAL(20,6) NULL,
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alm_v3_checks_run (run_id, created_at),
  KEY idx_alm_v3_checks_code (check_code, status),
  CONSTRAINT fk_alm_v3_checks_run
    FOREIGN KEY (run_id) REFERENCES alm_v3_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
