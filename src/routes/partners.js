import { Router } from "express";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
const canManage = ["admin", "cfo", "risk_manager", "conseil"];
const DOCS_DIR = process.env.DOCS_DIR || path.resolve("storage", "docs");

const partnerStatut = z.enum(["brouillon", "en_validation", "actif", "anomalie", "gele", "supprime"]);
const conformiteStatut = z.enum(["en_attente", "ok", "anomalie"]);
const clientType = z.enum(["personne_morale", "personne_physique"]);
const contratStatut = z.enum(["brouillon", "actif", "suspendu", "resilie"]);
const correspondantType = z.enum(["commercial", "back_office"]);
const assignmentStatut = z.enum(["actif", "inactif"]);
const documentStatut = z.enum(["valide", "expire", "manquant"]);
const documentType = z.enum(["KBIS", "ID", "LCBFT", "OTHER"]);
const addressType = z.enum(["siege", "facturation", "correspondance", "autre"]);
const insurerName = z.string().trim().min(1).max(190);
const optionalAmount = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return null;
    if (typeof value === "string") return value.replace(/\s/g, "").replace(",", ".");
    return value;
  },
  z.coerce.number().nonnegative().nullable().optional()
);

const partnerCreate = z.object({
  siren: z.string().length(9),
  siret_siege: z.string().length(14).optional().nullable(),
  raison_sociale: z.string().min(1),
  statut: partnerStatut.default("brouillon"),
  code_ape: z.string().max(10).optional().nullable(),
  adresse_siege: z.string().max(255).optional().nullable(),
  date_immatriculation: z.string().optional().nullable(),
  date_maj: z.string().optional().nullable(),
  pays: z.string().length(2).default("FR"),
  region: z.string().max(80).optional().nullable(),
  conformite_statut: conformiteStatut.default("en_attente"),
  conformite_notes: z.string().optional().nullable(),
});

const partnerPatch = partnerCreate.partial();
const insurerCreate = z.object({
  name: insurerName,
});
const insurerPatch = insurerCreate.partial();

const correspondantCreate = z.object({
  type: correspondantType,
  nom: z.string().min(1),
  email: z.string().email(),
  telephone: z.string().max(40).optional().nullable(),
});

const correspondantPatch = correspondantCreate.partial();

const clientCreate = z.object({
  partner_id: z.coerce.number().int().positive(),
  external_client_ref: z.string().min(1).max(80).optional(),
  nom: z.string().min(1).max(80).optional(),
  type: clientType.default("personne_morale"),
  chiffre_affaires: optionalAmount,
  masse_salariale: optionalAmount,
});

const clientPatch = clientCreate.partial();

const contratCreate = z.object({
  partner_id: z.coerce.number().int().positive(),
  programme_id: z.coerce.number().int().positive(),
  client_id: z.coerce.number().int().positive(),
  statut: contratStatut.default("brouillon"),
  date_debut: z.string().optional().nullable(),
  date_fin: z.string().optional().nullable(),
  devise: z.string().length(3).default("EUR"),
});

const contratPatch = contratCreate.partial();
const partnerProgrammeLinkCreate = z.object({
  partner_id: z.coerce.number().int().positive(),
  programme_id: z.coerce.number().int().positive(),
});

const assignmentCreate = z.object({
  correspondant_id: z.coerce.number().int().positive(),
  role: correspondantType,
  statut: assignmentStatut.default("actif"),
  date_debut: z.string().optional().nullable(),
  date_fin: z.string().optional().nullable(),
});

const documentCreate = z.object({
  doc_type: documentType,
  file_name: z.string().min(1),
  file_path: z.string().optional().nullable(),
  file_base64: z.string().optional().nullable(),
  storage_provider: z.string().max(80).optional().nullable(),
  storage_ref: z.string().max(255).optional().nullable(),
  status: documentStatut.default("valide"),
  expiry_date: z.string().optional().nullable(),
  metadata: z.any().optional().nullable(),
});

const documentPatch = documentCreate.partial();

const addressCreate = z.object({
  type: addressType.default("siege"),
  ligne1: z.string().min(1),
  ligne2: z.string().optional().nullable(),
  code_postal: z.string().max(20).optional().nullable(),
  ville: z.string().max(120).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  pays: z.string().length(2).default("FR"),
  email: z.string().email().optional().nullable(),
  telephone: z.string().max(40).optional().nullable(),
});

const addressPatch = addressCreate.partial();

const mandataireRole = z.enum([
  "gerant",
  "president",
  "directeur_general",
  "administrateur",
  "mandataire_social",
  "autre",
]);
const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/);

const mandataireCreate = z.object({
  nom: z.string().min(1),
  prenom: z.string().optional().nullable(),
  role: mandataireRole,
  email: z.string().email(),
  telephone: e164,
  date_debut: z.string().min(1),
  date_fin: z.string().optional().nullable(),
});

const mandatairePatch = mandataireCreate.partial();

async function ensurePartnerExists(partnerId) {
  const [rows] = await pool.query(`SELECT id, statut FROM partners WHERE id = ?`, [partnerId]);
  if (!rows.length) return null;
  return rows[0];
}

async function ensureProgrammeActif(programmeId) {
  const [rows] = await pool.query(
    `SELECT id, statut FROM programmes WHERE id = ?`,
    [programmeId]
  );
  if (!rows.length) return null;
  return rows[0];
}

async function hasPartnerProgrammeLink(partnerId, programmeId) {
  const [[row]] = await pool.query(
    `SELECT 1 as ok
     FROM partner_programme
     WHERE partner_id = ?
       AND programme_id = ?
       AND is_active = 1
     LIMIT 1`,
    [partnerId, programmeId]
  );
  return !!row;
}

async function hasActiveContractDup({ partnerId, programmeId, clientId, excludeId = null }) {
  const params = [partnerId, programmeId, clientId];
  let sql = `
    SELECT COUNT(*) as cnt
    FROM contracts
    WHERE partner_id = ?
      AND programme_id = ?
      AND client_id = ?
      AND statut = 'actif'
  `;
  if (excludeId) {
    sql += " AND id <> ?";
    params.push(excludeId);
  }
  const [[row]] = await pool.query(sql, params);
  return (row?.cnt || 0) > 0;
}

async function hasActiveCorrespondantRole(partnerId, role) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM partner_correspondant
     WHERE partner_id = ?
       AND role = ?
       AND statut = 'actif'`,
    [partnerId, role]
  );
  return (row?.cnt || 0) > 0;
}

function normalizeJson(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

router.get("/", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  const asCsv = req.query.format === "csv";
  const csvAll = req.query.all === "1";
  const sortBy = String(req.query.sort_by || "").trim().toLowerCase();
  const sortDir = String(req.query.sort_dir || "").trim().toLowerCase() === "asc" ? "ASC" : "DESC";

  if (req.query.statut) {
    where.push("p.statut = ?");
    params.push(req.query.statut);
  }
  if (req.query.pays) {
    where.push("p.pays = ?");
    params.push(req.query.pays);
  }
  if (req.query.region) {
    where.push("p.region = ?");
    params.push(req.query.region);
  }
  if (req.query.conformite_statut) {
    where.push("p.conformite_statut = ?");
    params.push(req.query.conformite_statut);
  }
  if (req.query.from) {
    where.push("p.date_maj >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push("p.date_maj <= ?");
    params.push(req.query.to);
  }
  if (req.query.programme_id) {
    where.push(
      "EXISTS (SELECT 1 FROM partner_programme pp WHERE pp.partner_id = p.id AND pp.programme_id = ?)"
    );
    params.push(req.query.programme_id);
  }
  if (req.query.commercial_id) {
    where.push(
      "EXISTS (SELECT 1 FROM partner_correspondant pc WHERE pc.partner_id = p.id AND pc.role = 'commercial' AND pc.statut = 'actif' AND pc.correspondant_id = ?)"
    );
    params.push(req.query.commercial_id);
  }
  if (req.query.back_office_id) {
    where.push(
      "EXISTS (SELECT 1 FROM partner_correspondant pc WHERE pc.partner_id = p.id AND pc.role = 'back_office' AND pc.statut = 'actif' AND pc.correspondant_id = ?)"
    );
    params.push(req.query.back_office_id);
  }
  if (req.query.q) {
    const q = `%${req.query.q}%`;
    where.push("(p.siren LIKE ? OR p.raison_sociale LIKE ?)");
    params.push(q, q);
  }

  let orderBySql = "COALESCE(p.date_maj, p.updated_at) DESC, p.id DESC";
  if (sortBy === "raison_sociale") {
    orderBySql = `p.raison_sociale ${sortDir}, p.id DESC`;
  } else if (sortBy === "siren") {
    orderBySql = `p.siren ${sortDir}, p.id DESC`;
  } else if (sortBy === "clients_contrats") {
    orderBySql = `clients_contrats ${sortDir}, p.id DESC`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [statsRows] = await pool.query(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.statut = 'actif' THEN 1 ELSE 0 END) AS actifs,
      SUM(CASE WHEN p.conformite_statut = 'anomalie' THEN 1 ELSE 0 END) AS anomalies
     FROM partners p
     ${whereSql}`,
    params
  );
  const stats = statsRows[0] || {};
  const total = Number(stats.total || 0);
  const actifs = Number(stats.actifs || 0);
  const anomalies = Number(stats.anomalies || 0);
  const [rows] = await pool.query(
    `SELECT p.*,
      (SELECT COUNT(DISTINCT pp.programme_id)
       FROM partner_programme pp
       WHERE pp.partner_id = p.id AND pp.is_active = 1) AS nb_programmes,
      (SELECT GROUP_CONCAT(DISTINCT pr.ligne_risque ORDER BY pr.ligne_risque SEPARATOR ' | ')
       FROM partner_programme pp
       JOIN programmes pr ON pr.id = pp.programme_id
       WHERE pp.partner_id = p.id AND pp.is_active = 1) AS programmes,
      (SELECT COUNT(DISTINCT c.client_id)
       FROM contracts c
       WHERE c.partner_id = p.id AND c.statut = 'actif') AS clients_contrats
     FROM partners p
     ${whereSql}
     ORDER BY ${orderBySql}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  if (asCsv) {
    const header = [
      "raison_sociale",
      "siren",
      "statut",
      "conformite_statut",
      "nb_programmes",
      "clients_contrats",
      "date_maj",
      "correspondants",
      "programmes",
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=partenaires.csv");
    res.write(header.join(",") + "\n");
    const csvLimit = csvAll ? 1000 : limit;
    let csvOffset = csvAll ? 0 : offset;
    while (true) {
      const [csvRows] = await pool.query(
        `SELECT p.*,
                COUNT(DISTINCT pp.programme_id) AS nb_programmes,
                COUNT(DISTINCT CASE WHEN ct.statut = 'actif' THEN ct.client_id END) AS clients_contrats,
                GROUP_CONCAT(DISTINCT CONCAT(c.nom,' (',pc.role,')') SEPARATOR ' | ') AS correspondants,
                GROUP_CONCAT(DISTINCT pr.ligne_risque SEPARATOR ' | ') AS programmes
         FROM partners p
         LEFT JOIN partner_correspondant pc ON pc.partner_id = p.id AND pc.statut = 'actif'
         LEFT JOIN correspondants c ON c.id = pc.correspondant_id
         LEFT JOIN partner_programme pp ON pp.partner_id = p.id AND pp.is_active = 1
         LEFT JOIN programmes pr ON pr.id = pp.programme_id
         LEFT JOIN contracts ct ON ct.partner_id = p.id
         ${whereSql}
         GROUP BY p.id
         ORDER BY ${orderBySql}
         LIMIT ? OFFSET ?`,
        [...params, csvLimit, csvOffset]
      );
      if (!csvRows.length) break;
      for (const r of csvRows) {
        const line = header
          .map((h) => {
            const val = r[h] ?? "";
            const escaped = String(val).replace(/\"/g, "\"\"");
            return `"${escaped}"`;
          })
          .join(",");
        res.write(line + "\n");
      }
      if (!csvAll) break;
      csvOffset += csvLimit;
    }
    return res.end();
  }
  return res.json({
    data: rows,
    pagination: { page, limit, total },
    stats: { total, actifs, anomalies },
  });
});

router.post("/", authRequired, requireRole(...canManage), validate(partnerCreate), async (req, res) => {
  if (req.body.siret_siege && req.body.siret_siege.slice(0, 9) !== req.body.siren) {
    return res.status(400).json({ error: "siret_siege_mismatch" });
  }
  const fields = Object.keys(partnerCreate.shape);
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = fields.map((f) => req.body[f]);
  const [r] = await pool.query(
    `INSERT INTO partners (${keys}) VALUES (${placeholders})`,
    values
  );
  const [rows] = await pool.query(`SELECT * FROM partners WHERE id = ?`, [r.insertId]);
  const created = rows[0];
  await logAudit(req.user?.id, "partner", r.insertId, "create", created);
  res.status(201).json(created);
});

router.get("/insurers", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  const sortBy = String(req.query.sort_by || "").trim().toLowerCase();
  const sortDir = String(req.query.sort_dir || "").trim().toLowerCase() === "asc" ? "ASC" : "DESC";

  if (req.query.q) {
    where.push("i.name LIKE ?");
    params.push(`%${String(req.query.q).trim()}%`);
  }

  let orderBySql = "i.created_at DESC, i.id DESC";
  if (sortBy === "name") {
    orderBySql = `i.name ${sortDir}, i.id DESC`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM insurers i ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT i.* FROM insurers i ${whereSql} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
});

router.post("/insurers", authRequired, requireRole(...canManage), validate(insurerCreate), async (req, res) => {
  try {
    const [result] = await pool.query(`INSERT INTO insurers (name) VALUES (?)`, [req.body.name]);
    const [rows] = await pool.query(`SELECT * FROM insurers WHERE id = ?`, [result.insertId]);
    const created = rows[0];
    await logAudit(req.user?.id, "insurer", result.insertId, "create", created);
    res.status(201).json(created);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "insurer_name_exists" });
    }
    throw err;
  }
});

router.patch("/insurers/:id", authRequired, requireRole(...canManage), validate(insurerPatch), async (req, res) => {
  if (req.body.name === undefined) return res.status(400).json({ error: "no_fields" });
  try {
    const [upd] = await pool.query(`UPDATE insurers SET name = ? WHERE id = ?`, [req.body.name, req.params.id]);
    if (!upd.affectedRows) return res.status(404).json({ error: "not_found" });
    const [rows] = await pool.query(`SELECT * FROM insurers WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const updated = rows[0];
    await logAudit(req.user?.id, "insurer", Number(req.params.id), "update", updated);
    res.json(updated);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "insurer_name_exists" });
    }
    throw err;
  }
});

router.delete("/insurers/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM insurers WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.query(`DELETE FROM insurers WHERE id = ?`, [req.params.id]);
  await logAudit(req.user?.id, "insurer", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/correspondants", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  if (req.query.type) {
    where.push("type = ?");
    params.push(req.query.type);
  }
  if (req.query.q) {
    const q = `%${req.query.q}%`;
    where.push("(nom LIKE ? OR email LIKE ?)");
    params.push(q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM correspondants ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT * FROM correspondants ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
});

router.post("/correspondants", authRequired, requireRole(...canManage), validate(correspondantCreate), async (req, res) => {
  const fields = Object.keys(correspondantCreate.shape);
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = fields.map((f) => req.body[f]);
  const [r] = await pool.query(
    `INSERT INTO correspondants (${keys}) VALUES (${placeholders})`,
    values
  );
  const [rows] = await pool.query(`SELECT * FROM correspondants WHERE id = ?`, [r.insertId]);
  const created = rows[0];
  await logAudit(req.user?.id, "correspondant", r.insertId, "create", created);
  res.status(201).json(created);
});

router.patch("/correspondants/:id", authRequired, requireRole(...canManage), validate(correspondantPatch), async (req, res) => {
  const fields = Object.keys(correspondantCreate.shape);
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
  await pool.query(`UPDATE correspondants SET ${sets.join(", ")} WHERE id = ?`, values);
  const [rows] = await pool.query(`SELECT * FROM correspondants WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const updated = rows[0];
  await logAudit(req.user?.id, "correspondant", Number(req.params.id), "update", updated);
  res.json(updated);
});

router.delete("/correspondants/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM correspondants WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.query(`DELETE FROM correspondants WHERE id = ?`, [req.params.id]);
  await logAudit(req.user?.id, "correspondant", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/clients", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  const sortBy = String(req.query.sort_by || "").trim().toLowerCase();
  const sortDir = String(req.query.sort_dir || "").trim().toLowerCase() === "asc" ? "ASC" : "DESC";
  if (req.query.partner_id) {
    where.push("c.partner_id = ?");
    params.push(req.query.partner_id);
  }
  if (req.query.partner_q) {
    const partnerQ = `%${String(req.query.partner_q).trim()}%`;
    where.push("(p.raison_sociale LIKE ? OR p.siren LIKE ?)");
    params.push(partnerQ, partnerQ);
  }
  if (req.query.type) {
    where.push("c.type = ?");
    params.push(req.query.type);
  }
  if (req.query.q) {
    const q = `%${req.query.q}%`;
    where.push("c.external_client_ref LIKE ?");
    params.push(q);
  }
  if (String(req.query.with_contracts || "") === "1") {
    where.push(
      "EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id AND ct.partner_id = c.partner_id)"
    );
  }

  let orderBySql = "c.created_at DESC";
  if (sortBy === "nom") {
    orderBySql = `c.external_client_ref ${sortDir}, c.id DESC`;
  } else if (sortBy === "partner") {
    orderBySql = `COALESCE(p.raison_sociale, '') ${sortDir}, c.id DESC`;
  } else if (sortBy === "chiffre_affaires") {
    orderBySql = `COALESCE(c.chiffre_affaires, 0) ${sortDir}, c.id DESC`;
  } else if (sortBy === "masse_salariale") {
    orderBySql = `COALESCE(c.masse_salariale, 0) ${sortDir}, c.id DESC`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total
     FROM clients c
     LEFT JOIN partners p ON p.id = c.partner_id
     ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [statsRows] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN c.type = 'personne_morale' THEN 1 ELSE 0 END) AS personnes_morales,
       SUM(CASE WHEN c.type = 'personne_physique' THEN 1 ELSE 0 END) AS personnes_physiques,
       SUM(CASE WHEN c.partner_id IS NOT NULL THEN 1 ELSE 0 END) AS rattaches
     FROM clients c
     LEFT JOIN partners p ON p.id = c.partner_id
     ${whereSql}`,
    params
  );
  const stats = statsRows[0] || {};
  const [rows] = await pool.query(
    `SELECT c.*, c.external_client_ref AS nom, p.raison_sociale AS partner_name, p.siren AS partner_siren
     FROM clients c
     LEFT JOIN partners p ON p.id = c.partner_id
     ${whereSql}
     ORDER BY ${orderBySql}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalStats = Number(stats.total || 0);
  const personnesMorales = Number(stats.personnes_morales || 0);
  const personnesPhysiques = Number(stats.personnes_physiques || 0);
  const rattaches = Number(stats.rattaches || 0);
  res.json({
    data: rows,
    pagination: { page, limit, total },
    stats: {
      total: totalStats,
      personnes_morales: personnesMorales,
      personnes_physiques: personnesPhysiques,
      rattaches,
      taux_rattachement: totalStats ? (rattaches / totalStats) * 100 : 0,
    },
  });
});

router.post("/clients", authRequired, requireRole(...canManage), validate(clientCreate), async (req, res) => {
  const partner = await ensurePartnerExists(req.body.partner_id);
  if (!partner) return res.status(404).json({ error: "partner_not_found" });
  const externalClientRef = String(req.body.external_client_ref ?? req.body.nom ?? "").trim();
  if (!externalClientRef) return res.status(400).json({ error: "external_client_ref_required" });
  const fields = ["partner_id", "external_client_ref", "type", "chiffre_affaires", "masse_salariale"];
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = [
    req.body.partner_id,
    externalClientRef,
    req.body.type,
    req.body.chiffre_affaires ?? null,
    req.body.masse_salariale ?? null,
  ];
  const [r] = await pool.query(
    `INSERT INTO clients (${keys}) VALUES (${placeholders})`,
    values
  );
  const [rows] = await pool.query(`SELECT *, external_client_ref AS nom FROM clients WHERE id = ?`, [r.insertId]);
  const created = rows[0];
  await logAudit(req.user?.id, "client", r.insertId, "create", created);
  res.status(201).json(created);
});

router.patch("/clients/:id", authRequired, requireRole(...canManage), validate(clientPatch), async (req, res) => {
  if (req.body.partner_id !== undefined) {
    const partner = await ensurePartnerExists(req.body.partner_id);
    if (!partner) return res.status(404).json({ error: "partner_not_found" });
  }
  if (req.body.external_client_ref !== undefined || req.body.nom !== undefined) {
    const v = String(req.body.external_client_ref ?? req.body.nom ?? "").trim();
    if (!v) return res.status(400).json({ error: "external_client_ref_required" });
    req.body.external_client_ref = v;
  }
  const fields = ["partner_id", "external_client_ref", "type", "chiffre_affaires", "masse_salariale"];
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
  await pool.query(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`, values);
  const [rows] = await pool.query(`SELECT *, external_client_ref AS nom FROM clients WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const updated = rows[0];
  await logAudit(req.user?.id, "client", Number(req.params.id), "update", updated);
  res.json(updated);
});

router.delete("/clients/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM clients WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.query(`DELETE FROM clients WHERE id = ?`, [req.params.id]);
  await logAudit(req.user?.id, "client", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/contracts", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  const partnerQ = String(req.query.partner_q || "").trim();
  const clientQ = String(req.query.client_q || "").trim();
  const s2Code = String(req.query.s2_code || "").trim().toUpperCase();
  const ligneQ = String(req.query.ligne || "").trim();
  if (req.query.partner_id) {
    where.push("ct.partner_id = ?");
    params.push(req.query.partner_id);
  }
  if (req.query.programme_id) {
    where.push("ct.programme_id = ?");
    params.push(req.query.programme_id);
  }
  if (req.query.client_id) {
    where.push("ct.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.statut) {
    where.push("ct.statut = ?");
    params.push(req.query.statut);
  }
  if (req.query.from) {
    where.push("ct.date_debut >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push("ct.date_fin <= ?");
    params.push(req.query.to);
  }
  if (partnerQ) {
    where.push("(p.raison_sociale LIKE ? OR p.siren LIKE ? OR CAST(ct.partner_id AS CHAR) LIKE ?)");
    params.push(`%${partnerQ}%`, `%${partnerQ}%`, `%${partnerQ}%`);
  }
  if (clientQ) {
    where.push("(c.external_client_ref LIKE ? OR CAST(ct.client_id AS CHAR) LIKE ?)");
    params.push(`%${clientQ}%`, `%${clientQ}%`);
  }
  if (s2Code) {
    where.push("UPPER(COALESCE(pr.branch_s2_code, '')) LIKE ?");
    params.push(`%${s2Code}%`);
  }
  if (ligneQ) {
    where.push("pr.ligne_risque LIKE ?");
    params.push(`%${ligneQ}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total
     FROM contracts ct
     LEFT JOIN partners p ON p.id = ct.partner_id
     LEFT JOIN clients c ON c.id = ct.client_id
     LEFT JOIN programmes pr ON pr.id = ct.programme_id
     ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT
       ct.*,
       p.raison_sociale AS partner_name,
       p.siren AS partner_siren,
       c.external_client_ref AS client_nom,
       c.chiffre_affaires AS client_chiffre_affaires,
       c.masse_salariale AS client_masse_salariale,
       pr.ligne_risque,
       pr.branch_s2_code,
       ib.name AS branch_name
     FROM contracts ct
     LEFT JOIN partners p ON p.id = ct.partner_id
     LEFT JOIN clients c ON c.id = ct.client_id
     LEFT JOIN programmes pr ON pr.id = ct.programme_id
     LEFT JOIN insurance_branch ib ON ib.s2_code = pr.branch_s2_code
     ${whereSql}
     ORDER BY ct.created_at DESC, ct.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
});

router.get("/contracts/:id/details", authRequired, requireRole(...canManage), async (req, res) => {
  const contractId = Number(req.params.id || 0);
  if (!contractId) return res.status(400).json({ error: "contract_id_invalid" });

  const [[contract]] = await pool.query(
    `SELECT
       ct.*,
       p.raison_sociale AS partner_name,
       p.siren AS partner_siren,
       c.external_client_ref AS client_nom,
       c.chiffre_affaires AS client_chiffre_affaires,
       c.masse_salariale AS client_masse_salariale,
       pr.ligne_risque,
       pr.branch_s2_code,
       ib.name AS branch_name
     FROM contracts ct
     LEFT JOIN partners p ON p.id = ct.partner_id
     LEFT JOIN clients c ON c.id = ct.client_id
     LEFT JOIN programmes pr ON pr.id = ct.programme_id
     LEFT JOIN insurance_branch ib ON ib.s2_code = pr.branch_s2_code
     WHERE ct.id = ?
     LIMIT 1`,
    [contractId]
  );
  if (!contract) return res.status(404).json({ error: "not_found" });

  const programmeId = Number(contract.programme_id || 0);
  const [premiumTerms] = await pool.query(
    `SELECT id, frequency, amount, currency, start_date, end_date, created_at, updated_at
     FROM contract_premium_terms
     WHERE contract_id = ?
     ORDER BY id DESC`,
    [contractId]
  );
  const [premiumPayments] = await pool.query(
    `SELECT id, paid_on, amount, currency, reference, notes, created_at
     FROM contract_premium_payments
     WHERE contract_id = ?
     ORDER BY paid_on DESC, id DESC
     LIMIT 50`,
    [contractId]
  );
  const [[premiumSummary]] = await pool.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS total_paid,
       COUNT(*) AS payments_count,
       MAX(paid_on) AS last_paid_on
     FROM contract_premium_payments
     WHERE contract_id = ?`,
    [contractId]
  );

  let programmeDetails = {
    coverages: [],
    deductibles: [],
    exclusions: [],
    conditions: [],
    pricing: [],
  };
  if (programmeId > 0) {
    const [coverages] = await pool.query(
      `SELECT id_coverage, label, coverage_type, limit_per_claim, limit_annual, currency
       FROM programme_coverages
       WHERE programme_id = ?
       ORDER BY created_at DESC, id_coverage DESC`,
      [programmeId]
    );
    const [deductibles] = await pool.query(
      `SELECT amount, unit, currency, notes
       FROM programme_deductibles
       WHERE programme_id = ?
       ORDER BY created_at DESC, id_deductible DESC`,
      [programmeId]
    );
    const [exclusions] = await pool.query(
      `SELECT category, description
       FROM programme_exclusions
       WHERE programme_id = ?
       ORDER BY created_at DESC, id_exclusion DESC`,
      [programmeId]
    );
    const [conditions] = await pool.query(
      `SELECT title, content
       FROM programme_conditions
       WHERE programme_id = ?
       ORDER BY created_at DESC, id_condition DESC`,
      [programmeId]
    );
    const [pricing] = await pool.query(
      `SELECT pricing_method, premium_amount, rate_value, minimum_premium, currency, effective_from, effective_to, notes
       FROM programme_pricing
       WHERE programme_id = ?
       ORDER BY created_at DESC, id_pricing DESC`,
      [programmeId]
    );
    programmeDetails = { coverages, deductibles, exclusions, conditions, pricing };
  }

  res.json({
    contract,
    premiums: {
      terms: premiumTerms,
      payments: premiumPayments,
      summary: {
        total_paid: Number(premiumSummary?.total_paid || 0),
        payments_count: Number(premiumSummary?.payments_count || 0),
        last_paid_on: premiumSummary?.last_paid_on || null,
      },
    },
    programme: programmeDetails,
  });
});

router.post("/contracts", authRequired, requireRole(...canManage), validate(contratCreate), async (req, res) => {
  const partner = await ensurePartnerExists(req.body.partner_id);
  if (!partner) return res.status(404).json({ error: "partner_not_found" });
  if (partner.statut !== "actif") return res.status(400).json({ error: "partner_not_active" });
  const programme = await ensureProgrammeActif(req.body.programme_id);
  if (!programme) return res.status(404).json({ error: "programme_not_found" });
  if (programme.statut !== "actif") return res.status(400).json({ error: "programme_not_active" });
  const linked = await hasPartnerProgrammeLink(req.body.partner_id, req.body.programme_id);
  if (!linked) return res.status(400).json({ error: "partner_programme_not_linked" });
  const [clients] = await pool.query(`SELECT id FROM clients WHERE id = ?`, [req.body.client_id]);
  if (!clients.length) return res.status(404).json({ error: "client_not_found" });
  if (req.body.statut === "actif") {
    const dup = await hasActiveContractDup({
      partnerId: req.body.partner_id,
      programmeId: req.body.programme_id,
      clientId: req.body.client_id,
    });
    if (dup) return res.status(409).json({ error: "active_contract_duplicate" });
  }
  const fields = Object.keys(contratCreate.shape);
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = fields.map((f) => req.body[f]);
  const [r] = await pool.query(
    `INSERT INTO contracts (${keys}) VALUES (${placeholders})`,
    values
  );
  const [rows] = await pool.query(`SELECT * FROM contracts WHERE id = ?`, [r.insertId]);
  const created = rows[0];
  await logAudit(req.user?.id, "contract", r.insertId, "create", created);
  res.status(201).json(created);
});

router.patch("/contracts/:id", authRequired, requireRole(...canManage), validate(contratPatch), async (req, res) => {
  const [currentRows] = await pool.query(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]);
  if (!currentRows.length) return res.status(404).json({ error: "not_found" });
  const current = currentRows[0];
  const next = {
    partner_id: req.body.partner_id ?? current.partner_id,
    programme_id: req.body.programme_id ?? current.programme_id,
    client_id: req.body.client_id ?? current.client_id,
    statut: req.body.statut ?? current.statut,
  };
  const linked = await hasPartnerProgrammeLink(next.partner_id, next.programme_id);
  if (!linked) return res.status(400).json({ error: "partner_programme_not_linked" });
  if (next.statut === "actif") {
    const dup = await hasActiveContractDup({
      partnerId: next.partner_id,
      programmeId: next.programme_id,
      clientId: next.client_id,
      excludeId: Number(req.params.id),
    });
    if (dup) return res.status(409).json({ error: "active_contract_duplicate" });
  }
  const fields = Object.keys(contratCreate.shape);
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
  await pool.query(`UPDATE contracts SET ${sets.join(", ")} WHERE id = ?`, values);
  const [rows] = await pool.query(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const updated = rows[0];
  await logAudit(req.user?.id, "contract", Number(req.params.id), "update", updated);
  res.json(updated);
});

router.delete("/contracts/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.query(`DELETE FROM contracts WHERE id = ?`, [req.params.id]);
  await logAudit(req.user?.id, "contract", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

router.get("/partner-programmes", authRequired, requireRole(...canManage), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  if (req.query.partner_id) {
    where.push("pp.partner_id = ?");
    params.push(req.query.partner_id);
  }
  if (req.query.programme_id) {
    where.push("pp.programme_id = ?");
    params.push(req.query.programme_id);
  }
  if (req.query.partner_q) {
    where.push("p.raison_sociale LIKE ?");
    params.push(`%${req.query.partner_q}%`);
  }
  if (req.query.s2_code) {
    where.push("UPPER(COALESCE(pr.branch_s2_code, '')) LIKE ?");
    params.push(`%${String(req.query.s2_code).trim().toUpperCase()}%`);
  }
  if (req.query.ligne) {
    where.push("pr.ligne_risque LIKE ?");
    params.push(`%${req.query.ligne}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total
     FROM partner_programme pp
     JOIN partners p ON p.id = pp.partner_id
     JOIN programmes pr ON pr.id = pp.programme_id
     ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT
       pp.partner_id,
       pp.programme_id,
       pp.is_active,
       pp.created_at,
       p.raison_sociale AS partner_name,
       p.statut AS partner_statut,
       pr.branch_s2_code,
       pr.ligne_risque,
       pr.statut AS programme_statut
     FROM partner_programme pp
     JOIN partners p ON p.id = pp.partner_id
     JOIN programmes pr ON pr.id = pp.programme_id
     ${whereSql}
     ORDER BY p.raison_sociale ASC, pr.branch_s2_code ASC, pr.ligne_risque ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ data: rows, pagination: { page, limit, total } });
});

router.post(
  "/partner-programmes",
  authRequired,
  requireRole(...canManage),
  validate(partnerProgrammeLinkCreate),
  async (req, res) => {
    const partner = await ensurePartnerExists(req.body.partner_id);
    if (!partner) return res.status(404).json({ error: "partner_not_found" });
    const programme = await ensureProgrammeActif(req.body.programme_id);
    if (!programme) return res.status(404).json({ error: "programme_not_found" });
    const [result] = await pool.query(
      `INSERT IGNORE INTO partner_programme (partner_id, programme_id) VALUES (?, ?)`,
      [req.body.partner_id, req.body.programme_id]
    );
    const created = Number(result?.affectedRows || 0) > 0;
    if (created) {
      await logAudit(req.user?.id, "partner_programme", req.body.partner_id, "create", {
        partner_id: req.body.partner_id,
        programme_id: req.body.programme_id,
      });
    }
    res.status(created ? 201 : 200).json({ ok: true, created });
  }
);

router.delete(
  "/partner-programmes/:partnerId/:programmeId",
  authRequired,
  requireRole(...canManage),
  async (req, res) => {
    const [result] = await pool.query(
      `DELETE FROM partner_programme WHERE partner_id = ? AND programme_id = ?`,
      [req.params.partnerId, req.params.programmeId]
    );
    res.json({ ok: true, deleted: Number(result?.affectedRows || 0) > 0 });
  }
);

router.post("/:id/programmes", authRequired, requireRole(...canManage), async (req, res) => {
  const programmeId = Number(req.body.programme_id);
  if (!programmeId) return res.status(400).json({ error: "programme_id_required" });
  const partner = await ensurePartnerExists(Number(req.params.id));
  if (!partner) return res.status(404).json({ error: "partner_not_found" });
  const programme = await ensureProgrammeActif(programmeId);
  if (!programme) return res.status(404).json({ error: "programme_not_found" });
  const [result] = await pool.query(
    `INSERT IGNORE INTO partner_programme (partner_id, programme_id) VALUES (?, ?)`,
    [req.params.id, programmeId]
  );
  res.status(Number(result?.affectedRows || 0) > 0 ? 201 : 200).json({ ok: true, created: Number(result?.affectedRows || 0) > 0 });
});

router.delete("/:id/programmes/:programmeId", authRequired, requireRole(...canManage), async (req, res) => {
  await pool.query(
    `DELETE FROM partner_programme WHERE partner_id = ? AND programme_id = ?`,
    [req.params.id, req.params.programmeId]
  );
  res.json({ ok: true });
});

router.post("/:id/correspondants", authRequired, requireRole(...canManage), validate(assignmentCreate), async (req, res) => {
  const exists = await ensurePartnerExists(Number(req.params.id));
  if (!exists) return res.status(404).json({ error: "partner_not_found" });
  const [correspondants] = await pool.query(`SELECT id FROM correspondants WHERE id = ?`, [req.body.correspondant_id]);
  if (!correspondants.length) return res.status(404).json({ error: "correspondant_not_found" });
  if (req.body.statut === "actif") {
    const hasActive = await hasActiveCorrespondantRole(Number(req.params.id), req.body.role);
    if (hasActive) return res.status(409).json({ error: "active_correspondant_role_exists" });
  }
  const fields = ["partner_id", "correspondant_id", "role", "statut", "date_debut", "date_fin"];
  const values = [
    Number(req.params.id),
    req.body.correspondant_id,
    req.body.role,
    req.body.statut,
    req.body.date_debut,
    req.body.date_fin,
  ];
  await pool.query(
    `INSERT INTO partner_correspondant (${fields.join(", ")}) VALUES (?, ?, ?, ?, ?, ?)`,
    values
  );
  res.status(201).json({ ok: true });
});

router.patch("/:id/correspondants/:assignmentId", authRequired, requireRole(...canManage), async (req, res) => {
  const fields = ["statut", "date_debut", "date_fin"];
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "no_fields" });
  values.push(req.params.id, req.params.assignmentId);
  await pool.query(
    `UPDATE partner_correspondant SET ${sets.join(", ")} WHERE partner_id = ? AND id = ?`,
    values
  );
  res.json({ ok: true });
});

router.delete("/:id/correspondants/:assignmentId", authRequired, requireRole(...canManage), async (req, res) => {
  await pool.query(
    `DELETE FROM partner_correspondant WHERE partner_id = ? AND id = ?`,
    [req.params.id, req.params.assignmentId]
  );
  res.json({ ok: true });
});

router.get("/:id/addresses", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM partner_addresses WHERE partner_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ data: rows });
});

router.post("/:id/addresses", authRequired, requireRole(...canManage), validate(addressCreate), async (req, res) => {
  const fields = ["partner_id", ...Object.keys(addressCreate.shape)];
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = [Number(req.params.id), ...Object.keys(addressCreate.shape).map((f) => req.body[f])];
  const [r] = await pool.query(`INSERT INTO partner_addresses (${keys}) VALUES (${placeholders})`, values);
  const [rows] = await pool.query(`SELECT * FROM partner_addresses WHERE id = ?`, [r.insertId]);
  res.status(201).json(rows[0]);
});

router.patch("/:id/addresses/:addressId", authRequired, requireRole(...canManage), validate(addressPatch), async (req, res) => {
  const fields = Object.keys(addressCreate.shape);
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "no_fields" });
  values.push(req.params.id, req.params.addressId);
  await pool.query(
    `UPDATE partner_addresses SET ${sets.join(", ")} WHERE partner_id = ? AND id = ?`,
    values
  );
  const [rows] = await pool.query(`SELECT * FROM partner_addresses WHERE id = ?`, [req.params.addressId]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  res.json(rows[0]);
});

router.delete("/:id/addresses/:addressId", authRequired, requireRole(...canManage), async (req, res) => {
  await pool.query(
    `DELETE FROM partner_addresses WHERE partner_id = ? AND id = ?`,
    [req.params.id, req.params.addressId]
  );
  res.json({ ok: true });
});

router.get("/:id/mandataires", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM partner_mandataires WHERE partner_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ data: rows });
});

router.post("/:id/mandataires", authRequired, requireRole(...canManage), validate(mandataireCreate), async (req, res) => {
  const fields = ["partner_id", ...Object.keys(mandataireCreate.shape)];
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = [Number(req.params.id), ...Object.keys(mandataireCreate.shape).map((f) => req.body[f])];
  const [r] = await pool.query(`INSERT INTO partner_mandataires (${keys}) VALUES (${placeholders})`, values);
  const [rows] = await pool.query(`SELECT * FROM partner_mandataires WHERE id = ?`, [r.insertId]);
  res.status(201).json(rows[0]);
});

router.patch(
  "/:id/mandataires/:mandataireId",
  authRequired,
  requireRole(...canManage),
  validate(mandatairePatch),
  async (req, res) => {
    const fields = Object.keys(mandataireCreate.shape);
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    values.push(req.params.id, req.params.mandataireId);
    await pool.query(
      `UPDATE partner_mandataires SET ${sets.join(", ")} WHERE partner_id = ? AND id = ?`,
      values
    );
    const [rows] = await pool.query(`SELECT * FROM partner_mandataires WHERE id = ?`, [req.params.mandataireId]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  }
);

router.delete("/:id/mandataires/:mandataireId", authRequired, requireRole(...canManage), async (req, res) => {
  await pool.query(
    `DELETE FROM partner_mandataires WHERE partner_id = ? AND id = ?`,
    [req.params.id, req.params.mandataireId]
  );
  res.json({ ok: true });
});

router.get("/:id/documents", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM partner_documents WHERE partner_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ data: rows });
});

router.post("/:id/documents", authRequired, requireRole(...canManage), validate(documentCreate), async (req, res) => {
  const { file_base64, file_name, file_path } = req.body;
  let storedPath = file_path || null;
  if (file_base64) {
    const base64 = String(file_base64);
    const raw = base64.includes(",") ? base64.split(",").pop() : base64;
    const safeName = String(file_name || "document").replace(/[^a-zA-Z0-9._-]/g, "_");
    const dir = path.join(DOCS_DIR, `partner_${req.params.id}`);
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${Date.now()}_${safeName}`);
    await fs.writeFile(dest, Buffer.from(raw || "", "base64"));
    storedPath = dest;
  }
  const fields = ["partner_id", ...Object.keys(documentCreate.shape).filter((k) => k !== "file_base64")];
  const keys = fields.join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const values = [
    Number(req.params.id),
    ...Object.keys(documentCreate.shape)
      .filter((f) => f !== "file_base64")
      .map((f) => {
        if (f === "metadata") return normalizeJson(req.body[f]);
        if (f === "file_path") return storedPath;
        return req.body[f];
      }),
  ];
  const [r] = await pool.query(
    `INSERT INTO partner_documents (${keys}) VALUES (${placeholders})`,
    values
  );
  const [rows] = await pool.query(`SELECT * FROM partner_documents WHERE id = ?`, [r.insertId]);
  const created = rows[0];
  await logAudit(req.user?.id, "partner_document", r.insertId, "create", created);
  res.status(201).json(created);
});

router.patch("/:id/documents/:docId", authRequired, requireRole(...canManage), validate(documentPatch), async (req, res) => {
  const fields = Object.keys(documentCreate.shape);
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === "file_base64") continue;
      sets.push(`${f} = ?`);
      if (f === "metadata") values.push(normalizeJson(req.body[f]));
      else values.push(req.body[f]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "no_fields" });
  values.push(req.params.id, req.params.docId);
  await pool.query(
    `UPDATE partner_documents SET ${sets.join(", ")} WHERE partner_id = ? AND id = ?`,
    values
  );
  const [rows] = await pool.query(`SELECT * FROM partner_documents WHERE id = ?`, [req.params.docId]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const updated = rows[0];
  await logAudit(req.user?.id, "partner_document", Number(req.params.docId), "update", updated);
  res.json(updated);
});

router.delete("/:id/documents/:docId", authRequired, requireRole(...canManage), async (req, res) => {
  await pool.query(
    `DELETE FROM partner_documents WHERE partner_id = ? AND id = ?`,
    [req.params.id, req.params.docId]
  );
  res.json({ ok: true });
});

router.get("/:id/documents/:docId/view", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM partner_documents WHERE partner_id = ? AND id = ?`,
    [req.params.id, req.params.docId]
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

router.get("/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM partners WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const partner = rows[0];
  const [programmes] = await pool.query(
    `SELECT p.*, pp.is_active
     FROM partner_programme pp
     JOIN programmes p ON p.id = pp.programme_id
     WHERE pp.partner_id = ?`,
    [req.params.id]
  );
  const [correspondants] = await pool.query(
    `SELECT pc.id as assignment_id, c.*, pc.role, pc.statut, pc.date_debut, pc.date_fin
     FROM partner_correspondant pc
     JOIN correspondants c ON c.id = pc.correspondant_id
     WHERE pc.partner_id = ?
     ORDER BY pc.created_at DESC`,
    [req.params.id]
  );
  const [documents] = await pool.query(
    `SELECT * FROM partner_documents WHERE partner_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  const [addresses] = await pool.query(
    `SELECT * FROM partner_addresses WHERE partner_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  const [mandataires] = await pool.query(
    `SELECT * FROM partner_mandataires WHERE partner_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  const [[contractStats]] = await pool.query(
    `SELECT COUNT(*) as total_contracts,
            COUNT(DISTINCT client_id) as clients_contrats
     FROM contracts
     WHERE partner_id = ?`,
    [req.params.id]
  );
  if (req.query.format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=partner_${partner.siren || partner.id}.json`);
  }
  res.json({ partner, programmes, correspondants, documents, addresses, mandataires, contracts: contractStats });
});

router.patch("/:id", authRequired, requireRole(...canManage), validate(partnerPatch), async (req, res) => {
  if (req.body.siret_siege || req.body.siren) {
    const [rows] = await pool.query(`SELECT siren, siret_siege FROM partners WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const current = rows[0];
    const nextSiren = req.body.siren ?? current.siren;
    const nextSiret = req.body.siret_siege ?? current.siret_siege;
    if (nextSiret && nextSiret.slice(0, 9) !== nextSiren) {
      return res.status(400).json({ error: "siret_siege_mismatch" });
    }
  }
  const fields = Object.keys(partnerCreate.shape);
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
  await pool.query(`UPDATE partners SET ${sets.join(", ")} WHERE id = ?`, values);
  const [rows] = await pool.query(`SELECT * FROM partners WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const updated = rows[0];
  await logAudit(req.user?.id, "partner", Number(req.params.id), "update", updated);
  res.json(updated);
});

router.delete("/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM partners WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.query(`DELETE FROM partners WHERE id = ?`, [req.params.id]);
  await logAudit(req.user?.id, "partner", Number(req.params.id), "delete", null);
  res.json({ ok: true });
});

export default router;
