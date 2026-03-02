#!/usr/bin/env node
import pool from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

function parseRecipientsCsv(input) {
  return String(input || "")
    .split(/[;,]/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

function toInt(v, fallback = 0, min = 0, max = 9) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has("--dry-run"),
  };
}

async function pickCaptiveId() {
  const envId = Number(process.env.CAPTIVE_ID || 0);
  if (envId > 0) return envId;
  const [rows] = await pool.query(
    `SELECT id
     FROM captives
     ORDER BY id ASC
     LIMIT 1`
  );
  return Number(rows?.[0]?.id || 0);
}

function buildManagedRules({ l1, l2, l3 }) {
  const mk = (eventCode, severity, minEsc, maxEsc, recipientsCsv, cooldown, subject) => ({
    event_code: eventCode,
    severity,
    min_escalation_level: minEsc,
    max_escalation_level: maxEsc,
    recipients_csv: recipientsCsv,
    cooldown_minutes: cooldown,
    subject_template: subject,
  });

  return [
    mk("workflow.failed", "critical", 0, null, l1, 15, "[QRT][L1] Workflow failures"),
    mk("submission.failed", "critical", 0, null, l1, 15, "[QRT][L1] Submission failures"),
    mk("webhook.failed", "warning", 0, null, l1, 30, "[QRT][L1] Webhook failures"),

    mk("incident.unacked_escalation", "warning", 1, 1, l1, 30, "[QRT][L1] Incident unacked escalation"),
    mk("incident.unacked_escalation", "warning", 2, 2, l2, 30, "[QRT][L2] Incident unacked escalation"),
    mk("incident.unacked_escalation", "warning", 3, null, l3, 30, "[QRT][L3] Incident unacked escalation"),
    mk("incident.unacked_escalation", "critical", 1, 1, l1, 15, "[QRT][L1] Critical incident unacked escalation"),
    mk("incident.unacked_escalation", "critical", 2, 2, l2, 15, "[QRT][L2] Critical incident unacked escalation"),
    mk("incident.unacked_escalation", "critical", 3, null, l3, 15, "[QRT][L3] Critical incident unacked escalation"),
  ];
}

async function upsertManagedRule(captiveId, rule, dryRun = false) {
  const [rows] = await pool.query(
    `SELECT id
     FROM qrt_alert_rules
     WHERE captive_id = ?
       AND event_code = ?
       AND severity = ?
       AND COALESCE(min_escalation_level, 0) = ?
       AND ((max_escalation_level IS NULL AND ? IS NULL) OR max_escalation_level = ?)
       AND created_by_name = 'oncall-seed'
     ORDER BY id DESC
     LIMIT 1`,
    [
      captiveId,
      rule.event_code,
      rule.severity,
      rule.min_escalation_level,
      rule.max_escalation_level,
      rule.max_escalation_level,
    ]
  );
  const existing = rows?.[0] || null;
  if (existing) {
    if (!dryRun) {
      await pool.query(
        `UPDATE qrt_alert_rules
         SET recipients_csv = ?,
             subject_template = ?,
             cooldown_minutes = ?,
             is_active = 1
         WHERE id = ?
         LIMIT 1`,
        [
          rule.recipients_csv,
          rule.subject_template,
          rule.cooldown_minutes,
          Number(existing.id),
        ]
      );
    }
    return { action: "updated", id: Number(existing.id) };
  }

  if (!dryRun) {
    const [ins] = await pool.query(
      `INSERT INTO qrt_alert_rules
         (captive_id, event_code, severity, min_escalation_level, max_escalation_level, recipients_csv, subject_template, cooldown_minutes, is_active, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,1,NULL,'oncall-seed')`,
      [
        captiveId,
        rule.event_code,
        rule.severity,
        rule.min_escalation_level,
        rule.max_escalation_level,
        rule.recipients_csv,
        rule.subject_template,
        rule.cooldown_minutes,
      ]
    );
    return { action: "created", id: Number(ins?.insertId || 0) };
  }

  return { action: "created", id: 0 };
}

async function main() {
  const { dryRun } = parseArgs(process.argv);
  await migrate();

  const captiveId = await pickCaptiveId();
  if (!captiveId) throw new Error("captive_id_not_found");

  const l1 = parseRecipientsCsv(process.env.ONCALL_L1 || "ops@captiva-risks.com").join(",");
  const l2 = parseRecipientsCsv(process.env.ONCALL_L2 || process.env.ONCALL_L1 || "risk@captiva-risks.com").join(",");
  const l3 = parseRecipientsCsv(process.env.ONCALL_L3 || process.env.ONCALL_L2 || process.env.ONCALL_L1 || "direction@captiva-risks.com").join(",");
  if (!l1 || !l2 || !l3) throw new Error("oncall_recipients_invalid");

  const rawMax = process.env.ONCALL_MAX_LEVEL;
  const maxLevel = rawMax == null || rawMax === "" ? null : toInt(rawMax, 3, 1, 9);
  const rules = buildManagedRules({ l1, l2, l3 }).filter((r) => maxLevel == null || r.min_escalation_level <= maxLevel);

  const results = [];
  for (const rule of rules) {
    // sequential on purpose: easier to read and trace in logs
    const res = await upsertManagedRule(captiveId, rule, dryRun);
    results.push({ ...res, ...rule });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dry_run: dryRun,
        captive_id: captiveId,
        recipients: { l1, l2, l3 },
        managed_rules: results.length,
        results,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
