import { Router } from "express";
import { z } from "zod";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
const canManage = ["super_admin", "admin", "risk_manager", "actuaire", "conseil", "cfo"];

const boolSchema = z.coerce.number().int().min(0).max(1);
const dateSchema = z.string().optional().nullable();

const restrictionLevel = z.enum(["NONE", "LIMITED", "STRICT", "PROHIBITED"]);
const eligibilityMode = z.enum([
  "ALLOWED",
  "CONDITIONAL",
  "PROHIBITED",
  "FRONTING_ONLY",
  "REINSURANCE_ONLY",
  "VALIDATION_REQUIRED",
]);
const volatilityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
const capitalEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
const reinsuranceType = z.enum(["FRONTING", "QUOTA_SHARE", "EXCESS_OF_LOSS", "STOP_LOSS"]);
const capitalMethod = z.enum(["STANDARD_FORMULA", "INTERNAL_MODEL", "SIMPLIFIED"]);

const branchCreate = z.object({
  s2_code: z.string().min(1).max(5),
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  branch_type: z.string().min(1).max(10),
  is_active: boolSchema.default(1),
});
const branchPatch = branchCreate.partial();

const categoryCreate = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
});
const categoryPatch = categoryCreate.partial();

const branchCategoryMapCreate = z.object({
  id_branch: z.coerce.number().int().positive(),
  id_category: z.coerce.number().int().positive(),
});

const policyCreate = z.object({
  id_branch: z.coerce.number().int().positive(),
  is_allowed: boolSchema.default(1),
  restriction_level: restrictionLevel,
  fronting_required: boolSchema.default(0),
  reinsurance_required: boolSchema.default(0),
  comments: z.string().optional().nullable(),
  effective_from: z.string(),
  effective_to: dateSchema,
  eligibility_mode: eligibilityMode.default("ALLOWED"),
  approval_required: boolSchema.default(0),
  approval_notes: z.string().optional().nullable(),
});
const policyPatch = policyCreate.partial();

const riskCreate = z.object({
  id_branch: z.coerce.number().int().positive(),
  max_limit_per_claim: z.coerce.number().min(0).optional().nullable(),
  max_limit_per_year: z.coerce.number().min(0).optional().nullable(),
  default_deductible: z.coerce.number().min(0).optional().nullable(),
  volatility_level: volatilityEnum,
  capital_intensity: capitalEnum,
  requires_actuarial_model: boolSchema.default(1),
  net_retention_ratio: z.coerce.number().min(0).max(100).optional().nullable(),
  target_loss_ratio: z.coerce.number().min(0).max(100).optional().nullable(),
});
const riskPatch = riskCreate.partial();

const reinsuranceCreate = z.object({
  id_branch: z.coerce.number().int().positive(),
  rule_type: reinsuranceType,
  cession_rate: z.coerce.number().min(0).max(100).optional().nullable(),
  retention_limit: z.coerce.number().min(0).optional().nullable(),
  priority: z.coerce.number().int().min(1).default(1),
  effective_from: z.string(),
  effective_to: dateSchema,
});
const reinsurancePatch = reinsuranceCreate.partial();

const programCreate = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  is_active: boolSchema.default(1),
});
const programPatch = programCreate.partial();

const programBranchCreate = z.object({
  id_program: z.coerce.number().int().positive(),
  id_branch: z.coerce.number().int().positive(),
});

const capitalCreate = z.object({
  id_branch: z.coerce.number().int().positive(),
  capital_method: capitalMethod,
  capital_charge_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  stress_scenario: z.string().optional().nullable(),
  effective_from: z.string(),
  effective_to: dateSchema,
});
const capitalPatch = capitalCreate.partial();

const policyVersionCreate = z.object({
  id_policy: z.coerce.number().int().positive(),
  version_label: z.string().min(1).max(30),
  changed_at: dateSchema,
  changed_by: z.string().optional().nullable(),
  change_notes: z.string().optional().nullable(),
});
const policyVersionPatch = policyVersionCreate.partial();

function badRequest(res, message) {
  return res.status(400).json({ error: "invalid_payload", message });
}

function ensureDateOrder(from, to) {
  if (!from || !to) return null;
  if (String(to) < String(from)) return "effective_to_before_effective_from";
  return null;
}

function validatePolicyLogic(data) {
  const dateErr = ensureDateOrder(data.effective_from, data.effective_to);
  if (dateErr) return dateErr;
  if (data.eligibility_mode === "PROHIBITED" && Number(data.is_allowed) !== 0) {
    return "prohibited_must_be_not_allowed";
  }
  return null;
}

function validateRiskLogic(data) {
  if (
    data.max_limit_per_claim !== null &&
    data.max_limit_per_year !== null &&
    data.max_limit_per_claim !== undefined &&
    data.max_limit_per_year !== undefined &&
    data.max_limit_per_claim > data.max_limit_per_year
  ) {
    return "claim_limit_exceeds_year_limit";
  }
  return null;
}

function validateReinsuranceLogic(data) {
  const dateErr = ensureDateOrder(data.effective_from, data.effective_to);
  if (dateErr) return dateErr;
  if (data.rule_type === "FRONTING") {
    if (data.cession_rate !== null && data.cession_rate !== undefined && Number(data.cession_rate) !== 100) {
      return "fronting_requires_100_percent_cession";
    }
  }
  return null;
}

function validateCapitalLogic(data) {
  const dateErr = ensureDateOrder(data.effective_from, data.effective_to);
  if (dateErr) return dateErr;
  return null;
}

function addFilter(where, params, clause, value, transform = (v) => v) {
  if (value === undefined || value === null || value === "") return;
  where.push(clause);
  params.push(transform(value));
}

function getPagination(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function getCaptiveId(req) {
  const captiveId = Number(req.user?.captive_id);
  return Number.isInteger(captiveId) && captiveId > 0 ? captiveId : 0;
}

async function branchExistsInCaptive(idBranch, captiveId) {
  const [rows] = await pool.query(
    `SELECT id_branch FROM insurance_branch WHERE id_branch = ? AND captive_id = ? LIMIT 1`,
    [idBranch, captiveId]
  );
  return rows.length > 0;
}

async function categoryExistsInCaptive(idCategory, captiveId) {
  const [rows] = await pool.query(
    `SELECT id_category FROM insurance_branch_category WHERE id_category = ? AND captive_id = ? LIMIT 1`,
    [idCategory, captiveId]
  );
  return rows.length > 0;
}

async function programExistsInCaptive(idProgram, captiveId) {
  const [rows] = await pool.query(
    `SELECT id_program FROM insurance_program WHERE id_program = ? AND captive_id = ? LIMIT 1`,
    [idProgram, captiveId]
  );
  return rows.length > 0;
}

async function policyExistsInCaptive(idPolicy, captiveId) {
  const [rows] = await pool.query(
    `SELECT p.id_policy
     FROM captive_branch_policy p
     JOIN insurance_branch b ON b.id_branch = p.id_branch
     WHERE p.id_policy = ? AND b.captive_id = ?
     LIMIT 1`,
    [idPolicy, captiveId]
  );
  return rows.length > 0;
}

router.get("/branches", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "b.is_active = ?", req.query.is_active, Number);
  addFilter(where, params, "b.s2_code = ?", req.query.s2_code);
  if (req.query.name) {
    where.push("b.name LIKE ?");
    params.push(`%${req.query.name}%`);
  }
  addFilter(where, params, "c.id_category = ?", req.query.id_category, Number);
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(b.s2_code LIKE ? OR b.name LIKE ? OR c.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(DISTINCT b.id_branch) as total
     FROM insurance_branch b
     LEFT JOIN insurance_branch_category_map m ON m.id_branch = b.id_branch
     LEFT JOIN insurance_branch_category c ON c.id_category = m.id_category
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT b.*, c.id_category, c.code as category_code, c.name as category_name
     FROM insurance_branch b
     LEFT JOIN insurance_branch_category_map m ON m.id_branch = b.id_branch
     LEFT JOIN insurance_branch_category c ON c.id_category = m.id_category
     ${whereSql}
     ORDER BY b.id_branch ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/branches",
  authRequired,
  requireRole(...canManage),
  validate(branchCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { s2_code, name, description, branch_type, is_active } = req.body;
    const [r] = await pool.query(
      `INSERT INTO insurance_branch (captive_id, s2_code, name, description, branch_type, is_active)
       VALUES (?,?,?,?,?,?)`,
      [captiveId, s2_code, name, description, branch_type, is_active]
    );
    const [rows] = await pool.query(
      `SELECT * FROM insurance_branch WHERE id_branch = ? AND captive_id = ?`,
      [r.insertId, captiveId]
    );
    await logAudit(req.user?.id, "insurance_branch", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/branches/:id",
  authRequired,
  requireRole(...canManage),
  validate(branchPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const fields = ["s2_code", "name", "description", "branch_type", "is_active"];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(req.params.id, captiveId);
    await pool.query(`UPDATE insurance_branch SET ${sets.join(", ")} WHERE id_branch = ? AND captive_id = ?`, values);
    const [rows] = await pool.query(
      `SELECT * FROM insurance_branch WHERE id_branch = ? AND captive_id = ?`,
      [req.params.id, captiveId]
    );
    if (!rows.length) return res.status(404).json({ error: "branch_not_found" });
    await logAudit(req.user?.id, "insurance_branch", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/branches/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  await pool.query(`DELETE FROM insurance_branch WHERE id_branch = ? AND captive_id = ?`, [req.params.id, captiveId]);
  await logAudit(req.user?.id, "insurance_branch", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/categories", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("captive_id = ?");
  params.push(captiveId);
  if (req.query.code) {
    where.push("code = ?");
    params.push(req.query.code);
  }
  if (req.query.name) {
    where.push("name LIKE ?");
    params.push(`%${req.query.name}%`);
  }
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(code LIKE ? OR name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total FROM insurance_branch_category ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT * FROM insurance_branch_category ${whereSql} ORDER BY id_category ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/categories",
  authRequired,
  requireRole(...canManage),
  validate(categoryCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { code, name, description } = req.body;
    const [r] = await pool.query(
      `INSERT INTO insurance_branch_category (captive_id, code, name, description) VALUES (?,?,?,?)`,
      [captiveId, code, name, description]
    );
    const [rows] = await pool.query(
      `SELECT * FROM insurance_branch_category WHERE id_category = ? AND captive_id = ?`,
      [r.insertId, captiveId]
    );
    await logAudit(req.user?.id, "insurance_branch_category", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/categories/:id",
  authRequired,
  requireRole(...canManage),
  validate(categoryPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const fields = ["code", "name", "description"];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(req.params.id, captiveId);
    await pool.query(
      `UPDATE insurance_branch_category SET ${sets.join(", ")} WHERE id_category = ? AND captive_id = ?`,
      values
    );
    const [rows] = await pool.query(
      `SELECT * FROM insurance_branch_category WHERE id_category = ? AND captive_id = ?`,
      [req.params.id, captiveId]
    );
    if (!rows.length) return res.status(404).json({ error: "category_not_found" });
    await logAudit(req.user?.id, "insurance_branch_category", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/categories/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  await pool.query(`DELETE FROM insurance_branch_category WHERE id_category = ? AND captive_id = ?`, [
    req.params.id,
    captiveId,
  ]);
  await logAudit(req.user?.id, "insurance_branch_category", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/branch-category-map", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  where.push("c.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "m.id_branch = ?", req.query.id_branch, Number);
  addFilter(where, params, "m.id_category = ?", req.query.id_category, Number);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM insurance_branch_category_map m
     LEFT JOIN insurance_branch b ON b.id_branch = m.id_branch
     LEFT JOIN insurance_branch_category c ON c.id_category = m.id_category
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT m.*, b.s2_code, b.name as branch_name, c.code as category_code, c.name as category_name
     FROM insurance_branch_category_map m
     LEFT JOIN insurance_branch b ON b.id_branch = m.id_branch
     LEFT JOIN insurance_branch_category c ON c.id_category = m.id_category
     ${whereSql}
     ORDER BY m.id_branch ASC, m.id_category ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/branch-category-map",
  authRequired,
  requireRole(...canManage),
  validate(branchCategoryMapCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { id_branch, id_category } = req.body;
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    if (!(await categoryExistsInCaptive(id_category, captiveId))) {
      return res.status(404).json({ error: "category_not_found" });
    }
    await pool.query(
      `INSERT INTO insurance_branch_category_map (id_branch, id_category) VALUES (?,?)`,
      [id_branch, id_category]
    );
    await logAudit(req.user?.id, "insurance_branch_category_map", null, "create", req.body);
    res.status(201).json({ ok: true });
  }
);

router.delete(
  "/branch-category-map",
  authRequired,
  requireRole(...canManage),
  validate(branchCategoryMapCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { id_branch, id_category } = req.body;
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    if (!(await categoryExistsInCaptive(id_category, captiveId))) {
      return res.status(404).json({ error: "category_not_found" });
    }
    await pool.query(
      `DELETE FROM insurance_branch_category_map WHERE id_branch = ? AND id_category = ?`,
      [id_branch, id_category]
    );
    await logAudit(req.user?.id, "insurance_branch_category_map", null, "delete", req.body);
    res.json({ ok: true });
  }
);

router.get("/policies", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "p.id_branch = ?", req.query.id_branch, Number);
  addFilter(where, params, "p.eligibility_mode = ?", req.query.eligibility_mode);
  addFilter(where, params, "p.restriction_level = ?", req.query.restriction_level);
  addFilter(where, params, "p.fronting_required = ?", req.query.fronting_required, Number);
  addFilter(where, params, "p.reinsurance_required = ?", req.query.reinsurance_required, Number);
  addFilter(where, params, "p.approval_required = ?", req.query.approval_required, Number);
  addFilter(where, params, "p.is_allowed = ?", req.query.is_allowed, Number);
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(b.name LIKE ? OR b.s2_code LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM captive_branch_policy p
     LEFT JOIN insurance_branch b ON b.id_branch = p.id_branch
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT p.*, b.s2_code, b.name as branch_name
     FROM captive_branch_policy p
     LEFT JOIN insurance_branch b ON b.id_branch = p.id_branch
     ${whereSql}
     ORDER BY p.id_policy ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/policies",
  authRequired,
  requireRole(...canManage),
  validate(policyCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validatePolicyLogic(req.body);
    if (err) return badRequest(res, err);
    const {
      id_branch,
      is_allowed,
      restriction_level,
      fronting_required,
      reinsurance_required,
      comments,
      effective_from,
      effective_to,
      eligibility_mode,
      approval_required,
      approval_notes,
    } = req.body;
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const [r] = await pool.query(
      `INSERT INTO captive_branch_policy
        (id_branch, is_allowed, restriction_level, fronting_required, reinsurance_required, comments, effective_from, effective_to, eligibility_mode, approval_required, approval_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id_branch,
        is_allowed,
        restriction_level,
        fronting_required,
        reinsurance_required,
        comments,
        effective_from,
        effective_to,
        eligibility_mode,
        approval_required,
        approval_notes,
      ]
    );
    const [rows] = await pool.query(`SELECT * FROM captive_branch_policy WHERE id_policy = ?`, [r.insertId]);
    await logAudit(req.user?.id, "captive_branch_policy", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/policies/:id",
  authRequired,
  requireRole(...canManage),
  validate(policyPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validatePolicyLogic(req.body);
    if (err) return badRequest(res, err);
    if (!(await policyExistsInCaptive(Number(req.params.id), captiveId))) {
      return res.status(404).json({ error: "policy_not_found" });
    }
    if (req.body.id_branch !== undefined && !(await branchExistsInCaptive(req.body.id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const fields = [
      "id_branch",
      "is_allowed",
      "restriction_level",
      "fronting_required",
      "reinsurance_required",
      "comments",
      "effective_from",
      "effective_to",
      "eligibility_mode",
      "approval_required",
      "approval_notes",
    ];
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
    await pool.query(`UPDATE captive_branch_policy SET ${sets.join(", ")} WHERE id_policy = ?`, values);
    const [rows] = await pool.query(`SELECT * FROM captive_branch_policy WHERE id_policy = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "policy_not_found" });
    await logAudit(req.user?.id, "captive_branch_policy", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/policies/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  if (!(await policyExistsInCaptive(Number(req.params.id), captiveId))) {
    return res.status(404).json({ error: "policy_not_found" });
  }
  await pool.query(`DELETE FROM captive_branch_policy WHERE id_policy = ?`, [req.params.id]);
  await logAudit(req.user?.id, "captive_branch_policy", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/risk-parameters", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "r.id_branch = ?", req.query.id_branch, Number);
  addFilter(where, params, "r.volatility_level = ?", req.query.volatility_level);
  addFilter(where, params, "r.capital_intensity = ?", req.query.capital_intensity);
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(b.name LIKE ? OR b.s2_code LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM branch_risk_parameters r
     LEFT JOIN insurance_branch b ON b.id_branch = r.id_branch
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT r.*, b.s2_code, b.name as branch_name
     FROM branch_risk_parameters r
     LEFT JOIN insurance_branch b ON b.id_branch = r.id_branch
     ${whereSql}
     ORDER BY r.id_parameters ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/risk-parameters",
  authRequired,
  requireRole(...canManage),
  validate(riskCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validateRiskLogic(req.body);
    if (err) return badRequest(res, err);
    const {
      id_branch,
      max_limit_per_claim,
      max_limit_per_year,
      default_deductible,
      volatility_level,
      capital_intensity,
      requires_actuarial_model,
      net_retention_ratio,
      target_loss_ratio,
    } = req.body;
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const [r] = await pool.query(
      `INSERT INTO branch_risk_parameters
        (id_branch, max_limit_per_claim, max_limit_per_year, default_deductible, volatility_level, capital_intensity, requires_actuarial_model, net_retention_ratio, target_loss_ratio)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id_branch,
        max_limit_per_claim,
        max_limit_per_year,
        default_deductible,
        volatility_level,
        capital_intensity,
        requires_actuarial_model,
        net_retention_ratio,
        target_loss_ratio,
      ]
    );
    const [rows] = await pool.query(`SELECT * FROM branch_risk_parameters WHERE id_parameters = ?`, [r.insertId]);
    await logAudit(req.user?.id, "branch_risk_parameters", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/risk-parameters/:id",
  authRequired,
  requireRole(...canManage),
  validate(riskPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validateRiskLogic(req.body);
    if (err) return badRequest(res, err);
    const [targetRows] = await pool.query(
      `SELECT r.id_parameters
       FROM branch_risk_parameters r
       JOIN insurance_branch b ON b.id_branch = r.id_branch
       WHERE r.id_parameters = ? AND b.captive_id = ? LIMIT 1`,
      [req.params.id, captiveId]
    );
    if (!targetRows.length) return res.status(404).json({ error: "risk_parameters_not_found" });
    if (req.body.id_branch !== undefined && !(await branchExistsInCaptive(req.body.id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const fields = [
      "id_branch",
      "max_limit_per_claim",
      "max_limit_per_year",
      "default_deductible",
      "volatility_level",
      "capital_intensity",
      "requires_actuarial_model",
      "net_retention_ratio",
      "target_loss_ratio",
    ];
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
    await pool.query(`UPDATE branch_risk_parameters SET ${sets.join(", ")} WHERE id_parameters = ?`, values);
    const [rows] = await pool.query(`SELECT * FROM branch_risk_parameters WHERE id_parameters = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "risk_parameters_not_found" });
    await logAudit(req.user?.id, "branch_risk_parameters", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/risk-parameters/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const [targetRows] = await pool.query(
    `SELECT r.id_parameters
     FROM branch_risk_parameters r
     JOIN insurance_branch b ON b.id_branch = r.id_branch
     WHERE r.id_parameters = ? AND b.captive_id = ? LIMIT 1`,
    [req.params.id, captiveId]
  );
  if (!targetRows.length) return res.status(404).json({ error: "risk_parameters_not_found" });
  await pool.query(`DELETE FROM branch_risk_parameters WHERE id_parameters = ?`, [req.params.id]);
  await logAudit(req.user?.id, "branch_risk_parameters", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/reinsurance-rules", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "r.id_branch = ?", req.query.id_branch, Number);
  addFilter(where, params, "r.rule_type = ?", req.query.rule_type);
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(b.name LIKE ? OR b.s2_code LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM branch_reinsurance_rules r
     LEFT JOIN insurance_branch b ON b.id_branch = r.id_branch
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT r.*, b.s2_code, b.name as branch_name
     FROM branch_reinsurance_rules r
     LEFT JOIN insurance_branch b ON b.id_branch = r.id_branch
     ${whereSql}
     ORDER BY r.id_rule ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/reinsurance-rules",
  authRequired,
  requireRole(...canManage),
  validate(reinsuranceCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validateReinsuranceLogic(req.body);
    if (err) return badRequest(res, err);
    const { id_branch, rule_type, cession_rate, retention_limit, priority, effective_from, effective_to } = req.body;
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const [r] = await pool.query(
      `INSERT INTO branch_reinsurance_rules
        (id_branch, rule_type, cession_rate, retention_limit, priority, effective_from, effective_to)
       VALUES (?,?,?,?,?,?,?)`,
      [id_branch, rule_type, cession_rate, retention_limit, priority, effective_from, effective_to]
    );
    const [rows] = await pool.query(`SELECT * FROM branch_reinsurance_rules WHERE id_rule = ?`, [r.insertId]);
    await logAudit(req.user?.id, "branch_reinsurance_rules", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/reinsurance-rules/:id",
  authRequired,
  requireRole(...canManage),
  validate(reinsurancePatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validateReinsuranceLogic(req.body);
    if (err) return badRequest(res, err);
    const [targetRows] = await pool.query(
      `SELECT r.id_rule
       FROM branch_reinsurance_rules r
       JOIN insurance_branch b ON b.id_branch = r.id_branch
       WHERE r.id_rule = ? AND b.captive_id = ? LIMIT 1`,
      [req.params.id, captiveId]
    );
    if (!targetRows.length) return res.status(404).json({ error: "reinsurance_rule_not_found" });
    if (req.body.id_branch !== undefined && !(await branchExistsInCaptive(req.body.id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const fields = [
      "id_branch",
      "rule_type",
      "cession_rate",
      "retention_limit",
      "priority",
      "effective_from",
      "effective_to",
    ];
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
    await pool.query(`UPDATE branch_reinsurance_rules SET ${sets.join(", ")} WHERE id_rule = ?`, values);
    const [rows] = await pool.query(`SELECT * FROM branch_reinsurance_rules WHERE id_rule = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "reinsurance_rule_not_found" });
    await logAudit(req.user?.id, "branch_reinsurance_rules", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/reinsurance-rules/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const [targetRows] = await pool.query(
    `SELECT r.id_rule
     FROM branch_reinsurance_rules r
     JOIN insurance_branch b ON b.id_branch = r.id_branch
     WHERE r.id_rule = ? AND b.captive_id = ? LIMIT 1`,
    [req.params.id, captiveId]
  );
  if (!targetRows.length) return res.status(404).json({ error: "reinsurance_rule_not_found" });
  await pool.query(`DELETE FROM branch_reinsurance_rules WHERE id_rule = ?`, [req.params.id]);
  await logAudit(req.user?.id, "branch_reinsurance_rules", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/programs", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "is_active = ?", req.query.is_active, Number);
  if (req.query.code) {
    where.push("code LIKE ?");
    params.push(`%${req.query.code}%`);
  }
  if (req.query.name) {
    where.push("name LIKE ?");
    params.push(`%${req.query.name}%`);
  }
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(code LIKE ? OR name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total FROM insurance_program ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT * FROM insurance_program ${whereSql} ORDER BY id_program ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/programs",
  authRequired,
  requireRole(...canManage),
  validate(programCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { code, name, description, is_active } = req.body;
    const [r] = await pool.query(
      `INSERT INTO insurance_program (captive_id, code, name, description, is_active) VALUES (?,?,?,?,?)`,
      [captiveId, code, name, description, is_active]
    );
    const [rows] = await pool.query(
      `SELECT * FROM insurance_program WHERE id_program = ? AND captive_id = ?`,
      [r.insertId, captiveId]
    );
    await logAudit(req.user?.id, "insurance_program", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/programs/:id",
  authRequired,
  requireRole(...canManage),
  validate(programPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const fields = ["code", "name", "description", "is_active"];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(req.params.id, captiveId);
    await pool.query(`UPDATE insurance_program SET ${sets.join(", ")} WHERE id_program = ? AND captive_id = ?`, values);
    const [rows] = await pool.query(
      `SELECT * FROM insurance_program WHERE id_program = ? AND captive_id = ?`,
      [req.params.id, captiveId]
    );
    if (!rows.length) return res.status(404).json({ error: "program_not_found" });
    await logAudit(req.user?.id, "insurance_program", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/programs/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  await pool.query(`DELETE FROM insurance_program WHERE id_program = ? AND captive_id = ?`, [req.params.id, captiveId]);
  await logAudit(req.user?.id, "insurance_program", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/program-branches", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("p.captive_id = ?");
  params.push(captiveId);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "pbm.id_program = ?", req.query.id_program, Number);
  addFilter(where, params, "pbm.id_branch = ?", req.query.id_branch, Number);
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(p.code LIKE ? OR p.name LIKE ? OR b.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM program_branch_map pbm
     LEFT JOIN insurance_program p ON p.id_program = pbm.id_program
     LEFT JOIN insurance_branch b ON b.id_branch = pbm.id_branch
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT pbm.*, p.code as program_code, p.name as program_name, b.s2_code, b.name as branch_name
     FROM program_branch_map pbm
     LEFT JOIN insurance_program p ON p.id_program = pbm.id_program
     LEFT JOIN insurance_branch b ON b.id_branch = pbm.id_branch
     ${whereSql}
     ORDER BY pbm.id_program ASC, pbm.id_branch ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/program-branches",
  authRequired,
  requireRole(...canManage),
  validate(programBranchCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { id_program, id_branch } = req.body;
    if (!(await programExistsInCaptive(id_program, captiveId))) {
      return res.status(404).json({ error: "program_not_found" });
    }
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    await pool.query(`INSERT INTO program_branch_map (id_program, id_branch) VALUES (?,?)`, [id_program, id_branch]);
    await logAudit(req.user?.id, "program_branch_map", null, "create", req.body);
    res.status(201).json({ ok: true });
  }
);

router.delete(
  "/program-branches",
  authRequired,
  requireRole(...canManage),
  validate(programBranchCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { id_program, id_branch } = req.body;
    if (!(await programExistsInCaptive(id_program, captiveId))) {
      return res.status(404).json({ error: "program_not_found" });
    }
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    await pool.query(`DELETE FROM program_branch_map WHERE id_program = ? AND id_branch = ?`, [id_program, id_branch]);
    await logAudit(req.user?.id, "program_branch_map", null, "delete", req.body);
    res.json({ ok: true });
  }
);

router.get("/capital-parameters", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "c.id_branch = ?", req.query.id_branch, Number);
  addFilter(where, params, "c.capital_method = ?", req.query.capital_method);
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(b.name LIKE ? OR b.s2_code LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM branch_capital_parameters c
     LEFT JOIN insurance_branch b ON b.id_branch = c.id_branch
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT c.*, b.s2_code, b.name as branch_name
     FROM branch_capital_parameters c
     LEFT JOIN insurance_branch b ON b.id_branch = c.id_branch
     ${whereSql}
     ORDER BY c.id_capital ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/capital-parameters",
  authRequired,
  requireRole(...canManage),
  validate(capitalCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validateCapitalLogic(req.body);
    if (err) return badRequest(res, err);
    const { id_branch, capital_method, capital_charge_pct, stress_scenario, effective_from, effective_to } = req.body;
    if (!(await branchExistsInCaptive(id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const [r] = await pool.query(
      `INSERT INTO branch_capital_parameters
        (id_branch, capital_method, capital_charge_pct, stress_scenario, effective_from, effective_to)
       VALUES (?,?,?,?,?,?)`,
      [id_branch, capital_method, capital_charge_pct, stress_scenario, effective_from, effective_to]
    );
    const [rows] = await pool.query(`SELECT * FROM branch_capital_parameters WHERE id_capital = ?`, [r.insertId]);
    await logAudit(req.user?.id, "branch_capital_parameters", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/capital-parameters/:id",
  authRequired,
  requireRole(...canManage),
  validate(capitalPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const err = validateCapitalLogic(req.body);
    if (err) return badRequest(res, err);
    const [targetRows] = await pool.query(
      `SELECT c.id_capital
       FROM branch_capital_parameters c
       JOIN insurance_branch b ON b.id_branch = c.id_branch
       WHERE c.id_capital = ? AND b.captive_id = ? LIMIT 1`,
      [req.params.id, captiveId]
    );
    if (!targetRows.length) return res.status(404).json({ error: "capital_parameters_not_found" });
    if (req.body.id_branch !== undefined && !(await branchExistsInCaptive(req.body.id_branch, captiveId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const fields = ["id_branch", "capital_method", "capital_charge_pct", "stress_scenario", "effective_from", "effective_to"];
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
    await pool.query(`UPDATE branch_capital_parameters SET ${sets.join(", ")} WHERE id_capital = ?`, values);
    const [rows] = await pool.query(`SELECT * FROM branch_capital_parameters WHERE id_capital = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "capital_parameters_not_found" });
    await logAudit(req.user?.id, "branch_capital_parameters", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/capital-parameters/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const [targetRows] = await pool.query(
    `SELECT c.id_capital
     FROM branch_capital_parameters c
     JOIN insurance_branch b ON b.id_branch = c.id_branch
     WHERE c.id_capital = ? AND b.captive_id = ? LIMIT 1`,
    [req.params.id, captiveId]
  );
  if (!targetRows.length) return res.status(404).json({ error: "capital_parameters_not_found" });
  await pool.query(`DELETE FROM branch_capital_parameters WHERE id_capital = ?`, [req.params.id]);
  await logAudit(req.user?.id, "branch_capital_parameters", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/policy-versions", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const where = [];
  const params = [];
  const { page, limit, offset } = getPagination(req);
  where.push("b.captive_id = ?");
  params.push(captiveId);
  addFilter(where, params, "v.id_policy = ?", req.query.id_policy, Number);
  if (req.query.changed_by) {
    where.push("v.changed_by LIKE ?");
    params.push(`%${req.query.changed_by}%`);
  }
  const q = req.query.q ? String(req.query.q) : "";
  if (q) {
    where.push("(v.version_label LIKE ? OR v.changed_by LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM branch_policy_version v
     LEFT JOIN captive_branch_policy p ON p.id_policy = v.id_policy
     LEFT JOIN insurance_branch b ON b.id_branch = p.id_branch
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT v.*, p.id_branch
     FROM branch_policy_version v
     LEFT JOIN captive_branch_policy p ON p.id_policy = v.id_policy
     LEFT JOIN insurance_branch b ON b.id_branch = p.id_branch
     ${whereSql}
     ORDER BY v.id_version ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/policy-versions",
  authRequired,
  requireRole(...canManage),
  validate(policyVersionCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const { id_policy, version_label, changed_at, changed_by, change_notes } = req.body;
    if (!(await policyExistsInCaptive(id_policy, captiveId))) {
      return res.status(404).json({ error: "policy_not_found" });
    }
    const [r] = await pool.query(
      `INSERT INTO branch_policy_version (id_policy, version_label, changed_at, changed_by, change_notes)
       VALUES (?,?,?,?,?)`,
      [id_policy, version_label, changed_at || null, changed_by, change_notes]
    );
    const [rows] = await pool.query(`SELECT * FROM branch_policy_version WHERE id_version = ?`, [r.insertId]);
    await logAudit(req.user?.id, "branch_policy_version", r.insertId, "create", req.body);
    res.status(201).json(rows[0]);
  }
);

router.patch(
  "/policy-versions/:id",
  authRequired,
  requireRole(...canManage),
  validate(policyVersionPatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [targetRows] = await pool.query(
      `SELECT v.id_version
       FROM branch_policy_version v
       JOIN captive_branch_policy p ON p.id_policy = v.id_policy
       JOIN insurance_branch b ON b.id_branch = p.id_branch
       WHERE v.id_version = ? AND b.captive_id = ? LIMIT 1`,
      [req.params.id, captiveId]
    );
    if (!targetRows.length) return res.status(404).json({ error: "policy_version_not_found" });
    if (req.body.id_policy !== undefined && !(await policyExistsInCaptive(req.body.id_policy, captiveId))) {
      return res.status(404).json({ error: "policy_not_found" });
    }
    const fields = ["id_policy", "version_label", "changed_at", "changed_by", "change_notes"];
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
    await pool.query(`UPDATE branch_policy_version SET ${sets.join(", ")} WHERE id_version = ?`, values);
    const [rows] = await pool.query(`SELECT * FROM branch_policy_version WHERE id_version = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "policy_version_not_found" });
    await logAudit(req.user?.id, "branch_policy_version", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  }
);

router.delete("/policy-versions/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
  const [targetRows] = await pool.query(
    `SELECT v.id_version
     FROM branch_policy_version v
     JOIN captive_branch_policy p ON p.id_policy = v.id_policy
     JOIN insurance_branch b ON b.id_branch = p.id_branch
     WHERE v.id_version = ? AND b.captive_id = ? LIMIT 1`,
    [req.params.id, captiveId]
  );
  if (!targetRows.length) return res.status(404).json({ error: "policy_version_not_found" });
  await pool.query(`DELETE FROM branch_policy_version WHERE id_version = ?`, [req.params.id]);
  await logAudit(req.user?.id, "branch_policy_version", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

export default router;
