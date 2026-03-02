#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import process from "node:process";
import nodemailer from "nodemailer";
import pool from "../src/db/pool.js";
import * as migrateMod from "../src/db/migrate.js";
import * as qrtServiceMod from "../src/db/qrtService.js";

const migrate = migrateMod?.migrate || migrateMod?.default?.migrate || migrateMod?.default;
const qrtService = qrtServiceMod?.default || qrtServiceMod;
const buildQrtFacts = qrtService?.buildQrtFacts;
const listQrtFacts = qrtService?.listQrtFacts;
const validateQrtFacts = qrtService?.validateQrtFacts;

let smtpTransport = null;

function parseArgs(argv) {
  const out = { tick: false, run: false, limit: 20 };
  for (const a of argv) {
    if (a === "--tick") out.tick = true;
    else if (a === "--run") out.run = true;
    else if (a.startsWith("--limit=")) out.limit = Math.max(1, Math.min(200, Number(a.split("=")[1] || 20)));
  }
  if (!out.tick && !out.run) {
    out.tick = true;
    out.run = true;
  }
  return out;
}

function parseJson(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

function stableDimsKey(dims) {
  if (!dims || typeof dims !== "object" || Array.isArray(dims)) return "{}";
  const keys = Object.keys(dims).sort();
  const out = {};
  for (const k of keys) out[k] = dims[k];
  return JSON.stringify(out);
}

function safeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlNameSafe(s) {
  const x = String(s || "").replace(/[^A-Za-z0-9_]/g, "_");
  if (!x) return "Fact_Unknown";
  return /^[A-Za-z_]/.test(x) ? x : `F_${x}`;
}

function conceptElementName(templateCode, conceptCode) {
  const t = xmlNameSafe(String(templateCode || "").replaceAll(".", "_"));
  const c = xmlNameSafe(String(conceptCode || "").replaceAll(".", "_"));
  return `${t}__${c}`;
}

function buildXml({ facts, snapshotDate, captiveId, source }) {
  const contexts = new Map();
  for (const f of facts) {
    const key = stableDimsKey(f.dimensions_json);
    if (!contexts.has(key)) contexts.set(key, { id: `c${contexts.size + 1}`, dims: f.dimensions_json || {} });
  }
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:cap="https://myoptiwealth.fr/xbrl/qrt-lite">`
  );
  lines.push(`  <cap:metadata captiveId="${safeXml(captiveId)}" source="${safeXml(source)}" snapshotDate="${safeXml(snapshotDate)}"/>`);
  for (const ctx of contexts.values()) {
    lines.push(`  <xbrli:context id="${ctx.id}">`);
    lines.push("    <xbrli:entity><xbrli:identifier scheme=\"https://myoptiwealth.fr/entity-id\">OPS</xbrli:identifier></xbrli:entity>");
    lines.push(`    <xbrli:period><xbrli:instant>${safeXml(snapshotDate)}</xbrli:instant></xbrli:period>`);
    lines.push("  </xbrli:context>");
  }
  lines.push('  <xbrli:unit id="u_EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>');
  lines.push('  <xbrli:unit id="u_PCT"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>');
  for (const f of facts) {
    const ctxId = contexts.get(stableDimsKey(f.dimensions_json))?.id || "c1";
    const unitRef = String(f.unit_code || "EUR").toUpperCase() === "PCT" ? "u_PCT" : "u_EUR";
    const el = conceptElementName(f.template_code, f.concept_code);
    lines.push(`  <cap:${el} contextRef="${ctxId}" unitRef="${unitRef}" decimals="2">${safeXml(f.value_decimal)}</cap:${el}>`);
  }
  lines.push("</xbrli:xbrl>");
  return `${lines.join("\n")}\n`;
}

function sha256String(input) {
  return createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

function nextRunFromSchedule(schedule, fromDate = new Date()) {
  const freq = String(schedule?.frequency || "daily");
  const h = Number(schedule?.hour_utc || 0);
  const m = Number(schedule?.minute_utc || 0);
  const dow = schedule?.day_of_week == null ? null : Number(schedule.day_of_week);
  const dom = schedule?.day_of_month == null ? null : Number(schedule.day_of_month);
  const now = new Date(fromDate.getTime());
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0, 0));
  if (d <= now) d = new Date(d.getTime() + 60 * 1000);
  for (let i = 0; i < 500; i += 1) {
    const matchDaily = freq === "daily";
    const matchHourly = freq === "hourly";
    const matchWeekly = freq === "weekly" && dow != null && d.getUTCDay() === dow;
    const matchMonthly = freq === "monthly" && dom != null && d.getUTCDate() === dom;
    if (matchHourly || matchDaily || matchWeekly || matchMonthly) {
      if (freq === "hourly") return d;
      if (d > now) return d;
    }
    d = new Date(d.getTime() + 60 * 60 * 1000);
    if (freq !== "hourly") d.setUTCMinutes(m, 0, 0);
  }
  return null;
}

function parseRecipientsCsv(input) {
  return String(input || "")
    .split(/[;,]/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

async function enqueueAlertByRules(captiveId, eventCode, severity, subject, body, escalationLevel = 0) {
  const [rules] = await pool.query(
    `SELECT id, recipients_csv, subject_template, cooldown_minutes
     FROM qrt_alert_rules
     WHERE captive_id = ?
       AND event_code = ?
       AND severity = ?
       AND COALESCE(min_escalation_level, 0) <= ?
       AND (max_escalation_level IS NULL OR max_escalation_level >= ?)
       AND is_active = 1`,
    [captiveId, String(eventCode || "").slice(0, 80), String(severity || "warning"), Math.max(0, Number(escalationLevel || 0)), Math.max(0, Number(escalationLevel || 0))]
  );
  let count = 0;
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
          recipients_csv: recipients.join(","),
          subject_text: subjectText,
          body_text: bodyText,
          event_code: String(eventCode || "").slice(0, 80),
          severity: String(severity || "warning"),
          escalation_level: Math.max(0, Number(escalationLevel || 0)),
        }),
      ]
    );
    count += 1;
  }
  return count;
}

async function runAlertScan(captiveId, payload) {
  const sinceMinutes = Math.max(5, Math.min(1440, Number(payload?.since_minutes || 60)));
  const [[wfFail]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM qrt_workflow_runs
     WHERE captive_id = ?
       AND status = 'failed'
       AND started_at >= (NOW() - INTERVAL ? MINUTE)`,
    [captiveId, sinceMinutes]
  );
  if (Number(wfFail?.cnt || 0) > 0) {
    await enqueueAlertByRules(
      captiveId,
      "workflow.failed",
      "critical",
      `[QRT] Workflow failures (${wfFail.cnt})`,
      `Detected ${wfFail.cnt} failed workflow run(s) in last ${sinceMinutes} minute(s).`
    );
  }
  const [[submissionFail]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM qrt_submissions s
     JOIN qrt_exports e ON e.id = s.export_id
     WHERE e.captive_id = ?
       AND s.status = 'failed'
       AND s.prepared_at >= (NOW() - INTERVAL ? MINUTE)`,
    [captiveId, sinceMinutes]
  );
  if (Number(submissionFail?.cnt || 0) > 0) {
    await enqueueAlertByRules(
      captiveId,
      "submission.failed",
      "critical",
      `[QRT] Submission failures (${submissionFail.cnt})`,
      `Detected ${submissionFail.cnt} failed submission(s) in last ${sinceMinutes} minute(s).`
    );
  }
  const [[webhookFail]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM qrt_event_logs
     WHERE captive_id = ?
       AND delivery_status = 'failed'
       AND created_at >= (NOW() - INTERVAL ? MINUTE)`,
    [captiveId, sinceMinutes]
  );
  if (Number(webhookFail?.cnt || 0) > 0) {
    await enqueueAlertByRules(
      captiveId,
      "webhook.failed",
      "warning",
      `[QRT] Webhook failures (${webhookFail.cnt})`,
      `Detected ${webhookFail.cnt} webhook failed delivery event(s) in last ${sinceMinutes} minute(s).`
    );
  }
  await syncIncidentWatchForWorker(captiveId);
  await escalateUnackedIncidentsForWorker(captiveId, 100);
}

function previousMonth(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}

function endOfMonthIso(year, month) {
  const d = new Date(Date.UTC(Number(year), Number(month), 0));
  return d.toISOString().slice(0, 10);
}

async function runMonthlyClosure(captiveId, payload) {
  const pm = previousMonth(new Date());
  const year = Number(payload?.year || pm.year);
  const month = Number(payload?.month || pm.month);
  const source = String(payload?.source || "real");
  const publish = Boolean(payload?.publish ?? true);
  const lock = Boolean(payload?.lock ?? true);
  const snapshotDate = endOfMonthIso(year, month);
  const workflowKey = `ops_schedule_monthly_${source}_${snapshotDate}_${Date.now()}`;
  const built = await buildQrtFacts({ captiveId, source, snapshotDate, runId: null });
  if (!built?.validation?.ok) throw new Error(`validation_failed:${(built.validation?.errors || []).join(",")}`);
  const validation = await validateQrtFacts({ captiveId, source, snapshotDate, rebuild: false });
  if (!validation.ok) throw new Error(`validation_failed:${(validation?.errors || []).join(",")}`);
  const facts = await listQrtFacts({ captiveId, source, snapshotDate });
  if (!facts.length) throw new Error("facts_not_found");

  const xml = buildXml({ facts, snapshotDate, captiveId, source });
  const outDir = path.join(process.cwd(), "storage", "output", "qrt");
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `qrt_ops_${captiveId}_${source}_${snapshotDate}_${Date.now()}.xml`);
  await fs.writeFile(filePath, xml, "utf8");
  const xmlSha256 = sha256String(xml);

  const [ins] = await pool.query(
    `INSERT INTO qrt_exports
       (captive_id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, xml_sha256, facts_count, status, created_by_user_id, created_by_name)
     VALUES (?,?,?,?, '2.8.0', 'MT', ?, ?, ?, 'draft', NULL, 'qrt-ops-worker')`,
    [captiveId, source, snapshotDate, workflowKey, filePath, xmlSha256, facts.length]
  );
  const exportId = Number(ins?.insertId || 0);
  if (publish) {
    await pool.query(
      `UPDATE qrt_exports
       SET status = 'published', published_at = NOW(), published_by_name = 'qrt-ops-worker'
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );
  }
  if (lock) {
    await pool.query(
      `UPDATE qrt_exports
       SET is_locked = 1, locked_at = NOW(), locked_by_name = 'qrt-ops-worker'
       WHERE id = ?
         AND status = 'published'
       LIMIT 1`,
      [exportId]
    );
  }
}

async function runRetryAuto(captiveId, payload) {
  const workflowKey = String(payload?.workflow_request_key || "").trim();
  if (!workflowKey) throw new Error("workflow_request_key_required");
  const [rows] = await pool.query(
    `SELECT id, status, is_locked
     FROM qrt_exports
     WHERE captive_id = ?
       AND workflow_request_key = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [captiveId, workflowKey]
  );
  const row = rows?.[0] || null;
  if (!row) throw new Error("workflow_not_found");
  const exportId = Number(row.id);
  if (Number(row.is_locked || 0) === 1) return;
  if (String(row.status || "") !== "published") {
    await pool.query(
      `UPDATE qrt_exports
       SET status = 'published', published_at = NOW(), published_by_name = 'qrt-ops-worker'
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );
  }
  await pool.query(
    `UPDATE qrt_exports
     SET is_locked = 1, locked_at = NOW(), locked_by_name = 'qrt-ops-worker'
     WHERE id = ?
       AND status = 'published'
     LIMIT 1`,
    [exportId]
  );
}

async function runRetention(captiveId, payload) {
  const retentionDays = Math.max(1, Math.min(3650, Number(payload?.retention_days || 365)));
  const limit = Math.max(1, Math.min(500, Number(payload?.limit || 100)));
  const onlyLocked = payload?.only_locked == null ? true : Boolean(payload.only_locked);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const filters = ["captive_id = ?", "snapshot_date < ?"];
  const params = [captiveId, cutoffDate];
  if (onlyLocked) filters.push("is_locked = 1");
  const [rows] = await pool.query(
    `SELECT id, file_path
     FROM qrt_exports
     WHERE ${filters.join(" AND ")}
     ORDER BY snapshot_date ASC, id ASC
     LIMIT ?`,
    [...params, limit]
  );
  const archiveDir = path.join(process.cwd(), "storage", "archive", "qrt");
  await fs.mkdir(archiveDir, { recursive: true });
  for (const r of rows || []) {
    const src = String(r.file_path || "");
    const dst = path.join(archiveDir, path.basename(src || `export_${r.id}.xml`));
    try {
      await fs.rename(src, dst);
    } catch {
      await fs.copyFile(src, dst);
      await fs.unlink(src);
    }
    await pool.query(
      `INSERT INTO qrt_archive_logs (export_id, archive_path, archived_by_name)
       VALUES (?, ?, 'qrt-ops-worker')
       ON DUPLICATE KEY UPDATE archive_path = VALUES(archive_path), archived_by_name = VALUES(archived_by_name), archived_at = CURRENT_TIMESTAMP`,
      [Number(r.id), dst]
    );
    await pool.query(`UPDATE qrt_exports SET file_path = ? WHERE id = ? LIMIT 1`, [dst, Number(r.id)]);
  }
}

async function runSubmissionPrepare(captiveId, payload) {
  const exportId = Number(payload?.export_id || 0);
  let row = null;
  if (exportId > 0) {
    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, file_path, taxonomy_version, jurisdiction, xml_sha256
       FROM qrt_exports
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    row = rows?.[0] || null;
  } else {
    const source = String(payload?.source || "real");
    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, file_path, taxonomy_version, jurisdiction, xml_sha256
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [captiveId, source]
    );
    row = rows?.[0] || null;
  }
  if (!row) throw new Error("export_not_found");
  const xmlPath = String(row.file_path || "");
  await fs.access(xmlPath);
  const outDir = path.join(process.cwd(), "storage", "output", "qrt", "submissions");
  await fs.mkdir(outDir, { recursive: true });
  const packagePath = path.join(outDir, `submission_ops_${captiveId}_${Number(row.id)}_${Date.now()}.zip`);
  const payloadText = JSON.stringify(
    {
      export_id: Number(row.id),
      source: String(row.source || "real"),
      snapshot_date: String(row.snapshot_date).slice(0, 10),
      taxonomy_version: row.taxonomy_version,
      jurisdiction: row.jurisdiction,
      xml_sha256: row.xml_sha256 || null,
    },
    null,
    2
  );
  await fs.writeFile(`${packagePath}.manifest.json`, payloadText, "utf8");
  const pkgHash = sha256String(payloadText + String(Date.now()));
  await pool.query(
    `INSERT INTO qrt_submissions
      (export_id, status, package_path, package_sha256, prepared_by_name)
     VALUES (?, 'ready', ?, ?, 'qrt-ops-worker')
     ON DUPLICATE KEY UPDATE
       status = 'ready',
       package_path = VALUES(package_path),
       package_sha256 = VALUES(package_sha256),
       prepared_by_name = VALUES(prepared_by_name),
       prepared_at = CURRENT_TIMESTAMP,
       submitted_at = NULL,
       submission_ref = NULL,
       notes_text = NULL`,
    [Number(row.id), packagePath, pkgHash]
  );
  await pool.query(`UPDATE qrt_exports SET bundle_sha256 = ? WHERE id = ? LIMIT 1`, [pkgHash, Number(row.id)]);
}

function defaultSlaMinutesForSeverity(severity) {
  return String(severity || "warning") === "critical" ? 60 : 240;
}

function dueAtFrom(firstSeenAt, slaMinutes) {
  const d = firstSeenAt ? new Date(firstSeenAt) : new Date();
  const mins = Math.max(1, Number(slaMinutes || 240));
  return new Date(d.getTime() + mins * 60 * 1000);
}

function labelAlertEventCode(eventCode) {
  const code = String(eventCode || "").trim().toLowerCase();
  if (code === "incident.unacked_escalation") return "escalade d'incident non acquitte";
  if (code === "workflow.failed") return "echec workflow";
  if (code === "submission.failed") return "echec soumission";
  if (code === "webhook.failed") return "echec webhook";
  if (!code) return "alerte inconnue";
  return code;
}

function explainDeliveryFailure(eventCode, errorText) {
  const raw = String(errorText || "").trim();
  const lower = raw.toLowerCase();
  let cause = "Cause technique non precisee.";
  let action = "Consulter les logs techniques et relancer l'envoi.";
  if (lower.includes("535") || lower.includes("authentication failed") || lower.includes("invalid login")) {
    cause = "Echec d'authentification SMTP (identifiant ou mot de passe refuse par le serveur mail).";
    action = "Verifier SMTP_USER et SMTP_PASS, puis tester la connexion SMTP.";
  } else if (lower.includes("email_provider_not_configured")) {
    cause = "Canal d'envoi email non configure.";
    action = "Configurer QRT_ALERT_EMAIL_WEBHOOK_URL ou SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM.";
  } else if (lower.includes("email_provider_http_")) {
    cause = "Le provider email webhook a retourne une erreur HTTP.";
    action = "Verifier l'URL webhook, l'authentification du provider et le statut du service mail.";
  }
  const out = [
    `Type d'alerte: ${labelAlertEventCode(eventCode)}.`,
    `Cause probable: ${cause}`,
    `Action recommandee: ${action}`,
  ];
  if (raw) out.push(`Detail technique: ${raw}`);
  return out.join(" ");
}

async function detectOperationalIncidentsForWorker(captiveId) {
  const out = [];
  const [failedSchedules] = await pool.query(
    `SELECT id, name, job_code, last_run_at, last_error
     FROM qrt_schedules
     WHERE captive_id = ?
       AND last_status = 'failed'`,
    [captiveId]
  );
  for (const s of failedSchedules || []) {
    out.push({
      incident_key: `schedule_failed:${Number(s.id)}:${String(s.last_run_at || "")}`,
      source_code: "schedule",
      severity: "critical",
      title_text: `Planning en echec: ${String(s.name || `#${s.id}`)}`.slice(0, 255),
      detail_text: String(s.last_error || s.job_code || "").slice(0, 1000) || null,
      occurred_at: s.last_run_at || new Date(),
    });
  }
  const [failedDeliveries] = await pool.query(
    `SELECT id, event_code, error_text, created_at, severity
     FROM qrt_alert_deliveries
     WHERE captive_id = ?
       AND status = 'failed'
       AND created_at >= (NOW() - INTERVAL 30 DAY)`,
    [captiveId]
  );
  for (const d of failedDeliveries || []) {
    out.push({
      incident_key: `delivery_failed:${Number(d.id)}`,
      source_code: "alert_delivery",
      severity: String(d.severity || "warning") === "critical" ? "critical" : "warning",
      title_text: `Echec d'envoi email d'alerte: ${labelAlertEventCode(d.event_code)}`.slice(0, 255),
      detail_text: explainDeliveryFailure(d.event_code, d.error_text).slice(0, 1000),
      occurred_at: d.created_at || new Date(),
    });
  }
  const [blockedTasks] = await pool.query(
    `SELECT id, title, description_text, updated_at, priority
     FROM qrt_tasks
     WHERE captive_id = ?
       AND status = 'blocked'`,
    [captiveId]
  );
  for (const t of blockedTasks || []) {
    out.push({
      incident_key: `task_blocked:${Number(t.id)}`,
      source_code: "task",
      severity: String(t.priority || "normal") === "critical" ? "critical" : "warning",
      title_text: `Tache bloquee: ${String(t.title || `#${t.id}`)}`.slice(0, 255),
      detail_text: String(t.description_text || "").slice(0, 1000) || null,
      occurred_at: t.updated_at || new Date(),
    });
  }
  const [overdueTasks] = await pool.query(
    `SELECT id, title, due_date, updated_at, priority
     FROM qrt_tasks
     WHERE captive_id = ?
       AND status IN ('todo','in_progress')
       AND due_date IS NOT NULL
       AND due_date < CURRENT_DATE()`,
    [captiveId]
  );
  for (const t of overdueTasks || []) {
    out.push({
      incident_key: `task_overdue:${Number(t.id)}:${String(t.due_date || "")}`,
      source_code: "task",
      severity: ["critical", "high"].includes(String(t.priority || "normal")) ? "critical" : "warning",
      title_text: `Tache en retard: ${String(t.title || `#${t.id}`)}`.slice(0, 255),
      detail_text: `Echeance ${String(t.due_date || "")}`.slice(0, 1000),
      occurred_at: t.updated_at || new Date(),
    });
  }
  return out;
}

async function syncIncidentWatchForWorker(captiveId) {
  const detected = await detectOperationalIncidentsForWorker(captiveId);
  const keys = new Set(detected.map((i) => i.incident_key));
  for (const i of detected) {
    const [rows] = await pool.query(
      `SELECT id, status, first_seen_at, sla_minutes
       FROM qrt_incident_watch
       WHERE captive_id = ?
         AND incident_key = ?
       LIMIT 1`,
      [captiveId, i.incident_key]
    );
    const row = rows?.[0] || null;
    if (!row) {
      const sla = defaultSlaMinutesForSeverity(i.severity);
      await pool.query(
        `INSERT INTO qrt_incident_watch
           (captive_id, incident_key, source_code, severity, status, title_text, detail_text, sla_minutes, ack_due_at, first_seen_at, last_seen_at)
         VALUES (?,?,?,?, 'open', ?, ?, ?, ?, ?, NOW())`,
        [captiveId, i.incident_key, i.source_code, i.severity, i.title_text, i.detail_text, sla, dueAtFrom(i.occurred_at, sla), i.occurred_at]
      );
    } else {
      const currentStatus = String(row.status || "open");
      if (currentStatus === "resolved" && String(i.source_code || "") === "alert_delivery") {
        continue;
      }
      const status = currentStatus === "acked" ? "acked" : "open";
      await pool.query(
        `UPDATE qrt_incident_watch
         SET source_code = ?,
             severity = ?,
             title_text = ?,
             detail_text = ?,
             status = ?,
             resolved_at = NULL,
             last_seen_at = NOW()
         WHERE id = ?
         LIMIT 1`,
        [i.source_code, i.severity, i.title_text, i.detail_text, status, Number(row.id)]
      );
    }
  }
  const [openRows] = await pool.query(
    `SELECT id, incident_key
     FROM qrt_incident_watch
     WHERE captive_id = ?
       AND status IN ('open','acked')`,
    [captiveId]
  );
  for (const r of openRows || []) {
    if (keys.has(String(r.incident_key || ""))) continue;
    await pool.query(
      `UPDATE qrt_incident_watch
       SET status = 'resolved',
           resolved_at = NOW()
       WHERE id = ?
       LIMIT 1`,
      [Number(r.id)]
    );
  }
}

async function escalateUnackedIncidentsForWorker(captiveId, limit = 100) {
  const [rows] = await pool.query(
    `SELECT id, incident_key, source_code, severity, title_text, detail_text, ack_due_at, escalation_count
     FROM qrt_incident_watch
     WHERE captive_id = ?
       AND status = 'open'
       AND source_code <> 'alert_delivery'
       AND ack_due_at IS NOT NULL
       AND ack_due_at < NOW()
       AND (escalated_at IS NULL OR escalated_at < (NOW() - INTERVAL 60 MINUTE))
     ORDER BY ack_due_at ASC
     LIMIT ?`,
    [captiveId, limit]
  );
  for (const r of rows || []) {
    const escalationLevel = Number(r.escalation_count || 0) + 1;
    const created = await enqueueAlertByRules(
      captiveId,
      "incident.unacked_escalation",
      String(r.severity || "warning") === "critical" ? "critical" : "warning",
      `[QRT] Incident non acquitte (L${escalationLevel})`,
      `${String(r.title_text || "incident")}\n${String(r.detail_text || "")}\nAck due at: ${String(r.ack_due_at || "")}\nEscalation level: ${escalationLevel}`,
      escalationLevel
    );
    if (created > 0) {
      await pool.query(
        `UPDATE qrt_incident_watch
         SET escalated_at = NOW(),
             escalation_count = escalation_count + 1
         WHERE id = ?
         LIMIT 1`,
        [Number(r.id)]
      );
    }
  }
}

async function executeSchedule(schedule) {
  const captiveId = Number(schedule.captive_id);
  const payload = parseJson(schedule.payload_json, {});
  const code = String(schedule.job_code || "");
  if (code === "monthly_closure") await runMonthlyClosure(captiveId, payload);
  else if (code === "retry_auto") await runRetryAuto(captiveId, payload);
  else if (code === "retention") await runRetention(captiveId, payload);
  else if (code === "submission_prepare") await runSubmissionPrepare(captiveId, payload);
  else if (code === "alerts_scan") await runAlertScan(captiveId, payload);
  else throw new Error("schedule_job_code_not_supported");
}

async function processDueSchedules(limit) {
  const [rows] = await pool.query(
    `SELECT id, captive_id, frequency, hour_utc, minute_utc, day_of_week, day_of_month, next_run_at
     FROM qrt_schedules
     WHERE is_active = 1
       AND next_run_at IS NOT NULL
       AND next_run_at <= NOW()
     ORDER BY next_run_at ASC, id ASC
     LIMIT ?`,
    [limit]
  );
  let enqueued = 0;
  for (const s of rows || []) {
    await pool.query(
      `INSERT INTO jobs (type, payload, status, tries, scheduled_at)
       VALUES ('qrt.schedule.execute', ?, 'queued', 0, NOW())`,
      [JSON.stringify({ schedule_id: Number(s.id), captive_id: Number(s.captive_id) })]
    );
    const nextRun = nextRunFromSchedule(s, new Date(Date.now() + 60 * 1000));
    await pool.query(
      `UPDATE qrt_schedules
       SET next_run_at = ?
       WHERE id = ?
       LIMIT 1`,
      [nextRun, Number(s.id)]
    );
    enqueued += 1;
  }
  return enqueued;
}

async function claimJob(jobId) {
  const [u] = await pool.query(
    `UPDATE jobs
     SET status = 'running',
         started_at = NOW(),
         locked_by = 'qrt-ops-worker',
         locked_at = NOW(),
         tries = tries + 1
     WHERE id = ?
       AND status = 'queued'
     LIMIT 1`,
    [jobId]
  );
  return Number(u?.affectedRows || 0) === 1;
}

async function finishJob(jobId, ok, errMessage = null) {
  await pool.query(
    `UPDATE jobs
     SET status = ?,
         finished_at = NOW(),
         last_error = ?,
         locked_by = NULL,
         locked_at = NULL
     WHERE id = ?
     LIMIT 1`,
    [ok ? "done" : "failed", errMessage ? String(errMessage).slice(0, 1000) : null, jobId]
  );
}

async function sendAlertEmail(payload) {
  const deliveryId = Number(payload?.delivery_id || 0);
  const recipients = parseRecipientsCsv(payload?.recipients_csv || "");
  const subjectText = String(payload?.subject_text || "QRT alert").slice(0, 255);
  const bodyText = String(payload?.body_text || "").slice(0, 30000);
  const webhookUrl = String(process.env.QRT_ALERT_EMAIL_WEBHOOK_URL || "").trim();
  const webhookToken = String(process.env.QRT_ALERT_EMAIL_WEBHOOK_TOKEN || "").trim();
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPass = String(process.env.SMTP_PASS || "").trim();
  const smtpFrom = String(process.env.SMTP_FROM || "").trim();
  const smtpFromName = String(process.env.SMTP_FROM_NAME || "").trim();
  const smtpPort = Math.max(1, Number(process.env.SMTP_PORT || 587));
  if (!deliveryId) throw new Error("delivery_id_missing");
  if (!recipients.length) throw new Error("recipients_invalid");
  let providerResponse = "";
  if (webhookUrl) {
    const headers = { "Content-Type": "application/json" };
    if (webhookToken) {
      headers["x-myoptiwealth-token"] = webhookToken;
      headers.Authorization = `Bearer ${webhookToken}`;
    }
    const rsp = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: recipients,
        subject: subjectText,
        text: bodyText,
        event_code: String(payload?.event_code || "unknown"),
        severity: String(payload?.severity || "warning"),
      }),
    });
    if (!rsp.ok) throw new Error(`email_provider_http_${rsp.status}`);
    providerResponse = await rsp.text();
  } else {
    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) throw new Error("email_provider_not_configured");
    if (!smtpTransport) {
      smtpTransport = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
    }
    const from = smtpFromName ? `${smtpFromName} <${smtpFrom}>` : smtpFrom;
    const info = await smtpTransport.sendMail({
      from,
      to: recipients.join(","),
      subject: subjectText,
      text: bodyText,
    });
    providerResponse = String(info?.messageId || "smtp_sent");
  }
  await pool.query(
    `UPDATE qrt_alert_deliveries
     SET status = 'sent',
         provider_response_text = ?,
         sent_at = NOW()
     WHERE id = ?
     LIMIT 1`,
    [providerResponse.slice(0, 1000), deliveryId]
  );
}

async function processQueuedJobs(limit) {
  const [rows] = await pool.query(
    `SELECT id, type, payload
     FROM jobs
     WHERE status = 'queued'
       AND scheduled_at <= NOW()
       AND type IN ('qrt.schedule.execute', 'qrt.alert.email')
     ORDER BY scheduled_at ASC, id ASC
     LIMIT ?`,
    [limit]
  );
  let processed = 0;
  for (const j of rows || []) {
    const jobId = Number(j.id);
    if (!(await claimJob(jobId))) continue;
    try {
      const payload = parseJson(j.payload, {});
      if (j.type === "qrt.schedule.execute") {
        const scheduleId = Number(payload?.schedule_id || 0);
        if (!scheduleId) throw new Error("schedule_id_missing");
        const [sRows] = await pool.query(`SELECT * FROM qrt_schedules WHERE id = ? LIMIT 1`, [scheduleId]);
        const schedule = sRows?.[0] || null;
        if (!schedule || Number(schedule.is_active || 0) !== 1) {
          await finishJob(jobId, true, null);
          processed += 1;
          continue;
        }
        try {
          await executeSchedule(schedule);
          await pool.query(
            `UPDATE qrt_schedules
             SET last_run_at = NOW(), last_status = 'success', last_error = NULL
             WHERE id = ?
             LIMIT 1`,
            [scheduleId]
          );
          await finishJob(jobId, true, null);
        } catch (err) {
          const msg = String(err?.message || "schedule_execution_failed").slice(0, 1000);
          await pool.query(
            `UPDATE qrt_schedules
             SET last_run_at = NOW(), last_status = 'failed', last_error = ?
             WHERE id = ?
             LIMIT 1`,
            [msg, scheduleId]
          );
          await enqueueAlertByRules(
            Number(schedule.captive_id),
            "schedule.failed",
            "critical",
            `[QRT] Schedule failed (${schedule.name || schedule.job_code})`,
            `Schedule id=${scheduleId} failed with error: ${msg}`
          );
          await finishJob(jobId, false, msg);
        }
      } else if (j.type === "qrt.alert.email") {
        try {
          await sendAlertEmail(payload);
          await finishJob(jobId, true, null);
        } catch (err) {
          const msg = String(err?.message || "alert_email_failed").slice(0, 1000);
          const deliveryId = Number(payload?.delivery_id || 0);
          if (deliveryId > 0) {
            await pool.query(
              `UPDATE qrt_alert_deliveries
               SET status = 'failed', error_text = ?
               WHERE id = ?
               LIMIT 1`,
              [msg, deliveryId]
            );
          }
          await finishJob(jobId, false, msg);
        }
      } else {
        await finishJob(jobId, false, "unsupported_job_type");
      }
      processed += 1;
    } catch (err) {
      await finishJob(jobId, false, String(err?.message || "job_failed").slice(0, 1000));
      processed += 1;
    }
  }
  return processed;
}

async function runGlobalIncidentMaintenance(limitCaptives = 200) {
  const [rows] = await pool.query(
    `SELECT DISTINCT captive_id
     FROM qrt_incident_watch
     ORDER BY captive_id ASC
     LIMIT ?`,
    [limitCaptives]
  );
  for (const r of rows || []) {
    const captiveId = Number(r.captive_id || 0);
    if (!captiveId) continue;
    await syncIncidentWatchForWorker(captiveId);
    await escalateUnackedIncidentsForWorker(captiveId, 100);
  }
}

async function main() {
  if (typeof migrate !== "function") throw new Error("migrate_function_unavailable");
  if (typeof buildQrtFacts !== "function" || typeof listQrtFacts !== "function" || typeof validateQrtFacts !== "function") {
    throw new Error("qrt_service_functions_unavailable");
  }
  const args = parseArgs(process.argv.slice(2));
  await migrate();
  let enqueued = 0;
  let processed = 0;
  if (args.tick) enqueued = await processDueSchedules(args.limit);
  if (args.run) processed = await processQueuedJobs(args.limit);
  if (args.run) await runGlobalIncidentMaintenance(200);
  console.log(JSON.stringify({ ok: true, tick: args.tick, run: args.run, enqueued, processed }, null, 2));
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
