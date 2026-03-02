import { Router } from "express";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import archiver from "archiver";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { buildQrtFacts, listQrtFacts, validateQrtFacts } from "../db/qrtService.js";
import { toCsv } from "../utils/csv.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
const canUse = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];

function hasRole(req, role) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return roles.includes(role);
}

function qrtCapabilities(req) {
  const isAdmin = hasRole(req, "admin");
  const isCfo = hasRole(req, "cfo");
  const isRisk = hasRole(req, "risk_manager");
  const isActuaire = hasRole(req, "actuaire");
  const isConseil = hasRole(req, "conseil");
  return {
    qrt_read: isAdmin || isCfo || isRisk || isActuaire || isConseil,
    qrt_build_and_export: isAdmin || isCfo || isRisk || isActuaire,
    qrt_publish_and_lock: isAdmin || isCfo || isRisk,
    qrt_governance_config: isAdmin || isCfo || isRisk,
    qrt_approve: isAdmin || isCfo || isRisk,
    qrt_submission: isAdmin || isCfo || isRisk || isActuaire,
    qrt_webhooks_manage: isAdmin || isCfo || isRisk,
    qrt_retention_run: isAdmin || isCfo,
  };
}

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

function safeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function isLeiLike(v) {
  return /^[A-Z0-9]{20}$/.test(String(v || "").trim().toUpperCase());
}

function stableDimsKey(dims) {
  if (!dims || typeof dims !== "object" || Array.isArray(dims)) return "{}";
  const keys = Object.keys(dims).sort();
  const out = {};
  for (const k of keys) out[k] = dims[k];
  return JSON.stringify(out);
}

function xmlText(v) {
  return safeXml(v);
}

function parseBool(v, fallback = false) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parseUtcHm(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(m) || m < 0 || m > 59) return null;
  return { h, m };
}

function parseRecipientsCsv(input) {
  const raw = String(input || "")
    .split(/[;,]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const uniq = [...new Set(raw)];
  const valid = uniq.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return valid;
}

function normalizeEscalationLevel(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(9, Math.trunc(n)));
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
  const limit = 500;
  for (let i = 0; i < limit; i += 1) {
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

async function detectOperationalIncidents(captiveId) {
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

async function syncIncidentWatch(captiveId) {
  const detected = await detectOperationalIncidents(captiveId);
  const keys = new Set(detected.map((i) => i.incident_key));
  let inserted = 0;
  let reopened = 0;
  let refreshed = 0;

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
      inserted += 1;
      continue;
    }
    const currentStatus = String(row.status || "open");
    const wasResolved = currentStatus === "resolved";
    if (wasResolved && String(i.source_code || "") === "alert_delivery") {
      // For email delivery failures, a manual resolve acts as an acknowledge of a historical event.
      // Do not reopen automatically on each sync.
      continue;
    }
    const newStatus = currentStatus === "acked" ? "acked" : "open";
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
      [i.source_code, i.severity, i.title_text, i.detail_text, newStatus, Number(row.id)]
    );
    if (wasResolved) reopened += 1;
    else refreshed += 1;
  }

  const [openRows] = await pool.query(
    `SELECT id, incident_key
     FROM qrt_incident_watch
     WHERE captive_id = ?
       AND status IN ('open','acked')`,
    [captiveId]
  );
  const toResolve = (openRows || []).filter((r) => !keys.has(String(r.incident_key || "")));
  for (const r of toResolve) {
    await pool.query(
      `UPDATE qrt_incident_watch
       SET status = 'resolved',
           resolved_at = NOW()
       WHERE id = ?
       LIMIT 1`,
      [Number(r.id)]
    );
  }

  return {
    detected_count: detected.length,
    inserted,
    reopened,
    refreshed,
    resolved: toResolve.length,
  };
}

async function escalateUnackedIncidents(captiveId, limit = 100) {
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
  let escalated = 0;
  for (const r of rows || []) {
    const escalationLevel = Number(r.escalation_count || 0) + 1;
    const created = await enqueueQrtAlertJobs({
      captiveId,
      eventCode: "incident.unacked_escalation",
      severity: String(r.severity || "warning") === "critical" ? "critical" : "warning",
      subject: `[QRT] Incident non acquitte (L${escalationLevel})`,
      body: `${String(r.title_text || "incident")}\n${String(r.detail_text || "")}\nAck due at: ${String(r.ack_due_at || "")}\nEscalation level: ${escalationLevel}`,
      dedupeKey: String(r.incident_key || ""),
      escalationLevel,
    });
    if (created.length > 0) {
      await pool.query(
        `UPDATE qrt_incident_watch
         SET escalated_at = NOW(),
             escalation_count = escalation_count + 1
         WHERE id = ?
         LIMIT 1`,
        [Number(r.id)]
      );
      escalated += 1;
    }
  }
  return { due_count: (rows || []).length, escalated };
}

async function enqueueQrtAlertJobs({ captiveId, eventCode, severity, subject, body, dedupeKey = null, escalationLevel = 0 }) {
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
  const out = [];
  for (const r of rules || []) {
    const recipients = parseRecipientsCsv(r.recipients_csv);
    if (!recipients.length) continue;
    const cooldownMinutes = Math.max(0, Number(r.cooldown_minutes || 0));
    if (cooldownMinutes > 0) {
      const [recent] = await pool.query(
        `SELECT id
         FROM qrt_alert_deliveries
         WHERE captive_id = ?
           AND rule_id = ?
           AND event_code = ?
           AND created_at >= (NOW() - INTERVAL ? MINUTE)
         ORDER BY id DESC
         LIMIT 1`,
        [captiveId, Number(r.id), String(eventCode || "").slice(0, 80), cooldownMinutes]
      );
      if (recent?.length) continue;
    }
    const subjectText = String(r.subject_template || subject || "QRT alert").slice(0, 255);
    const bodyText = String(body || "").slice(0, 30000);
    const recipientsCsv = recipients.join(",");
    const [ins] = await pool.query(
      `INSERT INTO qrt_alert_deliveries
         (captive_id, rule_id, event_code, severity, recipients_csv, subject_text, body_text, status)
       VALUES (?,?,?,?,?,?,?, 'queued')`,
      [captiveId, Number(r.id), String(eventCode || "").slice(0, 80), String(severity || "warning"), recipientsCsv, subjectText, bodyText]
    );
    const deliveryId = Number(ins?.insertId || 0);
    const payload = {
      delivery_id: deliveryId,
      captive_id: captiveId,
      rule_id: Number(r.id),
      event_code: String(eventCode || "").slice(0, 80),
      severity: String(severity || "warning"),
      escalation_level: Math.max(0, Number(escalationLevel || 0)),
      recipients_csv: recipientsCsv,
      subject_text: subjectText,
      body_text: bodyText,
      dedupe_key: dedupeKey || null,
    };
    await pool.query(
      `INSERT INTO jobs (type, payload, status, tries, scheduled_at)
       VALUES ('qrt.alert.email', ?, 'queued', 0, NOW())`,
      [JSON.stringify(payload)]
    );
    out.push({ rule_id: Number(r.id), delivery_id: deliveryId });
  }
  return out;
}

const CONCEPT_ELEMENT_MAP = {
  "S.02.01::BS.TotalAssets": "BS_TotalAssets",
  "S.02.01::BS.TotalLiabilities": "BS_TotalLiabilities",
  "S.02.01::BS.ExcessOfAssetsOverLiabilities": "BS_ExcessOfAssetsOverLiabilities",
  "S.23.01::OF.BasicOwnFundsEligible": "OF_BasicOwnFundsEligible",
  "S.23.01::OF.SCRTotal": "OF_SCRTotal",
  "S.23.01::OF.MCRTotal": "OF_MCRTotal",
  "S.25.01::SCR.NonLife": "SCR_NonLife",
  "S.25.01::SCR.Counterparty": "SCR_Counterparty",
  "S.25.01::SCR.Market": "SCR_Market",
  "S.25.01::SCR.Operational": "SCR_Operational",
  "S.25.01::SCR.BSCR": "SCR_BSCR",
  "S.25.01::SCR.Total": "SCR_Total",
  "S.28.01::MCR.Total": "MCR_Total",
  "S.28.01::MCR.CoverageRatioPct": "MCR_CoverageRatioPct",
};

function xmlNameSafe(s) {
  const x = String(s || "").replace(/[^A-Za-z0-9_]/g, "_");
  if (!x) return "Fact_Unknown";
  return /^[A-Za-z_]/.test(x) ? x : `F_${x}`;
}

function conceptElementName(templateCode, conceptCode) {
  const k = `${templateCode}::${conceptCode}`;
  if (CONCEPT_ELEMENT_MAP[k]) return CONCEPT_ELEMENT_MAP[k];
  const t = xmlNameSafe(String(templateCode || "").replaceAll(".", "_"));
  const c = xmlNameSafe(String(conceptCode || "").replaceAll(".", "_"));
  return `${t}__${c}`;
}

function buildXbrlLiteXml({
  facts,
  snapshotDate,
  captiveId,
  source,
  taxonomyVersion = "2.8.0",
  jurisdiction = "MT",
  entityIdentifier,
  entityScheme,
}) {
  const contexts = new Map();
  for (const f of facts) {
    const key = stableDimsKey(f.dimensions_json);
    if (!contexts.has(key)) contexts.set(key, { id: `c${contexts.size + 1}`, dims: f.dimensions_json || {} });
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:cap="https://myoptiwealth.fr/xbrl/qrt-lite">`
  );
  lines.push(
    `  <link:schemaRef xlink:type="simple" xlink:href="https://myoptiwealth.fr/taxonomy/qrt-lite/${xmlText(taxonomyVersion)}/entry.xsd"/>`
  );
  lines.push(
    `  <cap:metadata captiveId="${safeXml(captiveId)}" source="${safeXml(source)}" snapshotDate="${safeXml(snapshotDate)}" taxonomyVersion="${safeXml(taxonomyVersion)}" jurisdiction="${safeXml(jurisdiction)}"/>`
  );
  for (const ctx of contexts.values()) {
    lines.push(`  <xbrli:context id="${ctx.id}">`);
    lines.push("    <xbrli:entity>");
    lines.push(`      <xbrli:identifier scheme="${xmlText(entityScheme)}">${xmlText(entityIdentifier)}</xbrli:identifier>`);
    lines.push("    </xbrli:entity>");
    lines.push("    <xbrli:period>");
    lines.push(`      <xbrli:instant>${xmlText(snapshotDate)}</xbrli:instant>`);
    lines.push("    </xbrli:period>");
    const dims = ctx.dims || {};
    const dimKeys = Object.keys(dims);
    if (dimKeys.length) {
      lines.push("    <xbrli:scenario>");
      for (const k of dimKeys.sort()) {
        lines.push(
          `      <xbrldi:explicitMember dimension="cap:${xmlText(k)}">cap:${xmlText(String(dims[k]))}</xbrldi:explicitMember>`
        );
      }
      lines.push("    </xbrli:scenario>");
    }
    lines.push("  </xbrli:context>");
  }
  lines.push('  <xbrli:unit id="u_EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>');
  lines.push('  <xbrli:unit id="u_PCT"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>');
  for (const f of facts) {
    const ctxId = contexts.get(stableDimsKey(f.dimensions_json))?.id || "c1";
    const unitRef = String(f.unit_code || "EUR").toUpperCase() === "PCT" ? "u_PCT" : "u_EUR";
    const decimals = unitRef === "u_PCT" ? "4" : "2";
    const el = conceptElementName(f.template_code, f.concept_code);
    lines.push(
      `  <cap:${el} contextRef="${ctxId}" unitRef="${unitRef}" decimals="${decimals}" currency="${safeXml(f.currency)}">${safeXml(f.value_decimal)}</cap:${el}>`
    );
  }
  lines.push("</xbrli:xbrl>");
  return `${lines.join("\n")}\n`;
}

async function loadCaptiveMeta(captiveId) {
  const [rows] = await pool.query(`SELECT id, code, name FROM captives WHERE id = ? LIMIT 1`, [Number(captiveId)]);
  return rows?.[0] || null;
}

async function hasTable(tableName) {
  const [rows] = await pool.query(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [String(tableName)]
  );
  return Boolean(rows?.length);
}

async function hasColumn(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT 1 AS ok
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [String(tableName), String(columnName)]
  );
  return Boolean(rows?.length);
}

function sha256String(input) {
  return createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

async function sha256File(filePath) {
  const data = await fs.readFile(String(filePath || ""));
  return createHash("sha256").update(data).digest("hex");
}

function endOfMonthIso(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

async function startWorkflowRun({ captiveId, workflowRequestKey, source, snapshotDate, user }) {
  const [ins] = await pool.query(
    `INSERT INTO qrt_workflow_runs
       (captive_id, workflow_request_key, source, snapshot_date, status, started_by_user_id, started_by_name)
     VALUES (?,?,?,?, 'running', ?, ?)`,
    [captiveId, workflowRequestKey || null, source, snapshotDate, user?.uid || null, user?.email || null]
  );
  return Number(ins?.insertId || 0);
}

async function finishWorkflowRun(runId, status, errorMessage = null) {
  if (!runId) return;
  await pool.query(
    `UPDATE qrt_workflow_runs
     SET status = ?,
         ended_at = NOW(),
         error_message = ?
     WHERE id = ?
     LIMIT 1`,
    [status, errorMessage ? String(errorMessage).slice(0, 1000) : null, runId]
  );
}

async function getGovernanceConfig(captiveId) {
  const [rows] = await pool.query(
    `SELECT captive_id, require_double_validation, updated_at
     FROM qrt_governance_config
     WHERE captive_id = ?
     LIMIT 1`,
    [captiveId]
  );
  const r = rows?.[0] || null;
  return {
    captive_id: captiveId,
    require_double_validation: Number(r?.require_double_validation || 0) === 1,
    updated_at: r?.updated_at || null,
  };
}

async function getGuardrails(captiveId, source) {
  const [rows] = await pool.query(
    `SELECT id, captive_id, source, max_delta_scr_eur, max_delta_mcr_eur, max_delta_own_funds_eur, max_ratio_drop_pct, block_on_breach, updated_at
     FROM qrt_guardrails
     WHERE captive_id = ?
       AND source = ?
     LIMIT 1`,
    [captiveId, source]
  );
  const r = rows?.[0] || null;
  return {
    source,
    max_delta_scr_eur: r?.max_delta_scr_eur == null ? null : Number(r.max_delta_scr_eur),
    max_delta_mcr_eur: r?.max_delta_mcr_eur == null ? null : Number(r.max_delta_mcr_eur),
    max_delta_own_funds_eur: r?.max_delta_own_funds_eur == null ? null : Number(r.max_delta_own_funds_eur),
    max_ratio_drop_pct: r?.max_ratio_drop_pct == null ? null : Number(r.max_ratio_drop_pct),
    block_on_breach: Number(r?.block_on_breach ?? 1) === 1,
    updated_at: r?.updated_at || null,
  };
}

async function loadKeyFactsForGuardrail(captiveId, source, snapshotDate) {
  const [rows] = await pool.query(
    `SELECT template_code, concept_code, value_decimal
     FROM qrt_facts
     WHERE captive_id = ?
       AND source = ?
       AND snapshot_date = ?
       AND (
         (template_code = 'S.25.01' AND concept_code = 'SCR.Total')
         OR (template_code = 'S.28.01' AND concept_code = 'MCR.Total')
         OR (template_code = 'S.23.01' AND concept_code = 'OF.BasicOwnFundsEligible')
       )`,
    [captiveId, source, snapshotDate]
  );
  const map = new Map((rows || []).map((r) => [`${r.template_code}::${r.concept_code}`, Number(r.value_decimal || 0)]));
  const scr = Number(map.get("S.25.01::SCR.Total") || 0);
  const mcr = Number(map.get("S.28.01::MCR.Total") || 0);
  const ownFunds = Number(map.get("S.23.01::OF.BasicOwnFundsEligible") || 0);
  const ratio = scr > 0 ? (ownFunds / scr) * 100 : null;
  return { scr, mcr, own_funds: ownFunds, solvency_ratio_pct: ratio };
}

async function evaluateGuardrailBreaches({ captiveId, source, snapshotDate, previousSnapshotDate = null }) {
  const guardrails = await getGuardrails(captiveId, source);
  let prevDate = toIsoDate(previousSnapshotDate);
  if (!prevDate) {
    const [rows] = await pool.query(
      `SELECT MAX(snapshot_date) AS previous_snapshot_date
       FROM qrt_facts
       WHERE captive_id = ?
         AND source = ?
         AND snapshot_date < ?`,
      [captiveId, source, snapshotDate]
    );
    prevDate = toIsoDate(rows?.[0]?.previous_snapshot_date);
  }
  if (!prevDate) {
    return {
      ok: true,
      previous_snapshot_date: null,
      guardrails,
      breaches: [],
      current: await loadKeyFactsForGuardrail(captiveId, source, snapshotDate),
      previous: null,
    };
  }

  const current = await loadKeyFactsForGuardrail(captiveId, source, snapshotDate);
  const previous = await loadKeyFactsForGuardrail(captiveId, source, prevDate);
  const breaches = [];

  const deltaScr = current.scr - previous.scr;
  const deltaMcr = current.mcr - previous.mcr;
  const deltaOwnFunds = current.own_funds - previous.own_funds;
  const ratioDrop = previous.solvency_ratio_pct == null || current.solvency_ratio_pct == null ? null : previous.solvency_ratio_pct - current.solvency_ratio_pct;

  if (guardrails.max_delta_scr_eur != null && Math.abs(deltaScr) > guardrails.max_delta_scr_eur) {
    breaches.push({ code: "delta_scr_breach", threshold: guardrails.max_delta_scr_eur, value: deltaScr });
  }
  if (guardrails.max_delta_mcr_eur != null && Math.abs(deltaMcr) > guardrails.max_delta_mcr_eur) {
    breaches.push({ code: "delta_mcr_breach", threshold: guardrails.max_delta_mcr_eur, value: deltaMcr });
  }
  if (guardrails.max_delta_own_funds_eur != null && Math.abs(deltaOwnFunds) > guardrails.max_delta_own_funds_eur) {
    breaches.push({ code: "delta_own_funds_breach", threshold: guardrails.max_delta_own_funds_eur, value: deltaOwnFunds });
  }
  if (guardrails.max_ratio_drop_pct != null && ratioDrop != null && ratioDrop > guardrails.max_ratio_drop_pct) {
    breaches.push({ code: "ratio_drop_breach", threshold: guardrails.max_ratio_drop_pct, value: ratioDrop });
  }

  return {
    ok: breaches.length === 0,
    previous_snapshot_date: prevDate,
    guardrails,
    breaches,
    current,
    previous,
  };
}

async function hasApprovedDoubleValidation(exportId) {
  const [rows] = await pool.query(
    `SELECT id
     FROM qrt_approvals
     WHERE export_id = ?
       AND status = 'approved'
     ORDER BY decision_at DESC, id DESC
     LIMIT 1`,
    [exportId]
  );
  return Boolean(rows?.length);
}

async function emitQrtEvent(captiveId, eventCode, payload) {
  const safeEvent = String(eventCode || "unknown").slice(0, 80);
  const safePayload = payload || {};
  const serializedPayload = JSON.stringify(safePayload);
  const payloadForLog =
    serializedPayload.length > 200000
      ? JSON.stringify({ truncated: true, original_length: serializedPayload.length })
      : serializedPayload;
  const [hooks] = await pool.query(
    `SELECT id, target_url, secret_token
     FROM qrt_webhooks
     WHERE captive_id = ?
       AND event_code = ?
       AND is_active = 1
     ORDER BY id DESC`,
    [captiveId, safeEvent]
  );
  if (!hooks?.length) {
    await pool.query(
      `INSERT INTO qrt_event_logs (captive_id, event_code, webhook_id, payload_json, delivery_status, error_text)
       VALUES (?, ?, NULL, ?, 'skipped', 'no_active_webhook')`,
      [captiveId, safeEvent, payloadForLog]
    );
    return;
  }
  for (const h of hooks) {
    let status = "failed";
    let httpStatus = null;
    let errorText = null;
    try {
      const body = payloadForLog;
      const targetUrl = String(h.target_url || "").trim();
      if (!/^https?:\/\//i.test(targetUrl)) throw new Error("invalid_webhook_url");
      const headers = {
        "Content-Type": "application/json",
        "X-MYOPTIWEALTH-Event": safeEvent,
      };
      if (h.secret_token) {
        const sig = createHmac("sha256", String(h.secret_token)).update(body, "utf8").digest("hex");
        headers["X-MYOPTIWEALTH-Signature"] = sig;
      }
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const rsp = await fetch(targetUrl, { method: "POST", headers, body, signal: ctl.signal });
      clearTimeout(t);
      httpStatus = Number(rsp.status);
      status = rsp.ok ? "delivered" : "failed";
      if (!rsp.ok) errorText = `http_${rsp.status}`;
    } catch (err) {
      errorText = String(err?.message || "webhook_failed").slice(0, 1000);
    }
    await pool.query(
      `INSERT INTO qrt_event_logs (captive_id, event_code, webhook_id, payload_json, delivery_status, http_status, error_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [captiveId, safeEvent, Number(h.id), payloadForLog, status, httpStatus, errorText]
    );
  }
}

async function computeQrtFactsDiff({ captiveId, source, snapshotDate, previousSnapshotDate = null, includeUnchanged = false }) {
  let prevDate = toIsoDate(previousSnapshotDate);
  if (!prevDate) {
    const [prevRows] = await pool.query(
      `SELECT MAX(snapshot_date) AS previous_snapshot_date
       FROM qrt_facts
       WHERE captive_id = ?
         AND source = ?
         AND snapshot_date < ?`,
      [captiveId, source, snapshotDate]
    );
    prevDate = toIsoDate(prevRows?.[0]?.previous_snapshot_date);
    if (!prevDate) throw new Error("previous_snapshot_not_found");
  }

  const [currentRows] = await pool.query(
    `SELECT template_code, concept_code, dimensions_json, value_decimal, unit_code, currency
     FROM qrt_facts
     WHERE captive_id = ?
       AND source = ?
       AND snapshot_date = ?`,
    [captiveId, source, snapshotDate]
  );
  const [previousRows] = await pool.query(
    `SELECT template_code, concept_code, dimensions_json, value_decimal, unit_code, currency
     FROM qrt_facts
     WHERE captive_id = ?
       AND source = ?
       AND snapshot_date = ?`,
    [captiveId, source, prevDate]
  );

  const mk = (r) => `${r.template_code}::${r.concept_code}::${stableDimsKey(r.dimensions_json)}`;
  const curMap = new Map((currentRows || []).map((r) => [mk(r), r]));
  const prevMap = new Map((previousRows || []).map((r) => [mk(r), r]));
  const keys = new Set([...curMap.keys(), ...prevMap.keys()]);

  const rows = [];
  for (const k of keys) {
    const cur = curMap.get(k) || null;
    const prev = prevMap.get(k) || null;
    const currentValue = cur ? Number(cur.value_decimal || 0) : null;
    const previousValue = prev ? Number(prev.value_decimal || 0) : null;
    const delta = currentValue == null || previousValue == null ? null : currentValue - previousValue;
    const changed = delta == null ? true : Math.abs(delta) > 0.0001;
    if (!includeUnchanged && !changed) continue;

    rows.push({
      template_code: cur?.template_code || prev?.template_code || null,
      concept_code: cur?.concept_code || prev?.concept_code || null,
      dimensions_json: cur?.dimensions_json || prev?.dimensions_json || {},
      unit_code: cur?.unit_code || prev?.unit_code || "EUR",
      currency: cur?.currency || prev?.currency || "EUR",
      previous_value: previousValue,
      current_value: currentValue,
      delta,
      status: cur && prev ? (changed ? "changed" : "unchanged") : cur ? "added" : "removed",
    });
  }

  rows.sort((a, b) => {
    const ta = String(a.template_code || "");
    const tb = String(b.template_code || "");
    if (ta !== tb) return ta.localeCompare(tb);
    const ca = String(a.concept_code || "");
    const cb = String(b.concept_code || "");
    return ca.localeCompare(cb);
  });

  return { previousSnapshotDate: prevDate, rows };
}

router.post("/facts/build", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = req.body?.source || "real";
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const runId = Number(req.body?.run_id || 0) || null;
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });

    const out = await buildQrtFacts({ captiveId, source, snapshotDate, runId });
    return res.status(201).json({ ok: true, ...out });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_facts_build_failed" });
  }
});

router.get("/facts", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const snapshotDate = toIsoDate(req.query?.snapshot_date);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const facts = await listQrtFacts({ captiveId, source, snapshotDate });
    return res.json({ ok: true, source, snapshot_date: snapshotDate, facts_count: facts.length, facts });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_facts_list_failed" });
  }
});

router.get("/facts/diff", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.query?.source || "real");
    const snapshotDate = toIsoDate(req.query?.snapshot_date);
    const previousSnapshotDate = toIsoDate(req.query?.previous_snapshot_date);
    const includeUnchanged = parseBool(req.query?.include_unchanged, false);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const out = await computeQrtFactsDiff({
      captiveId,
      source,
      snapshotDate,
      previousSnapshotDate,
      includeUnchanged,
    });

    return res.json({
      ok: true,
      source,
      snapshot_date: snapshotDate,
      previous_snapshot_date: out.previousSnapshotDate,
      include_unchanged: includeUnchanged,
      diff_count: out.rows.length,
      rows: out.rows,
    });
  } catch (err) {
    const code = err?.message === "previous_snapshot_not_found" ? 404 : 400;
    return res.status(code).json({ error: err?.message || "qrt_facts_diff_failed" });
  }
});

router.get("/facts/diff.csv", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.query?.source || "real");
    const snapshotDate = toIsoDate(req.query?.snapshot_date);
    const previousSnapshotDate = toIsoDate(req.query?.previous_snapshot_date);
    const includeUnchanged = parseBool(req.query?.include_unchanged, false);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });

    const out = await computeQrtFactsDiff({
      captiveId,
      source,
      snapshotDate,
      previousSnapshotDate,
      includeUnchanged,
    });

    const csvRows = out.rows.map((r) => ({
      template_code: r.template_code,
      concept_code: r.concept_code,
      dimensions_json: JSON.stringify(r.dimensions_json || {}),
      unit_code: r.unit_code,
      currency: r.currency,
      previous_value: r.previous_value,
      current_value: r.current_value,
      delta: r.delta,
      status: r.status,
    }));
    const csv = toCsv(csvRows);
    const filename = `qrt_diff_${source}_${snapshotDate}_vs_${out.previousSnapshotDate}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    return res.send(csv);
  } catch (err) {
    const code = err?.message === "previous_snapshot_not_found" ? 404 : 400;
    return res.status(code).json({ error: err?.message || "qrt_facts_diff_csv_failed" });
  }
});

router.post("/validate", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.body?.source || "real");
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const runId = Number(req.body?.run_id || 0) || null;
    const rebuild = Boolean(req.body?.rebuild ?? false);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const validation = await validateQrtFacts({ captiveId, source, snapshotDate, runId, rebuild });
    return res.status(validation.ok ? 200 : 422).json({ ok: validation.ok, validation });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_validate_failed" });
  }
});

router.post("/export/xbrl-lite", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = req.body?.source || "real";
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const runId = Number(req.body?.run_id || 0) || null;
    const rebuildFacts = Boolean(req.body?.rebuild_facts ?? true);
    const failOnValidationError = Boolean(req.body?.fail_on_validation_error ?? true);
    const taxonomyVersion = String(req.body?.taxonomy_version || "2.8.0");
    const jurisdiction = String(req.body?.jurisdiction || "MT").slice(0, 2).toUpperCase();
    const requestedLei = String(req.body?.entity_lei || "").trim().toUpperCase();

    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    let buildOut = null;
    if (rebuildFacts) buildOut = await buildQrtFacts({ captiveId, source, snapshotDate, runId });

    const validation = buildOut?.validation || (await validateQrtFacts({ captiveId, source, snapshotDate, runId, rebuild: false }));
    if (!validation.ok && failOnValidationError) {
      return res.status(422).json({ error: "qrt_validation_failed", validation });
    }

    const facts = await listQrtFacts({ captiveId, source, snapshotDate });
    if (!facts.length) return res.status(404).json({ error: "qrt_facts_not_found" });

    const captive = await loadCaptiveMeta(captiveId);
    const entityIdentifier = isLeiLike(requestedLei) ? requestedLei : String(captive?.code || `CAPTIVE-${captiveId}`);
    const entityScheme = isLeiLike(entityIdentifier)
      ? "http://standards.iso.org/iso/17442"
      : "https://myoptiwealth.fr/entity-id";
    const xml = buildXbrlLiteXml({
      facts,
      snapshotDate,
      captiveId,
      source,
      taxonomyVersion,
      jurisdiction,
      entityIdentifier,
      entityScheme,
    });
    const dir = path.join(process.cwd(), "storage", "output", "qrt");
    await fs.mkdir(dir, { recursive: true });
    const filename = `qrt_${captiveId}_${source}_${snapshotDate}.xml`;
    const fullPath = path.join(dir, filename);
    await fs.writeFile(fullPath, xml, "utf8");
    const xmlSha256 = sha256String(xml);

    await pool.query(
      `INSERT INTO qrt_exports (captive_id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, xml_sha256, facts_count, status, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [captiveId, source, snapshotDate, taxonomyVersion, jurisdiction, fullPath, xmlSha256, facts.length, "draft", req.user?.uid || null, req.user?.email || null]
    );
    await logAudit(req.user?.uid || null, "qrt_export", null, "CREATE_DRAFT", {
      source,
      snapshot_date: snapshotDate,
      taxonomy_version: taxonomyVersion,
      jurisdiction,
      file_path: fullPath,
      xml_sha256: xmlSha256,
      facts_count: facts.length,
    });
    await emitQrtEvent(captiveId, "export.draft.created", {
      source,
      snapshot_date: snapshotDate,
      file_path: fullPath,
      xml_sha256: xmlSha256,
      facts_count: facts.length,
    });

    return res.json({
      ok: true,
      source,
      snapshot_date: snapshotDate,
      facts_count: facts.length,
      file_path: fullPath,
      xml_sha256: xmlSha256,
      taxonomy_version: taxonomyVersion,
      jurisdiction,
      entity_identifier: entityIdentifier,
      entity_scheme: entityScheme,
      validation,
      warnings: isLeiLike(entityIdentifier) ? [] : ["entity_identifier_is_not_lei"],
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_failed" });
  }
});

router.get("/export/latest", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const status = String(req.query?.status || "").trim().toLowerCase();
    const withStatus = status === "draft" || status === "published";
    const params = [captiveId, source];
    let sql = `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_by_user_id, created_by_name, created_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?`;
    if (withStatus) {
      sql += " AND status = ? ";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
    const [rows] = await pool.query(sql, params);
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });
    return res.json({
      ok: true,
      export: row,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_latest_failed" });
  }
});

router.get("/export/list", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.query?.source || "").trim().toLowerCase();
    const status = String(req.query?.status || "").trim().toLowerCase();
    const dateFrom = toIsoDate(req.query?.date_from);
    const dateTo = toIsoDate(req.query?.date_to);
    const page = Math.max(Number(req.query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 200);
    const offset = (page - 1) * limit;

    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (source === "real" || source === "simulation") {
      filters.push("source = ?");
      params.push(source);
    }
    if (status === "draft" || status === "published") {
      filters.push("status = ?");
      params.push(status);
    }
    if (dateFrom) {
      filters.push("snapshot_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push("snapshot_date <= ?");
      params.push(dateTo);
    }
    const whereSql = `WHERE ${filters.join(" AND ")}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM qrt_exports
       ${whereSql}`,
      params
    );
    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status,
              published_at, published_by_user_id, published_by_name, created_by_user_id, created_by_name, created_at
       FROM qrt_exports
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      ok: true,
      filters: {
        source: source || null,
        status: status || null,
        date_from: dateFrom,
        date_to: dateTo,
      },
      page,
      limit,
      total,
      items: rows || [],
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_list_failed" });
  }
});

router.get("/export/latest/download", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const status = String(req.query?.status || "").trim().toLowerCase();
    const withStatus = status === "draft" || status === "published";
    const params = [captiveId, source];
    let sql = `SELECT id, file_path, source, snapshot_date, status, is_locked
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?`;
    if (withStatus) {
      sql += " AND status = ? ";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
    const [rows] = await pool.query(sql, params);
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });

    const fullPath = String(row.file_path || "");
    await fs.access(fullPath);
    const filename = path.basename(fullPath);
    return res.download(fullPath, filename);
  } catch (err) {
    return res.status(404).json({ error: err?.message || "qrt_export_file_not_found" });
  }
});

router.get("/export/latest/bundle", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const includeUnchanged = parseBool(req.query?.include_unchanged, false);
    const forcedPrev = toIsoDate(req.query?.previous_snapshot_date);

    const [rows] = await pool.query(
      `SELECT id, file_path, source, snapshot_date, taxonomy_version, jurisdiction, status, is_locked, created_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [captiveId, source]
    );
    const latest = rows?.[0] || null;
    if (!latest) return res.status(404).json({ error: "qrt_export_not_found" });

    const snapshotDate = toIsoDate(latest.snapshot_date);
    const fullPath = String(latest.file_path || "");
    await fs.access(fullPath);

    let diffOut = { previousSnapshotDate: null, rows: [] };
    let diffWarning = null;
    try {
      diffOut = await computeQrtFactsDiff({
        captiveId,
        source,
        snapshotDate,
        previousSnapshotDate: forcedPrev,
        includeUnchanged,
      });
    } catch (err) {
      if (err?.message === "previous_snapshot_not_found") diffWarning = "previous_snapshot_not_found";
      else throw err;
    }

    const validation = await validateQrtFacts({
      captiveId,
      source,
      snapshotDate,
      rebuild: false,
    });

    const diffCsvRows = diffOut.rows.map((r) => ({
      template_code: r.template_code,
      concept_code: r.concept_code,
      dimensions_json: JSON.stringify(r.dimensions_json || {}),
      unit_code: r.unit_code,
      currency: r.currency,
      previous_value: r.previous_value,
      current_value: r.current_value,
      delta: r.delta,
      status: r.status,
    }));
    const diffCsv = toCsv(diffCsvRows);

    const manifest = {
      captive_id: captiveId,
      source,
      snapshot_date: snapshotDate,
      previous_snapshot_date: diffOut.previousSnapshotDate,
      include_unchanged: includeUnchanged,
      export_id: Number(latest.id),
      taxonomy_version: latest.taxonomy_version || null,
      jurisdiction: latest.jurisdiction || null,
      generated_at: new Date().toISOString(),
      warnings: diffWarning ? [diffWarning] : [],
    };

    const zipName = `qrt_bundle_${captiveId}_${source}_${snapshotDate}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${zipName}`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    archive.pipe(res);
    archive.file(fullPath, { name: path.basename(fullPath) });
    archive.append(JSON.stringify(validation, null, 2), { name: "validation.json" });
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    archive.append(diffCsv || "template_code,concept_code,dimensions_json,unit_code,currency,previous_value,current_value,delta,status\n", {
      name: "diff.csv",
    });
    await archive.finalize();
  } catch (err) {
    return res.status(404).json({ error: err?.message || "qrt_export_bundle_failed" });
  }
});

router.post("/export/publish", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.body?.source || "real");
    const exportId = Number(req.body?.export_id || 0);
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const force = parseBool(req.body?.force, false);
    const enforceGuardrails = parseBool(req.body?.enforce_guardrails, false);
    const params = [captiveId, source];
    let sql = `
      SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, created_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND source = ?
    `;
    if (exportId > 0) {
      sql += " AND id = ? ";
      params.push(exportId);
    } else if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
    const [rows] = await pool.query(sql, params);
    const target = rows?.[0] || null;
    if (!target) return res.status(404).json({ error: "qrt_export_not_found" });
    if (Number(target.is_locked || 0) === 1) {
      return res.status(409).json({
        error: "qrt_export_locked",
        message: "Locked export cannot be modified.",
        export_id: Number(target.id),
      });
    }
    if (String(target.status || "").toLowerCase() === "published" && !force) {
      return res.status(409).json({
        error: "qrt_export_already_published",
        message: "Export already published. Use force=true to republish.",
        export_id: Number(target.id),
      });
    }
    if (enforceGuardrails) {
      const g = await evaluateGuardrailBreaches({
        captiveId,
        source: String(target.source || source),
        snapshotDate: toIsoDate(target.snapshot_date),
      });
      if (!g.ok && g.guardrails.block_on_breach) {
        return res.status(422).json({ error: "guardrails_breach_blocking_publish", guardrails_check: g });
      }
    }

    await pool.query(
      `UPDATE qrt_exports
       SET status = 'published',
           published_at = NOW(),
           published_by_user_id = ?,
           published_by_name = ?
       WHERE id = ?`,
      [req.user?.uid || null, req.user?.email || null, Number(target.id)]
    );
    await logAudit(req.user?.uid || null, "qrt_export", Number(target.id), "PUBLISH", {
      source,
      snapshot_date: toIsoDate(target.snapshot_date),
      force,
    });
    await emitQrtEvent(captiveId, "export.published", {
      export_id: Number(target.id),
      source: String(target.source || source),
      snapshot_date: toIsoDate(target.snapshot_date),
      force,
    });

    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [Number(target.id)]
    );

    return res.json({
      ok: true,
      export: outRows?.[0] || target,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_publish_failed" });
  }
});

router.get("/export/published/latest", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?
         AND status = 'published'
       ORDER BY published_at DESC, id DESC
       LIMIT 1`,
      [captiveId, source]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_published_export_not_found" });
    return res.json({ ok: true, export: row });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_published_export_latest_failed" });
  }
});

router.delete("/export/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.params.id || 0);
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });

    const deleteFile = parseBool(req.query?.delete_file, false) || parseBool(req.body?.delete_file, false);
    const [rows] = await pool.query(
      `SELECT id, status, is_locked, file_path, source, snapshot_date, created_at
       FROM qrt_exports
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });
    if (Number(row.is_locked || 0) === 1) {
      return res.status(409).json({
        error: "qrt_export_delete_forbidden_locked",
        message: "Locked export cannot be deleted.",
        export_id: exportId,
      });
    }
    if (String(row.status || "").toLowerCase() === "published") {
      return res.status(409).json({
        error: "qrt_export_delete_forbidden_published",
        message: "Published export cannot be deleted.",
        export_id: exportId,
      });
    }

    await pool.query(`DELETE FROM qrt_exports WHERE id = ? AND captive_id = ? LIMIT 1`, [exportId, captiveId]);

    let fileDeleted = false;
    let fileDeleteWarning = null;
    if (deleteFile) {
      try {
        const p = String(row.file_path || "");
        if (p) {
          await fs.unlink(p);
          fileDeleted = true;
        }
      } catch {
        fileDeleteWarning = "file_delete_failed_or_missing";
      }
    }
    await logAudit(req.user?.uid || null, "qrt_export", Number(exportId), "DELETE_DRAFT", {
      source: String(row.source || ""),
      snapshot_date: toIsoDate(row.snapshot_date),
      delete_file: deleteFile,
      file_deleted: fileDeleted,
      warning: fileDeleteWarning,
    });
    await emitQrtEvent(captiveId, "export.deleted", {
      export_id: Number(exportId),
      source: String(row.source || ""),
      snapshot_date: toIsoDate(row.snapshot_date),
      delete_file: deleteFile,
      file_deleted: fileDeleted,
    });

    return res.json({
      ok: true,
      deleted_export_id: exportId,
      status_deleted: row.status || null,
      file_deleted: fileDeleted,
      warning: fileDeleteWarning,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_delete_failed" });
  }
});

router.post("/export/clone", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.body?.source || "real");
    const exportId = Number(req.body?.export_id || 0);
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const copyFile = parseBool(req.body?.copy_file, true);

    const params = [captiveId, source];
    let sql = `
      SELECT id, captive_id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked
      FROM qrt_exports
      WHERE captive_id = ?
        AND source = ?
    `;
    if (exportId > 0) {
      sql += " AND id = ? ";
      params.push(exportId);
    } else if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
    const [rows] = await pool.query(sql, params);
    const src = rows?.[0] || null;
    if (!src) return res.status(404).json({ error: "qrt_export_not_found" });

    let nextPath = String(src.file_path || "");
    let fileCopied = false;
    let fileCopyWarning = null;
    if (copyFile && nextPath) {
      try {
        const srcPath = nextPath;
        const parsed = path.parse(srcPath);
        const cloneName = `${parsed.name}_clone_${Date.now()}${parsed.ext || ".xml"}`;
        nextPath = path.join(parsed.dir, cloneName);
        await fs.copyFile(srcPath, nextPath);
        fileCopied = true;
      } catch {
        fileCopyWarning = "file_copy_failed_using_original_path";
        nextPath = String(src.file_path || "");
      }
    }

    const [ins] = await pool.query(
      `INSERT INTO qrt_exports
         (captive_id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(src.captive_id),
        String(src.source),
        toIsoDate(src.snapshot_date),
        String(src.taxonomy_version || "2.8.0"),
        String(src.jurisdiction || "MT"),
        nextPath,
        Number(src.facts_count || 0),
        "draft",
        req.user?.uid || null,
        req.user?.email || null,
      ]
    );

    const newId = Number(ins?.insertId || 0);
    await logAudit(req.user?.uid || null, "qrt_export", newId, "CLONE_TO_DRAFT", {
      cloned_from_export_id: Number(src.id),
      source: String(src.source),
      snapshot_date: toIsoDate(src.snapshot_date),
      copy_file: copyFile,
      file_copied: fileCopied,
      warning: fileCopyWarning,
    });
    await emitQrtEvent(captiveId, "export.cloned", {
      export_id: newId,
      cloned_from_export_id: Number(src.id),
      source: String(src.source),
      snapshot_date: toIsoDate(src.snapshot_date),
      copy_file: copyFile,
      file_copied: fileCopied,
    });
    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, created_by_user_id, created_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [newId]
    );

    return res.status(201).json({
      ok: true,
      cloned_from_export_id: Number(src.id),
      export: outRows?.[0] || null,
      file_copied: fileCopied,
      warning: fileCopyWarning,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_clone_failed" });
  }
});

router.get("/export/:id(\\d+)/audit", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.params.id || 0);
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });

    const page = Math.max(Number(req.query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 200);
    const offset = (page - 1) * limit;

    const [expRows] = await pool.query(
      `SELECT id, source, snapshot_date, status, is_locked, locked_at, locked_by_user_id, locked_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    const exportRow = expRows?.[0] || null;
    if (!exportRow) return res.status(404).json({ error: "qrt_export_not_found" });

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM audit_trail
       WHERE entity = 'qrt_export'
         AND entity_id = ?`,
      [exportId]
    );
    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await pool.query(
      `SELECT id, user_id, entity, entity_id, action, payload, created_at
       FROM audit_trail
       WHERE entity = 'qrt_export'
         AND entity_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [exportId, limit, offset]
    );

    return res.json({
      ok: true,
      export: exportRow,
      page,
      limit,
      total,
      items: rows || [],
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_audit_failed" });
  }
});

router.post("/export/:id(\\d+)/unpublish", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.params.id || 0);
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });

    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name
       FROM qrt_exports
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });
    if (Number(row.is_locked || 0) === 1) {
      return res.status(409).json({
        error: "qrt_export_locked",
        message: "Locked export cannot be unpublished.",
        export_id: exportId,
      });
    }
    if (String(row.status || "").toLowerCase() !== "published") {
      return res.status(409).json({
        error: "qrt_export_not_published",
        message: "Only published exports can be unpublished.",
        export_id: exportId,
      });
    }

    await pool.query(
      `UPDATE qrt_exports
       SET status = 'draft',
           published_at = NULL,
           published_by_user_id = NULL,
           published_by_name = NULL
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    await logAudit(req.user?.uid || null, "qrt_export", exportId, "UNPUBLISH_TO_DRAFT", {
      source: String(row.source || ""),
      snapshot_date: toIsoDate(row.snapshot_date),
      previous_published_at: row.published_at || null,
      previous_published_by_user_id: row.published_by_user_id || null,
      previous_published_by_name: row.published_by_name || null,
    });

    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );

    return res.json({
      ok: true,
      export: outRows?.[0] || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_unpublish_failed" });
  }
});

router.post("/export/:id(\\d+)/lock", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.params.id || 0);
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });

    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, status, is_locked
       FROM qrt_exports
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });
    if (Number(row.is_locked || 0) === 1) {
      return res.status(409).json({
        error: "qrt_export_already_locked",
        message: "Export already locked.",
        export_id: exportId,
      });
    }
    if (String(row.status || "").toLowerCase() !== "published") {
      return res.status(409).json({
        error: "qrt_export_must_be_published_before_lock",
        message: "Only published export can be locked.",
        export_id: exportId,
      });
    }
    const gov = await getGovernanceConfig(captiveId);
    if (gov.require_double_validation) {
      const approved = await hasApprovedDoubleValidation(exportId);
      if (!approved) {
        return res.status(409).json({
          error: "double_validation_required",
          message: "Approval is required before lock.",
          export_id: exportId,
        });
      }
    }

    await pool.query(
      `UPDATE qrt_exports
       SET is_locked = 1,
           locked_at = NOW(),
           locked_by_user_id = ?,
           locked_by_name = ?
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
    );
    await logAudit(req.user?.uid || null, "qrt_export", exportId, "LOCK_FINAL", {
      source: String(row.source || ""),
      snapshot_date: toIsoDate(row.snapshot_date),
    });
    await emitQrtEvent(captiveId, "export.locked", {
      export_id: exportId,
      source: String(row.source || ""),
      snapshot_date: toIsoDate(row.snapshot_date),
    });

    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );
    return res.json({ ok: true, export: outRows?.[0] || null });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_lock_failed" });
  }
});

router.get("/export/locked/latest", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?
         AND is_locked = 1
       ORDER BY locked_at DESC, id DESC
       LIMIT 1`,
      [captiveId, source]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_locked_export_not_found" });
    return res.json({ ok: true, export: row });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_locked_export_latest_failed" });
  }
});

router.get("/export/locked/latest/download", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const [rows] = await pool.query(
      `SELECT id, file_path, source, snapshot_date
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?
         AND is_locked = 1
       ORDER BY locked_at DESC, id DESC
       LIMIT 1`,
      [captiveId, source]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_locked_export_not_found" });
    const fullPath = String(row.file_path || "");
    await fs.access(fullPath);
    return res.download(fullPath, path.basename(fullPath));
  } catch (err) {
    return res.status(404).json({ error: err?.message || "qrt_locked_export_download_failed" });
  }
});

router.get("/dashboard", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const [[totals]] = await pool.query(
      `SELECT
         COUNT(*) AS total_exports,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS total_draft,
         SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS total_published,
         SUM(CASE WHEN is_locked = 1 THEN 1 ELSE 0 END) AS total_locked,
         MAX(created_at) AS latest_export_created_at,
         MAX(published_at) AS latest_published_at,
         MAX(locked_at) AS latest_locked_at
       FROM qrt_exports
       WHERE captive_id = ?`,
      [captiveId]
    );

    const [bySourceRows] = await pool.query(
      `SELECT
         source,
         COUNT(*) AS total_exports,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS total_draft,
         SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS total_published,
         SUM(CASE WHEN is_locked = 1 THEN 1 ELSE 0 END) AS total_locked,
         MAX(created_at) AS latest_export_created_at,
         MAX(published_at) AS latest_published_at,
         MAX(locked_at) AS latest_locked_at
       FROM qrt_exports
       WHERE captive_id = ?
       GROUP BY source
       ORDER BY source`,
      [captiveId]
    );

    const [latestRows] = await pool.query(
      `SELECT x.id, x.source, x.snapshot_date, x.status, x.is_locked, x.created_at, x.published_at, x.locked_at, x.facts_count, x.file_path
       FROM qrt_exports x
       JOIN (
         SELECT source, MAX(created_at) AS max_created_at
         FROM qrt_exports
         WHERE captive_id = ?
         GROUP BY source
       ) m
         ON m.source = x.source
        AND m.max_created_at = x.created_at
       WHERE x.captive_id = ?
       ORDER BY x.source, x.id DESC`,
      [captiveId, captiveId]
    );

    const latestBySource = {};
    for (const r of latestRows || []) {
      const key = String(r.source || "");
      if (!latestBySource[key]) latestBySource[key] = r;
    }

    const [[taskStats]] = await pool.query(
      `SELECT
         SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo_count,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count,
         SUM(CASE WHEN status IN ('todo','in_progress','blocked') AND due_date IS NOT NULL AND due_date < CURRENT_DATE() THEN 1 ELSE 0 END) AS overdue_count
       FROM qrt_tasks
       WHERE captive_id = ?`,
      [captiveId]
    );
    const [[scheduleStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_schedules,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_schedules,
         MIN(CASE WHEN is_active = 1 THEN next_run_at ELSE NULL END) AS next_run_at
       FROM qrt_schedules
       WHERE captive_id = ?`,
      [captiveId]
    );
    const [[alertStats]] = await pool.query(
      `SELECT
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_count,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
       FROM qrt_alert_deliveries
       WHERE captive_id = ?
         AND created_at >= (NOW() - INTERVAL 7 DAY)`,
      [captiveId]
    );

    return res.json({
      ok: true,
      captive_id: captiveId,
      totals: {
        total_exports: Number(totals?.total_exports || 0),
        total_draft: Number(totals?.total_draft || 0),
        total_published: Number(totals?.total_published || 0),
        total_locked: Number(totals?.total_locked || 0),
        latest_export_created_at: totals?.latest_export_created_at || null,
        latest_published_at: totals?.latest_published_at || null,
        latest_locked_at: totals?.latest_locked_at || null,
      },
      by_source: (bySourceRows || []).map((r) => ({
        source: r.source,
        total_exports: Number(r.total_exports || 0),
        total_draft: Number(r.total_draft || 0),
        total_published: Number(r.total_published || 0),
        total_locked: Number(r.total_locked || 0),
        latest_export_created_at: r.latest_export_created_at || null,
        latest_published_at: r.latest_published_at || null,
        latest_locked_at: r.latest_locked_at || null,
      })),
      latest_by_source: latestBySource,
      ops_tracking: {
        tasks: {
          todo_count: Number(taskStats?.todo_count || 0),
          in_progress_count: Number(taskStats?.in_progress_count || 0),
          blocked_count: Number(taskStats?.blocked_count || 0),
          overdue_count: Number(taskStats?.overdue_count || 0),
        },
        schedules: {
          total_schedules: Number(scheduleStats?.total_schedules || 0),
          active_schedules: Number(scheduleStats?.active_schedules || 0),
          next_run_at: scheduleStats?.next_run_at || null,
        },
        alerts_7d: {
          queued_count: Number(alertStats?.queued_count || 0),
          sent_count: Number(alertStats?.sent_count || 0),
          failed_count: Number(alertStats?.failed_count || 0),
        },
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_dashboard_failed" });
  }
});

router.get("/health", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const checks = {
      tables: {
        qrt_facts: await hasTable("qrt_facts"),
        qrt_exports: await hasTable("qrt_exports"),
        qrt_guardrails: await hasTable("qrt_guardrails"),
        qrt_governance_config: await hasTable("qrt_governance_config"),
        qrt_approvals: await hasTable("qrt_approvals"),
        qrt_submissions: await hasTable("qrt_submissions"),
        qrt_workflow_runs: await hasTable("qrt_workflow_runs"),
        qrt_webhooks: await hasTable("qrt_webhooks"),
        qrt_event_logs: await hasTable("qrt_event_logs"),
        qrt_archive_logs: await hasTable("qrt_archive_logs"),
        qrt_schedules: await hasTable("qrt_schedules"),
        qrt_tasks: await hasTable("qrt_tasks"),
        qrt_alert_rules: await hasTable("qrt_alert_rules"),
        qrt_alert_deliveries: await hasTable("qrt_alert_deliveries"),
        qrt_incident_acks: await hasTable("qrt_incident_acks"),
        qrt_incident_watch: await hasTable("qrt_incident_watch"),
        audit_trail: await hasTable("audit_trail"),
      },
      columns: {
        qrt_exports_status: await hasColumn("qrt_exports", "status"),
        qrt_exports_is_locked: await hasColumn("qrt_exports", "is_locked"),
        qrt_exports_xml_sha256: await hasColumn("qrt_exports", "xml_sha256"),
        qrt_exports_bundle_sha256: await hasColumn("qrt_exports", "bundle_sha256"),
        qrt_exports_locked_at: await hasColumn("qrt_exports", "locked_at"),
        qrt_exports_published_at: await hasColumn("qrt_exports", "published_at"),
      },
      storage: {
        output_qrt_dir: false,
      },
    };

    const outDir = path.join(process.cwd(), "storage", "output", "qrt");
    try {
      await fs.access(outDir);
      checks.storage.output_qrt_dir = true;
    } catch {
      checks.storage.output_qrt_dir = false;
    }

    const [latestRows] = await pool.query(
      `SELECT id, source, snapshot_date, status, is_locked, created_at, published_at, locked_at
       FROM qrt_exports
       WHERE captive_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [captiveId]
    );
    const [lockedRows] = await pool.query(
      `SELECT id, source, snapshot_date, status, is_locked, created_at, published_at, locked_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND is_locked = 1
       ORDER BY locked_at DESC, id DESC
       LIMIT 1`,
      [captiveId]
    );

    const hardOk =
      checks.tables.qrt_facts &&
      checks.tables.qrt_exports &&
      checks.tables.qrt_guardrails &&
      checks.tables.qrt_governance_config &&
      checks.tables.qrt_approvals &&
      checks.tables.qrt_submissions &&
      checks.tables.qrt_workflow_runs &&
      checks.tables.qrt_webhooks &&
      checks.tables.qrt_event_logs &&
      checks.tables.qrt_archive_logs &&
      checks.tables.qrt_schedules &&
      checks.tables.qrt_tasks &&
      checks.tables.qrt_alert_rules &&
      checks.tables.qrt_alert_deliveries &&
      checks.tables.qrt_incident_acks &&
      checks.tables.qrt_incident_watch &&
      checks.columns.qrt_exports_status &&
      checks.columns.qrt_exports_is_locked &&
      checks.columns.qrt_exports_xml_sha256 &&
      checks.columns.qrt_exports_bundle_sha256 &&
      checks.columns.qrt_exports_published_at;
    const softOk = checks.storage.output_qrt_dir;

    return res.status(hardOk ? 200 : 503).json({
      ok: hardOk,
      warnings: softOk ? [] : ["output_qrt_dir_missing_or_inaccessible"],
      checks,
      latest_export: latestRows?.[0] || null,
      latest_locked_export: lockedRows?.[0] || null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_health_failed" });
  }
});

router.post("/export/latest/publish-lock", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.body?.source || "real");
    const lockAfterPublish = parseBool(req.body?.lock_after_publish, true);
    const forcePublish = parseBool(req.body?.force_publish, false);

    const [rows] = await pool.query(
      `SELECT id, source, snapshot_date, status, is_locked, published_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND source = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [captiveId, source]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });
    const exportId = Number(row.id);

    if (Number(row.is_locked || 0) === 1) {
      return res.status(409).json({
        error: "qrt_export_already_locked",
        message: "Latest export is already locked.",
        export_id: exportId,
      });
    }

    const status = String(row.status || "").toLowerCase();
    if (status === "draft" || (status === "published" && forcePublish)) {
      await pool.query(
        `UPDATE qrt_exports
         SET status = 'published',
             published_at = NOW(),
             published_by_user_id = ?,
             published_by_name = ?
         WHERE id = ?
           AND captive_id = ?
         LIMIT 1`,
        [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
      );
      await logAudit(req.user?.uid || null, "qrt_export", exportId, "PUBLISH_WORKFLOW", {
        source,
        snapshot_date: toIsoDate(row.snapshot_date),
        force_publish: forcePublish,
      });
    } else if (status !== "published") {
      return res.status(409).json({
        error: "qrt_export_invalid_status_for_publish",
        status,
        export_id: exportId,
      });
    }

    if (lockAfterPublish) {
      await pool.query(
        `UPDATE qrt_exports
         SET is_locked = 1,
             locked_at = NOW(),
             locked_by_user_id = ?,
             locked_by_name = ?
         WHERE id = ?
           AND captive_id = ?
           AND is_locked = 0
         LIMIT 1`,
        [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
      );
      await logAudit(req.user?.uid || null, "qrt_export", exportId, "LOCK_WORKFLOW", {
        source,
        snapshot_date: toIsoDate(row.snapshot_date),
      });
    }

    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );

    return res.json({
      ok: true,
      workflow: {
        source,
        lock_after_publish: lockAfterPublish,
        force_publish: forcePublish,
      },
      export: outRows?.[0] || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_export_publish_lock_failed" });
  }
});

router.post("/workflow/full", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.body?.source || "real");
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const runId = Number(req.body?.run_id || 0) || null;
    const taxonomyVersion = String(req.body?.taxonomy_version || "2.8.0");
    const jurisdiction = String(req.body?.jurisdiction || "MT").slice(0, 2).toUpperCase();
    const requestedLei = String(req.body?.entity_lei || "").trim().toUpperCase();
    const workflowRequestKeyRaw = req.body?.workflow_request_key;
    const workflowRequestKey =
      workflowRequestKeyRaw == null ? null : String(workflowRequestKeyRaw).trim().slice(0, 128) || null;
    const failOnValidationError = parseBool(req.body?.fail_on_validation_error, true);
    const enforceGuardrails = parseBool(req.body?.enforce_guardrails, true);
    const publish = parseBool(req.body?.publish, true);
    const lock = parseBool(req.body?.lock, true);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    if (lock && !publish) return res.status(400).json({ error: "lock_requires_publish" });

    if (workflowRequestKey) {
      const [existingRows] = await pool.query(
        `SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
         FROM qrt_exports
         WHERE captive_id = ?
           AND source = ?
           AND snapshot_date = ?
           AND workflow_request_key = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [captiveId, source, snapshotDate, workflowRequestKey]
      );
      const existing = existingRows?.[0] || null;
      if (existing) {
        return res.status(200).json({
          ok: true,
          reused: true,
          workflow_request_key: workflowRequestKey,
          export: existing,
        });
      }
    }

    const buildOut = await buildQrtFacts({ captiveId, source, snapshotDate, runId });
    const validation = buildOut?.validation || (await validateQrtFacts({ captiveId, source, snapshotDate, runId, rebuild: false }));
    if (!validation.ok && failOnValidationError) {
      return res.status(422).json({ error: "qrt_validation_failed", validation });
    }
    if (publish && enforceGuardrails) {
      const g = await evaluateGuardrailBreaches({
        captiveId,
        source,
        snapshotDate,
      });
      if (!g.ok && g.guardrails.block_on_breach) {
        return res.status(422).json({ error: "guardrails_breach_blocking_workflow", guardrails_check: g, validation });
      }
    }

    const facts = await listQrtFacts({ captiveId, source, snapshotDate });
    if (!facts.length) return res.status(404).json({ error: "qrt_facts_not_found" });

    const captive = await loadCaptiveMeta(captiveId);
    const entityIdentifier = isLeiLike(requestedLei) ? requestedLei : String(captive?.code || `CAPTIVE-${captiveId}`);
    const entityScheme = isLeiLike(entityIdentifier)
      ? "http://standards.iso.org/iso/17442"
      : "https://myoptiwealth.fr/entity-id";
    const xml = buildXbrlLiteXml({
      facts,
      snapshotDate,
      captiveId,
      source,
      taxonomyVersion,
      jurisdiction,
      entityIdentifier,
      entityScheme,
    });
    const dir = path.join(process.cwd(), "storage", "output", "qrt");
    await fs.mkdir(dir, { recursive: true });
    const filename = `qrt_${captiveId}_${source}_${snapshotDate}_wf_${Date.now()}.xml`;
    const fullPath = path.join(dir, filename);
    await fs.writeFile(fullPath, xml, "utf8");
    const xmlSha256 = sha256String(xml);

    const [ins] = await pool.query(
      `INSERT INTO qrt_exports
         (captive_id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, xml_sha256, facts_count, status, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        captiveId,
        source,
        snapshotDate,
        workflowRequestKey,
        taxonomyVersion,
        jurisdiction,
        fullPath,
        xmlSha256,
        facts.length,
        "draft",
        req.user?.uid || null,
        req.user?.email || null,
      ]
    );
    const exportId = Number(ins?.insertId || 0);
    await logAudit(req.user?.uid || null, "qrt_export", exportId, "WORKFLOW_CREATE_DRAFT", {
      source,
      snapshot_date: snapshotDate,
      workflow_request_key: workflowRequestKey,
      file_path: fullPath,
      facts_count: facts.length,
      taxonomy_version: taxonomyVersion,
      jurisdiction,
    });
    await emitQrtEvent(captiveId, "workflow.full.draft_created", {
      workflow_request_key: workflowRequestKey,
      export_id: exportId,
      source,
      snapshot_date: snapshotDate,
      file_path: fullPath,
      xml_sha256: xmlSha256,
    });

    if (publish) {
      await pool.query(
        `UPDATE qrt_exports
         SET status = 'published',
             published_at = NOW(),
             published_by_user_id = ?,
             published_by_name = ?
         WHERE id = ?
           AND captive_id = ?
         LIMIT 1`,
        [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
      );
      await logAudit(req.user?.uid || null, "qrt_export", exportId, "WORKFLOW_PUBLISH", {
        source,
        snapshot_date: snapshotDate,
      });
      await emitQrtEvent(captiveId, "workflow.full.published", {
        workflow_request_key: workflowRequestKey,
        export_id: exportId,
        source,
        snapshot_date: snapshotDate,
      });
    }

    if (lock) {
      const gov = await getGovernanceConfig(captiveId);
      if (gov.require_double_validation) {
        const approved = await hasApprovedDoubleValidation(exportId);
        if (!approved) {
          return res.status(409).json({
            error: "double_validation_required",
            message: "Approval is required before lock.",
            export_id: exportId,
          });
        }
      }
      await pool.query(
        `UPDATE qrt_exports
         SET is_locked = 1,
             locked_at = NOW(),
             locked_by_user_id = ?,
             locked_by_name = ?
         WHERE id = ?
           AND captive_id = ?
         LIMIT 1`,
        [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
      );
      await logAudit(req.user?.uid || null, "qrt_export", exportId, "WORKFLOW_LOCK", {
        source,
        snapshot_date: snapshotDate,
      });
      await emitQrtEvent(captiveId, "workflow.full.locked", {
        workflow_request_key: workflowRequestKey,
        export_id: exportId,
        source,
        snapshot_date: snapshotDate,
      });
    }

    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, taxonomy_version, jurisdiction, file_path, facts_count, status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );

    return res.status(201).json({
      ok: true,
      workflow: {
        source,
        snapshot_date: snapshotDate,
        workflow_request_key: workflowRequestKey,
        publish,
        lock,
        enforce_guardrails: enforceGuardrails,
        fail_on_validation_error: failOnValidationError,
      },
      validation,
      export: outRows?.[0] || null,
      warnings: isLeiLike(entityIdentifier) ? [] : ["entity_identifier_is_not_lei"],
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_full_failed" });
  }
});

router.post("/workflow/full/preview", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.body?.source || "real");
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const runId = Number(req.body?.run_id || 0) || null;
    const taxonomyVersion = String(req.body?.taxonomy_version || "2.8.0");
    const jurisdiction = String(req.body?.jurisdiction || "MT").slice(0, 2).toUpperCase();
    const requestedLei = String(req.body?.entity_lei || "").trim().toUpperCase();
    const workflowRequestKeyRaw = req.body?.workflow_request_key;
    const workflowRequestKey =
      workflowRequestKeyRaw == null ? null : String(workflowRequestKeyRaw).trim().slice(0, 128) || null;
    const failOnValidationError = parseBool(req.body?.fail_on_validation_error, true);
    const publish = parseBool(req.body?.publish, true);
    const lock = parseBool(req.body?.lock, true);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    if (lock && !publish) return res.status(400).json({ error: "lock_requires_publish" });

    let existing = null;
    if (workflowRequestKey) {
      const [existingRows] = await pool.query(
        `SELECT id, source, snapshot_date, workflow_request_key, status, is_locked, created_at
         FROM qrt_exports
         WHERE captive_id = ?
           AND source = ?
           AND snapshot_date = ?
           AND workflow_request_key = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [captiveId, source, snapshotDate, workflowRequestKey]
      );
      existing = existingRows?.[0] || null;
    }

    const buildOut = await buildQrtFacts({ captiveId, source, snapshotDate, runId });
    const validation = buildOut?.validation || (await validateQrtFacts({ captiveId, source, snapshotDate, runId, rebuild: false }));
    if (!validation.ok && failOnValidationError) {
      return res.status(422).json({ error: "qrt_validation_failed", validation });
    }

    const facts = await listQrtFacts({ captiveId, source, snapshotDate });
    if (!facts.length) return res.status(404).json({ error: "qrt_facts_not_found" });

    const captive = await loadCaptiveMeta(captiveId);
    const entityIdentifier = isLeiLike(requestedLei) ? requestedLei : String(captive?.code || `CAPTIVE-${captiveId}`);
    const entityScheme = isLeiLike(entityIdentifier)
      ? "http://standards.iso.org/iso/17442"
      : "https://myoptiwealth.fr/entity-id";
    const xml = buildXbrlLiteXml({
      facts,
      snapshotDate,
      captiveId,
      source,
      taxonomyVersion,
      jurisdiction,
      entityIdentifier,
      entityScheme,
    });

    return res.json({
      ok: true,
      preview: true,
      workflow: {
        source,
        snapshot_date: snapshotDate,
        workflow_request_key: workflowRequestKey,
        publish,
        lock,
        fail_on_validation_error: failOnValidationError,
      },
      existing_workflow_export: existing,
      validation,
      export_preview: {
        facts_count: facts.length,
        taxonomy_version: taxonomyVersion,
        jurisdiction,
        entity_identifier: entityIdentifier,
        entity_scheme: entityScheme,
        xml_size_bytes: Buffer.byteLength(xml, "utf8"),
      },
      warnings: isLeiLike(entityIdentifier) ? [] : ["entity_identifier_is_not_lei"],
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_full_preview_failed" });
  }
});

router.get("/workflow/list", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const source = String(req.query?.source || "").trim().toLowerCase();
    const status = String(req.query?.status || "").trim().toLowerCase();
    const onlyWithKey = parseBool(req.query?.only_with_key, true);
    const dateFrom = toIsoDate(req.query?.date_from);
    const dateTo = toIsoDate(req.query?.date_to);
    const page = Math.max(Number(req.query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 200);
    const offset = (page - 1) * limit;

    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (source === "real" || source === "simulation") {
      filters.push("source = ?");
      params.push(source);
    }
    if (status === "draft" || status === "published") {
      filters.push("status = ?");
      params.push(status);
    }
    if (onlyWithKey) filters.push("workflow_request_key IS NOT NULL AND workflow_request_key <> ''");
    if (dateFrom) {
      filters.push("snapshot_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push("snapshot_date <= ?");
      params.push(dateTo);
    }
    const whereSql = `WHERE ${filters.join(" AND ")}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT workflow_request_key, source, snapshot_date
         FROM qrt_exports
         ${whereSql}
         GROUP BY workflow_request_key, source, snapshot_date
       ) x`,
      params
    );
    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await pool.query(
      `SELECT e.id, e.source, e.snapshot_date, e.workflow_request_key, e.taxonomy_version, e.jurisdiction, e.file_path, e.facts_count,
              e.status, e.is_locked, e.locked_at, e.locked_by_user_id, e.locked_by_name,
              e.published_at, e.published_by_user_id, e.published_by_name,
              e.created_by_user_id, e.created_by_name, e.created_at
       FROM qrt_exports e
       JOIN (
         SELECT workflow_request_key, source, snapshot_date, MAX(created_at) AS max_created_at
         FROM qrt_exports
         ${whereSql}
         GROUP BY workflow_request_key, source, snapshot_date
       ) m
         ON m.workflow_request_key <=> e.workflow_request_key
        AND m.source = e.source
        AND m.snapshot_date = e.snapshot_date
        AND m.max_created_at = e.created_at
       WHERE e.captive_id = ?
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      [...params, captiveId, limit, offset]
    );

    return res.json({
      ok: true,
      filters: {
        source: source || null,
        status: status || null,
        only_with_key: onlyWithKey,
        date_from: dateFrom,
        date_to: dateTo,
      },
      page,
      limit,
      total,
      items: rows || [],
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_list_failed" });
  }
});

router.delete("/workflow/:workflowRequestKey", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.query?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.query?.snapshot_date);
    const deleteFiles = parseBool(req.query?.delete_files, false) || parseBool(req.body?.delete_files, false);

    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, status, is_locked, file_path
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at DESC, id DESC";
    const [rows] = await pool.query(sql, params);
    const items = rows || [];
    if (!items.length) return res.status(404).json({ error: "qrt_workflow_not_found" });

    const toDelete = items.filter((r) => String(r.status || "").toLowerCase() === "draft" && Number(r.is_locked || 0) === 0);
    const kept = items.filter((r) => !toDelete.includes(r));

    let deletedCount = 0;
    let fileDeletedCount = 0;
    const fileWarnings = [];
    for (const r of toDelete) {
      await pool.query(`DELETE FROM qrt_exports WHERE id = ? AND captive_id = ? LIMIT 1`, [Number(r.id), captiveId]);
      deletedCount += 1;
      if (deleteFiles) {
        try {
          const p = String(r.file_path || "");
          if (p) {
            await fs.unlink(p);
            fileDeletedCount += 1;
          }
        } catch {
          fileWarnings.push({ export_id: Number(r.id), warning: "file_delete_failed_or_missing" });
        }
      }
      await logAudit(req.user?.uid || null, "qrt_export", Number(r.id), "DELETE_WORKFLOW_DRAFT", {
        workflow_request_key: workflowRequestKey,
        source: String(r.source || ""),
        snapshot_date: toIsoDate(r.snapshot_date),
        delete_files: deleteFiles,
      });
    }

    return res.json({
      ok: true,
      workflow_request_key: workflowRequestKey,
      deleted_draft_count: deletedCount,
      deleted_file_count: fileDeletedCount,
      kept_count: kept.length,
      kept_items: kept.map((r) => ({
        id: Number(r.id),
        source: r.source,
        snapshot_date: r.snapshot_date,
        status: r.status,
        is_locked: Number(r.is_locked || 0),
      })),
      file_warnings: fileWarnings,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_delete_failed" });
  }
});

router.get("/workflow/:workflowRequestKey/report", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.query?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.query?.snapshot_date);

    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, facts_count,
             status, is_locked, locked_at, locked_by_user_id, locked_by_name,
             published_at, published_by_user_id, published_by_name,
             created_by_user_id, created_by_name, created_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at ASC, id ASC";
    const [exportsRows] = await pool.query(sql, params);
    const exportsList = exportsRows || [];
    if (!exportsList.length) return res.status(404).json({ error: "qrt_workflow_not_found" });

    const exportIds = exportsList.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let auditRows = [];
    if (exportIds.length) {
      const placeholders = exportIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT id, user_id, entity, entity_id, action, payload, created_at
         FROM audit_trail
         WHERE entity = 'qrt_export'
           AND entity_id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
        exportIds
      );
      auditRows = rows || [];
    }

    const latest = exportsList[exportsList.length - 1] || null;
    const hasLocked = exportsList.some((e) => Number(e.is_locked || 0) === 1);
    const hasPublished = exportsList.some((e) => String(e.status || "").toLowerCase() === "published");
    const state = hasLocked ? "locked" : hasPublished ? "published" : "draft";

    return res.json({
      ok: true,
      workflow_request_key: workflowRequestKey,
      state,
      summary: {
        exports_count: exportsList.length,
        audits_count: auditRows.length,
        first_created_at: exportsList[0]?.created_at || null,
        latest_created_at: latest?.created_at || null,
        latest_export_id: latest?.id || null,
      },
      exports: exportsList,
      audit: auditRows,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_report_failed" });
  }
});

router.get("/workflow/:workflowRequestKey/report/download", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.query?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.query?.snapshot_date);

    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, facts_count,
             status, is_locked, locked_at, locked_by_user_id, locked_by_name,
             published_at, published_by_user_id, published_by_name,
             created_by_user_id, created_by_name, created_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at ASC, id ASC";
    const [exportsRows] = await pool.query(sql, params);
    const exportsList = exportsRows || [];
    if (!exportsList.length) return res.status(404).json({ error: "qrt_workflow_not_found" });

    const exportIds = exportsList.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let auditRows = [];
    if (exportIds.length) {
      const placeholders = exportIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT id, user_id, entity, entity_id, action, payload, created_at
         FROM audit_trail
         WHERE entity = 'qrt_export'
           AND entity_id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
        exportIds
      );
      auditRows = rows || [];
    }

    const latest = exportsList[exportsList.length - 1] || null;
    const hasLocked = exportsList.some((e) => Number(e.is_locked || 0) === 1);
    const hasPublished = exportsList.some((e) => String(e.status || "").toLowerCase() === "published");
    const state = hasLocked ? "locked" : hasPublished ? "published" : "draft";

    const reportJson = {
      ok: true,
      workflow_request_key: workflowRequestKey,
      state,
      summary: {
        exports_count: exportsList.length,
        audits_count: auditRows.length,
        first_created_at: exportsList[0]?.created_at || null,
        latest_created_at: latest?.created_at || null,
        latest_export_id: latest?.id || null,
      },
      exports: exportsList,
      audit: auditRows,
    };

    const exportsCsv = toCsv(
      exportsList.map((r) => ({
        id: r.id,
        source: r.source,
        snapshot_date: r.snapshot_date,
        workflow_request_key: r.workflow_request_key,
        taxonomy_version: r.taxonomy_version,
        jurisdiction: r.jurisdiction,
        file_path: r.file_path,
        facts_count: r.facts_count,
        status: r.status,
        is_locked: r.is_locked,
        locked_at: r.locked_at,
        locked_by_user_id: r.locked_by_user_id,
        locked_by_name: r.locked_by_name,
        published_at: r.published_at,
        published_by_user_id: r.published_by_user_id,
        published_by_name: r.published_by_name,
        created_by_user_id: r.created_by_user_id,
        created_by_name: r.created_by_name,
        created_at: r.created_at,
      }))
    );
    const auditCsv = toCsv(
      auditRows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        entity: r.entity,
        entity_id: r.entity_id,
        action: r.action,
        payload: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload),
        created_at: r.created_at,
      }))
    );

    const zipName = `qrt_workflow_report_${workflowRequestKey}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${zipName}`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    archive.pipe(res);
    archive.append(JSON.stringify(reportJson, null, 2), { name: "report.json" });
    archive.append(exportsCsv || "id\n", { name: "exports.csv" });
    archive.append(auditCsv || "id\n", { name: "audit.csv" });
    await archive.finalize();
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_report_download_failed" });
  }
});

router.get("/workflow/:workflowRequestKey/timeline", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.query?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.query?.snapshot_date);

    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, workflow_request_key, status, is_locked, file_path, facts_count,
             published_at, locked_at, created_by_user_id, created_by_name, created_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at ASC, id ASC";
    const [exportRows] = await pool.query(sql, params);
    const exportsList = exportRows || [];
    if (!exportsList.length) return res.status(404).json({ error: "qrt_workflow_not_found" });

    const exportIds = exportsList.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let auditRows = [];
    if (exportIds.length) {
      const placeholders = exportIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT id, user_id, entity_id, action, payload, created_at
         FROM audit_trail
         WHERE entity = 'qrt_export'
           AND entity_id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
        exportIds
      );
      auditRows = rows || [];
    }

    const events = [];
    for (const e of exportsList) {
      events.push({
        ts: e.created_at,
        type: "export_created",
        export_id: Number(e.id),
        source: e.source,
        snapshot_date: e.snapshot_date,
        status: e.status,
        is_locked: Number(e.is_locked || 0),
        facts_count: Number(e.facts_count || 0),
        actor_user_id: e.created_by_user_id || null,
        actor_name: e.created_by_name || null,
      });
      if (e.published_at) {
        events.push({
          ts: e.published_at,
          type: "export_published_marker",
          export_id: Number(e.id),
          source: e.source,
          snapshot_date: e.snapshot_date,
        });
      }
      if (e.locked_at) {
        events.push({
          ts: e.locked_at,
          type: "export_locked_marker",
          export_id: Number(e.id),
          source: e.source,
          snapshot_date: e.snapshot_date,
        });
      }
    }
    for (const a of auditRows) {
      events.push({
        ts: a.created_at,
        type: "audit_action",
        export_id: Number(a.entity_id || 0) || null,
        action: a.action || null,
        actor_user_id: a.user_id || null,
        payload: a.payload || null,
      });
    }

    events.sort((a, b) => {
      const ta = String(a.ts || "");
      const tb = String(b.ts || "");
      if (ta !== tb) return ta.localeCompare(tb);
      const ea = Number(a.export_id || 0);
      const eb = Number(b.export_id || 0);
      return ea - eb;
    });

    return res.json({
      ok: true,
      workflow_request_key: workflowRequestKey,
      exports_count: exportsList.length,
      audit_count: auditRows.length,
      events_count: events.length,
      events,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_timeline_failed" });
  }
});

router.get("/workflow/:workflowRequestKey/timeline.csv", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.query?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.query?.snapshot_date);

    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, workflow_request_key, status, is_locked, file_path, facts_count,
             published_at, locked_at, created_by_user_id, created_by_name, created_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at ASC, id ASC";
    const [exportRows] = await pool.query(sql, params);
    const exportsList = exportRows || [];
    if (!exportsList.length) return res.status(404).json({ error: "qrt_workflow_not_found" });

    const exportIds = exportsList.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let auditRows = [];
    if (exportIds.length) {
      const placeholders = exportIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT id, user_id, entity_id, action, payload, created_at
         FROM audit_trail
         WHERE entity = 'qrt_export'
           AND entity_id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
        exportIds
      );
      auditRows = rows || [];
    }

    const events = [];
    for (const e of exportsList) {
      events.push({
        ts: e.created_at,
        type: "export_created",
        export_id: Number(e.id),
        source: e.source,
        snapshot_date: e.snapshot_date,
        status: e.status,
        is_locked: Number(e.is_locked || 0),
        facts_count: Number(e.facts_count || 0),
        actor_user_id: e.created_by_user_id || null,
        actor_name: e.created_by_name || null,
        action: null,
        payload: null,
      });
      if (e.published_at) {
        events.push({
          ts: e.published_at,
          type: "export_published_marker",
          export_id: Number(e.id),
          source: e.source,
          snapshot_date: e.snapshot_date,
          status: e.status,
          is_locked: Number(e.is_locked || 0),
          facts_count: Number(e.facts_count || 0),
          actor_user_id: null,
          actor_name: null,
          action: null,
          payload: null,
        });
      }
      if (e.locked_at) {
        events.push({
          ts: e.locked_at,
          type: "export_locked_marker",
          export_id: Number(e.id),
          source: e.source,
          snapshot_date: e.snapshot_date,
          status: e.status,
          is_locked: Number(e.is_locked || 0),
          facts_count: Number(e.facts_count || 0),
          actor_user_id: null,
          actor_name: null,
          action: null,
          payload: null,
        });
      }
    }
    for (const a of auditRows) {
      events.push({
        ts: a.created_at,
        type: "audit_action",
        export_id: Number(a.entity_id || 0) || null,
        source: null,
        snapshot_date: null,
        status: null,
        is_locked: null,
        facts_count: null,
        actor_user_id: a.user_id || null,
        actor_name: null,
        action: a.action || null,
        payload: typeof a.payload === "string" ? a.payload : JSON.stringify(a.payload),
      });
    }

    events.sort((a, b) => {
      const ta = String(a.ts || "");
      const tb = String(b.ts || "");
      if (ta !== tb) return ta.localeCompare(tb);
      return Number(a.export_id || 0) - Number(b.export_id || 0);
    });

    const csv = toCsv(events);
    const filename = `qrt_workflow_timeline_${workflowRequestKey}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    return res.send(csv || "ts,type,export_id\n");
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_timeline_csv_failed" });
  }
});

router.get("/workflow/runs", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const status = String(req.query?.status || "").trim().toLowerCase();
    const source = String(req.query?.source || "").trim().toLowerCase();
    const dateFrom = toIsoDate(req.query?.date_from);
    const dateTo = toIsoDate(req.query?.date_to);
    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (["running", "success", "failed"].includes(status)) {
      filters.push("status = ?");
      params.push(status);
    }
    if (source === "real" || source === "simulation") {
      filters.push("source = ?");
      params.push(source);
    }
    if (dateFrom) {
      filters.push("snapshot_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push("snapshot_date <= ?");
      params.push(dateTo);
    }
    const [rows] = await pool.query(
      `SELECT id, workflow_request_key, source, snapshot_date, status, started_by_user_id, started_by_name, started_at, ended_at, error_message
       FROM qrt_workflow_runs
       WHERE ${filters.join(" AND ")}
       ORDER BY started_at DESC, id DESC
       LIMIT 300`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "workflow_runs_list_failed" });
  }
});

router.get("/workflow/runs/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ error: "invalid_run_id" });
    const [rows] = await pool.query(
      `SELECT id, captive_id, workflow_request_key, source, snapshot_date, status, started_by_user_id, started_by_name, started_at, ended_at, error_message
       FROM qrt_workflow_runs
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [runId, captiveId]
    );
    const run = rows?.[0] || null;
    if (!run) return res.status(404).json({ error: "workflow_run_not_found" });

    let exportRow = null;
    if (run.workflow_request_key) {
      const [expRows] = await pool.query(
        `SELECT id, source, snapshot_date, status, is_locked, created_at
         FROM qrt_exports
         WHERE captive_id = ?
           AND workflow_request_key = ?
           AND source = ?
           AND snapshot_date = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [captiveId, String(run.workflow_request_key), String(run.source), toIsoDate(run.snapshot_date)]
      );
      exportRow = expRows?.[0] || null;
    }
    return res.json({ ok: true, run, export: exportRow });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "workflow_run_get_failed" });
  }
});

router.get("/workflow/:workflowRequestKey", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });

    const source = String(req.query?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.query?.snapshot_date);
    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, facts_count,
             status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";

    const [rows] = await pool.query(sql, params);
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_workflow_not_found" });

    return res.json({
      ok: true,
      workflow_request_key: workflowRequestKey,
      export: row,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_lookup_failed" });
  }
});

router.post("/workflow/:workflowRequestKey/retry", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.body?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const publish = parseBool(req.body?.publish, true);
    const lock = parseBool(req.body?.lock, true);
    const forcePublish = parseBool(req.body?.force_publish, false);
    if (lock && !publish) return res.status(400).json({ error: "lock_requires_publish" });

    const params = [captiveId, workflowRequestKey];
    let sql = `
      SELECT id, source, snapshot_date, workflow_request_key, status, is_locked, published_at
      FROM qrt_exports
      WHERE captive_id = ?
        AND workflow_request_key = ?
    `;
    if (source === "real" || source === "simulation") {
      sql += " AND source = ? ";
      params.push(source);
    }
    if (snapshotDate) {
      sql += " AND snapshot_date = ? ";
      params.push(snapshotDate);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
    const [rows] = await pool.query(sql, params);
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_workflow_not_found" });

    const exportId = Number(row.id);
    if (Number(row.is_locked || 0) === 1) {
      const [lockedRows] = await pool.query(
        `SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, facts_count,
                status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
         FROM qrt_exports
         WHERE id = ?
         LIMIT 1`,
        [exportId]
      );
      return res.json({ ok: true, no_op: true, reason: "already_locked", export: lockedRows?.[0] || null });
    }

    const status = String(row.status || "").toLowerCase();
    if (publish) {
      if (status === "draft" || (status === "published" && forcePublish)) {
        await pool.query(
          `UPDATE qrt_exports
           SET status = 'published',
               published_at = NOW(),
               published_by_user_id = ?,
               published_by_name = ?
           WHERE id = ?
             AND captive_id = ?
           LIMIT 1`,
          [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
        );
        await logAudit(req.user?.uid || null, "qrt_export", exportId, "WORKFLOW_RETRY_PUBLISH", {
          workflow_request_key: workflowRequestKey,
          source: String(row.source || ""),
          snapshot_date: toIsoDate(row.snapshot_date),
          force_publish: forcePublish,
        });
      } else if (status !== "published") {
        return res.status(409).json({ error: "qrt_export_invalid_status_for_publish", status, export_id: exportId });
      }
    }

    if (lock) {
      const [[state]] = await pool.query(`SELECT status, is_locked FROM qrt_exports WHERE id = ? LIMIT 1`, [exportId]);
      if (Number(state?.is_locked || 0) === 0) {
        if (String(state?.status || "").toLowerCase() !== "published") {
          return res.status(409).json({ error: "qrt_export_must_be_published_before_lock", export_id: exportId });
        }
        await pool.query(
          `UPDATE qrt_exports
           SET is_locked = 1,
               locked_at = NOW(),
               locked_by_user_id = ?,
               locked_by_name = ?
           WHERE id = ?
             AND captive_id = ?
           LIMIT 1`,
          [req.user?.uid || null, req.user?.email || null, exportId, captiveId]
        );
        await logAudit(req.user?.uid || null, "qrt_export", exportId, "WORKFLOW_RETRY_LOCK", {
          workflow_request_key: workflowRequestKey,
          source: String(row.source || ""),
          snapshot_date: toIsoDate(row.snapshot_date),
        });
      }
    }

    const [outRows] = await pool.query(
      `SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, facts_count,
              status, is_locked, locked_at, locked_by_user_id, locked_by_name, published_at, published_by_user_id, published_by_name, created_at
       FROM qrt_exports
       WHERE id = ?
       LIMIT 1`,
      [exportId]
    );

    return res.json({
      ok: true,
      workflow_request_key: workflowRequestKey,
      workflow: { publish, lock, force_publish: forcePublish },
      export: outRows?.[0] || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "qrt_workflow_retry_failed" });
  }
});

router.post("/closure/monthly", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.body?.source || "real");
    const year = Number(req.body?.year || 0);
    const month = Number(req.body?.month || 0);
    const snapshotDate = endOfMonthIso(year, month);
    const publish = parseBool(req.body?.publish, true);
    const lock = parseBool(req.body?.lock, true);
    const enforceGuardrails = parseBool(req.body?.enforce_guardrails, true);
    if (!snapshotDate) return res.status(400).json({ error: "invalid_year_or_month" });
    if (lock && !publish) return res.status(400).json({ error: "lock_requires_publish" });
    const workflowRequestKey =
      String(req.body?.workflow_request_key || "").trim().slice(0, 128) || `monthly_${source}_${snapshotDate}`;

    const runId = await startWorkflowRun({
      captiveId,
      workflowRequestKey,
      source,
      snapshotDate,
      user: req.user,
    });
    try {
      await buildQrtFacts({ captiveId, source, snapshotDate, runId: null });
      const validation = await validateQrtFacts({ captiveId, source, snapshotDate, runId: null, rebuild: false });
      if (!validation.ok) {
        await finishWorkflowRun(runId, "failed", "validation_failed");
        return res.status(422).json({ error: "qrt_validation_failed", validation });
      }
      if (publish && enforceGuardrails) {
        const g = await evaluateGuardrailBreaches({ captiveId, source, snapshotDate });
        if (!g.ok && g.guardrails.block_on_breach) {
          await finishWorkflowRun(runId, "failed", "guardrails_breach");
          return res.status(422).json({ error: "guardrails_breach_blocking_workflow", guardrails_check: g, validation });
        }
      }
      const facts = await listQrtFacts({ captiveId, source, snapshotDate });
      if (!facts.length) {
        await finishWorkflowRun(runId, "failed", "facts_not_found");
        return res.status(404).json({ error: "qrt_facts_not_found" });
      }

      const captive = await loadCaptiveMeta(captiveId);
      const entityIdentifier = String(captive?.code || `CAPTIVE-${captiveId}`);
      const xml = buildXbrlLiteXml({
        facts,
        snapshotDate,
        captiveId,
        source,
        taxonomyVersion: String(req.body?.taxonomy_version || "2.8.0"),
        jurisdiction: String(req.body?.jurisdiction || "MT").slice(0, 2).toUpperCase(),
        entityIdentifier,
        entityScheme: "https://myoptiwealth.fr/entity-id",
      });
      const dir = path.join(process.cwd(), "storage", "output", "qrt");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `qrt_${captiveId}_${source}_${snapshotDate}_monthly_${Date.now()}.xml`);
      await fs.writeFile(filePath, xml, "utf8");
      const xmlSha256 = sha256String(xml);

      const [ins] = await pool.query(
        `INSERT INTO qrt_exports
          (captive_id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, xml_sha256, facts_count, status, created_by_user_id, created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          captiveId,
          source,
          snapshotDate,
          workflowRequestKey,
          String(req.body?.taxonomy_version || "2.8.0"),
          String(req.body?.jurisdiction || "MT").slice(0, 2).toUpperCase(),
          filePath,
          xmlSha256,
          facts.length,
          "draft",
          req.user?.uid || null,
          req.user?.email || null,
        ]
      );
      const exportId = Number(ins?.insertId || 0);

      if (publish) {
        await pool.query(
          `UPDATE qrt_exports
           SET status = 'published',
               published_at = NOW(),
               published_by_user_id = ?,
               published_by_name = ?
           WHERE id = ?
           LIMIT 1`,
          [req.user?.uid || null, req.user?.email || null, exportId]
        );
      }
      if (lock) {
        const gov = await getGovernanceConfig(captiveId);
        if (gov.require_double_validation) {
          const approved = await hasApprovedDoubleValidation(exportId);
          if (!approved) {
            await finishWorkflowRun(runId, "failed", "double_validation_required");
            return res.status(409).json({ error: "double_validation_required", export_id: exportId });
          }
        }
        await pool.query(
          `UPDATE qrt_exports
           SET is_locked = 1,
               locked_at = NOW(),
               locked_by_user_id = ?,
               locked_by_name = ?
           WHERE id = ?
           LIMIT 1`,
          [req.user?.uid || null, req.user?.email || null, exportId]
        );
      }

      await finishWorkflowRun(runId, "success", null);
      const [outRows] = await pool.query(
        `SELECT id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, xml_sha256, facts_count, status, is_locked, created_at
         FROM qrt_exports
         WHERE id = ?
         LIMIT 1`,
        [exportId]
      );
      return res.status(201).json({
        ok: true,
        monthly_closure: { year, month, snapshot_date: snapshotDate, source, workflow_request_key: workflowRequestKey },
        export: outRows?.[0] || null,
      });
    } catch (err) {
      await finishWorkflowRun(runId, "failed", err?.message || "closure_monthly_failed");
      throw err;
    }
  } catch (err) {
    return res.status(400).json({ error: err?.message || "closure_monthly_failed" });
  }
});

router.get("/access", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const capabilities = qrtCapabilities(req);
    return res.json({
      ok: true,
      captive_id: captiveId,
      roles: Array.isArray(req.user?.roles) ? req.user.roles : [],
      membership_role: req.user?.membership_role || null,
      capabilities,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "access_failed" });
  }
});

router.get("/governance", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const cfg = await getGovernanceConfig(captiveId);
    return res.json({ ok: true, governance: cfg });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "governance_get_failed" });
  }
});

router.put("/governance", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const requireDoubleValidation = parseBool(req.body?.require_double_validation, false);
    await pool.query(
      `INSERT INTO qrt_governance_config (captive_id, require_double_validation, updated_by_user_id, updated_by_name)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE
         require_double_validation = VALUES(require_double_validation),
         updated_by_user_id = VALUES(updated_by_user_id),
         updated_by_name = VALUES(updated_by_name),
         updated_at = CURRENT_TIMESTAMP`,
      [captiveId, requireDoubleValidation ? 1 : 0, req.user?.uid || null, req.user?.email || null]
    );
    const cfg = await getGovernanceConfig(captiveId);
    return res.json({ ok: true, governance: cfg });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "governance_put_failed" });
  }
});

router.get("/guardrails", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.query?.source || "real");
    const out = await getGuardrails(captiveId, source);
    return res.json({ ok: true, guardrails: out });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "guardrails_get_failed" });
  }
});

router.put("/guardrails", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.body?.source || "real");
    const numOrNull = (v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const maxDeltaScr = numOrNull(req.body?.max_delta_scr_eur);
    const maxDeltaMcr = numOrNull(req.body?.max_delta_mcr_eur);
    const maxDeltaOwnFunds = numOrNull(req.body?.max_delta_own_funds_eur);
    const maxRatioDrop = numOrNull(req.body?.max_ratio_drop_pct);
    const blockOnBreach = parseBool(req.body?.block_on_breach, true);
    await pool.query(
      `INSERT INTO qrt_guardrails
        (captive_id, source, max_delta_scr_eur, max_delta_mcr_eur, max_delta_own_funds_eur, max_ratio_drop_pct, block_on_breach, updated_by_user_id, updated_by_name)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         max_delta_scr_eur = VALUES(max_delta_scr_eur),
         max_delta_mcr_eur = VALUES(max_delta_mcr_eur),
         max_delta_own_funds_eur = VALUES(max_delta_own_funds_eur),
         max_ratio_drop_pct = VALUES(max_ratio_drop_pct),
         block_on_breach = VALUES(block_on_breach),
         updated_by_user_id = VALUES(updated_by_user_id),
         updated_by_name = VALUES(updated_by_name),
         updated_at = CURRENT_TIMESTAMP`,
      [captiveId, source, maxDeltaScr, maxDeltaMcr, maxDeltaOwnFunds, maxRatioDrop, blockOnBreach ? 1 : 0, req.user?.uid || null, req.user?.email || null]
    );
    const out = await getGuardrails(captiveId, source);
    return res.json({ ok: true, guardrails: out });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "guardrails_put_failed" });
  }
});

router.post("/guardrails/check", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const source = String(req.body?.source || "real");
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const previousSnapshotDate = toIsoDate(req.body?.previous_snapshot_date);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const out = await evaluateGuardrailBreaches({ captiveId, source, snapshotDate, previousSnapshotDate });
    return res.status(out.ok ? 200 : 422).json({ ok: out.ok, check: out });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "guardrails_check_failed" });
  }
});

router.get("/approvals", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const status = String(req.query?.status || "").trim().toLowerCase();
    const exportId = Number(req.query?.export_id || 0);
    const filters = ["e.captive_id = ?"];
    const params = [captiveId];
    if (exportId > 0) {
      filters.push("a.export_id = ?");
      params.push(exportId);
    }
    if (["pending", "approved", "rejected"].includes(status)) {
      filters.push("a.status = ?");
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT a.id, a.export_id, a.status, a.requested_by_user_id, a.requested_by_name, a.decided_by_user_id, a.decided_by_name, a.decision_at, a.comment_text, a.created_at,
              e.source, e.snapshot_date
       FROM qrt_approvals a
       JOIN qrt_exports e ON e.id = a.export_id
       WHERE ${filters.join(" AND ")}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 300`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "approvals_list_failed" });
  }
});

router.post("/approvals/request", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.body?.export_id || 0);
    const comment = String(req.body?.comment_text || "").trim().slice(0, 500) || null;
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });
    const [expRows] = await pool.query(
      `SELECT id, source, snapshot_date, is_locked
       FROM qrt_exports
       WHERE id = ? AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    const exp = expRows?.[0] || null;
    if (!exp) return res.status(404).json({ error: "qrt_export_not_found" });
    if (Number(exp.is_locked || 0) === 1) return res.status(409).json({ error: "qrt_export_locked" });
    const [ins] = await pool.query(
      `INSERT INTO qrt_approvals
        (export_id, status, requested_by_user_id, requested_by_name, comment_text)
       VALUES (?, 'pending', ?, ?, ?)`,
      [exportId, req.user?.uid || null, req.user?.email || null, comment]
    );
    const approvalId = Number(ins?.insertId || 0);
    await emitQrtEvent(captiveId, "approval.requested", { approval_id: approvalId, export_id: exportId });
    return res.status(201).json({ ok: true, approval_id: approvalId, export_id: exportId });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "approval_request_failed" });
  }
});

router.post("/approvals/:id(\\d+)/approve", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const approvalId = Number(req.params.id || 0);
    if (!approvalId) return res.status(400).json({ error: "invalid_approval_id" });
    const [rows] = await pool.query(
      `SELECT a.id, a.export_id, a.status, a.requested_by_user_id, e.captive_id
       FROM qrt_approvals a
       JOIN qrt_exports e ON e.id = a.export_id
       WHERE a.id = ?
       LIMIT 1`,
      [approvalId]
    );
    const row = rows?.[0] || null;
    if (!row || Number(row.captive_id) !== captiveId) return res.status(404).json({ error: "approval_not_found" });
    if (String(row.status) !== "pending") return res.status(409).json({ error: "approval_not_pending" });
    if (Number(row.requested_by_user_id || 0) === Number(req.user?.uid || 0)) {
      return res.status(409).json({ error: "self_approval_forbidden" });
    }
    await pool.query(
      `UPDATE qrt_approvals
       SET status = 'approved',
           decided_by_user_id = ?,
           decided_by_name = ?,
           decision_at = NOW()
       WHERE id = ?
       LIMIT 1`,
      [req.user?.uid || null, req.user?.email || null, approvalId]
    );
    await emitQrtEvent(captiveId, "approval.approved", { approval_id: approvalId, export_id: Number(row.export_id) });
    return res.json({ ok: true, approval_id: approvalId, status: "approved" });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "approval_approve_failed" });
  }
});

router.post("/approvals/:id(\\d+)/reject", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const approvalId = Number(req.params.id || 0);
    const comment = String(req.body?.comment_text || "").trim().slice(0, 500) || null;
    if (!approvalId) return res.status(400).json({ error: "invalid_approval_id" });
    const [rows] = await pool.query(
      `SELECT a.id, a.export_id, a.status, e.captive_id
       FROM qrt_approvals a
       JOIN qrt_exports e ON e.id = a.export_id
       WHERE a.id = ?
       LIMIT 1`,
      [approvalId]
    );
    const row = rows?.[0] || null;
    if (!row || Number(row.captive_id) !== captiveId) return res.status(404).json({ error: "approval_not_found" });
    if (String(row.status) !== "pending") return res.status(409).json({ error: "approval_not_pending" });
    await pool.query(
      `UPDATE qrt_approvals
       SET status = 'rejected',
           decided_by_user_id = ?,
           decided_by_name = ?,
           decision_at = NOW(),
           comment_text = COALESCE(?, comment_text)
       WHERE id = ?
       LIMIT 1`,
      [req.user?.uid || null, req.user?.email || null, comment, approvalId]
    );
    await emitQrtEvent(captiveId, "approval.rejected", { approval_id: approvalId, export_id: Number(row.export_id) });
    return res.json({ ok: true, approval_id: approvalId, status: "rejected" });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "approval_reject_failed" });
  }
});

router.post("/submissions/prepare", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.body?.export_id || 0);
    const source = String(req.body?.source || "real");
    const params = [captiveId];
    let sql = `
      SELECT id, source, snapshot_date, status, is_locked, file_path, taxonomy_version, jurisdiction, xml_sha256
      FROM qrt_exports
      WHERE captive_id = ?
    `;
    if (exportId > 0) {
      sql += " AND id = ? ";
      params.push(exportId);
    } else {
      sql += " AND source = ? ";
      params.push(source);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
    const [rows] = await pool.query(sql, params);
    const exp = rows?.[0] || null;
    if (!exp) return res.status(404).json({ error: "qrt_export_not_found" });
    const xmlPath = String(exp.file_path || "");
    await fs.access(xmlPath);
    const validation = await validateQrtFacts({
      captiveId,
      source: String(exp.source || source),
      snapshotDate: toIsoDate(exp.snapshot_date),
      rebuild: false,
    });
    const subDir = path.join(process.cwd(), "storage", "output", "qrt", "submissions");
    await fs.mkdir(subDir, { recursive: true });
    const packagePath = path.join(subDir, `submission_${captiveId}_${Number(exp.id)}_${Date.now()}.zip`);
    await new Promise((resolve, reject) => {
      const output = createWriteStream(packagePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.file(xmlPath, { name: path.basename(xmlPath) });
      archive.append(
        JSON.stringify(
          {
            export_id: Number(exp.id),
            captive_id: captiveId,
            source: String(exp.source),
            snapshot_date: toIsoDate(exp.snapshot_date),
            taxonomy_version: exp.taxonomy_version,
            jurisdiction: exp.jurisdiction,
            xml_sha256: exp.xml_sha256 || null,
          },
          null,
          2
        ),
        { name: "manifest.json" }
      );
      archive.append(JSON.stringify(validation, null, 2), { name: "validation.json" });
      archive.finalize().catch(reject);
    });
    const packageSha256 = await sha256File(packagePath);
    await pool.query(
      `INSERT INTO qrt_submissions
        (export_id, status, package_path, package_sha256, prepared_by_user_id, prepared_by_name)
       VALUES (?, 'ready', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = 'ready',
         package_path = VALUES(package_path),
         package_sha256 = VALUES(package_sha256),
         prepared_by_user_id = VALUES(prepared_by_user_id),
         prepared_by_name = VALUES(prepared_by_name),
         prepared_at = CURRENT_TIMESTAMP,
         submitted_at = NULL,
         submission_ref = NULL,
         notes_text = NULL`,
      [Number(exp.id), packagePath, packageSha256, req.user?.uid || null, req.user?.email || null]
    );
    await pool.query(`UPDATE qrt_exports SET bundle_sha256 = ? WHERE id = ? LIMIT 1`, [packageSha256, Number(exp.id)]);
    await emitQrtEvent(captiveId, "submission.prepared", {
      export_id: Number(exp.id),
      package_path: packagePath,
      package_sha256: packageSha256,
    });
    return res.status(201).json({
      ok: true,
      submission: {
        export_id: Number(exp.id),
        status: "ready",
        package_path: packagePath,
        package_sha256: packageSha256,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "submission_prepare_failed" });
  }
});

router.get("/submissions", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const status = String(req.query?.status || "").trim().toLowerCase();
    const filters = ["e.captive_id = ?"];
    const params = [captiveId];
    if (["ready", "submitted", "failed"].includes(status)) {
      filters.push("s.status = ?");
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT s.id, s.export_id, s.status, s.package_path, s.package_sha256, s.prepared_by_user_id, s.prepared_by_name,
              s.prepared_at, s.submitted_at, s.submission_ref, s.notes_text, e.source, e.snapshot_date
       FROM qrt_submissions s
       JOIN qrt_exports e ON e.id = s.export_id
       WHERE ${filters.join(" AND ")}
       ORDER BY s.prepared_at DESC, s.id DESC
       LIMIT 300`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "submission_list_failed" });
  }
});

router.post("/submissions/:exportId(\\d+)/mark-submitted", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.params.exportId || 0);
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });
    const submitted = parseBool(req.body?.submitted, true);
    const submissionRef = String(req.body?.submission_ref || "").trim().slice(0, 120) || null;
    const notes = String(req.body?.notes_text || "").trim().slice(0, 1000) || null;
    const [rows] = await pool.query(
      `SELECT s.id, s.export_id, e.captive_id
       FROM qrt_submissions s
       JOIN qrt_exports e ON e.id = s.export_id
       WHERE s.export_id = ?
       LIMIT 1`,
      [exportId]
    );
    const row = rows?.[0] || null;
    if (!row || Number(row.captive_id) !== captiveId) return res.status(404).json({ error: "submission_not_found" });
    await pool.query(
      `UPDATE qrt_submissions
       SET status = ?,
           submitted_at = ?,
           submission_ref = ?,
           notes_text = ?
       WHERE export_id = ?
       LIMIT 1`,
      [submitted ? "submitted" : "failed", submitted ? new Date() : null, submissionRef, notes, exportId]
    );
    await emitQrtEvent(captiveId, submitted ? "submission.submitted" : "submission.failed", {
      export_id: exportId,
      submission_ref: submissionRef,
    });
    return res.json({ ok: true, export_id: exportId, status: submitted ? "submitted" : "failed" });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "submission_mark_failed" });
  }
});

router.post("/workflow/:workflowRequestKey/retry-auto", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const workflowRequestKey = String(req.params.workflowRequestKey || "").trim().slice(0, 128);
    if (!workflowRequestKey) return res.status(400).json({ error: "workflow_request_key_invalid" });
    const source = String(req.body?.source || "").trim().toLowerCase();
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    const attempts = Math.max(1, Math.min(10, Number(req.body?.attempts || 3)));
    const delayMs = Math.max(0, Math.min(10000, Number(req.body?.delay_ms || 0)));
    const runId = await startWorkflowRun({
      captiveId,
      workflowRequestKey,
      source: source || "real",
      snapshotDate: snapshotDate || new Date().toISOString().slice(0, 10),
      user: req.user,
    });
    const attemptResults = [];
    for (let i = 1; i <= attempts; i += 1) {
      const params = [captiveId, workflowRequestKey];
      let sql = `
        SELECT id, source, snapshot_date, status, is_locked
        FROM qrt_exports
        WHERE captive_id = ?
          AND workflow_request_key = ?
      `;
      if (source === "real" || source === "simulation") {
        sql += " AND source = ? ";
        params.push(source);
      }
      if (snapshotDate) {
        sql += " AND snapshot_date = ? ";
        params.push(snapshotDate);
      }
      sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
      const [rows] = await pool.query(sql, params);
      const row = rows?.[0] || null;
      if (!row) {
        attemptResults.push({ attempt: i, ok: false, reason: "workflow_not_found" });
      } else if (Number(row.is_locked || 0) === 1) {
        attemptResults.push({ attempt: i, ok: true, reason: "already_locked", export_id: Number(row.id) });
        await finishWorkflowRun(runId, "success", null);
        return res.json({ ok: true, attempts: attemptResults, export_id: Number(row.id) });
      } else {
        let ok = true;
        let reason = "locked";
        const exportId = Number(row.id);
        if (String(row.status || "").toLowerCase() !== "published") {
          await pool.query(
            `UPDATE qrt_exports
             SET status = 'published',
                 published_at = NOW(),
                 published_by_user_id = ?,
                 published_by_name = ?
             WHERE id = ?
             LIMIT 1`,
            [req.user?.uid || null, req.user?.email || null, exportId]
          );
        }
        const gov = await getGovernanceConfig(captiveId);
        if (gov.require_double_validation) {
          const approved = await hasApprovedDoubleValidation(exportId);
          if (!approved) {
            ok = false;
            reason = "double_validation_required";
          }
        }
        if (ok) {
          await pool.query(
            `UPDATE qrt_exports
             SET is_locked = 1,
                 locked_at = NOW(),
                 locked_by_user_id = ?,
                 locked_by_name = ?
             WHERE id = ?
             LIMIT 1`,
            [req.user?.uid || null, req.user?.email || null, exportId]
          );
          attemptResults.push({ attempt: i, ok: true, reason, export_id: exportId });
          await finishWorkflowRun(runId, "success", null);
          return res.json({ ok: true, attempts: attemptResults, export_id: exportId });
        }
        attemptResults.push({ attempt: i, ok: false, reason, export_id: exportId });
      }
      if (i < attempts && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    await finishWorkflowRun(runId, "failed", "retry_auto_exhausted");
    return res.status(409).json({ error: "retry_auto_exhausted", attempts: attemptResults });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "workflow_retry_auto_failed" });
  }
});

router.get("/comparison/real-vs-simulation", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const snapshotDate = toIsoDate(req.query?.snapshot_date);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const real = await loadKeyFactsForGuardrail(captiveId, "real", snapshotDate);
    const simulation = await loadKeyFactsForGuardrail(captiveId, "simulation", snapshotDate);
    const diff = {
      scr: simulation.scr - real.scr,
      mcr: simulation.mcr - real.mcr,
      own_funds: simulation.own_funds - real.own_funds,
      solvency_ratio_pct:
        real.solvency_ratio_pct == null || simulation.solvency_ratio_pct == null
          ? null
          : simulation.solvency_ratio_pct - real.solvency_ratio_pct,
    };
    return res.json({ ok: true, snapshot_date: snapshotDate, real, simulation, diff });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "comparison_real_vs_simulation_failed" });
  }
});

router.get("/export/:id(\\d+)/verify-integrity", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const exportId = Number(req.params.id || 0);
    if (!exportId) return res.status(400).json({ error: "invalid_export_id" });
    const [rows] = await pool.query(
      `SELECT id, file_path, xml_sha256, bundle_sha256
       FROM qrt_exports
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [exportId, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "qrt_export_not_found" });
    const checks = {
      xml_hash_stored: row.xml_sha256 || null,
      xml_hash_actual: null,
      xml_hash_ok: null,
      bundle_hash_stored: row.bundle_sha256 || null,
      bundle_hash_actual: null,
      bundle_hash_ok: null,
    };
    const xmlPath = String(row.file_path || "");
    await fs.access(xmlPath);
    checks.xml_hash_actual = await sha256File(xmlPath);
    checks.xml_hash_ok = checks.xml_hash_stored ? checks.xml_hash_stored === checks.xml_hash_actual : null;

    const [subRows] = await pool.query(`SELECT package_path, package_sha256 FROM qrt_submissions WHERE export_id = ? LIMIT 1`, [exportId]);
    const sub = subRows?.[0] || null;
    if (sub?.package_path) {
      try {
        await fs.access(String(sub.package_path));
        checks.bundle_hash_actual = await sha256File(String(sub.package_path));
        if (sub.package_sha256) checks.bundle_hash_ok = String(sub.package_sha256) === checks.bundle_hash_actual;
      } catch {
        checks.bundle_hash_actual = null;
      }
    }
    const ok = (checks.xml_hash_ok !== false) && (checks.bundle_hash_ok !== false);
    return res.status(ok ? 200 : 409).json({ ok, export_id: exportId, checks });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "verify_integrity_failed" });
  }
});

router.post("/retention/run", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const retentionDays = Math.max(1, Math.min(3650, Number(req.body?.retention_days || 365)));
    const onlyLocked = parseBool(req.body?.only_locked, true);
    const limit = Math.max(1, Math.min(500, Number(req.body?.limit || 100)));
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const filters = ["captive_id = ?", "snapshot_date < ?"];
    const params = [captiveId, cutoffDate];
    if (onlyLocked) filters.push("is_locked = 1");
    const [rows] = await pool.query(
      `SELECT id, file_path, source, snapshot_date
       FROM qrt_exports
       WHERE ${filters.join(" AND ")}
       ORDER BY snapshot_date ASC, id ASC
       LIMIT ?`,
      [...params, limit]
    );
    const archiveDir = path.join(process.cwd(), "storage", "archive", "qrt");
    await fs.mkdir(archiveDir, { recursive: true });
    const results = [];
    for (const r of rows || []) {
      const srcPath = String(r.file_path || "");
      const archivePath = path.join(archiveDir, path.basename(srcPath || `export_${r.id}.xml`));
      let archived = false;
      let warning = null;
      try {
        await fs.rename(srcPath, archivePath);
        archived = true;
      } catch {
        try {
          await fs.copyFile(srcPath, archivePath);
          await fs.unlink(srcPath);
          archived = true;
        } catch {
          warning = "archive_file_move_failed";
        }
      }
      if (archived) {
        await pool.query(
          `INSERT INTO qrt_archive_logs (export_id, archive_path, archived_by_user_id, archived_by_name)
           VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE
             archive_path = VALUES(archive_path),
             archived_by_user_id = VALUES(archived_by_user_id),
             archived_by_name = VALUES(archived_by_name),
             archived_at = CURRENT_TIMESTAMP`,
          [Number(r.id), archivePath, req.user?.uid || null, req.user?.email || null]
        );
        await pool.query(`UPDATE qrt_exports SET file_path = ? WHERE id = ? LIMIT 1`, [archivePath, Number(r.id)]);
      }
      results.push({
        export_id: Number(r.id),
        source: String(r.source || ""),
        snapshot_date: toIsoDate(r.snapshot_date),
        archived,
        archive_path: archived ? archivePath : null,
        warning,
      });
    }
    return res.json({
      ok: true,
      retention_days: retentionDays,
      cutoff_date: cutoffDate,
      requested_limit: limit,
      processed: results.length,
      results,
    });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "retention_run_failed" });
  }
});

router.get("/webhooks", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT id, event_code, target_url, is_active, created_by_user_id, created_by_name, created_at, updated_at
       FROM qrt_webhooks
       WHERE captive_id = ?
       ORDER BY id DESC`,
      [captiveId]
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "webhooks_list_failed" });
  }
});

router.post("/webhooks", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const eventCode = String(req.body?.event_code || "").trim().slice(0, 80);
    const targetUrl = String(req.body?.target_url || "").trim().slice(0, 500);
    const secretToken = String(req.body?.secret_token || "").trim().slice(0, 255) || null;
    if (!eventCode || !targetUrl) return res.status(400).json({ error: "event_code_and_target_url_required" });
    const [ins] = await pool.query(
      `INSERT INTO qrt_webhooks (captive_id, event_code, target_url, secret_token, is_active, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?)`,
      [captiveId, eventCode, targetUrl, secretToken, 1, req.user?.uid || null, req.user?.email || null]
    );
    return res.status(201).json({ ok: true, webhook_id: Number(ins?.insertId || 0) });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "webhook_create_failed" });
  }
});

router.put("/webhooks/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const webhookId = Number(req.params.id || 0);
    if (!webhookId) return res.status(400).json({ error: "invalid_webhook_id" });
    const [rows] = await pool.query(`SELECT id FROM qrt_webhooks WHERE id = ? AND captive_id = ? LIMIT 1`, [webhookId, captiveId]);
    if (!rows?.length) return res.status(404).json({ error: "webhook_not_found" });
    const eventCode = String(req.body?.event_code || "").trim().slice(0, 80);
    const targetUrl = String(req.body?.target_url || "").trim().slice(0, 500);
    const secretToken = req.body?.secret_token == null ? null : String(req.body?.secret_token).trim().slice(0, 255);
    const isActive = parseBool(req.body?.is_active, true);
    await pool.query(
      `UPDATE qrt_webhooks
       SET event_code = COALESCE(NULLIF(?, ''), event_code),
           target_url = COALESCE(NULLIF(?, ''), target_url),
           secret_token = CASE WHEN ? IS NULL THEN secret_token ELSE ? END,
           is_active = ?
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [eventCode, targetUrl, secretToken, secretToken, isActive ? 1 : 0, webhookId, captiveId]
    );
    return res.json({ ok: true, webhook_id: webhookId });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "webhook_update_failed" });
  }
});

router.delete("/webhooks/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const webhookId = Number(req.params.id || 0);
    if (!webhookId) return res.status(400).json({ error: "invalid_webhook_id" });
    await pool.query(`DELETE FROM qrt_webhooks WHERE id = ? AND captive_id = ? LIMIT 1`, [webhookId, captiveId]);
    return res.json({ ok: true, webhook_id: webhookId });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "webhook_delete_failed" });
  }
});

router.get("/events", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const eventCode = String(req.query?.event_code || "").trim().slice(0, 80);
    const status = String(req.query?.delivery_status || "").trim().toLowerCase();
    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (eventCode) {
      filters.push("event_code = ?");
      params.push(eventCode);
    }
    if (["queued", "delivered", "failed", "skipped"].includes(status)) {
      filters.push("delivery_status = ?");
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT id, event_code, webhook_id, payload_json, delivery_status, http_status, error_text, created_at
       FROM qrt_event_logs
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT 500`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "events_list_failed" });
  }
});

router.get("/compliance/status", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });

    const [[pendingApprovals]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM qrt_approvals a
       JOIN qrt_exports e ON e.id = a.export_id
       WHERE e.captive_id = ?
         AND a.status = 'pending'`,
      [captiveId]
    );
    const [[failedRuns]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM qrt_workflow_runs
       WHERE captive_id = ?
         AND status = 'failed'`,
      [captiveId]
    );
    const [latestSubmissionRows] = await pool.query(
      `SELECT s.id, s.export_id, s.status, s.prepared_at, s.submitted_at, s.submission_ref
       FROM qrt_submissions s
       JOIN qrt_exports e ON e.id = s.export_id
       WHERE e.captive_id = ?
       ORDER BY s.prepared_at DESC, s.id DESC
       LIMIT 1`,
      [captiveId]
    );
    const [latestLockedRows] = await pool.query(
      `SELECT id, source, snapshot_date, locked_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND is_locked = 1
       ORDER BY locked_at DESC, id DESC
       LIMIT 1`,
      [captiveId]
    );

    const payload = {
      captive_id: captiveId,
      pending_approvals: Number(pendingApprovals?.cnt || 0),
      failed_workflow_runs: Number(failedRuns?.cnt || 0),
      latest_submission: latestSubmissionRows?.[0] || null,
      latest_locked_export: latestLockedRows?.[0] || null,
      timestamp: new Date().toISOString(),
    };
    const compliant = payload.pending_approvals === 0 && payload.failed_workflow_runs === 0 && payload.latest_locked_export != null;
    return res.status(compliant ? 200 : 409).json({ ok: compliant, compliance: payload });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "compliance_status_failed" });
  }
});

router.get("/submissions/:id(\\d+)/download", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const submissionId = Number(req.params.id || 0);
    if (!submissionId) return res.status(400).json({ error: "invalid_submission_id" });
    const [rows] = await pool.query(
      `SELECT s.id, s.package_path, s.export_id
       FROM qrt_submissions s
       JOIN qrt_exports e ON e.id = s.export_id
       WHERE s.id = ?
         AND e.captive_id = ?
       LIMIT 1`,
      [submissionId, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "submission_not_found" });
    const packagePath = String(row.package_path || "");
    await fs.access(packagePath);
    return res.download(packagePath, path.basename(packagePath));
  } catch (err) {
    return res.status(404).json({ error: err?.message || "submission_download_failed" });
  }
});

router.post("/events/:id(\\d+)/replay", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const eventLogId = Number(req.params.id || 0);
    if (!eventLogId) return res.status(400).json({ error: "invalid_event_log_id" });
    const [rows] = await pool.query(
      `SELECT id, event_code, payload_json
       FROM qrt_event_logs
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [eventLogId, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "event_log_not_found" });
    const payload = row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {};
    await emitQrtEvent(captiveId, String(row.event_code || "unknown"), payload);
    return res.json({ ok: true, replayed_from_event_log_id: eventLogId, event_code: row.event_code });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "event_replay_failed" });
  }
});

router.get("/archive/logs", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT a.id, a.export_id, a.archive_path, a.archived_by_user_id, a.archived_by_name, a.archived_at,
              e.source, e.snapshot_date
       FROM qrt_archive_logs a
       JOIN qrt_exports e ON e.id = a.export_id
       WHERE e.captive_id = ?
       ORDER BY a.archived_at DESC, a.id DESC
       LIMIT 300`,
      [captiveId]
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "archive_logs_list_failed" });
  }
});

router.get("/schedules", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT id, name, job_code, frequency, hour_utc, minute_utc, day_of_week, day_of_month, payload_json, is_active,
              next_run_at, last_run_at, last_status, last_error, updated_by_user_id, updated_by_name, updated_at, created_at
       FROM qrt_schedules
       WHERE captive_id = ?
       ORDER BY is_active DESC, next_run_at ASC, id DESC`,
      [captiveId]
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "schedules_list_failed" });
  }
});

router.post("/schedules", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const jobCode = String(req.body?.job_code || "").trim();
    const frequency = String(req.body?.frequency || "daily").trim();
    const hm = parseUtcHm(req.body?.hour_utc ?? 0, req.body?.minute_utc ?? 0);
    if (!name) return res.status(400).json({ error: "name_required" });
    if (!["monthly_closure", "retry_auto", "retention", "submission_prepare", "alerts_scan"].includes(jobCode)) {
      return res.status(400).json({ error: "job_code_invalid" });
    }
    if (!["hourly", "daily", "weekly", "monthly"].includes(frequency)) {
      return res.status(400).json({ error: "frequency_invalid" });
    }
    if (!hm) return res.status(400).json({ error: "hour_or_minute_invalid" });
    const dayOfWeek = req.body?.day_of_week == null ? null : Number(req.body.day_of_week);
    const dayOfMonth = req.body?.day_of_month == null ? null : Number(req.body.day_of_month);
    if (frequency === "weekly" && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
      return res.status(400).json({ error: "day_of_week_invalid" });
    }
    if (frequency === "monthly" && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28)) {
      return res.status(400).json({ error: "day_of_month_invalid" });
    }
    const payload = req.body?.payload_json && typeof req.body.payload_json === "object" ? req.body.payload_json : {};
    const nextRunAt = nextRunFromSchedule({
      frequency,
      hour_utc: hm.h,
      minute_utc: hm.m,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth,
    });
    const [ins] = await pool.query(
      `INSERT INTO qrt_schedules
         (captive_id, name, job_code, frequency, hour_utc, minute_utc, day_of_week, day_of_month, payload_json, is_active, next_run_at, updated_by_user_id, updated_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, ?, ?)`,
      [
        captiveId,
        name,
        jobCode,
        frequency,
        hm.h,
        hm.m,
        dayOfWeek,
        dayOfMonth,
        JSON.stringify(payload),
        parseBool(req.body?.is_active, true) ? 1 : 0,
        nextRunAt,
        req.user?.uid || null,
        req.user?.email || null,
      ]
    );
    return res.status(201).json({ ok: true, schedule_id: Number(ins?.insertId || 0) });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "schedule_create_failed" });
  }
});

router.patch("/schedules/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "schedule_id_invalid" });
    const [rows] = await pool.query(`SELECT * FROM qrt_schedules WHERE id = ? AND captive_id = ? LIMIT 1`, [id, captiveId]);
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "schedule_not_found" });
    const frequency = String(req.body?.frequency || row.frequency || "daily");
    const hm = parseUtcHm(req.body?.hour_utc ?? row.hour_utc, req.body?.minute_utc ?? row.minute_utc);
    if (!hm) return res.status(400).json({ error: "hour_or_minute_invalid" });
    const dayOfWeek = req.body?.day_of_week == null ? row.day_of_week : Number(req.body.day_of_week);
    const dayOfMonth = req.body?.day_of_month == null ? row.day_of_month : Number(req.body.day_of_month);
    const payload = req.body?.payload_json && typeof req.body.payload_json === "object" ? req.body.payload_json : row.payload_json || {};
    const nextRunAt = nextRunFromSchedule({
      frequency,
      hour_utc: hm.h,
      minute_utc: hm.m,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth,
    });
    await pool.query(
      `UPDATE qrt_schedules
       SET name = COALESCE(NULLIF(?, ''), name),
           frequency = ?,
           hour_utc = ?,
           minute_utc = ?,
           day_of_week = ?,
           day_of_month = ?,
           payload_json = ?,
           is_active = ?,
           next_run_at = ?,
           updated_by_user_id = ?,
           updated_by_name = ?
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [
        String(req.body?.name || "").trim().slice(0, 120),
        frequency,
        hm.h,
        hm.m,
        dayOfWeek,
        dayOfMonth,
        JSON.stringify(payload),
        parseBool(req.body?.is_active, Number(row.is_active || 0) === 1) ? 1 : 0,
        nextRunAt,
        req.user?.uid || null,
        req.user?.email || null,
        id,
        captiveId,
      ]
    );
    return res.json({ ok: true, schedule_id: id });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "schedule_patch_failed" });
  }
});

router.post("/schedules/:id(\\d+)/run-now", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "schedule_id_invalid" });
    const [rows] = await pool.query(`SELECT id FROM qrt_schedules WHERE id = ? AND captive_id = ? LIMIT 1`, [id, captiveId]);
    if (!rows?.length) return res.status(404).json({ error: "schedule_not_found" });
    await pool.query(
      `INSERT INTO jobs (type, payload, status, tries, scheduled_at)
       VALUES ('qrt.schedule.execute', ?, 'queued', 0, NOW())`,
      [JSON.stringify({ schedule_id: id, captive_id: captiveId, manual_trigger: true })]
    );
    return res.status(202).json({ ok: true, enqueued: true, schedule_id: id });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "schedule_run_now_failed" });
  }
});

router.delete("/schedules/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "schedule_id_invalid" });
    const [del] = await pool.query(
      `DELETE FROM qrt_schedules
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [id, captiveId]
    );
    if (Number(del?.affectedRows || 0) !== 1) return res.status(404).json({ error: "schedule_not_found" });
    return res.json({ ok: true, schedule_id: id });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "schedule_delete_failed" });
  }
});

router.get("/tasks", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const status = String(req.query?.status || "").trim();
    const priority = String(req.query?.priority || "").trim();
    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (["todo", "in_progress", "done", "blocked"].includes(status)) {
      filters.push("status = ?");
      params.push(status);
    }
    if (["low", "normal", "high", "critical"].includes(priority)) {
      filters.push("priority = ?");
      params.push(priority);
    }
    const [rows] = await pool.query(
      `SELECT id, title, description_text, status, priority, owner_user_id, owner_name, due_date, linked_export_id, linked_workflow_request_key, created_by_user_id, created_by_name, created_at, updated_at
       FROM qrt_tasks
       WHERE ${filters.join(" AND ")}
       ORDER BY
         CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         CASE status WHEN 'blocked' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'todo' THEN 3 ELSE 4 END,
         due_date IS NULL, due_date ASC, id DESC
       LIMIT 500`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "tasks_list_failed" });
  }
});

router.post("/tasks", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const title = String(req.body?.title || "").trim().slice(0, 190);
    if (!title) return res.status(400).json({ error: "title_required" });
    const status = String(req.body?.status || "todo");
    const priority = String(req.body?.priority || "normal");
    const dueDate = toIsoDate(req.body?.due_date);
    const [ins] = await pool.query(
      `INSERT INTO qrt_tasks
         (captive_id, title, description_text, status, priority, owner_user_id, owner_name, due_date, linked_export_id, linked_workflow_request_key, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        captiveId,
        title,
        String(req.body?.description_text || "").trim().slice(0, 1000) || null,
        ["todo", "in_progress", "done", "blocked"].includes(status) ? status : "todo",
        ["low", "normal", "high", "critical"].includes(priority) ? priority : "normal",
        Number(req.body?.owner_user_id || 0) || null,
        String(req.body?.owner_name || "").trim().slice(0, 128) || null,
        dueDate,
        Number(req.body?.linked_export_id || 0) || null,
        String(req.body?.linked_workflow_request_key || "").trim().slice(0, 128) || null,
        req.user?.uid || null,
        req.user?.email || null,
      ]
    );
    return res.status(201).json({ ok: true, task_id: Number(ins?.insertId || 0) });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "task_create_failed" });
  }
});

router.patch("/tasks/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "task_id_invalid" });
    await pool.query(
      `UPDATE qrt_tasks
       SET title = COALESCE(NULLIF(?, ''), title),
           description_text = COALESCE(?, description_text),
           status = ?,
           priority = ?,
           owner_user_id = ?,
           owner_name = ?,
           due_date = ?,
           linked_export_id = ?,
           linked_workflow_request_key = COALESCE(?, linked_workflow_request_key)
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [
        String(req.body?.title || "").trim().slice(0, 190),
        req.body?.description_text == null ? null : String(req.body?.description_text).trim().slice(0, 1000),
        ["todo", "in_progress", "done", "blocked"].includes(String(req.body?.status || "")) ? String(req.body?.status) : "todo",
        ["low", "normal", "high", "critical"].includes(String(req.body?.priority || "")) ? String(req.body?.priority) : "normal",
        Number(req.body?.owner_user_id || 0) || null,
        String(req.body?.owner_name || "").trim().slice(0, 128) || null,
        toIsoDate(req.body?.due_date),
        Number(req.body?.linked_export_id || 0) || null,
        String(req.body?.linked_workflow_request_key || "").trim().slice(0, 128) || null,
        id,
        captiveId,
      ]
    );
    return res.json({ ok: true, task_id: id });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "task_patch_failed" });
  }
});

router.get("/alerts/rules", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT id, event_code, severity, min_escalation_level, max_escalation_level, recipients_csv, subject_template, cooldown_minutes, is_active, created_by_user_id, created_by_name, created_at, updated_at
       FROM qrt_alert_rules
       WHERE captive_id = ?
       ORDER BY is_active DESC, event_code ASC, severity ASC`,
      [captiveId]
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "alert_rules_list_failed" });
  }
});

router.post("/alerts/rules", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const eventCode = String(req.body?.event_code || "").trim().slice(0, 80);
    const severity = String(req.body?.severity || "warning").trim();
    const recipients = parseRecipientsCsv(req.body?.recipients_csv);
    const minEscalationLevel = normalizeEscalationLevel(req.body?.min_escalation_level, 0);
    const maxEscalationLevel = normalizeEscalationLevel(req.body?.max_escalation_level, null);
    if (!eventCode) return res.status(400).json({ error: "event_code_required" });
    if (!["info", "warning", "critical"].includes(severity)) return res.status(400).json({ error: "severity_invalid" });
    if (!recipients.length) return res.status(400).json({ error: "recipients_invalid" });
    if (maxEscalationLevel != null && maxEscalationLevel < minEscalationLevel) {
      return res.status(400).json({ error: "escalation_range_invalid" });
    }
    const [ins] = await pool.query(
      `INSERT INTO qrt_alert_rules
         (captive_id, event_code, severity, min_escalation_level, max_escalation_level, recipients_csv, subject_template, cooldown_minutes, is_active, created_by_user_id, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        captiveId,
        eventCode,
        severity,
        minEscalationLevel,
        maxEscalationLevel,
        recipients.join(","),
        String(req.body?.subject_template || "").trim().slice(0, 255) || null,
        Math.max(0, Math.min(1440, Number(req.body?.cooldown_minutes || 30))),
        parseBool(req.body?.is_active, true) ? 1 : 0,
        req.user?.uid || null,
        req.user?.email || null,
      ]
    );
    return res.status(201).json({ ok: true, rule_id: Number(ins?.insertId || 0) });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "alert_rule_create_failed" });
  }
});

router.patch("/alerts/rules/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "rule_id_invalid" });
    const hasMinEsc = Object.prototype.hasOwnProperty.call(req.body || {}, "min_escalation_level");
    const hasMaxEsc = Object.prototype.hasOwnProperty.call(req.body || {}, "max_escalation_level");
    const minEscalationLevel = normalizeEscalationLevel(req.body?.min_escalation_level, 0);
    const maxEscalationLevel = normalizeEscalationLevel(req.body?.max_escalation_level, null);
    if (hasMaxEsc && maxEscalationLevel != null) {
      const minForCheck = hasMinEsc ? minEscalationLevel : 0;
      if (maxEscalationLevel < minForCheck) return res.status(400).json({ error: "escalation_range_invalid" });
    }
    const recipients =
      req.body?.recipients_csv == null ? null : parseRecipientsCsv(req.body?.recipients_csv).join(",");
    await pool.query(
      `UPDATE qrt_alert_rules
       SET event_code = COALESCE(NULLIF(?, ''), event_code),
           severity = COALESCE(NULLIF(?, ''), severity),
           recipients_csv = COALESCE(NULLIF(?, ''), recipients_csv),
           subject_template = COALESCE(?, subject_template),
           cooldown_minutes = COALESCE(?, cooldown_minutes),
           min_escalation_level = CASE WHEN ? = 1 THEN ? ELSE min_escalation_level END,
           max_escalation_level = CASE WHEN ? = 1 THEN ? ELSE max_escalation_level END,
           is_active = ?
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [
        String(req.body?.event_code || "").trim().slice(0, 80),
        String(req.body?.severity || "").trim(),
        recipients,
        req.body?.subject_template == null ? null : String(req.body?.subject_template).trim().slice(0, 255),
        req.body?.cooldown_minutes == null ? null : Math.max(0, Math.min(1440, Number(req.body?.cooldown_minutes))),
        hasMinEsc ? 1 : 0,
        minEscalationLevel,
        hasMaxEsc ? 1 : 0,
        maxEscalationLevel,
        parseBool(req.body?.is_active, true) ? 1 : 0,
        id,
        captiveId,
      ]
    );
    return res.json({ ok: true, rule_id: id });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "alert_rule_patch_failed" });
  }
});

router.get("/alerts/deliveries", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const status = String(req.query?.status || "").trim().toLowerCase();
    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (["queued", "sent", "failed", "skipped"].includes(status)) {
      filters.push("status = ?");
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT id, rule_id, event_code, severity, recipients_csv, subject_text, status, provider_message_id, provider_response_text, error_text, sent_at, created_at
       FROM qrt_alert_deliveries
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT 500`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "alert_deliveries_list_failed" });
  }
});

router.post("/alerts/scan", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const sinceMinutes = Math.max(5, Math.min(1440, Number(req.body?.since_minutes || 60)));
    const out = [];

    const [[wfFail]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM qrt_workflow_runs
       WHERE captive_id = ?
         AND status = 'failed'
         AND started_at >= (NOW() - INTERVAL ? MINUTE)`,
      [captiveId, sinceMinutes]
    );
    if (Number(wfFail?.cnt || 0) > 0) {
      const created = await enqueueQrtAlertJobs({
        captiveId,
        eventCode: "workflow.failed",
        severity: "critical",
        subject: `[QRT] Workflow failures (${wfFail.cnt})`,
        body: `Detected ${wfFail.cnt} failed workflow run(s) in the last ${sinceMinutes} minute(s).`,
        dedupeKey: `workflow.failed.${sinceMinutes}`,
      });
      out.push({ event_code: "workflow.failed", count: Number(wfFail.cnt || 0), jobs: created.length });
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
      const created = await enqueueQrtAlertJobs({
        captiveId,
        eventCode: "submission.failed",
        severity: "critical",
        subject: `[QRT] Submission failures (${submissionFail.cnt})`,
        body: `Detected ${submissionFail.cnt} failed submission(s) in the last ${sinceMinutes} minute(s).`,
        dedupeKey: `submission.failed.${sinceMinutes}`,
      });
      out.push({ event_code: "submission.failed", count: Number(submissionFail.cnt || 0), jobs: created.length });
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
      const created = await enqueueQrtAlertJobs({
        captiveId,
        eventCode: "webhook.failed",
        severity: "warning",
        subject: `[QRT] Webhook delivery failures (${webhookFail.cnt})`,
        body: `Detected ${webhookFail.cnt} webhook failed delivery event(s) in the last ${sinceMinutes} minute(s).`,
        dedupeKey: `webhook.failed.${sinceMinutes}`,
      });
      out.push({ event_code: "webhook.failed", count: Number(webhookFail.cnt || 0), jobs: created.length });
    }

    return res.json({ ok: true, scan_window_minutes: sinceMinutes, findings: out });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "alert_scan_failed" });
  }
});

router.get("/incidents/acks", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const sinceDays = Math.max(1, Math.min(365, Number(req.query?.since_days || 30)));
    const [rows] = await pool.query(
      `SELECT id, incident_key, severity, title_text, detail_text, notes_text, acked_by_user_id, acked_by_name, acked_at, created_at, updated_at
       FROM qrt_incident_acks
       WHERE captive_id = ?
         AND acked_at >= (NOW() - INTERVAL ? DAY)
       ORDER BY acked_at DESC, id DESC
       LIMIT 1000`,
      [captiveId, sinceDays]
    );
    return res.json({ ok: true, since_days: sinceDays, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "incident_acks_list_failed" });
  }
});

router.post("/incidents/sync", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const caps = qrtCapabilities(req);
    if (!caps.qrt_governance_config) return res.status(403).json({ error: "forbidden" });
    const sync = await syncIncidentWatch(captiveId);
    const esc = await escalateUnackedIncidents(captiveId, 100);
    return res.json({ ok: true, sync, escalation: esc });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "incidents_sync_failed" });
  }
});

router.get("/incidents/watch", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const status = String(req.query?.status || "").trim().toLowerCase();
    const severity = String(req.query?.severity || "").trim().toLowerCase();
    const filters = ["captive_id = ?"];
    const params = [captiveId];
    if (["open", "acked", "resolved"].includes(status)) {
      filters.push("status = ?");
      params.push(status);
    }
    if (["warning", "critical"].includes(severity)) {
      filters.push("severity = ?");
      params.push(severity);
    }
    const [rows] = await pool.query(
      `SELECT id, incident_key, source_code, severity, status, title_text, detail_text, owner_user_id, owner_name,
              sla_minutes, ack_due_at, first_seen_at, last_seen_at, acked_at, acked_by_user_id, acked_by_name,
              resolved_at, escalation_count, escalated_at, created_at, updated_at
       FROM qrt_incident_watch
       WHERE ${filters.join(" AND ")}
       ORDER BY
         CASE status WHEN 'open' THEN 1 WHEN 'acked' THEN 2 ELSE 3 END,
         CASE severity WHEN 'critical' THEN 1 ELSE 2 END,
         ack_due_at ASC,
         last_seen_at DESC
       LIMIT 1000`,
      params
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "incidents_watch_list_failed" });
  }
});

router.patch("/incidents/watch/:id(\\d+)", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "incident_watch_id_invalid" });
    const action = String(req.body?.action || "").trim().toLowerCase();
    const ownerUserId = Number(req.body?.owner_user_id || 0) || null;
    const ownerName = String(req.body?.owner_name || "").trim().slice(0, 128) || null;
    const slaMinutesRaw = req.body?.sla_minutes;
    const notes = String(req.body?.notes_text || "").trim().slice(0, 1000) || null;

    const [rows] = await pool.query(
      `SELECT id, status, severity, first_seen_at, sla_minutes
       FROM qrt_incident_watch
       WHERE id = ?
         AND captive_id = ?
       LIMIT 1`,
      [id, captiveId]
    );
    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "incident_watch_not_found" });

    if (action === "assign") {
      await pool.query(
        `UPDATE qrt_incident_watch
         SET owner_user_id = ?,
             owner_name = ?,
             sla_minutes = COALESCE(?, sla_minutes),
             ack_due_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         LIMIT 1`,
        [
          ownerUserId,
          ownerName,
          slaMinutesRaw == null ? null : Math.max(1, Math.min(10080, Number(slaMinutesRaw))),
          dueAtFrom(row.first_seen_at, slaMinutesRaw == null ? Number(row.sla_minutes || 240) : Number(slaMinutesRaw)),
          id,
        ]
      );
      return res.json({ ok: true, incident_watch_id: id, action: "assign" });
    }

    if (action === "ack") {
      await pool.query(
        `UPDATE qrt_incident_watch
         SET status = 'acked',
             acked_at = NOW(),
             acked_by_user_id = ?,
             acked_by_name = ?,
             owner_user_id = COALESCE(owner_user_id, ?),
             owner_name = COALESCE(owner_name, ?)
         WHERE id = ?
         LIMIT 1`,
        [req.user?.uid || null, req.user?.email || null, ownerUserId, ownerName, id]
      );
      if (notes) {
        await pool.query(
          `INSERT INTO qrt_incident_acks
             (captive_id, incident_key, severity, title_text, detail_text, notes_text, acked_by_user_id, acked_by_name, acked_at)
           SELECT captive_id, incident_key, severity, title_text, detail_text, ?, ?, ?, NOW()
           FROM qrt_incident_watch
           WHERE id = ?
           ON DUPLICATE KEY UPDATE
             notes_text = VALUES(notes_text),
             acked_by_user_id = VALUES(acked_by_user_id),
             acked_by_name = VALUES(acked_by_name),
             acked_at = NOW()`,
          [notes, req.user?.uid || null, req.user?.email || null, id]
        );
      }
      return res.json({ ok: true, incident_watch_id: id, action: "ack" });
    }

    if (action === "resolve") {
      await pool.query(
        `UPDATE qrt_incident_watch
         SET status = 'resolved',
             resolved_at = NOW()
         WHERE id = ?
         LIMIT 1`,
        [id]
      );
      return res.json({ ok: true, incident_watch_id: id, action: "resolve" });
    }

    return res.status(400).json({ error: "action_invalid" });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "incidents_watch_patch_failed" });
  }
});

router.post("/incidents/ack", authRequired, requireRole(...canUse), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const incidentKey = String(req.body?.incident_key || "").trim().slice(0, 255);
    const severity = String(req.body?.severity || "warning").trim();
    const title = String(req.body?.title_text || "").trim().slice(0, 255);
    const detail = String(req.body?.detail_text || "").trim().slice(0, 1000) || null;
    const notes = String(req.body?.notes_text || "").trim().slice(0, 1000) || null;
    if (!incidentKey) return res.status(400).json({ error: "incident_key_required" });
    if (!title) return res.status(400).json({ error: "title_text_required" });
    if (!["warning", "critical"].includes(severity)) return res.status(400).json({ error: "severity_invalid" });

    await pool.query(
      `INSERT INTO qrt_incident_acks
         (captive_id, incident_key, severity, title_text, detail_text, notes_text, acked_by_user_id, acked_by_name, acked_at)
       VALUES (?,?,?,?,?,?,?,?, NOW())
       ON DUPLICATE KEY UPDATE
         severity = VALUES(severity),
         title_text = VALUES(title_text),
         detail_text = VALUES(detail_text),
         notes_text = VALUES(notes_text),
         acked_by_user_id = VALUES(acked_by_user_id),
         acked_by_name = VALUES(acked_by_name),
         acked_at = NOW()`,
      [captiveId, incidentKey, severity, title, detail, notes, req.user?.uid || null, req.user?.email || null]
    );
    await pool.query(
      `UPDATE qrt_incident_watch
       SET status = 'acked',
           acked_at = NOW(),
           acked_by_user_id = ?,
           acked_by_name = ?
       WHERE captive_id = ?
         AND incident_key = ?
       LIMIT 1`,
      [req.user?.uid || null, req.user?.email || null, captiveId, incidentKey]
    );

    return res.json({ ok: true, incident_key: incidentKey });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "incident_ack_failed" });
  }
});

export default router;
