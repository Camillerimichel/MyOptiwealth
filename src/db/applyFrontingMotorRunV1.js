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

async function insertBatch(table, cols, rows) {
  if (!rows.length) return;
  const ph = rows.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
  const vals = [];
  for (const r of rows) for (const c of cols) vals.push(r[c] ?? null);
  await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph}`, vals);
}

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

async function ensureInsurer(name) {
  await pool.query(`INSERT IGNORE INTO insurers (name) VALUES (?)`, [name]);
  return q1(`SELECT id, name FROM insurers WHERE name = ?`, [name]);
}

async function ensureFrontingTreaty({ scenarioId, runId, captiveId, insurerId }) {
  const code = `SIM_FRONTING_MOTOR_RUN_${runId}`;
  await pool.query(
    `INSERT INTO reinsurance_treaties
      (scenario_id, run_id, captive_id, code, name, treaty_type, counterparty_insurer_id, inception_date, expiry_date, currency, status)
     VALUES (?, ?, ?, ?, ?, 'FRONTING', ?, '2028-01-01', '2028-12-31', 'EUR', 'active')
     ON DUPLICATE KEY UPDATE
       counterparty_insurer_id = VALUES(counterparty_insurer_id),
       run_id = VALUES(run_id),
       updated_at = CURRENT_TIMESTAMP`,
    [scenarioId, runId, captiveId, code, "Fronting Motor 100%", insurerId]
  );
  const treaty = await q1(`SELECT id FROM reinsurance_treaties WHERE scenario_id = ? AND code = ?`, [scenarioId, code]);
  return treaty;
}

async function recomputeNetAndS2Baseline(runId, snapshotDate) {
  // Reset reserve net to gross
  await pool.query(
    `UPDATE claim_reserve_snapshots
     SET rbns_net = rbns_gross, ibnr_net = ibnr_gross
     WHERE run_id = ? AND snapshot_date = ?`,
    [runId, snapshotDate]
  );

  // Apply reserve cessions to reserve net
  const reserveCeded = await qa(
    `SELECT sinistre_ligne_id, SUM(amount_ceded) AS reserve_ceded
     FROM reinsurance_claim_cessions
     WHERE run_id = ? AND event_date = ? AND cession_type = 'RESERVE' AND sinistre_ligne_id IS NOT NULL
     GROUP BY sinistre_ligne_id`,
    [runId, snapshotDate]
  );
  const reserveMap = new Map(reserveCeded.map((r) => [r.sinistre_ligne_id, Number(r.reserve_ceded || 0)]));
  const snaps = await qa(
    `SELECT id, sinistre_ligne_id, rbns_gross, ibnr_gross
     FROM claim_reserve_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [runId, snapshotDate]
  );
  for (const rs of snaps) {
    const gross = Number(rs.rbns_gross || 0) + Number(rs.ibnr_gross || 0);
    const ceded = reserveMap.get(rs.sinistre_ligne_id) || 0;
    const ratio = gross > 0 ? Math.min(1, ceded / gross) : 0;
    await pool.query(
      `UPDATE claim_reserve_snapshots
       SET rbns_net = ?, ibnr_net = ?
       WHERE id = ?`,
      [
        Math.round(Number(rs.rbns_gross || 0) * (1 - ratio) * 100) / 100,
        Math.round(Number(rs.ibnr_gross || 0) * (1 - ratio) * 100) / 100,
        rs.id,
      ]
    );
  }

  const premByBranch = await qa(
    `SELECT cc.id_branch, SUM(rpc.amount_ceded) AS premium_ceded
     FROM reinsurance_premium_cessions rpc
     JOIN premium_transactions pt ON pt.id = rpc.premium_transaction_id
     JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
     WHERE rpc.run_id = ?
     GROUP BY cc.id_branch`,
    [runId]
  );
  const claimByBranch = await qa(
    `SELECT sl.id_branch,
            SUM(CASE WHEN rcc.cession_type='PAID' THEN rcc.amount_ceded ELSE 0 END) AS paid_ceded,
            SUM(CASE WHEN rcc.cession_type='RESERVE' THEN rcc.amount_ceded ELSE 0 END) AS reserve_ceded,
            SUM(CASE WHEN rcc.cession_type='RECOVERY' THEN rcc.amount_ceded ELSE 0 END) AS recovery_ceded
     FROM reinsurance_claim_cessions rcc
     JOIN sinistre_lignes sl ON sl.id = rcc.sinistre_ligne_id
     WHERE rcc.run_id = ?
     GROUP BY sl.id_branch`,
    [runId]
  );
  const premMap = new Map(premByBranch.map((r) => [r.id_branch, Number(r.premium_ceded || 0)]));
  const claimMap = new Map(
    claimByBranch.map((r) => [
      r.id_branch,
      {
        paid: Number(r.paid_ceded || 0),
        reserve: Number(r.reserve_ceded || 0),
        recovery: Number(r.recovery_ceded || 0),
      },
    ])
  );
  const branches = await qa(
    `SELECT id, id_branch, gwp_gross, paid_gross, incurred_gross
     FROM portfolio_branch_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [runId, snapshotDate]
  );
  for (const b of branches) {
    const p = premMap.get(b.id_branch) || 0;
    const c = claimMap.get(b.id_branch) || { paid: 0, reserve: 0, recovery: 0 };
    const gwpNet = Math.max(0, Number(b.gwp_gross || 0) - p);
    const paidNet = Math.max(0, Number(b.paid_gross || 0) - c.paid - c.recovery);
    const incurredNet = Math.max(0, Number(b.incurred_gross || 0) - c.paid - c.reserve - c.recovery);
    await pool.query(
      `UPDATE portfolio_branch_snapshots
       SET gwp_net = ?, earned_net = ?, paid_net = ?, incurred_net = ?
       WHERE id = ?`,
      [gwpNet, gwpNet, paidNet, incurredNet, b.id]
    );
  }

  await pool.query(
    `UPDATE s2_scr_inputs_non_life s2
     JOIN portfolio_branch_snapshots pbs
       ON pbs.run_id = s2.run_id AND pbs.snapshot_date = s2.snapshot_date AND pbs.id_branch = s2.id_branch
     SET s2.reserve_volume = COALESCE(pbs.rbns_gross,0)+COALESCE(pbs.ibnr_gross,0),
         s2.counterparty_exposure = (COALESCE(pbs.gwp_gross,0)-COALESCE(pbs.gwp_net,0)) + (COALESCE(pbs.incurred_gross,0)-COALESCE(pbs.incurred_net,0))
     WHERE s2.run_id = ? AND s2.snapshot_date = ?`,
    [runId, snapshotDate]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const runId = Number(args["run-id"] || 2);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");

  try {
    const scenario = await q1(`SELECT id, captive_id FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario) throw new Error(`Scenario ${scenarioId} introuvable`);
    const motorBranch = await q1(`SELECT id_branch FROM insurance_branch WHERE captive_id = ? AND s2_code = '10'`, [scenario.captive_id]);
    if (!motorBranch) throw new Error("Branche motor S2=10 introuvable");

    const frontingA = await ensureInsurer("SIM FRONTING INSURER A");
    await ensureInsurer("SIM FRONTING INSURER B");

    // Remove Motor QS cessions/treaty if present to avoid double counting.
    const qsMotor = await q1(`SELECT id FROM reinsurance_treaties WHERE run_id = ? AND code = ?`, [runId, `SIM_QS_MOTOR_RUN_${runId}`]);
    if (qsMotor) {
      await pool.query(`DELETE FROM reinsurance_claim_cessions WHERE run_id = ? AND treaty_id = ?`, [runId, qsMotor.id]);
      await pool.query(`DELETE FROM reinsurance_premium_cessions WHERE run_id = ? AND treaty_id = ?`, [runId, qsMotor.id]);
      await pool.query(`DELETE FROM reinsurance_treaty_terms WHERE treaty_id = ?`, [qsMotor.id]);
      await pool.query(`DELETE FROM reinsurance_treaty_scopes WHERE treaty_id = ?`, [qsMotor.id]);
      await pool.query(`DELETE FROM reinsurance_treaties WHERE id = ?`, [qsMotor.id]);
    }

    const frontingTreaty = await ensureFrontingTreaty({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      insurerId: frontingA.id,
    });
    await pool.query(`DELETE FROM reinsurance_treaty_scopes WHERE treaty_id = ?`, [frontingTreaty.id]);
    await pool.query(`DELETE FROM reinsurance_treaty_terms WHERE treaty_id = ?`, [frontingTreaty.id]);
    await insertBatch("reinsurance_treaty_scopes", ["treaty_id", "id_branch", "programme_id", "priority_order"], [
      { treaty_id: frontingTreaty.id, id_branch: motorBranch.id_branch, programme_id: null, priority_order: 1 },
    ]);
    await insertBatch("reinsurance_treaty_terms", ["treaty_id", "term_type", "value_numeric", "value_json", "effective_from", "effective_to"], [
      { treaty_id: frontingTreaty.id, term_type: "CESSION_RATE", value_numeric: 100, value_json: null, effective_from: "2028-01-01", effective_to: "2028-12-31" },
    ]);

    // Idempotence for fronting cessions on this treaty
    await pool.query(`DELETE FROM reinsurance_claim_cessions WHERE run_id = ? AND treaty_id = ?`, [runId, frontingTreaty.id]);
    await pool.query(`DELETE FROM reinsurance_premium_cessions WHERE run_id = ? AND treaty_id = ?`, [runId, frontingTreaty.id]);

    const motorPremiumRows = await qa(
      `SELECT pt.id AS premium_transaction_id, pt.accounting_date, pt.amount_gross
       FROM premium_transactions pt
       JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
       JOIN insurance_branch ib ON ib.id_branch = cc.id_branch
       WHERE pt.run_id = ? AND pt.transaction_type='ISSUED' AND ib.s2_code='10'`,
      [runId]
    );
    const premCessions = motorPremiumRows.map((r) => ({
      scenario_id: scenarioId,
      run_id: runId,
      treaty_id: frontingTreaty.id,
      premium_transaction_id: r.premium_transaction_id,
      amount_ceded: Number(r.amount_gross || 0),
      commission_reinsurance: 0,
      net_cost: Number(r.amount_gross || 0),
      accounting_date: r.accounting_date,
    }));
    for (let i = 0; i < premCessions.length; i += 2000) {
      await insertBatch(
        "reinsurance_premium_cessions",
        ["scenario_id", "run_id", "treaty_id", "premium_transaction_id", "amount_ceded", "commission_reinsurance", "net_cost", "accounting_date"],
        premCessions.slice(i, i + 2000)
      );
    }

    const motorClaimRows = await qa(
      `SELECT
         sl.id AS sinistre_ligne_id,
         sl.sinistre_id,
         COALESCE(sl.montant_paye,0) AS paid_gross,
         COALESCE(crs.rbns_gross,0) + COALESCE(crs.ibnr_gross,0) AS reserve_gross
       FROM sinistre_lignes sl
       JOIN insurance_branch ib ON ib.id_branch = sl.id_branch
       JOIN sinistres s ON s.id = sl.sinistre_id
       LEFT JOIN claim_reserve_snapshots crs
         ON crs.sinistre_ligne_id = sl.id
        AND crs.run_id = ?
        AND crs.snapshot_date = ?
       WHERE ib.s2_code = '10'
         AND s.description LIKE ?`,
      [runId, snapshotDate, `SIM_RUN_${runId}_%`]
    );
    const claimCessions = [];
    let paidCed = 0;
    let reserveCed = 0;
    for (const r of motorClaimRows) {
      const paid = Math.round(Number(r.paid_gross || 0) * 100) / 100;
      const reserve = Math.round(Number(r.reserve_gross || 0) * 100) / 100;
      if (paid > 0) {
        claimCessions.push({
          scenario_id: scenarioId,
          run_id: runId,
          treaty_id: frontingTreaty.id,
          sinistre_id: r.sinistre_id,
          sinistre_ligne_id: r.sinistre_ligne_id,
          event_date: snapshotDate,
          cession_type: "PAID",
          amount_ceded: paid,
          currency: "EUR",
        });
        paidCed += paid;
      }
      if (reserve > 0) {
        claimCessions.push({
          scenario_id: scenarioId,
          run_id: runId,
          treaty_id: frontingTreaty.id,
          sinistre_id: r.sinistre_id,
          sinistre_ligne_id: r.sinistre_ligne_id,
          event_date: snapshotDate,
          cession_type: "RESERVE",
          amount_ceded: reserve,
          currency: "EUR",
        });
        reserveCed += reserve;
      }
    }
    for (let i = 0; i < claimCessions.length; i += 2000) {
      await insertBatch(
        "reinsurance_claim_cessions",
        ["scenario_id", "run_id", "treaty_id", "sinistre_id", "sinistre_ligne_id", "event_date", "cession_type", "amount_ceded", "currency"],
        claimCessions.slice(i, i + 2000)
      );
    }

    await recomputeNetAndS2Baseline(runId, snapshotDate);

    await addCheck(
      runId,
      "FRONTING_MOTOR_APPLIED",
      "info",
      "pass",
      "Fronting Motor 100% applique avec remplacement de la QS Motor.",
      paidCed + reserveCed
    );

    const motorBranchSnap = await q1(
      `SELECT pbs.gwp_gross, pbs.gwp_net, pbs.paid_gross, pbs.paid_net, pbs.incurred_gross, pbs.incurred_net
       FROM portfolio_branch_snapshots pbs
       JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
       WHERE pbs.run_id = ? AND pbs.snapshot_date = ? AND ib.s2_code='10'`,
      [runId, snapshotDate]
    );
    const cptyMotor = await q1(
      `SELECT counterparty_exposure
       FROM s2_scr_inputs_non_life s2
       JOIN insurance_branch ib ON ib.id_branch = s2.id_branch
       WHERE s2.run_id = ? AND s2.snapshot_date = ? AND ib.s2_code='10'`,
      [runId, snapshotDate]
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario_id: scenarioId,
          run_id: runId,
          fronting_treaty_id: frontingTreaty.id,
          fictive_insurers: ["SIM FRONTING INSURER A", "SIM FRONTING INSURER B"],
          motor_fronting: {
            premium_cessions_count: premCessions.length,
            claim_cessions_count: claimCessions.length,
            paid_ceded_total: Math.round(paidCed * 100) / 100,
            reserve_ceded_total: Math.round(reserveCed * 100) / 100,
          },
          motor_branch_snapshot: motorBranchSnap,
          motor_counterparty_exposure: cptyMotor?.counterparty_exposure ?? null,
          next_step: "rerun recomputeS2FromGeoCatV1 for final S2 with geo CAT",
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

