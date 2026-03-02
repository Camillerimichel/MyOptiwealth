import pool from "./pool.js";
import { loadS2EnginePlaceholderConfig, s2CfgNum } from "./s2EngineConfig.js";

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

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const runId = Number(args["run-id"] || 3);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");

  try {
    const scenario = await q1(`SELECT id, captive_id FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario) throw new Error(`Scenario ${scenarioId} introuvable`);
    const s2Cfg = await loadS2EnginePlaceholderConfig(scenarioId);

    const propertyBranch = await q1(
      `SELECT id_branch FROM insurance_branch WHERE captive_id = ? AND s2_code = '08' LIMIT 1`,
      [scenario.captive_id]
    );
    if (!propertyBranch) throw new Error("Branche Property (08) introuvable");

    const catConc = await qa(
      `SELECT
         geo_code,
         property_gwp_gross,
         weighted_cat_exposure,
         property_gwp_share_pct,
         property_si_share_pct,
         cat_event_count,
         cat_impacted_gwp_gross
       FROM cat_concentration_snapshots
       WHERE run_id = ? AND snapshot_date = ?`,
      [runId, snapshotDate]
    );
    if (!catConc.length) throw new Error(`Aucune concentration CAT trouvée pour run ${runId} (${snapshotDate})`);

    const sumWeightedExposure = catConc.reduce((s, r) => s + Number(r.weighted_cat_exposure || 0), 0);
    const maxZoneShare = Math.max(...catConc.map((r) => Number(r.property_si_share_pct || 0)));
    const impactedGwp = catConc.reduce((s, r) => s + Number(r.cat_impacted_gwp_gross || 0), 0);
    const catEventCount = catConc.reduce((s, r) => s + Number(r.cat_event_count || 0), 0);
    const hhi = catConc.reduce((s, r) => s + Number(r.property_gwp_share_pct || 0) ** 2, 0);

    // Cat proxy from geo concentration:
    // base on weighted property SI, amplified by concentration and active CAT events.
    const geoStressFactor = 0.008; // placeholder scalar
    const concentrationMultiplier = 1 + hhi; // >1 if concentrated
    const eventMultiplier = 1 + Math.min(1, catEventCount / 10);
    const catExposureGeoDerived =
      sumWeightedExposure * geoStressFactor * concentrationMultiplier * eventMultiplier;

    await pool.query(
      `UPDATE s2_scr_inputs_non_life
       SET cat_exposure = CASE
         WHEN id_branch = ? THEN ?
         ELSE cat_exposure
       END
       WHERE run_id = ? AND snapshot_date = ?`,
      [propertyBranch.id_branch, Math.round(catExposureGeoDerived * 100) / 100, runId, snapshotDate]
    );

    // Recompute S2 placeholder with cat sourced from geo concentration.
    const agg = await q1(
      `SELECT
         SUM(COALESCE(premium_volume,0) * COALESCE(sigma_premium,0)) AS prem_charge,
         SUM(COALESCE(reserve_volume,0) * COALESCE(sigma_reserve,0)) AS reserve_charge,
         SUM(COALESCE(cat_exposure,0) * 0.30) AS cat_charge,
         SUM(COALESCE(counterparty_exposure,0) * 0.10) AS cpty_charge
       FROM s2_scr_inputs_non_life
       WHERE run_id = ? AND snapshot_date = ?`,
      [runId, snapshotDate]
    );

    const scrNonLife =
      (Number(agg.prem_charge || 0) + Number(agg.reserve_charge || 0) + Number(agg.cat_charge || 0)) *
      0.76;
    const scrCounterparty = Number(agg.cpty_charge || 0);
    const scrMarket = 0;
    const scrOperational = 450000;
    const scrBscr = scrNonLife + scrCounterparty + scrMarket;
    const scrTotal = scrBscr + scrOperational;

    const current = await q1(
      `SELECT own_funds_eligible, mcr FROM s2_scr_results WHERE run_id = ? AND snapshot_date = ?`,
      [runId, snapshotDate]
    );
    const ownFunds = Number(current?.own_funds_eligible || s2CfgNum(s2Cfg, "own_funds_eligible_base_eur", 12000000));
    const mcr = Number(current?.mcr || s2CfgNum(s2Cfg, "mcr_eur", 2700000));
    const solvencyRatioPct = scrTotal > 0 ? (ownFunds / scrTotal) * 100 : null;

    await pool.query(
      `UPDATE s2_scr_results
       SET scr_non_life = ?,
           scr_counterparty = ?,
           scr_market = ?,
           scr_operational = ?,
           scr_bscr = ?,
           scr_total = ?,
           mcr = ?,
           own_funds_eligible = ?,
           solvency_ratio_pct = ?,
           methodology_version = 'v3-geo-cat-s2-placeholder'
       WHERE run_id = ? AND snapshot_date = ?`,
      [
        Math.round(scrNonLife * 100) / 100,
        Math.round(scrCounterparty * 100) / 100,
        scrMarket,
        scrOperational,
        Math.round(scrBscr * 100) / 100,
        Math.round(scrTotal * 100) / 100,
        mcr,
        ownFunds,
        solvencyRatioPct ? Math.round(solvencyRatioPct * 100) / 100 : null,
        runId,
        snapshotDate,
      ]
    );

    await addCheck(
      runId,
      "S2_GEO_CAT_RECOMPUTED",
      "info",
      "pass",
      "Cat exposure S2 recalculée à partir de la concentration géographique Property.",
      Math.round(catExposureGeoDerived * 100) / 100
    );

    const propertyS2 = await q1(
      `SELECT premium_volume, reserve_volume, cat_exposure, counterparty_exposure
       FROM s2_scr_inputs_non_life
       WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
      [runId, snapshotDate, propertyBranch.id_branch]
    );
    const s2 = await q1(
      `SELECT scr_non_life, scr_counterparty, scr_total, solvency_ratio_pct, methodology_version
       FROM s2_scr_results
       WHERE run_id = ? AND snapshot_date = ?`,
      [runId, snapshotDate]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario_id: scenarioId,
          run_id: runId,
          snapshot_date: snapshotDate,
          geo_cat_inputs: {
            zones_count: catConc.length,
            sum_weighted_exposure: Math.round(sumWeightedExposure * 100) / 100,
            hhi: Number(hhi.toFixed(6)),
            max_zone_share_pct: Number((maxZoneShare * 100).toFixed(2)),
            impacted_gwp: Math.round(impactedGwp * 100) / 100,
            cat_event_count_total: catEventCount,
            cat_exposure_geo_derived: Math.round(catExposureGeoDerived * 100) / 100,
          },
          property_s2_input: propertyS2,
          s2_results: s2,
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
