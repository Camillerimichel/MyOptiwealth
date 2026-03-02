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

async function getStressProfilesFromParameters(scenarioId) {
  const rows = await qa(
    `SELECT parameter_key, value_json
     FROM simulation_parameters
     WHERE scenario_id = ?
       AND parameter_group = 's2'
       AND parameter_key LIKE 'orsa_stress_%'`,
    [scenarioId]
  );
  if (!rows.length) return null;
  const out = {};
  for (const r of rows) {
    try {
      const obj = typeof r.value_json === "string" ? JSON.parse(r.value_json) : r.value_json;
      const key = String(r.parameter_key).replace(/^orsa_stress_/, "").toUpperCase();
      out[key] = obj;
    } catch {
      // ignore malformed rows, fallback later
    }
  }
  return Object.keys(out).length ? out : null;
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

async function createRun({ scenarioId, label, engineVersion, notes }) {
  const [res] = await pool.query(
    `INSERT INTO simulation_runs (scenario_id, run_label, status, engine_version, notes, started_at, ended_at)
     VALUES (?, ?, 'done', ?, ?, NOW(), NOW())`,
    [scenarioId, label, engineVersion, notes]
  );
  return res.insertId;
}

async function ensureOrsaSet({ scenarioId, baseRunId, snapshotDate, code, name }) {
  await pool.query(
    `INSERT INTO orsa_run_sets (scenario_id, code, name, base_run_id, snapshot_date, status)
     VALUES (?, ?, ?, ?, ?, 'draft')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       base_run_id = VALUES(base_run_id),
       snapshot_date = VALUES(snapshot_date),
       updated_at = CURRENT_TIMESTAMP`,
    [scenarioId, code, name, baseRunId, snapshotDate]
  );
  return q1(`SELECT * FROM orsa_run_sets WHERE scenario_id = ? AND code = ?`, [scenarioId, code]);
}

async function upsertOrsaMember({ orsaSetId, runId, stressCode, displayOrder, assumptionJson }) {
  await pool.query(
    `INSERT INTO orsa_run_set_members (orsa_set_id, run_id, stress_code, display_order, assumption_json)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_order = VALUES(display_order),
       assumption_json = VALUES(assumption_json)`,
    [orsaSetId, runId, stressCode, displayOrder, JSON.stringify(assumptionJson)]
  );
}

function stressProfiles() {
  return {
    ADVERSE: {
      portfolio: { gwp_mult: 0.97 },
      claims: { paid_mult: 1.15, incurred_mult: 1.18, rbns_mult: 1.22, ibnr_mult: 1.20, property_cat_loss_mult: 1.25 },
      reinsurance: { premium_ceded_mult: 1.00, claims_ceded_mult: 1.08 },
      s2: { cat_exposure_mult: 1.20, nonlife_mult: 1.10, counterparty_mult: 1.08, operational_mult: 1.05 },
      own_funds: { mult: 0.92 },
      branches: {},
    },
    SEVERE: {
      portfolio: { gwp_mult: 0.92 },
      claims: { paid_mult: 1.35, incurred_mult: 1.45, rbns_mult: 1.50, ibnr_mult: 1.55, property_cat_loss_mult: 1.60 },
      reinsurance: { premium_ceded_mult: 1.00, claims_ceded_mult: 1.18 },
      s2: { cat_exposure_mult: 1.55, nonlife_mult: 1.28, counterparty_mult: 1.20, operational_mult: 1.12 },
      own_funds: { mult: 0.80 },
      branches: {},
    },
  };
}

function getBranchStress(profile, s2Code) {
  const branches = profile?.branches || {};
  return branches[String(s2Code)] || branches[String(s2Code).toUpperCase()] || null;
}

function mult(globalValue, branchValue) {
  const g = Number(globalValue ?? 1);
  const b = Number(branchValue ?? 1);
  return g * b;
}

async function copyBaseAggregatesToRun(baseRunId, newRunId, snapshotDate) {
  await pool.query(
    `INSERT INTO portfolio_snapshots
      (scenario_id, run_id, snapshot_date, captive_id, gwp_total, earned_premium_total, claims_paid_total, claims_incurred_total, rbns_total, ibnr_total, net_result_technical)
     SELECT scenario_id, ?, snapshot_date, captive_id, gwp_total, earned_premium_total, claims_paid_total, claims_incurred_total, rbns_total, ibnr_total, net_result_technical
     FROM portfolio_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, baseRunId, snapshotDate]
  );

  await pool.query(
    `INSERT INTO portfolio_branch_snapshots
      (scenario_id, run_id, snapshot_date, id_branch, contracts_count, clients_count, gwp_gross, gwp_net, earned_gross, earned_net, paid_gross, paid_net, incurred_gross, incurred_net, rbns_gross, ibnr_gross, cat_loss_gross)
     SELECT scenario_id, ?, snapshot_date, id_branch, contracts_count, clients_count, gwp_gross, gwp_net, earned_gross, earned_net, paid_gross, paid_net, incurred_gross, incurred_net, rbns_gross, ibnr_gross, cat_loss_gross
     FROM portfolio_branch_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, baseRunId, snapshotDate]
  );

  await pool.query(
    `INSERT INTO broker_concentration_snapshots
      (scenario_id, run_id, snapshot_date, partner_id, rank_by_gwp, gwp_amount, gwp_share_pct, contracts_count, clients_count, hhi_contribution)
     SELECT scenario_id, ?, snapshot_date, partner_id, rank_by_gwp, gwp_amount, gwp_share_pct, contracts_count, clients_count, hhi_contribution
     FROM broker_concentration_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, baseRunId, snapshotDate]
  );

  await pool.query(
    `INSERT INTO s2_scr_inputs_non_life
      (scenario_id, run_id, snapshot_date, id_branch, premium_volume, reserve_volume, cat_exposure, counterparty_exposure, sigma_premium, sigma_reserve, corr_group_code)
     SELECT scenario_id, ?, snapshot_date, id_branch, premium_volume, reserve_volume, cat_exposure, counterparty_exposure, sigma_premium, sigma_reserve, corr_group_code
     FROM s2_scr_inputs_non_life
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, baseRunId, snapshotDate]
  );

  await pool.query(
    `INSERT INTO s2_scr_results
      (scenario_id, run_id, snapshot_date, scr_non_life, scr_counterparty, scr_market, scr_operational, scr_bscr, scr_total, mcr, own_funds_eligible, solvency_ratio_pct, methodology_version)
     SELECT scenario_id, ?, snapshot_date, scr_non_life, scr_counterparty, scr_market, scr_operational, scr_bscr, scr_total, mcr, own_funds_eligible, solvency_ratio_pct, methodology_version
     FROM s2_scr_results
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, baseRunId, snapshotDate]
  );

  if (await q1(`SELECT COUNT(*) AS cnt FROM cat_concentration_snapshots WHERE run_id = ? AND snapshot_date = ?`, [baseRunId, snapshotDate])) {
    await pool.query(
      `INSERT INTO cat_concentration_snapshots
        (scenario_id, run_id, snapshot_date, geo_code, property_contracts_count, property_clients_count, property_gwp_gross, property_sum_insured, property_gwp_share_pct, property_si_share_pct, cat_event_count, cat_impacted_contracts_count, cat_impacted_gwp_gross, weighted_cat_exposure, hhi_contribution)
       SELECT scenario_id, ?, snapshot_date, geo_code, property_contracts_count, property_clients_count, property_gwp_gross, property_sum_insured, property_gwp_share_pct, property_si_share_pct, cat_event_count, cat_impacted_contracts_count, cat_impacted_gwp_gross, weighted_cat_exposure, hhi_contribution
       FROM cat_concentration_snapshots
       WHERE run_id = ? AND snapshot_date = ?`,
      [newRunId, baseRunId, snapshotDate]
    );
  }

  const frontingPrograms = await qa(`SELECT * FROM fronting_programs WHERE run_id = ?`, [baseRunId]).catch(() => []);
  const fpMap = new Map();
  for (const fp of frontingPrograms) {
    await pool.query(
      `INSERT INTO fronting_programs
        (scenario_id, run_id, id_branch, primary_fronting_insurer_id, secondary_fronting_insurer_id,
         fronting_share_pct, retrocession_to_captive_pct, fronting_fee_pct, claims_handling_fee_pct,
         minimum_fronting_fee, currency, effective_from, effective_to, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         primary_fronting_insurer_id = VALUES(primary_fronting_insurer_id),
         secondary_fronting_insurer_id = VALUES(secondary_fronting_insurer_id),
         fronting_share_pct = VALUES(fronting_share_pct),
         retrocession_to_captive_pct = VALUES(retrocession_to_captive_pct),
         fronting_fee_pct = VALUES(fronting_fee_pct),
         claims_handling_fee_pct = VALUES(claims_handling_fee_pct),
         minimum_fronting_fee = VALUES(minimum_fronting_fee),
         currency = VALUES(currency),
         effective_from = VALUES(effective_from),
         effective_to = VALUES(effective_to),
         status = VALUES(status),
         notes = VALUES(notes),
         updated_at = CURRENT_TIMESTAMP`,
      [
        fp.scenario_id,
        newRunId,
        fp.id_branch,
        fp.primary_fronting_insurer_id,
        fp.secondary_fronting_insurer_id,
        fp.fronting_share_pct,
        fp.retrocession_to_captive_pct,
        fp.fronting_fee_pct,
        fp.claims_handling_fee_pct,
        fp.minimum_fronting_fee,
        fp.currency,
        fp.effective_from,
        fp.effective_to,
        fp.status,
        fp.notes,
      ]
    );
    const cloned = await q1(`SELECT id FROM fronting_programs WHERE run_id = ? AND id_branch = ?`, [newRunId, fp.id_branch]);
    if (cloned?.id) fpMap.set(Number(fp.id), Number(cloned.id));
  }

  const frontingAdjustments = await qa(
    `SELECT * FROM fronting_run_adjustments WHERE run_id = ? AND snapshot_date = ?`,
    [baseRunId, snapshotDate]
  ).catch(() => []);
  for (const fa of frontingAdjustments) {
    const mappedProgramId = fpMap.get(Number(fa.fronting_program_id));
    if (!mappedProgramId) continue;
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
        mappedProgramId,
        fa.scenario_id,
        newRunId,
        fa.snapshot_date,
        fa.id_branch,
        fa.gross_premium,
        fa.gross_paid,
        fa.gross_incurred,
        fa.fronted_premium,
        fa.retroceded_to_captive_premium,
        fa.fronting_fee_amount,
        fa.claims_handling_fee_amount,
        fa.premium_net_to_captive_after_fees,
        fa.paid_net_to_captive,
        fa.incurred_net_to_captive,
        fa.estimated_counterparty_exposure,
        fa.assumption_json,
      ]
    );
  }
}

async function getBaseMetrics(baseRunId, snapshotDate) {
  const ps = await q1(`SELECT * FROM portfolio_snapshots WHERE run_id = ? AND snapshot_date = ?`, [baseRunId, snapshotDate]);
  const s2 = await q1(`SELECT * FROM s2_scr_results WHERE run_id = ? AND snapshot_date = ?`, [baseRunId, snapshotDate]);
  const premiumCeded = await q1(`SELECT COALESCE(SUM(amount_ceded),0) AS v FROM reinsurance_premium_cessions WHERE run_id = ?`, [baseRunId]);
  const claimCeded = await q1(`SELECT COALESCE(SUM(amount_ceded),0) AS v FROM reinsurance_claim_cessions WHERE run_id = ?`, [baseRunId]);
  const propBranch = await q1(
    `SELECT pbs.cat_loss_gross
     FROM portfolio_branch_snapshots pbs
     JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
     WHERE pbs.run_id = ? AND pbs.snapshot_date = ? AND ib.s2_code = '08'`,
    [baseRunId, snapshotDate]
  );
  const propS2Cat = await q1(
    `SELECT s2i.cat_exposure
     FROM s2_scr_inputs_non_life s2i
     JOIN insurance_branch ib ON ib.id_branch = s2i.id_branch
     WHERE s2i.run_id = ? AND s2i.snapshot_date = ? AND ib.s2_code = '08'`,
    [baseRunId, snapshotDate]
  );
  const hhi = await q1(`SELECT COALESCE(SUM(hhi_contribution),0) AS v FROM cat_concentration_snapshots WHERE run_id = ? AND snapshot_date = ?`, [baseRunId, snapshotDate]);
  const topBroker = await q1(
    `SELECT COALESCE(MAX(gwp_share_pct),0) AS top1, COALESCE(SUM(CASE WHEN rank_by_gwp <= CEIL(COUNT(*) OVER() * 0.2) THEN gwp_share_pct ELSE 0 END),0) AS top20
     FROM broker_concentration_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [baseRunId, snapshotDate]
  ).catch(async () => {
    const rows = await qa(
      `SELECT rank_by_gwp, gwp_share_pct
       FROM broker_concentration_snapshots
       WHERE run_id = ? AND snapshot_date = ?
       ORDER BY rank_by_gwp`,
      [baseRunId, snapshotDate]
    );
    const n = rows.length || 1;
    const top1 = Number(rows[0]?.gwp_share_pct || 0);
    const top20Cut = Math.ceil(n * 0.2);
    const top20 = rows.slice(0, top20Cut).reduce((s, r) => s + Number(r.gwp_share_pct || 0), 0);
    return { top1, top20 };
  });

  return {
    ps,
    s2,
    premiumCeded: Number(premiumCeded?.v || 0),
    claimCeded: Number(claimCeded?.v || 0),
    propertyCatLossGross: Number(propBranch?.cat_loss_gross || 0),
    propertyCatExposureS2: Number(propS2Cat?.cat_exposure || 0),
    propertyGeoHhi: Number(hhi?.v || 0),
    topBrokerTop1: Number(topBroker?.top1 || 0),
    topBrokerTop20: Number(topBroker?.top20 || 0),
  };
}

function applyStress(base, profile) {
  const out = structuredClone(base);
  out.ps.gwp_total = Number(base.ps.gwp_total || 0) * profile.portfolio.gwp_mult;
  out.ps.earned_premium_total = Number(base.ps.earned_premium_total || 0) * profile.portfolio.gwp_mult;
  out.ps.claims_paid_total = Number(base.ps.claims_paid_total || 0) * profile.claims.paid_mult;
  out.ps.claims_incurred_total = Number(base.ps.claims_incurred_total || 0) * profile.claims.incurred_mult;
  out.ps.rbns_total = Number(base.ps.rbns_total || 0) * profile.claims.rbns_mult;
  out.ps.ibnr_total = Number(base.ps.ibnr_total || 0) * profile.claims.ibnr_mult;
  out.premiumCeded = base.premiumCeded * profile.reinsurance.premium_ceded_mult;
  out.claimCeded = base.claimCeded * profile.reinsurance.claims_ceded_mult;
  out.propertyCatLossGross = base.propertyCatLossGross * profile.claims.property_cat_loss_mult;
  out.propertyCatExposureS2 = base.propertyCatExposureS2 * profile.s2.cat_exposure_mult;
  out.s2.scr_non_life = Number(base.s2.scr_non_life || 0) * profile.s2.nonlife_mult;
  out.s2.scr_counterparty = Number(base.s2.scr_counterparty || 0) * profile.s2.counterparty_mult;
  out.s2.scr_market = Number(base.s2.scr_market || 0);
  out.s2.scr_operational = Number(base.s2.scr_operational || 0) * profile.s2.operational_mult;
  out.s2.scr_bscr = out.s2.scr_non_life + out.s2.scr_counterparty + out.s2.scr_market;
  out.s2.scr_total = out.s2.scr_bscr + out.s2.scr_operational;
  out.s2.own_funds_eligible = Number(base.s2.own_funds_eligible || 0) * profile.own_funds.mult;
  out.s2.solvency_ratio_pct = out.s2.scr_total > 0 ? (out.s2.own_funds_eligible / out.s2.scr_total) * 100 : null;
  return out;
}

async function applyAggregateStressToRun({ newRunId, baseRunId, snapshotDate, profile, metrics }) {
  // Branch-level scaling with extra Property CAT stress.
  const propBranch = await q1(`SELECT id_branch FROM insurance_branch WHERE s2_code='08' LIMIT 1`);
  const branches = await qa(
    `SELECT pbs.*, ib.s2_code
     FROM portfolio_branch_snapshots pbs
     JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
     WHERE pbs.run_id = ? AND pbs.snapshot_date = ?`,
    [newRunId, snapshotDate]
  );
  for (const b of branches) {
    const isProp = b.id_branch === propBranch?.id_branch;
    const branchStress = getBranchStress(profile, b.s2_code) || {};
    const branchPortfolio = branchStress.portfolio || {};
    const branchClaims = branchStress.claims || {};
    const branchS2 = branchStress.s2 || {};
    const gwpMult = mult(profile.portfolio.gwp_mult, branchPortfolio.gwp_mult);
    const paidMult = mult(
      profile.claims.paid_mult * (isProp ? profile.claims.property_cat_loss_mult / 1.1 : 1),
      branchClaims.paid_mult
    );
    const incurredMult = mult(
      profile.claims.incurred_mult * (isProp ? profile.claims.property_cat_loss_mult / 1.1 : 1),
      branchClaims.incurred_mult
    );
    const rbnsMult = mult(
      profile.claims.rbns_mult * (isProp ? profile.claims.property_cat_loss_mult / 1.15 : 1),
      branchClaims.rbns_mult
    );
    const ibnrMult = mult(
      profile.claims.ibnr_mult * (isProp ? profile.claims.property_cat_loss_mult / 1.15 : 1),
      branchClaims.ibnr_mult
    );
    const catMult = mult(isProp ? profile.claims.property_cat_loss_mult : 1, branchClaims.property_cat_loss_mult);
    await pool.query(
      `UPDATE portfolio_branch_snapshots
       SET gwp_gross = gwp_gross * ?,
           gwp_net = gwp_net * ?,
           earned_gross = earned_gross * ?,
           earned_net = earned_net * ?,
           paid_gross = paid_gross * ?,
           paid_net = paid_net * ?,
           incurred_gross = incurred_gross * ?,
           incurred_net = incurred_net * ?,
           rbns_gross = rbns_gross * ?,
           ibnr_gross = ibnr_gross * ?,
           cat_loss_gross = cat_loss_gross * ?
       WHERE id = ?`,
      [gwpMult, gwpMult, gwpMult, gwpMult, paidMult, paidMult, incurredMult, incurredMult, rbnsMult, ibnrMult, catMult, b.id]
    );

    await pool.query(
      `UPDATE fronting_run_adjustments
       SET gross_premium = gross_premium * ?,
           gross_paid = gross_paid * ?,
           gross_incurred = gross_incurred * ?,
           fronted_premium = fronted_premium * ?,
           retroceded_to_captive_premium = retroceded_to_captive_premium * ?,
           fronting_fee_amount = fronting_fee_amount * ?,
           claims_handling_fee_amount = claims_handling_fee_amount * ?,
           premium_net_to_captive_after_fees = GREATEST(0, (premium_net_to_captive_after_fees * ?)),
           paid_net_to_captive = paid_net_to_captive * ?,
           incurred_net_to_captive = incurred_net_to_captive * ?,
           estimated_counterparty_exposure = estimated_counterparty_exposure * ?
       WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
      [
        gwpMult,
        paidMult,
        incurredMult,
        gwpMult,
        gwpMult,
        gwpMult,
        paidMult,
        gwpMult,
        paidMult,
        incurredMult,
        incurredMult,
        newRunId,
        snapshotDate,
        b.id_branch,
      ]
    ).catch(() => {});
  }

  // Portfolio global recomputed from stressed branch snapshots to support branch-specific stress.
  const psAgg = await q1(
    `SELECT
       COALESCE(SUM(gwp_gross),0) AS gwp_total,
       COALESCE(SUM(earned_gross),0) AS earned_premium_total,
       COALESCE(SUM(paid_gross),0) AS claims_paid_total,
       COALESCE(SUM(incurred_gross),0) AS claims_incurred_total,
       COALESCE(SUM(rbns_gross),0) AS rbns_total,
       COALESCE(SUM(ibnr_gross),0) AS ibnr_total
     FROM portfolio_branch_snapshots
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, snapshotDate]
  );
  await pool.query(
    `UPDATE portfolio_snapshots
     SET gwp_total = ?, earned_premium_total = ?, claims_paid_total = ?, claims_incurred_total = ?, rbns_total = ?, ibnr_total = ?
     WHERE run_id = ? AND snapshot_date = ?`,
    [
      psAgg.gwp_total,
      psAgg.earned_premium_total,
      psAgg.claims_paid_total,
      psAgg.claims_incurred_total,
      psAgg.rbns_total,
      psAgg.ibnr_total,
      newRunId,
      snapshotDate,
    ]
  );

  // Broker concentration: scale absolute amounts only (shares unchanged in this V1 ORSA stress)
  await pool.query(
    `UPDATE broker_concentration_snapshots
     SET gwp_amount = gwp_amount * ?
     WHERE run_id = ? AND snapshot_date = ?`,
    [profile.portfolio.gwp_mult, newRunId, snapshotDate]
  );

  // CAT concentration: scale GWP/SI and weighted exposure, preserve shares and HHI
  await pool.query(
    `UPDATE cat_concentration_snapshots
     SET property_gwp_gross = property_gwp_gross * ?,
         property_sum_insured = property_sum_insured * ?,
         cat_impacted_gwp_gross = cat_impacted_gwp_gross * ?,
         weighted_cat_exposure = weighted_cat_exposure * ?
     WHERE run_id = ? AND snapshot_date = ?`,
    [
      profile.portfolio.gwp_mult,
      profile.claims.property_cat_loss_mult,
      profile.claims.property_cat_loss_mult,
      profile.s2.cat_exposure_mult,
      newRunId,
      snapshotDate,
    ]
  );

  // S2 inputs: scale base values, with extra CAT/cpty stress
  const s2Inputs = await qa(`SELECT s2i.id, ib.s2_code FROM s2_scr_inputs_non_life s2i JOIN insurance_branch ib ON ib.id_branch=s2i.id_branch WHERE s2i.run_id = ? AND s2i.snapshot_date = ?`, [newRunId, snapshotDate]);
  for (const r of s2Inputs) {
    const isProp = r.s2_code === "08";
    const branchStress = getBranchStress(profile, r.s2_code) || {};
    const branchPortfolio = branchStress.portfolio || {};
    const branchClaims = branchStress.claims || {};
    const branchS2 = branchStress.s2 || {};
    const premiumVolumeMult = mult(profile.portfolio.gwp_mult, branchPortfolio.gwp_mult);
    const reserveVolumeMult = mult(profile.claims.rbns_mult, branchClaims.rbns_mult);
    const catExposureMult = mult(isProp ? profile.s2.cat_exposure_mult : 1, branchS2.cat_exposure_mult);
    const cptyMult = mult(profile.s2.counterparty_mult, branchS2.counterparty_mult);
    await pool.query(
      `UPDATE s2_scr_inputs_non_life
       SET premium_volume = premium_volume * ?,
           reserve_volume = reserve_volume * ?,
           cat_exposure = cat_exposure * ?,
           counterparty_exposure = counterparty_exposure * ?
       WHERE id = ?`,
      [premiumVolumeMult, reserveVolumeMult, catExposureMult, cptyMult, r.id]
    );
  }

  // S2 results recomputed from stressed inputs (then non-life/operational multipliers applied)
  const s2Agg = await q1(
    `SELECT
       SUM(COALESCE(premium_volume,0) * COALESCE(sigma_premium,0)) AS prem_charge,
       SUM(COALESCE(reserve_volume,0) * COALESCE(sigma_reserve,0)) AS reserve_charge,
       SUM(COALESCE(cat_exposure,0) * 0.30) AS cat_charge,
       SUM(COALESCE(counterparty_exposure,0) * 0.10) AS cpty_charge
     FROM s2_scr_inputs_non_life
     WHERE run_id = ? AND snapshot_date = ?`,
    [newRunId, snapshotDate]
  );
  const scrNonLifeBase = (Number(s2Agg?.prem_charge || 0) + Number(s2Agg?.reserve_charge || 0) + Number(s2Agg?.cat_charge || 0)) * 0.76;
  const scrNonLife = scrNonLifeBase * Number(profile.s2.nonlife_mult || 1);
  const scrCounterparty = Number(s2Agg?.cpty_charge || 0);
  const scrMarket = Number(metrics.s2.scr_market || 0);
  const scrOperational = Number(metrics.s2.scr_operational || 0);
  const scrBscr = scrNonLife + scrCounterparty + scrMarket;
  const scrTotal = scrBscr + scrOperational;
  const ownFunds = Number(metrics.s2.own_funds_eligible || 0);
  const solvRatio = scrTotal > 0 ? (ownFunds / scrTotal) * 100 : null;
  await pool.query(
    `UPDATE s2_scr_results
     SET scr_non_life = ?, scr_counterparty = ?, scr_market = ?, scr_operational = ?, scr_bscr = ?, scr_total = ?,
         own_funds_eligible = ?, solvency_ratio_pct = ?, methodology_version = ?
     WHERE run_id = ? AND snapshot_date = ?`,
    [
      scrNonLife,
      scrCounterparty,
      scrMarket,
      scrOperational,
      scrBscr,
      scrTotal,
      ownFunds,
      solvRatio,
      profile?.branches && Object.keys(profile.branches).length ? "orsa-v2-branch-stress" : "orsa-v1-aggregate-stress",
      newRunId,
      snapshotDate,
    ]
  );

  await addCheck(newRunId, "ORSA_STRESS_APPLIED", "info", "pass", "Stress ORSA agrégé appliqué au run clone.");
}

async function upsertComparison({ orsaSetId, runId, stressCode, snapshotDate }) {
  const ps = await q1(`SELECT * FROM portfolio_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  const s2 = await q1(`SELECT * FROM s2_scr_results WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  const premiumCeded = await q1(`SELECT COALESCE(SUM(amount_ceded),0) AS v FROM reinsurance_premium_cessions WHERE run_id = ?`, [runId]);
  const claimCeded = await q1(`SELECT COALESCE(SUM(amount_ceded),0) AS v FROM reinsurance_claim_cessions WHERE run_id = ?`, [runId]);
  const propBranch = await q1(
    `SELECT pbs.cat_loss_gross
     FROM portfolio_branch_snapshots pbs JOIN insurance_branch ib ON ib.id_branch=pbs.id_branch
     WHERE pbs.run_id = ? AND pbs.snapshot_date = ? AND ib.s2_code='08'`,
    [runId, snapshotDate]
  );
  const propS2 = await q1(
    `SELECT s2i.cat_exposure
     FROM s2_scr_inputs_non_life s2i JOIN insurance_branch ib ON ib.id_branch=s2i.id_branch
     WHERE s2i.run_id = ? AND s2i.snapshot_date = ? AND ib.s2_code='08'`,
    [runId, snapshotDate]
  );
  const hhi = await q1(`SELECT COALESCE(SUM(hhi_contribution),0) AS v FROM cat_concentration_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  const brokerRows = await qa(
    `SELECT rank_by_gwp, gwp_share_pct
     FROM broker_concentration_snapshots
     WHERE run_id = ? AND snapshot_date = ?
     ORDER BY rank_by_gwp`,
    [runId, snapshotDate]
  );
  const top1 = Number(brokerRows[0]?.gwp_share_pct || 0);
  const top20 = brokerRows.slice(0, Math.ceil((brokerRows.length || 1) * 0.2)).reduce((s, r) => s + Number(r.gwp_share_pct || 0), 0);

  await pool.query(
    `INSERT INTO orsa_run_comparison_snapshots
      (orsa_set_id, run_id, stress_code, snapshot_date, gwp_total, claims_paid_total, claims_incurred_total, rbns_total, ibnr_total,
       premium_ceded_total, claims_ceded_total, scr_non_life, scr_counterparty, scr_market, scr_operational, scr_total, mcr,
       own_funds_eligible, solvency_ratio_pct, property_cat_loss_gross, property_cat_exposure_s2, property_geo_hhi,
       top_broker_gwp_share_pct, top20_broker_gwp_share_pct, methodology_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       gwp_total=VALUES(gwp_total),
       claims_paid_total=VALUES(claims_paid_total),
       claims_incurred_total=VALUES(claims_incurred_total),
       rbns_total=VALUES(rbns_total),
       ibnr_total=VALUES(ibnr_total),
       premium_ceded_total=VALUES(premium_ceded_total),
       claims_ceded_total=VALUES(claims_ceded_total),
       scr_non_life=VALUES(scr_non_life),
       scr_counterparty=VALUES(scr_counterparty),
       scr_market=VALUES(scr_market),
       scr_operational=VALUES(scr_operational),
       scr_total=VALUES(scr_total),
       mcr=VALUES(mcr),
       own_funds_eligible=VALUES(own_funds_eligible),
       solvency_ratio_pct=VALUES(solvency_ratio_pct),
       property_cat_loss_gross=VALUES(property_cat_loss_gross),
       property_cat_exposure_s2=VALUES(property_cat_exposure_s2),
       property_geo_hhi=VALUES(property_geo_hhi),
       top_broker_gwp_share_pct=VALUES(top_broker_gwp_share_pct),
       top20_broker_gwp_share_pct=VALUES(top20_broker_gwp_share_pct),
       methodology_version=VALUES(methodology_version)`,
    [
      orsaSetId,
      runId,
      stressCode,
      snapshotDate,
      ps?.gwp_total ?? null,
      ps?.claims_paid_total ?? null,
      ps?.claims_incurred_total ?? null,
      ps?.rbns_total ?? null,
      ps?.ibnr_total ?? null,
      premiumCeded?.v ?? null,
      claimCeded?.v ?? null,
      s2?.scr_non_life ?? null,
      s2?.scr_counterparty ?? null,
      s2?.scr_market ?? null,
      s2?.scr_operational ?? null,
      s2?.scr_total ?? null,
      s2?.mcr ?? null,
      s2?.own_funds_eligible ?? null,
      s2?.solvency_ratio_pct ?? null,
      propBranch?.cat_loss_gross ?? null,
      propS2?.cat_exposure ?? null,
      hhi?.v ?? null,
      top1,
      top20,
      s2?.methodology_version ?? null,
    ]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const baseRunId = Number(args["base-run-id"] || 3);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");
  const orsaCode = String(args["orsa-code"] || `ORSA_2028_SET1`);
  const orsaName = String(args["orsa-name"] || "ORSA 2028 - Base/Adverse/Severe");
  const reuseExisting = Boolean(args["reuse-existing-runs"]);

  try {
    const baseRun = await q1(`SELECT id, scenario_id, run_label, status FROM simulation_runs WHERE id = ?`, [baseRunId]);
    if (!baseRun) throw new Error(`Base run ${baseRunId} introuvable`);
    if (baseRun.scenario_id !== scenarioId) throw new Error(`Base run ${baseRunId} hors scenario ${scenarioId}`);

    const orsaSet = await ensureOrsaSet({
      scenarioId,
      baseRunId,
      snapshotDate,
      code: orsaCode,
      name: orsaName,
    });

    // Register base run as member
    await upsertOrsaMember({
      orsaSetId: orsaSet.id,
      runId: baseRunId,
      stressCode: "BASE",
      displayOrder: 1,
      assumptionJson: { source: "existing_run", run_id: baseRunId },
    });

    const baseMetrics = await getBaseMetrics(baseRunId, snapshotDate);

    const profiles = (await getStressProfilesFromParameters(scenarioId)) || stressProfiles();
    const generated = [];
    for (const [stressCode, profile] of Object.entries(profiles)) {
      const runLabel = `${orsaCode}__${baseRun.run_label}__${stressCode.toLowerCase()}`;
      const existing = reuseExisting
        ? await q1(`SELECT id FROM simulation_runs WHERE scenario_id = ? AND run_label = ?`, [scenarioId, runLabel])
        : null;
      let runId = existing?.id;
      if (!runId) {
        runId = await createRun({
          scenarioId,
          label: runLabel,
          engineVersion: "orsa-v1-aggregate-stress",
          notes: `Derived from base run ${baseRunId} (${stressCode}) in set ${orsaCode}`,
        });
        await copyBaseAggregatesToRun(baseRunId, runId, snapshotDate);
      }

      const stressedMetrics = applyStress(baseMetrics, profile);
      await applyAggregateStressToRun({
        newRunId: runId,
        baseRunId,
        snapshotDate,
        profile,
        metrics: stressedMetrics,
      });

      await upsertOrsaMember({
        orsaSetId: orsaSet.id,
        runId,
        stressCode,
        displayOrder: stressCode === "ADVERSE" ? 2 : 3,
        assumptionJson: profile,
      });
      generated.push({ stressCode, runId });
    }

    // Refresh comparison for all members
    const members = await qa(`SELECT run_id, stress_code FROM orsa_run_set_members WHERE orsa_set_id = ?`, [orsaSet.id]);
    for (const m of members) {
      await upsertComparison({
        orsaSetId: orsaSet.id,
        runId: m.run_id,
        stressCode: m.stress_code,
        snapshotDate,
      });
    }

    await pool.query(`UPDATE orsa_run_sets SET status = 'done' WHERE id = ?`, [orsaSet.id]);
    await addCheck(baseRunId, "ORSA_SET_GENERATED", "info", "pass", `Set ORSA ${orsaSet.code} généré.`, members.length);

    const comparison = await qa(
      `SELECT stress_code, run_id, ROUND(gwp_total,2) AS gwp_total, ROUND(claims_incurred_total,2) AS claims_incurred_total,
              ROUND(scr_total,2) AS scr_total, ROUND(solvency_ratio_pct,2) AS solvency_ratio_pct,
              ROUND(property_cat_exposure_s2,2) AS property_cat_exposure_s2
       FROM orsa_run_comparison_snapshots
       WHERE orsa_set_id = ? AND snapshot_date = ?
       ORDER BY FIELD(stress_code, 'BASE', 'ADVERSE', 'SEVERE')`,
      [orsaSet.id, snapshotDate]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          orsa_set: {
            id: orsaSet.id,
            code: orsaSet.code,
            name: orsaSet.name,
            base_run_id: baseRunId,
            snapshot_date: snapshotDate,
          },
          generated_runs: generated,
          comparison,
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
