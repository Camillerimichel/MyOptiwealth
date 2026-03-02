import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import pool from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();

const membershipRoleEnum = z.enum(["owner", "intervenant", "manager", "viewer"]);
const userStatusEnum = z.enum(["active", "disabled"]);
const membershipStatusEnum = z.enum(["active", "disabled"]);
const boolFlag = z.coerce.number().int().min(0).max(1);
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

const membershipInput = z.object({
  captive_id: z.coerce.number().int().positive(),
  role: membershipRoleEnum.default("intervenant"),
  is_owner: z.coerce.number().int().min(0).max(1).default(0),
  status: membershipStatusEnum.default("active"),
  date_debut: z.string().optional().nullable(),
  date_fin: z.string().optional().nullable(),
});

const referentialSeedSchema = z.object({
  enabled: boolFlag.default(0),
  category: z
    .object({
      code: z.string().min(1).max(30),
      name: z.string().min(1).max(100),
      description: z.string().optional().nullable(),
    })
    .optional(),
  branch: z
    .object({
      s2_code: z.string().min(1).max(5),
      name: z.string().min(1).max(100),
      description: z.string().optional().nullable(),
      branch_type: z.string().min(1).max(10),
      is_active: boolFlag.default(1),
    })
    .optional(),
  program: z
    .object({
      code: z.string().min(1).max(30),
      name: z.string().min(1).max(120),
      description: z.string().optional().nullable(),
      is_active: boolFlag.default(1),
    })
    .optional(),
  policy: z
    .object({
      is_allowed: boolFlag.default(1),
      restriction_level: restrictionLevel.default("NONE"),
      fronting_required: boolFlag.default(0),
      reinsurance_required: boolFlag.default(0),
      comments: z.string().optional().nullable(),
      effective_from: z.string().optional().nullable(),
      effective_to: z.string().optional().nullable(),
      eligibility_mode: eligibilityMode.default("ALLOWED"),
      approval_required: boolFlag.default(0),
      approval_notes: z.string().optional().nullable(),
    })
    .optional(),
  risk: z
    .object({
      max_limit_per_claim: z.coerce.number().min(0).optional().nullable(),
      max_limit_per_year: z.coerce.number().min(0).optional().nullable(),
      default_deductible: z.coerce.number().min(0).optional().nullable(),
      volatility_level: volatilityEnum.default("MEDIUM"),
      capital_intensity: capitalEnum.default("MEDIUM"),
      requires_actuarial_model: boolFlag.default(1),
      net_retention_ratio: z.coerce.number().min(0).max(100).optional().nullable(),
      target_loss_ratio: z.coerce.number().min(0).max(100).optional().nullable(),
    })
    .optional(),
  reinsurance: z
    .object({
      rule_type: reinsuranceType.default("QUOTA_SHARE"),
      cession_rate: z.coerce.number().min(0).max(100).optional().nullable(),
      retention_limit: z.coerce.number().min(0).optional().nullable(),
      priority: z.coerce.number().int().min(1).default(1),
      effective_from: z.string().optional().nullable(),
      effective_to: z.string().optional().nullable(),
    })
    .optional(),
  capital: z
    .object({
      capital_method: capitalMethod.default("STANDARD_FORMULA"),
      capital_charge_pct: z.coerce.number().min(0).max(100).optional().nullable(),
      stress_scenario: z.string().optional().nullable(),
      effective_from: z.string().optional().nullable(),
      effective_to: z.string().optional().nullable(),
    })
    .optional(),
  policy_version: z
    .object({
      version_label: z.string().min(1).max(30).default("v1"),
      changed_at: z.string().optional().nullable(),
      changed_by: z.string().optional().nullable(),
      change_notes: z.string().optional().nullable(),
    })
    .optional(),
});

const createCaptiveSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(190),
  status: userStatusEnum.default("active"),
  referential_seed: referentialSeedSchema.optional(),
});

const patchCaptiveSchema = createCaptiveSchema.partial();
const deleteCaptiveSchema = z.object({
  admin_identifier: z.string().min(1).max(190),
  admin_password: z.string().min(6).max(190),
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  status: userStatusEnum.default("active"),
  roles: z.array(z.string().min(1)).default([]),
  memberships: z.array(membershipInput).default([]),
});

const patchUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  status: userStatusEnum.optional(),
  roles: z.array(z.string().min(1)).optional(),
  memberships: z.array(membershipInput).optional(),
});

const insuranceProgramCreateSchema = z.object({
  captive_id: z.coerce.number().int().positive(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  is_active: boolFlag.default(1),
});

const insuranceProgramPatchSchema = insuranceProgramCreateSchema.partial().omit({ captive_id: true });

function normalizeRoleNames(roles = []) {
  return [...new Set(roles.map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildReferentialSeed(seedInput = {}, actorEmail = null) {
  const today = todayISO();
  const enabled = Number(seedInput?.enabled) === 1;

  return {
    enabled,
    category: {
      code: seedInput?.category?.code || "GEN",
      name: seedInput?.category?.name || "Général",
      description: seedInput?.category?.description ?? null,
    },
    branch: {
      s2_code: seedInput?.branch?.s2_code || "GEN",
      name: seedInput?.branch?.name || "Branche Générale",
      description: seedInput?.branch?.description ?? null,
      branch_type: seedInput?.branch?.branch_type || "IARD",
      is_active: seedInput?.branch?.is_active === undefined ? 1 : Number(seedInput.branch.is_active) ? 1 : 0,
    },
    program: {
      code: seedInput?.program?.code || "BASE",
      name: seedInput?.program?.name || "Programme de Base",
      description: seedInput?.program?.description ?? null,
      is_active: seedInput?.program?.is_active === undefined ? 1 : Number(seedInput.program.is_active) ? 1 : 0,
    },
    policy: {
      is_allowed: seedInput?.policy?.is_allowed === undefined ? 1 : Number(seedInput.policy.is_allowed) ? 1 : 0,
      restriction_level: seedInput?.policy?.restriction_level || "NONE",
      fronting_required:
        seedInput?.policy?.fronting_required === undefined ? 0 : Number(seedInput.policy.fronting_required) ? 1 : 0,
      reinsurance_required:
        seedInput?.policy?.reinsurance_required === undefined
          ? 0
          : Number(seedInput.policy.reinsurance_required)
          ? 1
          : 0,
      comments: seedInput?.policy?.comments ?? null,
      effective_from: seedInput?.policy?.effective_from || today,
      effective_to: seedInput?.policy?.effective_to ?? null,
      eligibility_mode: seedInput?.policy?.eligibility_mode || "ALLOWED",
      approval_required:
        seedInput?.policy?.approval_required === undefined ? 0 : Number(seedInput.policy.approval_required) ? 1 : 0,
      approval_notes: seedInput?.policy?.approval_notes ?? null,
    },
    risk: {
      max_limit_per_claim: seedInput?.risk?.max_limit_per_claim ?? null,
      max_limit_per_year: seedInput?.risk?.max_limit_per_year ?? null,
      default_deductible: seedInput?.risk?.default_deductible ?? null,
      volatility_level: seedInput?.risk?.volatility_level || "MEDIUM",
      capital_intensity: seedInput?.risk?.capital_intensity || "MEDIUM",
      requires_actuarial_model:
        seedInput?.risk?.requires_actuarial_model === undefined
          ? 1
          : Number(seedInput.risk.requires_actuarial_model)
          ? 1
          : 0,
      net_retention_ratio: seedInput?.risk?.net_retention_ratio ?? null,
      target_loss_ratio: seedInput?.risk?.target_loss_ratio ?? null,
    },
    reinsurance: {
      rule_type: seedInput?.reinsurance?.rule_type || "QUOTA_SHARE",
      cession_rate: seedInput?.reinsurance?.cession_rate ?? 80,
      retention_limit: seedInput?.reinsurance?.retention_limit ?? null,
      priority: seedInput?.reinsurance?.priority ?? 1,
      effective_from: seedInput?.reinsurance?.effective_from || today,
      effective_to: seedInput?.reinsurance?.effective_to ?? null,
    },
    capital: {
      capital_method: seedInput?.capital?.capital_method || "STANDARD_FORMULA",
      capital_charge_pct: seedInput?.capital?.capital_charge_pct ?? 12,
      stress_scenario: seedInput?.capital?.stress_scenario ?? "Base",
      effective_from: seedInput?.capital?.effective_from || today,
      effective_to: seedInput?.capital?.effective_to ?? null,
    },
    policy_version: {
      version_label: seedInput?.policy_version?.version_label || "v1",
      changed_at: seedInput?.policy_version?.changed_at || null,
      changed_by: seedInput?.policy_version?.changed_by || actorEmail || "super_admin",
      change_notes: seedInput?.policy_version?.change_notes || "Initialisation automatique",
    },
  };
}

async function initializeCaptiveReferential(conn, captiveId, seed) {
  const [categoryInsert] = await conn.query(
    `INSERT INTO insurance_branch_category (captive_id, code, name, description) VALUES (?,?,?,?)`,
    [captiveId, seed.category.code, seed.category.name, seed.category.description]
  );
  const categoryId = categoryInsert.insertId;

  const [branchInsert] = await conn.query(
    `INSERT INTO insurance_branch (captive_id, s2_code, name, description, branch_type, is_active)
     VALUES (?,?,?,?,?,?)`,
    [
      captiveId,
      seed.branch.s2_code,
      seed.branch.name,
      seed.branch.description,
      seed.branch.branch_type,
      seed.branch.is_active,
    ]
  );
  const branchId = branchInsert.insertId;

  await conn.query(
    `INSERT INTO insurance_branch_category_map (id_branch, id_category) VALUES (?,?)`,
    [branchId, categoryId]
  );

  const [programInsert] = await conn.query(
    `INSERT INTO insurance_program (captive_id, code, name, description, is_active) VALUES (?,?,?,?,?)`,
    [captiveId, seed.program.code, seed.program.name, seed.program.description, seed.program.is_active]
  );
  const programId = programInsert.insertId;

  await conn.query(`INSERT INTO program_branch_map (id_program, id_branch) VALUES (?,?)`, [programId, branchId]);

  const [policyInsert] = await conn.query(
    `INSERT INTO captive_branch_policy
      (id_branch, is_allowed, restriction_level, fronting_required, reinsurance_required, comments, effective_from, effective_to, eligibility_mode, approval_required, approval_notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      branchId,
      seed.policy.is_allowed,
      seed.policy.restriction_level,
      seed.policy.fronting_required,
      seed.policy.reinsurance_required,
      seed.policy.comments,
      seed.policy.effective_from,
      seed.policy.effective_to,
      seed.policy.eligibility_mode,
      seed.policy.approval_required,
      seed.policy.approval_notes,
    ]
  );
  const policyId = policyInsert.insertId;

  await conn.query(
    `INSERT INTO branch_risk_parameters
      (id_branch, max_limit_per_claim, max_limit_per_year, default_deductible, volatility_level, capital_intensity, requires_actuarial_model, net_retention_ratio, target_loss_ratio)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      branchId,
      seed.risk.max_limit_per_claim,
      seed.risk.max_limit_per_year,
      seed.risk.default_deductible,
      seed.risk.volatility_level,
      seed.risk.capital_intensity,
      seed.risk.requires_actuarial_model,
      seed.risk.net_retention_ratio,
      seed.risk.target_loss_ratio,
    ]
  );

  await conn.query(
    `INSERT INTO branch_reinsurance_rules
      (id_branch, rule_type, cession_rate, retention_limit, priority, effective_from, effective_to)
     VALUES (?,?,?,?,?,?,?)`,
    [
      branchId,
      seed.reinsurance.rule_type,
      seed.reinsurance.cession_rate,
      seed.reinsurance.retention_limit,
      seed.reinsurance.priority,
      seed.reinsurance.effective_from,
      seed.reinsurance.effective_to,
    ]
  );

  await conn.query(
    `INSERT INTO branch_capital_parameters
      (id_branch, capital_method, capital_charge_pct, stress_scenario, effective_from, effective_to)
     VALUES (?,?,?,?,?,?)`,
    [
      branchId,
      seed.capital.capital_method,
      seed.capital.capital_charge_pct,
      seed.capital.stress_scenario,
      seed.capital.effective_from,
      seed.capital.effective_to,
    ]
  );

  await conn.query(
    `INSERT INTO branch_policy_version (id_policy, version_label, changed_at, changed_by, change_notes)
     VALUES (?,?,?,?,?)`,
    [
      policyId,
      seed.policy_version.version_label,
      seed.policy_version.changed_at || new Date(),
      seed.policy_version.changed_by,
      seed.policy_version.change_notes,
    ]
  );
}

async function clearCaptiveReferential(conn, captiveId) {
  await conn.query(
    `DELETE v
     FROM branch_policy_version v
     JOIN captive_branch_policy p ON p.id_policy = v.id_policy
     JOIN insurance_branch b ON b.id_branch = p.id_branch
     WHERE b.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE m
     FROM program_branch_map m
     JOIN insurance_program p ON p.id_program = m.id_program
     WHERE p.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE m
     FROM insurance_branch_category_map m
     JOIN insurance_branch b ON b.id_branch = m.id_branch
     WHERE b.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE m
     FROM insurance_branch_category_map m
     JOIN insurance_branch_category c ON c.id_category = m.id_category
     WHERE c.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE p
     FROM captive_branch_policy p
     JOIN insurance_branch b ON b.id_branch = p.id_branch
     WHERE b.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE r
     FROM branch_risk_parameters r
     JOIN insurance_branch b ON b.id_branch = r.id_branch
     WHERE b.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE r
     FROM branch_reinsurance_rules r
     JOIN insurance_branch b ON b.id_branch = r.id_branch
     WHERE b.captive_id = ?`,
    [captiveId]
  );
  await conn.query(
    `DELETE c
     FROM branch_capital_parameters c
     JOIN insurance_branch b ON b.id_branch = c.id_branch
     WHERE b.captive_id = ?`,
    [captiveId]
  );
  await conn.query(`DELETE FROM insurance_program WHERE captive_id = ?`, [captiveId]);
  await conn.query(`DELETE FROM insurance_branch WHERE captive_id = ?`, [captiveId]);
  await conn.query(`DELETE FROM insurance_branch_category WHERE captive_id = ?`, [captiveId]);
}

async function ensureRolesExist(conn, roles) {
  if (!roles.length) return [];
  const [rows] = await conn.query(`SELECT id, name FROM roles WHERE name IN (?)`, [roles]);
  const found = new Set(rows.map((r) => r.name));
  const missing = roles.filter((r) => !found.has(r));
  return { rows, missing };
}

async function replaceUserRoles(conn, userId, roles) {
  await conn.query(`DELETE FROM users_roles WHERE user_id = ?`, [userId]);
  if (!roles.length) return;
  const roleCheck = await ensureRolesExist(conn, roles);
  if (roleCheck.missing.length) {
    const err = new Error("invalid_roles");
    err.code = "invalid_roles";
    err.details = roleCheck.missing;
    throw err;
  }
  for (const role of roleCheck.rows) {
    await conn.query(`INSERT IGNORE INTO users_roles(user_id, role_id) VALUES (?,?)`, [userId, role.id]);
  }
}

async function ensureCaptivesExist(conn, memberships) {
  if (!memberships.length) return [];
  const captiveIds = [...new Set(memberships.map((m) => Number(m.captive_id)))];
  const [rows] = await conn.query(`SELECT id FROM captives WHERE id IN (?)`, [captiveIds]);
  const found = new Set(rows.map((r) => Number(r.id)));
  return captiveIds.filter((id) => !found.has(id));
}

async function replaceMemberships(conn, userId, memberships) {
  await conn.query(`DELETE FROM user_captive_memberships WHERE user_id = ?`, [userId]);
  if (!memberships.length) return;
  const missingCaptives = await ensureCaptivesExist(conn, memberships);
  if (missingCaptives.length) {
    const err = new Error("invalid_captives");
    err.code = "invalid_captives";
    err.details = missingCaptives;
    throw err;
  }
  for (const item of memberships) {
    await conn.query(
      `INSERT INTO user_captive_memberships
        (user_id, captive_id, role, is_owner, status, date_debut, date_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        item.captive_id,
        item.role,
        Number(item.is_owner) ? 1 : 0,
        item.status,
        item.date_debut || null,
        item.date_fin || null,
      ]
    );
  }
}

router.get("/captives", authRequired, requireRole("super_admin"), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT
       c.id, c.code, c.name, c.status, c.created_at, c.updated_at,
       COUNT(CASE WHEN ucm.status = 'active' THEN 1 END) AS active_members,
       COUNT(CASE WHEN ucm.status = 'active' AND ucm.is_owner = 1 THEN 1 END) AS active_owners
     FROM captives c
     LEFT JOIN user_captive_memberships ucm ON ucm.captive_id = c.id
     GROUP BY c.id
     ORDER BY c.id DESC`
  );
  res.json(rows);
});

router.get("/referential-templates", authRequired, requireRole("super_admin"), async (req, res) => {
  const scopeAll = String(req.query.scope || "").toLowerCase() === "all";
  if (scopeAll) {
    const [categories] = await pool.query(
      `SELECT id_category, code, name, description
       FROM insurance_branch_category
       ORDER BY code ASC`
    );
    const [branches] = await pool.query(
      `SELECT id_branch, s2_code, name, description, branch_type, is_active
       FROM insurance_branch
       ORDER BY s2_code ASC`
    );
    const [programs] = await pool.query(
      `SELECT id_program, code, name, description, is_active
       FROM insurance_program
       ORDER BY code ASC`
    );
    const [programBranches] = await pool.query(
      `SELECT
         pbm.id_program,
         pbm.id_branch,
         p.code AS program_code,
         b.s2_code
       FROM program_branch_map pbm
       JOIN insurance_program p ON p.id_program = pbm.id_program
       JOIN insurance_branch b ON b.id_branch = pbm.id_branch
       ORDER BY pbm.id_program ASC, pbm.id_branch ASC`
    );
    const [branchCategories] = await pool.query(
      `SELECT
         m.id_branch,
         m.id_category,
         b.s2_code,
         c.code AS category_code
       FROM insurance_branch_category_map m
       JOIN insurance_branch b ON b.id_branch = m.id_branch
       JOIN insurance_branch_category c ON c.id_category = m.id_category
       ORDER BY m.id_branch ASC, m.id_category ASC`
    );
    const [policies] = await pool.query(
      `SELECT
         p.id_policy,
         p.id_branch,
         b.s2_code,
         b.name AS branch_name,
         p.is_allowed,
         p.restriction_level,
         p.fronting_required,
         p.reinsurance_required,
         p.comments,
         p.effective_from,
         p.effective_to,
         p.eligibility_mode,
         p.approval_required,
         p.approval_notes
       FROM captive_branch_policy p
       JOIN insurance_branch b ON b.id_branch = p.id_branch
       ORDER BY p.id_policy ASC`
    );
    const [risks] = await pool.query(
      `SELECT
         r.id_parameters,
         r.id_branch,
         b.s2_code,
         b.name AS branch_name,
         r.max_limit_per_claim,
         r.max_limit_per_year,
         r.default_deductible,
         r.volatility_level,
         r.capital_intensity,
         r.requires_actuarial_model,
         r.net_retention_ratio,
         r.target_loss_ratio
       FROM branch_risk_parameters r
       JOIN insurance_branch b ON b.id_branch = r.id_branch
       ORDER BY r.id_parameters ASC`
    );
    const [reinsurance] = await pool.query(
      `SELECT
         r.id_rule,
         r.id_branch,
         b.s2_code,
         b.name AS branch_name,
         r.rule_type,
         r.cession_rate,
         r.retention_limit,
         r.priority,
         r.effective_from,
         r.effective_to
       FROM branch_reinsurance_rules r
       JOIN insurance_branch b ON b.id_branch = r.id_branch
       ORDER BY r.id_rule ASC`
    );
    const [capitals] = await pool.query(
      `SELECT
         c.id_capital,
         c.id_branch,
         b.s2_code,
         b.name AS branch_name,
         c.capital_method,
         c.capital_charge_pct,
         c.stress_scenario,
         c.effective_from,
         c.effective_to
       FROM branch_capital_parameters c
       JOIN insurance_branch b ON b.id_branch = c.id_branch
       ORDER BY c.id_capital ASC`
    );
    const [policyVersions] = await pool.query(
      `SELECT
         v.id_version,
         v.id_policy,
         p.id_branch,
         b.s2_code,
         b.name AS branch_name,
         v.version_label,
         v.changed_at,
         v.changed_by,
         v.change_notes
       FROM branch_policy_version v
       JOIN captive_branch_policy p ON p.id_policy = v.id_policy
       JOIN insurance_branch b ON b.id_branch = p.id_branch
       ORDER BY v.id_version ASC`
    );

    return res.json({
      captive_id: null,
      captive: null,
      categories,
      branches,
      branch_categories: branchCategories,
      programs,
      program_branches: programBranches,
      policies,
      risks,
      reinsurance,
      capitals,
      policy_versions: policyVersions,
    });
  }

  let captiveId = Number(req.query.captive_id);
  if (!captiveId) {
    const [[latest]] = await pool.query(
      `SELECT id FROM captives WHERE status = 'active' ORDER BY id DESC LIMIT 1`
    );
    if (latest?.id) {
      captiveId = Number(latest.id);
    } else {
      const [[fallback]] = await pool.query(`SELECT id FROM captives ORDER BY id DESC LIMIT 1`);
      captiveId = Number(fallback?.id || 0);
    }
  }

  if (!Number.isInteger(captiveId) || captiveId <= 0) {
    return res.json({
      captive_id: null,
      captive: null,
      categories: [],
      branches: [],
      programs: [],
      policies: [],
      risks: [],
      reinsurance: [],
      capitals: [],
      policy_versions: [],
    });
  }

  const [captiveRows] = await pool.query(
    `SELECT id, code, name, status FROM captives WHERE id = ? LIMIT 1`,
    [captiveId]
  );
  if (!captiveRows.length) {
    return res.status(404).json({ error: "captive_not_found" });
  }

  const [categories] = await pool.query(
    `SELECT id_category, code, name, description
     FROM insurance_branch_category
     WHERE captive_id = ?
     ORDER BY code ASC`,
    [captiveId]
  );
  const [branches] = await pool.query(
    `SELECT id_branch, s2_code, name, description, branch_type, is_active
     FROM insurance_branch
     WHERE captive_id = ?
     ORDER BY s2_code ASC`,
    [captiveId]
  );
  const [programs] = await pool.query(
    `SELECT id_program, code, name, description, is_active
     FROM insurance_program
     WHERE captive_id = ?
     ORDER BY code ASC`,
    [captiveId]
  );
  const [programBranches] = await pool.query(
    `SELECT
       pbm.id_program,
       pbm.id_branch,
       p.code AS program_code,
       b.s2_code
     FROM program_branch_map pbm
     JOIN insurance_program p ON p.id_program = pbm.id_program
     JOIN insurance_branch b ON b.id_branch = pbm.id_branch
     WHERE p.captive_id = ? AND b.captive_id = ?
     ORDER BY pbm.id_program ASC, pbm.id_branch ASC`,
    [captiveId, captiveId]
  );
  const [branchCategories] = await pool.query(
    `SELECT
       m.id_branch,
       m.id_category,
       b.s2_code,
       c.code AS category_code
     FROM insurance_branch_category_map m
     JOIN insurance_branch b ON b.id_branch = m.id_branch
     JOIN insurance_branch_category c ON c.id_category = m.id_category
     WHERE b.captive_id = ? AND c.captive_id = ?
     ORDER BY m.id_branch ASC, m.id_category ASC`,
    [captiveId, captiveId]
  );
  const [policies] = await pool.query(
    `SELECT
       p.id_policy,
       p.id_branch,
       b.s2_code,
       b.name AS branch_name,
       p.is_allowed,
       p.restriction_level,
       p.fronting_required,
       p.reinsurance_required,
       p.comments,
       p.effective_from,
       p.effective_to,
       p.eligibility_mode,
       p.approval_required,
       p.approval_notes
     FROM captive_branch_policy p
     JOIN insurance_branch b ON b.id_branch = p.id_branch
     WHERE b.captive_id = ?
     ORDER BY p.id_policy ASC`,
    [captiveId]
  );
  const [risks] = await pool.query(
    `SELECT
       r.id_parameters,
       r.id_branch,
       b.s2_code,
       b.name AS branch_name,
       r.max_limit_per_claim,
       r.max_limit_per_year,
       r.default_deductible,
       r.volatility_level,
       r.capital_intensity,
       r.requires_actuarial_model,
       r.net_retention_ratio,
       r.target_loss_ratio
     FROM branch_risk_parameters r
     JOIN insurance_branch b ON b.id_branch = r.id_branch
     WHERE b.captive_id = ?
     ORDER BY r.id_parameters ASC`,
    [captiveId]
  );
  const [reinsurance] = await pool.query(
    `SELECT
       r.id_rule,
       r.id_branch,
       b.s2_code,
       b.name AS branch_name,
       r.rule_type,
       r.cession_rate,
       r.retention_limit,
       r.priority,
       r.effective_from,
       r.effective_to
     FROM branch_reinsurance_rules r
     JOIN insurance_branch b ON b.id_branch = r.id_branch
     WHERE b.captive_id = ?
     ORDER BY r.id_rule ASC`,
    [captiveId]
  );
  const [capitals] = await pool.query(
    `SELECT
       c.id_capital,
       c.id_branch,
       b.s2_code,
       b.name AS branch_name,
       c.capital_method,
       c.capital_charge_pct,
       c.stress_scenario,
       c.effective_from,
       c.effective_to
     FROM branch_capital_parameters c
     JOIN insurance_branch b ON b.id_branch = c.id_branch
     WHERE b.captive_id = ?
     ORDER BY c.id_capital ASC`,
    [captiveId]
  );
  const [policyVersions] = await pool.query(
    `SELECT
       v.id_version,
       v.id_policy,
       p.id_branch,
       b.s2_code,
       b.name AS branch_name,
       v.version_label,
       v.changed_at,
       v.changed_by,
       v.change_notes
     FROM branch_policy_version v
     JOIN captive_branch_policy p ON p.id_policy = v.id_policy
     JOIN insurance_branch b ON b.id_branch = p.id_branch
     WHERE b.captive_id = ?
     ORDER BY v.id_version ASC`,
    [captiveId]
  );

  res.json({
    captive_id: captiveId,
    captive: captiveRows[0],
    categories,
    branches,
    branch_categories: branchCategories,
    programs,
    program_branches: programBranches,
    policies,
    risks,
    reinsurance,
    capitals,
    policy_versions: policyVersions,
  });
});

router.post("/captives", authRequired, requireRole("super_admin"), validate(createCaptiveSchema), async (req, res) => {
  const { code, name, status } = req.body;
  const seed = buildReferentialSeed(req.body.referential_seed || {}, req.user?.sub || null);
  const conn = await pool.getConnection();
  let inTransaction = false;
  try {
    await conn.beginTransaction();
    inTransaction = true;
    const [r] = await conn.query(`INSERT INTO captives(code, name, status) VALUES (?,?,?)`, [code, name, status]);
    if (seed.enabled) {
      await initializeCaptiveReferential(conn, r.insertId, seed);
    }
    await conn.commit();
    inTransaction = false;
    const [rows] = await pool.query(`SELECT * FROM captives WHERE id = ? LIMIT 1`, [r.insertId]);
    await logAudit(req.user?.uid, "captive", r.insertId, "create", {
      code,
      name,
      status,
      referential_seed_enabled: seed.enabled,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (inTransaction) {
      await conn.rollback();
    }
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "duplicate_code_or_seed_conflict" });
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.patch("/captives/:id", authRequired, requireRole("super_admin"), validate(patchCaptiveSchema), async (req, res) => {
  const captiveId = Number(req.params.id);
  if (!captiveId) return res.status(400).json({ error: "invalid_id" });
  const fields = ["code", "name", "status"];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  const hasReferentialSeed = req.body.referential_seed !== undefined;
  if (!sets.length && !hasReferentialSeed) return res.status(400).json({ error: "no_fields" });

  const conn = await pool.getConnection();
  let inTransaction = false;
  try {
    await conn.beginTransaction();
    inTransaction = true;

    if (sets.length) {
      const updateParams = [...params, captiveId];
      const [upd] = await conn.query(`UPDATE captives SET ${sets.join(", ")} WHERE id = ?`, updateParams);
      if (!upd.affectedRows) {
        await conn.rollback();
        inTransaction = false;
        return res.status(404).json({ error: "not_found" });
      }
    } else {
      const [exists] = await conn.query(`SELECT id FROM captives WHERE id = ? LIMIT 1`, [captiveId]);
      if (!exists.length) {
        await conn.rollback();
        inTransaction = false;
        return res.status(404).json({ error: "not_found" });
      }
    }

    if (hasReferentialSeed) {
      const seed = buildReferentialSeed(req.body.referential_seed || {}, req.user?.sub || null);
      if (seed.enabled) {
        await clearCaptiveReferential(conn, captiveId);
        await initializeCaptiveReferential(conn, captiveId, seed);
      }
    }

    await conn.commit();
    inTransaction = false;

    const [rows] = await pool.query(`SELECT * FROM captives WHERE id = ? LIMIT 1`, [req.params.id]);
    await logAudit(req.user?.uid, "captive", Number(req.params.id), "update", req.body);
    res.json(rows[0]);
  } catch (err) {
    if (inTransaction) {
      await conn.rollback();
    }
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "duplicate_code" });
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.delete(
  "/captives/:id",
  authRequired,
  requireRole("super_admin"),
  validate(deleteCaptiveSchema),
  async (req, res) => {
    const captiveId = Number(req.params.id);
    if (!captiveId) return res.status(400).json({ error: "invalid_id" });
    const adminIdentifier = String(req.body?.admin_identifier || "").trim();
    const adminPassword = String(req.body?.admin_password || "");
    if (!adminIdentifier || !adminPassword) {
      return res.status(400).json({ error: "missing_superadmin_credentials" });
    }

    const conn = await pool.getConnection();
    let inTransaction = false;
    try {
      const adminIdCandidate = Number(adminIdentifier);
      const lookupId = Number.isInteger(adminIdCandidate) && adminIdCandidate > 0 ? adminIdCandidate : 0;
      const [adminRows] = await conn.query(
        `SELECT id, email, password_hash, status
         FROM users
         WHERE LOWER(email) = LOWER(?) OR id = ?
         LIMIT 1`,
        [adminIdentifier, lookupId]
      );
      const adminUser = adminRows?.[0];
      if (!adminUser || Number(adminUser.id) !== Number(req.user?.uid)) {
        return res.status(403).json({ error: "invalid_superadmin_identifier" });
      }
      if (String(adminUser.status) !== "active") {
        return res.status(403).json({ error: "superadmin_not_active" });
      }
      const passwordOk = await bcrypt.compare(adminPassword, String(adminUser.password_hash || ""));
      if (!passwordOk) {
        return res.status(401).json({ error: "invalid_superadmin_password" });
      }

      await conn.beginTransaction();
      inTransaction = true;
      const [rows] = await conn.query(`SELECT id, code, name FROM captives WHERE id = ? LIMIT 1`, [captiveId]);
      if (!rows.length) {
        await conn.rollback();
        inTransaction = false;
        return res.status(404).json({ error: "not_found" });
      }

      const [[countRow]] = await conn.query(`SELECT COUNT(*) as total FROM captives`);
      if (Number(countRow?.total || 0) <= 1) {
        await conn.rollback();
        inTransaction = false;
        return res.status(409).json({ error: "cannot_delete_last_captive" });
      }

      await conn.query(
        `DELETE v
         FROM branch_policy_version v
         JOIN captive_branch_policy p ON p.id_policy = v.id_policy
         JOIN insurance_branch b ON b.id_branch = p.id_branch
         WHERE b.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE m
         FROM program_branch_map m
         JOIN insurance_program p ON p.id_program = m.id_program
         WHERE p.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE m
         FROM insurance_branch_category_map m
         JOIN insurance_branch b ON b.id_branch = m.id_branch
         WHERE b.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE m
         FROM insurance_branch_category_map m
         JOIN insurance_branch_category c ON c.id_category = m.id_category
         WHERE c.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE p
         FROM captive_branch_policy p
         JOIN insurance_branch b ON b.id_branch = p.id_branch
         WHERE b.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE r
         FROM branch_risk_parameters r
         JOIN insurance_branch b ON b.id_branch = r.id_branch
         WHERE b.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE r
         FROM branch_reinsurance_rules r
         JOIN insurance_branch b ON b.id_branch = r.id_branch
         WHERE b.captive_id = ?`,
        [captiveId]
      );
      await conn.query(
        `DELETE c
         FROM branch_capital_parameters c
         JOIN insurance_branch b ON b.id_branch = c.id_branch
         WHERE b.captive_id = ?`,
        [captiveId]
      );
      await conn.query(`DELETE FROM insurance_program WHERE captive_id = ?`, [captiveId]);
      await conn.query(`DELETE FROM insurance_branch WHERE captive_id = ?`, [captiveId]);
      await conn.query(`DELETE FROM insurance_branch_category WHERE captive_id = ?`, [captiveId]);
      await conn.query(`DELETE FROM user_captive_memberships WHERE captive_id = ?`, [captiveId]);
      await conn.query(`DELETE FROM programmes WHERE captive_id = ?`, [captiveId]);
      await conn.query(`DELETE FROM captives WHERE id = ?`, [captiveId]);

      await conn.commit();
      inTransaction = false;
      await logAudit(req.user?.uid, "captive", captiveId, "delete", null);
      res.json({ ok: true });
    } catch (err) {
      if (inTransaction) {
        await conn.rollback();
      }
      if (err?.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({ error: "captive_in_use" });
      }
      throw err;
    } finally {
      conn.release();
    }
  }
);

router.get("/programs", authRequired, requireRole("super_admin"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];

  if (req.query.captive_id) {
    where.push("p.captive_id = ?");
    params.push(Number(req.query.captive_id));
  }
  if (req.query.is_active !== undefined && req.query.is_active !== "") {
    where.push("p.is_active = ?");
    params.push(Number(req.query.is_active) ? 1 : 0);
  }
  const q = String(req.query.q || "").trim();
  if (q) {
    where.push("(p.code LIKE ? OR p.name LIKE ? OR c.code LIKE ? OR c.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) as total
     FROM insurance_program p
     JOIN captives c ON c.id = p.captive_id
     ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT p.id_program, p.captive_id, c.code as captive_code, c.name as captive_name,
            p.code, p.name, p.description, p.is_active, p.created_at
     FROM insurance_program p
     JOIN captives c ON c.id = p.captive_id
     ${whereSql}
     ORDER BY c.code ASC, p.code ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total: countRow?.total || 0 } });
});

router.post(
  "/programs",
  authRequired,
  requireRole("super_admin"),
  validate(insuranceProgramCreateSchema),
  async (req, res) => {
    const { captive_id, code, name, description, is_active } = req.body;
    const [captives] = await pool.query(`SELECT id FROM captives WHERE id = ? LIMIT 1`, [captive_id]);
    if (!captives.length) return res.status(404).json({ error: "captive_not_found" });
    try {
      const [r] = await pool.query(
        `INSERT INTO insurance_program (captive_id, code, name, description, is_active) VALUES (?,?,?,?,?)`,
        [captive_id, code, name, description ?? null, Number(is_active) ? 1 : 0]
      );
      const [rows] = await pool.query(
        `SELECT p.id_program, p.captive_id, c.code as captive_code, c.name as captive_name,
                p.code, p.name, p.description, p.is_active, p.created_at
         FROM insurance_program p
         JOIN captives c ON c.id = p.captive_id
         WHERE p.id_program = ?`,
        [r.insertId]
      );
      await logAudit(req.user?.uid, "insurance_program", r.insertId, "create", req.body);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "duplicate_program_code_in_captive" });
      }
      throw err;
    }
  }
);

router.patch(
  "/programs/:id",
  authRequired,
  requireRole("super_admin"),
  validate(insuranceProgramPatchSchema),
  async (req, res) => {
    const idProgram = Number(req.params.id);
    if (!idProgram) return res.status(400).json({ error: "invalid_id" });
    const fields = ["code", "name", "description", "is_active"];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        if (f === "is_active") params.push(Number(req.body[f]) ? 1 : 0);
        else if (f === "description") params.push(req.body[f] ?? null);
        else params.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    params.push(idProgram);
    try {
      const [upd] = await pool.query(`UPDATE insurance_program SET ${sets.join(", ")} WHERE id_program = ?`, params);
      if (!upd.affectedRows) return res.status(404).json({ error: "program_not_found" });
      const [rows] = await pool.query(
        `SELECT p.id_program, p.captive_id, c.code as captive_code, c.name as captive_name,
                p.code, p.name, p.description, p.is_active, p.created_at
         FROM insurance_program p
         JOIN captives c ON c.id = p.captive_id
         WHERE p.id_program = ?`,
        [idProgram]
      );
      await logAudit(req.user?.uid, "insurance_program", idProgram, "update", req.body);
      res.json(rows[0]);
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "duplicate_program_code_in_captive" });
      }
      throw err;
    }
  }
);

router.delete("/programs/:id", authRequired, requireRole("super_admin"), async (req, res) => {
  const idProgram = Number(req.params.id);
  if (!idProgram) return res.status(400).json({ error: "invalid_id" });
  try {
    const [rows] = await pool.query(`SELECT id_program FROM insurance_program WHERE id_program = ? LIMIT 1`, [idProgram]);
    if (!rows.length) return res.status(404).json({ error: "program_not_found" });
    await pool.query(`DELETE FROM insurance_program WHERE id_program = ?`, [idProgram]);
    await logAudit(req.user?.uid, "insurance_program", idProgram, "delete", null);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({ error: "program_in_use" });
    }
    throw err;
  }
});

router.get("/users", authRequired, requireRole("super_admin"), async (_req, res) => {
  const [users] = await pool.query(`SELECT id, email, status, created_at FROM users ORDER BY id DESC`);
  const [roleRows] = await pool.query(
    `SELECT ur.user_id, r.name AS role
     FROM users_roles ur
     JOIN roles r ON r.id = ur.role_id`
  );
  const [membershipRows] = await pool.query(
    `SELECT
       ucm.user_id,
       ucm.captive_id,
       c.code AS captive_code,
       c.name AS captive_name,
       ucm.role,
       ucm.is_owner,
       ucm.status,
       ucm.date_debut,
       ucm.date_fin
     FROM user_captive_memberships ucm
     JOIN captives c ON c.id = ucm.captive_id
     ORDER BY ucm.user_id ASC, c.name ASC`
  );

  const roleMap = new Map();
  for (const row of roleRows) {
    const list = roleMap.get(row.user_id) || [];
    list.push(row.role);
    roleMap.set(row.user_id, list);
  }
  const membershipMap = new Map();
  for (const row of membershipRows) {
    const list = membershipMap.get(row.user_id) || [];
    list.push({
      captive_id: row.captive_id,
      captive_code: row.captive_code,
      captive_name: row.captive_name,
      role: row.role,
      is_owner: Boolean(row.is_owner),
      status: row.status,
      date_debut: row.date_debut,
      date_fin: row.date_fin,
    });
    membershipMap.set(row.user_id, list);
  }

  res.json(
    users.map((u) => ({
      ...u,
      roles: roleMap.get(u.id) || [],
      memberships: membershipMap.get(u.id) || [],
    }))
  );
});

router.get("/users/:id", authRequired, requireRole("super_admin"), async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: "invalid_id" });
  const [users] = await pool.query(`SELECT id, email, status, created_at FROM users WHERE id = ? LIMIT 1`, [userId]);
  if (!users.length) return res.status(404).json({ error: "not_found" });

  const [roleRows] = await pool.query(
    `SELECT r.name AS role
     FROM users_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  const [membershipRows] = await pool.query(
    `SELECT
       ucm.captive_id,
       c.code AS captive_code,
       c.name AS captive_name,
       ucm.role,
       ucm.is_owner,
       ucm.status,
       ucm.date_debut,
       ucm.date_fin
     FROM user_captive_memberships ucm
     JOIN captives c ON c.id = ucm.captive_id
     WHERE ucm.user_id = ?
     ORDER BY c.name ASC`,
    [userId]
  );

  res.json({
    ...users[0],
    roles: roleRows.map((r) => r.role),
    memberships: membershipRows.map((m) => ({
      captive_id: m.captive_id,
      captive_code: m.captive_code,
      captive_name: m.captive_name,
      role: m.role,
      is_owner: Boolean(m.is_owner),
      status: m.status,
      date_debut: m.date_debut,
      date_fin: m.date_fin,
    })),
  });
});

router.post("/users", authRequired, requireRole("super_admin"), validate(createUserSchema), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const payload = {
      ...req.body,
      roles: normalizeRoleNames(req.body.roles),
    };

    await conn.beginTransaction();
    const hash = await bcrypt.hash(payload.password, 10);
    const [r] = await conn.query(`INSERT INTO users(email, password_hash, status) VALUES (?,?,?)`, [
      payload.email,
      hash,
      payload.status,
    ]);
    const userId = r.insertId;

    await replaceUserRoles(conn, userId, payload.roles);
    await replaceMemberships(conn, userId, payload.memberships);

    await conn.commit();
    await logAudit(req.user?.uid, "user", userId, "create", {
      email: payload.email,
      status: payload.status,
      roles: payload.roles,
      memberships: payload.memberships,
    });
    res.status(201).json({ id: userId });
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "duplicate_email_or_membership" });
    }
    if (err?.code === "invalid_roles") {
      return res.status(400).json({ error: "invalid_roles", details: err.details || [] });
    }
    if (err?.code === "invalid_captives") {
      return res.status(400).json({ error: "invalid_captives", details: err.details || [] });
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.patch("/users/:id", authRequired, requireRole("super_admin"), validate(patchUserSchema), async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: "invalid_id" });

  const conn = await pool.getConnection();
  try {
    const payload = {
      ...req.body,
      roles: req.body.roles ? normalizeRoleNames(req.body.roles) : undefined,
    };
    if (
      payload.email === undefined &&
      payload.password === undefined &&
      payload.status === undefined &&
      payload.roles === undefined &&
      payload.memberships === undefined
    ) {
      return res.status(400).json({ error: "no_fields" });
    }

    await conn.beginTransaction();

    const [exists] = await conn.query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (!exists.length) {
      await conn.rollback();
      return res.status(404).json({ error: "not_found" });
    }

    const fields = [];
    const params = [];
    if (payload.email !== undefined) {
      fields.push("email = ?");
      params.push(payload.email);
    }
    if (payload.password !== undefined) {
      fields.push("password_hash = ?");
      params.push(await bcrypt.hash(payload.password, 10));
    }
    if (payload.status !== undefined) {
      fields.push("status = ?");
      params.push(payload.status);
    }
    if (fields.length) {
      params.push(userId);
      await conn.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);
    }
    if (payload.roles !== undefined) {
      await replaceUserRoles(conn, userId, payload.roles);
    }
    if (payload.memberships !== undefined) {
      await replaceMemberships(conn, userId, payload.memberships);
    }

    await conn.commit();
    await logAudit(req.user?.uid, "user", userId, "update", {
      email: payload.email,
      status: payload.status,
      roles: payload.roles,
      memberships: payload.memberships,
      password_updated: payload.password !== undefined,
    });
    res.json({ id: userId, updated: true });
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "duplicate_email_or_membership" });
    }
    if (err?.code === "invalid_roles") {
      return res.status(400).json({ error: "invalid_roles", details: err.details || [] });
    }
    if (err?.code === "invalid_captives") {
      return res.status(400).json({ error: "invalid_captives", details: err.details || [] });
    }
    throw err;
  } finally {
    conn.release();
  }
});

export default router;
