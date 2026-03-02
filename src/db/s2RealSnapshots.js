import pool from "./pool.js";
import { loadS2EnginePlaceholderConfig, s2CfgNum } from "./s2EngineConfig.js";

function round2(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function yearStartFromDate(isoDate) {
  return `${String(isoDate || "").slice(0, 4)}-01-01`;
}

function sigmaByS2Code(code) {
  const s2 = String(code || "");
  if (["13", "02"].includes(s2)) return { sigma_premium: 0.14, sigma_reserve: 0.16 };
  if (s2 === "08") return { sigma_premium: 0.12, sigma_reserve: 0.12 };
  if (s2 === "10") return { sigma_premium: 0.1, sigma_reserve: 0.1 };
  return { sigma_premium: 0.08, sigma_reserve: 0.08 };
}

function selectS2ProfileKey(methodologyVersion) {
  const m = String(methodologyVersion || "").toLowerCase();
  if (m.includes("fronting")) return "fronting_v2";
  if (m.includes("cat") || m.includes("xol")) return "cat_xol_v2";
  if (m.includes("qs") || m.includes("reins")) return "reinsurance_v1";
  return "claims_v1";
}

function safeUserDisplay(user) {
  const raw = user?.email || user?.login || user?.username || user?.name || user?.sub || null;
  return raw ? String(raw).slice(0, 128) : null;
}

async function q1(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows?.[0] || null;
}

async function qa(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows || [];
}

function buildMaps(rows, keyField, mapper) {
  const map = new Map();
  for (const row of rows || []) {
    const key = Number(row?.[keyField]);
    if (!Number.isFinite(key) || key <= 0) continue;
    map.set(key, mapper(row));
  }
  return map;
}

export async function calculateS2RealSnapshot({
  captiveId,
  scenarioId,
  referenceRunId = null,
  snapshotDate,
  ownFundsMode = "auto",
  ownFundsManualInputEur = null,
}) {
  const dateIso = toIsoDate(snapshotDate);
  if (!Number.isFinite(Number(captiveId)) || Number(captiveId) <= 0) throw new Error("captive_id_invalid");
  if (!dateIso) throw new Error("snapshot_date_invalid");

  const conn = pool;
  const s2Cfg = await loadS2EnginePlaceholderConfig(Number(scenarioId) > 0 ? Number(scenarioId) : 0);
  const yStart = yearStartFromDate(dateIso);

  const referenceRunIdNum = Number(referenceRunId || 0) > 0 ? Number(referenceRunId) : null;

  const [branches, premiumRows, claimRows, refS2Row, rePremRows, reClaimRows, frontingRows] = await Promise.all([
    qa(
      conn,
      `SELECT id_branch, s2_code, name
       FROM insurance_branch
       WHERE captive_id = ?
       ORDER BY s2_code, id_branch`,
      [captiveId]
    ),
    qa(
      conn,
      `SELECT ib.id_branch, COALESCE(SUM(cpp.amount), 0) AS premium_paid_ytd
       FROM insurance_branch ib
       LEFT JOIN programmes p
         ON p.captive_id = ib.captive_id
        AND p.branch_s2_code = ib.s2_code
       LEFT JOIN contracts ct
         ON ct.programme_id = p.id
       LEFT JOIN contract_premium_payments cpp
         ON cpp.contract_id = ct.id
        AND cpp.paid_on BETWEEN ? AND ?
       WHERE ib.captive_id = ?
       GROUP BY ib.id_branch`,
      [yStart, dateIso, captiveId]
    ),
    qa(
      conn,
      `SELECT
         ib.id_branch,
         COUNT(s.id) AS claims_count,
         COALESCE(SUM(COALESCE(s.montant_estime, 0)), 0) AS estimated_total,
         COALESCE(SUM(COALESCE(rg.paid_to_date, 0)), 0) AS paid_total,
         COALESCE(SUM(GREATEST(COALESCE(s.montant_estime, 0) - COALESCE(rg.paid_to_date, 0), 0)), 0) AS reserve_outstanding
       FROM insurance_branch ib
       LEFT JOIN programmes p
         ON p.captive_id = ib.captive_id
        AND p.branch_s2_code = ib.s2_code
       LEFT JOIN sinistres s
         ON s.programme_id = p.id
        AND COALESCE(s.date_decl, s.date_survenue) IS NOT NULL
        AND COALESCE(s.date_decl, s.date_survenue) <= ?
       LEFT JOIN (
         SELECT sinistre_id, COALESCE(SUM(montant), 0) AS paid_to_date
         FROM reglements
         WHERE date IS NOT NULL AND date <= ?
         GROUP BY sinistre_id
       ) rg ON rg.sinistre_id = s.id
       WHERE ib.captive_id = ?
       GROUP BY ib.id_branch`,
      [dateIso, dateIso, captiveId]
    ),
    referenceRunIdNum
      ? q1(
          conn,
          `SELECT run_id, snapshot_date, methodology_version
           FROM s2_scr_results
           WHERE run_id = ? AND snapshot_date <= ?
           ORDER BY snapshot_date DESC
           LIMIT 1`,
          [referenceRunIdNum, dateIso]
        ).catch(() => null)
      : Promise.resolve(null),
    referenceRunIdNum && Number(scenarioId) > 0
      ? qa(
          conn,
          `SELECT cc.id_branch, COALESCE(SUM(rpc.amount_ceded),0) AS premium_ceded
           FROM reinsurance_premium_cessions rpc
           JOIN premium_transactions pt ON pt.id = rpc.premium_transaction_id
           JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
           JOIN insurance_branch ib ON ib.id_branch = cc.id_branch
           WHERE rpc.scenario_id = ?
             AND rpc.run_id = ?
             AND rpc.accounting_date <= ?
             AND ib.captive_id = ?
           GROUP BY cc.id_branch`,
          [Number(scenarioId), referenceRunIdNum, dateIso, captiveId]
        ).catch(() => [])
      : Promise.resolve([]),
    referenceRunIdNum && Number(scenarioId) > 0
      ? qa(
          conn,
          `SELECT
             COALESCE(sl.id_branch, ib.id_branch) AS id_branch,
             COALESCE(SUM(CASE WHEN rcc.cession_type = 'PAID' THEN rcc.amount_ceded ELSE 0 END),0) AS paid_ceded,
             COALESCE(SUM(CASE WHEN rcc.cession_type = 'RESERVE' THEN rcc.amount_ceded ELSE 0 END),0) AS reserve_ceded
           FROM reinsurance_claim_cessions rcc
           LEFT JOIN sinistre_lignes sl ON sl.id = rcc.sinistre_ligne_id
           LEFT JOIN sinistres s ON s.id = rcc.sinistre_id
           LEFT JOIN programmes p ON p.id = s.programme_id
           LEFT JOIN insurance_branch ib
             ON ib.captive_id = p.captive_id
            AND ib.s2_code = p.branch_s2_code
           WHERE rcc.scenario_id = ?
             AND rcc.run_id = ?
             AND rcc.event_date <= ?
             AND p.captive_id = ?
           GROUP BY COALESCE(sl.id_branch, ib.id_branch)`,
          [Number(scenarioId), referenceRunIdNum, dateIso, captiveId]
        ).catch(() => [])
      : Promise.resolve([]),
    referenceRunIdNum && Number(scenarioId) > 0
      ? qa(
          conn,
          `SELECT fra.id_branch, fra.estimated_counterparty_exposure
           FROM fronting_run_adjustments fra
           JOIN (
             SELECT MAX(snapshot_date) AS max_snapshot_date
             FROM fronting_run_adjustments
             WHERE scenario_id = ? AND run_id = ? AND snapshot_date <= ?
           ) mx ON fra.snapshot_date = mx.max_snapshot_date
           WHERE fra.scenario_id = ?
             AND fra.run_id = ?`,
          [Number(scenarioId), referenceRunIdNum, dateIso, Number(scenarioId), referenceRunIdNum]
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const premiumByBranch = buildMaps(premiumRows, "id_branch", (r) => ({ premium_paid_ytd: Number(r.premium_paid_ytd || 0) }));
  const claimsByBranch = buildMaps(claimRows, "id_branch", (r) => ({
    claims_count: Number(r.claims_count || 0),
    estimated_total: Number(r.estimated_total || 0),
    paid_total: Number(r.paid_total || 0),
    reserve_outstanding: Number(r.reserve_outstanding || 0),
  }));
  const rePremByBranch = buildMaps(rePremRows, "id_branch", (r) => ({ premium_ceded: Number(r.premium_ceded || 0) }));
  const reClaimByBranch = buildMaps(reClaimRows, "id_branch", (r) => ({
    paid_ceded: Number(r.paid_ceded || 0),
    reserve_ceded: Number(r.reserve_ceded || 0),
  }));
  const frontingByBranch = buildMaps(frontingRows, "id_branch", (r) => ({
    estimated_counterparty_exposure: Number(r.estimated_counterparty_exposure || 0),
  }));

  const methodologyVersionRef = refS2Row?.methodology_version ? String(refS2Row.methodology_version) : null;
  const profileKey = selectS2ProfileKey(methodologyVersionRef);

  let totalClaimsCount = 0;
  let premCharge = 0;
  let reserveCharge = 0;
  let catBase = 0;
  let counterpartyBase = 0;
  let premiumPaidYtdTotal = 0;
  let reserveOutstandingTotal = 0;
  let estimatedTotal = 0;
  let paidTotal = 0;
  let cptyFromReinsTotal = 0;
  let cptyFromFrontingTotal = 0;

  const inputs = (branches || []).map((b) => {
    const branchId = Number(b.id_branch || 0);
    const s2Code = String(b.s2_code || "");
    const name = String(b.name || "");
    const p = premiumByBranch.get(branchId) || { premium_paid_ytd: 0 };
    const c = claimsByBranch.get(branchId) || { claims_count: 0, estimated_total: 0, paid_total: 0, reserve_outstanding: 0 };
    const rp = rePremByBranch.get(branchId) || { premium_ceded: 0 };
    const rc = reClaimByBranch.get(branchId) || { paid_ceded: 0, reserve_ceded: 0 };
    const fr = frontingByBranch.get(branchId) || { estimated_counterparty_exposure: 0 };
    const sigma = sigmaByS2Code(s2Code);

    const premiumVolume = Number(p.premium_paid_ytd || 0);
    const reserveVolume = Number(c.reserve_outstanding || 0);
    const catExposure = s2Code === "08" ? premiumVolume * 0.2 : 0;
    const counterpartyExposure =
      Number(rp.premium_ceded || 0) +
      Number(rc.paid_ceded || 0) +
      Number(rc.reserve_ceded || 0) +
      Number(fr.estimated_counterparty_exposure || 0);

    totalClaimsCount += Number(c.claims_count || 0);
    premiumPaidYtdTotal += premiumVolume;
    reserveOutstandingTotal += reserveVolume;
    estimatedTotal += Number(c.estimated_total || 0);
    paidTotal += Number(c.paid_total || 0);
    cptyFromReinsTotal += Number(rp.premium_ceded || 0) + Number(rc.paid_ceded || 0) + Number(rc.reserve_ceded || 0);
    cptyFromFrontingTotal += Number(fr.estimated_counterparty_exposure || 0);

    premCharge += premiumVolume * sigma.sigma_premium;
    reserveCharge += reserveVolume * sigma.sigma_reserve;
    catBase += catExposure;
    counterpartyBase += counterpartyExposure;

    return {
      id_branch: branchId,
      s2_code: s2Code || null,
      branch_label: name || null,
      premium_volume: round2(premiumVolume),
      reserve_volume: round2(reserveVolume),
      cat_exposure: round2(catExposure),
      counterparty_exposure: round2(counterpartyExposure),
      sigma_premium: sigma.sigma_premium,
      sigma_reserve: sigma.sigma_reserve,
      corr_group_code: "NL",
      source_breakdown_json: {
        premium_paid_ytd: round2(premiumVolume),
        reserve_outstanding_to_date: round2(reserveVolume),
        estimated_claims_to_date: round2(c.estimated_total),
        paid_claims_to_date: round2(c.paid_total),
        counterparty_components_reference_run: {
          premium_ceded: round2(rp.premium_ceded || 0),
          claim_paid_ceded: round2(rc.paid_ceded || 0),
          claim_reserve_ceded: round2(rc.reserve_ceded || 0),
          fronting_counterparty_exposure: round2(fr.estimated_counterparty_exposure || 0),
        },
      },
    };
  });

  const catChargeFactor = s2CfgNum(s2Cfg, `${profileKey}.cat_charge_factor`, s2CfgNum(s2Cfg, "claims_v1.cat_charge_factor", 0.25));
  const cptyFactor = s2CfgNum(s2Cfg, `${profileKey}.counterparty_charge_factor`, 0);
  const nonlifeMultiplier = s2CfgNum(s2Cfg, `${profileKey}.nonlife_multiplier`, 0.8);

  const scrNonLife = (premCharge + reserveCharge + catBase * catChargeFactor) * nonlifeMultiplier;
  const scrCounterparty = cptyFactor > 0 ? counterpartyBase * cptyFactor : 0;
  const scrMarket = 0;
  const scrOperational =
    profileKey === "claims_v1"
      ? Math.max(
          s2CfgNum(s2Cfg, "claims_v1.operational_min_eur", 100000),
          totalClaimsCount * s2CfgNum(s2Cfg, "claims_v1.operational_per_claim_eur", 50)
        )
      : s2CfgNum(s2Cfg, `${profileKey}.operational_fixed_eur`, s2CfgNum(s2Cfg, "reinsurance_v1.operational_fixed_eur", 350000));

  const scrBscr = scrNonLife + scrCounterparty + scrMarket;
  const scrTotal = scrBscr + scrOperational;
  const mcr = s2CfgNum(s2Cfg, "mcr_eur", 2_700_000);

  const manualOwnFunds = ownFundsManualInputEur == null || ownFundsManualInputEur === "" ? null : Number(ownFundsManualInputEur);
  const proxyOwnFunds = s2CfgNum(s2Cfg, "own_funds_eligible_base_eur", 12_000_000);
  const normalizedMode = ["auto", "proxy", "manual"].includes(String(ownFundsMode || "").toLowerCase())
    ? String(ownFundsMode).toLowerCase()
    : "auto";
  const ownFundsSourceUsed =
    normalizedMode === "manual" && Number.isFinite(manualOwnFunds)
      ? "manual"
      : normalizedMode === "proxy"
      ? "proxy"
      : Number.isFinite(manualOwnFunds)
      ? "manual"
      : "proxy";
  const ownFundsEligible = ownFundsSourceUsed === "manual" ? Number(manualOwnFunds || 0) : proxyOwnFunds;
  const solvencyRatioPct = scrTotal > 0 ? (ownFundsEligible / scrTotal) * 100 : null;

  const methodologyVersion = `real-asof-${profileKey}${methodologyVersionRef ? ` (ref:${methodologyVersionRef})` : ""}`;

  return {
    ok: true,
    snapshot: {
      captive_id: Number(captiveId),
      scenario_id: Number(scenarioId) > 0 ? Number(scenarioId) : null,
      reference_run_id: referenceRunIdNum,
      snapshot_date: dateIso,
      snapshot_year_month: dateIso.slice(0, 7),
      own_funds_mode: normalizedMode,
      own_funds_manual_input_eur: Number.isFinite(manualOwnFunds) ? round2(manualOwnFunds) : null,
      own_funds_source_used: ownFundsSourceUsed,
      own_funds_eligible: round2(ownFundsEligible),
      scr_non_life: round2(scrNonLife),
      scr_counterparty: round2(scrCounterparty),
      scr_market: round2(scrMarket),
      scr_operational: round2(scrOperational),
      scr_bscr: round2(scrBscr),
      scr_total: round2(scrTotal),
      mcr: round2(mcr),
      solvency_ratio_pct: solvencyRatioPct == null ? null : round2(solvencyRatioPct),
      methodology_version: methodologyVersion,
    },
    inputs_non_life: inputs,
    calc_scope: {
      basis: "real_as_of_date_placeholder_mvp",
      snapshot_date: dateIso,
      premium_basis: "cash_paid_ytd",
      premium_period_start: yStart,
      reserve_basis: "claims_estimated_minus_paid_as_of_date",
      reserve_claim_filter: "COALESCE(date_decl,date_survenue)<=snapshot_date",
      branch_mapping_basis: "programme.branch_s2_code",
      reinsurance_fronting_counterparty_basis: referenceRunIdNum
        ? "reference_run_ceded_and_fronting_exposure_as_of_date"
        : "not_included_mvp_no_reference_run",
      reference_run_id: referenceRunIdNum,
      reference_run_s2_methodology_version: methodologyVersionRef,
      selected_placeholder_profile: profileKey,
      totals: {
        premium_paid_ytd_total: round2(premiumPaidYtdTotal),
        reserve_outstanding_total: round2(reserveOutstandingTotal),
        estimated_claims_to_date_total: round2(estimatedTotal),
        paid_claims_to_date_total: round2(paidTotal),
        claims_count_to_date: Number(totalClaimsCount || 0),
        counterparty_exposure_from_reinsurance_total: round2(cptyFromReinsTotal),
        counterparty_exposure_from_fronting_total: round2(cptyFromFrontingTotal),
      },
    },
    engine_config: s2Cfg,
  };
}

export async function saveS2RealSnapshot({
  captiveId,
  scenarioId,
  referenceRunId = null,
  snapshotDate,
  ownFundsMode = "auto",
  ownFundsManualInputEur = null,
  overwrite = false,
  user = null,
}) {
  const computed = await calculateS2RealSnapshot({
    captiveId,
    scenarioId,
    referenceRunId,
    snapshotDate,
    ownFundsMode,
    ownFundsManualInputEur,
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const snapshot = computed.snapshot;
    const existing = await q1(
      conn,
      `SELECT id FROM s2_scr_results_real WHERE captive_id = ? AND snapshot_date = ? LIMIT 1`,
      [Number(captiveId), snapshot.snapshot_date]
    );

    if (existing && !overwrite) {
      const err = new Error("s2_real_snapshot_exists");
      err.code = "S2_REAL_SNAPSHOT_EXISTS";
      throw err;
    }

    const createdByUserId = Number.isFinite(Number(user?.uid)) ? Number(user.uid) : Number.isFinite(Number(user?.id)) ? Number(user.id) : null;
    const createdByName = safeUserDisplay(user);

    await conn.query(
      `INSERT INTO s2_scr_results_real
        (id, captive_id, scenario_id, reference_run_id, snapshot_date, snapshot_year_month,
         own_funds_mode, own_funds_manual_input_eur, own_funds_source_used, own_funds_eligible,
         scr_non_life, scr_counterparty, scr_market, scr_operational, scr_bscr, scr_total,
         mcr, solvency_ratio_pct, methodology_version, engine_config_json, calc_scope_json, status,
         created_by_user_id, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated', ?, ?)
       ON DUPLICATE KEY UPDATE
         scenario_id = VALUES(scenario_id),
         reference_run_id = VALUES(reference_run_id),
         snapshot_year_month = VALUES(snapshot_year_month),
         own_funds_mode = VALUES(own_funds_mode),
         own_funds_manual_input_eur = VALUES(own_funds_manual_input_eur),
         own_funds_source_used = VALUES(own_funds_source_used),
         own_funds_eligible = VALUES(own_funds_eligible),
         scr_non_life = VALUES(scr_non_life),
         scr_counterparty = VALUES(scr_counterparty),
         scr_market = VALUES(scr_market),
         scr_operational = VALUES(scr_operational),
         scr_bscr = VALUES(scr_bscr),
         scr_total = VALUES(scr_total),
         mcr = VALUES(mcr),
         solvency_ratio_pct = VALUES(solvency_ratio_pct),
         methodology_version = VALUES(methodology_version),
         engine_config_json = VALUES(engine_config_json),
         calc_scope_json = VALUES(calc_scope_json),
         status = VALUES(status),
         created_by_user_id = COALESCE(VALUES(created_by_user_id), created_by_user_id),
         created_by_name = COALESCE(VALUES(created_by_name), created_by_name),
         updated_at = CURRENT_TIMESTAMP`,
      [
        existing ? Number(existing.id) : null,
        Number(captiveId),
        snapshot.scenario_id,
        snapshot.reference_run_id,
        snapshot.snapshot_date,
        snapshot.snapshot_year_month,
        snapshot.own_funds_mode,
        snapshot.own_funds_manual_input_eur,
        snapshot.own_funds_source_used,
        snapshot.own_funds_eligible,
        snapshot.scr_non_life,
        snapshot.scr_counterparty,
        snapshot.scr_market,
        snapshot.scr_operational,
        snapshot.scr_bscr,
        snapshot.scr_total,
        snapshot.mcr,
        snapshot.solvency_ratio_pct,
        snapshot.methodology_version,
        JSON.stringify(computed.engine_config || null),
        JSON.stringify(computed.calc_scope || null),
        createdByUserId,
        createdByName,
      ]
    );

    const row = await q1(conn, `SELECT id, created_at, updated_at FROM s2_scr_results_real WHERE captive_id = ? AND snapshot_date = ?`, [
      Number(captiveId),
      snapshot.snapshot_date,
    ]);
    const realResultId = Number(row?.id || existing?.id || 0);
    if (!realResultId) throw new Error("s2_real_snapshot_save_failed");

    await conn.query(`DELETE FROM s2_scr_inputs_non_life_real WHERE real_result_id = ?`, [realResultId]);

    if (computed.inputs_non_life?.length) {
      const cols = [
        "real_result_id",
        "captive_id",
        "snapshot_date",
        "id_branch",
        "s2_code",
        "branch_label",
        "premium_volume",
        "reserve_volume",
        "cat_exposure",
        "counterparty_exposure",
        "sigma_premium",
        "sigma_reserve",
        "corr_group_code",
        "source_breakdown_json",
      ];
      const placeholders = computed.inputs_non_life.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
      const values = [];
      for (const r of computed.inputs_non_life) {
        values.push(
          realResultId,
          Number(captiveId),
          snapshot.snapshot_date,
          Number(r.id_branch || 0),
          r.s2_code || null,
          r.branch_label || null,
          round2(r.premium_volume),
          round2(r.reserve_volume),
          round2(r.cat_exposure),
          round2(r.counterparty_exposure),
          Number(r.sigma_premium || 0),
          Number(r.sigma_reserve || 0),
          r.corr_group_code || null,
          JSON.stringify(r.source_breakdown_json || null)
        );
      }
      await conn.query(`INSERT INTO s2_scr_inputs_non_life_real (${cols.join(",")}) VALUES ${placeholders}`, values);
    }

    await conn.commit();
    return {
      ...computed,
      saved: {
        id: realResultId,
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || null,
        overwritten: !!existing,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function listS2RealSnapshotsByYear({ captiveId, year }) {
  const yearStart = `${Number(year)}-01-01`;
  const yearEnd = `${Number(year)}-12-31`;
  const rows = await qa(
    pool,
    `SELECT id, snapshot_date, reference_run_id, own_funds_mode, own_funds_source_used, own_funds_eligible, scr_total, mcr, solvency_ratio_pct, status, methodology_version, updated_at
     FROM s2_scr_results_real
     WHERE captive_id = ? AND snapshot_date BETWEEN ? AND ?
     ORDER BY snapshot_date DESC`,
    [Number(captiveId), yearStart, yearEnd]
  );
  return rows.map((r) => ({
    id: Number(r.id || 0),
    snapshot_date: toIsoDate(r.snapshot_date),
    reference_run_id: r.reference_run_id == null ? null : Number(r.reference_run_id),
    own_funds_mode: r.own_funds_mode || null,
    own_funds_source_used: r.own_funds_source_used || null,
    own_funds_eligible: Number(r.own_funds_eligible || 0),
    scr_total: Number(r.scr_total || 0),
    mcr: Number(r.mcr || 0),
    solvency_ratio_pct: r.solvency_ratio_pct == null ? null : Number(r.solvency_ratio_pct),
    status: r.status || null,
    methodology_version: r.methodology_version || null,
    updated_at: r.updated_at || null,
  }));
}
