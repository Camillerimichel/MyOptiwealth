import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";

const router = Router();
const canManage = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];
const EPSILON = 1e-6;
const MAX_SCHEDULE_ROWS = 360;
const PRIME_ARBO_CACHE_TTL_MS = 60_000;
const PRIME_LIST_CACHE_TTL_MS = 30_000;
const PRIME_BOOTSTRAP_CACHE_TTL_MS = 20_000;
const primeArboCache = new Map();
const primeListCache = new Map();
const primeBootstrapCache = new Map();

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

function readCache(cacheMap, key) {
  const hit = cacheMap.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cacheMap.delete(key);
    return null;
  }
  return hit.payload;
}

function writeCache(cacheMap, key, payload, ttlMs) {
  cacheMap.set(key, { expiresAt: Date.now() + ttlMs, payload });
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

function toIsoDate(value) {
  const dt = toDateOnly(value);
  return dt ? dt.toISOString().slice(0, 10) : null;
}

function addMonthsUtc(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function normalizeFrequency(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (["MONTHLY", "MENSUELLE", "MENSUEL", "MENSUELLES", "MENSUELS"].includes(raw)) {
    return "MONTHLY";
  }
  if (["QUARTERLY", "TRIMESTRIELLE", "TRIMESTRIEL", "TRIMESTRIELLES", "TRIMESTRIELS"].includes(raw)) {
    return "QUARTERLY";
  }
  if (["ANNUAL", "ANNUELLE", "ANNUEL", "ANNUELLES", "ANNUELS"].includes(raw)) {
    return "ANNUAL";
  }
  return null;
}

function frequencyToMonths(frequency) {
  if (frequency === "MONTHLY") return 1;
  if (frequency === "QUARTERLY") return 3;
  if (frequency === "ANNUAL") return 12;
  return null;
}

function frequencyLabel(frequency) {
  if (frequency === "MONTHLY") return "mensuelle";
  if (frequency === "QUARTERLY") return "trimestrielle";
  if (frequency === "ANNUAL") return "annuelle";
  return "non configurée";
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

async function listContractsInScope(
  captiveId,
  {
    branchId = 0,
    contractId = 0,
    partnerId = 0,
    clientId = 0,
    contractStatus = "",
    partnerQuery = "",
    clientQuery = "",
  } = {}
) {
  const where = ["p.captive_id = ?", "ct.statut <> 'resilie'"];
  const params = [captiveId];

  if (branchId > 0) {
    where.push("b.id_branch = ?");
    params.push(branchId);
  }
  if (contractId > 0) {
    where.push("ct.id = ?");
    params.push(contractId);
  }
  if (partnerId > 0) {
    where.push("ct.partner_id = ?");
    params.push(partnerId);
  }
  if (clientId > 0) {
    where.push("ct.client_id = ?");
    params.push(clientId);
  }
  if (contractStatus) {
    where.push("ct.statut = ?");
    params.push(contractStatus);
  }
  if (partnerQuery) {
    where.push("UPPER(COALESCE(pr.raison_sociale, '')) LIKE ?");
    params.push(`%${String(partnerQuery).toUpperCase()}%`);
  }
  if (clientQuery) {
    where.push("UPPER(COALESCE(c.external_client_ref, '')) LIKE ?");
    params.push(`%${String(clientQuery).toUpperCase()}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT
       ct.id,
       ct.partner_id,
       ct.client_id,
       ct.programme_id,
       ct.statut,
       ct.date_debut,
       ct.date_fin,
       ct.devise,
       ct.created_at,
       ct.updated_at,
       p.ligne_risque,
       p.branch_s2_code,
       b.id_branch,
       b.s2_code AS branch_code,
       b.name AS branch_name,
       c.external_client_ref AS client_ref,
       pr.raison_sociale AS partner_name,
       t.frequency AS premium_frequency,
       t.amount AS premium_amount,
       t.currency AS premium_currency,
       t.start_date AS premium_start_date,
       t.end_date AS premium_end_date,
       COALESCE(pay.total_paid, 0) AS total_paid,
       pay.last_paid_on
     FROM contracts ct
     JOIN programmes p ON p.id = ct.programme_id
     LEFT JOIN insurance_branch b ON b.captive_id = p.captive_id AND b.s2_code = p.branch_s2_code
     LEFT JOIN clients c ON c.id = ct.client_id
     LEFT JOIN partners pr ON pr.id = ct.partner_id
     LEFT JOIN contract_premium_terms t ON t.contract_id = ct.id
     LEFT JOIN contract_premium_payments_agg pay ON pay.contract_id = ct.id
     ${whereSql}
     ORDER BY ct.created_at DESC, ct.id DESC`,
    params
  );

  return rows;
}

function evaluateContractPremium(row, today = new Date()) {
  const todayDate = toDateOnly(today) || new Date();
  const frequency = normalizeFrequency(row.premium_frequency);
  const periodMonths = frequencyToMonths(frequency);
  const amountPerPeriod = Number(row.premium_amount || 0);
  const startDate = toDateOnly(row.premium_start_date || row.date_debut);
  const endDate = toDateOnly(row.premium_end_date || row.date_fin);
  const totalPaid = Number(row.total_paid || 0);

  if (!frequency || !periodMonths || !startDate || !(amountPerPeriod > 0)) {
    return {
      ...row,
      premium_frequency: frequency,
      premium_frequency_label: frequencyLabel(frequency),
      premium_amount: amountPerPeriod,
      premium_currency: String(row.premium_currency || row.devise || "EUR").toUpperCase(),
      premium_start_date: toIsoDate(startDate),
      premium_end_date: toIsoDate(endDate),
      expected_due_to_date: 0,
      outstanding_to_date: 0,
      periods_due: 0,
      next_due_date: null,
      payment_status: "a_configurer",
      payment_status_label: "À configurer",
      in_compliance: false,
      total_paid: totalPaid,
    };
  }

  const dueLimit = endDate && endDate < todayDate ? endDate : todayDate;
  let periodsDue = 0;
  let cursor = startDate;
  let guard = 0;
  while (cursor <= dueLimit && guard < MAX_SCHEDULE_ROWS) {
    periodsDue += 1;
    cursor = addMonthsUtc(cursor, periodMonths);
    guard += 1;
  }

  let nextDueDate = null;
  if (cursor > todayDate && (!endDate || cursor <= endDate)) {
    nextDueDate = toIsoDate(cursor);
  }

  const expectedDueToDate = periodsDue * amountPerPeriod;
  const outstandingToDate = Math.max(expectedDueToDate - totalPaid, 0);
  const inCompliance = outstandingToDate <= EPSILON;

  return {
    ...row,
    premium_frequency: frequency,
    premium_frequency_label: frequencyLabel(frequency),
    premium_amount: amountPerPeriod,
    premium_currency: String(row.premium_currency || row.devise || "EUR").toUpperCase(),
    premium_start_date: toIsoDate(startDate),
    premium_end_date: toIsoDate(endDate),
    expected_due_to_date: expectedDueToDate,
    outstanding_to_date: outstandingToDate,
    periods_due: periodsDue,
    next_due_date: nextDueDate,
    payment_status: inCompliance ? "a_jour" : "en_retard",
    payment_status_label: inCompliance ? "À jour" : "En retard",
    in_compliance: inCompliance,
    total_paid: totalPaid,
  };
}

function summarizeByBranch(contracts) {
  const map = new Map();

  for (const contract of contracts) {
    const idBranch = Number(contract.id_branch || 0);
    const key = idBranch > 0 ? idBranch : `__UNMAPPED__:${contract.branch_s2_code || ""}`;
    if (!map.has(key)) {
      map.set(key, {
        id_branch: idBranch > 0 ? idBranch : null,
        s2_code: contract.branch_code || contract.branch_s2_code || null,
        name: contract.branch_name || "Branche non rattachée",
        total_contracts: 0,
        contracts_up_to_date: 0,
        contracts_late: 0,
        contracts_to_configure: 0,
        total_paid: 0,
        total_outstanding: 0,
        total_expected: 0,
        total_late: 0,
        total_annual_expected: 0,
      });
    }
    const agg = map.get(key);
    const outstanding = Number(contract.outstanding_to_date || 0);
    const amountPerPeriod = Number(contract.premium_amount || 0);
    const annualMultiplier = contract.premium_frequency === "MONTHLY" ? 12 : contract.premium_frequency === "QUARTERLY" ? 4 : 1;
    agg.total_contracts += 1;
    agg.total_paid += Number(contract.total_paid || 0);
    agg.total_outstanding += outstanding;
    agg.total_expected += Number(contract.total_paid || 0) + outstanding;
    if (amountPerPeriod > 0 && contract.premium_frequency) {
      agg.total_annual_expected += amountPerPeriod * annualMultiplier;
    }
    if (contract.payment_status === "a_jour") agg.contracts_up_to_date += 1;
    else if (contract.payment_status === "en_retard") {
      agg.contracts_late += 1;
      agg.total_late += outstanding;
    }
    else agg.contracts_to_configure += 1;
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      compliance_pct: row.total_contracts
        ? Number(((row.contracts_up_to_date / row.total_contracts) * 100).toFixed(1))
        : 0,
      total_paid: Number(row.total_paid || 0),
      total_outstanding: Number(row.total_outstanding || 0),
      total_expected: Number(row.total_expected || 0),
      total_late: Number(row.total_late || 0),
      total_annual_expected: Number(row.total_annual_expected || 0),
    }))
    .sort((a, b) => {
      if (b.total_contracts !== a.total_contracts) return b.total_contracts - a.total_contracts;
      return String(a.s2_code || "").localeCompare(String(b.s2_code || ""), "fr");
    });
}

function parsePrimeListQuery(req) {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
    branchId: Number(req.query.id_branch || 0),
    partnerId: Number(req.query.partner_id || 0),
    clientId: Number(req.query.client_id || 0),
    contractStatus: String(req.query.statut || "").trim(),
    partnerQuery: String(req.query.partner_q || "").trim(),
    clientQuery: String(req.query.client_q || "").trim(),
    paymentStatus: String(req.query.payment_status || "").trim(),
  };
}

function primeListCacheKey(captiveId, params) {
  return JSON.stringify({
    captiveId,
    page: params.page,
    limit: params.limit,
    branchId: params.branchId,
    partnerId: params.partnerId,
    clientId: params.clientId,
    contractStatus: params.contractStatus,
    partnerQuery: params.partnerQuery,
    clientQuery: params.clientQuery,
    paymentStatus: params.paymentStatus,
  });
}

async function buildPrimeTreeStatsPayload(captiveId) {
  const contracts = await listContractsInScope(captiveId);
  const evaluated = contracts.map((row) => evaluateContractPremium(row));
  const branches = summarizeByBranch(evaluated);

  const year = new Date().getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [paidRows] = await pool.query(
    `SELECT
       b.id_branch,
       COALESCE(SUM(cpp.amount), 0) AS total_paid_year
     FROM contract_premium_payments cpp
     JOIN contracts ct ON ct.id = cpp.contract_id
     JOIN programmes p ON p.id = ct.programme_id
     JOIN insurance_branch b ON b.captive_id = p.captive_id AND b.s2_code = p.branch_s2_code
     WHERE b.captive_id = ?
       AND cpp.paid_on BETWEEN ? AND ?
     GROUP BY b.id_branch`,
    [captiveId, yearStart, yearEnd]
  );
  const paidByBranch = new Map(paidRows.map((row) => [Number(row.id_branch || 0), Number(row.total_paid_year || 0)]));

  return {
    selected_branch: null,
    branches: branches.map((branch) => ({
      ...branch,
      total_paid: Number((paidByBranch.get(Number(branch.id_branch || 0)) || 0).toFixed(2)),
    })),
  };
}

async function buildPrimeListPayload(captiveId, params) {
  const {
    page,
    limit,
    branchId,
    partnerId,
    clientId,
    contractStatus,
    partnerQuery,
    clientQuery,
    paymentStatus,
  } = params;

  if (branchId > 0 && !(await hasBranchInScope(branchId, captiveId))) {
    const err = new Error("forbidden_scope");
    err.code = "forbidden_scope";
    throw err;
  }

  const allContracts = await listContractsInScope(captiveId, {
    branchId,
    partnerId: partnerId > 0 ? partnerId : 0,
    clientId: clientId > 0 ? clientId : 0,
    contractStatus,
    partnerQuery,
    clientQuery,
  });
  let rows = allContracts.map((row) => evaluateContractPremium(row));

  const partnersMap = new Map();
  const clientsMap = new Map();
  const statusSet = new Set();
  for (const row of rows) {
    const pid = Number(row.partner_id || 0);
    const cid = Number(row.client_id || 0);
    if (pid > 0 && !partnersMap.has(pid)) {
      partnersMap.set(pid, { id: pid, label: String(row.partner_name || `Partenaire #${pid}`) });
    }
    if (cid > 0 && !clientsMap.has(cid)) {
      clientsMap.set(cid, { id: cid, label: String(row.client_ref || `Client #${cid}`) });
    }
    if (row.statut) statusSet.add(String(row.statut));
  }

  if (["a_jour", "en_retard", "a_configurer"].includes(paymentStatus)) {
    rows = rows.filter((row) => row.payment_status === paymentStatus);
  }

  const total = rows.length;
  const offset = (page - 1) * limit;
  const data = rows.slice(offset, offset + limit);

  return {
    data,
    pagination: { page, limit, total },
    filters: {
      partners: Array.from(partnersMap.values()).sort((a, b) => String(a.label).localeCompare(String(b.label), "fr")),
      clients: Array.from(clientsMap.values()).sort((a, b) => String(a.label).localeCompare(String(b.label), "fr")),
      statuts: Array.from(statusSet.values()).sort((a, b) => String(a).localeCompare(String(b), "fr")),
    },
  };
}

function buildScheduleRows({ startDate, endDate, periodMonths, amountPerPeriod, totalPaid, todayDate }) {
  const rows = [];
  let remainingPaid = Math.max(totalPaid, 0);
  let cursor = startDate;
  let guard = 0;

  const dueLimit = endDate && endDate < todayDate ? endDate : todayDate;
  while (cursor <= dueLimit && guard < MAX_SCHEDULE_ROWS) {
    const paidOnPeriod = Math.min(remainingPaid, amountPerPeriod);
    const outstanding = Math.max(amountPerPeriod - paidOnPeriod, 0);
    rows.push({
      due_date: toIsoDate(cursor),
      expected_amount: amountPerPeriod,
      paid_amount: paidOnPeriod,
      outstanding_amount: outstanding,
      status: outstanding <= EPSILON ? "payee" : "en_retard",
      status_label: outstanding <= EPSILON ? "Payée" : "En retard",
    });
    remainingPaid = Math.max(remainingPaid - paidOnPeriod, 0);
    cursor = addMonthsUtc(cursor, periodMonths);
    guard += 1;
  }

  const nextDueDate = cursor > todayDate && (!endDate || cursor <= endDate) ? toIsoDate(cursor) : null;
  return { rows, nextDueDate };
}

router.get("/stats/arborescence", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const cacheKey = `${captiveId}`;
  const cached = readCache(primeArboCache, cacheKey);
  if (cached) return res.json({ ...cached, cache_hit: true });
  const payload = await buildPrimeTreeStatsPayload(captiveId);
  writeCache(primeArboCache, cacheKey, payload, PRIME_ARBO_CACHE_TTL_MS);
  res.json({ ...payload, cache_hit: false });
});

router.get("/page-bootstrap", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    const listParams = parsePrimeListQuery(req);
    const cacheKey = primeListCacheKey(captiveId, listParams);
    const cached = readCache(primeBootstrapCache, cacheKey);
    if (cached) return res.json({ ...cached, cache_hit: true });

    const [statsPayload, listPayload] = await Promise.all([
      (async () => {
        const statsCached = readCache(primeArboCache, `${captiveId}`);
        if (statsCached) return statsCached;
        const built = await buildPrimeTreeStatsPayload(captiveId);
        writeCache(primeArboCache, `${captiveId}`, built, PRIME_ARBO_CACHE_TTL_MS);
        return built;
      })(),
      listParams.branchId
        ? (async () => {
            const listCached = readCache(primeListCache, cacheKey);
            if (listCached) return listCached;
            const built = await buildPrimeListPayload(captiveId, listParams);
            writeCache(primeListCache, cacheKey, built, PRIME_LIST_CACHE_TTL_MS);
            return built;
          })()
        : Promise.resolve({
            data: [],
            pagination: { page: listParams.page, limit: listParams.limit, total: 0 },
            filters: { partners: [], clients: [], statuts: [] },
          }),
    ]);

    const payload = { stats: statsPayload, list: listPayload };
    writeCache(primeBootstrapCache, cacheKey, payload, PRIME_BOOTSTRAP_CACHE_TTL_MS);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    if (error?.message === "forbidden_scope" || error?.code === "forbidden_scope") {
      return res.status(403).json({ error: "forbidden_scope" });
    }
    console.error("GET /api/primes/page-bootstrap failed", error);
    return res.status(500).json({ error: "prime_page_bootstrap_failed" });
  }
});

router.get("/stats/branch-payment-trend", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const branchId = Number(req.query.id_branch || 0);
  const year = Math.max(2000, Math.min(2100, Number(req.query.year) || new Date().getUTCFullYear()));

  if (!branchId) return res.status(400).json({ error: "branch_id_invalid" });
  if (!(await hasBranchInScope(branchId, captiveId))) {
    return res.status(403).json({ error: "forbidden_scope" });
  }

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const contracts = await listContractsInScope(captiveId, { branchId });
  const evaluated = contracts.map((row) => evaluateContractPremium(row));
  const branches = summarizeByBranch(evaluated);
  const branchSummary =
    branches.find((b) => Number(b.id_branch || 0) === branchId) ||
    ({
      id_branch: branchId,
      s2_code: null,
      name: null,
      total_annual_expected: 0,
    });

  const [paymentRows] = await pool.query(
    `SELECT
       DATE_FORMAT(cpp.paid_on, '%Y-%m') AS ym,
       SUM(cpp.amount) AS paid_amount
     FROM contract_premium_payments cpp
     JOIN contracts ct ON ct.id = cpp.contract_id
     JOIN programmes p ON p.id = ct.programme_id
     JOIN insurance_branch b ON b.captive_id = p.captive_id AND b.s2_code = p.branch_s2_code
     WHERE b.captive_id = ?
       AND b.id_branch = ?
       AND cpp.paid_on BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(cpp.paid_on, '%Y-%m')
     ORDER BY ym ASC`,
    [captiveId, branchId, yearStart, yearEnd]
  );

  const byMonth = new Map();
  for (const row of paymentRows) {
    byMonth.set(String(row.ym), Number(row.paid_amount || 0));
  }

  // Estimation mensuelle comparable au cash:
  // - ANNUAL => lissé sur 12 mois
  // - QUARTERLY => lissé sur 3 mois par trimestre
  // - MONTHLY => tel quel chaque mois
  const expectedByMonth = new Map();
  const addExpected = (monthIndex1Based, amount) => {
    if (!(amount > 0)) return;
    const ym = `${year}-${String(monthIndex1Based).padStart(2, "0")}`;
    expectedByMonth.set(ym, Number(expectedByMonth.get(ym) || 0) + Number(amount || 0));
  };

  for (const contract of contracts) {
    const frequency = normalizeFrequency(contract.premium_frequency);
    const amountPerPeriod = Number(contract.premium_amount || 0);
    if (!frequency || !(amountPerPeriod > 0)) continue;

    if (frequency === "ANNUAL") {
      const monthlyAmount = amountPerPeriod / 12;
      for (let m = 1; m <= 12; m += 1) addExpected(m, monthlyAmount);
      continue;
    }
    if (frequency === "QUARTERLY") {
      const monthlyAmount = amountPerPeriod / 3;
      for (const qStart of [1, 4, 7, 10]) {
        addExpected(qStart, monthlyAmount);
        addExpected(qStart + 1, monthlyAmount);
        addExpected(qStart + 2, monthlyAmount);
      }
      continue;
    }
    if (frequency === "MONTHLY") {
      for (let m = 1; m <= 12; m += 1) addExpected(m, amountPerPeriod);
    }
  }

  const months = [];
  let cumulativePaid = 0;
  let cumulativeExpected = 0;
  for (let m = 1; m <= 12; m += 1) {
    const month = String(m).padStart(2, "0");
    const ym = `${year}-${month}`;
    const paidAmount = Number(byMonth.get(ym) || 0);
    const expectedAmount = Number(expectedByMonth.get(ym) || 0);
    cumulativePaid += paidAmount;
    cumulativeExpected += expectedAmount;
    months.push({
      month: ym,
      label: new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("fr-FR", { month: "short" }),
      paid_amount: Number(paidAmount.toFixed(2)),
      expected_amount: Number(expectedAmount.toFixed(2)),
      cumulative_paid: Number(cumulativePaid.toFixed(2)),
      cumulative_expected: Number(cumulativeExpected.toFixed(2)),
    });
  }

  res.json({
    branch: {
      id_branch: branchSummary.id_branch,
      s2_code: branchSummary.s2_code || null,
      name: branchSummary.name || null,
    },
    year,
    total_paid_year: Number(cumulativePaid.toFixed(2)),
    total_annual_expected: Number(cumulativeExpected.toFixed(2)),
    months,
  });
});

router.get("/stats/global-payment-trend", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const year = Math.max(2000, Math.min(2100, Number(req.query.year) || new Date().getUTCFullYear()));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const contracts = await listContractsInScope(captiveId);
  const [paymentRows] = await pool.query(
    `SELECT
       DATE_FORMAT(cpp.paid_on, '%Y-%m') AS ym,
       SUM(cpp.amount) AS paid_amount
     FROM contract_premium_payments cpp
     JOIN contracts ct ON ct.id = cpp.contract_id
     JOIN programmes p ON p.id = ct.programme_id
     WHERE p.captive_id = ?
       AND cpp.paid_on BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(cpp.paid_on, '%Y-%m')
     ORDER BY ym ASC`,
    [captiveId, yearStart, yearEnd]
  );

  const byMonth = new Map(paymentRows.map((row) => [String(row.ym), Number(row.paid_amount || 0)]));
  const expectedByMonth = new Map();
  const addExpected = (monthIndex1Based, amount) => {
    if (!(amount > 0)) return;
    const ym = `${year}-${String(monthIndex1Based).padStart(2, "0")}`;
    expectedByMonth.set(ym, Number(expectedByMonth.get(ym) || 0) + Number(amount || 0));
  };

  for (const contract of contracts) {
    const frequency = normalizeFrequency(contract.premium_frequency);
    const amountPerPeriod = Number(contract.premium_amount || 0);
    if (!frequency || !(amountPerPeriod > 0)) continue;
    if (frequency === "ANNUAL") {
      const monthlyAmount = amountPerPeriod / 12;
      for (let m = 1; m <= 12; m += 1) addExpected(m, monthlyAmount);
      continue;
    }
    if (frequency === "QUARTERLY") {
      const monthlyAmount = amountPerPeriod / 3;
      for (const qStart of [1, 4, 7, 10]) {
        addExpected(qStart, monthlyAmount);
        addExpected(qStart + 1, monthlyAmount);
        addExpected(qStart + 2, monthlyAmount);
      }
      continue;
    }
    if (frequency === "MONTHLY") {
      for (let m = 1; m <= 12; m += 1) addExpected(m, amountPerPeriod);
    }
  }

  const months = [];
  let cumulativePaid = 0;
  let cumulativeExpected = 0;
  for (let m = 1; m <= 12; m += 1) {
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    const paidAmount = Number(byMonth.get(ym) || 0);
    const expectedAmount = Number(expectedByMonth.get(ym) || 0);
    cumulativePaid += paidAmount;
    cumulativeExpected += expectedAmount;
    months.push({
      month: ym,
      label: new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("fr-FR", { month: "short" }),
      paid_amount: Number(paidAmount.toFixed(2)),
      expected_amount: Number(expectedAmount.toFixed(2)),
      cumulative_paid: Number(cumulativePaid.toFixed(2)),
      cumulative_expected: Number(cumulativeExpected.toFixed(2)),
    });
  }

  res.json({
    branch: {
      id_branch: null,
      s2_code: "GLOBAL",
      name: "Toutes branches",
    },
    year,
    total_paid_year: Number(cumulativePaid.toFixed(2)),
    total_annual_expected: Number(cumulativeExpected.toFixed(2)),
    months,
  });
});

router.get("/", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  try {
    const params = parsePrimeListQuery(req);
    const cacheKey = primeListCacheKey(captiveId, params);
    const cached = readCache(primeListCache, cacheKey);
    if (cached) return res.json({ ...cached, cache_hit: true });
    const payload = await buildPrimeListPayload(captiveId, params);
    writeCache(primeListCache, cacheKey, payload, PRIME_LIST_CACHE_TTL_MS);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    if (error?.message === "forbidden_scope" || error?.code === "forbidden_scope") {
      return res.status(403).json({ error: "forbidden_scope" });
    }
    console.error("GET /api/primes failed", error);
    return res.status(500).json({ error: "primes_list_failed" });
  }
});

router.get("/:id", authRequired, requireRole(...canManage), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const contractId = Number(req.params.id || 0);
  if (!contractId) return res.status(400).json({ error: "contract_id_invalid" });

  const rows = await listContractsInScope(captiveId, { contractId });
  if (!rows.length) return res.status(404).json({ error: "contract_not_found" });

  const base = rows[0];
  const contract = evaluateContractPremium(base);
  const [paymentRows] = await pool.query(
    `SELECT id, contract_id, paid_on, amount, currency, reference, notes, created_at
     FROM contract_premium_payments
     WHERE contract_id = ?
     ORDER BY paid_on DESC, id DESC`,
    [contractId]
  );

  const totalPaid = Number(contract.total_paid || 0);
  const frequency = normalizeFrequency(contract.premium_frequency);
  const periodMonths = frequencyToMonths(frequency);
  const amountPerPeriod = Number(contract.premium_amount || 0);
  const startDate = toDateOnly(contract.premium_start_date || contract.date_debut);
  const endDate = toDateOnly(contract.premium_end_date || contract.date_fin);
  const todayDate = toDateOnly(new Date()) || new Date();

  let schedule = [];
  let nextDueDate = null;
  if (frequency && periodMonths && startDate && amountPerPeriod > 0) {
    const schedulePayload = buildScheduleRows({
      startDate,
      endDate,
      periodMonths,
      amountPerPeriod,
      totalPaid,
      todayDate,
    });
    schedule = schedulePayload.rows;
    nextDueDate = schedulePayload.nextDueDate;
  }

  return res.json({
    contract,
    schedule,
    payments: paymentRows,
    totals: {
      expected_due_to_date: Number(contract.expected_due_to_date || 0),
      paid_to_date: totalPaid,
      outstanding_to_date: Number(contract.outstanding_to_date || 0),
      periods_due: Number(contract.periods_due || 0),
      next_due_date: nextDueDate,
    },
  });
});

export default router;
