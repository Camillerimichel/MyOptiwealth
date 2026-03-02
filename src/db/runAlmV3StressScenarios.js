import pool from "./pool.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) args[k] = true;
    else {
      args[k] = v;
      i += 1;
    }
  }
  return args;
}

async function q1(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}
async function qa(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}
function r2(v) {
  return Math.round(n(v) * 100) / 100;
}
function r6(v) {
  return Math.round(n(v) * 1_000_000) / 1_000_000;
}
function parseJsonMaybe(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function sqlDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function deriveStressMultipliers(stressCode, assumptionJson, comparisonRow, baseComparisonRow) {
  const s = parseJsonMaybe(assumptionJson) || {};
  const portfolio = s.portfolio || {};
  const claims = s.claims || {};
  const ownFunds = s.own_funds || {};
  const s2 = s.s2 || {};

  const gwpMult = n(portfolio.gwp_mult || 1) || 1;
  const outflowMult = n(claims.incurred_mult || claims.paid_mult || 1) || 1;
  const catMult = n(claims.property_cat_loss_mult || s2.cat_exposure_mult || 1) || 1;
  const ownFundsMult = n(ownFunds.mult || 1) || 1;
  const s2Mult = n(s2.nonlife_mult || 1) || 1;

  // Asset side proxy: use own-funds stress + S2 severity to imply markdowns on risky assets, while cash is mostly stable.
  const riskyAssetMult = Math.max(0.75, Math.min(1.05, 1 - (1 - ownFundsMult) * 0.55 - (s2Mult - 1) * 0.05));
  const bondMult = Math.max(0.85, Math.min(1.03, 1 - (1 - ownFundsMult) * 0.25));
  const cashMult = 1;
  const liquidityUseMult = Math.max(outflowMult, catMult);
  const liquiditySourceMult = Math.min(1, (cashMult + bondMult + riskyAssetMult) / 3);
  const inflowMult = gwpMult;
  const durationAssetShiftYears = stressCode === "SEVERE" ? 0.35 : stressCode === "ADVERSE" ? 0.15 : 0;
  const assetClassMultipliers =
    stressCode === "SEVERE"
      ? {
          CASH: { mv: 1.0, duration_shift: 0 },
          BOND_ST: { mv: 0.985, duration_shift: 0.1 },
          BOND_MT: { mv: 0.955, duration_shift: 0.25 },
          BOND_LT: { mv: 0.91, duration_shift: 0.55 },
          DIVERS: { mv: 0.84, duration_shift: 0.2 },
        }
      : stressCode === "ADVERSE"
      ? {
          CASH: { mv: 1.0, duration_shift: 0 },
          BOND_ST: { mv: 0.995, duration_shift: 0.05 },
          BOND_MT: { mv: 0.98, duration_shift: 0.12 },
          BOND_LT: { mv: 0.955, duration_shift: 0.25 },
          DIVERS: { mv: 0.93, duration_shift: 0.1 },
        }
      : {
          CASH: { mv: 1.0, duration_shift: 0 },
          BOND_ST: { mv: 1.0, duration_shift: 0 },
          BOND_MT: { mv: 1.0, duration_shift: 0 },
          BOND_LT: { mv: 1.0, duration_shift: 0 },
          DIVERS: { mv: 1.0, duration_shift: 0 },
        };

  const scrPeakRef = baseComparisonRow ? n(baseComparisonRow.scr_total) : n(comparisonRow?.scr_total);
  const scrPeakStress = comparisonRow ? n(comparisonRow.scr_total) : scrPeakRef;

  return {
    inflowMult,
    outflowMult,
    catMult,
    ownFundsMult,
    s2Mult,
    riskyAssetMult,
    bondMult,
    cashMult,
    liquidityUseMult,
    liquiditySourceMult,
    durationAssetShiftYears,
    scrPeakRef,
    scrPeakStress,
    assetClassMultipliers,
    liquiditySourceByHorizon: { D1: liquiditySourceMult, D7: liquiditySourceMult, D30: liquiditySourceMult },
    liquidityUseByHorizon: { D1: liquidityUseMult, D7: liquidityUseMult, D30: liquidityUseMult },
    allowNegativeCash: true,
    allowNegativeLiquidityBuffer: true,
    cashFloorPctAssets: null,
    durationLiabilityMult: Math.max(1, outflowMult * 0.95),
  };
}

async function loadStressOverrides(profileId) {
  const scenarios = await qa(
    `SELECT * FROM alm_v3_stress_scenarios WHERE profile_id = ? AND active = 1`,
    [profileId]
  ).catch(() => []);
  if (!scenarios.length) return {};
  const ids = scenarios.map((r) => Number(r.id));
  const ph = ids.map(() => "?").join(",");
  const shocks = await qa(
    `SELECT * FROM alm_v3_stress_asset_class_shocks WHERE stress_scenario_id IN (${ph}) AND active = 1`,
    ids
  ).catch(() => []);
  const shocksByScenario = shocks.reduce((acc, r) => {
    const sid = Number(r.stress_scenario_id);
    if (!acc[sid]) acc[sid] = {};
    acc[sid][String(r.asset_code || "").toUpperCase()] = r;
    return acc;
  }, {});
  const out = {};
  for (const s of scenarios) {
    out[String(s.stress_code || "").toUpperCase()] = { scenario: s, shocks: shocksByScenario[Number(s.id)] || {} };
  }
  return out;
}

function applyStressOverrides(base, overridePack) {
  if (!overridePack?.scenario) return base;
  const s = overridePack.scenario;
  const merged = {
    ...base,
    inflowMult: n(s.inflow_mult || base.inflowMult),
    outflowMult: n(s.outflow_mult || base.outflowMult),
    ownFundsMult: n(s.own_funds_mult || base.ownFundsMult),
    s2Mult: n(s.s2_mult || base.s2Mult),
    catMult: n(s.cat_mult || base.catMult),
    durationAssetShiftYears: n(s.duration_asset_shift_years ?? base.durationAssetShiftYears),
    durationLiabilityMult: n(s.duration_liability_mult || base.durationLiabilityMult || 1),
    allowNegativeCash: Boolean(Number(s.allow_negative_cash ?? 1)),
    allowNegativeLiquidityBuffer: Boolean(Number(s.allow_negative_liquidity_buffer ?? 1)),
    cashFloorPctAssets: s.cash_floor_pct_assets == null ? null : n(s.cash_floor_pct_assets),
    liquiditySourceByHorizon: {
      D1: n(s.liquidity_source_mult_d1 || base.liquiditySourceByHorizon?.D1 || base.liquiditySourceMult),
      D7: n(s.liquidity_source_mult_d7 || base.liquiditySourceByHorizon?.D7 || base.liquiditySourceMult),
      D30: n(s.liquidity_source_mult_d30 || base.liquiditySourceByHorizon?.D30 || base.liquiditySourceMult),
    },
    liquidityUseByHorizon: {
      D1: n(s.liquidity_use_mult_d1 || base.liquidityUseByHorizon?.D1 || base.liquidityUseMult),
      D7: n(s.liquidity_use_mult_d7 || base.liquidityUseByHorizon?.D7 || base.liquidityUseMult),
      D30: n(s.liquidity_use_mult_d30 || base.liquidityUseByHorizon?.D30 || base.liquidityUseMult),
    },
  };
  const mergedAssetMult = { ...(base.assetClassMultipliers || {}) };
  for (const [assetCode, shock] of Object.entries(overridePack.shocks || {})) {
    mergedAssetMult[assetCode] = {
      ...(mergedAssetMult[assetCode] || {}),
      mv: n(shock.mv_mult ?? mergedAssetMult[assetCode]?.mv ?? 1),
      duration_shift: n(shock.duration_shift_years ?? mergedAssetMult[assetCode]?.duration_shift ?? 0),
      liquidity_source_mult_d1:
        shock.liquidity_source_mult_d1 == null ? undefined : n(shock.liquidity_source_mult_d1),
      liquidity_source_mult_d7:
        shock.liquidity_source_mult_d7 == null ? undefined : n(shock.liquidity_source_mult_d7),
      liquidity_source_mult_d30:
        shock.liquidity_source_mult_d30 == null ? undefined : n(shock.liquidity_source_mult_d30),
    };
  }
  merged.assetClassMultipliers = mergedAssetMult;
  return merged;
}

async function resolveProfile(args) {
  if (args["profile-id"]) return q1(`SELECT * FROM alm_v3_profiles WHERE id = ?`, [Number(args["profile-id"])]);
  return q1(`SELECT * FROM alm_v3_profiles WHERE code = ? ORDER BY id DESC LIMIT 1`, [String(args["profile-code"] || "ALM_V3_DEFAULT")]);
}

async function resolveBaseRun(profileId, args) {
  if (args["base-run-id"]) return q1(`SELECT * FROM alm_v3_runs WHERE id = ? AND profile_id = ?`, [Number(args["base-run-id"]), profileId]);
  const code = args["base-run-code"];
  if (code) return q1(`SELECT * FROM alm_v3_runs WHERE profile_id = ? AND run_code = ?`, [profileId, String(code)]);
  return q1(`SELECT * FROM alm_v3_runs WHERE profile_id = ? AND run_type = 'daily_snapshot' AND status = 'completed' ORDER BY id DESC LIMIT 1`, [profileId]);
}

async function resolveOrsaSet(profileId, args) {
  if (args["orsa-set-id"]) return q1(`SELECT * FROM orsa_run_sets WHERE id = ?`, [Number(args["orsa-set-id"])]);
  const link = await q1(
    `SELECT ors.* FROM alm_v3_orsa_links l JOIN orsa_run_sets ors ON ors.id = l.orsa_set_id
     WHERE l.profile_id = ? AND l.active = 1 ORDER BY l.id DESC LIMIT 1`,
    [profileId]
  );
  return link || null;
}

async function ensureStressRun(profileId, orsaSetId, baseRun, stressCode, multipliers) {
  const runCode = `${baseRun.run_code}__${stressCode}`;
  const runLabel = `${baseRun.run_label || baseRun.run_code} / ${stressCode}`;
  const scenarioJson = JSON.stringify({ stress_code: stressCode, multipliers });
  const existing = await q1(`SELECT * FROM alm_v3_runs WHERE profile_id = ? AND run_code = ?`, [profileId, runCode]);
  if (existing) {
    await pool.query(
      `UPDATE alm_v3_runs
       SET run_label = ?, status = 'running', run_type = 'stress', orsa_set_id = ?, scenario_json = ?, started_at = NOW(), ended_at = NULL
       WHERE id = ?`,
      [runLabel, orsaSetId || null, scenarioJson, existing.id]
    );
    return existing.id;
  }
  const [ins] = await pool.query(
    `INSERT INTO alm_v3_runs
       (profile_id, orsa_set_id, run_code, run_label, run_type, status, date_from, date_to, as_of_timestamp, scenario_json, methodology_version, started_at)
     VALUES (?, ?, ?, ?, 'stress', 'running', ?, ?, ?, ?, 'alm-v3-stress-v1', NOW())`,
    [profileId, orsaSetId || null, runCode, runLabel, baseRun.date_from, baseRun.date_to, baseRun.as_of_timestamp, scenarioJson]
  );
  return ins.insertId;
}

async function clearStressRunData(runId) {
  const snapIds = (await qa(`SELECT id FROM alm_v3_daily_snapshots WHERE run_id = ?`, [runId])).map((r) => Number(r.id));
  if (snapIds.length) {
    const ph = snapIds.map(() => "?").join(",");
    await pool.query(`DELETE FROM alm_v3_daily_strata_snapshots WHERE snapshot_id IN (${ph})`, snapIds);
    await pool.query(`DELETE FROM alm_v3_daily_asset_class_snapshots WHERE snapshot_id IN (${ph})`, snapIds);
    await pool.query(`DELETE FROM alm_v3_daily_duration_ladder WHERE snapshot_id IN (${ph})`, snapIds);
    await pool.query(`DELETE FROM alm_v3_daily_liquidity_ladder WHERE snapshot_id IN (${ph})`, snapIds);
  }
  await pool.query(`DELETE FROM alm_v3_daily_snapshots WHERE run_id = ?`, [runId]);
  await pool.query(`DELETE FROM alm_v3_run_checks WHERE run_id = ?`, [runId]);
}

async function main() {
  const args = parseArgs(process.argv);
  try {
    const profile = await resolveProfile(args);
    if (!profile) throw new Error("Profil ALM V3 introuvable");
    const baseRun = await resolveBaseRun(profile.id, args);
    if (!baseRun) throw new Error("Run ALM V3 de base introuvable");
    const orsaSet = await resolveOrsaSet(profile.id, args);
    if (!orsaSet) throw new Error("Set ORSA introuvable pour stress ALM V3");

    const members = await qa(
      `SELECT osm.stress_code, osm.assumption_json, osm.run_id FROM orsa_run_set_members osm WHERE osm.orsa_set_id = ? ORDER BY osm.display_order, osm.id`,
      [orsaSet.id]
    );
    const comp = await qa(`SELECT * FROM orsa_run_comparison_snapshots WHERE orsa_set_id = ?`, [orsaSet.id]);
    const compByStress = Object.fromEntries(comp.map((r) => [String(r.stress_code).toUpperCase(), r]));
    const baseComp = compByStress.BASE || comp[0] || null;

    const baseSnapshots = await qa(
      `SELECT * FROM alm_v3_daily_snapshots WHERE run_id = ? ORDER BY business_date`,
      [baseRun.id]
    );
    if (!baseSnapshots.length) throw new Error("Aucun snapshot journalier sur le run ALM de base");

    const baseSnapIds = baseSnapshots.map((s) => Number(s.id));
    const ph = baseSnapIds.map(() => "?").join(",");
    const [baseStrata, baseAssetClass, baseDuration, baseLiquidity] = await Promise.all([
      qa(`SELECT * FROM alm_v3_daily_strata_snapshots WHERE snapshot_id IN (${ph})`, baseSnapIds),
      qa(`SELECT acs.*, ac.asset_code FROM alm_v3_daily_asset_class_snapshots acs JOIN alm_v3_asset_classes ac ON ac.id = acs.asset_class_id WHERE acs.snapshot_id IN (${ph})`, baseSnapIds),
      qa(`SELECT * FROM alm_v3_daily_duration_ladder WHERE snapshot_id IN (${ph})`, baseSnapIds),
      qa(`SELECT * FROM alm_v3_daily_liquidity_ladder WHERE snapshot_id IN (${ph})`, baseSnapIds),
    ]);

    const strataBySnap = new Map();
    for (const r of baseStrata) {
      const k = Number(r.snapshot_id);
      if (!strataBySnap.has(k)) strataBySnap.set(k, []);
      strataBySnap.get(k).push(r);
    }
    const acBySnap = new Map();
    for (const r of baseAssetClass) {
      const k = Number(r.snapshot_id);
      if (!acBySnap.has(k)) acBySnap.set(k, []);
      acBySnap.get(k).push(r);
    }
    const durBySnap = new Map();
    for (const r of baseDuration) {
      const k = Number(r.snapshot_id);
      if (!durBySnap.has(k)) durBySnap.set(k, []);
      durBySnap.get(k).push(r);
    }
    const liqBySnap = new Map();
    for (const r of baseLiquidity) {
      const k = Number(r.snapshot_id);
      if (!liqBySnap.has(k)) liqBySnap.set(k, []);
      liqBySnap.get(k).push(r);
    }

    const targets = members
      .map((m) => ({
        ...m,
        stress_code: String(m.stress_code || "").toUpperCase(),
      }))
      .filter((m) => m.stress_code && m.stress_code !== "BASE");

    const stressOverridesByCode = await loadStressOverrides(profile.id);
    const summary = [];

    for (const t of targets) {
      let multipliers = deriveStressMultipliers(t.stress_code, parseJsonMaybe(t.assumption_json), compByStress[t.stress_code], baseComp);
      multipliers = applyStressOverrides(multipliers, stressOverridesByCode[t.stress_code]);
      const stressRunId = await ensureStressRun(profile.id, orsaSet.id, baseRun, t.stress_code, multipliers);
      await clearStressRunData(stressRunId);

      let snapCount = 0;
      let liqMin = null;
      let durGapAvgNum = 0;
      let durGapAvgDen = 0;

      for (const bs of baseSnapshots) {
        const date = sqlDate(bs.business_date);
        const baseInflows = n(bs.total_liability_inflows);
        const baseOutflows = n(bs.total_liability_outflows);
        const baseAssets = n(bs.total_assets_mv);
        const baseCash = n(bs.total_cash_base_ccy);

        const stressInflows = baseInflows * multipliers.inflowMult;
        const stressOutflows = baseOutflows * multipliers.outflowMult;
        const computedStressCash = baseCash * multipliers.cashMult + (stressInflows - stressOutflows);
        const cashFloor = multipliers.cashFloorPctAssets == null ? null : baseAssets * n(multipliers.cashFloorPctAssets);
        const stressCash = multipliers.allowNegativeCash ? computedStressCash : Math.max(cashFloor ?? 0, computedStressCash);
        let stressAssets = Math.max(0, baseAssets * (baseAssets > 0 ? multipliers.bondMult : 1));
        const rawBuffer = n(bs.liquidity_buffer_available) * multipliers.liquiditySourceMult;
        const stressLiquidityBuffer = multipliers.allowNegativeLiquidityBuffer ? rawBuffer : Math.max(0, rawBuffer);
        const liq1 = n(bs.liquidity_need_1d) * (multipliers.liquidityUseByHorizon?.D1 || multipliers.liquidityUseMult);
        const liq7 = n(bs.liquidity_need_7d) * (multipliers.liquidityUseByHorizon?.D7 || multipliers.liquidityUseMult);
        const liq30 = n(bs.liquidity_need_30d) * (multipliers.liquidityUseByHorizon?.D30 || multipliers.liquidityUseMult);
        const durAssets = n(bs.duration_assets_weighted) + multipliers.durationAssetShiftYears;
        const durLiab = n(bs.duration_liabilities_proxy) * n(multipliers.durationLiabilityMult || Math.max(1, multipliers.outflowMult * 0.95));
        const durGap = durAssets - durLiab;
        const ownFundsProxy = n(bs.own_funds_proxy) * multipliers.ownFundsMult;
        const peakScrStress = multipliers.scrPeakStress > 0 ? multipliers.scrPeakStress : n(bs.stress_peak_scr_ref);

        const [insSnap] = await pool.query(
          `INSERT INTO alm_v3_daily_snapshots
             (run_id, profile_id, business_date, snapshot_timestamp, total_assets_mv, total_assets_bv, total_cash_base_ccy,
              total_liability_inflows, total_liability_outflows, net_liability_cashflow, liquidity_buffer_available,
              liquidity_need_1d, liquidity_need_7d, liquidity_need_30d, duration_assets_weighted, duration_liabilities_proxy,
              duration_gap, own_funds_proxy, stress_peak_scr_ref, comments_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          [
            stressRunId,
            profile.id,
            date,
            `${date} 23:59:59`,
            r2(stressAssets),
            r2(n(bs.total_assets_bv) * multipliers.bondMult),
            r2(stressCash),
            r2(stressInflows),
            r2(stressOutflows),
            r2(stressInflows - stressOutflows),
            r2(stressLiquidityBuffer),
            r2(liq1),
            r2(liq7),
            r2(liq30),
            r6(durAssets),
            r6(durLiab),
            r6(durGap),
            r2(ownFundsProxy),
            r2(peakScrStress),
            JSON.stringify({ stress_code: t.stress_code, multipliers }),
          ]
        );
        const newSnapId = insSnap.insertId;

        // Strata snapshots
        for (const row of strataBySnap.get(Number(bs.id)) || []) {
          const inflows = n(row.inflows_amount) * multipliers.inflowMult;
          const outflows = n(row.outflows_amount) * multipliers.outflowMult;
          const cashBalComputed = n(row.cash_balance) * multipliers.cashMult + (inflows - outflows);
          const cashBal = multipliers.allowNegativeCash ? cashBalComputed : Math.max(0, cashBalComputed);
          const assetsMv = Math.max(0, n(row.assets_mv) * multipliers.bondMult);
          await pool.query(
            `INSERT INTO alm_v3_daily_strata_snapshots
               (snapshot_id, strata_id, business_date, assets_mv, cash_balance, inflows_amount, outflows_amount, net_cashflow_amount, duration_assets_weighted, liquidity_buffer)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newSnapId,
              row.strata_id,
              date,
              r2(assetsMv),
              r2(cashBal),
              r2(inflows),
              r2(outflows),
              r2(inflows - outflows),
              r6(n(row.duration_assets_weighted) + multipliers.durationAssetShiftYears),
              r2(multipliers.allowNegativeLiquidityBuffer ? n(row.liquidity_buffer) * multipliers.liquiditySourceMult : Math.max(0, n(row.liquidity_buffer) * multipliers.liquiditySourceMult)),
            ]
          );
        }

        // Asset class snapshots with differentiated shocks by class
        let stressAssetsRebuilt = 0;
        for (const row of acBySnap.get(Number(bs.id)) || []) {
          const acCode = String(row.asset_code || "");
          const spec = multipliers.assetClassMultipliers?.[acCode] || null;
          let assetMult = multipliers.bondMult;
          if (acCode === "CASH") assetMult = multipliers.cashMult;
          if (acCode === "DIVERS") assetMult = multipliers.riskyAssetMult;
          if (spec?.mv != null) assetMult = n(spec.mv);
          const durShift = spec?.duration_shift != null ? n(spec.duration_shift) : (acCode === "CASH" ? 0 : multipliers.durationAssetShiftYears);
          const stressedMv = n(row.market_value_amount) * assetMult;
          stressAssetsRebuilt += stressedMv;
          await pool.query(
            `INSERT INTO alm_v3_daily_asset_class_snapshots
               (snapshot_id, asset_class_id, business_date, market_value_amount, book_value_amount, share_of_assets_pct, duration_weighted_years, liquidity_horizon_days_weighted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newSnapId,
              row.asset_class_id,
              date,
              r2(stressedMv),
              r2(n(row.book_value_amount) * assetMult),
              n(row.share_of_assets_pct),
              r6(n(row.duration_weighted_years) + durShift),
              row.liquidity_horizon_days_weighted == null ? null : n(row.liquidity_horizon_days_weighted),
            ]
          );
        }
        if (stressAssetsRebuilt > 0) {
          stressAssets = stressAssetsRebuilt;
        }

        // Duration ladder
        let cumGap = 0;
        for (const row of (durBySnap.get(Number(bs.id)) || []).sort((a, b) => Number(a.id) - Number(b.id))) {
          const assetsAmt = n(row.assets_amount) * multipliers.bondMult;
          const liabAmt = n(row.liability_outflows_amount) * multipliers.outflowMult;
          const gap = assetsAmt - liabAmt;
          cumGap += gap;
          await pool.query(
            `INSERT INTO alm_v3_daily_duration_ladder
               (snapshot_id, duration_bucket_id, business_date, assets_amount, liability_outflows_amount, net_gap_amount, cumulative_gap_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newSnapId, row.duration_bucket_id, date, r2(assetsAmt), r2(liabAmt), r2(gap), r2(cumGap)]
          );
        }

        // Liquidity ladder
        let cumL = 0;
        for (const row of (liqBySnap.get(Number(bs.id)) || []).sort((a, b) => Number(a.horizon_days) - Number(b.horizon_days))) {
          const horizon = String(row.horizon_code || "").toUpperCase();
          let srcMult = multipliers.liquiditySourceByHorizon?.[horizon] || multipliers.liquiditySourceMult;
          const useMult = multipliers.liquidityUseByHorizon?.[horizon] || multipliers.liquidityUseMult;
          // Optional additional asset-class liquidity haircut signal by horizon (aggregate proxy)
          const acSpecs = Object.values(multipliers.assetClassMultipliers || {});
          const horizonSpecKeys = horizon === "D1" ? ["liquidity_source_mult_d1"] : horizon === "D7" ? ["liquidity_source_mult_d7"] : ["liquidity_source_mult_d30"];
          const specVals = acSpecs.map((s) => n(s?.[horizonSpecKeys[0]])).filter((v) => v > 0);
          if (specVals.length) {
            const avgSpec = specVals.reduce((a, b) => a + b, 0) / specVals.length;
            srcMult *= avgSpec;
          }
          const src = n(row.liquidity_sources_amount) * srcMult;
          const uses = n(row.liquidity_uses_amount) * useMult;
          const gap = src - uses;
          cumL += gap;
          liqMin = liqMin == null ? gap : Math.min(liqMin, gap);
          await pool.query(
            `INSERT INTO alm_v3_daily_liquidity_ladder
               (snapshot_id, horizon_code, horizon_days, liquidity_sources_amount, liquidity_uses_amount, net_liquidity_gap_amount, cumulative_liquidity_gap_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newSnapId, row.horizon_code, row.horizon_days, r2(src), r2(uses), r2(gap), r2(cumL)]
          );
        }

        durGapAvgNum += durGap;
        durGapAvgDen += 1;
        snapCount += 1;
      }

      await pool.query(
        `INSERT INTO alm_v3_run_checks (run_id, check_code, severity, status, metric_value, message)
         VALUES (?, 'ALM_V3_STRESS_CLONED', 'info', 'pass', ?, ?)`,
        [stressRunId, snapCount, `Run stress ${t.stress_code} généré à partir de ${baseRun.run_code}`]
      );
      await pool.query(
        `INSERT INTO alm_v3_run_checks (run_id, check_code, severity, status, metric_value, message)
         VALUES (?, 'ALM_V3_LIQ_GAP_MIN', 'warning', ?, ?, ?)`,
        [stressRunId, (liqMin != null && liqMin < 0 ? "warn" : "pass"), r2(liqMin || 0), `Gap de liquidité minimum (${t.stress_code})`]
      );
      await pool.query(
        `UPDATE alm_v3_runs SET status='completed', ended_at = NOW() WHERE id = ?`,
        [stressRunId]
      );

      summary.push({
        stress_code: t.stress_code,
        run_id: stressRunId,
        snapshots: snapCount,
        min_liquidity_gap: r2(liqMin || 0),
        avg_duration_gap: r6(durGapAvgDen ? durGapAvgNum / durGapAvgDen : 0),
        multipliers,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          profile: { id: profile.id, code: profile.code },
          base_run: { id: baseRun.id, run_code: baseRun.run_code, date_from: baseRun.date_from, date_to: baseRun.date_to },
          orsa_set: { id: orsaSet.id, code: orsaSet.code },
          generated_stress_runs: summary,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
