import pool from "./pool.js";
import bcrypt from "bcryptjs";

async function ensureColumn(table, column, ddl) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!row || row.cnt === 0) {
    await pool.query(ddl);
  }
}

async function indexExists(table, indexName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Boolean(row?.cnt);
}

async function ensureIndex(table, indexName, ddl) {
  if (!(await indexExists(table, indexName))) {
    await pool.query(ddl);
  }
}

async function dropIndexIfExists(table, indexName) {
  if (await indexExists(table, indexName)) {
    await pool.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
  }
}

async function foreignKeyExists(table, constraintName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [table, constraintName]
  );
  return Boolean(row?.cnt);
}

async function ensureForeignKey(table, constraintName, ddl) {
  if (!(await foreignKeyExists(table, constraintName))) {
    await pool.query(ddl);
  }
}

async function rebuildRolesTables() {
  // Migration idempotente: ne jamais détruire les attributions existantes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users_roles (
      user_id INT NOT NULL,
      role_id INT NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      status ENUM('active','disabled') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await rebuildRolesTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS captives (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(190) NOT NULL,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_captive_memberships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      captive_id INT NOT NULL,
      role ENUM('owner','intervenant','manager','viewer') NOT NULL DEFAULT 'intervenant',
      is_owner TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      date_debut DATE DEFAULT NULL,
      date_fin DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_user_captive (user_id, captive_id),
      INDEX idx_ucm_captive (captive_id, status),
      INDEX idx_ucm_owner (captive_id, is_owner, status),
      CONSTRAINT fk_ucm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ucm_captive FOREIGN KEY (captive_id) REFERENCES captives(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programmes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NULL,
      ligne_risque VARCHAR(190) NOT NULL,
      statut ENUM('actif','suspendu','clos') DEFAULT 'actif',
      montant_garanti DECIMAL(14,2) DEFAULT 0,
      franchise DECIMAL(14,2) DEFAULT 0,
      devise CHAR(3) DEFAULT 'EUR',
      description TEXT NULL,
      date_debut DATE NULL,
      date_fin DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_layers (
      id_layer INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      layer_type ENUM('PRIMARY','EXCESS','QUOTA') NOT NULL,
      attachment_point DECIMAL(15,2) DEFAULT NULL,
      limit_amount DECIMAL(15,2) DEFAULT NULL,
      currency CHAR(3) DEFAULT 'EUR',
      effective_from DATE NULL,
      effective_to DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_layers_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_coverages (
      id_coverage INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      label VARCHAR(120) NOT NULL,
      coverage_type ENUM('PROPERTY','LIABILITY','MOTOR','OTHER') NOT NULL,
      limit_per_claim DECIMAL(15,2) DEFAULT NULL,
      limit_annual DECIMAL(15,2) DEFAULT NULL,
      currency CHAR(3) DEFAULT 'EUR',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_coverages_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_pricing (
      id_pricing INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      coverage_id INT NULL,
      pricing_method ENUM('FIXED_PREMIUM','RATE_ON_LIMIT','RATE_ON_TURNOVER','RATE_ON_PAYROLL','CUSTOM') NOT NULL DEFAULT 'FIXED_PREMIUM',
      premium_amount DECIMAL(15,2) DEFAULT NULL,
      rate_value DECIMAL(9,4) DEFAULT NULL,
      minimum_premium DECIMAL(15,2) DEFAULT NULL,
      currency CHAR(3) DEFAULT 'EUR',
      effective_from DATE DEFAULT NULL,
      effective_to DATE DEFAULT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_pricing_programme (programme_id),
      INDEX idx_programme_pricing_coverage (coverage_id),
      INDEX idx_programme_pricing_method (pricing_method),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE,
      FOREIGN KEY (coverage_id) REFERENCES programme_coverages(id_coverage) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_deductibles (
      id_deductible INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      coverage_id INT NULL,
      amount DECIMAL(15,2) DEFAULT NULL,
      unit ENUM('FIXED','PERCENTAGE') NOT NULL DEFAULT 'FIXED',
      currency CHAR(3) DEFAULT 'EUR',
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_deductibles_programme (programme_id),
      INDEX idx_programme_deductibles_coverage (coverage_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE,
      FOREIGN KEY (coverage_id) REFERENCES programme_coverages(id_coverage) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_exclusions (
      id_exclusion INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      category VARCHAR(120) DEFAULT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_exclusions_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_conditions (
      id_condition INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      title VARCHAR(120) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_conditions_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_carriers (
      id_carrier INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      carrier_name VARCHAR(160) NOT NULL,
      role ENUM('LEAD','CO_INSURER','FRONTING') NOT NULL,
      share_pct DECIMAL(5,2) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_carriers_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_insurers (
      id_insurer INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      insurer_name VARCHAR(160) NOT NULL,
      insurer_type ENUM('FRONTING','REINSURANCE') NOT NULL,
      share_pct DECIMAL(5,2) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_insurers_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_documents (
      id_document INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      doc_type ENUM('POLICY','ANNEX','CERTIFICATE','OTHER') NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(512) DEFAULT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_documents_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_versions (
      id_version INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      version_label VARCHAR(30) NOT NULL,
      changed_by VARCHAR(80) DEFAULT NULL,
      change_notes TEXT DEFAULT NULL,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_programme_versions_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sinistres (
      id INT AUTO_INCREMENT PRIMARY KEY,
      programme_id INT NOT NULL,
      date_survenue DATE NULL,
      date_decl DATE NULL,
      statut ENUM('ouvert','en_cours','clos','rejete') DEFAULT 'ouvert',
      montant_estime DECIMAL(14,2) DEFAULT 0,
      montant_paye DECIMAL(14,2) DEFAULT 0,
      devise CHAR(3) DEFAULT 'EUR',
      description TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_sinistre_programme (programme_id),
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sinistre_lignes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sinistre_id INT NOT NULL,
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      statut ENUM('ouvert','en_cours','clos','rejete') DEFAULT 'ouvert',
      montant_estime DECIMAL(14,2) DEFAULT 0,
      montant_paye DECIMAL(14,2) DEFAULT 0,
      montant_recours DECIMAL(14,2) DEFAULT 0,
      montant_franchise DECIMAL(14,2) DEFAULT 0,
      description TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_sinistre_lignes_sinistre_branch (sinistre_id, id_branch),
      INDEX idx_sinistre_lignes_sinistre (sinistre_id),
      INDEX idx_sinistre_lignes_branch (id_branch),
      FOREIGN KEY (sinistre_id) REFERENCES sinistres(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reglements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sinistre_id INT NOT NULL,
      sinistre_ligne_id INT NULL,
      date DATE NULL,
      montant DECIMAL(14,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reglement_sinistre (sinistre_id),
      INDEX idx_reglement_sinistre_ligne (sinistre_ligne_id),
      CONSTRAINT fk_reglement_sinistre_ligne
        FOREIGN KEY (sinistre_ligne_id) REFERENCES sinistre_lignes(id)
        ON DELETE SET NULL,
      FOREIGN KEY (sinistre_id) REFERENCES sinistres(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      entity VARCHAR(64) NOT NULL,
      entity_id INT NULL,
      action VARCHAR(64) NOT NULL,
      payload JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_created_at (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NULL,
      exercise INT NULL,
      report_type VARCHAR(100) NOT NULL,
      format ENUM('pdf','xlsx','csv','json') NOT NULL,
      template_id INT NULL,
      definition_override JSON NULL,
      status ENUM('queued','running','done','failed','canceled') DEFAULT 'queued',
      file_path VARCHAR(512) NULL,
      tz_name VARCHAR(64) NULL,
      created_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_report_jobs_status (status)
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT NULL,
      definition JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_facts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      source ENUM('real','simulation') NOT NULL,
      snapshot_date DATE NOT NULL,
      template_code VARCHAR(20) NOT NULL,
      concept_code VARCHAR(120) NOT NULL,
      dimensions_json JSON NULL,
      value_decimal DECIMAL(22,6) NOT NULL,
      unit_code VARCHAR(12) NOT NULL DEFAULT 'EUR',
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      origin_table VARCHAR(80) NULL,
      origin_row_ref VARCHAR(80) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY ux_qrt_fact (captive_id, source, snapshot_date, template_code, concept_code),
      KEY idx_qrt_snapshot (captive_id, snapshot_date, source),
      KEY idx_qrt_template (template_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_exports (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      source ENUM('real','simulation') NOT NULL,
      snapshot_date DATE NOT NULL,
      workflow_request_key VARCHAR(128) NULL,
      taxonomy_version VARCHAR(32) NOT NULL DEFAULT '2.8.0',
      jurisdiction CHAR(2) NOT NULL DEFAULT 'MT',
      file_path VARCHAR(512) NOT NULL,
      xml_sha256 CHAR(64) NULL,
      bundle_sha256 CHAR(64) NULL,
      facts_count INT NOT NULL DEFAULT 0,
      status ENUM('draft','published') NOT NULL DEFAULT 'draft',
      is_locked TINYINT(1) NOT NULL DEFAULT 0,
      locked_at DATETIME NULL,
      locked_by_user_id INT NULL,
      locked_by_name VARCHAR(128) NULL,
      published_at DATETIME NULL,
      published_by_user_id INT NULL,
      published_by_name VARCHAR(128) NULL,
      created_by_user_id INT NULL,
      created_by_name VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qrt_exports_snapshot (captive_id, snapshot_date, source),
      KEY idx_qrt_exports_status (captive_id, source, status, created_at),
      UNIQUE KEY ux_qrt_export_workflow_key (captive_id, source, snapshot_date, workflow_request_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_guardrails (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      source ENUM('real','simulation') NOT NULL,
      max_delta_scr_eur DECIMAL(20,2) NULL,
      max_delta_mcr_eur DECIMAL(20,2) NULL,
      max_delta_own_funds_eur DECIMAL(20,2) NULL,
      max_ratio_drop_pct DECIMAL(12,4) NULL,
      block_on_breach TINYINT(1) NOT NULL DEFAULT 1,
      updated_by_user_id INT NULL,
      updated_by_name VARCHAR(128) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_qrt_guardrails_captive_source (captive_id, source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_governance_config (
      captive_id INT NOT NULL PRIMARY KEY,
      require_double_validation TINYINT(1) NOT NULL DEFAULT 0,
      updated_by_user_id INT NULL,
      updated_by_name VARCHAR(128) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_approvals (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      export_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      requested_by_user_id INT NULL,
      requested_by_name VARCHAR(128) NULL,
      decided_by_user_id INT NULL,
      decided_by_name VARCHAR(128) NULL,
      decision_at DATETIME NULL,
      comment_text VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qrt_approvals_export (export_id, status, created_at),
      CONSTRAINT fk_qrt_approvals_export
        FOREIGN KEY (export_id) REFERENCES qrt_exports(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_submissions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      export_id BIGINT UNSIGNED NOT NULL,
      status ENUM('ready','submitted','failed') NOT NULL DEFAULT 'ready',
      package_path VARCHAR(512) NOT NULL,
      package_sha256 CHAR(64) NULL,
      prepared_by_user_id INT NULL,
      prepared_by_name VARCHAR(128) NULL,
      prepared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME NULL,
      submission_ref VARCHAR(120) NULL,
      notes_text VARCHAR(1000) NULL,
      UNIQUE KEY ux_qrt_submission_export (export_id),
      KEY idx_qrt_submissions_status (status, prepared_at),
      CONSTRAINT fk_qrt_submissions_export
        FOREIGN KEY (export_id) REFERENCES qrt_exports(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_workflow_runs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      workflow_request_key VARCHAR(128) NULL,
      source ENUM('real','simulation') NOT NULL,
      snapshot_date DATE NOT NULL,
      status ENUM('running','success','failed') NOT NULL DEFAULT 'running',
      started_by_user_id INT NULL,
      started_by_name VARCHAR(128) NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME NULL,
      error_message VARCHAR(1000) NULL,
      KEY idx_qrt_workflow_runs_captive_date (captive_id, snapshot_date, status),
      KEY idx_qrt_workflow_runs_key (workflow_request_key, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_webhooks (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      event_code VARCHAR(80) NOT NULL,
      target_url VARCHAR(500) NOT NULL,
      secret_token VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by_user_id INT NULL,
      created_by_name VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qrt_webhooks_captive_event (captive_id, event_code, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_event_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      event_code VARCHAR(80) NOT NULL,
      webhook_id BIGINT UNSIGNED NULL,
      payload_json JSON NULL,
      delivery_status ENUM('queued','delivered','failed','skipped') NOT NULL DEFAULT 'queued',
      http_status INT NULL,
      error_text VARCHAR(1000) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qrt_event_logs_captive_event (captive_id, event_code, created_at),
      KEY idx_qrt_event_logs_status (delivery_status, created_at),
      CONSTRAINT fk_qrt_event_logs_webhook
        FOREIGN KEY (webhook_id) REFERENCES qrt_webhooks(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_archive_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      export_id BIGINT UNSIGNED NOT NULL,
      archive_path VARCHAR(512) NOT NULL,
      archived_by_user_id INT NULL,
      archived_by_name VARCHAR(128) NULL,
      archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY ux_qrt_archive_export (export_id),
      CONSTRAINT fk_qrt_archive_export
        FOREIGN KEY (export_id) REFERENCES qrt_exports(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_schedules (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      job_code ENUM('monthly_closure','retry_auto','retention','submission_prepare','alerts_scan') NOT NULL,
      frequency ENUM('hourly','daily','weekly','monthly') NOT NULL DEFAULT 'daily',
      hour_utc TINYINT UNSIGNED NOT NULL DEFAULT 0,
      minute_utc TINYINT UNSIGNED NOT NULL DEFAULT 0,
      day_of_week TINYINT UNSIGNED NULL,
      day_of_month TINYINT UNSIGNED NULL,
      payload_json JSON NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      next_run_at DATETIME NULL,
      last_run_at DATETIME NULL,
      last_status ENUM('idle','success','failed') NOT NULL DEFAULT 'idle',
      last_error VARCHAR(1000) NULL,
      updated_by_user_id INT NULL,
      updated_by_name VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qrt_schedules_due (captive_id, is_active, next_run_at),
      KEY idx_qrt_schedules_status (captive_id, last_status, last_run_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_tasks (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      title VARCHAR(190) NOT NULL,
      description_text VARCHAR(1000) NULL,
      status ENUM('todo','in_progress','done','blocked') NOT NULL DEFAULT 'todo',
      priority ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
      owner_user_id INT NULL,
      owner_name VARCHAR(128) NULL,
      due_date DATE NULL,
      linked_export_id BIGINT UNSIGNED NULL,
      linked_workflow_request_key VARCHAR(128) NULL,
      created_by_user_id INT NULL,
      created_by_name VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qrt_tasks_status_due (captive_id, status, due_date),
      KEY idx_qrt_tasks_owner (captive_id, owner_user_id, status),
      KEY idx_qrt_tasks_priority (captive_id, priority, status),
      CONSTRAINT fk_qrt_tasks_export
        FOREIGN KEY (linked_export_id) REFERENCES qrt_exports(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_alert_rules (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      event_code VARCHAR(80) NOT NULL,
      severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
      min_escalation_level INT NOT NULL DEFAULT 0,
      max_escalation_level INT NULL,
      recipients_csv VARCHAR(1000) NOT NULL,
      subject_template VARCHAR(255) NULL,
      cooldown_minutes INT NOT NULL DEFAULT 30,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by_user_id INT NULL,
      created_by_name VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qrt_alert_rules_event (captive_id, event_code, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_alert_deliveries (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      rule_id BIGINT UNSIGNED NULL,
      event_code VARCHAR(80) NOT NULL,
      severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
      recipients_csv VARCHAR(1000) NOT NULL,
      subject_text VARCHAR(255) NOT NULL,
      body_text TEXT NOT NULL,
      status ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
      provider_message_id VARCHAR(190) NULL,
      provider_response_text VARCHAR(1000) NULL,
      error_text VARCHAR(1000) NULL,
      sent_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qrt_alert_deliveries_event (captive_id, event_code, created_at),
      KEY idx_qrt_alert_deliveries_status (captive_id, status, created_at),
      CONSTRAINT fk_qrt_alert_deliveries_rule
        FOREIGN KEY (rule_id) REFERENCES qrt_alert_rules(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_incident_acks (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      incident_key VARCHAR(255) NOT NULL,
      severity ENUM('warning','critical') NOT NULL DEFAULT 'warning',
      title_text VARCHAR(255) NOT NULL,
      detail_text VARCHAR(1000) NULL,
      notes_text VARCHAR(1000) NULL,
      acked_by_user_id INT NULL,
      acked_by_name VARCHAR(128) NULL,
      acked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_qrt_incident_acks_key (captive_id, incident_key),
      KEY idx_qrt_incident_acks_time (captive_id, acked_at, severity)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qrt_incident_watch (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      captive_id INT NOT NULL,
      incident_key VARCHAR(255) NOT NULL,
      source_code VARCHAR(40) NOT NULL,
      severity ENUM('warning','critical') NOT NULL DEFAULT 'warning',
      status ENUM('open','acked','resolved') NOT NULL DEFAULT 'open',
      title_text VARCHAR(255) NOT NULL,
      detail_text VARCHAR(1000) NULL,
      owner_user_id INT NULL,
      owner_name VARCHAR(128) NULL,
      sla_minutes INT NOT NULL DEFAULT 240,
      ack_due_at DATETIME NULL,
      first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acked_at DATETIME NULL,
      acked_by_user_id INT NULL,
      acked_by_name VARCHAR(128) NULL,
      resolved_at DATETIME NULL,
      escalation_count INT NOT NULL DEFAULT 0,
      escalated_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_qrt_incident_watch_key (captive_id, incident_key),
      KEY idx_qrt_incident_watch_status (captive_id, status, severity, ack_due_at),
      KEY idx_qrt_incident_watch_owner (captive_id, owner_user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(100) NOT NULL,
      payload JSON NOT NULL,
      status ENUM('queued','running','done','failed') DEFAULT 'queued',
      tries INT DEFAULT 0,
      last_error TEXT NULL,
      scheduled_at DATETIME NOT NULL,
      started_at DATETIME NULL,
      finished_at DATETIME NULL,
      locked_by VARCHAR(100) NULL,
      locked_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_jobs_status_sched (status, scheduled_at),
      INDEX idx_jobs_type (type)
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insurance_branch (
      id_branch BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      captive_id INT NOT NULL,
      s2_code VARCHAR(5) NOT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT DEFAULT NULL,
      branch_type VARCHAR(10) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_branch),
      KEY idx_branch_captive (captive_id),
      UNIQUE KEY ux_branch_captive_s2_code (captive_id, s2_code),
      CONSTRAINT fk_branch_captive FOREIGN KEY (captive_id) REFERENCES captives(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insurance_branch_category (
      id_category BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      captive_id INT NOT NULL,
      code VARCHAR(30) NOT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_category),
      KEY idx_branch_category_captive (captive_id),
      UNIQUE KEY ux_branch_category_captive_code (captive_id, code),
      CONSTRAINT fk_branch_category_captive FOREIGN KEY (captive_id) REFERENCES captives(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insurance_branch_category_map (
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      id_category BIGINT(20) UNSIGNED NOT NULL,
      PRIMARY KEY (id_branch, id_category),
      KEY idx_ibcm_category (id_category),
      CONSTRAINT fk_ibcm_branch
        FOREIGN KEY (id_branch) REFERENCES insurance_branch (id_branch)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      CONSTRAINT fk_ibcm_category
        FOREIGN KEY (id_category) REFERENCES insurance_branch_category (id_category)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS captive_branch_policy (
      id_policy BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      is_allowed TINYINT(1) NOT NULL,
      restriction_level ENUM('NONE','LIMITED','STRICT','PROHIBITED') NOT NULL,
      fronting_required TINYINT(1) NOT NULL DEFAULT 0,
      reinsurance_required TINYINT(1) NOT NULL DEFAULT 0,
      comments TEXT DEFAULT NULL,
      effective_from DATE NOT NULL,
      effective_to DATE DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      eligibility_mode ENUM('ALLOWED','CONDITIONAL','PROHIBITED','FRONTING_ONLY','REINSURANCE_ONLY','VALIDATION_REQUIRED') NOT NULL DEFAULT 'ALLOWED',
      approval_required TINYINT(1) NOT NULL DEFAULT 0,
      approval_notes TEXT DEFAULT NULL,
      PRIMARY KEY (id_policy),
      KEY idx_cbp_id_branch (id_branch),
      CONSTRAINT fk_cbp_branch
        FOREIGN KEY (id_branch) REFERENCES insurance_branch (id_branch)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_risk_parameters (
      id_parameters BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      max_limit_per_claim DECIMAL(18,2) DEFAULT NULL,
      max_limit_per_year DECIMAL(18,2) DEFAULT NULL,
      default_deductible DECIMAL(18,2) DEFAULT NULL,
      volatility_level ENUM('LOW','MEDIUM','HIGH') NOT NULL,
      capital_intensity ENUM('LOW','MEDIUM','HIGH') NOT NULL,
      requires_actuarial_model TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      net_retention_ratio DECIMAL(5,2) DEFAULT NULL,
      target_loss_ratio DECIMAL(5,2) DEFAULT NULL,
      PRIMARY KEY (id_parameters),
      UNIQUE KEY ux_brp_branch (id_branch),
      CONSTRAINT fk_brp_branch
        FOREIGN KEY (id_branch) REFERENCES insurance_branch (id_branch)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_reinsurance_rules (
      id_rule BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      rule_type ENUM('FRONTING','QUOTA_SHARE','EXCESS_OF_LOSS','STOP_LOSS') NOT NULL,
      cession_rate DECIMAL(5,2) DEFAULT NULL,
      retention_limit DECIMAL(18,2) DEFAULT NULL,
      priority INT UNSIGNED NOT NULL DEFAULT 1,
      effective_from DATE NOT NULL,
      effective_to DATE DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_rule),
      KEY idx_brr_branch (id_branch),
      CONSTRAINT fk_brr_branch
        FOREIGN KEY (id_branch) REFERENCES insurance_branch (id_branch)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insurance_program (
      id_program BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      captive_id INT NOT NULL,
      code VARCHAR(30) NOT NULL,
      name VARCHAR(120) NOT NULL,
      description TEXT DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_program),
      KEY idx_program_captive (captive_id),
      UNIQUE KEY ux_program_captive_code (captive_id, code),
      CONSTRAINT fk_program_captive FOREIGN KEY (captive_id) REFERENCES captives(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_branch_map (
      id_program BIGINT(20) UNSIGNED NOT NULL,
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      PRIMARY KEY (id_program, id_branch),
      KEY idx_pbm_branch (id_branch),
      CONSTRAINT fk_pbm_program
        FOREIGN KEY (id_program) REFERENCES insurance_program (id_program)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      CONSTRAINT fk_pbm_branch
        FOREIGN KEY (id_branch) REFERENCES insurance_branch (id_branch)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_capital_parameters (
      id_capital BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      id_branch BIGINT(20) UNSIGNED NOT NULL,
      capital_method ENUM('STANDARD_FORMULA','INTERNAL_MODEL','SIMPLIFIED') NOT NULL,
      capital_charge_pct DECIMAL(5,2) DEFAULT NULL,
      stress_scenario VARCHAR(80) DEFAULT NULL,
      effective_from DATE NOT NULL,
      effective_to DATE DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_capital),
      UNIQUE KEY ux_bcp_branch (id_branch, effective_from),
      CONSTRAINT fk_bcp_branch
        FOREIGN KEY (id_branch) REFERENCES insurance_branch (id_branch)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_policy_version (
      id_version BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
      id_policy BIGINT(20) UNSIGNED NOT NULL,
      version_label VARCHAR(30) NOT NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      changed_by VARCHAR(80) DEFAULT NULL,
      change_notes TEXT DEFAULT NULL,
      PRIMARY KEY (id_version),
      KEY idx_bpv_policy (id_policy),
      CONSTRAINT fk_bpv_policy
        FOREIGN KEY (id_policy) REFERENCES captive_branch_policy (id_policy)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS insurers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(190) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_insurers_name (name)
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siren CHAR(9) NOT NULL UNIQUE,
      siret_siege CHAR(14) DEFAULT NULL,
      raison_sociale VARCHAR(190) NOT NULL,
      statut ENUM('brouillon','en_validation','actif','anomalie','gele','supprime') DEFAULT 'brouillon',
      code_ape VARCHAR(10) DEFAULT NULL,
      adresse_siege VARCHAR(255) DEFAULT NULL,
      date_immatriculation DATE DEFAULT NULL,
      date_maj DATE DEFAULT NULL,
      pays CHAR(2) DEFAULT 'FR',
      region VARCHAR(80) DEFAULT NULL,
      conformite_statut ENUM('en_attente','ok','anomalie') DEFAULT 'en_attente',
      conformite_notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_partners_statut (statut),
      INDEX idx_partners_date_maj (date_maj),
      INDEX idx_partners_code_ape (code_ape),
      INDEX idx_partners_pays (pays)
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_programme (
      partner_id INT NOT NULL,
      programme_id INT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (partner_id, programme_id),
      INDEX idx_pp_programme (programme_id),
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      external_client_ref VARCHAR(80) NOT NULL,
      type ENUM('personne_morale','personne_physique') NOT NULL DEFAULT 'personne_morale',
      chiffre_affaires DECIMAL(15,2) DEFAULT NULL,
      masse_salariale DECIMAL(15,2) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      partner_id INT NOT NULL,
      programme_id INT NOT NULL,
      client_id INT NOT NULL,
      statut ENUM('brouillon','actif','suspendu','resilie') DEFAULT 'brouillon',
      date_debut DATE DEFAULT NULL,
      date_fin DATE DEFAULT NULL,
      devise CHAR(3) DEFAULT 'EUR',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contracts_partner (partner_id, statut),
      INDEX idx_contracts_programme (programme_id, statut),
      INDEX idx_contracts_client (client_id, statut),
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
      FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_premium_terms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contract_id INT NOT NULL,
      frequency ENUM('ANNUAL','QUARTERLY','MONTHLY') NOT NULL,
      amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      currency CHAR(3) DEFAULT 'EUR',
      start_date DATE DEFAULT NULL,
      end_date DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_contract_premium_terms_contract (contract_id),
      INDEX idx_contract_premium_terms_frequency (frequency),
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_premium_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contract_id INT NOT NULL,
      paid_on DATE NOT NULL,
      amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      currency CHAR(3) DEFAULT 'EUR',
      reference VARCHAR(120) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_contract_premium_payments_contract (contract_id),
      INDEX idx_contract_premium_payments_paid_on (paid_on),
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS correspondants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type ENUM('commercial','back_office') NOT NULL,
      nom VARCHAR(160) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      telephone VARCHAR(40) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_correspondants_type (type)
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_correspondant (
      id INT AUTO_INCREMENT PRIMARY KEY,
      partner_id INT NOT NULL,
      correspondant_id INT NOT NULL,
      role ENUM('commercial','back_office') NOT NULL,
      statut ENUM('actif','inactif') NOT NULL DEFAULT 'actif',
      date_debut DATE DEFAULT NULL,
      date_fin DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pc_partner_role (partner_id, role),
      INDEX idx_pc_correspondant_role (correspondant_id, role),
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
      FOREIGN KEY (correspondant_id) REFERENCES correspondants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      partner_id INT NOT NULL,
      doc_type ENUM('KBIS','ID','LCBFT','OTHER') NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(512) DEFAULT NULL,
      storage_provider VARCHAR(80) DEFAULT NULL,
      storage_ref VARCHAR(255) DEFAULT NULL,
      status ENUM('valide','expire','manquant') DEFAULT 'valide',
      expiry_date DATE DEFAULT NULL,
      metadata JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_partner_docs_partner (partner_id),
      INDEX idx_partner_docs_type (doc_type),
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_addresses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      partner_id INT NOT NULL,
      type ENUM('siege','facturation','correspondance','autre') NOT NULL DEFAULT 'siege',
      ligne1 VARCHAR(190) NOT NULL,
      ligne2 VARCHAR(190) DEFAULT NULL,
      code_postal VARCHAR(20) DEFAULT NULL,
      ville VARCHAR(120) DEFAULT NULL,
      region VARCHAR(120) DEFAULT NULL,
      pays CHAR(2) DEFAULT 'FR',
      email VARCHAR(190) DEFAULT NULL,
      telephone VARCHAR(40) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_partner_addresses_partner (partner_id),
      INDEX idx_partner_addresses_type (type),
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_mandataires (
      id INT AUTO_INCREMENT PRIMARY KEY,
      partner_id INT NOT NULL,
      nom VARCHAR(120) NOT NULL,
      prenom VARCHAR(120) DEFAULT NULL,
      role VARCHAR(120) NOT NULL,
      email VARCHAR(190) DEFAULT NULL,
      telephone VARCHAR(40) DEFAULT NULL,
      date_debut DATE DEFAULT NULL,
      date_fin DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_partner_mandataires_partner (partner_id),
      INDEX idx_partner_mandataires_role (role),
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    INSERT IGNORE INTO insurers (name)
    SELECT DISTINCT TRIM(p.assureur) AS name
    FROM programmes p
    WHERE p.assureur IS NOT NULL
      AND TRIM(p.assureur) <> ''
  `);
  await pool.query(`
    INSERT IGNORE INTO insurers (name)
    SELECT DISTINCT TRIM(i.insurer_name) AS name
    FROM programme_insurers i
    WHERE i.insurer_name IS NOT NULL
      AND TRIM(i.insurer_name) <> ''
  `);
  await pool.query(`
    INSERT IGNORE INTO insurers (name)
    SELECT DISTINCT TRIM(c.carrier_name) AS name
    FROM programme_carriers c
    WHERE c.carrier_name IS NOT NULL
      AND TRIM(c.carrier_name) <> ''
  `);

  await ensureColumn(
    "insurance_branch",
    "captive_id",
    `ALTER TABLE insurance_branch ADD COLUMN captive_id INT NULL AFTER id_branch`
  );
  await dropIndexIfExists("insurance_branch", "ux_branch_s2_code");
  await ensureIndex(
    "insurance_branch",
    "idx_branch_captive",
    `ALTER TABLE insurance_branch ADD INDEX idx_branch_captive (captive_id)`
  );
  await ensureIndex(
    "insurance_branch",
    "ux_branch_captive_s2_code",
    `ALTER TABLE insurance_branch ADD UNIQUE KEY ux_branch_captive_s2_code (captive_id, s2_code)`
  );
  await ensureForeignKey(
    "insurance_branch",
    "fk_branch_captive",
    `ALTER TABLE insurance_branch
     ADD CONSTRAINT fk_branch_captive
     FOREIGN KEY (captive_id) REFERENCES captives(id)
     ON UPDATE CASCADE
     ON DELETE CASCADE`
  );
  await ensureForeignKey(
    "sinistre_lignes",
    "fk_sinistre_lignes_branch",
    `ALTER TABLE sinistre_lignes
     ADD CONSTRAINT fk_sinistre_lignes_branch
     FOREIGN KEY (id_branch) REFERENCES insurance_branch(id_branch)
     ON DELETE RESTRICT`
  );

  await ensureColumn(
    "insurance_branch_category",
    "captive_id",
    `ALTER TABLE insurance_branch_category ADD COLUMN captive_id INT NULL AFTER id_category`
  );
  await dropIndexIfExists("insurance_branch_category", "ux_branch_category_code");
  await ensureIndex(
    "insurance_branch_category",
    "idx_branch_category_captive",
    `ALTER TABLE insurance_branch_category ADD INDEX idx_branch_category_captive (captive_id)`
  );
  await ensureIndex(
    "insurance_branch_category",
    "ux_branch_category_captive_code",
    `ALTER TABLE insurance_branch_category ADD UNIQUE KEY ux_branch_category_captive_code (captive_id, code)`
  );
  await ensureForeignKey(
    "insurance_branch_category",
    "fk_branch_category_captive",
    `ALTER TABLE insurance_branch_category
     ADD CONSTRAINT fk_branch_category_captive
     FOREIGN KEY (captive_id) REFERENCES captives(id)
     ON UPDATE CASCADE
     ON DELETE CASCADE`
  );

  await ensureColumn(
    "insurance_program",
    "captive_id",
    `ALTER TABLE insurance_program ADD COLUMN captive_id INT NULL AFTER id_program`
  );
  await dropIndexIfExists("insurance_program", "ux_program_code");
  await ensureIndex(
    "insurance_program",
    "idx_program_captive",
    `ALTER TABLE insurance_program ADD INDEX idx_program_captive (captive_id)`
  );
  await ensureIndex(
    "insurance_program",
    "ux_program_captive_code",
    `ALTER TABLE insurance_program ADD UNIQUE KEY ux_program_captive_code (captive_id, code)`
  );
  await ensureForeignKey(
    "insurance_program",
    "fk_program_captive",
    `ALTER TABLE insurance_program
     ADD CONSTRAINT fk_program_captive
     FOREIGN KEY (captive_id) REFERENCES captives(id)
     ON UPDATE CASCADE
     ON DELETE CASCADE`
  );

  await ensureColumn(
    "captive_branch_policy",
    "eligibility_mode",
    `ALTER TABLE captive_branch_policy
     ADD COLUMN eligibility_mode ENUM('ALLOWED','CONDITIONAL','PROHIBITED','FRONTING_ONLY','REINSURANCE_ONLY','VALIDATION_REQUIRED') NOT NULL DEFAULT 'ALLOWED'`
  );
  await ensureColumn(
    "captive_branch_policy",
    "approval_required",
    `ALTER TABLE captive_branch_policy
     ADD COLUMN approval_required TINYINT(1) NOT NULL DEFAULT 0`
  );
  await ensureColumn(
    "captive_branch_policy",
    "approval_notes",
    `ALTER TABLE captive_branch_policy
     ADD COLUMN approval_notes TEXT DEFAULT NULL`
  );
  await ensureColumn(
    "branch_risk_parameters",
    "net_retention_ratio",
    `ALTER TABLE branch_risk_parameters
     ADD COLUMN net_retention_ratio DECIMAL(5,2) DEFAULT NULL`
  );
  await ensureColumn(
    "branch_risk_parameters",
    "target_loss_ratio",
    `ALTER TABLE branch_risk_parameters
     ADD COLUMN target_loss_ratio DECIMAL(5,2) DEFAULT NULL`
  );
  await ensureColumn(
    "programmes",
    "captive_id",
    `ALTER TABLE programmes
     ADD COLUMN captive_id INT NULL`
  );
  await ensureColumn(
    "programmes",
    "limite",
    `ALTER TABLE programmes
     ADD COLUMN limite DECIMAL(15,2) DEFAULT 0`
  );
  await ensureColumn(
    "programmes",
    "assureur",
    `ALTER TABLE programmes
     ADD COLUMN assureur VARCHAR(190) DEFAULT NULL`
  );
  await ensureColumn(
    "programmes",
    "debut",
    `ALTER TABLE programmes
     ADD COLUMN debut DATE DEFAULT NULL`
  );
  await ensureColumn(
    "programmes",
    "fin",
    `ALTER TABLE programmes
     ADD COLUMN fin DATE DEFAULT NULL`
  );
  await ensureColumn(
    "programmes",
    "branch_s2_code",
    `ALTER TABLE programmes
     ADD COLUMN branch_s2_code VARCHAR(5) DEFAULT NULL`
  );
  await ensureColumn(
    "reglements",
    "sinistre_ligne_id",
    `ALTER TABLE reglements
     ADD COLUMN sinistre_ligne_id INT NULL AFTER sinistre_id`
  );
  await ensureIndex(
    "reglements",
    "idx_reglement_sinistre_ligne",
    `ALTER TABLE reglements ADD INDEX idx_reglement_sinistre_ligne (sinistre_ligne_id)`
  );
  await ensureForeignKey(
    "reglements",
    "fk_reglement_sinistre_ligne",
    `ALTER TABLE reglements
     ADD CONSTRAINT fk_reglement_sinistre_ligne
     FOREIGN KEY (sinistre_ligne_id) REFERENCES sinistre_lignes(id)
     ON DELETE SET NULL`
  );
  await ensureIndex(
    "programmes",
    "idx_programmes_branch_s2",
    `ALTER TABLE programmes ADD INDEX idx_programmes_branch_s2 (branch_s2_code)`
  );
  await pool.query(`
    UPDATE programmes p
    JOIN (
      SELECT MIN(s2_code) AS s2_code
      FROM insurance_branch
      WHERE s2_code IS NOT NULL AND s2_code <> ''
    ) b
    SET p.branch_s2_code = b.s2_code
    WHERE p.branch_s2_code IS NULL
  `);
  await ensureColumn(
    "clients",
    "partner_id",
    `ALTER TABLE clients
     ADD COLUMN partner_id INT NULL,
     ADD INDEX idx_clients_partner (partner_id),
     ADD CONSTRAINT fk_clients_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL`
  );
  await ensureColumn(
    "clients",
    "chiffre_affaires",
    `ALTER TABLE clients
     ADD COLUMN chiffre_affaires DECIMAL(15,2) DEFAULT NULL AFTER type`
  );
  await ensureColumn(
    "clients",
    "masse_salariale",
    `ALTER TABLE clients
     ADD COLUMN masse_salariale DECIMAL(15,2) DEFAULT NULL AFTER chiffre_affaires`
  );
  await pool.query(`
    UPDATE clients c
    JOIN contracts ct ON ct.client_id = c.id
    SET c.partner_id = ct.partner_id
    WHERE c.partner_id IS NULL
  `);

  await ensureColumn(
    "sinistres",
    "partner_id",
    `ALTER TABLE sinistres
     ADD COLUMN partner_id INT NULL AFTER programme_id`
  );
  await ensureColumn(
    "sinistres",
    "client_id",
    `ALTER TABLE sinistres
     ADD COLUMN client_id INT NULL AFTER partner_id`
  );
  await ensureIndex(
    "sinistres",
    "idx_sinistre_partner",
    `ALTER TABLE sinistres ADD INDEX idx_sinistre_partner (partner_id)`
  );
  await ensureIndex(
    "sinistres",
    "idx_sinistre_client",
    `ALTER TABLE sinistres ADD INDEX idx_sinistre_client (client_id)`
  );
  await ensureIndex(
    "sinistres",
    "idx_sinistre_partner_client",
    `ALTER TABLE sinistres ADD INDEX idx_sinistre_partner_client (partner_id, client_id)`
  );
  await ensureForeignKey(
    "sinistres",
    "fk_sinistres_partner",
    `ALTER TABLE sinistres
     ADD CONSTRAINT fk_sinistres_partner
     FOREIGN KEY (partner_id) REFERENCES partners(id)
     ON DELETE SET NULL`
  );
  await ensureForeignKey(
    "sinistres",
    "fk_sinistres_client",
    `ALTER TABLE sinistres
     ADD CONSTRAINT fk_sinistres_client
     FOREIGN KEY (client_id) REFERENCES clients(id)
     ON DELETE SET NULL`
  );
}

async function ensureDefaultRoles() {
  const roles = ["super_admin", "admin", "cfo", "risk_manager", "actuaire", "conseil"];
  for (const name of roles) {
    await pool.query(`INSERT IGNORE INTO roles(name) VALUES (?)`, [name]);
  }
}

async function ensureDefaultAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@captiva.local";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const [rows] = await pool.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
  let userId = rows[0]?.id;
  if (!userId) {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query(
      `INSERT INTO users(email, password_hash, status) VALUES (?,?,?)`,
      [email, hash, "active"]
    );
    userId = r.insertId;
  }
  const [roleRows] = await pool.query(
    `SELECT id FROM roles WHERE name IN ('admin','super_admin')`
  );
  for (const role of roleRows) {
    await pool.query(`INSERT IGNORE INTO users_roles(user_id, role_id) VALUES (?,?)`, [userId, role.id]);
  }
  return userId;
}

async function ensureDefaultCaptiveAndMembership(adminUserId) {
  const code = process.env.DEFAULT_CAPTIVE_CODE || "default";
  const name = process.env.DEFAULT_CAPTIVE_NAME || "Captive par defaut";

  await pool.query(
    `INSERT IGNORE INTO captives(code, name, status) VALUES (?,?, 'active')`,
    [code, name]
  );

  const [captives] = await pool.query(`SELECT id FROM captives WHERE code = ? LIMIT 1`, [code]);
  const captiveId = captives[0]?.id;
  if (!captiveId || !adminUserId) return;

  await pool.query(
    `INSERT IGNORE INTO user_captive_memberships
      (user_id, captive_id, role, is_owner, status)
     VALUES (?, ?, 'owner', 1, 'active')`,
    [adminUserId, captiveId]
  );
}

async function ensureReferentialCaptiveScope() {
  const [captives] = await pool.query(`SELECT id FROM captives ORDER BY id ASC LIMIT 1`);
  const fallbackCaptiveId = Number(captives[0]?.id);
  if (!Number.isInteger(fallbackCaptiveId) || fallbackCaptiveId <= 0) return;

  await pool.query(`UPDATE insurance_branch SET captive_id = ? WHERE captive_id IS NULL`, [fallbackCaptiveId]);
  await pool.query(`UPDATE insurance_branch_category SET captive_id = ? WHERE captive_id IS NULL`, [fallbackCaptiveId]);
  await pool.query(`UPDATE insurance_program SET captive_id = ? WHERE captive_id IS NULL`, [fallbackCaptiveId]);
  await pool.query(`UPDATE programmes SET captive_id = ? WHERE captive_id IS NULL`, [fallbackCaptiveId]);
}

async function ensureSinistreVentilation() {
  await pool.query(`
    INSERT INTO sinistre_lignes (
      sinistre_id,
      id_branch,
      statut,
      montant_estime,
      montant_paye,
      montant_recours,
      montant_franchise,
      description
    )
    SELECT
      s.id,
      b.id_branch,
      s.statut,
      s.montant_estime,
      s.montant_paye,
      0,
      0,
      s.description
    FROM sinistres s
    JOIN programmes p ON p.id = s.programme_id
    JOIN insurance_branch b ON b.captive_id = p.captive_id AND b.s2_code = p.branch_s2_code
    LEFT JOIN sinistre_lignes sl ON sl.sinistre_id = s.id
    WHERE sl.id IS NULL
  `);

  await pool.query(`
    UPDATE reglements r
    JOIN (
      SELECT sinistre_id, MIN(id) AS line_id, COUNT(*) AS cnt
      FROM sinistre_lignes
      GROUP BY sinistre_id
    ) line_map ON line_map.sinistre_id = r.sinistre_id AND line_map.cnt = 1
    SET r.sinistre_ligne_id = line_map.line_id
    WHERE r.sinistre_ligne_id IS NULL
  `);

  // Backfill legacy paid amounts: create one settlement entry per paid line
  // only when the claim has no settlements yet.
  await pool.query(`
    INSERT INTO reglements (sinistre_id, sinistre_ligne_id, date, montant)
    SELECT
      sl.sinistre_id,
      sl.id,
      COALESCE(s.date_decl, s.date_survenue, DATE(s.created_at)),
      sl.montant_paye
    FROM sinistre_lignes sl
    JOIN sinistres s ON s.id = sl.sinistre_id
    LEFT JOIN (
      SELECT sinistre_id, COUNT(*) AS cnt
      FROM reglements
      GROUP BY sinistre_id
    ) rg ON rg.sinistre_id = sl.sinistre_id
    WHERE sl.montant_paye > 0
      AND COALESCE(rg.cnt, 0) = 0
  `);

  await pool.query(`
    UPDATE sinistres s
    JOIN (
      SELECT sinistre_id, COALESCE(SUM(montant_estime), 0) AS total_estime, COALESCE(SUM(montant_paye), 0) AS total_paye
      FROM sinistre_lignes
      GROUP BY sinistre_id
    ) agg ON agg.sinistre_id = s.id
    SET s.montant_estime = agg.total_estime,
        s.montant_paye = agg.total_paye
  `);
}

async function ensureDefaultReportTemplate() {
  const [[count]] = await pool.query(`SELECT COUNT(*) as total FROM report_templates`);
  const hasAny = count.total > 0;
  const definition = {
    tables: {
      programmes: {
        columns: [
          "id",
          "ligne_risque",
          "statut",
          "montant_garanti",
          "franchise",
          "devise",
          "date_debut",
          "date_fin",
          "created_at",
        ],
      },
      sinistres: {
        columns: [
          "id",
          "programme_id",
          "ligne_risque",
          "date_survenue",
          "date_decl",
          "statut",
          "montant_estime",
          "montant_paye",
          "devise",
          "description",
          "created_at",
        ],
      },
      reglements: {
        columns: ["id", "sinistre_id", "sinistre_ligne_id", "date", "montant", "created_at"],
      },
    },
    pdf: {
      include_summary: true,
      include_top_sinistres: true,
      include_by_status: true,
      include_by_programme: true,
    },
  };
  if (!hasAny) {
    await pool.query(
      `INSERT INTO report_templates (name, description, definition)
       VALUES (?,?,?)`,
      ["Standard", "Template standard (sections complètes)", JSON.stringify(definition)]
    );
  }

  const light = {
    tables: {
      programmes: {
        columns: ["id", "ligne_risque", "statut", "montant_garanti"],
      },
      sinistres: {
        columns: ["id", "programme_id", "statut", "montant_estime", "montant_paye"],
      },
    },
    pdf: {
      include_summary: true,
      include_top_sinistres: true,
      include_by_status: false,
      include_by_programme: false,
    },
  };
  const [[lightExists]] = await pool.query(
    `SELECT id FROM report_templates WHERE name = 'Light' LIMIT 1`
  );
  if (!lightExists) {
    await pool.query(
      `INSERT INTO report_templates (name, description, definition)
       VALUES (?,?,?)`,
      ["Light", "Template léger (sections essentielles)", JSON.stringify(light)]
    );
  }

  const [[financeExists]] = await pool.query(
    `SELECT id FROM report_templates WHERE name = 'Finance' LIMIT 1`
  );
  if (!financeExists) {
    const finance = {
      tables: {
        programmes: {
          columns: ["id", "ligne_risque", "statut", "montant_garanti", "franchise", "devise"],
        },
        sinistres: {
          columns: ["id", "programme_id", "statut", "montant_estime", "montant_paye", "devise"],
        },
        reglements: {
          columns: ["id", "sinistre_id", "sinistre_ligne_id", "date", "montant"],
        },
      },
      pdf: {
        include_summary: true,
        include_top_sinistres: false,
        include_by_status: true,
        include_by_programme: false,
      },
    };
    await pool.query(
      `INSERT INTO report_templates (name, description, definition)
       VALUES (?,?,?)`,
      ["Finance", "Template finance (flux & synthèse)", JSON.stringify(finance)]
    );
  }

  const [[auditExists]] = await pool.query(
    `SELECT id FROM report_templates WHERE name = 'Audit' LIMIT 1`
  );
  if (!auditExists) {
    const audit = {
      tables: {
        programmes: {
          columns: ["id", "ligne_risque", "statut", "date_debut", "date_fin", "created_at"],
        },
        sinistres: {
          columns: [
            "id",
            "programme_id",
            "statut",
            "date_survenue",
            "date_decl",
            "montant_estime",
            "montant_paye",
            "created_at",
          ],
        },
        reglements: {
          columns: ["id", "sinistre_id", "sinistre_ligne_id", "date", "montant", "created_at"],
        },
      },
      pdf: {
        include_summary: true,
        include_top_sinistres: true,
        include_by_status: true,
        include_by_programme: true,
      },
    };
    await pool.query(
      `INSERT INTO report_templates (name, description, definition)
       VALUES (?,?,?)`,
      ["Audit", "Template audit (traçabilité étendue)", JSON.stringify(audit)]
    );
  }
}

export async function migrate() {
  await ensureSchema();
  await ensureDefaultRoles();
  const adminUserId = await ensureDefaultAdmin();
  await ensureDefaultCaptiveAndMembership(adminUserId);
  await ensureReferentialCaptiveScope();
  await ensureSinistreVentilation();
  try {
    await pool.query(
      `ALTER TABLE report_jobs ADD COLUMN definition_override JSON NULL`
    );
  } catch {
    // ignore if column exists
  }
  try {
    await pool.query(
      `ALTER TABLE report_jobs ADD COLUMN tz_name VARCHAR(64) NULL`
    );
  } catch {
    // ignore if column exists
  }
  try {
    await pool.query(
      `ALTER TABLE report_jobs ADD COLUMN created_by_user_id INT NULL`
    );
  } catch {
    // ignore if column exists
  }
  try {
    await pool.query(
      `ALTER TABLE report_jobs MODIFY COLUMN status ENUM('queued','running','done','failed','canceled') DEFAULT 'queued'`
    );
  } catch {
    // ignore if already modified
  }
  await ensureColumn("qrt_exports", "status", `ALTER TABLE qrt_exports ADD COLUMN status ENUM('draft','published') NOT NULL DEFAULT 'draft'`);
  await ensureColumn("qrt_exports", "is_locked", `ALTER TABLE qrt_exports ADD COLUMN is_locked TINYINT(1) NOT NULL DEFAULT 0`);
  await ensureColumn("qrt_exports", "workflow_request_key", `ALTER TABLE qrt_exports ADD COLUMN workflow_request_key VARCHAR(128) NULL`);
  await ensureColumn("qrt_exports", "xml_sha256", `ALTER TABLE qrt_exports ADD COLUMN xml_sha256 CHAR(64) NULL`);
  await ensureColumn("qrt_exports", "bundle_sha256", `ALTER TABLE qrt_exports ADD COLUMN bundle_sha256 CHAR(64) NULL`);
  await ensureColumn("qrt_exports", "locked_at", `ALTER TABLE qrt_exports ADD COLUMN locked_at DATETIME NULL`);
  await ensureColumn("qrt_exports", "locked_by_user_id", `ALTER TABLE qrt_exports ADD COLUMN locked_by_user_id INT NULL`);
  await ensureColumn("qrt_exports", "locked_by_name", `ALTER TABLE qrt_exports ADD COLUMN locked_by_name VARCHAR(128) NULL`);
  await ensureColumn("qrt_exports", "published_at", `ALTER TABLE qrt_exports ADD COLUMN published_at DATETIME NULL`);
  await ensureColumn("qrt_exports", "published_by_user_id", `ALTER TABLE qrt_exports ADD COLUMN published_by_user_id INT NULL`);
  await ensureColumn("qrt_exports", "published_by_name", `ALTER TABLE qrt_exports ADD COLUMN published_by_name VARCHAR(128) NULL`);
  await ensureColumn("qrt_alert_rules", "min_escalation_level", `ALTER TABLE qrt_alert_rules ADD COLUMN min_escalation_level INT NOT NULL DEFAULT 0`);
  await ensureColumn("qrt_alert_rules", "max_escalation_level", `ALTER TABLE qrt_alert_rules ADD COLUMN max_escalation_level INT NULL`);
  await ensureIndex(
    "qrt_exports",
    "idx_qrt_exports_status",
    "ALTER TABLE qrt_exports ADD INDEX idx_qrt_exports_status (captive_id, source, status, created_at)"
  );
  await ensureIndex(
    "qrt_exports",
    "ux_qrt_export_workflow_key",
    "ALTER TABLE qrt_exports ADD UNIQUE INDEX ux_qrt_export_workflow_key (captive_id, source, snapshot_date, workflow_request_key)"
  );
  await ensureDefaultReportTemplate();
}
