import pool from "./pool.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function commonDims(snapshotDate) {
  return {
    reporting_scope: "solo",
    period_type: "instant",
    period_end: snapshotDate,
    currency: "EUR",
  };
}

function addFact(out, source, dateIso, templateCode, conceptCode, value, dimensions = {}, meta = {}) {
  out.push({
    source,
    snapshot_date: dateIso,
    template_code: templateCode,
    concept_code: conceptCode,
    dimensions_json: dimensions,
    value_decimal: round2(value),
    unit_code: meta.unit_code || "EUR",
    currency: meta.currency || "EUR",
    origin_table: meta.origin_table || null,
    origin_row_ref: meta.origin_row_ref || null,
  });
}

function buildFacts({ source, dateIso, s2Row, balanceSheet }) {
  const facts = [];
  const dims = commonDims(dateIso);
  const metaS2 = {
    origin_table: source === "real" ? "s2_scr_results_real" : "s2_scr_results",
    origin_row_ref: String(s2Row.id || ""),
  };

  // S.02 Balance sheet (proxy, ALM-backed when available)
  addFact(facts, source, dateIso, "S.02.01", "BS.TotalAssets", balanceSheet.total_assets, dims, {
    origin_table: balanceSheet.origin_table,
    origin_row_ref: balanceSheet.origin_row_ref,
  });
  addFact(facts, source, dateIso, "S.02.01", "BS.TotalLiabilities", balanceSheet.total_liabilities, dims, {
    origin_table: balanceSheet.origin_table,
    origin_row_ref: balanceSheet.origin_row_ref,
  });
  addFact(facts, source, dateIso, "S.02.01", "BS.ExcessOfAssetsOverLiabilities", balanceSheet.excess_assets, dims, {
    origin_table: balanceSheet.origin_table,
    origin_row_ref: balanceSheet.origin_row_ref,
  });

  // S.23 Own funds
  addFact(facts, source, dateIso, "S.23.01", "OF.BasicOwnFundsEligible", s2Row.own_funds_eligible, dims, metaS2);
  addFact(facts, source, dateIso, "S.23.01", "OF.SCRTotal", s2Row.scr_total, dims, metaS2);
  addFact(facts, source, dateIso, "S.23.01", "OF.MCRTotal", s2Row.mcr, dims, metaS2);

  // S.25 SCR
  addFact(facts, source, dateIso, "S.25.01", "SCR.NonLife", s2Row.scr_non_life, { ...dims, risk_module: "non_life" }, metaS2);
  addFact(facts, source, dateIso, "S.25.01", "SCR.Counterparty", s2Row.scr_counterparty, { ...dims, risk_module: "counterparty" }, metaS2);
  addFact(facts, source, dateIso, "S.25.01", "SCR.Market", s2Row.scr_market, { ...dims, risk_module: "market" }, metaS2);
  addFact(facts, source, dateIso, "S.25.01", "SCR.Operational", s2Row.scr_operational, { ...dims, risk_module: "operational" }, metaS2);
  addFact(facts, source, dateIso, "S.25.01", "SCR.BSCR", s2Row.scr_bscr, { ...dims, risk_module: "bscr" }, metaS2);
  addFact(facts, source, dateIso, "S.25.01", "SCR.Total", s2Row.scr_total, { ...dims, risk_module: "total" }, metaS2);

  // S.28 MCR
  addFact(facts, source, dateIso, "S.28.01", "MCR.Total", s2Row.mcr, dims, metaS2);
  addFact(
    facts,
    source,
    dateIso,
    "S.28.01",
    "MCR.CoverageRatioPct",
    num(s2Row.mcr) > 0 ? (num(s2Row.own_funds_eligible) / num(s2Row.mcr)) * 100 : 0,
    { ...dims, unit: "PCT" },
    { ...metaS2, unit_code: "PCT" }
  );
  return facts;
}

async function loadS2RowReal(captiveId, dateIso) {
  const [rows] = await pool.query(
    `SELECT id, reference_run_id, own_funds_eligible, scr_non_life, scr_counterparty, scr_market, scr_operational, scr_bscr, scr_total, mcr, solvency_ratio_pct
     FROM s2_scr_results_real
     WHERE captive_id = ? AND snapshot_date = ?
     ORDER BY id DESC
     LIMIT 1`,
    [captiveId, dateIso]
  );
  return rows[0] || null;
}

async function loadS2RowSimulation(captiveId, dateIso, runId = null) {
  const params = [captiveId, dateIso];
  let sql = `
    SELECT r.id, r.run_id, r.own_funds_eligible, r.scr_non_life, r.scr_counterparty, r.scr_market, r.scr_operational, r.scr_bscr, r.scr_total, r.mcr, r.solvency_ratio_pct
    FROM s2_scr_results r
    JOIN simulation_runs sr ON sr.id = r.run_id
    JOIN simulation_scenarios ss ON ss.id = sr.scenario_id
    WHERE ss.captive_id = ? AND r.snapshot_date = ?
  `;
  if (Number(runId) > 0) {
    sql += " AND r.run_id = ? ";
    params.push(Number(runId));
  }
  sql += " ORDER BY r.snapshot_date DESC, r.id DESC LIMIT 1";
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function loadAlmAssets({ captiveId, dateIso, runId = null }) {
  const params = [captiveId, dateIso];
  let sql = `
    SELECT ds.id, ds.total_assets_mv, ds.business_date, ds.run_id
    FROM alm_v3_daily_snapshots ds
    JOIN alm_v3_profiles ap ON ap.id = ds.profile_id
    WHERE ap.captive_id = ?
      AND ds.business_date <= ?
  `;
  if (Number(runId) > 0) {
    sql += " AND ds.run_id = ? ";
    params.push(Number(runId));
  }
  sql += " ORDER BY ds.business_date DESC, ds.id DESC LIMIT 1";
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function buildBalanceSheetProxy({ captiveId, dateIso, source, s2Row, runId }) {
  const rowRun = source === "real" ? Number(s2Row.reference_run_id || 0) : Number(s2Row.run_id || 0);
  const alm = await loadAlmAssets({
    captiveId,
    dateIso,
    runId: Number(runId || 0) > 0 ? Number(runId) : rowRun,
  });

  const excess = num(s2Row.own_funds_eligible);
  if (alm) {
    const totalAssets = num(alm.total_assets_mv);
    const totalLiabilities = Math.max(0, totalAssets - excess);
    return {
      total_assets: round2(totalAssets),
      total_liabilities: round2(totalLiabilities),
      excess_assets: round2(excess),
      source_used: "alm_v3_daily_snapshots.total_assets_mv",
      source_business_date: toIsoDate(alm.business_date),
      origin_table: "alm_v3_daily_snapshots",
      origin_row_ref: String(alm.id),
    };
  }

  // Fallback: coherent proxy when ALM is missing.
  return {
    total_assets: round2(excess),
    total_liabilities: 0,
    excess_assets: round2(excess),
    source_used: "fallback_equal_to_own_funds",
    source_business_date: null,
    origin_table: source === "real" ? "s2_scr_results_real" : "s2_scr_results",
    origin_row_ref: String(s2Row.id || ""),
  };
}

function validateBuiltPayload({ s2Row, balanceSheet, facts }) {
  const errors = [];
  const warnings = [];
  const tol = 1;

  const ownFunds = num(s2Row.own_funds_eligible);
  const scr = num(s2Row.scr_total);
  const mcr = num(s2Row.mcr);
  const bscr = num(s2Row.scr_bscr);
  const ratioComputed = scr > 0 ? (ownFunds / scr) * 100 : null;
  const ratioStored = s2Row.solvency_ratio_pct == null ? null : num(s2Row.solvency_ratio_pct);

  if (ownFunds < 0) errors.push("own_funds_negative");
  if (scr <= 0) errors.push("scr_total_non_positive");
  if (mcr <= 0) errors.push("mcr_non_positive");
  if (bscr < 0) errors.push("bscr_negative");
  if (mcr > 0 && scr > 0 && mcr > scr) warnings.push("mcr_above_scr");
  if (scr > 0 && bscr > scr * 1.5) warnings.push("bscr_much_higher_than_scr");

  if (ratioComputed != null && ratioStored != null && Math.abs(ratioComputed - ratioStored) > 1) {
    errors.push("solvency_ratio_inconsistent_with_inputs");
  }

  const bsEquation = num(balanceSheet.total_assets) - num(balanceSheet.total_liabilities) - num(balanceSheet.excess_assets);
  if (Math.abs(bsEquation) > tol) errors.push("balance_sheet_not_balanced");
  if (num(balanceSheet.total_assets) < 0 || num(balanceSheet.total_liabilities) < 0) errors.push("balance_sheet_negative_amount");

  if (String(balanceSheet.source_used) === "fallback_equal_to_own_funds") {
    warnings.push("balance_sheet_alm_missing_using_fallback");
  }

  if (!Array.isArray(facts) || !facts.length) errors.push("facts_empty");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks: {
      own_funds_eligible: round2(ownFunds),
      scr_total: round2(scr),
      mcr: round2(mcr),
      solvency_ratio_pct_computed: ratioComputed == null ? null : round2(ratioComputed),
      solvency_ratio_pct_stored: ratioStored == null ? null : round2(ratioStored),
      balance_sheet_source: balanceSheet.source_used,
    },
  };
}

export async function buildQrtFacts({ captiveId, source = "real", snapshotDate, runId = null }) {
  const captiveIdNum = Number(captiveId || 0);
  if (!Number.isFinite(captiveIdNum) || captiveIdNum <= 0) throw new Error("captive_id_invalid");
  if (!["real", "simulation"].includes(source)) throw new Error("source_invalid");
  const dateIso = toIsoDate(snapshotDate);
  if (!dateIso) throw new Error("snapshot_date_invalid");

  const s2Row = source === "real" ? await loadS2RowReal(captiveIdNum, dateIso) : await loadS2RowSimulation(captiveIdNum, dateIso, runId);
  if (!s2Row) throw new Error("s2_snapshot_not_found");

  const balanceSheet = await buildBalanceSheetProxy({
    captiveId: captiveIdNum,
    dateIso,
    source,
    s2Row,
    runId,
  });
  const facts = buildFacts({ source, dateIso, s2Row, balanceSheet });
  const validation = validateBuiltPayload({ s2Row, balanceSheet, facts });

  await pool.query(`DELETE FROM qrt_facts WHERE captive_id = ? AND source = ? AND snapshot_date = ?`, [captiveIdNum, source, dateIso]);
  for (const f of facts) {
    await pool.query(
      `INSERT INTO qrt_facts
         (captive_id, source, snapshot_date, template_code, concept_code, dimensions_json, value_decimal, unit_code, currency, origin_table, origin_row_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        captiveIdNum,
        f.source,
        f.snapshot_date,
        f.template_code,
        f.concept_code,
        JSON.stringify(f.dimensions_json || {}),
        f.value_decimal,
        f.unit_code,
        f.currency,
        f.origin_table,
        f.origin_row_ref,
      ]
    );
  }

  return {
    source,
    snapshot_date: dateIso,
    facts_count: facts.length,
    validation,
  };
}

export async function listQrtFacts({ captiveId, source = "real", snapshotDate }) {
  const dateIso = toIsoDate(snapshotDate);
  const [rows] = await pool.query(
    `SELECT id, source, snapshot_date, template_code, concept_code, dimensions_json, value_decimal, unit_code, currency, origin_table, origin_row_ref, created_at
     FROM qrt_facts
     WHERE captive_id = ? AND source = ? AND snapshot_date = ?
     ORDER BY template_code, concept_code`,
    [Number(captiveId), source, dateIso]
  );
  return rows || [];
}

export async function validateQrtFacts({ captiveId, source = "real", snapshotDate, runId = null, rebuild = false }) {
  if (rebuild) {
    const built = await buildQrtFacts({ captiveId, source, snapshotDate, runId });
    return built.validation;
  }

  const dateIso = toIsoDate(snapshotDate);
  const s2Row = source === "real" ? await loadS2RowReal(Number(captiveId), dateIso) : await loadS2RowSimulation(Number(captiveId), dateIso, runId);
  if (!s2Row) throw new Error("s2_snapshot_not_found");
  const balanceSheet = await buildBalanceSheetProxy({
    captiveId: Number(captiveId),
    dateIso,
    source,
    s2Row,
    runId,
  });
  const facts = await listQrtFacts({ captiveId, source, snapshotDate: dateIso });
  return validateBuiltPayload({ s2Row, balanceSheet, facts });
}
