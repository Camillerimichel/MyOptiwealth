import { Router } from "express";
import { z } from "zod";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
const canManage = ["admin", "risk_manager", "actuaire", "conseil"];
const AMOUNT_EPSILON = 1e-6;
const STATUS_RANK = {
  ouvert: 1,
  en_cours: 2,
  clos: 3,
  rejete: 3,
};

function canAdvanceLineStatus(current, next) {
  if (current === next) return true;
  if (current === "clos" || current === "rejete") return false;
  return STATUS_RANK[next] >= STATUS_RANK[current];
}

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

async function hasProgrammeInScope(programmeId, captiveId, db = pool) {
  const [rows] = await db.query(
    `SELECT id
     FROM programmes
     WHERE id = ? AND captive_id = ?
     LIMIT 1`,
    [programmeId, captiveId]
  );
  return rows.length > 0;
}

async function getProgrammeInScope(programmeId, captiveId, db = pool) {
  const [rows] = await db.query(
    `SELECT id, ligne_risque, franchise
     FROM programmes
     WHERE id = ? AND captive_id = ?
     LIMIT 1`,
    [programmeId, captiveId]
  );
  return rows[0] || null;
}

async function getPartnerById(partnerId, db = pool) {
  const [rows] = await db.query(
    `SELECT id, raison_sociale, siren
     FROM partners
     WHERE id = ?
     LIMIT 1`,
    [partnerId]
  );
  return rows[0] || null;
}

async function getClientById(clientId, db = pool) {
  const [rows] = await db.query(
    `SELECT id, external_client_ref, partner_id
     FROM clients
     WHERE id = ?
     LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

async function hasContractForClientPartnerProgramme(clientId, partnerId, programmeId, db = pool) {
  const [rows] = await db.query(
    `SELECT id
     FROM contracts
     WHERE client_id = ?
       AND partner_id = ?
       AND programme_id = ?
       AND statut <> 'resilie'
     LIMIT 1`,
    [clientId, partnerId, programmeId]
  );
  return rows.length > 0;
}

async function hasBranchInScope(branchId, captiveId, db = pool) {
  const [rows] = await db.query(
    `SELECT id_branch
     FROM insurance_branch
     WHERE id_branch = ? AND captive_id = ?
     LIMIT 1`,
    [branchId, captiveId]
  );
  return rows.length > 0;
}

async function getDefaultBranchForProgramme(programmeId, captiveId, db = pool) {
  const [rows] = await db.query(
    `SELECT b.id_branch
     FROM programmes p
     JOIN insurance_branch b ON b.captive_id = p.captive_id AND b.s2_code = p.branch_s2_code
     WHERE p.id = ? AND p.captive_id = ?
     LIMIT 1`,
    [programmeId, captiveId]
  );
  return Number(rows[0]?.id_branch || 0);
}

async function getSinistreInScope(sinistreId, captiveId, db = pool) {
  const [rows] = await db.query(
    `SELECT s.*,
            p.ligne_risque,
            p.branch_s2_code AS programme_branch_s2_code,
            p.assureur AS programme_assureur,
            p.limite AS programme_limite,
            p.franchise AS programme_franchise,
            p.devise AS programme_devise,
            b.name AS programme_branch_name,
            c.external_client_ref AS client_ref,
            pr.raison_sociale AS partner_name,
            pr.siren AS partner_siren
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN clients c ON c.id = s.client_id
     LEFT JOIN partners pr ON pr.id = s.partner_id
     LEFT JOIN insurance_branch b ON b.captive_id = p.captive_id AND b.s2_code = p.branch_s2_code
     WHERE s.id = ? AND p.captive_id = ?
     LIMIT 1`,
    [sinistreId, captiveId]
  );
  return rows[0] || null;
}

async function listSinistreLignes(sinistreId, captiveId, db = pool) {
  const [rows] = await db.query(
    `SELECT sl.*,
            b.s2_code AS branch_s2_code,
            b.name AS branch_name
     FROM sinistre_lignes sl
     JOIN sinistres s ON s.id = sl.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN insurance_branch b ON b.id_branch = sl.id_branch
     WHERE sl.sinistre_id = ? AND p.captive_id = ?
     ORDER BY sl.id ASC`,
    [sinistreId, captiveId]
  );
  return rows;
}

function normalizeRiskLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isAutoFranchiseLine(ligneRisque) {
  return normalizeRiskLabel(ligneRisque) === "RC GENERALE";
}

function resolveLineFranchise(rawLineFranchise, programmeFranchise, autoDetermine) {
  if (autoDetermine) return Math.max(Number(programmeFranchise || 0), 0);
  return Math.max(Number(rawLineFranchise || 0), 0);
}

async function getReglementCapacity(sinistreId, db = pool, { forUpdate = false, programmeFranchise = 0 } = {}) {
  const lockSuffix = forUpdate ? " FOR UPDATE" : "";
  const [[lineAggregate]] = await db.query(
    `SELECT
       COALESCE(SUM(montant_estime), 0) AS total_estime,
       COALESCE(MAX(montant_franchise), 0) AS global_franchise_ligne
     FROM sinistre_lignes
     WHERE sinistre_id = ?${lockSuffix}`,
    [sinistreId]
  );
  const [[reglementAggregate]] = await db.query(
    `SELECT COALESCE(SUM(montant), 0) AS total_regle
     FROM reglements
     WHERE sinistre_id = ?${lockSuffix}`,
    [sinistreId]
  );
  const totalEstime = Number(lineAggregate?.total_estime || 0);
  const franchiseLigne = Number(lineAggregate?.global_franchise_ligne || 0);
  const franchiseProgramme = Number(programmeFranchise || 0);
  const totalFranchise = Math.max(franchiseLigne, franchiseProgramme, 0);
  const totalRegle = Number(reglementAggregate?.total_regle || 0);
  const maxPayable = Math.max(totalEstime - totalFranchise, 0);
  const remaining = Math.max(maxPayable - totalRegle, 0);
  return { totalEstime, totalFranchise, totalRegle, maxPayable, remaining };
}

function deriveGlobalStatusFromLines(aggregate) {
  const total = Number(aggregate?.total_count || 0);
  const openCount = Number(aggregate?.open_count || 0);
  const inProgressCount = Number(aggregate?.in_progress_count || 0);
  const closedCount = Number(aggregate?.closed_count || 0);
  const rejectedCount = Number(aggregate?.rejected_count || 0);
  if (!total) return null;
  if (openCount === total) return "ouvert";
  if (closedCount + rejectedCount === total) {
    return rejectedCount === total ? "rejete" : "clos";
  }
  if (inProgressCount > 0 || openCount > 0) return "en_cours";
  return "en_cours";
}

async function recomputeSinistreFromLines(sinistreId, db = pool) {
  const [[aggregate]] = await db.query(
    `SELECT
       COALESCE(SUM(montant_estime), 0) AS total_estime,
       COALESCE(SUM(montant_paye), 0) AS total_paye,
       SUM(CASE WHEN statut = 'ouvert' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN statut = 'en_cours' THEN 1 ELSE 0 END) AS in_progress_count,
       SUM(CASE WHEN statut = 'clos' THEN 1 ELSE 0 END) AS closed_count,
       SUM(CASE WHEN statut = 'rejete' THEN 1 ELSE 0 END) AS rejected_count,
       COUNT(*) AS total_count
     FROM sinistre_lignes
     WHERE sinistre_id = ?`,
    [sinistreId]
  );
  const statut = deriveGlobalStatusFromLines(aggregate);
  if (!statut) return;
  await db.query(
    `UPDATE sinistres
     SET montant_estime = ?, montant_paye = ?, statut = ?
     WHERE id = ?`,
    [aggregate.total_estime, aggregate.total_paye, statut, sinistreId]
  );
}

async function ensureDistinctAndScopedBranches(lignes, captiveId, db = pool) {
  const seen = new Set();
  for (const ligne of lignes) {
    const branchId = Number(ligne.id_branch);
    if (seen.has(branchId)) return { ok: false, error: "duplicate_branch_in_ventilation" };
    seen.add(branchId);
    if (!(await hasBranchInScope(branchId, captiveId, db))) {
      return { ok: false, error: "branch_not_in_scope" };
    }
  }
  return { ok: true };
}

const statutEnum = z.enum(["ouvert", "en_cours", "clos", "rejete"]);
const deviseSchema = z.string().length(3).transform((s) => s.toUpperCase());

const sinistreLigneCreate = z.object({
  id_branch: z.coerce.number().int().positive(),
  statut: statutEnum.default("ouvert"),
  montant_estime: z.coerce.number().nonnegative().default(0),
  montant_paye: z.coerce.number().nonnegative().default(0),
  montant_recours: z.coerce.number().nonnegative().default(0),
  montant_franchise: z.coerce.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
});

const sinistreLignePatch = z.object({
  id_branch: z.coerce.number().int().positive().optional(),
  statut: statutEnum.optional(),
  montant_estime: z.coerce.number().nonnegative().optional(),
  montant_paye: z.coerce.number().nonnegative().optional(),
  montant_recours: z.coerce.number().nonnegative().optional(),
  montant_franchise: z.coerce.number().nonnegative().optional(),
  description: z.string().optional().nullable(),
});

const sinistreCreate = z.object({
  programme_id: z.coerce.number().int().positive(),
  partner_id: z.coerce.number().int().positive(),
  client_id: z.coerce.number().int().positive(),
  date_survenue: z.string().optional().nullable(),
  date_decl: z.string().optional().nullable(),
  statut: statutEnum.default("ouvert"),
  montant_estime: z.coerce.number().nonnegative().default(0),
  montant_paye: z.coerce.number().nonnegative().default(0),
  devise: deviseSchema.default("EUR"),
  description: z.string().optional().nullable(),
  lignes: z.array(sinistreLigneCreate).min(1).optional(),
});

const sinistrePatch = z.object({
  programme_id: z.coerce.number().int().positive().optional(),
  date_survenue: z.string().optional().nullable(),
  date_decl: z.string().optional().nullable(),
  statut: statutEnum.optional(),
  montant_estime: z.coerce.number().nonnegative().optional(),
  montant_paye: z.coerce.number().nonnegative().optional(),
  devise: deviseSchema.optional(),
  description: z.string().optional().nullable(),
});

const reglementCreate = z.object({
  sinistre_ligne_id: z.coerce.number().int().positive().optional(),
  date: z.string().optional().nullable(),
  montant: z.coerce.number().nonnegative().default(0),
});

router.get("/", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = ["p.captive_id = ?"];
  const params = [captiveId];
  const branchId = Number(req.query.id_branch || 0);
  const ligneRisque = typeof req.query.ligne_risque === "string" ? req.query.ligne_risque.trim() : "";
  const partnerQuery = typeof req.query.partner_q === "string" ? req.query.partner_q.trim() : "";
  const clientQuery = typeof req.query.client_q === "string" ? req.query.client_q.trim() : "";
  const sortEstime = String(req.query.sort_estime || "").trim().toLowerCase();
  const sortPaye = String(req.query.sort_paye || "").trim().toLowerCase();
  if (req.query.programme_id) {
    where.push("s.programme_id = ?");
    params.push(Number(req.query.programme_id));
  }
  if (req.query.statut) {
    where.push("s.statut = ?");
    params.push(req.query.statut);
  }
  if (partnerQuery) {
    where.push("UPPER(COALESCE(pr.raison_sociale, '')) LIKE ?");
    params.push(`%${partnerQuery.toUpperCase()}%`);
  }
  if (clientQuery) {
    where.push("UPPER(COALESCE(c.external_client_ref, '')) LIKE ?");
    params.push(`%${clientQuery.toUpperCase()}%`);
  }
  if (branchId > 0) {
    if (!(await hasBranchInScope(branchId, captiveId))) {
      return res.status(403).json({ error: "forbidden_scope" });
    }
    where.push(
      `EXISTS (
        SELECT 1
        FROM sinistre_lignes sl_filter
        WHERE sl_filter.sinistre_id = s.id AND sl_filter.id_branch = ?
      )`
    );
    params.push(branchId);
  }
  if (ligneRisque) {
    if (ligneRisque === "__EMPTY__") {
      where.push("(p.ligne_risque IS NULL OR TRIM(p.ligne_risque) = '')");
    } else {
      where.push("p.ligne_risque = ?");
      params.push(ligneRisque);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderClauses = [];
  if (sortEstime === "asc" || sortEstime === "desc") {
    orderClauses.push(`s.montant_estime ${sortEstime.toUpperCase()}`);
  }
  if (sortPaye === "asc" || sortPaye === "desc") {
    orderClauses.push(`s.montant_paye ${sortPaye.toUpperCase()}`);
  }
  orderClauses.push("s.created_at DESC");
  const orderSql = `ORDER BY ${orderClauses.join(", ")}`;
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN clients c ON c.id = s.client_id
     LEFT JOIN partners pr ON pr.id = s.partner_id
     ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT s.*,
            p.ligne_risque,
            c.external_client_ref AS client_ref,
            pr.raison_sociale AS partner_name,
            pr.siren AS partner_siren,
            COALESCE(line_map.line_count, 0) AS lignes_count
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN clients c ON c.id = s.client_id
     LEFT JOIN partners pr ON pr.id = s.partner_id
     LEFT JOIN (
       SELECT sinistre_id, COUNT(*) AS line_count
       FROM sinistre_lignes
       GROUP BY sinistre_id
     ) line_map ON line_map.sinistre_id = s.id
     ${whereSql}
     ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
});

router.get("/stats/arborescence", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const branchId = Number(req.query.id_branch || 0);
  if (branchId > 0 && !(await hasBranchInScope(branchId, captiveId))) {
    return res.status(403).json({ error: "forbidden_scope" });
  }

  const [branchRows] = await pool.query(
    `SELECT
       sl.id_branch,
       b.s2_code,
       b.name,
       COALESCE(SUM(sl.montant_estime), 0) AS total,
       COALESCE(SUM(CASE WHEN s.statut = 'ouvert' THEN sl.montant_estime ELSE 0 END), 0) AS ouvert,
       COALESCE(SUM(CASE WHEN s.statut = 'en_cours' THEN sl.montant_estime ELSE 0 END), 0) AS en_cours,
       COALESCE(SUM(CASE WHEN s.statut = 'clos' THEN sl.montant_estime ELSE 0 END), 0) AS clos,
       COALESCE(SUM(CASE WHEN s.statut = 'rejete' THEN sl.montant_estime ELSE 0 END), 0) AS rejete
     FROM sinistre_lignes sl
     JOIN sinistres s ON s.id = sl.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN insurance_branch b ON b.id_branch = sl.id_branch AND b.captive_id = p.captive_id
     WHERE p.captive_id = ?
     GROUP BY sl.id_branch, b.s2_code, b.name
     ORDER BY total DESC, b.s2_code ASC, b.name ASC`,
    [captiveId]
  );

  let lineRows = [];
  if (branchId > 0) {
    const [rows] = await pool.query(
      `SELECT
         CASE
           WHEN p.ligne_risque IS NULL OR TRIM(p.ligne_risque) = '' THEN '__EMPTY__'
           ELSE p.ligne_risque
         END AS ligne_key,
         CASE
           WHEN p.ligne_risque IS NULL OR TRIM(p.ligne_risque) = '' THEN 'Ligne non renseignée'
           ELSE p.ligne_risque
         END AS ligne_label,
         COALESCE(SUM(sl.montant_estime), 0) AS total,
         COALESCE(SUM(CASE WHEN s.statut = 'ouvert' THEN sl.montant_estime ELSE 0 END), 0) AS ouvert,
         COALESCE(SUM(CASE WHEN s.statut = 'en_cours' THEN sl.montant_estime ELSE 0 END), 0) AS en_cours,
         COALESCE(SUM(CASE WHEN s.statut = 'clos' THEN sl.montant_estime ELSE 0 END), 0) AS clos,
         COALESCE(SUM(CASE WHEN s.statut = 'rejete' THEN sl.montant_estime ELSE 0 END), 0) AS rejete
       FROM sinistre_lignes sl
       JOIN sinistres s ON s.id = sl.sinistre_id
       JOIN programmes p ON p.id = s.programme_id
       WHERE p.captive_id = ? AND sl.id_branch = ?
       GROUP BY ligne_key, ligne_label
       ORDER BY total DESC, ligne_label ASC`,
      [captiveId, branchId]
    );
    lineRows = rows;
  }

  const mapStats = (row) => ({
    ...row,
    total: Number(row.total || 0),
    ouvert: Number(row.ouvert || 0),
    en_cours: Number(row.en_cours || 0),
    clos: Number(row.clos || 0),
    rejete: Number(row.rejete || 0),
  });

  res.json({
    selected_branch: branchId > 0 ? branchId : null,
    branches: branchRows.map(mapStats),
    lines: lineRows.map(mapStats),
  });
});

router.get("/stats/reglements-cumul", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const year = Math.max(2000, Math.min(2100, Number(req.query.year) || new Date().getUTCFullYear()));

  const [estimatedRows] = await pool.query(
    `SELECT DATE_FORMAT(COALESCE(s.date_decl, s.date_survenue), '%Y-%m') AS ym,
            COALESCE(SUM(s.montant_estime), 0) AS estimated_amount
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     WHERE p.captive_id = ?
       AND COALESCE(s.date_decl, s.date_survenue) IS NOT NULL
       AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(COALESCE(s.date_decl, s.date_survenue), '%Y-%m')
     ORDER BY ym ASC`,
    [captiveId, `${year}-01-01`, `${year}-12-31`]
  );

  const [paidRows] = await pool.query(
    `SELECT DATE_FORMAT(r.date, '%Y-%m') AS ym,
            COALESCE(SUM(r.montant), 0) AS paid_amount
     FROM reglements r
     JOIN sinistres s ON s.id = r.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     WHERE p.captive_id = ?
       AND r.date IS NOT NULL
       AND r.date BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(r.date, '%Y-%m')
     ORDER BY ym ASC`,
    [captiveId, `${year}-01-01`, `${year}-12-31`]
  );

  const [statusRows] = await pool.query(
    `SELECT DATE_FORMAT(COALESCE(s.date_decl, s.date_survenue), '%Y-%m') AS ym,
            s.statut,
            COALESCE(SUM(s.montant_estime), 0) AS estimated_amount
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     WHERE p.captive_id = ?
       AND COALESCE(s.date_decl, s.date_survenue) IS NOT NULL
       AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(COALESCE(s.date_decl, s.date_survenue), '%Y-%m'), s.statut
     ORDER BY ym ASC`,
    [captiveId, `${year}-01-01`, `${year}-12-31`]
  );

  const estimatedByMonth = new Map(estimatedRows.map((r) => [String(r.ym), Number(r.estimated_amount || 0)]));
  const paidByMonth = new Map(paidRows.map((r) => [String(r.ym), Number(r.paid_amount || 0)]));
  const statusByMonth = new Map();
  for (const row of statusRows) {
    const ym = String(row.ym);
    const statut = String(row.statut || "");
    if (!statusByMonth.has(ym)) {
      statusByMonth.set(ym, { ouvert: 0, en_cours: 0, clos: 0, rejete: 0 });
    }
    const bucket = statusByMonth.get(ym);
    if (Object.prototype.hasOwnProperty.call(bucket, statut)) {
      bucket[statut] += Number(row.estimated_amount || 0);
    }
  }

  const months = [];
  let cumulativeEstimated = 0;
  let cumulativePaid = 0;
  let cumulativeOpen = 0;
  let cumulativeInProgress = 0;
  let cumulativeClosed = 0;
  let cumulativeRejected = 0;
  for (let m = 1; m <= 12; m += 1) {
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    const estimatedAmount = Number(estimatedByMonth.get(ym) || 0);
    const paidAmount = Number(paidByMonth.get(ym) || 0);
    const status = statusByMonth.get(ym) || { ouvert: 0, en_cours: 0, clos: 0, rejete: 0 };
    cumulativeEstimated += estimatedAmount;
    cumulativePaid += paidAmount;
    cumulativeOpen += Number(status.ouvert || 0);
    cumulativeInProgress += Number(status.en_cours || 0);
    cumulativeClosed += Number(status.clos || 0);
    cumulativeRejected += Number(status.rejete || 0);
    months.push({
      month: ym,
      label: new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("fr-FR", { month: "short" }),
      estimated_amount: Number(estimatedAmount.toFixed(2)),
      paid_amount: Number(paidAmount.toFixed(2)),
      cumulative_estimated: Number(cumulativeEstimated.toFixed(2)),
      cumulative_paid: Number(cumulativePaid.toFixed(2)),
      cumulative_estimated_open: Number(cumulativeOpen.toFixed(2)),
      cumulative_estimated_en_cours: Number(cumulativeInProgress.toFixed(2)),
      cumulative_estimated_clos: Number(cumulativeClosed.toFixed(2)),
      cumulative_estimated_rejete: Number(cumulativeRejected.toFixed(2)),
    });
  }

  res.json({
    year,
    totals: {
      estimated: Number(cumulativeEstimated.toFixed(2)),
      paid: Number(cumulativePaid.toFixed(2)),
    },
    months,
  });
});

router.post(
  "/",
  authRequired,
  requireRole(...canManage),
  validate(sinistreCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    const {
      programme_id,
      partner_id,
      client_id,
      date_survenue,
      date_decl,
      statut,
      montant_estime,
      montant_paye,
      devise,
      description,
    } = req.body;
    const programme = await getProgrammeInScope(programme_id, captiveId);
    if (!programme) {
      return res.status(403).json({ error: "forbidden_scope" });
    }
    const [partner, client] = await Promise.all([
      getPartnerById(partner_id),
      getClientById(client_id),
    ]);
    if (!partner) return res.status(404).json({ error: "partner_not_found" });
    if (!client) return res.status(404).json({ error: "client_not_found" });
    if (!client.partner_id || Number(client.partner_id) !== Number(partner_id)) {
      return res.status(400).json({ error: "client_partner_mismatch" });
    }
    if (!(await hasContractForClientPartnerProgramme(client_id, partner_id, programme_id))) {
      return res.status(400).json({ error: "client_partner_programme_contract_missing" });
    }
    const autoDetermineFranchise = isAutoFranchiseLine(programme.ligne_risque);
    const programmeFranchise = Number(programme.franchise || 0);

    let lignes = Array.isArray(req.body.lignes) ? req.body.lignes : [];
    if (!lignes.length) {
      const defaultBranchId = await getDefaultBranchForProgramme(programme_id, captiveId);
      if (!defaultBranchId) {
        return res.status(400).json({ error: "missing_branch_ventilation" });
      }
      lignes = [
        {
          id_branch: defaultBranchId,
          statut,
          montant_estime,
          montant_paye,
          montant_recours: 0,
          montant_franchise: resolveLineFranchise(0, programmeFranchise, autoDetermineFranchise),
          description,
        },
      ];
    }

    const branchCheck = await ensureDistinctAndScopedBranches(lignes, captiveId);
    if (!branchCheck.ok) return res.status(400).json({ error: branchCheck.error });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        `INSERT INTO sinistres(programme_id, partner_id, client_id, date_survenue, date_decl, statut, montant_estime, montant_paye, devise, description)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          programme_id,
          partner_id,
          client_id,
          date_survenue,
          date_decl,
          statut,
          montant_estime,
          montant_paye,
          devise,
          description,
        ]
      );
      for (const ligne of lignes) {
        const resolvedFranchise = resolveLineFranchise(
          ligne.montant_franchise,
          programmeFranchise,
          autoDetermineFranchise
        );
        await conn.query(
          `INSERT INTO sinistre_lignes(sinistre_id, id_branch, statut, montant_estime, montant_paye, montant_recours, montant_franchise, description)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            r.insertId,
            ligne.id_branch,
            ligne.statut,
            ligne.montant_estime,
            ligne.montant_paye,
            ligne.montant_recours,
            resolvedFranchise,
            ligne.description || null,
          ]
        );
      }
      await recomputeSinistreFromLines(r.insertId, conn);
      const sinistre = await getSinistreInScope(r.insertId, captiveId, conn);
      const sinistreLignes = await listSinistreLignes(r.insertId, captiveId, conn);
      await conn.commit();
      await logAudit(req.user?.id, "sinistre", r.insertId, "create", req.body);
      return res.status(201).json({ ...sinistre, lignes: sinistreLignes });
    } catch (err) {
      await conn.rollback();
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "duplicate_branch_in_ventilation" });
      }
      throw err;
    } finally {
      conn.release();
    }
  }
);

router.get("/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const sinistre = await getSinistreInScope(req.params.id, captiveId);
  if (!sinistre) return res.status(404).json({ error: "sinistre_not_found" });
  const lignes = await listSinistreLignes(req.params.id, captiveId);
  res.json({ ...sinistre, lignes });
});

router.patch(
  "/:id",
  authRequired,
  requireRole(...canManage),
  validate(sinistrePatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    const fields = [
      "programme_id",
      "date_survenue",
      "date_decl",
      "statut",
      "montant_estime",
      "montant_paye",
      "devise",
      "description",
    ];
    const sets = [];
    const values = [];
    if (req.body.programme_id !== undefined) {
      if (!(await hasProgrammeInScope(req.body.programme_id, captiveId))) {
        return res.status(403).json({ error: "forbidden_scope" });
      }
    }
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(req.params.id, captiveId);
    const [upd] = await pool.query(
      `UPDATE sinistres s
       JOIN programmes p ON p.id = s.programme_id
       SET ${sets.join(", ")}
       WHERE s.id = ? AND p.captive_id = ?`,
      values
    );
    if (!upd.affectedRows) return res.status(404).json({ error: "sinistre_not_found" });
    const sinistre = await getSinistreInScope(req.params.id, captiveId);
    const lignes = await listSinistreLignes(req.params.id, captiveId);
    await logAudit(req.user?.id, "sinistre", Number(req.params.id), "update", req.body);
    res.json({ ...sinistre, lignes });
  }
);

router.get("/:id/lignes", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const sinistre = await getSinistreInScope(req.params.id, captiveId);
  if (!sinistre) return res.status(404).json({ error: "sinistre_not_found" });
  const lignes = await listSinistreLignes(req.params.id, captiveId);
  res.json(lignes);
});

router.post(
  "/:id/lignes",
  authRequired,
  requireRole(...canManage),
  validate(sinistreLigneCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    const sinistreId = Number(req.params.id);
    const sinistre = await getSinistreInScope(sinistreId, captiveId);
    if (!sinistre) return res.status(404).json({ error: "sinistre_not_found" });
    if (!(await hasBranchInScope(req.body.id_branch, captiveId))) {
      return res.status(400).json({ error: "branch_not_in_scope" });
    }
    const autoDetermineFranchise = isAutoFranchiseLine(sinistre.ligne_risque);
    const resolvedFranchise = resolveLineFranchise(
      req.body.montant_franchise,
      sinistre.programme_franchise,
      autoDetermineFranchise
    );
    try {
      const [r] = await pool.query(
        `INSERT INTO sinistre_lignes(sinistre_id, id_branch, statut, montant_estime, montant_paye, montant_recours, montant_franchise, description)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          sinistreId,
          req.body.id_branch,
          req.body.statut,
          req.body.montant_estime,
          req.body.montant_paye,
          req.body.montant_recours,
          resolvedFranchise,
          req.body.description || null,
        ]
      );
      await recomputeSinistreFromLines(sinistreId);
      const [rows] = await pool.query(
        `SELECT sl.*, b.s2_code AS branch_s2_code, b.name AS branch_name
         FROM sinistre_lignes sl
         LEFT JOIN insurance_branch b ON b.id_branch = sl.id_branch
         WHERE sl.id = ?
         LIMIT 1`,
        [r.insertId]
      );
      await logAudit(req.user?.id, "sinistre_ligne", r.insertId, "create", { sinistre_id: sinistreId, ...req.body });
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "line_branch_exists" });
      }
      throw err;
    }
  }
);

router.patch(
  "/:id/lignes/:lineId",
  authRequired,
  requireRole(...canManage),
  validate(sinistreLignePatch),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    const sinistreId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const sinistre = await getSinistreInScope(sinistreId, captiveId);
    if (!sinistre) return res.status(404).json({ error: "sinistre_not_found" });
    if (req.body.id_branch !== undefined && !(await hasBranchInScope(req.body.id_branch, captiveId))) {
      return res.status(400).json({ error: "branch_not_in_scope" });
    }
    if (req.body.statut !== undefined) {
      const [[lineRow]] = await pool.query(
        `SELECT sl.statut
         FROM sinistre_lignes sl
         JOIN sinistres s ON s.id = sl.sinistre_id
         JOIN programmes p ON p.id = s.programme_id
         WHERE sl.id = ? AND sl.sinistre_id = ? AND p.captive_id = ?
         LIMIT 1`,
        [lineId, sinistreId, captiveId]
      );
      if (!lineRow) return res.status(404).json({ error: "sinistre_line_not_found" });
      const currentStatus = String(lineRow.statut || "");
      const nextStatus = String(req.body.statut || "");
      if (!canAdvanceLineStatus(currentStatus, nextStatus)) {
        return res.status(400).json({ error: "line_status_regression_not_allowed" });
      }
    }
    if (req.body.montant_franchise !== undefined && isAutoFranchiseLine(sinistre.ligne_risque)) {
      req.body.montant_franchise = resolveLineFranchise(
        req.body.montant_franchise,
        sinistre.programme_franchise,
        true
      );
    }
    const fields = [
      "id_branch",
      "statut",
      "montant_estime",
      "montant_paye",
      "montant_recours",
      "montant_franchise",
      "description",
    ];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`sl.${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(lineId, sinistreId, captiveId);
    try {
      const [upd] = await pool.query(
        `UPDATE sinistre_lignes sl
         JOIN sinistres s ON s.id = sl.sinistre_id
         JOIN programmes p ON p.id = s.programme_id
         SET ${sets.join(", ")}
         WHERE sl.id = ? AND sl.sinistre_id = ? AND p.captive_id = ?`,
        values
      );
      if (!upd.affectedRows) return res.status(404).json({ error: "sinistre_line_not_found" });
      await recomputeSinistreFromLines(sinistreId);
      const [rows] = await pool.query(
        `SELECT sl.*, b.s2_code AS branch_s2_code, b.name AS branch_name
         FROM sinistre_lignes sl
         LEFT JOIN insurance_branch b ON b.id_branch = sl.id_branch
         WHERE sl.id = ?
         LIMIT 1`,
        [lineId]
      );
      await logAudit(req.user?.id, "sinistre_ligne", lineId, "update", req.body);
      return res.json(rows[0]);
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "line_branch_exists" });
      }
      throw err;
    }
  }
);

router.delete("/:id/lignes/:lineId", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const sinistreId = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const sinistre = await getSinistreInScope(sinistreId, captiveId);
  if (!sinistre) return res.status(404).json({ error: "sinistre_not_found" });
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM sinistre_lignes sl
     JOIN sinistres s ON s.id = sl.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     WHERE sl.sinistre_id = ? AND p.captive_id = ?`,
    [sinistreId, captiveId]
  );
  const totalLines = Number(countRows[0]?.total || 0);
  if (totalLines <= 1) {
    return res.status(400).json({ error: "cannot_delete_last_line" });
  }
  const [regCountRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM reglements r
     JOIN sinistres s ON s.id = r.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     WHERE r.sinistre_ligne_id = ? AND s.id = ? AND p.captive_id = ?`,
    [lineId, sinistreId, captiveId]
  );
  if (Number(regCountRows[0]?.total || 0) > 0) {
    return res.status(400).json({ error: "line_has_reglements" });
  }
  const [del] = await pool.query(
    `DELETE sl
     FROM sinistre_lignes sl
     JOIN sinistres s ON s.id = sl.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     WHERE sl.id = ? AND sl.sinistre_id = ? AND p.captive_id = ?`,
    [lineId, sinistreId, captiveId]
  );
  if (!del.affectedRows) return res.status(404).json({ error: "sinistre_line_not_found" });
  await recomputeSinistreFromLines(sinistreId);
  await logAudit(req.user?.id, "sinistre_ligne", lineId, "delete", { sinistre_id: sinistreId });
  res.json({ ok: true });
});

router.post(
  "/:id/reglements",
  authRequired,
  requireRole(...canManage),
  validate(reglementCreate),
  async (req, res) => {
    const captiveId = getCaptiveId(req);
    const { date, montant } = req.body;
    const montantValue = Number(montant || 0);
    const sinistreId = Number(req.params.id);
    const sinistre = await getSinistreInScope(sinistreId, captiveId);
    if (!sinistre) return res.status(404).json({ error: "sinistre_not_found" });

    let sinistreLigneId = Number(req.body.sinistre_ligne_id || 0);
    if (sinistreLigneId > 0) {
      const [rows] = await pool.query(
        `SELECT sl.id
         FROM sinistre_lignes sl
         JOIN sinistres s ON s.id = sl.sinistre_id
         JOIN programmes p ON p.id = s.programme_id
         WHERE sl.id = ? AND sl.sinistre_id = ? AND p.captive_id = ?
         LIMIT 1`,
        [sinistreLigneId, sinistreId, captiveId]
      );
      if (!rows.length) return res.status(404).json({ error: "sinistre_line_not_found" });
    } else {
      const lines = await listSinistreLignes(sinistreId, captiveId);
      if (!lines.length) return res.status(400).json({ error: "sinistre_line_missing" });
      if (lines.length > 1) return res.status(400).json({ error: "reglement_line_required" });
      sinistreLigneId = Number(lines[0].id);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`SELECT id FROM sinistres WHERE id = ? LIMIT 1 FOR UPDATE`, [sinistreId]);
      const capacity = await getReglementCapacity(sinistreId, conn, {
        forUpdate: true,
        programmeFranchise: sinistre.programme_franchise,
      });
      if (capacity.remaining <= AMOUNT_EPSILON) {
        await conn.rollback();
        return res.status(400).json({
          error: "reglement_limit_reached",
          max_payable: capacity.maxPayable,
          already_paid: capacity.totalRegle,
          remaining: 0,
        });
      }
      if (montantValue > capacity.remaining + AMOUNT_EPSILON) {
        await conn.rollback();
        return res.status(400).json({
          error: "reglement_limit_exceeded",
          max_payable: capacity.maxPayable,
          already_paid: capacity.totalRegle,
          remaining: capacity.remaining,
        });
      }
      const [r] = await conn.query(
        `INSERT INTO reglements(sinistre_id, sinistre_ligne_id, date, montant) VALUES (?,?,?,?)`,
        [sinistreId, sinistreLigneId, date, montantValue]
      );
      await conn.query(
        `UPDATE sinistre_lignes
         SET montant_paye = montant_paye + ?
         WHERE id = ?`,
        [montantValue, sinistreLigneId]
      );
      await recomputeSinistreFromLines(sinistreId, conn);
      const [rows] = await conn.query(
        `SELECT r.*,
                sl.id_branch,
                b.s2_code AS branch_s2_code,
                b.name AS branch_name
         FROM reglements r
         LEFT JOIN sinistre_lignes sl ON sl.id = r.sinistre_ligne_id
         LEFT JOIN insurance_branch b ON b.id_branch = sl.id_branch
         WHERE r.id = ?
         LIMIT 1`,
        [r.insertId]
      );
      await conn.commit();
      await logAudit(req.user?.id, "reglement", r.insertId, "create", {
        sinistre_id: sinistreId,
        sinistre_ligne_id: sinistreLigneId,
        date,
        montant: montantValue,
      });
      return res.status(201).json(rows[0]);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

router.get("/:id/reglements", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const sinistreId = Number(req.params.id);
  const [rows] = await pool.query(
    `SELECT r.*,
            sl.id_branch,
            b.s2_code AS branch_s2_code,
            b.name AS branch_name
     FROM reglements r
     JOIN sinistres s ON s.id = r.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN sinistre_lignes sl ON sl.id = r.sinistre_ligne_id
     LEFT JOIN insurance_branch b ON b.id_branch = sl.id_branch
     WHERE r.sinistre_id = ? AND p.captive_id = ?
     ORDER BY r.date DESC, r.id DESC`,
    [sinistreId, captiveId]
  );
  res.json(rows);
});

export default router;
