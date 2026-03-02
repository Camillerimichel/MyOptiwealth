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

async function qa(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function q1(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function insertBatch(table, cols, rows) {
  if (!rows.length) return;
  const ph = rows.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
  const vals = [];
  for (const r of rows) {
    for (const c of cols) vals.push(r[c] ?? null);
  }
  await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph}`, vals);
}

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

function zoneLabel(code) {
  const m = {
    "FR-IDF": "Ile-de-France",
    "FR-ARA": "Auvergne-Rhone-Alpes",
    "FR-NAQ": "Nouvelle-Aquitaine",
    "FR-PAC": "Provence-Alpes-Cote d'Azur",
    "FR-HDF": "Hauts-de-France",
    "FR-OCC": "Occitanie",
  };
  return m[code] || code;
}

function baseCatWeight(geoCode) {
  const m = {
    "FR-IDF": 0.8,
    "FR-ARA": 1.0,
    "FR-NAQ": 1.2,
    "FR-PAC": 1.35,
    "FR-HDF": 0.95,
    "FR-OCC": 1.25,
  };
  return m[geoCode] ?? 1.0;
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const runId = Number(args["run-id"] || 3);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");

  try {
    const scenario = await q1(`SELECT id FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario) throw new Error(`Scenario ${scenarioId} introuvable`);

    const propertyBranch = await q1(
      `SELECT id_branch FROM insurance_branch WHERE captive_id = (SELECT captive_id FROM simulation_scenarios WHERE id = ?) AND s2_code='08'`,
      [scenarioId]
    );
    if (!propertyBranch) throw new Error("Branche Property (S2 08) introuvable");

    const zones = await qa(
      `SELECT DISTINCT csp.geo_code
       FROM client_simulation_profiles csp
       WHERE csp.scenario_id = ? AND csp.geo_code IS NOT NULL`,
      [scenarioId]
    );
    for (const z of zones) {
      await pool.query(
        `INSERT IGNORE INTO geo_zones (code, country_code, region_name, zone_type)
         VALUES (?, 'FR', ?, 'region')`,
        [z.geo_code, zoneLabel(z.geo_code)]
      );
    }

    await pool.query(`DELETE FROM contract_geo_exposures WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
    const propertyRows = await qa(
      `SELECT
         pt.id AS premium_transaction_id,
         pt.amount_gross,
         pt.contract_id,
         pt.contract_coverage_id,
         c.client_id,
         c.partner_id,
         cc.id_branch,
         cc.limit_per_claim,
         cc.limit_annual,
         csp.geo_code
       FROM premium_transactions pt
       JOIN contracts c ON c.id = pt.contract_id
       JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
       JOIN insurance_branch ib ON ib.id_branch = cc.id_branch
       LEFT JOIN client_simulation_profiles csp
         ON csp.client_id = c.client_id
        AND csp.scenario_id = ?
       WHERE pt.run_id = ?
         AND pt.transaction_type = 'ISSUED'
         AND ib.s2_code = '08'`,
      [scenarioId, runId]
    );

    const geoExpoRows = propertyRows.map((r) => {
      const geo = r.geo_code || "FR-IDF";
      const insuredValue = Number(r.limit_annual || r.limit_per_claim || 0);
      return {
        scenario_id: scenarioId,
        run_id: runId,
        contract_id: r.contract_id,
        contract_coverage_id: r.contract_coverage_id,
        client_id: r.client_id,
        partner_id: r.partner_id,
        id_branch: r.id_branch,
        geo_code: geo,
        insured_value: insuredValue,
        cat_weight: baseCatWeight(geo),
        premium_gross: Number(r.amount_gross || 0),
        snapshot_date: snapshotDate,
      };
    });

    for (let i = 0; i < geoExpoRows.length; i += 2000) {
      await insertBatch(
        "contract_geo_exposures",
        [
          "scenario_id",
          "run_id",
          "contract_id",
          "contract_coverage_id",
          "client_id",
          "partner_id",
          "id_branch",
          "geo_code",
          "insured_value",
          "cat_weight",
          "premium_gross",
          "snapshot_date",
        ],
        geoExpoRows.slice(i, i + 2000)
      );
    }

    await pool.query(`DELETE FROM cat_event_zone_impacts WHERE cat_event_id IN (SELECT id FROM cat_events WHERE run_id = ?)`, [runId]);
    const catEvents = await qa(`SELECT id, geo_scope_json, severity_index, loss_multiplier FROM cat_events WHERE run_id = ?`, [runId]);
    const impactRows = [];
    for (const ce of catEvents) {
      let regions = [];
      try {
        const parsed = ce.geo_scope_json ? JSON.parse(ce.geo_scope_json) : {};
        if (Array.isArray(parsed.regions)) regions = parsed.regions;
      } catch {
        regions = [];
      }
      if (!regions.length) continue;
      for (const g of regions) {
        impactRows.push({
          cat_event_id: ce.id,
          geo_code: g,
          intensity_factor: Number(((Number(ce.severity_index || 1) * Number(ce.loss_multiplier || 1)) / Math.max(1, regions.length)).toFixed(6)),
        });
      }
    }
    if (impactRows.length) {
      for (let i = 0; i < impactRows.length; i += 500) {
        await insertBatch("cat_event_zone_impacts", ["cat_event_id", "geo_code", "intensity_factor"], impactRows.slice(i, i + 500));
      }
    }

    await pool.query(`DELETE FROM cat_concentration_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);

    const zoneAgg = await qa(
      `SELECT
         cge.geo_code,
         COUNT(*) AS property_contracts_count,
         COUNT(DISTINCT cge.client_id) AS property_clients_count,
         SUM(COALESCE(cge.premium_gross,0)) AS property_gwp_gross,
         SUM(COALESCE(cge.insured_value,0)) AS property_sum_insured,
         SUM(COALESCE(cge.insured_value,0) * COALESCE(cge.cat_weight,1)) AS weighted_cat_exposure
       FROM contract_geo_exposures cge
       WHERE cge.run_id = ? AND cge.snapshot_date = ?
       GROUP BY cge.geo_code`,
      [runId, snapshotDate]
    );
    const catZoneAgg = await qa(
      `SELECT
         cge.geo_code,
         COUNT(DISTINCT cezi.cat_event_id) AS cat_event_count,
         COUNT(DISTINCT cge.contract_coverage_id) AS cat_impacted_contracts_count,
         SUM(COALESCE(cge.premium_gross,0)) AS cat_impacted_gwp_gross
       FROM cat_event_zone_impacts cezi
       JOIN cat_events ce ON ce.id = cezi.cat_event_id
       JOIN contract_geo_exposures cge
         ON cge.geo_code = cezi.geo_code
        AND cge.run_id = ce.run_id
        AND cge.snapshot_date = ?
       WHERE ce.run_id = ?
       GROUP BY cge.geo_code`,
      [snapshotDate, runId]
    );
    const catMap = new Map(catZoneAgg.map((r) => [r.geo_code, r]));
    const totalGwp = zoneAgg.reduce((s, r) => s + Number(r.property_gwp_gross || 0), 0) || 1;
    const totalSI = zoneAgg.reduce((s, r) => s + Number(r.property_sum_insured || 0), 0) || 1;

    const rows = zoneAgg.map((r) => {
      const cat = catMap.get(r.geo_code) || {};
      const gwpShare = Number(r.property_gwp_gross || 0) / totalGwp;
      return {
        scenario_id: scenarioId,
        run_id: runId,
        snapshot_date: snapshotDate,
        geo_code: r.geo_code,
        property_contracts_count: Number(r.property_contracts_count || 0),
        property_clients_count: Number(r.property_clients_count || 0),
        property_gwp_gross: Number(r.property_gwp_gross || 0),
        property_sum_insured: Number(r.property_sum_insured || 0),
        property_gwp_share_pct: Number(gwpShare.toFixed(8)),
        property_si_share_pct: Number((Number(r.property_sum_insured || 0) / totalSI).toFixed(8)),
        cat_event_count: Number(cat.cat_event_count || 0),
        cat_impacted_contracts_count: Number(cat.cat_impacted_contracts_count || 0),
        cat_impacted_gwp_gross: Number(cat.cat_impacted_gwp_gross || 0),
        weighted_cat_exposure: Number(r.weighted_cat_exposure || 0),
        hhi_contribution: Number((gwpShare * gwpShare).toFixed(10)),
      };
    });
    await insertBatch(
      "cat_concentration_snapshots",
      [
        "scenario_id",
        "run_id",
        "snapshot_date",
        "geo_code",
        "property_contracts_count",
        "property_clients_count",
        "property_gwp_gross",
        "property_sum_insured",
        "property_gwp_share_pct",
        "property_si_share_pct",
        "cat_event_count",
        "cat_impacted_contracts_count",
        "cat_impacted_gwp_gross",
        "weighted_cat_exposure",
        "hhi_contribution",
      ],
      rows
    );

    const topZones = await qa(
      `SELECT geo_code, property_gwp_gross, property_gwp_share_pct, cat_event_count, cat_impacted_gwp_gross
       FROM cat_concentration_snapshots
       WHERE run_id = ? AND snapshot_date = ?
       ORDER BY property_gwp_gross DESC
       LIMIT 3`,
      [runId, snapshotDate]
    );

    await addCheck(runId, "CAT_GEO_CONCENTRATION_BUILT", "info", "pass", "Concentration CAT géographique calculée.", rows.length);

    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario_id: scenarioId,
          run_id: runId,
          snapshot_date: snapshotDate,
          zones_count: rows.length,
          property_exposures_count: geoExpoRows.length,
          cat_event_zone_impacts_count: impactRows.length,
          top_zones: topZones,
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

