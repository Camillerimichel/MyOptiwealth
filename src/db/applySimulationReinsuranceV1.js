import pool from "./pool.js";
import { loadS2EnginePlaceholderConfig, s2CfgNum } from "./s2EngineConfig.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith("--")) args[k] = true;
    else {
      args[k] = n;
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

async function insertBatch(table, cols, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
  const vals = [];
  for (const r of rows) {
    for (const c of cols) vals.push(r[c] ?? null);
  }
  await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${placeholders}`, vals);
}

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

async function ensureReinsurer(name = "SIM REINSURER A") {
  await pool.query(`INSERT IGNORE INTO insurers (name) VALUES (?)`, [name]);
  return q1(`SELECT id, name FROM insurers WHERE name = ? LIMIT 1`, [name]);
}

async function ensureTreaty({
  scenarioId,
  runId,
  captiveId,
  code,
  name,
  treatyType,
  insurerId,
  inceptionDate,
  expiryDate,
}) {
  await pool.query(
    `INSERT INTO reinsurance_treaties
      (scenario_id, run_id, captive_id, code, name, treaty_type, counterparty_insurer_id, inception_date, expiry_date, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'active')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       counterparty_insurer_id = VALUES(counterparty_insurer_id),
       run_id = VALUES(run_id),
       updated_at = CURRENT_TIMESTAMP`,
    [scenarioId, runId, captiveId, code, name, treatyType, insurerId, inceptionDate, expiryDate]
  );
  return q1(`SELECT id FROM reinsurance_treaties WHERE scenario_id = ? AND code = ?`, [scenarioId, code]);
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

    const existing = await q1(`SELECT COUNT(*) AS cnt FROM reinsurance_premium_cessions WHERE run_id = ?`, [runId]);
    if ((existing?.cnt || 0) > 0) throw new Error(`Des cessions prime existent déjà pour run ${runId}`);

    const reinsurer = await ensureReinsurer();

    const treatyMotor = await ensureTreaty({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      code: `SIM_QS_MOTOR_RUN_${runId}`,
      name: "QS Motor 20%",
      treatyType: "QUOTA_SHARE",
      insurerId: reinsurer.id,
      inceptionDate: "2028-01-01",
      expiryDate: "2028-12-31",
    });
    const treatyPI = await ensureTreaty({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      code: `SIM_QS_PI_RUN_${runId}`,
      name: "QS PI 35%",
      treatyType: "QUOTA_SHARE",
      insurerId: reinsurer.id,
      inceptionDate: "2028-01-01",
      expiryDate: "2028-12-31",
    });
    const treatyMedical = await ensureTreaty({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      code: `SIM_QS_MED_RUN_${runId}`,
      name: "QS Medical 55%",
      treatyType: "QUOTA_SHARE",
      insurerId: reinsurer.id,
      inceptionDate: "2028-01-01",
      expiryDate: "2028-12-31",
    });
    const treatyProperty = await ensureTreaty({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      code: `SIM_QS_PROP_RUN_${runId}`,
      name: "QS Property 25%",
      treatyType: "QUOTA_SHARE",
      insurerId: reinsurer.id,
      inceptionDate: "2028-01-01",
      expiryDate: "2028-12-31",
    });

    const treatyByS2 = {
      "10": { id: treatyMotor.id, rate: 0.2 },
      "13": { id: treatyPI.id, rate: 0.35 },
      "02": { id: treatyMedical.id, rate: 0.55 },
      "08": { id: treatyProperty.id, rate: 0.25 },
    };

    const treaties = [treatyMotor.id, treatyPI.id, treatyMedical.id, treatyProperty.id];
    await pool.query(`DELETE FROM reinsurance_treaty_scopes WHERE treaty_id IN (${treaties.map(() => "?").join(",")})`, treaties);
    await pool.query(`DELETE FROM reinsurance_treaty_terms WHERE treaty_id IN (${treaties.map(() => "?").join(",")})`, treaties);

    const branchIds = await qa(`SELECT id_branch, s2_code FROM insurance_branch WHERE captive_id = ?`, [scenario.captive_id]);
    const scopes = [];
    const terms = [];
    for (const b of branchIds) {
      const cfg = treatyByS2[b.s2_code];
      if (!cfg) continue;
      scopes.push({ treaty_id: cfg.id, id_branch: b.id_branch, programme_id: null, priority_order: 1 });
      terms.push({ treaty_id: cfg.id, term_type: "CESSION_RATE", value_numeric: cfg.rate, value_json: null, effective_from: "2028-01-01", effective_to: "2028-12-31" });
    }
    if (scopes.length) {
      await insertBatch("reinsurance_treaty_scopes", ["treaty_id", "id_branch", "programme_id", "priority_order"], scopes);
      await insertBatch("reinsurance_treaty_terms", ["treaty_id", "term_type", "value_numeric", "value_json", "effective_from", "effective_to"], terms);
    }

    const premiumRows = await qa(
      `SELECT
         pt.id AS premium_transaction_id,
         pt.accounting_date,
         pt.amount_gross,
         cc.id_branch,
         ib.s2_code
       FROM premium_transactions pt
       JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
       JOIN insurance_branch ib ON ib.id_branch = cc.id_branch
       WHERE pt.run_id = ? AND pt.transaction_type = 'ISSUED'`,
      [runId]
    );

    const premiumCessions = [];
    let premiumCededTotal = 0;
    for (const r of premiumRows) {
      const cfg = treatyByS2[r.s2_code];
      if (!cfg) continue;
      const ceded = Math.round(Number(r.amount_gross) * cfg.rate * 100) / 100;
      premiumCededTotal += ceded;
      premiumCessions.push({
        scenario_id: scenarioId,
        run_id: runId,
        treaty_id: cfg.id,
        premium_transaction_id: r.premium_transaction_id,
        amount_ceded: ceded,
        commission_reinsurance: Math.round(ceded * 0.12 * 100) / 100,
        net_cost: Math.round(ceded * 0.88 * 100) / 100,
        accounting_date: r.accounting_date,
      });
    }
    for (let i = 0; i < premiumCessions.length; i += 2000) {
      await insertBatch(
        "reinsurance_premium_cessions",
        [
          "scenario_id",
          "run_id",
          "treaty_id",
          "premium_transaction_id",
          "amount_ceded",
          "commission_reinsurance",
          "net_cost",
          "accounting_date",
        ],
        premiumCessions.slice(i, i + 2000)
      );
    }

    const claimRows = await qa(
      `SELECT
         sl.id AS sinistre_ligne_id,
         sl.sinistre_id,
         sl.id_branch,
         ib.s2_code,
         sl.montant_paye,
         sl.montant_estime,
         COALESCE(crs.rbns_gross,0) AS rbns_gross,
         COALESCE(crs.ibnr_gross,0) AS ibnr_gross
       FROM sinistre_lignes sl
       JOIN sinistres s ON s.id = sl.sinistre_id
       JOIN insurance_branch ib ON ib.id_branch = sl.id_branch
       LEFT JOIN claim_reserve_snapshots crs
         ON crs.sinistre_ligne_id = sl.id
        AND crs.run_id = ?
        AND crs.snapshot_date = ?
       WHERE s.description LIKE ?`,
      [runId, snapshotDate, `SIM_RUN_${runId}_%`]
    );

    const claimCessions = [];
    let claimPaidCeded = 0;
    let claimReserveCeded = 0;
    for (const r of claimRows) {
      const cfg = treatyByS2[r.s2_code];
      if (!cfg) continue;
      const paidCed = Math.round(Number(r.montant_paye || 0) * cfg.rate * 100) / 100;
      const reserveCed = Math.round((Number(r.rbns_gross || 0) + Number(r.ibnr_gross || 0)) * cfg.rate * 100) / 100;
      if (paidCed > 0) {
        claimPaidCeded += paidCed;
        claimCessions.push({
          scenario_id: scenarioId,
          run_id: runId,
          treaty_id: cfg.id,
          sinistre_id: r.sinistre_id,
          sinistre_ligne_id: r.sinistre_ligne_id,
          event_date: snapshotDate,
          cession_type: "PAID",
          amount_ceded: paidCed,
          currency: "EUR",
        });
      }
      if (reserveCed > 0) {
        claimReserveCeded += reserveCed;
        claimCessions.push({
          scenario_id: scenarioId,
          run_id: runId,
          treaty_id: cfg.id,
          sinistre_id: r.sinistre_id,
          sinistre_ligne_id: r.sinistre_ligne_id,
          event_date: snapshotDate,
          cession_type: "RESERVE",
          amount_ceded: reserveCed,
          currency: "EUR",
        });
      }
    }
    for (let i = 0; i < claimCessions.length; i += 2000) {
      await insertBatch(
        "reinsurance_claim_cessions",
        [
          "scenario_id",
          "run_id",
          "treaty_id",
          "sinistre_id",
          "sinistre_ligne_id",
          "event_date",
          "cession_type",
          "amount_ceded",
          "currency",
        ],
        claimCessions.slice(i, i + 2000)
      );
    }

    // Update net reserve fields at snapshot (using QS cessions).
    const reserveRateByLine = await qa(
      `SELECT
         rcc.sinistre_ligne_id,
         SUM(CASE WHEN rcc.cession_type = 'RESERVE' THEN rcc.amount_ceded ELSE 0 END) AS reserve_ceded
       FROM reinsurance_claim_cessions rcc
       WHERE rcc.run_id = ? AND rcc.event_date = ?
       GROUP BY rcc.sinistre_ligne_id`,
      [runId, snapshotDate]
    );
    const reserveMap = new Map(reserveRateByLine.map((r) => [r.sinistre_ligne_id, Number(r.reserve_ceded || 0)]));
    const reserveSnaps = await qa(
      `SELECT id, sinistre_ligne_id, rbns_gross, ibnr_gross
       FROM claim_reserve_snapshots
       WHERE run_id = ? AND snapshot_date = ?`,
      [runId, snapshotDate]
    );
    for (const rs of reserveSnaps) {
      const ceded = reserveMap.get(rs.sinistre_ligne_id) || 0;
      const grossReserve = Number(rs.rbns_gross || 0) + Number(rs.ibnr_gross || 0);
      const ratio = grossReserve > 0 ? Math.min(1, Math.max(0, ceded / grossReserve)) : 0;
      const rbnsNet = Math.round(Number(rs.rbns_gross || 0) * (1 - ratio) * 100) / 100;
      const ibnrNet = Math.round(Number(rs.ibnr_gross || 0) * (1 - ratio) * 100) / 100;
      await pool.query(
        `UPDATE claim_reserve_snapshots
         SET rbns_net = ?, ibnr_net = ?
         WHERE id = ?`,
        [rbnsNet, ibnrNet, rs.id]
      );
    }

    // Recompute net portfolio snapshots by branch.
    const netByBranchPremium = await qa(
      `SELECT
         cc.id_branch,
         SUM(rpc.amount_ceded) AS premium_ceded
       FROM reinsurance_premium_cessions rpc
       JOIN premium_transactions pt ON pt.id = rpc.premium_transaction_id
       JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
       WHERE rpc.run_id = ?
       GROUP BY cc.id_branch`,
      [runId]
    );
    const netByBranchClaims = await qa(
      `SELECT
         sl.id_branch,
         SUM(CASE WHEN rcc.cession_type = 'PAID' THEN rcc.amount_ceded ELSE 0 END) AS paid_ceded,
         SUM(CASE WHEN rcc.cession_type = 'RESERVE' THEN rcc.amount_ceded ELSE 0 END) AS reserve_ceded
       FROM reinsurance_claim_cessions rcc
       JOIN sinistre_lignes sl ON sl.id = rcc.sinistre_ligne_id
       WHERE rcc.run_id = ?
       GROUP BY sl.id_branch`,
      [runId]
    );
    const cedPremMap = new Map(netByBranchPremium.map((r) => [r.id_branch, Number(r.premium_ceded || 0)]));
    const cedClaimMap = new Map(
      netByBranchClaims.map((r) => [
        r.id_branch,
        { paid: Number(r.paid_ceded || 0), reserve: Number(r.reserve_ceded || 0) },
      ])
    );

    const pbsRows = await qa(`SELECT id, id_branch, gwp_gross, paid_gross, incurred_gross FROM portfolio_branch_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
    for (const r of pbsRows) {
      const premCed = cedPremMap.get(r.id_branch) || 0;
      const cl = cedClaimMap.get(r.id_branch) || { paid: 0, reserve: 0 };
      const paidNet = Math.max(0, Number(r.paid_gross || 0) - cl.paid);
      const incurredNet = Math.max(0, Number(r.incurred_gross || 0) - cl.paid - cl.reserve);
      const gwpNet = Math.max(0, Number(r.gwp_gross || 0) - premCed);
      await pool.query(
        `UPDATE portfolio_branch_snapshots
         SET gwp_net = ?, earned_net = ?, paid_net = ?, incurred_net = ?
         WHERE id = ?`,
        [gwpNet, gwpNet, paidNet, incurredNet, r.id]
      );
    }

    // Refresh S2 counterparty exposure and net-based result placeholder.
    await pool.query(
      `UPDATE s2_scr_inputs_non_life s2
       JOIN (
         SELECT pbs.id_branch,
                COALESCE(pbs.gwp_gross - pbs.gwp_net,0) + COALESCE(pbs.incurred_gross - pbs.incurred_net,0) AS ceded_exposure
         FROM portfolio_branch_snapshots pbs
         WHERE pbs.run_id = ? AND pbs.snapshot_date = ?
       ) x ON x.id_branch = s2.id_branch
       SET s2.counterparty_exposure = x.ceded_exposure
       WHERE s2.run_id = ? AND s2.snapshot_date = ?`,
      [runId, snapshotDate, runId, snapshotDate]
    );

    const s2agg = await q1(
      `SELECT
         SUM(COALESCE(premium_volume,0) * COALESCE(sigma_premium,0)) AS prem_charge,
         SUM(COALESCE(reserve_volume,0) * COALESCE(sigma_reserve,0)) AS reserve_charge,
         SUM(COALESCE(cat_exposure,0) * ?) AS cat_charge,
         SUM(COALESCE(counterparty_exposure,0) * ?) AS cpty_charge
       FROM s2_scr_inputs_non_life
       WHERE run_id = ? AND snapshot_date = ?`,
      [
        s2CfgNum(s2Cfg, "reinsurance_v1.cat_charge_factor", 0.25),
        s2CfgNum(s2Cfg, "reinsurance_v1.counterparty_charge_factor", 0.08),
        runId,
        snapshotDate,
      ]
    );
    const scrNonLife =
      (Number(s2agg.prem_charge || 0) + Number(s2agg.reserve_charge || 0) + Number(s2agg.cat_charge || 0)) *
      s2CfgNum(s2Cfg, "reinsurance_v1.nonlife_multiplier", 0.78);
    const scrCounterparty = Number(s2agg.cpty_charge || 0);
    const scrOperational = s2CfgNum(s2Cfg, "reinsurance_v1.operational_fixed_eur", 350000);
    const scrTotal = scrNonLife + scrCounterparty + scrOperational;
    const ownFunds = s2CfgNum(s2Cfg, "own_funds_eligible_base_eur", 12_000_000);
    await pool.query(
      `UPDATE s2_scr_results
       SET scr_non_life = ?, scr_counterparty = ?, scr_operational = ?, scr_bscr = ?, scr_total = ?,
           own_funds_eligible = ?, solvency_ratio_pct = ?, methodology_version = 'v1-qs-placeholder'
       WHERE run_id = ? AND snapshot_date = ?`,
      [
        Math.round(scrNonLife * 100) / 100,
        Math.round(scrCounterparty * 100) / 100,
        scrOperational,
        Math.round((scrNonLife + scrCounterparty) * 100) / 100,
        Math.round(scrTotal * 100) / 100,
        ownFunds,
        Math.round((ownFunds / scrTotal) * 10000) / 100,
        runId,
        snapshotDate,
      ]
    );

    await addCheck(runId, "REINSURANCE_APPLIED", "info", "pass", "QS réassurance appliquée (primes/sinistres).", Math.round(premiumCededTotal * 100) / 100);

    console.log(
      JSON.stringify(
        {
          ok: true,
          run_id: runId,
          scenario_id: scenarioId,
          premium_cessions: premiumCessions.length,
          claim_cessions: claimCessions.length,
          premium_ceded_total: Math.round(premiumCededTotal * 100) / 100,
          claim_paid_ceded_total: Math.round(claimPaidCeded * 100) / 100,
          claim_reserve_ceded_total: Math.round(claimReserveCeded * 100) / 100,
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
