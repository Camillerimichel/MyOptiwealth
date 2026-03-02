#!/usr/bin/env node
import pool from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

function parseRecipientsCsv(input) {
  return String(input || "")
    .split(/[;,]/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
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

async function enqueueAlertByRules(captiveId, eventCode, severity, subject, body, escalationLevel = 0, dedupeKey = null) {
  const lvl = Math.max(0, Number(escalationLevel || 0));
  const [rules] = await pool.query(
    `SELECT id, recipients_csv, subject_template, cooldown_minutes
     FROM qrt_alert_rules
     WHERE captive_id = ?
       AND event_code = ?
       AND severity = ?
       AND COALESCE(min_escalation_level, 0) <= ?
       AND (max_escalation_level IS NULL OR max_escalation_level >= ?)
       AND is_active = 1`,
    [captiveId, String(eventCode || "").slice(0, 80), String(severity || "warning"), lvl, lvl]
  );

  const out = [];
  for (const r of rules || []) {
    const recipients = parseRecipientsCsv(r.recipients_csv);
    if (!recipients.length) continue;
    const cooldown = Math.max(0, Number(r.cooldown_minutes || 0));
    if (cooldown > 0) {
      const [recent] = await pool.query(
        `SELECT id
         FROM qrt_alert_deliveries
         WHERE captive_id = ?
           AND rule_id = ?
           AND event_code = ?
           AND created_at >= (NOW() - INTERVAL ? MINUTE)
         ORDER BY id DESC
         LIMIT 1`,
        [captiveId, Number(r.id), String(eventCode || "").slice(0, 80), cooldown]
      );
      if (recent?.length) continue;
    }

    const subjectText = String(r.subject_template || subject || "QRT alert").slice(0, 255);
    const bodyText = String(body || "").slice(0, 30000);
    const [ins] = await pool.query(
      `INSERT INTO qrt_alert_deliveries
         (captive_id, rule_id, event_code, severity, recipients_csv, subject_text, body_text, status)
       VALUES (?,?,?,?,?,?,?, 'queued')`,
      [captiveId, Number(r.id), String(eventCode || "").slice(0, 80), String(severity || "warning"), recipients.join(","), subjectText, bodyText]
    );
    const deliveryId = Number(ins?.insertId || 0);
    await pool.query(
      `INSERT INTO jobs (type, payload, status, tries, scheduled_at)
       VALUES ('qrt.alert.email', ?, 'queued', 0, NOW())`,
      [
        JSON.stringify({
          delivery_id: deliveryId,
          captive_id: captiveId,
          rule_id: Number(r.id),
          event_code: String(eventCode || "").slice(0, 80),
          severity: String(severity || "warning"),
          escalation_level: lvl,
          recipients_csv: recipients.join(","),
          subject_text: subjectText,
          body_text: bodyText,
          dedupe_key: dedupeKey || null,
        }),
      ]
    );
    out.push({
      delivery_id: deliveryId,
      rule_id: Number(r.id),
      recipients_csv: recipients.join(","),
    });
  }
  return out;
}

async function main() {
  await migrate();
  const captiveId = await pickCaptiveId();
  if (!captiveId) throw new Error("captive_id_not_found");

  const severity = ["warning", "critical"].includes(String(process.env.VERIFY_SEVERITY || "critical"))
    ? String(process.env.VERIFY_SEVERITY || "critical")
    : "critical";
  const verifyKey = `verify_oncall_${Date.now()}`;

  await pool.query(
    `INSERT INTO qrt_incident_watch
       (captive_id, incident_key, source_code, severity, status, title_text, detail_text, sla_minutes, ack_due_at, first_seen_at, last_seen_at, escalation_count, escalated_at)
     VALUES (?,?,?,?, 'open', ?, ?, 60, (NOW() - INTERVAL 5 MINUTE), NOW(), NOW(), 0, NULL)`,
    [captiveId, verifyKey, "verify", severity, `[VERIFY] Oncall escalation ${severity}`, "Verification incident"]
  );

  const checks = [];
  for (const level of [1, 2, 3]) {
    await pool.query(
      `UPDATE qrt_incident_watch
       SET escalation_count = ?, escalated_at = NULL, ack_due_at = (NOW() - INTERVAL 5 MINUTE), status = 'open'
       WHERE captive_id = ? AND incident_key = ?
       LIMIT 1`,
      [level - 1, captiveId, verifyKey]
    );

    const created = await enqueueAlertByRules(
      captiveId,
      "incident.unacked_escalation",
      severity,
      `[QRT][VERIFY] Incident unacked escalation (L${level})`,
      `Verification escalation level ${level} for ${verifyKey}`,
      level,
      `${verifyKey}.L${level}`
    );

    await pool.query(
      `UPDATE qrt_incident_watch
       SET escalation_count = ?, escalated_at = NOW()
       WHERE captive_id = ? AND incident_key = ?
       LIMIT 1`,
      [level, captiveId, verifyKey]
    );

    checks.push({
      escalation_level: level,
      deliveries_created: created.length,
      rules_triggered: created.map((x) => x.rule_id),
      recipients: created.map((x) => x.recipients_csv),
    });
  }

  const pass = checks.every((c) => c.deliveries_created > 0);

  console.log(
    JSON.stringify(
      {
        ok: pass,
        captive_id: captiveId,
        severity,
        verify_incident_key: verifyKey,
        checks,
      },
      null,
      2
    )
  );

  if (!pass) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

