import fs from "node:fs/promises";
import path from "node:path";
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

async function getFrontingSummaryByRun(orsaSetId) {
  const rows = await qa(
    `SELECT
       osm.run_id,
       ors.snapshot_date,
       COUNT(fra.id) AS fronting_adjustment_count,
       COALESCE(SUM(fra.fronting_fee_amount),0) AS fronting_fee_total,
       COALESCE(SUM(fra.claims_handling_fee_amount),0) AS claims_handling_fee_total,
       COALESCE(SUM(fra.fronting_fee_amount + fra.claims_handling_fee_amount),0) AS fronting_total_cost,
       COALESCE(SUM(fra.premium_net_to_captive_after_fees),0) AS fronting_premium_net_to_captive,
       COALESCE(SUM(fra.estimated_counterparty_exposure),0) AS fronting_counterparty_exposure_est
     FROM orsa_run_set_members osm
     JOIN orsa_run_sets ors ON ors.id = osm.orsa_set_id
     LEFT JOIN fronting_run_adjustments fra
       ON fra.run_id = osm.run_id
      AND fra.snapshot_date = ors.snapshot_date
     WHERE osm.orsa_set_id = ?
     GROUP BY osm.run_id, ors.snapshot_date`,
    [orsaSetId]
  );
  return Object.fromEntries(
    rows.map((r) => [
      Number(r.run_id),
      {
        fronting_adjustment_count: Number(r.fronting_adjustment_count || 0),
        fronting_fee_total: Number(r.fronting_fee_total || 0),
        claims_handling_fee_total: Number(r.claims_handling_fee_total || 0),
        fronting_total_cost: Number(r.fronting_total_cost || 0),
        fronting_premium_net_to_captive: Number(r.fronting_premium_net_to_captive || 0),
        fronting_counterparty_exposure_est: Number(r.fronting_counterparty_exposure_est || 0),
      },
    ])
  );
}

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const orsaSetId = Number(args["orsa-set-id"] || 1);
  const outDir = String(args["out-dir"] || "/tmp");

  try {
    const setRow = await q1(
      `SELECT ors.*, ss.code AS scenario_code, ss.name AS scenario_name
       FROM orsa_run_sets ors
       JOIN simulation_scenarios ss ON ss.id = ors.scenario_id
       WHERE ors.id = ?`,
      [orsaSetId]
    );
    if (!setRow) throw new Error(`ORSA set ${orsaSetId} introuvable`);

    const members = await qa(
      `SELECT osm.stress_code, osm.display_order, osm.run_id, sr.run_label, sr.status, osm.assumption_json
       FROM orsa_run_set_members osm
       JOIN simulation_runs sr ON sr.id = osm.run_id
       WHERE osm.orsa_set_id = ?
       ORDER BY osm.display_order`,
      [orsaSetId]
    );

    let comparison = await qa(
      `SELECT
         stress_code,
         run_id,
         snapshot_date,
         ROUND(gwp_total,2) AS gwp_total,
         ROUND(claims_paid_total,2) AS claims_paid_total,
         ROUND(claims_incurred_total,2) AS claims_incurred_total,
         ROUND(rbns_total,2) AS rbns_total,
         ROUND(ibnr_total,2) AS ibnr_total,
         ROUND(premium_ceded_total,2) AS premium_ceded_total,
         ROUND(claims_ceded_total,2) AS claims_ceded_total,
         ROUND(scr_non_life,2) AS scr_non_life,
         ROUND(scr_counterparty,2) AS scr_counterparty,
         ROUND(scr_market,2) AS scr_market,
         ROUND(scr_operational,2) AS scr_operational,
         ROUND(scr_total,2) AS scr_total,
         ROUND(mcr,2) AS mcr,
         ROUND(own_funds_eligible,2) AS own_funds_eligible,
         ROUND(solvency_ratio_pct,2) AS solvency_ratio_pct,
         ROUND(property_cat_loss_gross,2) AS property_cat_loss_gross,
         ROUND(property_cat_exposure_s2,2) AS property_cat_exposure_s2,
         ROUND(property_geo_hhi,6) AS property_geo_hhi,
         ROUND(top_broker_gwp_share_pct * 100,2) AS top_broker_gwp_share_pct,
         ROUND(top20_broker_gwp_share_pct * 100,2) AS top20_broker_gwp_share_pct,
         methodology_version
       FROM orsa_run_comparison_snapshots
       WHERE orsa_set_id = ?
       ORDER BY FIELD(stress_code, 'BASE', 'ADVERSE', 'SEVERE'), stress_code`,
      [orsaSetId]
    );

    const frontingByRun = await getFrontingSummaryByRun(orsaSetId);
    comparison = comparison.map((r) => ({
      ...r,
      fronting_adjustment_count: frontingByRun[Number(r.run_id)]?.fronting_adjustment_count ?? 0,
      fronting_fee_total: Math.round((frontingByRun[Number(r.run_id)]?.fronting_fee_total ?? 0) * 100) / 100,
      claims_handling_fee_total: Math.round((frontingByRun[Number(r.run_id)]?.claims_handling_fee_total ?? 0) * 100) / 100,
      fronting_total_cost: Math.round((frontingByRun[Number(r.run_id)]?.fronting_total_cost ?? 0) * 100) / 100,
      fronting_premium_net_to_captive: Math.round((frontingByRun[Number(r.run_id)]?.fronting_premium_net_to_captive ?? 0) * 100) / 100,
      fronting_counterparty_exposure_est: Math.round((frontingByRun[Number(r.run_id)]?.fronting_counterparty_exposure_est ?? 0) * 100) / 100,
    }));

    const deltas = [];
    const base = comparison.find((r) => r.stress_code === "BASE");
    if (base) {
      for (const row of comparison) {
        deltas.push({
          stress_code: row.stress_code,
          run_id: row.run_id,
          delta_gwp_total: Number(row.gwp_total) - Number(base.gwp_total),
          delta_claims_incurred_total: Number(row.claims_incurred_total) - Number(base.claims_incurred_total),
          delta_scr_total: Number(row.scr_total) - Number(base.scr_total),
          delta_solvency_ratio_pct: Number(row.solvency_ratio_pct) - Number(base.solvency_ratio_pct),
          delta_property_cat_exposure_s2: Number(row.property_cat_exposure_s2) - Number(base.property_cat_exposure_s2),
          delta_fronting_total_cost: Number(row.fronting_total_cost || 0) - Number(base.fronting_total_cost || 0),
        });
      }
    }

    const payload = {
      generated_at: new Date().toISOString(),
      orsa_set: setRow,
      members,
      comparison,
      deltas_vs_base: deltas,
    };

    await fs.mkdir(outDir, { recursive: true });
    const safeCode = String(setRow.code).replace(/[^a-zA-Z0-9_-]/g, "_");
    const jsonPath = path.join(outDir, `orsa_${safeCode}_report.json`);
    const csvPath = path.join(outDir, `orsa_${safeCode}_comparison.csv`);
    const deltaCsvPath = path.join(outDir, `orsa_${safeCode}_deltas.csv`);

    await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.writeFile(csvPath, toCsv(comparison), "utf8");
    await fs.writeFile(deltaCsvPath, toCsv(deltas), "utf8");

    console.log(
      JSON.stringify(
        {
          ok: true,
          orsa_set_id: orsaSetId,
          files: {
            json: jsonPath,
            comparison_csv: csvPath,
            deltas_csv: deltaCsvPath,
          },
          rows: {
            members: members.length,
            comparison: comparison.length,
            deltas: deltas.length,
          },
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
