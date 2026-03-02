import { Router } from "express";
import pool from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import fs from "fs";
import path from "path";
import archiver from "archiver";

const router = Router();
const canRequest = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

async function hasColumn(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 as ok FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function buildWhere(table, alias, exercise, captiveId, dateColumns = []) {
  const clauses = [];
  const params = [];
  if (captiveId && (await hasColumn(table, "captive_id"))) {
    clauses.push(`${alias}.captive_id = ?`);
    params.push(captiveId);
  }
  if (exercise && (await hasColumn(table, "exercise"))) {
    clauses.push(`${alias}.exercise = ?`);
    params.push(exercise);
  } else if (exercise) {
    const dateClauses = [];
    for (const col of dateColumns) {
      if (await hasColumn(table, col)) {
        dateClauses.push(`YEAR(${alias}.${col}) = ?`);
        params.push(exercise);
      }
    }
    if (dateClauses.length) clauses.push(`(${dateClauses.join(" OR ")})`);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

router.get("/templates", authRequired, requireRole("admin"), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, description, created_at FROM report_templates ORDER BY created_at DESC`
  );
  res.json(rows);
});

router.post("/templates", authRequired, requireRole("admin"), async (req, res) => {
  const { name, description = null, definition } = req.body || {};
  if (!name || !definition) return res.status(400).json({ error: "missing_name_or_definition" });
  const [r] = await pool.query(
    `INSERT INTO report_templates (name, description, definition) VALUES (?,?,?)`,
    [name, description, JSON.stringify(definition)]
  );
  res.status(201).json({ id: r.insertId });
});

router.get("/templates/:id", authRequired, requireRole("admin"), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM report_templates WHERE id = ? LIMIT 1`, [
    req.params.id,
  ]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  res.json(rows[0]);
});

router.put("/templates/:id", authRequired, requireRole("admin"), async (req, res) => {
  const { name, description = null, definition } = req.body || {};
  if (!name || !definition) return res.status(400).json({ error: "missing_name_or_definition" });
  const [r] = await pool.query(
    `UPDATE report_templates SET name = ?, description = ?, definition = ? WHERE id = ?`,
    [name, description, JSON.stringify(definition), req.params.id]
  );
  if (r.affectedRows === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

router.delete("/templates/:id", authRequired, requireRole("admin"), async (req, res) => {
  const [r] = await pool.query(`DELETE FROM report_templates WHERE id = ?`, [req.params.id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

router.post("/", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const {
    report_type = "standard",
    format = "pdf",
    exercise = null,
    template_id = null,
    template_override = null,
  } = req.body || {};
  if (!["pdf", "xlsx", "csv", "json"].includes(format)) {
    return res.status(400).json({ error: "invalid_format" });
  }
  if (template_id) {
    const [[tpl]] = await pool.query(`SELECT id FROM report_templates WHERE id = ? LIMIT 1`, [
      template_id,
    ]);
    if (!tpl) return res.status(400).json({ error: "invalid_template" });
  }
  const [r] = await pool.query(
    `INSERT INTO report_jobs (captive_id, exercise, report_type, format, template_id, definition_override, created_by_user_id, status)
     VALUES (?,?,?,?,?,?,?, 'queued')`,
    [
      captiveId,
      exercise,
      report_type,
      format,
      template_id,
      template_override ? JSON.stringify(template_override) : null,
      req.user?.uid || null,
    ]
  );
  const reportJobId = r.insertId;
  await pool.query(
    `INSERT INTO jobs(type, payload, status, scheduled_at)
     VALUES ('report_generate', ?, 'queued', NOW())`,
    [JSON.stringify({ report_job_id: reportJobId, format })]
  );
  res.status(202).json({ report_job_id: reportJobId });
});

router.post("/preview", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const {
    template_id = null,
    template_override = null,
    exercise = null,
    limit = 5,
  } = req.body || {};
  let template = null;
  if (template_id) {
    const [[tpl]] = await pool.query(`SELECT * FROM report_templates WHERE id = ? LIMIT 1`, [
      template_id,
    ]);
    if (!tpl) return res.status(400).json({ error: "invalid_template" });
    template = JSON.parse(tpl.definition || "{}");
  }
  if (template_override) {
    template = template_override;
  }

  const programmeAllowed = {
    id: "p.id",
    ligne_risque: "p.ligne_risque",
    statut: "p.statut",
    montant_garanti: "p.montant_garanti",
    franchise: "p.franchise",
    devise: "p.devise",
    date_debut: "p.date_debut",
    date_fin: "p.date_fin",
    created_at: "p.created_at",
  };
  const programmeDefaults = ["id", "ligne_risque", "statut", "montant_garanti", "devise"];

  const sinistreAllowed = {
    id: "s.id",
    programme_id: "s.programme_id",
    ligne_risque: "p.ligne_risque",
    date_survenue: "s.date_survenue",
    date_decl: "s.date_decl",
    statut: "s.statut",
    montant_estime: "s.montant_estime",
    montant_paye: "s.montant_paye",
    devise: "s.devise",
    description: "s.description",
    created_at: "s.created_at",
  };
  const sinistreDefaults = ["id", "programme_id", "statut", "montant_estime", "montant_paye"];

  const reglementAllowed = {
    id: "r.id",
    sinistre_id: "r.sinistre_id",
    sinistre_ligne_id: "r.sinistre_ligne_id",
    date: "r.date",
    montant: "r.montant",
    created_at: "r.created_at",
  };
  const reglementDefaults = ["id", "sinistre_id", "date", "montant"];

  function pickColumns(allowed, requested, defaults) {
    if (Array.isArray(requested) && requested.length) {
      const filtered = requested.filter((k) => allowed[k]);
      if (filtered.length) return filtered;
    }
    return defaults;
  }

  const tplTables = template?.tables || {};
  const programmeCols = pickColumns(programmeAllowed, tplTables.programmes?.columns, programmeDefaults);
  const sinistreCols = pickColumns(sinistreAllowed, tplTables.sinistres?.columns, sinistreDefaults);
  const reglementCols = pickColumns(reglementAllowed, tplTables.reglements?.columns, reglementDefaults);

  const lim = Math.min(Number(limit) || 5, 20);
  const preview = {};

  if (await hasColumn("programmes", "id")) {
    const { where, params } = await buildWhere("programmes", "p", exercise, null, [
      "date_debut",
      "date_fin",
    ]);
    const whereSql = where ? `${where} AND p.captive_id = ?` : "WHERE p.captive_id = ?";
    const selectCols = programmeCols.map((c) => `${programmeAllowed[c]} AS ${c}`).join(", ");
    const [rows] = await pool.query(
      `SELECT ${selectCols} FROM programmes p ${whereSql} ORDER BY p.created_at DESC LIMIT ?`,
      [...params, captiveId, lim]
    );
    preview.programmes = rows;
  }
  if (await hasColumn("sinistres", "id")) {
    const { where, params } = await buildWhere("sinistres", "s", exercise, null, [
      "date_survenue",
      "date_decl",
    ]);
    const whereSql = where ? `${where} AND p.captive_id = ?` : "WHERE p.captive_id = ?";
    const selectCols = sinistreCols.map((c) => `${sinistreAllowed[c]} AS ${c}`).join(", ");
    const [rows] = await pool.query(
      `SELECT ${selectCols}
       FROM sinistres s
       LEFT JOIN programmes p ON p.id = s.programme_id
       ${whereSql}
       ORDER BY s.created_at DESC LIMIT ?`,
      [...params, captiveId, lim]
    );
    preview.sinistres = rows;
  }
  if (await hasColumn("reglements", "id")) {
    const { where, params } = await buildWhere("reglements", "r", exercise, null, ["date"]);
    const whereSql = where ? `${where} AND p.captive_id = ?` : "WHERE p.captive_id = ?";
    const selectCols = reglementCols.map((c) => `${reglementAllowed[c]} AS ${c}`).join(", ");
    const [rows] = await pool.query(
      `SELECT ${selectCols}
       FROM reglements r
       JOIN sinistres s ON s.id = r.sinistre_id
       JOIN programmes p ON p.id = s.programme_id
       ${whereSql}
       ORDER BY r.created_at DESC LIMIT ?`,
      [...params, captiveId, lim]
    );
    preview.reglements = rows;
  }

  res.json({ preview, limit: lim, exercise, captive_id: captiveId });
});

router.get("/:id(\\d+)", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const [rows] = await pool.query(`SELECT * FROM report_jobs WHERE id = ? AND captive_id = ? LIMIT 1`, [
    req.params.id,
    captiveId,
  ]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  res.json(rows[0]);
});

router.post("/:id(\\d+)/rerun", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const [rows] = await pool.query(`SELECT * FROM report_jobs WHERE id = ? AND captive_id = ? LIMIT 1`, [
    req.params.id,
    captiveId,
  ]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const src = rows[0];
  const [r] = await pool.query(
    `INSERT INTO report_jobs (captive_id, exercise, report_type, format, template_id, definition_override, tz_name, created_by_user_id, status)
     VALUES (?,?,?,?,?,?,?,?, 'queued')`,
    [
      src.captive_id,
      src.exercise,
      src.report_type,
      src.format,
      src.template_id,
      src.definition_override,
      src.tz_name,
      req.user?.uid || null,
    ]
  );
  const reportJobId = r.insertId;
  await pool.query(
    `INSERT INTO jobs(type, payload, status, scheduled_at)
     VALUES ('report_generate', ?, 'queued', NOW())`,
    [JSON.stringify({ report_job_id: reportJobId, format: src.format })]
  );
  res.status(202).json({ report_job_id: reportJobId });
});

router.get("/", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const { limit = 20, page = 1 } = req.query;
  const lim = Math.min(Number(limit) || 20, 100);
  const pg = Math.max(Number(page) || 1, 1);
  const offset = (pg - 1) * lim;
  const [[count]] = await pool.query(`SELECT COUNT(*) as total FROM report_jobs WHERE captive_id = ?`, [
    captiveId,
  ]);
  const [rows] = await pool.query(
    `SELECT * FROM report_jobs WHERE captive_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [captiveId, lim, offset]
  );
  res.json({ items: rows, page: pg, limit: lim, total: count.total || 0 });
});

router.get("/:id(\\d+)/download", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const [rows] = await pool.query(`SELECT * FROM report_jobs WHERE id = ? AND captive_id = ? LIMIT 1`, [
    req.params.id,
    captiveId,
  ]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const job = rows[0];
  if (!job.file_path) return res.status(404).json({ error: "file_not_ready" });
  let filePath = job.file_path;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const preferred =
        job.format === "pdf"
          ? "report.pdf"
          : job.format === "xlsx"
          ? "report.xlsx"
          : null;
      if (preferred) {
        filePath = path.join(filePath, preferred);
      } else {
        const zipName = `report_${job.id}.zip`;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename=${zipName}`);
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (err) => {
          console.error("zip failed", err);
          res.status(500).end();
        });
        archive.pipe(res);
        archive.directory(filePath, false);
        await archive.finalize();
        return;
      }
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file_missing" });
    res.setHeader("Content-Disposition", `attachment; filename=${path.basename(filePath)}`);
    res.sendFile(filePath);
  } catch (err) {
    console.error("download failed", err);
    res.status(500).json({ error: "download_failed" });
  }
});

router.post("/schedule", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const {
    report_type = "standard",
    format = "pdf",
    exercise = null,
    template_id = null,
    template_override = null,
    scheduled_at = null,
    tz_offset_minutes = null,
    tz_name = null,
  } = req.body || {};
  if (!["pdf", "xlsx", "csv", "json"].includes(format)) {
    return res.status(400).json({ error: "invalid_format" });
  }
  if (!scheduled_at) return res.status(400).json({ error: "missing_scheduled_at" });
  let scheduleDate = new Date(scheduled_at);
  if (tz_offset_minutes !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduled_at)) {
    const [datePart, timePart] = scheduled_at.split("T");
    const [y, m, d] = datePart.split("-").map((v) => Number(v));
    const [hh, mm] = timePart.split(":").map((v) => Number(v));
    const offset = Number(tz_offset_minutes);
    if (!Number.isNaN(offset)) {
      const utcMs = Date.UTC(y, m - 1, d, hh, mm) + offset * 60 * 1000;
      scheduleDate = new Date(utcMs);
    }
  }
  if (Number.isNaN(scheduleDate.getTime())) {
    return res.status(400).json({ error: "invalid_scheduled_at" });
  }
  if (template_id) {
    const [[tpl]] = await pool.query(`SELECT id FROM report_templates WHERE id = ? LIMIT 1`, [
      template_id,
    ]);
    if (!tpl) return res.status(400).json({ error: "invalid_template" });
  }
  const [r] = await pool.query(
    `INSERT INTO report_jobs (captive_id, exercise, report_type, format, template_id, definition_override, tz_name, created_by_user_id, status)
     VALUES (?,?,?,?,?,?,?,?, 'queued')`,
    [
      captiveId,
      exercise,
      report_type,
      format,
      template_id,
      template_override ? JSON.stringify(template_override) : null,
      tz_name,
      req.user?.uid || null,
    ]
  );
  const reportJobId = r.insertId;
  await pool.query(
    `INSERT INTO jobs(type, payload, status, scheduled_at)
     VALUES ('report_generate', ?, 'queued', ?)`,
    [JSON.stringify({ report_job_id: reportJobId, format }), scheduleDate]
  );
  res.status(202).json({ report_job_id: reportJobId, scheduled_at: scheduleDate });
});

router.get("/scheduled", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const { limit = 20, page = 1, created_by = null, status = null } = req.query;
  const lim = Math.min(Number(limit) || 20, 100);
  const pg = Math.max(Number(page) || 1, 1);
  const offset = (pg - 1) * lim;
  const filters = ["r.captive_id = ?"];
  const params = [captiveId];
  if (created_by) {
    if (/^\d+$/.test(String(created_by))) {
      filters.push(`r.created_by_user_id = ?`);
      params.push(Number(created_by));
    } else {
      filters.push(`u.email = ?`);
      params.push(String(created_by));
    }
  }
  if (status) {
    filters.push(`j.status = ?`);
    params.push(String(status));
  }
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const [[count]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM jobs j
     JOIN report_jobs r
       ON CAST(JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.report_job_id')) AS UNSIGNED) = r.id
     LEFT JOIN users u ON u.id = r.created_by_user_id
     WHERE j.type = 'report_generate' AND j.status = 'queued' ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT r.*, j.scheduled_at, j.status as job_status, u.email as created_by_email
     FROM jobs j
     JOIN report_jobs r
       ON CAST(JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.report_job_id')) AS UNSIGNED) = r.id
     LEFT JOIN users u ON u.id = r.created_by_user_id
     WHERE j.type = 'report_generate' AND j.status = 'queued' ${where}
     ORDER BY j.scheduled_at ASC
     LIMIT ? OFFSET ?`,
    [...params, lim, offset]
  );
  res.json({ items: rows, page: pg, limit: lim, total: count.total || 0 });
});

router.delete("/scheduled/:id", authRequired, requireRole(...canRequest), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const reportJobId = Number(req.params.id);
  if (!reportJobId) return res.status(400).json({ error: "invalid_id" });
  const [r] = await pool.query(
    `DELETE j
     FROM jobs j
     JOIN report_jobs rj
       ON CAST(JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.report_job_id')) AS UNSIGNED) = rj.id
     WHERE j.type = 'report_generate'
       AND j.status = 'queued'
       AND rj.id = ?
       AND rj.captive_id = ?`,
    [reportJobId, captiveId]
  );
  await pool.query(
    `UPDATE report_jobs
     SET status = 'canceled'
     WHERE id = ? AND captive_id = ? AND status = 'queued'`,
    [reportJobId, captiveId]
  );
  res.json({ ok: true, deleted_jobs: r.affectedRows || 0 });
});

export default router;
