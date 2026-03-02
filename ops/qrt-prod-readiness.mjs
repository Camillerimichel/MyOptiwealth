#!/usr/bin/env node
import pool from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

async function hasTable(table) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row?.cnt || 0) > 0;
}

async function hasColumn(table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row?.cnt || 0) > 0;
}

function masked(v) {
  if (!v) return "";
  if (v.length <= 6) return "***";
  return `${v.slice(0, 3)}***${v.slice(-2)}`;
}

function pushResult(target, level, code, detail) {
  target.push({ level, code, detail });
}

async function main() {
  await migrate();

  const checks = [];
  const env = {
    JWT_SECRET: String(process.env.JWT_SECRET || "").trim(),
    DB_HOST: String(process.env.DB_HOST || "").trim(),
    DB_USER: String(process.env.DB_USER || "").trim(),
    DB_NAME: String(process.env.DB_NAME || "").trim(),
    QRT_ALERT_EMAIL_WEBHOOK_URL: String(process.env.QRT_ALERT_EMAIL_WEBHOOK_URL || "").trim(),
    SMTP_HOST: String(process.env.SMTP_HOST || "").trim(),
    SMTP_USER: String(process.env.SMTP_USER || "").trim(),
    SMTP_PASS: String(process.env.SMTP_PASS || "").trim(),
    SMTP_FROM: String(process.env.SMTP_FROM || "").trim(),
  };

  if (!env.JWT_SECRET) pushResult(checks, "error", "env.jwt_secret_missing", "JWT_SECRET is missing.");
  else if (env.JWT_SECRET.length < 24) pushResult(checks, "warning", "env.jwt_secret_weak", "JWT_SECRET length is below 24 characters.");
  else pushResult(checks, "ok", "env.jwt_secret_set", `JWT_SECRET set (${env.JWT_SECRET.length} chars).`);

  for (const name of ["DB_HOST", "DB_USER", "DB_NAME"]) {
    if (!env[name]) pushResult(checks, "error", `env.${name.toLowerCase()}_missing`, `${name} is missing.`);
    else pushResult(checks, "ok", `env.${name.toLowerCase()}_set`, `${name}=${masked(env[name])}`);
  }
  const hasWebhook = Boolean(env.QRT_ALERT_EMAIL_WEBHOOK_URL);
  const hasSmtp = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
  if (hasWebhook && !/^https?:\/\//i.test(env.QRT_ALERT_EMAIL_WEBHOOK_URL)) {
    pushResult(checks, "error", "env.mail_webhook_invalid", "QRT_ALERT_EMAIL_WEBHOOK_URL must be http(s).");
  } else if (hasWebhook) {
    pushResult(checks, "ok", "env.mail_webhook_set", `QRT_ALERT_EMAIL_WEBHOOK_URL=${masked(env.QRT_ALERT_EMAIL_WEBHOOK_URL)}`);
  } else {
    pushResult(checks, "warning", "env.mail_webhook_missing", "QRT_ALERT_EMAIL_WEBHOOK_URL is missing (SMTP fallback required).");
  }
  if (hasSmtp) {
    pushResult(checks, "ok", "env.smtp_set", `SMTP configured (host=${masked(env.SMTP_HOST)} from=${masked(env.SMTP_FROM)})`);
  } else {
    pushResult(checks, "warning", "env.smtp_missing", "SMTP config incomplete.");
  }
  if (!hasWebhook && !hasSmtp) {
    pushResult(checks, "error", "env.mail_provider_missing", "No email provider configured (webhook or SMTP).");
  }

  const requiredTables = [
    "qrt_schedules",
    "qrt_tasks",
    "qrt_alert_rules",
    "qrt_alert_deliveries",
    "qrt_incident_watch",
    "jobs",
  ];
  for (const t of requiredTables) {
    const exists = await hasTable(t);
    pushResult(checks, exists ? "ok" : "error", `db.table.${t}`, exists ? "present" : "missing");
  }

  const requiredColumns = [
    ["qrt_alert_rules", "min_escalation_level"],
    ["qrt_alert_rules", "max_escalation_level"],
  ];
  for (const [table, column] of requiredColumns) {
    const exists = await hasColumn(table, column);
    pushResult(
      checks,
      exists ? "ok" : "error",
      `db.column.${table}.${column}`,
      exists ? "present" : "missing"
    );
  }

  const [[rulesCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM qrt_alert_rules`);
  const totalRules = Number(rulesCount?.cnt || 0);
  if (totalRules <= 0) pushResult(checks, "error", "alerts.rules_empty", "No alert rules configured.");
  else pushResult(checks, "ok", "alerts.rules_present", `${totalRules} alert rules configured.`);

  const [oncallCoverage] = await pool.query(
    `SELECT severity, min_escalation_level, max_escalation_level, COUNT(*) AS cnt
     FROM qrt_alert_rules
     WHERE event_code = 'incident.unacked_escalation'
       AND is_active = 1
     GROUP BY severity, min_escalation_level, max_escalation_level`
  );
  const levels = [1, 2, 3];
  for (const sev of ["warning", "critical"]) {
    for (const lvl of levels) {
      const hasLvl = (oncallCoverage || []).some((r) => {
        if (String(r.severity) !== sev) return false;
        const min = Number(r.min_escalation_level ?? 0);
        const max = r.max_escalation_level == null ? null : Number(r.max_escalation_level);
        return min <= lvl && (max == null || max >= lvl);
      });
      pushResult(
        checks,
        hasLvl ? "ok" : "error",
        `alerts.oncall.${sev}.l${lvl}`,
        hasLvl ? "covered" : "missing coverage"
      );
    }
  }

  const [localRecipients] = await pool.query(
    `SELECT id, event_code, severity, recipients_csv
     FROM qrt_alert_rules
     WHERE recipients_csv LIKE '%.local%'
        OR recipients_csv LIKE '%@example.%'
     ORDER BY id ASC`
  );
  if ((localRecipients || []).length > 0) {
    pushResult(checks, "warning", "alerts.recipients_placeholder", `${localRecipients.length} rule(s) still use placeholder/local emails.`);
  } else {
    pushResult(checks, "ok", "alerts.recipients_real", "No placeholder/local email recipients detected.");
  }

  const errors = checks.filter((c) => c.level === "error").length;
  const warnings = checks.filter((c) => c.level === "warning").length;
  const go = errors === 0;

  console.log(
    JSON.stringify(
      {
        ok: go,
        summary: { errors, warnings, total_checks: checks.length },
        checks,
      },
      null,
      2
    )
  );

  if (!go) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
