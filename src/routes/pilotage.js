import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";

const router = Router();
const canManage = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];
const dashboardSummaryCache = new Map();
const reinsuranceSummaryCache = new Map();
const reinsuranceTrendCache = new Map();
const portfolioPageCache = new Map();
const solvencyPageCache = new Map();
const DASHBOARD_SUMMARY_TTL_MS = 60_000;
const REINSURANCE_CACHE_TTL_MS = 300_000;
const PORTFOLIO_PAGE_CACHE_TTL_MS = 120_000;
const SOLVENCY_PAGE_CACHE_TTL_MS = 120_000;

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

function parseYear(raw) {
  const year = Number(raw || new Date().getUTCFullYear());
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return new Date().getUTCFullYear();
  return Math.trunc(year);
}

function monthRows(year) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return { month: `${year}-${m}`, label: `${year}-${m}` };
  });
}

function yearBounds(year) {
  return {
    yearStart: `${year}-01-01`,
    yearEnd: `${year}-12-31`,
  };
}

async function loadPremiumAndClaimPaidMonthlyMaps(captiveId, year) {
  const { yearStart, yearEnd } = yearBounds(year);

  const [premiumRows, claimRows] = await Promise.all([
    pool.query(
      `SELECT DATE_FORMAT(cpp.paid_on, '%Y-%m') AS ym, COALESCE(SUM(cpp.amount), 0) AS amount
       FROM contract_premium_payments cpp
       JOIN contracts ct ON ct.id = cpp.contract_id
       JOIN programmes p ON p.id = ct.programme_id
       WHERE p.captive_id = ?
         AND cpp.paid_on BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(cpp.paid_on, '%Y-%m')`,
      [captiveId, yearStart, yearEnd]
    ),
    pool.query(
      `SELECT DATE_FORMAT(r.date, '%Y-%m') AS ym, COALESCE(SUM(r.montant), 0) AS amount
       FROM reglements r
       JOIN sinistres s ON s.id = r.sinistre_id
       JOIN programmes p ON p.id = s.programme_id
       WHERE p.captive_id = ?
         AND r.date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(r.date, '%Y-%m')`,
      [captiveId, yearStart, yearEnd]
    ),
  ]);

  const premiumByMonth = new Map((premiumRows[0] || []).map((r) => [String(r.ym), Number(r.amount || 0)]));
  const paidClaimsByMonth = new Map((claimRows[0] || []).map((r) => [String(r.ym), Number(r.amount || 0)]));
  return { premiumByMonth, paidClaimsByMonth };
}

function dashboardSummaryCacheKey(captiveId, year) {
  return `${captiveId}:${year}`;
}

function readDashboardSummaryCache(captiveId, year) {
  const key = dashboardSummaryCacheKey(captiveId, year);
  const cached = dashboardSummaryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardSummaryCache.delete(key);
    return null;
  }
  return cached.payload;
}

function writeDashboardSummaryCache(captiveId, year, payload) {
  dashboardSummaryCache.set(dashboardSummaryCacheKey(captiveId, year), {
    expiresAt: Date.now() + DASHBOARD_SUMMARY_TTL_MS,
    payload,
  });
}

function genericCacheKey(captiveId, year) {
  return `${captiveId}:${year}`;
}

function readTimedCache(cacheMap, captiveId, year) {
  const cached = cacheMap.get(genericCacheKey(captiveId, year));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cacheMap.delete(genericCacheKey(captiveId, year));
    return null;
  }
  return cached.payload;
}

function writeTimedCache(cacheMap, captiveId, year, payload, ttlMs) {
  cacheMap.set(genericCacheKey(captiveId, year), {
    expiresAt: Date.now() + ttlMs,
    payload,
  });
}

async function loadAnnualPremiumExpectedEstimate(captiveId, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN UPPER(TRIM(COALESCE(t.frequency, ''))) IN ('MONTHLY','MENSUELLE','MENSUEL','MENSUELLES','MENSUELS')
           THEN COALESCE(t.amount,0) * 12
         WHEN UPPER(TRIM(COALESCE(t.frequency, ''))) IN ('QUARTERLY','TRIMESTRIELLE','TRIMESTRIEL','TRIMESTRIELLES','TRIMESTRIELS')
           THEN COALESCE(t.amount,0) * 4
         WHEN UPPER(TRIM(COALESCE(t.frequency, ''))) IN ('ANNUAL','ANNUELLE','ANNUEL','ANNUELLES','ANNUELS')
           THEN COALESCE(t.amount,0)
         ELSE 0
       END
     ), 0) AS total_annual_expected
     FROM contract_premium_terms t
     JOIN contracts ct ON ct.id = t.contract_id
     JOIN programmes p ON p.id = ct.programme_id
     WHERE p.captive_id = ?
       AND ct.statut <> 'resilie'
       AND (t.start_date IS NULL OR t.start_date <= ?)
       AND (t.end_date IS NULL OR t.end_date >= ?)`,
    [captiveId, yearEnd, yearStart]
  );
  return Number(row?.total_annual_expected || 0);
}

async function loadPortfolioSummaryLite(captiveId, year, totals = null) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [branchRows] = await pool.query(
    `SELECT
       COALESCE(ib.s2_code, p.branch_s2_code, '—') AS branch_code,
       COALESCE(ib.name, p.ligne_risque, 'Branche') AS branch_name,
       COALESCE(SUM(cpp.amount), 0) AS premiums_amount
     FROM contract_premium_payments cpp
     JOIN contracts ct ON ct.id = cpp.contract_id
     JOIN programmes p ON p.id = ct.programme_id
     LEFT JOIN insurance_branch ib ON ib.captive_id = p.captive_id AND ib.s2_code = p.branch_s2_code
     WHERE p.captive_id = ?
       AND cpp.paid_on BETWEEN ? AND ?
     GROUP BY COALESCE(ib.s2_code, p.branch_s2_code, '—'), COALESCE(ib.name, p.ligne_risque, 'Branche')
     ORDER BY premiums_amount DESC`,
    [captiveId, yearStart, yearEnd]
  );

  const totalPremiums = Number(totals?.premiums ?? 0);
  const totalEstimated = Number(totals?.estimated ?? 0);
  const totalPaid = Number(totals?.paid ?? 0);
  const top5 = (branchRows || []).slice(0, 5);
  const top5Premiums = top5.reduce((sum, r) => sum + Number(r.premiums_amount || 0), 0);
  const top5ConcentrationPct = totalPremiums > 0 ? (top5Premiums / totalPremiums) * 100 : 0;
  const dominant = top5[0] || null;

  return {
    total_premiums: totalPremiums,
    total_estimated: totalEstimated,
    total_paid: totalPaid,
    branch_count: Number((branchRows || []).length),
    top5_branch_concentration_pct: Number(top5ConcentrationPct.toFixed(2)),
    dominant_branch_code: dominant ? String(dominant.branch_code || "—") : null,
    dominant_branch_name: dominant ? String(dominant.branch_name || "Branche") : null,
    dominant_branch_premiums: dominant ? Number(dominant.premiums_amount || 0) : 0,
  };
}

async function loadReinsuranceSummary(captiveId, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [[prem]] = await pool.query(
    `SELECT
       COALESCE(SUM(rpc.amount_ceded), 0) AS premium_ceded,
       COALESCE(SUM(rpc.commission_reinsurance), 0) AS commission_reinsurance,
       COALESCE(SUM(rpc.net_cost), 0) AS net_cost
     FROM reinsurance_premium_cessions rpc
     JOIN simulation_scenarios ss ON ss.id = rpc.scenario_id
     WHERE ss.captive_id = ?
       AND rpc.accounting_date BETWEEN ? AND ?`,
    [captiveId, yearStart, yearEnd]
  ).catch(() => [[{ premium_ceded: 0, commission_reinsurance: 0, net_cost: 0 }]]);

  const [[claims]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN rcc.cession_type = 'PAID' THEN rcc.amount_ceded ELSE 0 END), 0) AS claim_paid_ceded,
       COALESCE(SUM(CASE WHEN rcc.cession_type = 'RESERVE' THEN rcc.amount_ceded ELSE 0 END), 0) AS claim_reserve_ceded,
       COALESCE(SUM(CASE WHEN rcc.cession_type = 'RECOVERY' THEN rcc.amount_ceded ELSE 0 END), 0) AS claim_recovery
     FROM reinsurance_claim_cessions rcc
     JOIN simulation_scenarios ss ON ss.id = rcc.scenario_id
     WHERE ss.captive_id = ?
       AND rcc.event_date BETWEEN ? AND ?`,
    [captiveId, yearStart, yearEnd]
  ).catch(() => [[{ claim_paid_ceded: 0, claim_reserve_ceded: 0, claim_recovery: 0 }]]);

  const [[fronting]] = await pool.query(
    `SELECT
       COALESCE(SUM(fra.fronting_fee_amount), 0) AS fronting_fee_total,
       COALESCE(SUM(fra.claims_handling_fee_amount), 0) AS claims_handling_fee_total,
       COALESCE(SUM(fra.premium_net_to_captive_after_fees), 0) AS premium_net_to_captive_total,
       COALESCE(SUM(fra.estimated_counterparty_exposure), 0) AS counterparty_exposure_est_total
     FROM fronting_run_adjustments fra
     JOIN simulation_scenarios ss ON ss.id = fra.scenario_id
     WHERE ss.captive_id = ?
       AND fra.snapshot_date BETWEEN ? AND ?`,
    [captiveId, yearStart, yearEnd]
  ).catch(() => [[{ fronting_fee_total: 0, claims_handling_fee_total: 0, premium_net_to_captive_total: 0, counterparty_exposure_est_total: 0 }]]);

  const [premiumRunsResult, claimRunsResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT rpc.run_id) AS runs_with_premium_cessions
       FROM reinsurance_premium_cessions rpc
       JOIN simulation_scenarios ss ON ss.id = rpc.scenario_id
       WHERE ss.captive_id = ?
         AND rpc.accounting_date BETWEEN ? AND ?`,
      [captiveId, yearStart, yearEnd]
    ).catch(() => [[{ runs_with_premium_cessions: 0 }]]),
    pool.query(
      `SELECT COUNT(DISTINCT rcc.run_id) AS runs_with_claim_cessions
       FROM reinsurance_claim_cessions rcc
       JOIN simulation_scenarios ss ON ss.id = rcc.scenario_id
       WHERE ss.captive_id = ?
         AND rcc.event_date BETWEEN ? AND ?`,
      [captiveId, yearStart, yearEnd]
    ).catch(() => [[{ runs_with_claim_cessions: 0 }]]),
  ]);
  const [[premiumRunsMeta]] = premiumRunsResult;
  const [[claimRunsMeta]] = claimRunsResult;

  return {
    premium_ceded: Number(prem?.premium_ceded || 0),
    commission_reinsurance: Number(prem?.commission_reinsurance || 0),
    net_cost: Number(prem?.net_cost || 0),
    claim_paid_ceded: Number(claims?.claim_paid_ceded || 0),
    claim_reserve_ceded: Number(claims?.claim_reserve_ceded || 0),
    claim_recovery: Number(claims?.claim_recovery || 0),
    fronting_fee_total: Number(fronting?.fronting_fee_total || 0),
    claims_handling_fee_total: Number(fronting?.claims_handling_fee_total || 0),
    premium_net_to_captive_total: Number(fronting?.premium_net_to_captive_total || 0),
    counterparty_exposure_est_total: Number(fronting?.counterparty_exposure_est_total || 0),
    runs_with_premium_cessions: Number(premiumRunsMeta?.runs_with_premium_cessions || 0),
    runs_with_claim_cessions: Number(claimRunsMeta?.runs_with_claim_cessions || 0),
  };
}

function computeSolvencyAlertLevel({ solvencyRatioPct, mcrCoveragePct, freshnessDays }) {
  if (freshnessDays !== null && freshnessDays > 45) return "critical";
  if (mcrCoveragePct !== null && mcrCoveragePct < 100) return "critical";
  if (solvencyRatioPct !== null && solvencyRatioPct < 100) return "critical";
  if (freshnessDays !== null && freshnessDays > 31) return "warning";
  if (mcrCoveragePct !== null && mcrCoveragePct < 120) return "warning";
  if (solvencyRatioPct !== null && solvencyRatioPct < 120) return "warning";
  return "ok";
}

function normalizeSolvencySource(raw) {
  const s = String(raw || "auto").toLowerCase();
  if (s === "real" || s === "simulation" || s === "auto") return s;
  return "auto";
}

function normalizeS2Row(row, source) {
  if (!row) return null;
  const snapshotDate = row.snapshot_date ? new Date(row.snapshot_date).toISOString().slice(0, 10) : null;
  const scrTotal = Number(row.scr_total || 0);
  const mcr = Number(row.mcr || 0);
  const ownFunds = Number(row.own_funds_eligible || 0);
  const ratio =
    row.solvency_ratio_pct === null || row.solvency_ratio_pct === undefined
      ? scrTotal > 0
        ? (ownFunds / scrTotal) * 100
        : null
      : Number(row.solvency_ratio_pct);
  return {
    run_id: row.run_id == null ? null : Number(row.run_id || 0),
    snapshot_date: snapshotDate,
    scr_total: scrTotal,
    mcr,
    own_funds_eligible: ownFunds,
    solvency_ratio_pct: ratio == null ? null : Number(ratio),
    scr_non_life: Number(row.scr_non_life || 0),
    scr_counterparty: Number(row.scr_counterparty || 0),
    scr_market: Number(row.scr_market || 0),
    scr_operational: Number(row.scr_operational || 0),
    methodology_version: row.methodology_version ? String(row.methodology_version) : null,
    source,
    reference_run_id: row.reference_run_id == null ? null : Number(row.reference_run_id || 0),
    status: row.status ? String(row.status) : null,
  };
}

async function loadSolvencyPageData(captiveId, year, selectedRunId = null, sourceMode = "auto") {
  const { yearStart, yearEnd } = yearBounds(year);
  const source = normalizeSolvencySource(sourceMode);
  const runFilterSql = Number.isFinite(Number(selectedRunId)) && Number(selectedRunId) > 0 ? " AND s2.run_id = ? " : "";
  const runFilterParams = Number.isFinite(Number(selectedRunId)) && Number(selectedRunId) > 0 ? [Number(selectedRunId)] : [];
  const [simLatestResult, simYearRowsResult, almLatestResult, availableRunsResult, realLatestResult, realYearRowsResult] = await Promise.all([
    pool.query(
      `SELECT
         s2.run_id, s2.snapshot_date, s2.scr_total, s2.mcr, s2.own_funds_eligible, s2.solvency_ratio_pct,
         s2.scr_non_life, s2.scr_counterparty, s2.scr_market, s2.scr_operational, s2.methodology_version
       FROM s2_scr_results s2
       JOIN simulation_scenarios ss ON ss.id = s2.scenario_id
       WHERE ss.captive_id = ?
       ${runFilterSql}
       ORDER BY s2.snapshot_date DESC, s2.run_id DESC
       LIMIT 1`,
      [captiveId, ...runFilterParams]
    ).catch(() => [[]]),
    pool.query(
      `SELECT
         s2.run_id, s2.snapshot_date, s2.scr_total, s2.mcr, s2.own_funds_eligible, s2.solvency_ratio_pct,
         s2.scr_non_life, s2.scr_counterparty, s2.scr_market, s2.scr_operational, s2.methodology_version
       FROM s2_scr_results s2
       JOIN simulation_scenarios ss ON ss.id = s2.scenario_id
       WHERE ss.captive_id = ?
         AND s2.snapshot_date BETWEEN ? AND ?
       ${runFilterSql}
       ORDER BY s2.snapshot_date DESC, s2.run_id DESC`,
      [captiveId, yearStart, yearEnd, ...runFilterParams]
    ).catch(() => [[]]),
    pool.query(
      `SELECT MAX(ds.business_date) AS latest_alm_snapshot_date
       FROM alm_v3_daily_snapshots ds
       JOIN alm_v3_profiles ap ON ap.id = ds.profile_id
       WHERE ap.captive_id = ?`,
      [captiveId]
    ).catch(() => [[{ latest_alm_snapshot_date: null }]]),
    pool.query(
      `SELECT s2.run_id, MAX(s2.snapshot_date) AS latest_snapshot_date, COUNT(*) AS snapshots_count
       FROM s2_scr_results s2
       JOIN simulation_scenarios ss ON ss.id = s2.scenario_id
       WHERE ss.captive_id = ?
       GROUP BY s2.run_id
       ORDER BY MAX(s2.snapshot_date) DESC, s2.run_id DESC`,
      [captiveId]
    ).catch(() => [[]]),
    pool.query(
      `SELECT
         reference_run_id AS run_id, snapshot_date, scr_total, mcr, own_funds_eligible, solvency_ratio_pct,
         scr_non_life, scr_counterparty, scr_market, scr_operational, methodology_version, status, reference_run_id
       FROM s2_scr_results_real
       WHERE captive_id = ?
       ORDER BY snapshot_date DESC, id DESC
       LIMIT 1`,
      [captiveId]
    ).catch(() => [[]]),
    pool.query(
      `SELECT
         reference_run_id AS run_id, snapshot_date, scr_total, mcr, own_funds_eligible, solvency_ratio_pct,
         scr_non_life, scr_counterparty, scr_market, scr_operational, methodology_version, status, reference_run_id
       FROM s2_scr_results_real
       WHERE captive_id = ?
         AND snapshot_date BETWEEN ? AND ?
       ORDER BY snapshot_date DESC, id DESC`,
      [captiveId, yearStart, yearEnd]
    ).catch(() => [[]]),
  ]);

  const simLatest = normalizeS2Row((simLatestResult[0] || [])[0] || null, "simulation");
  const simYearRows = (simYearRowsResult[0] || []).map((r) => normalizeS2Row(r, "simulation"));
  const realLatest = normalizeS2Row((realLatestResult[0] || [])[0] || null, "real");
  const realYearRows = (realYearRowsResult[0] || []).map((r) => normalizeS2Row(r, "real"));

  let latestSnapshot = null;
  if (source === "real") latestSnapshot = realLatest;
  else if (source === "simulation") latestSnapshot = simLatest;
  else {
    latestSnapshot = realLatest || simLatest || null;
  }

  let yearRows = [];
  if (source === "real") {
    yearRows = realYearRows;
  } else if (source === "simulation") {
    yearRows = simYearRows;
  } else {
    const byDate = new Map();
    for (const row of simYearRows) {
      if (!row?.snapshot_date) continue;
      if (!byDate.has(row.snapshot_date)) byDate.set(row.snapshot_date, row);
    }
    for (const row of realYearRows) {
      if (!row?.snapshot_date) continue;
      byDate.set(row.snapshot_date, row);
    }
    yearRows = Array.from(byDate.values()).sort((a, b) => {
      const da = String(b?.snapshot_date || "");
      const db = String(a?.snapshot_date || "");
      if (da !== db) return da.localeCompare(db);
      return Number(b?.run_id || 0) - Number(a?.run_id || 0);
    });
  }
  const latestAlmRaw = (almLatestResult[0] || [])[0]?.latest_alm_snapshot_date || null;
  const latestAlmDateMax =
    latestAlmRaw instanceof Date
      ? latestAlmRaw.toISOString().slice(0, 10)
      : latestAlmRaw
      ? String(latestAlmRaw).slice(0, 10)
      : null;

  // For the regulator view, align the ALM display date with the S2 snapshot date shown above.
  // (The ALM engine can contain projected future dates beyond the latest S2 snapshot.)
  const latestAlmDate = latestSnapshot?.snapshot_date || latestAlmDateMax;

  const now = new Date();
  const freshnessDays =
    latestSnapshot?.snapshot_date
      ? Math.max(
          0,
          Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${latestSnapshot.snapshot_date}T00:00:00Z`)) / 86_400_000)
        )
      : null;
  const almFreshnessDays =
    latestAlmDate
      ? Math.max(
          0,
          Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${latestAlmDate}T00:00:00Z`)) / 86_400_000)
        )
      : null;

  const mcrCoveragePct =
    latestSnapshot && Number(latestSnapshot.mcr || 0) > 0
      ? Number((((latestSnapshot.own_funds_eligible || 0) / latestSnapshot.mcr) * 100).toFixed(2))
      : null;
  const solvencyRatioPct =
    latestSnapshot?.solvency_ratio_pct !== null && latestSnapshot?.solvency_ratio_pct !== undefined
      ? Number(Number(latestSnapshot.solvency_ratio_pct).toFixed(2))
      : latestSnapshot && Number(latestSnapshot.scr_total || 0) > 0
      ? Number((((latestSnapshot.own_funds_eligible || 0) / latestSnapshot.scr_total) * 100).toFixed(2))
      : null;

  const alertMessages = [];
  if (!latestSnapshot) alertMessages.push("Aucun résultat S2/SCR disponible");
  if (solvencyRatioPct !== null && solvencyRatioPct < 120) alertMessages.push(`Ratio SCR sous vigilance (${solvencyRatioPct.toFixed(1)}%)`);
  if (mcrCoveragePct !== null && mcrCoveragePct < 120) alertMessages.push(`Couverture MCR sous vigilance (${mcrCoveragePct.toFixed(1)}%)`);
  if (freshnessDays !== null && freshnessDays > 31) alertMessages.push(`Résultat S2 non récent (${freshnessDays} jours)`);
  if (almFreshnessDays !== null && almFreshnessDays > 31) alertMessages.push(`Snapshot ALM non récent (${almFreshnessDays} jours)`);

  const monthlyLatestByMonth = new Map();
  for (const row of yearRows) {
    if (!row.snapshot_date) continue;
    const month = row.snapshot_date.slice(0, 7);
    if (!monthlyLatestByMonth.has(month)) {
      monthlyLatestByMonth.set(month, row);
    }
  }
  const monthly = monthRows(year).map((m) => {
    const row = monthlyLatestByMonth.get(m.month) || null;
    const mcrPct = row && row.mcr > 0 ? Number(((row.own_funds_eligible / row.mcr) * 100).toFixed(2)) : null;
    return {
      month: m.month,
      label: m.label,
      snapshot_date: row?.snapshot_date || null,
      run_id: row?.run_id || null,
      own_funds_eligible: row?.own_funds_eligible || 0,
      scr_total: row?.scr_total || 0,
      mcr: row?.mcr || 0,
      scr_non_life: row?.scr_non_life || 0,
      scr_counterparty: row?.scr_counterparty || 0,
      scr_market: row?.scr_market || 0,
      scr_operational: row?.scr_operational || 0,
      solvency_ratio_pct: row?.solvency_ratio_pct ?? null,
      mcr_coverage_pct: mcrPct,
      source: row?.source || null,
      reference_run_id: row?.reference_run_id || null,
      status: row?.status || null,
    };
  });

  return {
    year,
    source_mode: source,
    selected_run_id: Number(selectedRunId || 0) > 0 ? Number(selectedRunId) : null,
    available_runs: (availableRunsResult[0] || []).map((r) => ({
      run_id: Number(r.run_id || 0),
      latest_snapshot_date: r.latest_snapshot_date ? new Date(r.latest_snapshot_date).toISOString().slice(0, 10) : null,
      snapshots_count: Number(r.snapshots_count || 0),
    })),
    summary: {
      latest_snapshot: latestSnapshot,
      latest_alm_snapshot_date: latestAlmDate,
      solvency_ratio_pct: solvencyRatioPct,
      mcr_coverage_pct: mcrCoveragePct,
      data_freshness_days: freshnessDays,
      alm_freshness_days: almFreshnessDays,
      alert_level: computeSolvencyAlertLevel({ solvencyRatioPct, mcrCoveragePct, freshnessDays }),
      alert_messages: alertMessages,
      year_snapshots_count: yearRows.length,
    },
    monthly,
    recent_snapshots: yearRows.slice(0, 12),
  };
}

async function loadDashboardSummary(captiveId, year) {
  const months = await loadPerformanceTrend(captiveId, year);
  const last = months[months.length - 1] || null;
  const premiums = Number(last?.cumulative_premiums || 0);
  const estimated = Number(last?.cumulative_estimated || 0);
  const paid = Number(last?.cumulative_paid || 0);
  const expected = await loadAnnualPremiumExpectedEstimate(captiveId, year);
  const [portfolioSummary, reinsuranceSummary] = await Promise.all([
    loadPortfolioSummaryLite(captiveId, year, { premiums, estimated, paid }),
    loadReinsuranceSummary(captiveId, year),
  ]);

  const payload = {
    year,
    generated_at: new Date().toISOString(),
    cache_ttl_ms: DASHBOARD_SUMMARY_TTL_MS,
    cards: {
      primes: {
        total_paid_year: premiums,
        total_annual_expected: expected,
        collection_rate_pct: expected > 0 ? Number(((premiums / expected) * 100).toFixed(2)) : 0,
      },
      sinistres: {
        estimated_total: estimated,
        paid_total: paid,
        remaining_total: Math.max(estimated - paid, 0),
        paid_rate_pct: estimated > 0 ? Number(((paid / estimated) * 100).toFixed(2)) : 0,
      },
      tresorerie: {
        inflows_cumulative: premiums,
        outflows_cumulative: paid,
        net_cumulative: premiums - paid,
      },
      performance: {
        premiums_cumulative: premiums,
        estimated_cumulative: estimated,
        paid_cumulative: paid,
        sp_estimated_pct: premiums > 0 ? Number(((estimated / premiums) * 100).toFixed(2)) : 0,
        sp_paid_pct: premiums > 0 ? Number(((paid / premiums) * 100).toFixed(2)) : 0,
      },
      portefeuille: portfolioSummary,
      reassurance: reinsuranceSummary,
    },
  };

  return payload;
}

async function loadPerformanceTrend(captiveId, year) {
  const { yearStart, yearEnd } = yearBounds(year);
  const { premiumByMonth, paidClaimsByMonth } = await loadPremiumAndClaimPaidMonthlyMaps(captiveId, year);

  const [estimatedRows] = await pool.query(
    `SELECT DATE_FORMAT(COALESCE(s.date_decl, s.date_survenue), '%Y-%m') AS ym,
            COALESCE(SUM(s.montant_estime), 0) AS amount
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     WHERE p.captive_id = ?
       AND COALESCE(s.date_decl, s.date_survenue) IS NOT NULL
       AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(COALESCE(s.date_decl, s.date_survenue), '%Y-%m')`,
    [captiveId, yearStart, yearEnd]
  );

  const estimatedByMonth = new Map(estimatedRows.map((r) => [String(r.ym), Number(r.amount || 0)]));

  let cumulativePremiums = 0;
  let cumulativeEstimated = 0;
  let cumulativePaid = 0;
  const months = monthRows(year).map((m) => {
    const premiums = Number(premiumByMonth.get(m.month) || 0);
    const estimated = Number(estimatedByMonth.get(m.month) || 0);
    const paid = Number(paidClaimsByMonth.get(m.month) || 0);
    cumulativePremiums += premiums;
    cumulativeEstimated += estimated;
    cumulativePaid += paid;
    return {
      month: m.month,
      label: m.label,
      premiums_amount: premiums,
      estimated_amount: estimated,
      paid_amount: paid,
      cumulative_premiums: cumulativePremiums,
      cumulative_estimated: cumulativeEstimated,
      cumulative_paid: cumulativePaid,
    };
  });

  return months;
}

async function loadTreasuryCashflowTrend(captiveId, year) {
  const { premiumByMonth, paidClaimsByMonth } = await loadPremiumAndClaimPaidMonthlyMaps(captiveId, year);

  let cumulativeInflows = 0;
  let cumulativeOutflows = 0;
  let cumulativeNet = 0;
  const months = monthRows(year).map((m) => {
    const inflows = Number(premiumByMonth.get(m.month) || 0);
    const outflows = Number(paidClaimsByMonth.get(m.month) || 0);
    const net = inflows - outflows;
    cumulativeInflows += inflows;
    cumulativeOutflows += outflows;
    cumulativeNet += net;
    return {
      month: m.month,
      label: m.label,
      inflows_amount: inflows,
      outflows_amount: outflows,
      net_amount: net,
      cumulative_inflows: cumulativeInflows,
      cumulative_outflows: cumulativeOutflows,
      cumulative_net: cumulativeNet,
    };
  });

  return months;
}

router.get("/treasury-cashflow-trend", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const months = await loadTreasuryCashflowTrend(captiveId, year);
    const last = months[months.length - 1] || null;
    return res.json({
      year,
      totals: {
        inflows: Number(last?.cumulative_inflows || 0),
        outflows: Number(last?.cumulative_outflows || 0),
        net: Number(last?.cumulative_net || 0),
      },
      months,
    });
  } catch (error) {
    console.error("GET /api/pilotage/treasury-cashflow-trend failed", error);
    return res.status(500).json({ error: "treasury_cashflow_trend_failed" });
  }
});

router.get("/dashboard-summary", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);

    const cached = readDashboardSummaryCache(captiveId, year);
    if (cached) return res.json({ ...cached, cache_hit: true });

    const payload = await loadDashboardSummary(captiveId, year);
    writeDashboardSummaryCache(captiveId, year, payload);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    console.error("GET /api/pilotage/dashboard-summary failed", error);
    return res.status(500).json({ error: "dashboard_summary_failed" });
  }
});

router.get("/treasury-summary", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const months = await loadTreasuryCashflowTrend(captiveId, year);
    const now = new Date();
    const currentMonthKey = `${year}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = months.find((m) => m.month === currentMonthKey) || months[months.length - 1] || null;
    const last = months[months.length - 1] || null;
    const gross = Number(last?.cumulative_inflows || 0) + Number(last?.cumulative_outflows || 0);
    return res.json({
      year,
      summary: {
        cash_observe_label: "Flux net observé (primes - règlements)",
        inflows_cumulative: Number(last?.cumulative_inflows || 0),
        outflows_cumulative: Number(last?.cumulative_outflows || 0),
        net_cumulative: Number(last?.cumulative_net || 0),
        current_month: current?.month || null,
        current_month_inflows: Number(current?.inflows_amount || 0),
        current_month_outflows: Number(current?.outflows_amount || 0),
        current_month_net: Number(current?.net_amount || 0),
        gross_flow_cumulative: gross,
      },
    });
  } catch (error) {
    console.error("GET /api/pilotage/treasury-summary failed", error);
    return res.status(500).json({ error: "treasury_summary_failed" });
  }
});

router.get("/performance-trend", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const months = await loadPerformanceTrend(captiveId, year);
    const last = months[months.length - 1] || null;
    return res.json({
      year,
      totals: {
        premiums: Number(last?.cumulative_premiums || 0),
        estimated: Number(last?.cumulative_estimated || 0),
        paid: Number(last?.cumulative_paid || 0),
      },
      months,
    });
  } catch (error) {
    console.error("GET /api/pilotage/performance-trend failed", error);
    return res.status(500).json({ error: "performance_trend_failed" });
  }
});

router.get("/performance-summary", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const months = await loadPerformanceTrend(captiveId, year);
    const now = new Date();
    const currentMonthKey = `${year}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = months.find((m) => m.month === currentMonthKey) || months[months.length - 1] || null;
    const last = months[months.length - 1] || null;
    const premiums = Number(last?.cumulative_premiums || 0);
    const estimated = Number(last?.cumulative_estimated || 0);
    const paid = Number(last?.cumulative_paid || 0);
    const spEstimatedPct = premiums > 0 ? (estimated / premiums) * 100 : 0;
    const spPaidPct = premiums > 0 ? (paid / premiums) * 100 : 0;

    return res.json({
      year,
      summary: {
        premiums_cumulative: premiums,
        estimated_cumulative: estimated,
        paid_cumulative: paid,
        sp_estimated_pct: Number(spEstimatedPct.toFixed(2)),
        sp_paid_pct: Number(spPaidPct.toFixed(2)),
        current_month: current?.month || null,
        current_month_premiums: Number(current?.premiums_amount || 0),
        current_month_estimated: Number(current?.estimated_amount || 0),
        current_month_paid: Number(current?.paid_amount || 0),
      },
    });
  } catch (error) {
    console.error("GET /api/pilotage/performance-summary failed", error);
    return res.status(500).json({ error: "performance_summary_failed" });
  }
});

router.get("/solvabilite-page-data", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const source = normalizeSolvencySource(req.query.source);
    const runId = Number(req.query.run_id || 0);
    const cacheKeyYear = `${year}:run:${runId > 0 ? runId : "all"}:src:${source}`;
    const cached = readTimedCache(solvencyPageCache, captiveId, cacheKeyYear);
    if (cached) return res.json({ ...cached, cache_hit: true });
    const payload = await loadSolvencyPageData(captiveId, year, runId > 0 ? runId : null, source);
    writeTimedCache(solvencyPageCache, captiveId, cacheKeyYear, payload, SOLVENCY_PAGE_CACHE_TTL_MS);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    console.error("GET /api/pilotage/solvabilite-page-data failed", error);
    return res.status(500).json({ error: "solvabilite_page_data_failed" });
  }
});

router.get("/portfolio-breakdown", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const [branchPremiumRows] = await pool.query(
      `SELECT
         COALESCE(ib.s2_code, p.branch_s2_code, '—') AS branch_code,
         COALESCE(ib.name, p.ligne_risque, 'Branche') AS branch_name,
         COALESCE(SUM(cpp.amount), 0) AS premiums_amount
       FROM contract_premium_payments cpp
       JOIN contracts ct ON ct.id = cpp.contract_id
       JOIN programmes p ON p.id = ct.programme_id
       LEFT JOIN insurance_branch ib ON ib.captive_id = p.captive_id AND ib.s2_code = p.branch_s2_code
       WHERE p.captive_id = ?
         AND cpp.paid_on BETWEEN ? AND ?
       GROUP BY COALESCE(ib.s2_code, p.branch_s2_code, '—'), COALESCE(ib.name, p.ligne_risque, 'Branche')
       ORDER BY premiums_amount DESC`,
      [captiveId, yearStart, yearEnd]
    );

    const [branchClaimRows] = await pool.query(
      `SELECT
         COALESCE(ib.s2_code, p.branch_s2_code, '—') AS branch_code,
         COALESCE(ib.name, p.ligne_risque, 'Branche') AS branch_name,
         COALESCE(SUM(s.montant_estime), 0) AS estimated_amount,
         COALESCE(SUM(rg.paid_amount), 0) AS paid_amount
       FROM sinistres s
       JOIN programmes p ON p.id = s.programme_id
       LEFT JOIN insurance_branch ib ON ib.captive_id = p.captive_id AND ib.s2_code = p.branch_s2_code
       LEFT JOIN (
         SELECT sinistre_id, COALESCE(SUM(montant), 0) AS paid_amount
         FROM reglements
         WHERE date BETWEEN ? AND ?
         GROUP BY sinistre_id
       ) rg ON rg.sinistre_id = s.id
       WHERE p.captive_id = ?
         AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?
       GROUP BY COALESCE(ib.s2_code, p.branch_s2_code, '—'), COALESCE(ib.name, p.ligne_risque, 'Branche')
       ORDER BY estimated_amount DESC`,
      [yearStart, yearEnd, captiveId, yearStart, yearEnd]
    );

    const [partnerRows] = await pool.query(
      `SELECT
         ct.partner_id,
         COALESCE(pr.raison_sociale, CONCAT('Partenaire #', ct.partner_id)) AS partner_name,
         COALESCE(SUM(cpp.amount), 0) AS premiums_amount
       FROM contract_premium_payments cpp
       JOIN contracts ct ON ct.id = cpp.contract_id
       JOIN programmes p ON p.id = ct.programme_id
       LEFT JOIN partners pr ON pr.id = ct.partner_id
       WHERE p.captive_id = ?
         AND cpp.paid_on BETWEEN ? AND ?
       GROUP BY ct.partner_id, COALESCE(pr.raison_sociale, CONCAT('Partenaire #', ct.partner_id))
       ORDER BY premiums_amount DESC
       LIMIT 10`,
      [captiveId, yearStart, yearEnd]
    );

    const [clientRows] = await pool.query(
      `SELECT
         ct.client_id,
         COALESCE(c.external_client_ref, CONCAT('Client #', ct.client_id)) AS client_ref,
         COALESCE(SUM(cpp.amount), 0) AS premiums_amount
       FROM contract_premium_payments cpp
       JOIN contracts ct ON ct.id = cpp.contract_id
       JOIN programmes p ON p.id = ct.programme_id
       LEFT JOIN clients c ON c.id = ct.client_id
       WHERE p.captive_id = ?
         AND cpp.paid_on BETWEEN ? AND ?
       GROUP BY ct.client_id, COALESCE(c.external_client_ref, CONCAT('Client #', ct.client_id))
       ORDER BY premiums_amount DESC
       LIMIT 10`,
      [captiveId, yearStart, yearEnd]
    );

    const branchMap = new Map();
    for (const r of branchPremiumRows) {
      const key = `${r.branch_code}||${r.branch_name}`;
      branchMap.set(key, {
        branch_code: String(r.branch_code || "—"),
        branch_name: String(r.branch_name || "Branche"),
        premiums_amount: Number(r.premiums_amount || 0),
        estimated_amount: 0,
        paid_amount: 0,
      });
    }
    for (const r of branchClaimRows) {
      const key = `${r.branch_code}||${r.branch_name}`;
      const prev = branchMap.get(key) || {
        branch_code: String(r.branch_code || "—"),
        branch_name: String(r.branch_name || "Branche"),
        premiums_amount: 0,
        estimated_amount: 0,
        paid_amount: 0,
      };
      prev.estimated_amount = Number(r.estimated_amount || 0);
      prev.paid_amount = Number(r.paid_amount || 0);
      branchMap.set(key, prev);
    }
    const branches = Array.from(branchMap.values()).sort((a, b) => b.premiums_amount - a.premiums_amount);

    return res.json({
      year,
      branches,
      top_partners: partnerRows.map((r) => ({
        partner_id: Number(r.partner_id || 0),
        partner_name: String(r.partner_name || "Partenaire"),
        premiums_amount: Number(r.premiums_amount || 0),
      })),
      top_clients: clientRows.map((r) => ({
        client_id: Number(r.client_id || 0),
        client_ref: String(r.client_ref || "Client"),
        premiums_amount: Number(r.premiums_amount || 0),
      })),
    });
  } catch (error) {
    console.error("GET /api/pilotage/portfolio-breakdown failed", error);
    return res.status(500).json({ error: "portfolio_breakdown_failed" });
  }
});

router.get("/portfolio-page-data", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const cached = readTimedCache(portfolioPageCache, captiveId, year);
    if (cached) return res.json({ ...cached, cache_hit: true });

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const [[premiumsAgg], [claimsAgg], branchPremiumResult, branchClaimResult, partnerResult, clientResult] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(cpp.amount), 0) AS total_premiums
         FROM contract_premium_payments cpp
         JOIN contracts ct ON ct.id = cpp.contract_id
         JOIN programmes p ON p.id = ct.programme_id
         WHERE p.captive_id = ?
           AND cpp.paid_on BETWEEN ? AND ?`,
        [captiveId, yearStart, yearEnd]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(s.montant_estime), 0) AS total_estimated,
           COALESCE(SUM(rg.paid_amount), 0) AS total_paid
         FROM sinistres s
         JOIN programmes p ON p.id = s.programme_id
         LEFT JOIN (
           SELECT sinistre_id, COALESCE(SUM(montant), 0) AS paid_amount
           FROM reglements
           WHERE date BETWEEN ? AND ?
           GROUP BY sinistre_id
         ) rg ON rg.sinistre_id = s.id
         WHERE p.captive_id = ?
           AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?`,
        [yearStart, yearEnd, captiveId, yearStart, yearEnd]
      ),
      pool.query(
        `SELECT
           COALESCE(ib.s2_code, p.branch_s2_code, '—') AS branch_code,
           COALESCE(ib.name, p.ligne_risque, 'Branche') AS branch_name,
           COALESCE(SUM(cpp.amount), 0) AS premiums_amount
         FROM contract_premium_payments cpp
         JOIN contracts ct ON ct.id = cpp.contract_id
         JOIN programmes p ON p.id = ct.programme_id
         LEFT JOIN insurance_branch ib ON ib.captive_id = p.captive_id AND ib.s2_code = p.branch_s2_code
         WHERE p.captive_id = ?
           AND cpp.paid_on BETWEEN ? AND ?
         GROUP BY COALESCE(ib.s2_code, p.branch_s2_code, '—'), COALESCE(ib.name, p.ligne_risque, 'Branche')
         ORDER BY premiums_amount DESC`,
        [captiveId, yearStart, yearEnd]
      ),
      pool.query(
        `SELECT
           COALESCE(ib.s2_code, p.branch_s2_code, '—') AS branch_code,
           COALESCE(ib.name, p.ligne_risque, 'Branche') AS branch_name,
           COALESCE(SUM(s.montant_estime), 0) AS estimated_amount,
           COALESCE(SUM(rg.paid_amount), 0) AS paid_amount
         FROM sinistres s
         JOIN programmes p ON p.id = s.programme_id
         LEFT JOIN insurance_branch ib ON ib.captive_id = p.captive_id AND ib.s2_code = p.branch_s2_code
         LEFT JOIN (
           SELECT sinistre_id, COALESCE(SUM(montant), 0) AS paid_amount
           FROM reglements
           WHERE date BETWEEN ? AND ?
           GROUP BY sinistre_id
         ) rg ON rg.sinistre_id = s.id
         WHERE p.captive_id = ?
           AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?
         GROUP BY COALESCE(ib.s2_code, p.branch_s2_code, '—'), COALESCE(ib.name, p.ligne_risque, 'Branche')
         ORDER BY estimated_amount DESC`,
        [yearStart, yearEnd, captiveId, yearStart, yearEnd]
      ),
      pool.query(
        `SELECT
           ct.partner_id,
           COALESCE(pr.raison_sociale, CONCAT('Partenaire #', ct.partner_id)) AS partner_name,
           COALESCE(SUM(cpp.amount), 0) AS premiums_amount
         FROM contract_premium_payments cpp
         JOIN contracts ct ON ct.id = cpp.contract_id
         JOIN programmes p ON p.id = ct.programme_id
         LEFT JOIN partners pr ON pr.id = ct.partner_id
         WHERE p.captive_id = ?
           AND cpp.paid_on BETWEEN ? AND ?
         GROUP BY ct.partner_id, COALESCE(pr.raison_sociale, CONCAT('Partenaire #', ct.partner_id))
         ORDER BY premiums_amount DESC
         LIMIT 10`,
        [captiveId, yearStart, yearEnd]
      ),
      pool.query(
        `SELECT
           ct.client_id,
           COALESCE(c.external_client_ref, CONCAT('Client #', ct.client_id)) AS client_ref,
           COALESCE(SUM(cpp.amount), 0) AS premiums_amount
         FROM contract_premium_payments cpp
         JOIN contracts ct ON ct.id = cpp.contract_id
         JOIN programmes p ON p.id = ct.programme_id
         LEFT JOIN clients c ON c.id = ct.client_id
         WHERE p.captive_id = ?
           AND cpp.paid_on BETWEEN ? AND ?
         GROUP BY ct.client_id, COALESCE(c.external_client_ref, CONCAT('Client #', ct.client_id))
         ORDER BY premiums_amount DESC
         LIMIT 10`,
        [captiveId, yearStart, yearEnd]
      ),
    ]);

    const branchPremiumRows = branchPremiumResult[0] || [];
    const branchClaimRows = branchClaimResult[0] || [];
    const partnerRows = partnerResult[0] || [];
    const clientRows = clientResult[0] || [];

    const branchMap = new Map();
    for (const r of branchPremiumRows) {
      const key = `${r.branch_code}||${r.branch_name}`;
      branchMap.set(key, {
        branch_code: String(r.branch_code || "—"),
        branch_name: String(r.branch_name || "Branche"),
        premiums_amount: Number(r.premiums_amount || 0),
        estimated_amount: 0,
        paid_amount: 0,
      });
    }
    for (const r of branchClaimRows) {
      const key = `${r.branch_code}||${r.branch_name}`;
      const prev = branchMap.get(key) || {
        branch_code: String(r.branch_code || "—"),
        branch_name: String(r.branch_name || "Branche"),
        premiums_amount: 0,
        estimated_amount: 0,
        paid_amount: 0,
      };
      prev.estimated_amount = Number(r.estimated_amount || 0);
      prev.paid_amount = Number(r.paid_amount || 0);
      branchMap.set(key, prev);
    }
    const branches = Array.from(branchMap.values()).sort((a, b) => b.premiums_amount - a.premiums_amount);

    const totalPremiums = Number(premiumsAgg?.total_premiums || 0);
    const totalEstimated = Number(claimsAgg?.total_estimated || 0);
    const totalPaid = Number(claimsAgg?.total_paid || 0);
    const top5 = branches.slice(0, 5);
    const top5Premiums = top5.reduce((sum, r) => sum + Number(r.premiums_amount || 0), 0);
    const top5ConcentrationPct = totalPremiums > 0 ? (top5Premiums / totalPremiums) * 100 : 0;
    const dominant = branches[0] || null;

    const payload = {
      year,
      summary: {
        total_premiums: totalPremiums,
        total_estimated: totalEstimated,
        total_paid: totalPaid,
        branch_count: branches.length,
        top5_branch_concentration_pct: Number(top5ConcentrationPct.toFixed(2)),
        dominant_branch_code: dominant ? String(dominant.branch_code || "—") : null,
        dominant_branch_name: dominant ? String(dominant.branch_name || "Branche") : null,
        dominant_branch_premiums: dominant ? Number(dominant.premiums_amount || 0) : 0,
      },
      branches,
      top_partners: partnerRows.map((r) => ({
        partner_id: Number(r.partner_id || 0),
        partner_name: String(r.partner_name || "Partenaire"),
        premiums_amount: Number(r.premiums_amount || 0),
      })),
      top_clients: clientRows.map((r) => ({
        client_id: Number(r.client_id || 0),
        client_ref: String(r.client_ref || "Client"),
        premiums_amount: Number(r.premiums_amount || 0),
      })),
    };
    writeTimedCache(portfolioPageCache, captiveId, year, payload, PORTFOLIO_PAGE_CACHE_TTL_MS);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    console.error("GET /api/pilotage/portfolio-page-data failed", error);
    return res.status(500).json({ error: "portfolio_page_data_failed" });
  }
});

router.get("/portfolio-summary", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const [[premiumsAgg]] = await pool.query(
      `SELECT COALESCE(SUM(cpp.amount), 0) AS total_premiums
       FROM contract_premium_payments cpp
       JOIN contracts ct ON ct.id = cpp.contract_id
       JOIN programmes p ON p.id = ct.programme_id
       WHERE p.captive_id = ?
         AND cpp.paid_on BETWEEN ? AND ?`,
      [captiveId, yearStart, yearEnd]
    );

    const [[claimsAgg]] = await pool.query(
      `SELECT
         COALESCE(SUM(s.montant_estime), 0) AS total_estimated,
         COALESCE(SUM(rg.paid_amount), 0) AS total_paid
       FROM sinistres s
       JOIN programmes p ON p.id = s.programme_id
       LEFT JOIN (
         SELECT sinistre_id, COALESCE(SUM(montant), 0) AS paid_amount
         FROM reglements
         WHERE date BETWEEN ? AND ?
         GROUP BY sinistre_id
       ) rg ON rg.sinistre_id = s.id
       WHERE p.captive_id = ?
         AND COALESCE(s.date_decl, s.date_survenue) BETWEEN ? AND ?`,
      [yearStart, yearEnd, captiveId, yearStart, yearEnd]
    );

    const [branchPremiumRows] = await pool.query(
      `SELECT COALESCE(SUM(x.premiums_amount), 0) AS total_premiums, COUNT(*) AS branch_count
       FROM (
         SELECT p.branch_s2_code, SUM(cpp.amount) AS premiums_amount
         FROM contract_premium_payments cpp
         JOIN contracts ct ON ct.id = cpp.contract_id
         JOIN programmes p ON p.id = ct.programme_id
         WHERE p.captive_id = ?
           AND cpp.paid_on BETWEEN ? AND ?
         GROUP BY p.branch_s2_code
       ) x`,
      [captiveId, yearStart, yearEnd]
    );
    const [topBranchRows] = await pool.query(
      `SELECT
         COALESCE(ib.s2_code, p.branch_s2_code, '—') AS branch_code,
         COALESCE(ib.name, p.ligne_risque, 'Branche') AS branch_name,
         COALESCE(SUM(cpp.amount), 0) AS premiums_amount
       FROM contract_premium_payments cpp
       JOIN contracts ct ON ct.id = cpp.contract_id
       JOIN programmes p ON p.id = ct.programme_id
       LEFT JOIN insurance_branch ib ON ib.captive_id = p.captive_id AND ib.s2_code = p.branch_s2_code
       WHERE p.captive_id = ?
         AND cpp.paid_on BETWEEN ? AND ?
       GROUP BY COALESCE(ib.s2_code, p.branch_s2_code, '—'), COALESCE(ib.name, p.ligne_risque, 'Branche')
       ORDER BY premiums_amount DESC
       LIMIT 5`,
      [captiveId, yearStart, yearEnd]
    );

    const totalPremiums = Number(premiumsAgg?.total_premiums || 0);
    const totalEstimated = Number(claimsAgg?.total_estimated || 0);
    const totalPaid = Number(claimsAgg?.total_paid || 0);
    const top5Premiums = topBranchRows.reduce((sum, r) => sum + Number(r.premiums_amount || 0), 0);
    const top5ConcentrationPct = totalPremiums > 0 ? (top5Premiums / totalPremiums) * 100 : 0;
    const dominant = topBranchRows[0] || null;

    return res.json({
      year,
      summary: {
        total_premiums: totalPremiums,
        total_estimated: totalEstimated,
        total_paid: totalPaid,
        branch_count: Number(branchPremiumRows[0]?.branch_count || 0),
        top5_branch_concentration_pct: Number(top5ConcentrationPct.toFixed(2)),
        dominant_branch_code: dominant ? String(dominant.branch_code || "—") : null,
        dominant_branch_name: dominant ? String(dominant.branch_name || "Branche") : null,
        dominant_branch_premiums: dominant ? Number(dominant.premiums_amount || 0) : 0,
      },
    });
  } catch (error) {
    console.error("GET /api/pilotage/portfolio-summary failed", error);
    return res.status(500).json({ error: "portfolio_summary_failed" });
  }
});

router.get("/reinsurance-summary", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const cached = readTimedCache(reinsuranceSummaryCache, captiveId, year);
    if (cached) return res.json({ ...cached, cache_hit: true });
    const summary = await loadReinsuranceSummary(captiveId, year);
    const payload = { year, summary };
    writeTimedCache(reinsuranceSummaryCache, captiveId, year, payload, REINSURANCE_CACHE_TTL_MS);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    console.error("GET /api/pilotage/reinsurance-summary failed", error);
    return res.status(500).json({ error: "reinsurance_summary_failed" });
  }
});

router.get("/reinsurance-trend", authRequired, requireRole(...canManage), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = parseYear(req.query.year);
    const cached = readTimedCache(reinsuranceTrendCache, captiveId, year);
    if (cached) return res.json({ ...cached, cache_hit: true });
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const [premRows] = await pool.query(
      `SELECT DATE_FORMAT(rpc.accounting_date, '%Y-%m') AS ym,
              COALESCE(SUM(rpc.amount_ceded),0) AS premium_ceded,
              COALESCE(SUM(rpc.net_cost),0) AS net_cost
       FROM reinsurance_premium_cessions rpc
       JOIN simulation_scenarios ss ON ss.id = rpc.scenario_id
       WHERE ss.captive_id = ? AND rpc.accounting_date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(rpc.accounting_date, '%Y-%m')`,
      [captiveId, yearStart, yearEnd]
    ).catch(() => [[]]);

    const [claimRows] = await pool.query(
      `SELECT DATE_FORMAT(rcc.event_date, '%Y-%m') AS ym,
              COALESCE(SUM(CASE WHEN rcc.cession_type='RECOVERY' THEN rcc.amount_ceded ELSE 0 END),0) AS recovery_amount
       FROM reinsurance_claim_cessions rcc
       JOIN simulation_scenarios ss ON ss.id = rcc.scenario_id
       WHERE ss.captive_id = ? AND rcc.event_date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(rcc.event_date, '%Y-%m')`,
      [captiveId, yearStart, yearEnd]
    ).catch(() => [[]]);

    const [frontRows] = await pool.query(
      `SELECT DATE_FORMAT(fra.snapshot_date, '%Y-%m') AS ym,
              COALESCE(SUM(fra.fronting_fee_amount),0) AS fronting_fee,
              COALESCE(SUM(fra.claims_handling_fee_amount),0) AS claims_handling_fee
       FROM fronting_run_adjustments fra
       JOIN simulation_scenarios ss ON ss.id = fra.scenario_id
       WHERE ss.captive_id = ? AND fra.snapshot_date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(fra.snapshot_date, '%Y-%m')`,
      [captiveId, yearStart, yearEnd]
    ).catch(() => [[]]);

    const premByMonth = new Map((premRows || []).map((r) => [String(r.ym), { premium_ceded: Number(r.premium_ceded || 0), net_cost: Number(r.net_cost || 0) }]));
    const claimByMonth = new Map((claimRows || []).map((r) => [String(r.ym), Number(r.recovery_amount || 0)]));
    const frontByMonth = new Map((frontRows || []).map((r) => [String(r.ym), { fronting_fee: Number(r.fronting_fee || 0), claims_handling_fee: Number(r.claims_handling_fee || 0) }]));

    let cPremium = 0;
    let cRecovery = 0;
    let cFronting = 0;
    const months = monthRows(year).map((m) => {
      const prem = premByMonth.get(m.month) || { premium_ceded: 0, net_cost: 0 };
      const recovery = Number(claimByMonth.get(m.month) || 0);
      const front = frontByMonth.get(m.month) || { fronting_fee: 0, claims_handling_fee: 0 };
      const frontingCost = Number(front.fronting_fee || 0) + Number(front.claims_handling_fee || 0);
      cPremium += Number(prem.premium_ceded || 0);
      cRecovery += recovery;
      cFronting += frontingCost;
      return {
        month: m.month,
        label: m.label,
        premium_ceded_amount: Number(prem.premium_ceded || 0),
        recovery_amount: recovery,
        fronting_cost_amount: frontingCost,
        cumulative_premium_ceded: cPremium,
        cumulative_recovery: cRecovery,
        cumulative_fronting_cost: cFronting,
      };
    });

    const last = months[months.length - 1] || null;
    const payload = {
      year,
      totals: {
        premium_ceded: Number(last?.cumulative_premium_ceded || 0),
        recovery: Number(last?.cumulative_recovery || 0),
        fronting_cost: Number(last?.cumulative_fronting_cost || 0),
      },
      months,
    };
    writeTimedCache(reinsuranceTrendCache, captiveId, year, payload, REINSURANCE_CACHE_TTL_MS);
    return res.json({ ...payload, cache_hit: false });
  } catch (error) {
    console.error("GET /api/pilotage/reinsurance-trend failed", error);
    return res.status(500).json({ error: "reinsurance_trend_failed" });
  }
});

export default router;
