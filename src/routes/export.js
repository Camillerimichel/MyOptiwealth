import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { toCsv } from "../utils/csv.js";

const router = Router();

function getCaptiveId(req) {
  const captiveId = Number(req.user?.captive_id);
  return Number.isInteger(captiveId) && captiveId > 0 ? captiveId : 0;
}

router.get(
  "/programmes.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, branch_s2_code, ligne_risque, limite, franchise, devise, assureur, debut, fin, statut, created_at
       FROM programmes
       ORDER BY created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programmes.csv");
    res.send(csv);
  }
);

router.get(
  "/sinistres.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT s.id, s.programme_id, p.ligne_risque, s.date_survenue, s.date_decl, s.statut,
              s.montant_estime, s.montant_paye, s.devise, s.description, s.created_at
       FROM sinistres s
       LEFT JOIN programmes p ON p.id = s.programme_id
       WHERE p.captive_id = ?
       ORDER BY s.created_at DESC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sinistres.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-branches.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT b.id_branch, b.s2_code, b.name, b.description, b.branch_type, b.is_active,
              c.code as category_code, c.name as category_name
       FROM insurance_branch b
       LEFT JOIN insurance_branch_category_map m ON m.id_branch = b.id_branch
       LEFT JOIN insurance_branch_category c ON c.id_category = m.id_category
       WHERE b.captive_id = ?
       ORDER BY b.id_branch ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-branches.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-categories.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT id_category, code, name, description, created_at
       FROM insurance_branch_category
       WHERE captive_id = ?
       ORDER BY id_category ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-categories.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-branch-category-map.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT m.id_branch, b.s2_code, b.name as branch_name, m.id_category, c.code as category_code, c.name as category_name
       FROM insurance_branch_category_map m
       LEFT JOIN insurance_branch b ON b.id_branch = m.id_branch
       LEFT JOIN insurance_branch_category c ON c.id_category = m.id_category
       WHERE b.captive_id = ? AND c.captive_id = ?
       ORDER BY m.id_branch ASC, m.id_category ASC`,
      [captiveId, captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-branch-category-map.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-policies.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT p.id_policy, p.id_branch, b.s2_code, b.name as branch_name, p.is_allowed, p.restriction_level,
              p.fronting_required, p.reinsurance_required, p.comments, p.effective_from, p.effective_to,
              p.eligibility_mode, p.approval_required, p.approval_notes, p.created_at
       FROM captive_branch_policy p
       LEFT JOIN insurance_branch b ON b.id_branch = p.id_branch
       WHERE b.captive_id = ?
       ORDER BY p.id_policy ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-policies.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-risk-parameters.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT r.id_parameters, r.id_branch, b.s2_code, b.name as branch_name,
              r.max_limit_per_claim, r.max_limit_per_year, r.default_deductible,
              r.volatility_level, r.capital_intensity, r.requires_actuarial_model,
              r.net_retention_ratio, r.target_loss_ratio, r.created_at
       FROM branch_risk_parameters r
       LEFT JOIN insurance_branch b ON b.id_branch = r.id_branch
       WHERE b.captive_id = ?
       ORDER BY r.id_parameters ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-risk-parameters.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-reinsurance-rules.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT r.id_rule, r.id_branch, b.s2_code, b.name as branch_name, r.rule_type,
              r.cession_rate, r.retention_limit, r.priority, r.effective_from, r.effective_to, r.created_at
       FROM branch_reinsurance_rules r
       LEFT JOIN insurance_branch b ON b.id_branch = r.id_branch
       WHERE b.captive_id = ?
       ORDER BY r.id_rule ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-reinsurance-rules.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-programs.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT id_program, code, name, description, is_active, created_at
       FROM insurance_program
       WHERE captive_id = ?
       ORDER BY id_program ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-programs.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-program-branches.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT pbm.id_program, p.code as program_code, p.name as program_name,
              pbm.id_branch, b.s2_code, b.name as branch_name
       FROM program_branch_map pbm
       LEFT JOIN insurance_program p ON p.id_program = pbm.id_program
       LEFT JOIN insurance_branch b ON b.id_branch = pbm.id_branch
       WHERE p.captive_id = ? AND b.captive_id = ?
       ORDER BY pbm.id_program ASC, pbm.id_branch ASC`,
      [captiveId, captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-program-branches.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-capital-parameters.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT c.id_capital, c.id_branch, b.s2_code, b.name as branch_name,
              c.capital_method, c.capital_charge_pct, c.stress_scenario,
              c.effective_from, c.effective_to, c.created_at
       FROM branch_capital_parameters c
       LEFT JOIN insurance_branch b ON b.id_branch = c.id_branch
       WHERE b.captive_id = ?
       ORDER BY c.id_capital ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-capital-parameters.csv");
    res.send(csv);
  }
);

router.get(
  "/captive-policy-versions.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(401).json({ error: "invalid_token_scope" });
    const [rows] = await pool.query(
      `SELECT v.id_version, v.id_policy, p.id_branch, b.s2_code, b.name as branch_name,
              v.version_label, v.changed_at, v.changed_by, v.change_notes
       FROM branch_policy_version v
       LEFT JOIN captive_branch_policy p ON p.id_policy = v.id_policy
       LEFT JOIN insurance_branch b ON b.id_branch = p.id_branch
       WHERE b.captive_id = ?
       ORDER BY v.id_version ASC`,
      [captiveId]
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=captive-policy-versions.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-layers.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT l.id_layer, l.programme_id, p.ligne_risque as programme_name, l.name, l.layer_type,
              l.attachment_point, l.limit_amount, l.currency, l.effective_from, l.effective_to, l.created_at
       FROM programme_layers l
       LEFT JOIN programmes p ON p.id = l.programme_id
       ORDER BY l.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-layers.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-coverages.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.id_coverage, c.programme_id, p.ligne_risque as programme_name, c.label, c.coverage_type,
              c.limit_per_claim, c.limit_annual, c.currency, c.created_at
       FROM programme_coverages c
       LEFT JOIN programmes p ON p.id = c.programme_id
       ORDER BY c.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-coverages.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-pricing.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pr.id_pricing, pr.programme_id, p.ligne_risque as programme_name, pr.coverage_id,
              c.label as coverage_label, pr.pricing_method, pr.premium_amount, pr.rate_value,
              pr.minimum_premium, pr.currency, pr.effective_from, pr.effective_to, pr.notes, pr.created_at
       FROM programme_pricing pr
       LEFT JOIN programmes p ON p.id = pr.programme_id
       LEFT JOIN programme_coverages c ON c.id_coverage = pr.coverage_id
       ORDER BY pr.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-pricing.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-deductibles.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT d.id_deductible, d.programme_id, p.ligne_risque as programme_name, d.coverage_id,
              c.label as coverage_label, d.amount, d.unit, d.currency, d.notes, d.created_at
       FROM programme_deductibles d
       LEFT JOIN programmes p ON p.id = d.programme_id
       LEFT JOIN programme_coverages c ON c.id_coverage = d.coverage_id
       ORDER BY d.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-deductibles.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-exclusions.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT e.id_exclusion, e.programme_id, p.ligne_risque as programme_name, e.category, e.description, e.created_at
       FROM programme_exclusions e
       LEFT JOIN programmes p ON p.id = e.programme_id
       ORDER BY e.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-exclusions.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-conditions.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pc.id_condition, pc.programme_id, p.ligne_risque as programme_name, pc.title, pc.content, pc.created_at
       FROM programme_conditions pc
       LEFT JOIN programmes p ON p.id = pc.programme_id
       ORDER BY pc.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-conditions.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-carriers.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pc.id_carrier, pc.programme_id, p.ligne_risque as programme_name, pc.carrier_name, pc.role, pc.share_pct, pc.created_at
       FROM programme_carriers pc
       LEFT JOIN programmes p ON p.id = pc.programme_id
       ORDER BY pc.created_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-carriers.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-documents.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pd.id_document, pd.programme_id, p.ligne_risque as programme_name, pd.doc_type,
              pd.file_name, pd.file_path, pd.uploaded_at
       FROM programme_documents pd
       LEFT JOIN programmes p ON p.id = pd.programme_id
       ORDER BY pd.uploaded_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-documents.csv");
    res.send(csv);
  }
);

router.get(
  "/programme-versions.csv",
  authRequired,
  requireRole("admin", "cfo", "risk_manager", "actuaire", "conseil"),
  async (req, res) => {
    const [rows] = await pool.query(
      `SELECT v.id_version, v.programme_id, p.ligne_risque as programme_name, v.version_label,
              v.changed_by, v.change_notes, v.changed_at
       FROM programme_versions v
       LEFT JOIN programmes p ON p.id = v.programme_id
       ORDER BY v.changed_at DESC`
    );
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=programme-versions.csv");
    res.send(csv);
  }
);

export default router;
