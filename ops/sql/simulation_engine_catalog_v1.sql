SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS simulation_engine_catalog (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  engine_family VARCHAR(40) NOT NULL,
  engine_code VARCHAR(120) NOT NULL,
  engine_version VARCHAR(120) NOT NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  methodology_scope TEXT NULL,
  limitations TEXT NULL,
  script_name VARCHAR(255) NULL,
  repo_path VARCHAR(255) NULL,
  status ENUM('active','deprecated') NOT NULL DEFAULT 'active',
  modules_json JSON NULL,
  parameters_schema_json JSON NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_sim_engine_catalog_code_ver (engine_code, engine_version),
  KEY idx_sim_engine_catalog_family (engine_family),
  KEY idx_sim_engine_catalog_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulation_run_engine_details (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  engine_catalog_id BIGINT UNSIGNED NULL,
  engine_family VARCHAR(40) NOT NULL,
  engine_code VARCHAR(120) NOT NULL,
  engine_version VARCHAR(120) NOT NULL,
  engine_title VARCHAR(190) NULL,
  engine_config_json JSON NULL,
  modules_json JSON NULL,
  data_dependencies_json JSON NULL,
  warnings_json JSON NULL,
  execution_stats_json JSON NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_sim_run_engine_details_run (run_id),
  KEY idx_sim_run_engine_details_catalog (engine_catalog_id),
  KEY idx_sim_run_engine_details_family (engine_family),
  CONSTRAINT fk_sim_run_engine_details_run
    FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sim_run_engine_details_catalog
    FOREIGN KEY (engine_catalog_id) REFERENCES simulation_engine_catalog(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
