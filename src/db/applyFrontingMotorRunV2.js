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

async function ensureInsurer(name) {
  await pool.query(`INSERT IGNORE INTO insurers (name) VALUES (?)`, [name]);
  return q1(`SELECT id, name FROM insurers WHERE name = ?`, [name]);
}

async function recomputeCounterpartyAndS2(scenarioId, runId, snapshotDate) {
  await pool.query(
    `UPDATE s2_scr_inputs_non_life s2
     JOIN portfolio_branch_snapshots pbs
       ON pbs.run_id = s2.run_id AND pbs.snapshot_date = s2.snapshot_date AND pbs.id_branch = s2.id_branch
     SET s2.reserve_volume = COALESCE(pbs.rbns_gross,0) + COALESCE(pbs.ibnr_gross,0),
         s2.counterparty_exposure = (COALESCE(pbs.gwp_gross,0)-COALESCE(pbs.gwp_net,0)) + (COALESCE(pbs.incurred_gross,0)-COALESCE(pbs.incurred_net,0))
     WHERE s2.run_id = ? AND s2.snapshot_date = ?`,
    [runId, snapshotDate]
  );

  const s2Cfg = await loadS2EnginePlaceholderConfig(scenarioId);
  const agg = await q1(
    `SELECT
       SUM(COALESCE(premium_volume,0) * COALESCE(sigma_premium,0)) AS prem_charge,
       SUM(COALESCE(reserve_volume,0) * COALESCE(sigma_reserve,0)) AS reserve_charge,
       SUM(COALESCE(cat_exposure,0) * ?) AS cat_charge,
       SUM(COALESCE(counterparty_exposure,0) * ?) AS cpty_charge
     FROM s2_scr_inputs_non_life
     WHERE run_id = ? AND snapshot_date = ?`,
    [
      s2CfgNum(s2Cfg, "fronting_v2.cat_charge_factor", 0.30),
      s2CfgNum(s2Cfg, "fronting_v2.counterparty_charge_factor", 0.10),
      runId,
      snapshotDate,
    ]
  );
  const scrNonLife =
    (Number(agg.prem_charge || 0) + Number(agg.reserve_charge || 0) + Number(agg.cat_charge || 0)) *
    s2CfgNum(s2Cfg, "fronting_v2.nonlife_multiplier", 0.76);
  const scrCounterparty = Number(agg.cpty_charge || 0);
  const scrMarket = 0;
  const scrOperational = s2CfgNum(s2Cfg, "fronting_v2.operational_fixed_eur", 450000);
  const scrBscr = scrNonLife + scrCounterparty + scrMarket;
  const scrTotal = scrBscr + scrOperational;
  const current = await q1(`SELECT own_funds_eligible, mcr FROM s2_scr_results WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  const ownFunds = Number(current?.own_funds_eligible || s2CfgNum(s2Cfg, "own_funds_eligible_base_eur", 12000000));
  const mcr = Number(current?.mcr || s2CfgNum(s2Cfg, "mcr_eur", 2700000));
  const ratio = scrTotal > 0 ? (ownFunds / scrTotal) * 100 : null;

  await pool.query(
    `UPDATE s2_scr_results
     SET scr_non_life = ?, scr_counterparty = ?, scr_market = ?, scr_operational = ?, scr_bscr = ?, scr_total = ?,
         mcr = ?, own_funds_eligible = ?, solvency_ratio_pct = ?, methodology_version = 'v4-fronting-fees-placeholder'
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
      ratio ? Math.round(ratio * 100) / 100 : null,
      runId,
      snapshotDate,
    ]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const runId = Number(args["run-id"] || 2);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");
  const retroPct = Number(args["retro-pct"] || 95);
  const frontingFeePct = Number(args["fronting-fee-pct"] || 5);
  const claimsFeePct = Number(args["claims-fee-pct"] || 2);
  const minFrontingFee = Number(args["min-fronting-fee"] || 250000);
  const primarySharePct = Number(args["primary-share-pct"] || 70);
  const secondarySharePct = Number(args["secondary-share-pct"] || 30);

  try {
    const scenario = await q1(`SELECT id, captive_id FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario) throw new Error(`Scenario ${scenarioId} introuvable`);
    const motorBranch = await q1(`SELECT id_branch FROM insurance_branch WHERE captive_id = ? AND s2_code='10'`, [scenario.captive_id]);
    if (!motorBranch) throw new Error("Branche motor introuvable");

    const frontingA = await ensureInsurer("SIM FRONTING INSURER A");
    const frontingB = await ensureInsurer("SIM FRONTING INSURER B");
    const shareTotal = Math.round((primarySharePct + secondarySharePct) * 10000) / 10000;
    if (Math.abs(shareTotal - 100) > 0.0001) {
      throw new Error(`Co-fronting shares invalides: primary+secondary = ${shareTotal} (attendu 100)`);
    }

    // Require V1 fronting treaty already applied to keep treaty ledger coherent.
    const frontingTreaty = await q1(
      `SELECT id FROM reinsurance_treaties WHERE run_id = ? AND treaty_type = 'FRONTING'`,
      [runId]
    );
    if (!frontingTreaty) throw new Error("Traite FRONTING absent. Lancer applyFrontingMotorRunV1.js d'abord.");

    await pool.query(
      `INSERT INTO fronting_programs
        (scenario_id, run_id, id_branch, primary_fronting_insurer_id, secondary_fronting_insurer_id,
         fronting_share_pct, retrocession_to_captive_pct, fronting_fee_pct, claims_handling_fee_pct,
         minimum_fronting_fee, currency, effective_from, effective_to, status, notes)
       VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?, ?, 'EUR', '2028-01-01', '2028-12-31', 'active', ?)
       ON DUPLICATE KEY UPDATE
         primary_fronting_insurer_id = VALUES(primary_fronting_insurer_id),
         secondary_fronting_insurer_id = VALUES(secondary_fronting_insurer_id),
         retrocession_to_captive_pct = VALUES(retrocession_to_captive_pct),
         fronting_fee_pct = VALUES(fronting_fee_pct),
         claims_handling_fee_pct = VALUES(claims_handling_fee_pct),
         minimum_fronting_fee = VALUES(minimum_fronting_fee),
         notes = VALUES(notes),
         updated_at = CURRENT_TIMESTAMP`,
      [
        scenarioId,
        runId,
        motorBranch.id_branch,
        frontingA.id,
        frontingB.id,
        retroPct,
        frontingFeePct,
        claimsFeePct,
        minFrontingFee,
        "V2 fronting Motor avec retrocession captive et frais",
      ]
    );
    const frontingProgram = await q1(
      `SELECT * FROM fronting_programs WHERE run_id = ? AND id_branch = ?`,
      [runId, motorBranch.id_branch]
    );

    await pool.query(`DELETE FROM fronting_program_counterparties WHERE fronting_program_id = ?`, [frontingProgram.id]).catch(() => {});
    await pool.query(
      `INSERT INTO fronting_program_counterparties
        (fronting_program_id, insurer_id, role_code, share_pct, fee_share_pct, status)
       VALUES (?, ?, 'PRIMARY', ?, ?, 'active'),
              (?, ?, 'SECONDARY', ?, ?, 'active')`,
      [frontingProgram.id, frontingA.id, primarySharePct, primarySharePct, frontingProgram.id, frontingB.id, secondarySharePct, secondarySharePct]
    ).catch(() => {});

    const motor = await q1(
      `SELECT gwp_gross, paid_gross, incurred_gross, rbns_gross, ibnr_gross
       FROM portfolio_branch_snapshots
       WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
      [runId, snapshotDate, motorBranch.id_branch]
    );
    if (!motor) throw new Error("Snapshot branche Motor introuvable");

    const grossPremium = Number(motor.gwp_gross || 0);
    const grossPaid = Number(motor.paid_gross || 0);
    const grossIncurred = Number(motor.incurred_gross || 0);
    const frontedPremium = grossPremium * (Number(frontingProgram.fronting_share_pct) / 100);
    const retroPremium = frontedPremium * (Number(frontingProgram.retrocession_to_captive_pct) / 100);
    const frontingFee = Math.max(
      Number(frontingProgram.minimum_fronting_fee || 0),
      frontedPremium * (Number(frontingProgram.fronting_fee_pct) / 100)
    );
    const claimsHandlingFee = grossPaid * (Number(frontingProgram.claims_handling_fee_pct) / 100);
    const premiumNetToCaptive = Math.max(0, retroPremium - frontingFee - claimsHandlingFee);
    const paidNetToCaptive = grossPaid * (Number(frontingProgram.retrocession_to_captive_pct) / 100);
    const incurredNetToCaptive = grossIncurred * (Number(frontingProgram.retrocession_to_captive_pct) / 100);
    const estimatedCounterpartyExposure = Math.max(
      0,
      (grossPremium - premiumNetToCaptive) + (grossIncurred - incurredNetToCaptive)
    );

    await pool.query(
      `INSERT INTO fronting_run_adjustments
        (fronting_program_id, scenario_id, run_id, snapshot_date, id_branch,
         gross_premium, gross_paid, gross_incurred, fronted_premium, retroceded_to_captive_premium,
         fronting_fee_amount, claims_handling_fee_amount, premium_net_to_captive_after_fees,
         paid_net_to_captive, incurred_net_to_captive, estimated_counterparty_exposure, assumption_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         gross_premium = VALUES(gross_premium),
         gross_paid = VALUES(gross_paid),
         gross_incurred = VALUES(gross_incurred),
         fronted_premium = VALUES(fronted_premium),
         retroceded_to_captive_premium = VALUES(retroceded_to_captive_premium),
         fronting_fee_amount = VALUES(fronting_fee_amount),
         claims_handling_fee_amount = VALUES(claims_handling_fee_amount),
         premium_net_to_captive_after_fees = VALUES(premium_net_to_captive_after_fees),
         paid_net_to_captive = VALUES(paid_net_to_captive),
         incurred_net_to_captive = VALUES(incurred_net_to_captive),
         estimated_counterparty_exposure = VALUES(estimated_counterparty_exposure),
         assumption_json = VALUES(assumption_json)`,
      [
        frontingProgram.id,
        scenarioId,
        runId,
        snapshotDate,
        motorBranch.id_branch,
        grossPremium,
        grossPaid,
        grossIncurred,
        frontedPremium,
        retroPremium,
        frontingFee,
        claimsHandlingFee,
        premiumNetToCaptive,
        paidNetToCaptive,
        incurredNetToCaptive,
        estimatedCounterpartyExposure,
        JSON.stringify({
          fronting_share_pct: Number(frontingProgram.fronting_share_pct),
          retrocession_to_captive_pct: Number(frontingProgram.retrocession_to_captive_pct),
          fronting_fee_pct: Number(frontingProgram.fronting_fee_pct),
          claims_handling_fee_pct: Number(frontingProgram.claims_handling_fee_pct),
          minimum_fronting_fee: Number(frontingProgram.minimum_fronting_fee),
        }),
      ]
    );
    const frontingAdjustment = await q1(
      `SELECT id FROM fronting_run_adjustments WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
      [runId, snapshotDate, motorBranch.id_branch]
    );

    const allocRows = [
      { insurerId: frontingA.id, role: "PRIMARY", sharePct: primarySharePct },
      { insurerId: frontingB.id, role: "SECONDARY", sharePct: secondarySharePct },
    ].map((cp) => {
      const m = cp.sharePct / 100;
      return {
        ...cp,
        gross_premium_alloc: grossPremium * m,
        fronted_premium_alloc: frontedPremium * m,
        retroceded_premium_alloc: retroPremium * m,
        fronting_fee_alloc: frontingFee * m,
        claims_handling_fee_alloc: claimsHandlingFee * m,
        gross_paid_alloc: grossPaid * m,
        gross_incurred_alloc: grossIncurred * m,
        paid_net_to_captive_alloc: paidNetToCaptive * m,
        incurred_net_to_captive_alloc: incurredNetToCaptive * m,
        counterparty_exposure_alloc: estimatedCounterpartyExposure * m,
      };
    });

    if (frontingAdjustment?.id) {
      await pool.query(
        `DELETE FROM fronting_run_counterparty_allocations
         WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
        [runId, snapshotDate, motorBranch.id_branch]
      ).catch(() => {});
      for (const a of allocRows) {
        await pool.query(
          `INSERT INTO fronting_run_counterparty_allocations
            (fronting_adjustment_id, run_id, snapshot_date, id_branch, insurer_id, role_code, share_pct,
             gross_premium_alloc, fronted_premium_alloc, retroceded_premium_alloc, fronting_fee_alloc,
             claims_handling_fee_alloc, gross_paid_alloc, gross_incurred_alloc, paid_net_to_captive_alloc,
             incurred_net_to_captive_alloc, counterparty_exposure_alloc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            frontingAdjustment.id,
            runId,
            snapshotDate,
            motorBranch.id_branch,
            a.insurerId,
            a.role,
            a.sharePct,
            a.gross_premium_alloc,
            a.fronted_premium_alloc,
            a.retroceded_premium_alloc,
            a.fronting_fee_alloc,
            a.claims_handling_fee_alloc,
            a.gross_paid_alloc,
            a.gross_incurred_alloc,
            a.paid_net_to_captive_alloc,
            a.incurred_net_to_captive_alloc,
            a.counterparty_exposure_alloc,
          ]
        ).catch(() => {});
      }
    }

    // Override Motor net branch economics with fronting V2 logic (retrocession to captive net of fees).
    await pool.query(
      `UPDATE portfolio_branch_snapshots
       SET gwp_net = ?, earned_net = ?, paid_net = ?, incurred_net = ?
       WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
      [
        Math.round(premiumNetToCaptive * 100) / 100,
        Math.round(premiumNetToCaptive * 100) / 100,
        Math.round(paidNetToCaptive * 100) / 100,
        Math.round(incurredNetToCaptive * 100) / 100,
        runId,
        snapshotDate,
        motorBranch.id_branch,
      ]
    );

    await recomputeCounterpartyAndS2(scenarioId, runId, snapshotDate);

    await addCheck(
      runId,
      "FRONTING_MOTOR_V2_FEES_APPLIED",
      "info",
      "pass",
      "Fronting Motor V2 applique (retrocession captive + frais de fronting).",
      Math.round((frontingFee + claimsHandlingFee) * 100) / 100
    );

    const motorAfter = await q1(
      `SELECT gwp_gross, gwp_net, paid_gross, paid_net, incurred_gross, incurred_net
       FROM portfolio_branch_snapshots
       WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
      [runId, snapshotDate, motorBranch.id_branch]
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
          fronting_program_id: frontingProgram.id,
          insurers: {
            primary: frontingA.name,
            secondary: frontingB.name,
          },
          co_fronting_shares: {
            primary_share_pct: primarySharePct,
            secondary_share_pct: secondarySharePct,
          },
          fronting_v2: {
            retrocession_to_captive_pct: retroPct,
            fronting_fee_pct: frontingFeePct,
            claims_handling_fee_pct: claimsFeePct,
            minimum_fronting_fee: minFrontingFee,
            gross_premium: Math.round(grossPremium * 100) / 100,
            retroceded_to_captive_premium: Math.round(retroPremium * 100) / 100,
            fronting_fee_amount: Math.round(frontingFee * 100) / 100,
            claims_handling_fee_amount: Math.round(claimsHandlingFee * 100) / 100,
            premium_net_to_captive_after_fees: Math.round(premiumNetToCaptive * 100) / 100,
            paid_net_to_captive: Math.round(paidNetToCaptive * 100) / 100,
            incurred_net_to_captive: Math.round(incurredNetToCaptive * 100) / 100,
          },
          co_fronting_allocations: allocRows.map((a) => ({
            role: a.role,
            insurer_id: a.insurerId,
            share_pct: a.sharePct,
            fronting_fee_alloc: Math.round(a.fronting_fee_alloc * 100) / 100,
            claims_handling_fee_alloc: Math.round(a.claims_handling_fee_alloc * 100) / 100,
            counterparty_exposure_alloc: Math.round(a.counterparty_exposure_alloc * 100) / 100,
          })),
          motor_branch_after: motorAfter,
          s2_after: s2,
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
