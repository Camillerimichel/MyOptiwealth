import { Router } from "express";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
const canManage = ["admin", "cfo", "risk_manager", "conseil"];

const DOCS_DIR = process.env.DOCS_DIR || path.resolve("storage", "docs");
const s2CodeSchema = z
  .string()
  .min(1)
  .max(5)
  .transform((s) => s.trim().toUpperCase());

async function hasProgramme(programmeId) {
  const [rows] = await pool.query(
    `SELECT id
     FROM programmes
     WHERE id = ?
     LIMIT 1`,
    [programmeId]
  );
  return rows.length > 0;
}

async function hasBranchS2Code(s2Code) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM insurance_branch
     WHERE s2_code = ?
     LIMIT 1`,
    [s2Code]
  );
  return rows.length > 0;
}

function normalizeInsurerName(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

async function registerInsurerName(value) {
  const normalized = normalizeInsurerName(value);
  if (!normalized) return null;
  await pool.query(`INSERT IGNORE INTO insurers (name) VALUES (?)`, [normalized]);
  return normalized;
}

async function ensureProgrammeScope(req, res, programmeId) {
  const pid = Number(programmeId);
  if (!Number.isInteger(pid) || pid <= 0) {
    res.status(400).json({ error: "invalid_programme_id" });
    return false;
  }
  if (!(await hasProgramme(pid))) {
    res.status(404).json({ error: "programme_not_found" });
    return false;
  }
  return true;
}

const statutEnum = z.enum(["actif", "suspendu", "clos"]);
const deviseSchema = z.string().length(3).transform((s) => s.toUpperCase());

const programmeCreate = z.object({
  branch_s2_code: s2CodeSchema,
  ligne_risque: z.string().min(1),
  limite: z.coerce.number().nonnegative().default(0),
  franchise: z.coerce.number().nonnegative().default(0),
  devise: deviseSchema.default("EUR"),
  assureur: z.string().optional().nullable(),
  debut: z.string().optional().nullable(),
  fin: z.string().optional().nullable(),
  statut: statutEnum.default("actif"),
});

const programmePatch = programmeCreate.partial();

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatMoney(value, currency) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const num = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(n)
    .replace(/[\u00A0\u202F]/g, " ");
  return `${num} ${currency || ""}`.trim();
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const num = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })
    .format(n)
    .replace(/[\u00A0\u202F]/g, " ");
  return `${num} %`;
}

function formatIntegerFr(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/[\u00A0\u202F]/g, " ");
}

function safeRatio(numerator, denominator) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  if (!(d > 0)) return null;
  return n / d;
}

function shortText(value, max = 110) {
  if (!value) return "—";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const CODE_LABELS = {
  PROPERTY: "Dommages",
  LIABILITY: "Responsabilite civile",
  MOTOR: "Automobile",
  OTHER: "Autre",
  FIXED_PREMIUM: "Prime fixe",
  RATE_ON_LIMIT: "Taux sur limite",
  RATE_ON_TURNOVER: "Taux sur CA",
  RATE_ON_PAYROLL: "Taux sur masse salariale",
  CUSTOM: "Personnalise",
  PRIMARY: "Primaire",
  EXCESS: "Excedent",
  QUOTA: "Quote-part",
  FIXED: "Montant fixe",
  PERCENTAGE: "Pourcentage",
  LEAD: "Chef de file",
  CO_INSURER: "Coassureur",
  FRONTING: "Fronting",
  POLICY: "Police",
  ANNEX: "Annexe",
  CERTIFICATE: "Attestation",
};

function labelForCode(value) {
  if (value === null || value === undefined || value === "") return "—";
  const raw = String(value).trim();
  if (!raw) return "—";
  const normalized = raw.toUpperCase();
  return CODE_LABELS[normalized] || raw;
}

function ensurePdfSpace(doc, minHeight = 28) {
  const maxY = doc.page.height - doc.page.margins.bottom;
  if (doc.y + minHeight > maxY) doc.addPage();
}

function drawPdfHeadingLeft(doc, text, size = 12) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc
    .font("Helvetica-Bold")
    .fontSize(size)
    .fillColor("#0f172a")
    .text(text, left, doc.y, { width, align: "left" });
}

function drawPdfTableSection(doc, { title, columns, rows, limit = 30, rowHeight = 18, autoRowHeight = false, maxRowHeight = null }) {
  ensurePdfSpace(doc, 56);
  doc.moveDown(0.7);
  drawPdfHeadingLeft(doc, `${title} (${rows.length})`, 12);

  if (!rows.length) {
    doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("Aucun élément.");
    return;
  }

  const shown = rows.slice(0, limit);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const tableWidth = right - left;
  const headerHeight = 20;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const totalWeight = columns.reduce((acc, c) => acc + (Number(c.weight) || 1), 0);

  const colDefs = columns.map((c) => ({
    ...c,
    width: (tableWidth * (Number(c.weight) || 1)) / totalWeight,
  }));

  const drawHeader = () => {
    ensurePdfSpace(doc, headerHeight + rowHeight);
    const y = doc.y + 2;
    let x = left;
    colDefs.forEach((col) => {
      doc.rect(x, y, col.width, headerHeight).fillAndStroke("#f1f5f9", "#cbd5e1");
      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor("#0f172a")
        .text(col.label, x + 4, y + 6, {
          width: col.width - 8,
          align: col.align || "left",
          lineBreak: false,
        });
      x += col.width;
    });
    doc.y = y + headerHeight;
  };

  drawHeader();

  shown.forEach((row, idx) => {
    let computedRowHeight = rowHeight;
    if (autoRowHeight) {
      let maxCellHeight = 0;
      for (const col of colDefs) {
        const raw = row[col.key];
        const text = col.maxChars === null ? String(raw ?? "—") : shortText(raw ?? "—", col.maxChars || 42);
        if (col.wrap === true) {
          doc.font("Helvetica").fontSize(8.3);
          const h = doc.heightOfString(text, {
            width: col.width - 8,
            align: col.align || "left",
          });
          maxCellHeight = Math.max(maxCellHeight, h);
        }
      }
      if (maxCellHeight > 0) {
        computedRowHeight = Math.max(rowHeight, Math.ceil(maxCellHeight + 10));
        if (maxRowHeight) computedRowHeight = Math.min(computedRowHeight, maxRowHeight);
      }
    }

    if (doc.y + computedRowHeight > bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let x = left;
    const stripeColor = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    colDefs.forEach((col) => {
      doc.rect(x, y, col.width, computedRowHeight).fillAndStroke(stripeColor, "#e2e8f0");
      const raw = row[col.key];
      const text =
        col.maxChars === null ? String(raw ?? "—") : shortText(raw ?? "—", col.maxChars || 42);
      doc
        .font("Helvetica")
        .fontSize(8.3)
        .fillColor("#1f2937")
        .text(text, x + 4, y + 5, {
          width: col.width - 8,
          height: Math.max(8, computedRowHeight - 8),
          align: col.align || "left",
          lineBreak: col.wrap === true,
        });
      x += col.width;
    });
    doc.y = y + computedRowHeight;
  });

  if (rows.length > shown.length) {
    ensurePdfSpace(doc, 18);
    doc
      .moveDown(0.3)
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#b45309")
      .text(`... ${rows.length - shown.length} élément(s) supplémentaire(s).`);
  }
}

function drawPdfDualKpiSections(
  doc,
  {
    leftTitle,
    leftRows,
    rightTitle,
    rightRows,
    leftCount = null,
    rightCount = null,
    rowHeight = 18,
    gap = 10,
  }
) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const totalWidth = right - left;
  const colWidth = (totalWidth - gap) / 2;
  const headerHeight = 20;
  const titleHeight = 16;
  const maxRows = Math.max(leftRows.length, rightRows.length, 1);
  const neededHeight = 10 + titleHeight + headerHeight + maxRows * rowHeight + 8;

  ensurePdfSpace(doc, neededHeight);
  doc.moveDown(0.7);

  const startY = doc.y;
  const blocks = [
    { x: left, width: colWidth, title: leftTitle, rows: leftRows, count: leftCount },
    { x: left + colWidth + gap, width: colWidth, title: rightTitle, rows: rightRows, count: rightCount },
  ];

  for (const block of blocks) {
    const titleText = block.count == null ? block.title : `${block.title} (${block.count})`;
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#0f172a")
      .text(titleText, block.x, startY, { width: block.width, align: "left", lineBreak: false });

    const headerY = startY + titleHeight;
    const keyWidth = block.width * 0.52;
    const valueWidth = block.width - keyWidth;

    doc.rect(block.x, headerY, keyWidth, headerHeight).fillAndStroke("#f1f5f9", "#cbd5e1");
    doc.rect(block.x + keyWidth, headerY, valueWidth, headerHeight).fillAndStroke("#f1f5f9", "#cbd5e1");
    doc
      .font("Helvetica-Bold")
      .fontSize(8.2)
      .fillColor("#0f172a")
      .text("Indicateur", block.x + 4, headerY + 6, { width: keyWidth - 8, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(8.2)
      .fillColor("#0f172a")
      .text("Valeur", block.x + keyWidth + 4, headerY + 6, {
        width: valueWidth - 8,
        align: "right",
        lineBreak: false,
      });

    for (let i = 0; i < maxRows; i += 1) {
      const row = block.rows[i] || { champ: "", valeur: "" };
      const y = headerY + headerHeight + i * rowHeight;
      const stripe = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      doc.rect(block.x, y, keyWidth, rowHeight).fillAndStroke(stripe, "#e2e8f0");
      doc.rect(block.x + keyWidth, y, valueWidth, rowHeight).fillAndStroke(stripe, "#e2e8f0");
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#1f2937")
        .text(shortText(row.champ || "—", 52), block.x + 4, y + 5, {
          width: keyWidth - 8,
          height: rowHeight - 8,
          lineBreak: false,
        });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#111827")
        .text(shortText(row.valeur || "—", 64), block.x + keyWidth + 4, y + 5, {
          width: valueWidth - 8,
          height: rowHeight - 8,
          align: "right",
          lineBreak: false,
        });
    }
  }

  doc.y = startY + titleHeight + headerHeight + maxRows * rowHeight + 4;
}

function listQuery(req, res, table, filters = [], searchFields = [], dateField = null) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  for (const f of filters) {
    if (req.query[f]) {
      where.push(`${f} = ?`);
      params.push(req.query[f]);
    }
  }
  if (req.query.q && searchFields.length) {
    const q = `%${req.query.q}%`;
    const ors = searchFields.map((f) => `${f} LIKE ?`);
    where.push(`(${ors.join(" OR ")})`);
    for (let i = 0; i < searchFields.length; i += 1) params.push(q);
  }
  if (dateField) {
    if (req.query.from) {
      where.push(`${dateField} >= ?`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      where.push(`${dateField} <= ?`);
      params.push(req.query.to);
    }
  }
  return { page, limit, offset, where, params };
}

async function listTable(req, res, table, filters = [], orderBy = "created_at", searchFields = [], dateField = null) {
  const { page, limit, offset, where, params } = listQuery(req, res, table, filters, searchFields, dateField);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total
     FROM ${table} t
     JOIN programmes p ON p.id = t.programme_id
     ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT t.*
     FROM ${table} t
     JOIN programmes p ON p.id = t.programme_id
     ${whereSql}
     ORDER BY t.${orderBy} DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
}

async function createRow(table, idField, fields, req, res, auditEntity) {
  if (!(await ensureProgrammeScope(req, res, req.body.programme_id))) return;
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = fields.map((f) => req.body[f]);
  const [r] = await pool.query(
    `INSERT INTO ${table} (${keys}) VALUES (${placeholders})`,
    values
  );
  const [rows] = await pool.query(
    `SELECT t.*
     FROM ${table} t
     JOIN programmes p ON p.id = t.programme_id
     WHERE t.${idField} = ?`,
    [r.insertId]
  );
  const created = rows[0];
  await logAudit(req.user?.id, auditEntity, r.insertId, "create", created);
  res.status(201).json(created);
}

async function updateRow(table, idField, fields, req, res, auditEntity) {
  if (req.body.programme_id !== undefined) {
    if (!(await ensureProgrammeScope(req, res, req.body.programme_id))) return;
  }
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "no_fields" });
  values.push(req.params.id);
  const [upd] = await pool.query(
    `UPDATE ${table} t
     JOIN programmes p ON p.id = t.programme_id
     SET ${sets.join(", ")}
     WHERE t.${idField} = ?`,
    values
  );
  if (!upd.affectedRows) return res.status(404).json({ error: "not_found" });
  const [rows] = await pool.query(
    `SELECT t.*
     FROM ${table} t
     JOIN programmes p ON p.id = t.programme_id
     WHERE t.${idField} = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const updated = rows[0];
  await logAudit(req.user?.id, auditEntity, Number(req.params.id), "update", updated);
  res.json(updated);
}

async function deleteRow(table, idField, req, res, auditEntity) {
  const [rows] = await pool.query(
    `SELECT t.*
     FROM ${table} t
     JOIN programmes p ON p.id = t.programme_id
     WHERE t.${idField} = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.query(
    `DELETE t
     FROM ${table} t
     JOIN programmes p ON p.id = t.programme_id
     WHERE t.${idField} = ?`,
    [req.params.id]
  );
  await logAudit(req.user?.id, auditEntity, Number(req.params.id), "delete", null);
  res.json({ ok: true });
}

router.get("/", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  if (req.query.statut) {
    where.push("statut = ?");
    params.push(req.query.statut);
  }
  if (req.query.devise) {
    where.push("devise = ?");
    params.push(req.query.devise);
  }
  if (req.query.assureur) {
    where.push("assureur = ?");
    params.push(req.query.assureur);
  }
  if (req.query.branch_s2_code) {
    where.push("branch_s2_code = ?");
    params.push(String(req.query.branch_s2_code).toUpperCase());
  }
  if (req.query.ligne) {
    where.push("ligne_risque LIKE ?");
    params.push(`%${req.query.ligne}%`);
  }
  if (req.query.q) {
    const q = `%${req.query.q}%`;
    where.push("(ligne_risque LIKE ? OR assureur LIKE ? OR branch_s2_code LIKE ?)");
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM programmes ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT * FROM programmes ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
});

router.get("/branches", authRequired, requireRole(...canManage), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT
       b.s2_code,
       MAX(b.name) AS name,
       MAX(b.branch_type) AS branch_type,
       COUNT(DISTINCT b.captive_id) AS captive_count
     FROM insurance_branch b
     WHERE b.s2_code IS NOT NULL AND b.s2_code <> ''
     GROUP BY b.s2_code
     ORDER BY b.s2_code ASC`
  );
  res.json({ data: rows });
});

router.post(
  "/",
  authRequired,
  requireRole(...canManage),
  validate(programmeCreate),
  async (req, res) => {
    const { branch_s2_code, ligne_risque, limite, franchise, devise, assureur, debut, fin, statut } = req.body;
    if (!(await hasBranchS2Code(branch_s2_code))) {
      return res.status(400).json({ error: "invalid_branch_s2_code" });
    }
    const assureurName = await registerInsurerName(assureur);
    const [r] = await pool.query(
      `INSERT INTO programmes(captive_id, branch_s2_code, ligne_risque, limite, franchise, devise, assureur, debut, fin, statut)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [null, branch_s2_code, ligne_risque, limite, franchise, devise, assureurName, debut, fin, statut]
    );
    const [rows] = await pool.query(
      `SELECT * FROM programmes WHERE id = ?`,
      [r.insertId]
    );
    const programme = rows[0];
    await logAudit(req.user?.id, "programme", r.insertId, "create", programme);
    res.status(201).json(programme);
  }
);

const layerTypeEnum = z.enum(["PRIMARY", "EXCESS", "QUOTA"]);
const coverageTypeEnum = z.enum(["PROPERTY", "LIABILITY", "MOTOR", "OTHER"]);
const pricingMethodEnum = z.enum(["FIXED_PREMIUM", "RATE_ON_LIMIT", "RATE_ON_TURNOVER", "RATE_ON_PAYROLL", "CUSTOM"]);
const deductibleUnitEnum = z.enum(["FIXED", "PERCENTAGE"]);
const carrierRoleEnum = z.enum(["LEAD", "CO_INSURER", "FRONTING"]);
const insurerTypeEnum = z.enum(["FRONTING", "REINSURANCE"]);
const documentTypeEnum = z.enum(["POLICY", "ANNEX", "CERTIFICATE", "OTHER"]);

const dateSchema = z.string().optional().nullable();
const currencySchema = z.string().length(3).transform((s) => s.toUpperCase());

const layerCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  name: z.string().min(1),
  layer_type: layerTypeEnum,
  attachment_point: z.coerce.number().nonnegative().optional().nullable(),
  limit_amount: z.coerce.number().nonnegative().optional().nullable(),
  currency: currencySchema.default("EUR"),
  effective_from: dateSchema,
  effective_to: dateSchema,
});
const layerPatch = layerCreate.partial();

const coverageCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  label: z.string().min(1),
  coverage_type: coverageTypeEnum,
  limit_per_claim: z.coerce.number().nonnegative().optional().nullable(),
  limit_annual: z.coerce.number().nonnegative().optional().nullable(),
  currency: currencySchema.default("EUR"),
});
const coveragePatch = coverageCreate.partial();

const pricingCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  coverage_id: z.coerce.number().int().positive().optional().nullable(),
  pricing_method: pricingMethodEnum.default("FIXED_PREMIUM"),
  premium_amount: z.coerce.number().nonnegative().optional().nullable(),
  rate_value: z.coerce.number().min(0).max(100).optional().nullable(),
  minimum_premium: z.coerce.number().nonnegative().optional().nullable(),
  currency: currencySchema.default("EUR"),
  effective_from: dateSchema,
  effective_to: dateSchema,
  notes: z.string().optional().nullable(),
});
const pricingPatch = pricingCreate.partial();

const deductibleCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  coverage_id: z.coerce.number().int().positive().optional().nullable(),
  amount: z.coerce.number().nonnegative().optional().nullable(),
  unit: deductibleUnitEnum.default("FIXED"),
  currency: currencySchema.default("EUR"),
  notes: z.string().optional().nullable(),
});
const deductiblePatch = deductibleCreate.partial();

const exclusionCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  category: z.string().optional().nullable(),
  description: z.string().min(1),
});
const exclusionPatch = exclusionCreate.partial();

const conditionCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  title: z.string().min(1),
  content: z.string().min(1),
});
const conditionPatch = conditionCreate.partial();

const carrierCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  carrier_name: z.string().min(1),
  role: carrierRoleEnum,
  share_pct: z.coerce.number().min(0).max(100).optional().nullable(),
});
const carrierPatch = carrierCreate.partial();

const insurerCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  insurer_name: z.string().min(1),
  insurer_type: insurerTypeEnum,
  share_pct: z.coerce.number().min(0).max(100).optional().nullable(),
});
const insurerPatch = insurerCreate.partial();

const documentCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  doc_type: documentTypeEnum,
  file_name: z.string().min(1),
  file_path: z.string().optional().nullable(),
  file_base64: z.string().optional().nullable(),
});
const documentPatch = documentCreate.partial();

const versionCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  version_label: z.string().min(1),
  changed_by: z.string().optional().nullable(),
  change_notes: z.string().optional().nullable(),
  changed_at: dateSchema,
});
const versionPatch = versionCreate.partial();

router.get("/layers", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_layers", ["programme_id", "layer_type", "currency"], "created_at", ["name"], "effective_from");
});
router.post("/layers", authRequired, requireRole(...canManage), validate(layerCreate), async (req, res) => {
  await createRow(
    "programme_layers",
    "id_layer",
    ["programme_id", "name", "layer_type", "attachment_point", "limit_amount", "currency", "effective_from", "effective_to"],
    req,
    res,
    "programme_layer"
  );
});
router.patch("/layers/:id", authRequired, requireRole(...canManage), validate(layerPatch), async (req, res) => {
  await updateRow("programme_layers", "id_layer", ["programme_id", "name", "layer_type", "attachment_point", "limit_amount", "currency", "effective_from", "effective_to"], req, res, "programme_layer");
});
router.delete("/layers/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_layers", "id_layer", req, res, "programme_layer");
});

router.get("/coverages", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_coverages", ["programme_id", "coverage_type", "currency"], "created_at", ["label"]);
});
router.post("/coverages", authRequired, requireRole(...canManage), validate(coverageCreate), async (req, res) => {
  await createRow(
    "programme_coverages",
    "id_coverage",
    ["programme_id", "label", "coverage_type", "limit_per_claim", "limit_annual", "currency"],
    req,
    res,
    "programme_coverage"
  );
});
router.patch("/coverages/:id", authRequired, requireRole(...canManage), validate(coveragePatch), async (req, res) => {
  await updateRow("programme_coverages", "id_coverage", ["programme_id", "label", "coverage_type", "limit_per_claim", "limit_annual", "currency"], req, res, "programme_coverage");
});
router.delete("/coverages/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_coverages", "id_coverage", req, res, "programme_coverage");
});

router.get("/pricing", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(
    req,
    res,
    "programme_pricing",
    ["programme_id", "coverage_id", "pricing_method", "currency"],
    "created_at",
    ["notes"],
    "effective_from"
  );
});
router.post("/pricing", authRequired, requireRole(...canManage), validate(pricingCreate), async (req, res) => {
  await createRow(
    "programme_pricing",
    "id_pricing",
    [
      "programme_id",
      "coverage_id",
      "pricing_method",
      "premium_amount",
      "rate_value",
      "minimum_premium",
      "currency",
      "effective_from",
      "effective_to",
      "notes",
    ],
    req,
    res,
    "programme_pricing"
  );
});
router.patch("/pricing/:id", authRequired, requireRole(...canManage), validate(pricingPatch), async (req, res) => {
  await updateRow(
    "programme_pricing",
    "id_pricing",
    [
      "programme_id",
      "coverage_id",
      "pricing_method",
      "premium_amount",
      "rate_value",
      "minimum_premium",
      "currency",
      "effective_from",
      "effective_to",
      "notes",
    ],
    req,
    res,
    "programme_pricing"
  );
});
router.delete("/pricing/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_pricing", "id_pricing", req, res, "programme_pricing");
});

router.get("/deductibles", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_deductibles", ["programme_id", "coverage_id", "unit", "currency"], "created_at", ["notes"]);
});
router.post("/deductibles", authRequired, requireRole(...canManage), validate(deductibleCreate), async (req, res) => {
  await createRow(
    "programme_deductibles",
    "id_deductible",
    ["programme_id", "coverage_id", "amount", "unit", "currency", "notes"],
    req,
    res,
    "programme_deductible"
  );
});
router.patch("/deductibles/:id", authRequired, requireRole(...canManage), validate(deductiblePatch), async (req, res) => {
  await updateRow("programme_deductibles", "id_deductible", ["programme_id", "coverage_id", "amount", "unit", "currency", "notes"], req, res, "programme_deductible");
});
router.delete("/deductibles/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_deductibles", "id_deductible", req, res, "programme_deductible");
});

router.get("/exclusions", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_exclusions", ["programme_id", "category"], "created_at", ["description"]);
});
router.post("/exclusions", authRequired, requireRole(...canManage), validate(exclusionCreate), async (req, res) => {
  await createRow(
    "programme_exclusions",
    "id_exclusion",
    ["programme_id", "category", "description"],
    req,
    res,
    "programme_exclusion"
  );
});
router.patch("/exclusions/:id", authRequired, requireRole(...canManage), validate(exclusionPatch), async (req, res) => {
  await updateRow("programme_exclusions", "id_exclusion", ["programme_id", "category", "description"], req, res, "programme_exclusion");
});
router.delete("/exclusions/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_exclusions", "id_exclusion", req, res, "programme_exclusion");
});

router.get("/conditions", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_conditions", ["programme_id"], "created_at", ["title", "content"]);
});
router.post("/conditions", authRequired, requireRole(...canManage), validate(conditionCreate), async (req, res) => {
  await createRow(
    "programme_conditions",
    "id_condition",
    ["programme_id", "title", "content"],
    req,
    res,
    "programme_condition"
  );
});
router.patch("/conditions/:id", authRequired, requireRole(...canManage), validate(conditionPatch), async (req, res) => {
  await updateRow("programme_conditions", "id_condition", ["programme_id", "title", "content"], req, res, "programme_condition");
});
router.delete("/conditions/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_conditions", "id_condition", req, res, "programme_condition");
});

router.get("/insurers", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_insurers", ["programme_id", "insurer_type"], "created_at", ["insurer_name"]);
});
router.post("/insurers", authRequired, requireRole(...canManage), validate(insurerCreate), async (req, res) => {
  req.body.insurer_name = await registerInsurerName(req.body.insurer_name);
  await createRow(
    "programme_insurers",
    "id_insurer",
    ["programme_id", "insurer_name", "insurer_type", "share_pct"],
    req,
    res,
    "programme_insurer"
  );
});
router.patch("/insurers/:id", authRequired, requireRole(...canManage), validate(insurerPatch), async (req, res) => {
  if (req.body.insurer_name !== undefined) {
    req.body.insurer_name = await registerInsurerName(req.body.insurer_name);
  }
  await updateRow("programme_insurers", "id_insurer", ["programme_id", "insurer_name", "insurer_type", "share_pct"], req, res, "programme_insurer");
});
router.delete("/insurers/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_insurers", "id_insurer", req, res, "programme_insurer");
});

router.get("/carriers", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_carriers", ["programme_id", "role"], "created_at", ["carrier_name"]);
});
router.post("/carriers", authRequired, requireRole(...canManage), validate(carrierCreate), async (req, res) => {
  req.body.carrier_name = await registerInsurerName(req.body.carrier_name);
  await createRow(
    "programme_carriers",
    "id_carrier",
    ["programme_id", "carrier_name", "role", "share_pct"],
    req,
    res,
    "programme_carrier"
  );
});
router.patch("/carriers/:id", authRequired, requireRole(...canManage), validate(carrierPatch), async (req, res) => {
  if (req.body.carrier_name !== undefined) {
    req.body.carrier_name = await registerInsurerName(req.body.carrier_name);
  }
  await updateRow("programme_carriers", "id_carrier", ["programme_id", "carrier_name", "role", "share_pct"], req, res, "programme_carrier");
});
router.delete("/carriers/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_carriers", "id_carrier", req, res, "programme_carrier");
});

router.get("/documents", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_documents", ["programme_id", "doc_type"], "uploaded_at", ["file_name", "file_path"], "uploaded_at");
});
router.post("/documents", authRequired, requireRole(...canManage), validate(documentCreate), async (req, res) => {
  if (!(await ensureProgrammeScope(req, res, req.body.programme_id))) return;
  const { programme_id, doc_type, file_name, file_path, file_base64 } = req.body;
  let storedPath = file_path || null;
  if (file_base64) {
    const base64 = String(file_base64);
    const raw = base64.includes(",") ? base64.split(",").pop() : base64;
    const safeName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dir = path.join(DOCS_DIR, `programme_${programme_id}`);
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${Date.now()}_${safeName}`);
    await fs.writeFile(dest, Buffer.from(raw || "", "base64"));
    storedPath = dest;
  }
  const [r] = await pool.query(
    `INSERT INTO programme_documents (programme_id, doc_type, file_name, file_path)
     VALUES (?,?,?,?)`,
    [programme_id, doc_type, file_name, storedPath]
  );
  const [rows] = await pool.query(
    `SELECT d.*
     FROM programme_documents d
     JOIN programmes p ON p.id = d.programme_id
     WHERE d.id_document = ?`,
    [r.insertId]
  );
  const created = rows[0];
  await logAudit(req.user?.id, "programme_document", r.insertId, "create", created);
  res.status(201).json(created);
});
router.patch("/documents/:id", authRequired, requireRole(...canManage), validate(documentPatch), async (req, res) => {
  await updateRow("programme_documents", "id_document", ["programme_id", "doc_type", "file_name", "file_path"], req, res, "programme_document");
});
router.delete("/documents/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_documents", "id_document", req, res, "programme_document");
});

router.get("/documents/:id/view", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*
     FROM programme_documents d
     JOIN programmes p ON p.id = d.programme_id
     WHERE d.id_document = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const doc = rows[0];
  if (!doc.file_path) return res.status(404).json({ error: "file_missing" });
  const resolved = path.resolve(doc.file_path);
  const root = path.resolve(DOCS_DIR);
  if (!resolved.startsWith(root)) return res.status(400).json({ error: "invalid_path" });
  const ext = path.extname(doc.file_name || "").toLowerCase();
  const mimeMap = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".txt": "text/plain",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", "inline");
  res.sendFile(resolved);
});

router.get("/versions", authRequired, requireRole(...canManage), async (req, res) => {
  await listTable(req, res, "programme_versions", ["programme_id"], "changed_at", ["version_label", "changed_by", "change_notes"], "changed_at");
});
router.post("/versions", authRequired, requireRole(...canManage), validate(versionCreate), async (req, res) => {
  await createRow(
    "programme_versions",
    "id_version",
    ["programme_id", "version_label", "changed_by", "change_notes", "changed_at"],
    req,
    res,
    "programme_version"
  );
});
router.patch("/versions/:id", authRequired, requireRole(...canManage), validate(versionPatch), async (req, res) => {
  await updateRow("programme_versions", "id_version", ["programme_id", "version_label", "changed_by", "change_notes", "changed_at"], req, res, "programme_version");
});
router.delete("/versions/:id", authRequired, requireRole(...canManage), async (req, res) => {
  await deleteRow("programme_versions", "id_version", req, res, "programme_version");
});

router.get("/:id/summary.pdf", authRequired, requireRole(...canManage), async (req, res) => {
  const programmeId = Number(req.params.id);
  if (!Number.isInteger(programmeId) || programmeId <= 0) {
    return res.status(400).json({ error: "invalid_programme_id" });
  }

  const [[programme]] = await pool.query(
    `SELECT p.*, b.name AS branch_name
     FROM programmes p
     LEFT JOIN insurance_branch b ON b.s2_code = p.branch_s2_code
     WHERE p.id = ?
     LIMIT 1`,
    [programmeId]
  );
  if (!programme) return res.status(404).json({ error: "programme_not_found" });

  const [layers] = await pool.query(
    `SELECT name, layer_type, attachment_point, limit_amount, currency, effective_from, effective_to
     FROM programme_layers
     WHERE programme_id = ?
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [coverages] = await pool.query(
    `SELECT id_coverage, label, coverage_type, limit_per_claim, limit_annual, currency
     FROM programme_coverages
     WHERE programme_id = ?
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [pricing] = await pool.query(
    `SELECT pr.*, c.label AS coverage_label
     FROM programme_pricing pr
     LEFT JOIN programme_coverages c ON c.id_coverage = pr.coverage_id
     WHERE pr.programme_id = ?
     ORDER BY pr.created_at DESC`,
    [programmeId]
  );
  const [deductibles] = await pool.query(
    `SELECT d.*, c.label AS coverage_label
     FROM programme_deductibles d
     LEFT JOIN programme_coverages c ON c.id_coverage = d.coverage_id
     WHERE d.programme_id = ?
     ORDER BY d.created_at DESC`,
    [programmeId]
  );
  const [exclusions] = await pool.query(
    `SELECT category, description
     FROM programme_exclusions
     WHERE programme_id = ?
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [conditions] = await pool.query(
    `SELECT title, content
     FROM programme_conditions
     WHERE programme_id = ?
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [frontingInsurers] = await pool.query(
    `SELECT insurer_name, share_pct
     FROM programme_insurers
     WHERE programme_id = ? AND insurer_type = 'FRONTING'
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [reinsuranceInsurers] = await pool.query(
    `SELECT insurer_name, share_pct
     FROM programme_insurers
     WHERE programme_id = ? AND insurer_type = 'REINSURANCE'
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [carriers] = await pool.query(
    `SELECT carrier_name, role, share_pct
     FROM programme_carriers
     WHERE programme_id = ?
     ORDER BY created_at DESC`,
    [programmeId]
  );
  const [documents] = await pool.query(
    `SELECT doc_type, file_name, uploaded_at
     FROM programme_documents
     WHERE programme_id = ?
     ORDER BY uploaded_at DESC`,
    [programmeId]
  );
  const [versions] = await pool.query(
    `SELECT version_label, changed_by, change_notes, changed_at
     FROM programme_versions
     WHERE programme_id = ?
     ORDER BY changed_at DESC`,
    [programmeId]
  );

  const [[premiumKpi]] = await pool.query(
    `SELECT
       COUNT(DISTINCT ct.id) AS total_contracts,
       COALESCE(SUM(CASE
         WHEN t.frequency = 'MONTHLY' THEN t.amount * 12
         WHEN t.frequency = 'QUARTERLY' THEN t.amount * 4
         WHEN t.frequency = 'ANNUAL' THEN t.amount
         ELSE 0
       END), 0) AS total_annual_expected,
       COALESCE(SUM(pay.total_paid), 0) AS total_paid
     FROM contracts ct
     LEFT JOIN contract_premium_terms t ON t.contract_id = ct.id
     LEFT JOIN (
       SELECT contract_id, SUM(amount) AS total_paid
       FROM contract_premium_payments
       GROUP BY contract_id
     ) pay ON pay.contract_id = ct.id
     WHERE ct.programme_id = ?`,
    [programmeId]
  );

  const [[claimsKpi]] = await pool.query(
    `SELECT
       COUNT(DISTINCT s.id) AS total_claims,
       COUNT(sl.id) AS total_claim_lines,
       COALESCE(SUM(sl.montant_estime), 0) AS total_estime,
       COALESCE(SUM(sl.montant_paye), 0) AS total_paye_lignes,
       COALESCE(SUM(CASE WHEN s.statut = 'ouvert' THEN sl.montant_estime ELSE 0 END), 0) AS total_ouvert,
       COALESCE(SUM(CASE WHEN s.statut = 'en_cours' THEN sl.montant_estime ELSE 0 END), 0) AS total_en_cours,
       COALESCE(SUM(CASE WHEN s.statut = 'clos' THEN sl.montant_estime ELSE 0 END), 0) AS total_clos,
       COALESCE(SUM(CASE WHEN s.statut = 'rejete' THEN sl.montant_estime ELSE 0 END), 0) AS total_rejete
     FROM sinistres s
     LEFT JOIN sinistre_lignes sl ON sl.sinistre_id = s.id
     WHERE s.programme_id = ?`,
    [programmeId]
  );

  const [[claimsPaymentsKpi]] = await pool.query(
    `SELECT COALESCE(SUM(r.montant), 0) AS total_regle
     FROM reglements r
     JOIN sinistres s ON s.id = r.sinistre_id
     WHERE s.programme_id = ?`,
    [programmeId]
  );

  // Best-effort fallback values for preview when legacy `programmes` fields are empty
  // and the source of truth is now spread across programme_* tables / simulation structures.
  const coverageMaxLimit = (coverages || []).reduce((max, row) => {
    const perClaim = Number(row?.limit_per_claim || 0);
    const annual = Number(row?.limit_annual || 0);
    return Math.max(max, perClaim, annual);
  }, 0);
  const deductibleMax = (deductibles || []).reduce((max, row) => Math.max(max, Number(row?.amount || 0)), 0);

  const leadCarrier =
    (carriers || []).find((c) => c.role === "LEAD") ||
    (carriers || []).find((c) => c.role === "FRONTING") ||
    (carriers || [])[0] ||
    null;
  const frontingPrimary = (frontingInsurers || [])[0] || null;

  const previewFronting = (frontingInsurers || [])
    .map((r) => {
      const n = r?.insurer_name || "";
      const s = r?.share_pct;
      if (!n) return null;
      return s == null ? n : `${n} (${Number(s)}%)`;
    })
    .filter(Boolean)
    .join(" ; ") || "—";
  const previewPortage = (carriers || [])
    .filter((c) => c.role === "LEAD" || c.role === "FRONTING")
    .map((c) => {
      const n = c?.carrier_name || "";
      const s = c?.share_pct;
      if (!n) return null;
      return s == null ? n : `${n} (${Number(s)}%)`;
    })
    .filter(Boolean)
    .join(" ; ") || (leadCarrier?.carrier_name || "—");
  const previewLimite = Number(programme.limite || 0) > 0 ? programme.limite : coverageMaxLimit || null;
  const previewFranchise = Number(programme.franchise || 0) > 0 ? programme.franchise : deductibleMax || null;
  const programmeStartRaw = programme.date_debut || programme.debut || null;
  const programmeEndRaw = programme.date_fin || programme.fin || null;
  let previewPeriodStart = programmeStartRaw;
  let previewPeriodEnd = programmeEndRaw;
  if (!previewPeriodStart || !previewPeriodEnd) {
    const [[contractPeriod]] = await pool.query(
      `SELECT MIN(date_debut) AS min_date, MAX(date_fin) AS max_date
       FROM contracts
       WHERE programme_id = ?`,
      [programmeId]
    );
    previewPeriodStart = previewPeriodStart || contractPeriod?.min_date || null;
    previewPeriodEnd = previewPeriodEnd || contractPeriod?.max_date || null;
  }

  // Enrich reinsurance preview rows with treaty type / cession rate when inferable from branch scope.
  let reinsuranceRowsForPdf = (reinsuranceInsurers || []).map((row) => ({
    name: row.insurer_name || "—",
    share: row.share_pct ?? "—",
    treatyType: null,
  }));
  try {
    if (programme.branch_s2_code) {
      const [branchRows] = await pool.query(`SELECT id_branch FROM insurance_branch WHERE s2_code = ? LIMIT 1`, [programme.branch_s2_code]);
      const branchId = branchRows?.[0]?.id_branch;
      if (branchId) {
        const [treatiesForBranch] = await pool.query(
          `SELECT
             rt.id,
             rt.treaty_type,
             i.name AS insurer_name,
             MAX(CASE WHEN tt.term_type = 'CESSION_RATE' THEN tt.value_numeric END) AS cession_rate
           FROM reinsurance_treaties rt
           JOIN reinsurance_treaty_scopes rs ON rs.treaty_id = rt.id
           LEFT JOIN insurers i ON i.id = rt.counterparty_insurer_id
           LEFT JOIN reinsurance_treaty_terms tt ON tt.treaty_id = rt.id
           WHERE rt.status = 'active'
             AND rs.id_branch = ?
           GROUP BY rt.id, rt.treaty_type, i.name
           ORDER BY rt.id DESC`,
          [branchId]
        );
        const treatyByInsurer = new Map();
        for (const t of treatiesForBranch || []) {
          const insurerName = String(t.insurer_name || "").trim();
          if (!insurerName || treatyByInsurer.has(insurerName)) continue;
          treatyByInsurer.set(insurerName, t);
        }
        reinsuranceRowsForPdf = reinsuranceRowsForPdf.map((row) => {
          const treaty = treatyByInsurer.get(String(row.name));
          if (!treaty) return row;
          const cessionRate = treaty.cession_rate == null ? null : Number(treaty.cession_rate);
          const share =
            row.share !== "—"
              ? row.share
              : cessionRate == null
              ? "—"
              : cessionRate <= 1
              ? Math.round(cessionRate * 10000) / 100
              : Math.round(cessionRate * 100) / 100;
          return {
            ...row,
            share,
            treatyType: treaty.treaty_type || null,
          };
        });
      }
    }
  } catch {
    // Keep PDF preview resilient even if simulation tables are unavailable.
  }
  const previewReassureur = (reinsuranceRowsForPdf || [])
    .map((r) => {
      const n = r?.name || "";
      const treaty = r?.treatyType ? labelForCode(r.treatyType) : null;
      const share = r?.share;
      if (!n || n === "—") return null;
      const parts = [];
      if (treaty) parts.push(treaty);
      if (share != null && share !== "—") parts.push(`${share}%`);
      return parts.length ? `${n} (${parts.join(", ")})` : n;
    })
    .filter(Boolean)
    .join(" ; ") || "—";

  const rowLimit = Math.min(100, Math.max(10, Number(req.query.limit) || 30));
  const generatedAt = new Date();
  const premiumKpiValues = {
    totalContracts: Number(premiumKpi?.total_contracts || 0),
    annualExpected: Number(premiumKpi?.total_annual_expected || 0),
    totalPaid: Number(premiumKpi?.total_paid || 0),
  };
  premiumKpiValues.totalOutstanding = Math.max(premiumKpiValues.annualExpected - premiumKpiValues.totalPaid, 0);
  const claimsKpiValues = {
    totalClaims: Number(claimsKpi?.total_claims || 0),
    totalClaimLines: Number(claimsKpi?.total_claim_lines || 0),
    totalEstime: Number(claimsKpi?.total_estime || 0),
    totalPayeLignes: Number(claimsKpi?.total_paye_lignes || 0),
    totalRegle: Number(claimsPaymentsKpi?.total_regle || 0),
    totalOuvert: Number(claimsKpi?.total_ouvert || 0),
    totalEnCours: Number(claimsKpi?.total_en_cours || 0),
    totalClos: Number(claimsKpi?.total_clos || 0),
    totalRejete: Number(claimsKpi?.total_rejete || 0),
  };
  const spIndicators = {
    spBrutEstime: safeRatio(claimsKpiValues.totalEstime, premiumKpiValues.annualExpected),
    spPaye: safeRatio(claimsKpiValues.totalRegle, premiumKpiValues.annualExpected),
    tauxReglement: safeRatio(claimsKpiValues.totalRegle, claimsKpiValues.totalEstime),
    frequenceSinistres: safeRatio(claimsKpiValues.totalClaims, premiumKpiValues.totalContracts),
    coutMoyenSinistre: safeRatio(claimsKpiValues.totalEstime, claimsKpiValues.totalClaims),
    primeMoyenneContrat: safeRatio(premiumKpiValues.annualExpected, premiumKpiValues.totalContracts),
    tauxImpayesPrimes: safeRatio(premiumKpiValues.totalOutstanding, premiumKpiValues.totalPaid + premiumKpiValues.totalOutstanding),
    chargeOuverte: safeRatio(claimsKpiValues.totalOuvert + claimsKpiValues.totalEnCours, claimsKpiValues.totalEstime),
    partSinistresClos: safeRatio(claimsKpiValues.totalClos, claimsKpiValues.totalEstime),
  };

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="programme_${programmeId}_synthese.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  doc.pipe(res);

  const programmeName = programme.ligne_risque || `Programme #${programmeId}`;
  drawPdfHeadingLeft(doc, `Synthèse programme d’assurance — ${programmeName}`, 18);
  doc
    .moveDown(0.4)
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#475569")
    .text(`Généré le ${formatDateTime(generatedAt)} • Programme #${programmeId}`);

  drawPdfTableSection(doc, {
    title: "Fiche contrat",
    columns: [
      { key: "champ", label: "Champ", weight: 1.4 },
      { key: "valeur", label: "Valeur", weight: 3.6, maxChars: null, wrap: true },
    ],
    rows: [
      { champ: "Ligne de risque", valeur: programme.ligne_risque || "—" },
      {
        champ: "Branche S2",
        valeur: `${programme.branch_s2_code || "—"}${programme.branch_name ? ` (${programme.branch_name})` : ""}`,
      },
      { champ: "Statut", valeur: programme.statut || "—" },
      { champ: "Assureur de fronting", valeur: previewFronting },
      { champ: "Réassureur(s)", valeur: previewReassureur },
      { champ: "Assureur de portage", valeur: previewPortage },
      { champ: "Limite", valeur: formatMoney(previewLimite, programme.devise) },
      { champ: "Franchise", valeur: formatMoney(previewFranchise, programme.devise) },
      { champ: "Période", valeur: `${formatDate(previewPeriodStart)} → ${formatDate(previewPeriodEnd)}` },
    ],
    limit: 30,
    rowHeight: 18,
    autoRowHeight: true,
    maxRowHeight: 30,
  });

  drawPdfDualKpiSections(doc, {
    leftTitle: "KPI Primes",
    leftCount: 5,
    leftRows: [
      { champ: "Nombre de contrats", valeur: formatIntegerFr(premiumKpiValues.totalContracts) },
      { champ: "Montant versé", valeur: formatMoney(premiumKpiValues.totalPaid, programme.devise) },
      { champ: "Montant en retard (estimé)", valeur: formatMoney(premiumKpiValues.totalOutstanding, programme.devise) },
      { champ: "Montant total attendu (estimé)", valeur: formatMoney(premiumKpiValues.totalPaid + premiumKpiValues.totalOutstanding, programme.devise) },
      { champ: "Total primes annuelles attendues", valeur: formatMoney(premiumKpiValues.annualExpected, programme.devise) },
    ],
    rightTitle: "KPI Sinistres",
    rightCount: 9,
    rightRows: [
      { champ: "Nombre de sinistres", valeur: formatIntegerFr(claimsKpiValues.totalClaims) },
      { champ: "Nombre de lignes sinistres", valeur: formatIntegerFr(claimsKpiValues.totalClaimLines) },
      { champ: "Montant estimé total", valeur: formatMoney(claimsKpiValues.totalEstime, programme.devise) },
      { champ: "Montant payé (lignes)", valeur: formatMoney(claimsKpiValues.totalPayeLignes, programme.devise) },
      { champ: "Montant réglé", valeur: formatMoney(claimsKpiValues.totalRegle, programme.devise) },
      { champ: "Ouvert (estimé)", valeur: formatMoney(claimsKpiValues.totalOuvert, programme.devise) },
      { champ: "En cours (estimé)", valeur: formatMoney(claimsKpiValues.totalEnCours, programme.devise) },
      { champ: "Clos (estimé)", valeur: formatMoney(claimsKpiValues.totalClos, programme.devise) },
      { champ: "Rejeté (estimé)", valeur: formatMoney(claimsKpiValues.totalRejete, programme.devise) },
    ],
    rowHeight: 18,
  });

  drawPdfDualKpiSections(doc, {
    leftTitle: "Indicateurs S/P (brut)",
    leftCount: 5,
    leftRows: [
      {
        champ: "S/P brut estimé",
        valeur: spIndicators.spBrutEstime == null ? "—" : formatPercent(spIndicators.spBrutEstime * 100),
      },
      {
        champ: "S/P payé brut",
        valeur: spIndicators.spPaye == null ? "—" : formatPercent(spIndicators.spPaye * 100),
      },
      {
        champ: "Taux de règlement",
        valeur: spIndicators.tauxReglement == null ? "—" : formatPercent(spIndicators.tauxReglement * 100),
      },
      {
        champ: "Fréquence sinistres",
        valeur: spIndicators.frequenceSinistres == null ? "—" : formatPercent(spIndicators.frequenceSinistres * 100),
      },
      {
        champ: "Taux d'impayés primes",
        valeur: spIndicators.tauxImpayesPrimes == null ? "—" : formatPercent(spIndicators.tauxImpayesPrimes * 100),
      },
    ],
    rightTitle: "Lecture technique",
    rightCount: 4,
    rightRows: [
      {
        champ: "Prime moyenne par contrat",
        valeur:
          spIndicators.primeMoyenneContrat == null
            ? "—"
            : formatMoney(spIndicators.primeMoyenneContrat, programme.devise),
      },
      {
        champ: "Coût moyen par sinistre",
        valeur:
          spIndicators.coutMoyenSinistre == null
            ? "—"
            : formatMoney(spIndicators.coutMoyenSinistre, programme.devise),
      },
      {
        champ: "Charge ouverte (estimée)",
        valeur: spIndicators.chargeOuverte == null ? "—" : formatPercent(spIndicators.chargeOuverte * 100),
      },
      {
        champ: "Part sinistres clos (estimée)",
        valeur: spIndicators.partSinistresClos == null ? "—" : formatPercent(spIndicators.partSinistresClos * 100),
      },
    ],
    rowHeight: 18,
  });

  doc.addPage();

  drawPdfTableSection(doc, {
    title: "Sous-contrats / Tranches",
    columns: [
      { key: "name", label: "Nom", weight: 1.5 },
      { key: "type", label: "Type", weight: 1 },
      { key: "attachment", label: "Attachement", weight: 1, align: "right" },
      { key: "limit", label: "Limite", weight: 1, align: "right" },
      { key: "period", label: "Période", weight: 1.5, maxChars: 36 },
    ],
    rows: layers.map((row) => ({
      name: row.name || "—",
      type: labelForCode(row.layer_type),
      attachment: formatMoney(row.attachment_point, row.currency),
      limit: formatMoney(row.limit_amount, row.currency),
      period: `${formatDate(row.effective_from)} → ${formatDate(row.effective_to)}`,
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Tarification",
    columns: [
      { key: "coverage", label: "Garantie", weight: 1.6 },
      { key: "method", label: "Méthode", weight: 1.4 },
      { key: "premium", label: "Prime", weight: 1, align: "right" },
      { key: "rate", label: "Taux %", weight: 0.9, align: "right" },
      { key: "minimum", label: "Prime min.", weight: 1.1, align: "right" },
      { key: "period", label: "Période", weight: 1.4, maxChars: 36 },
    ],
    rows: pricing.map((row) => ({
      coverage: row.coverage_label || "Toutes garanties",
      method: labelForCode(row.pricing_method),
      premium: formatMoney(row.premium_amount, row.currency),
      rate: formatPercent(row.rate_value),
      minimum: formatMoney(row.minimum_premium, row.currency),
      period: `${formatDate(row.effective_from)} → ${formatDate(row.effective_to)}`,
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Garanties",
    columns: [
      { key: "label", label: "Garantie", weight: 1.9 },
      { key: "type", label: "Type", weight: 1.1 },
      { key: "perClaim", label: "Limite sinistre", weight: 1.2, align: "right" },
      { key: "annual", label: "Limite annuelle", weight: 1.2, align: "right" },
    ],
    rows: coverages.map((row) => ({
      label: row.label || "—",
      type: labelForCode(row.coverage_type),
      perClaim: formatMoney(row.limit_per_claim, row.currency),
      annual: formatMoney(row.limit_annual, row.currency),
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Franchises",
    columns: [
      { key: "coverage", label: "Garantie", weight: 1.6 },
      { key: "amount", label: "Montant", weight: 1.1, align: "right" },
      { key: "unit", label: "Type", weight: 0.9 },
      { key: "currency", label: "Devise", weight: 0.8, align: "center" },
      { key: "notes", label: "Notes", weight: 1.6, maxChars: 56 },
    ],
    rows: deductibles.map((row) => ({
      coverage: row.coverage_label || "Toutes garanties",
      amount: row.amount === null || row.amount === undefined ? "—" : formatMoney(row.amount, ""),
      unit: labelForCode(row.unit),
      currency: row.currency || "—",
      notes: row.notes || "—",
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Exclusions",
    columns: [
      { key: "category", label: "Catégorie", weight: 1.2 },
      { key: "description", label: "Description", weight: 3.8, maxChars: 110 },
    ],
    rows: exclusions.map((row) => ({
      category: row.category || "—",
      description: row.description || "—",
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Conditions particulières",
    columns: [
      { key: "title", label: "Titre", weight: 1.4 },
      { key: "content", label: "Contenu", weight: 3.6, maxChars: 110 },
    ],
    rows: conditions.map((row) => ({
      title: row.title || "—",
      content: row.content || "—",
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Assureur(s) de fronting",
    columns: [
      { key: "name", label: "Assureur de fronting", weight: 3.5 },
      { key: "share", label: "Quote-part %", weight: 1.5, align: "right" },
    ],
    rows: frontingInsurers.map((row) => ({
      name: row.insurer_name || "—",
      share: row.share_pct ?? "—",
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Réassureur(s)",
    columns: [
      { key: "name", label: "Réassureur", weight: 3.5 },
      { key: "treaty", label: "Traité", weight: 1.5 },
      { key: "share", label: "Quote-part %", weight: 1.5, align: "right" },
    ],
    rows: reinsuranceRowsForPdf.map((row) => ({
      name: row.name || "—",
      treaty: row.treatyType ? labelForCode(row.treatyType) : "—",
      share: row.share ?? "—",
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Assureur(s) de portage",
    columns: [
      { key: "name", label: "Assureur de portage", weight: 2.3 },
      { key: "role", label: "Rôle", weight: 1.3 },
      { key: "share", label: "Quote-part %", weight: 1.4, align: "right" },
    ],
    rows: carriers.map((row) => ({
      name: row.carrier_name || "—",
      role: labelForCode(row.role),
      share: row.share_pct ?? "—",
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Documents & pièces",
    columns: [
      { key: "file", label: "Nom du fichier", weight: 2.7, maxChars: 62 },
      { key: "type", label: "Type", weight: 1.2 },
      { key: "uploaded", label: "Date upload", weight: 1.1, align: "right", maxChars: 24 },
    ],
    rows: documents.map((row) => ({
      file: row.file_name || "—",
      type: labelForCode(row.doc_type),
      uploaded: formatDateTime(row.uploaded_at),
    })),
    limit: rowLimit,
  });

  drawPdfTableSection(doc, {
    title: "Historique & validations",
    columns: [
      { key: "version", label: "Version", weight: 1.1 },
      { key: "date", label: "Date", weight: 1.1, align: "right", maxChars: 24 },
      { key: "author", label: "Modifié par", weight: 1.2 },
      { key: "notes", label: "Notes", weight: 1.6, maxChars: 64 },
    ],
    rows: versions.map((row) => ({
      version: row.version_label || "—",
      date: formatDateTime(row.changed_at),
      author: row.changed_by || "—",
      notes: row.change_notes || "—",
    })),
    limit: rowLimit,
  });

  const pageRange = doc.bufferedPageRange();
  const totalPages = Number(pageRange?.count || 0);
  for (let i = 0; i < totalPages; i += 1) {
    doc.switchToPage(i);
    const pageNo = i + 1;
    const footerText = `Page ${pageNo} sur ${totalPages}`;
    const y = doc.page.height - doc.page.margins.bottom - 14;
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("#64748b")
      .text(footerText, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
        lineBreak: false,
      });
  }

  doc.end();
});

router.get("/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM programmes WHERE id = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "programme_not_found" });
  res.json(rows[0]);
});

router.patch(
  "/:id",
  authRequired,
  requireRole(...canManage),
  validate(programmePatch),
  async (req, res) => {
    if (req.body.branch_s2_code !== undefined) {
      const nextCode = String(req.body.branch_s2_code || "").trim().toUpperCase();
      if (!nextCode) return res.status(400).json({ error: "invalid_branch_s2_code" });
      if (!(await hasBranchS2Code(nextCode))) {
        return res.status(400).json({ error: "invalid_branch_s2_code" });
      }
      req.body.branch_s2_code = nextCode;
    }
    if (req.body.assureur !== undefined) {
      req.body.assureur = await registerInsurerName(req.body.assureur);
    }
    const fields = ["branch_s2_code", "ligne_risque", "limite", "franchise", "devise", "assureur", "debut", "fin", "statut"];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(req.params.id);
    const [upd] = await pool.query(
      `UPDATE programmes SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
    if (!upd.affectedRows) return res.status(404).json({ error: "programme_not_found" });
    const [rows] = await pool.query(
      `SELECT * FROM programmes WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "programme_not_found" });
    const programme = rows[0];
    await logAudit(req.user?.id, "programme", Number(req.params.id), "update", programme);
    res.json(programme);
  }
);

router.delete("/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM programmes WHERE id = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "programme_not_found" });
  await pool.query(`DELETE FROM programmes WHERE id = ?`, [req.params.id]);
  await logAudit(req.user?.id, "programme", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

export default router;
