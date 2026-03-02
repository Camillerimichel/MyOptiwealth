import { Router } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { loadS2EnginePlaceholderConfig } from "../db/s2EngineConfig.js";
import { calculateS2RealSnapshot, listS2RealSnapshotsByYear, saveS2RealSnapshot } from "../db/s2RealSnapshots.js";

const router = Router();
const canView = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];
const canEditEngineFiles = ["admin", "actuaire"];
const execFileAsync = promisify(execFile);

async function q1(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function qa(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

function parseJsonMaybe(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function clampNum(v, min, max) {
  const x = Number(v);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
}

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepMergeObj(base, patch) {
  const out = { ...(isObj(base) ? base : {}) };
  if (!isObj(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMergeObj(out[k], v);
    else out[k] = v;
  }
  return out;
}

function normNum(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function sanitizeS2EnginePlaceholderConfig(input, fallbackCfg) {
  const merged = deepMergeObj(fallbackCfg, input);
  return {
    own_funds_eligible_base_eur: normNum(merged.own_funds_eligible_base_eur, fallbackCfg.own_funds_eligible_base_eur),
    mcr_eur: normNum(merged.mcr_eur, fallbackCfg.mcr_eur),
    claims_v1: {
      cat_charge_factor: normNum(merged?.claims_v1?.cat_charge_factor, fallbackCfg.claims_v1.cat_charge_factor),
      nonlife_multiplier: normNum(merged?.claims_v1?.nonlife_multiplier, fallbackCfg.claims_v1.nonlife_multiplier),
      operational_min_eur: normNum(merged?.claims_v1?.operational_min_eur, fallbackCfg.claims_v1.operational_min_eur),
      operational_per_claim_eur: normNum(merged?.claims_v1?.operational_per_claim_eur, fallbackCfg.claims_v1.operational_per_claim_eur),
    },
    reinsurance_v1: {
      cat_charge_factor: normNum(merged?.reinsurance_v1?.cat_charge_factor, fallbackCfg.reinsurance_v1.cat_charge_factor),
      counterparty_charge_factor: normNum(
        merged?.reinsurance_v1?.counterparty_charge_factor,
        fallbackCfg.reinsurance_v1.counterparty_charge_factor
      ),
      nonlife_multiplier: normNum(merged?.reinsurance_v1?.nonlife_multiplier, fallbackCfg.reinsurance_v1.nonlife_multiplier),
      operational_fixed_eur: normNum(merged?.reinsurance_v1?.operational_fixed_eur, fallbackCfg.reinsurance_v1.operational_fixed_eur),
    },
    cat_xol_v2: {
      cat_charge_factor: normNum(merged?.cat_xol_v2?.cat_charge_factor, fallbackCfg.cat_xol_v2.cat_charge_factor),
      counterparty_charge_factor: normNum(merged?.cat_xol_v2?.counterparty_charge_factor, fallbackCfg.cat_xol_v2.counterparty_charge_factor),
      nonlife_multiplier: normNum(merged?.cat_xol_v2?.nonlife_multiplier, fallbackCfg.cat_xol_v2.nonlife_multiplier),
      operational_fixed_eur: normNum(merged?.cat_xol_v2?.operational_fixed_eur, fallbackCfg.cat_xol_v2.operational_fixed_eur),
    },
    fronting_v2: {
      cat_charge_factor: normNum(merged?.fronting_v2?.cat_charge_factor, fallbackCfg.fronting_v2.cat_charge_factor),
      counterparty_charge_factor: normNum(
        merged?.fronting_v2?.counterparty_charge_factor,
        fallbackCfg.fronting_v2.counterparty_charge_factor
      ),
      nonlife_multiplier: normNum(merged?.fronting_v2?.nonlife_multiplier, fallbackCfg.fronting_v2.nonlife_multiplier),
      operational_fixed_eur: normNum(merged?.fronting_v2?.operational_fixed_eur, fallbackCfg.fronting_v2.operational_fixed_eur),
    },
  };
}

async function ensureAlmV3StressDefaults(profileId) {
  if (!profileId) return;
  const scenarios = [
    {
      code: "ADVERSE",
      label: "ALM Stress Adverse",
      inflow_mult: 0.965,
      outflow_mult: 1.18,
      liquidity_source_mult_d1: 0.95,
      liquidity_source_mult_d7: 0.92,
      liquidity_source_mult_d30: 0.9,
      liquidity_use_mult_d1: 1.2,
      liquidity_use_mult_d7: 1.22,
      liquidity_use_mult_d30: 1.25,
      allow_negative_cash: 1,
      allow_negative_liquidity_buffer: 1,
      duration_asset_shift_years: 0.15,
      duration_liability_mult: 1.08,
      own_funds_mult: 0.9,
      s2_mult: 1.08,
      cat_mult: 1.25,
    },
    {
      code: "SEVERE",
      label: "ALM Stress Severe",
      inflow_mult: 0.9,
      outflow_mult: 1.38,
      liquidity_source_mult_d1: 0.88,
      liquidity_source_mult_d7: 0.82,
      liquidity_source_mult_d30: 0.78,
      liquidity_use_mult_d1: 1.4,
      liquidity_use_mult_d7: 1.55,
      liquidity_use_mult_d30: 1.7,
      allow_negative_cash: 1,
      allow_negative_liquidity_buffer: 1,
      duration_asset_shift_years: 0.35,
      duration_liability_mult: 1.18,
      own_funds_mult: 0.76,
      s2_mult: 1.22,
      cat_mult: 1.7,
    },
  ];

  for (const s of scenarios) {
    await pool.query(
      `INSERT INTO alm_v3_stress_scenarios
         (profile_id, stress_code, label, inflow_mult, outflow_mult,
          liquidity_source_mult_d1, liquidity_source_mult_d7, liquidity_source_mult_d30,
          liquidity_use_mult_d1, liquidity_use_mult_d7, liquidity_use_mult_d30,
          allow_negative_cash, allow_negative_liquidity_buffer, duration_asset_shift_years,
          duration_liability_mult, own_funds_mult, s2_mult, cat_mult, comments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_OBJECT('seed','v6'))
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         updated_at = CURRENT_TIMESTAMP`,
      [
        profileId,
        s.code,
        s.label,
        s.inflow_mult,
        s.outflow_mult,
        s.liquidity_source_mult_d1,
        s.liquidity_source_mult_d7,
        s.liquidity_source_mult_d30,
        s.liquidity_use_mult_d1,
        s.liquidity_use_mult_d7,
        s.liquidity_use_mult_d30,
        s.allow_negative_cash,
        s.allow_negative_liquidity_buffer,
        s.duration_asset_shift_years,
        s.duration_liability_mult,
        s.own_funds_mult,
        s.s2_mult,
        s.cat_mult,
      ]
    ).catch(() => null);
  }

  const rows = await qa(
    `SELECT id, stress_code FROM alm_v3_stress_scenarios WHERE profile_id = ? AND active = 1`,
    [profileId]
  ).catch(() => []);
  const byCode = Object.fromEntries(rows.map((r) => [String(r.stress_code).toUpperCase(), Number(r.id)]));
  const assetDefaults = {
    ADVERSE: {
      CASH: { mv: 1, dur: 0, l1: 1, l7: 1, l30: 1 },
      BOND_ST: { mv: 0.995, dur: 0.05, l1: 0.98, l7: 0.98, l30: 0.99 },
      BOND_MT: { mv: 0.98, dur: 0.12, l1: 0.9, l7: 0.94, l30: 0.97 },
      BOND_LT: { mv: 0.955, dur: 0.25, l1: 0.75, l7: 0.84, l30: 0.92 },
      DIVERS: { mv: 0.93, dur: 0.1, l1: 0.55, l7: 0.68, l30: 0.82 },
    },
    SEVERE: {
      CASH: { mv: 1, dur: 0, l1: 1, l7: 1, l30: 1 },
      BOND_ST: { mv: 0.985, dur: 0.1, l1: 0.94, l7: 0.95, l30: 0.97 },
      BOND_MT: { mv: 0.955, dur: 0.25, l1: 0.72, l7: 0.82, l30: 0.9 },
      BOND_LT: { mv: 0.91, dur: 0.55, l1: 0.5, l7: 0.65, l30: 0.82 },
      DIVERS: { mv: 0.84, dur: 0.2, l1: 0.25, l7: 0.4, l30: 0.62 },
    },
  };
  for (const [stressCode, assetMap] of Object.entries(assetDefaults)) {
    const scenarioId = byCode[stressCode];
    if (!scenarioId) continue;
    for (const [assetCode, spec] of Object.entries(assetMap)) {
      await pool.query(
        `INSERT INTO alm_v3_stress_asset_class_shocks
           (stress_scenario_id, asset_code, mv_mult, duration_shift_years, liquidity_source_mult_d1, liquidity_source_mult_d7, liquidity_source_mult_d30, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           updated_at = CURRENT_TIMESTAMP`,
        [scenarioId, assetCode, spec.mv, spec.dur, spec.l1, spec.l7, spec.l30]
      ).catch(() => null);
    }
  }
}

async function ensureAlmV3AlertThresholdDefaults(profileId) {
  if (!profileId) return;
  await pool.query(
    `UPDATE alm_v3_profiles
     SET liq_alert_tension_threshold_eur = COALESCE(liq_alert_tension_threshold_eur, 0),
         liq_alert_vigilance_threshold_eur = COALESCE(liq_alert_vigilance_threshold_eur, 500000),
         duration_alert_vigilance_abs_years = COALESCE(duration_alert_vigilance_abs_years, 3),
         duration_alert_tension_abs_years = COALESCE(duration_alert_tension_abs_years, 5)
     WHERE id = ?`,
    [profileId]
  ).catch(() => null);
}

async function ensureAlmV2DefaultConfig(captiveId, selectedSet) {
  const scenarioId = selectedSet?.scenario_id || null;
  const configCode = "ALM_PROXY_V2_DEFAULT";

  await pool.query(
    `INSERT INTO alm_v2_configs (captive_id, scenario_id, code, name, status, is_default, methodology_version)
     VALUES (?, ?, ?, 'ALM Proxy V2 - défaut', 'active', 1, 'alm-proxy-v2')
     ON DUPLICATE KEY UPDATE
       scenario_id = VALUES(scenario_id),
       status = 'active',
       is_default = 1`,
    [captiveId, scenarioId, configCode]
  );

  const config = await q1(
    `SELECT * FROM alm_v2_configs WHERE captive_id = ? AND code = ? LIMIT 1`,
    [captiveId, configCode]
  );
  if (!config) throw new Error("alm_config_not_created");

  const bucketDefaults = [
    ["LT1", "< 1 an", 0, 1, 1],
    ["Y1_3", "1 à 3 ans", 1, 3, 2],
    ["Y3_7", "3 à 7 ans", 3, 7, 3],
    ["Y7P", "> 7 ans", 7, null, 4],
  ];
  for (const [code, label, minY, maxY, order] of bucketDefaults) {
    await pool.query(
      `INSERT INTO alm_v2_duration_buckets (config_id, bucket_code, label, min_years, max_years, display_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         min_years = VALUES(min_years),
         max_years = VALUES(max_years),
         display_order = VALUES(display_order)`,
      [config.id, code, label, minY, maxY, order]
    );
  }

  const assetDefaults = [
    ["CASH", "Trésorerie / monétaire", 0.25, 30, "low", 1],
    ["BOND_ST", "Obligataire court terme", 1.5, 90, "low", 2],
    ["BOND_MT", "Obligataire moyen terme", 4, 180, "medium", 3],
    ["BOND_LT", "Obligataire long terme", 8, 365, "medium", 4],
    ["DIVERS", "Actifs de rendement diversifiés", 5, 270, "high", 5],
  ];
  for (const [code, label, durationY, liqDays, riskBucket, order] of assetDefaults) {
    await pool.query(
      `INSERT INTO alm_v2_asset_classes (config_id, asset_code, label, default_duration_years, liquidity_horizon_days, risk_bucket, display_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         default_duration_years = VALUES(default_duration_years),
         liquidity_horizon_days = VALUES(liquidity_horizon_days),
         risk_bucket = VALUES(risk_bucket),
         display_order = VALUES(display_order),
         active = 1`,
      [config.id, code, label, durationY, liqDays, riskBucket, order]
    );
  }

  const [bucketRows] = await pool.query(
    `SELECT id, bucket_code FROM alm_v2_duration_buckets WHERE config_id = ?`,
    [config.id]
  );
  const bucketByCode = Object.fromEntries(bucketRows.map((r) => [r.bucket_code, r.id]));

  const [assetRows] = await pool.query(
    `SELECT id, asset_code FROM alm_v2_asset_classes WHERE config_id = ?`,
    [config.id]
  );
  const assetByCode = Object.fromEntries(assetRows.map((r) => [r.asset_code, r.id]));

  const [allocCountRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM alm_v2_allocation_lines WHERE config_id = ?`,
    [config.id]
  );
  if (!Number(allocCountRows?.[0]?.c || 0)) {
    const allocDefaults = [
      ["CASH", "LT1", 20, 0.25, 30, "Liquidité / marge de sécurité", 1],
      ["BOND_ST", "Y1_3", 30, 1.5, 90, "Couverture court-moyen", 2],
      ["BOND_MT", "Y3_7", 25, 4, 180, "Noyau obligataire", 3],
      ["BOND_LT", "Y7P", 15, 8, 365, "Portage long", 4],
      ["DIVERS", "Y3_7", 10, 5, 270, "Rendement / diversification", 5],
    ];
    for (const [assetCode, bucketCode, weightPct, durationY, liqDays, commentText, order] of allocDefaults) {
      if (!assetByCode[assetCode]) continue;
      await pool.query(
        `INSERT INTO alm_v2_allocation_lines
           (config_id, asset_class_id, duration_bucket_id, target_weight_pct, duration_years_override, liquidity_horizon_days_override, comment_text, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [config.id, assetByCode[assetCode], bucketByCode[bucketCode] || null, weightPct, durationY, liqDays, commentText, order]
      );
    }
  }

  const branches = await qa(`SELECT id_branch, s2_code, name FROM insurance_branch ORDER BY s2_code`);
  for (const b of branches) {
    const s2 = String(b.s2_code || "");
    let baseYears = 2;
    let stressYears = 3;
    let lockFactor = 1.0;
    let liquidityPct = 15;
    if (s2 === "10") {
      baseYears = 1.2;
      stressYears = 2.0;
      lockFactor = 0.8;
      liquidityPct = 25;
    } else if (s2 === "08") {
      baseYears = 1.8;
      stressYears = 3.0;
      lockFactor = 1.0;
      liquidityPct = 30;
    } else if (s2 === "13") {
      baseYears = 4.5;
      stressYears = 7.0;
      lockFactor = 1.2;
      liquidityPct = 10;
    } else if (s2 === "02") {
      baseYears = 6.5;
      stressYears = 10.0;
      lockFactor = 1.35;
      liquidityPct = 8;
    } else if (s2 === "16") {
      baseYears = 1.5;
      stressYears = 2.5;
      lockFactor = 0.9;
      liquidityPct = 20;
    }
    await pool.query(
      `INSERT INTO alm_v2_branch_assumptions
         (config_id, id_branch, holding_years_base, holding_years_stress, capital_lock_factor, liquidity_need_pct, weighting_mode, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'incurred_reserve', ?)
       ON DUPLICATE KEY UPDATE
         weighting_mode = IFNULL(weighting_mode, 'incurred_reserve')`,
      [config.id, b.id_branch, baseYears, stressYears, lockFactor, liquidityPct, `Seed auto (${b.s2_code} ${b.name})`]
    );
  }

  return config;
}

async function computeAndStoreAlmProxy({ configId, selectedSet, referenceRunId = null }) {
  if (!selectedSet?.id) throw new Error("alm_requires_orsa_set");
  const orsaSetId = Number(selectedSet.id);
  const snapshotDate = selectedSet.snapshot_date;
  const baseRunId = Number(selectedSet.base_run_id);

  const members = await qa(
    `SELECT osm.run_id, osm.stress_code
     FROM orsa_run_set_members osm
     WHERE osm.orsa_set_id = ?`,
    [orsaSetId]
  );
  const runIds = [...new Set(members.map((m) => Number(m.run_id)).filter(Number.isFinite))];
  const selectedReferenceRunId =
    Number.isFinite(Number(referenceRunId)) && runIds.includes(Number(referenceRunId))
      ? Number(referenceRunId)
      : baseRunId;

  const comparison = await qa(
    `SELECT run_id, stress_code, scr_total, own_funds_eligible
     FROM orsa_run_comparison_snapshots
     WHERE orsa_set_id = ?`,
    [orsaSetId]
  );
  const baseComp =
    comparison.find((r) => Number(r.run_id) === selectedReferenceRunId) ||
    comparison.find((r) => String(r.stress_code).toUpperCase() === "BASE") ||
    comparison[0] ||
    null;
  const peakScr = comparison.reduce((m, r) => Math.max(m, Number(r.scr_total || 0)), 0);

  const branchRows = await qa(
    `SELECT pbs.id_branch, ib.s2_code, ib.name AS branch_label,
            pbs.gwp_gross, pbs.gwp_net, pbs.incurred_gross, pbs.incurred_net, pbs.rbns_gross, pbs.ibnr_gross
     FROM portfolio_branch_snapshots pbs
     JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
     WHERE pbs.run_id = ? AND pbs.snapshot_date = ?
     ORDER BY ib.s2_code`,
    [selectedReferenceRunId, snapshotDate]
  );

  const branchAssumptions = await qa(
    `SELECT aba.*, ib.s2_code, ib.name AS branch_label
     FROM alm_v2_branch_assumptions aba
     JOIN insurance_branch ib ON ib.id_branch = aba.id_branch
     WHERE aba.config_id = ?
     ORDER BY ib.s2_code`,
    [configId]
  );
  const assumptionByBranch = new Map(branchAssumptions.map((r) => [Number(r.id_branch), r]));

  const allocationRows = await qa(
    `SELECT al.id, al.target_weight_pct, al.duration_years_override, al.liquidity_horizon_days_override, al.comment_text, al.display_order,
            ac.asset_code, ac.label AS asset_label, ac.default_duration_years, ac.liquidity_horizon_days, ac.active,
            db.bucket_code, db.label AS bucket_label
     FROM alm_v2_allocation_lines al
     JOIN alm_v2_asset_classes ac ON ac.id = al.asset_class_id
     LEFT JOIN alm_v2_duration_buckets db ON db.id = al.duration_bucket_id
     WHERE al.config_id = ?
     ORDER BY al.display_order, al.id`,
    [configId]
  );

  const branchProxy = branchRows.map((b) => {
    const a = assumptionByBranch.get(Number(b.id_branch));
    const incurred = Number(b.incurred_net || b.incurred_gross || 0);
    const reserve = Number(b.rbns_gross || 0) + Number(b.ibnr_gross || 0);
    const gwp = Number(b.gwp_net || b.gwp_gross || 0);
    const lockFactor = Number(a?.capital_lock_factor || 1);
    const proxyWeight = Math.max(0, incurred) + Math.max(0, reserve) + Math.max(0, gwp * 0.15 * lockFactor);
    return {
      ...b,
      assumption: a || null,
      incurred,
      reserve,
      gwp,
      proxyWeight,
      holdBase: Number(a?.holding_years_base || 2),
      holdStress: Number(a?.holding_years_stress || 3),
      liquidityPct: Number(a?.liquidity_need_pct || 0),
    };
  });

  const totalProxyWeight = branchProxy.reduce((s, r) => s + Number(r.proxyWeight || 0), 0) || 1;
  const weightedHoldingBase = branchProxy.reduce((s, r) => s + (r.proxyWeight / totalProxyWeight) * r.holdBase, 0);
  const weightedHoldingStress = branchProxy.reduce((s, r) => s + (r.proxyWeight / totalProxyWeight) * r.holdStress, 0);
  const liquidityNeedPctWeighted = branchProxy.reduce((s, r) => s + (r.proxyWeight / totalProxyWeight) * r.liquidityPct, 0);

  const ownFundsBase = Number(baseComp?.own_funds_eligible || 0);
  const scrBase = Number(baseComp?.scr_total || 0);
  const ownFundsToAllocate = peakScr > 0 ? peakScr : scrBase;
  const shortLiquidityNeedAmount = ownFundsToAllocate * (liquidityNeedPctWeighted / 100);

  const activeAllocs = allocationRows.filter((r) => Number(r.active) !== 0);
  const totalWeightPct = activeAllocs.reduce((s, r) => s + Number(r.target_weight_pct || 0), 0) || 1;
  const assetResultRows = activeAllocs.map((r) => {
    const weightNorm = Number(r.target_weight_pct || 0) / totalWeightPct;
    const allocAmount = ownFundsToAllocate * weightNorm;
    const durationYears = Number(r.duration_years_override ?? r.default_duration_years ?? 0);
    const liqDays = Number(r.liquidity_horizon_days_override ?? r.liquidity_horizon_days ?? 0);
    return {
      asset_code: r.asset_code,
      asset_label: r.asset_label,
      duration_bucket_code: r.bucket_code,
      duration_bucket_label: r.bucket_label,
      target_weight_pct: weightNorm * 100,
      duration_years: durationYears,
      liquidity_horizon_days: liqDays,
      allocated_own_funds_amount: allocAmount,
      indicative_holding_years_base: Math.min(weightedHoldingBase, durationYears || weightedHoldingBase),
      indicative_holding_years_stress: Math.min(weightedHoldingStress, durationYears || weightedHoldingStress),
    };
  });

  const weightedAssetDurationYears =
    assetResultRows.reduce((s, r) => s + (Number(r.allocated_own_funds_amount || 0) * Number(r.duration_years || 0)), 0) /
    (assetResultRows.reduce((s, r) => s + Number(r.allocated_own_funds_amount || 0), 0) || 1);

  const bucketAgg = {};
  for (const r of assetResultRows) {
    const key = r.duration_bucket_code || "UNSET";
    if (!bucketAgg[key]) {
      bucketAgg[key] = {
        bucket_code: key,
        bucket_label: r.duration_bucket_label || "Non défini",
        target_weight_pct: 0,
        allocated_own_funds_amount: 0,
        avg_duration_num: 0,
      };
    }
    bucketAgg[key].target_weight_pct += Number(r.target_weight_pct || 0);
    bucketAgg[key].allocated_own_funds_amount += Number(r.allocated_own_funds_amount || 0);
    bucketAgg[key].avg_duration_num += Number(r.allocated_own_funds_amount || 0) * Number(r.duration_years || 0);
  }
  const bucketResultRows = Object.values(bucketAgg).map((b) => ({
    bucket_code: b.bucket_code,
    bucket_label: b.bucket_label,
    target_weight_pct: b.target_weight_pct,
    allocated_own_funds_amount: b.allocated_own_funds_amount,
    avg_duration_years: b.avg_duration_num / (b.allocated_own_funds_amount || 1),
  }));

  const comments = {
    run_ids_in_orsa_set: runIds,
    total_proxy_weight: Number(totalProxyWeight.toFixed(2)),
    liquidity_need_pct_weighted: Number(liquidityNeedPctWeighted.toFixed(4)),
    branch_proxy_breakdown: branchProxy.map((r) => ({
      id_branch: r.id_branch,
      s2_code: r.s2_code,
      branch_label: r.branch_label,
      proxy_weight: Number(r.proxyWeight.toFixed(2)),
      hold_base: r.holdBase,
      hold_stress: r.holdStress,
      liquidity_pct: r.liquidityPct,
    })),
    reference_run_id: selectedReferenceRunId,
  };

  await pool.query(
    `DELETE FROM alm_v2_results WHERE config_id = ? AND orsa_set_id = ? AND snapshot_date = ?`,
    [configId, orsaSetId, snapshotDate]
  );

  const [insRes] = await pool.query(
    `INSERT INTO alm_v2_results
       (config_id, orsa_set_id, scenario_id, run_id, snapshot_date, methodology_version, own_funds_base, scr_base, scr_peak_orsa, own_funds_to_allocate,
        weighted_holding_years_base, weighted_holding_years_stress, weighted_asset_duration_years, short_liquidity_need_amount, comments_json)
     VALUES (?, ?, ?, ?, ?, 'alm-proxy-v2', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      configId,
      orsaSetId,
      selectedSet.scenario_id || null,
      selectedReferenceRunId,
      snapshotDate,
      ownFundsBase,
      scrBase,
      peakScr,
      ownFundsToAllocate,
      Number(weightedHoldingBase.toFixed(4)),
      Number(weightedHoldingStress.toFixed(4)),
      Number((weightedAssetDurationYears || 0).toFixed(4)),
      Number(shortLiquidityNeedAmount.toFixed(2)),
      JSON.stringify(comments),
    ]
  );
  const resultId = insRes.insertId;

  for (const r of assetResultRows) {
    await pool.query(
      `INSERT INTO alm_v2_result_asset_classes
         (result_id, asset_code, asset_label, duration_bucket_code, duration_bucket_label, target_weight_pct, duration_years, liquidity_horizon_days,
          allocated_own_funds_amount, indicative_holding_years_base, indicative_holding_years_stress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resultId,
        r.asset_code,
        r.asset_label,
        r.duration_bucket_code,
        r.duration_bucket_label,
        Number(r.target_weight_pct.toFixed(4)),
        Number((r.duration_years || 0).toFixed(4)),
        r.liquidity_horizon_days,
        Number(r.allocated_own_funds_amount.toFixed(2)),
        Number(r.indicative_holding_years_base.toFixed(4)),
        Number(r.indicative_holding_years_stress.toFixed(4)),
      ]
    );
  }

  for (const b of bucketResultRows) {
    await pool.query(
      `INSERT INTO alm_v2_result_duration_buckets
         (result_id, bucket_code, bucket_label, target_weight_pct, allocated_own_funds_amount, avg_duration_years)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        resultId,
        b.bucket_code,
        b.bucket_label,
        Number((b.target_weight_pct || 0).toFixed(4)),
        Number((b.allocated_own_funds_amount || 0).toFixed(2)),
        Number((b.avg_duration_years || 0).toFixed(4)),
      ]
    );
  }

  return resultId;
}

async function getAlmProxyPayload(captiveId, requestedOrsaSetId, options = {}) {
  const orsaSets = await qa(
    `SELECT ors.id, ors.code, ors.name, ors.base_run_id, ors.snapshot_date, ors.status, ors.scenario_id
     FROM orsa_run_sets ors
     JOIN simulation_scenarios ss ON ss.id = ors.scenario_id
     WHERE ss.captive_id = ?
     ORDER BY ors.created_at DESC, ors.id DESC`,
    [captiveId]
  );
  let selectedSet = null;
  if (requestedOrsaSetId) selectedSet = orsaSets.find((r) => Number(r.id) === Number(requestedOrsaSetId)) || null;
  if (!selectedSet) selectedSet = orsaSets[0] || null;
  if (!selectedSet) return { ok: true, orsa_sets: [], selected_set: null };
  const setMembers = await qa(
    `SELECT run_id
     FROM orsa_run_set_members
     WHERE orsa_set_id = ?`,
    [selectedSet.id]
  ).catch(() => []);
  const setRunIds = [...new Set(setMembers.map((m) => Number(m.run_id)).filter(Number.isFinite))];
  const requestedRunId = options?.run_id ? Number(options.run_id) : null;
  const effectiveRunId = requestedRunId && setRunIds.includes(requestedRunId) ? requestedRunId : Number(selectedSet.base_run_id);

  const config = await ensureAlmV2DefaultConfig(captiveId, selectedSet);

  let result = await q1(
    `SELECT * FROM alm_v2_results WHERE config_id = ? AND orsa_set_id = ? AND snapshot_date = ? LIMIT 1`,
    [config.id, selectedSet.id, selectedSet.snapshot_date]
  );
  if (!result || Number(result.run_id || 0) !== Number(effectiveRunId)) {
    await computeAndStoreAlmProxy({ configId: config.id, selectedSet, referenceRunId: effectiveRunId });
    result = await q1(
      `SELECT * FROM alm_v2_results WHERE config_id = ? AND orsa_set_id = ? AND snapshot_date = ? LIMIT 1`,
      [config.id, selectedSet.id, selectedSet.snapshot_date]
    );
  }

  const durations = await qa(
    `SELECT id, bucket_code, label, min_years, max_years, display_order
     FROM alm_v2_duration_buckets
     WHERE config_id = ?
     ORDER BY display_order, id`,
    [config.id]
  );
  const assets = await qa(
    `SELECT ac.id, ac.asset_code, ac.label, ac.default_duration_years, ac.liquidity_horizon_days, ac.risk_bucket, ac.display_order,
            al.id AS allocation_id, al.duration_bucket_id, al.target_weight_pct, al.duration_years_override, al.liquidity_horizon_days_override, al.comment_text,
            db.bucket_code, db.label AS bucket_label
     FROM alm_v2_asset_classes ac
     LEFT JOIN alm_v2_allocation_lines al ON al.asset_class_id = ac.id AND al.config_id = ac.config_id
     LEFT JOIN alm_v2_duration_buckets db ON db.id = al.duration_bucket_id
     WHERE ac.config_id = ?
     ORDER BY ac.display_order, ac.id`,
    [config.id]
  );
  const branchAssumptions = await qa(
    `SELECT aba.id, aba.id_branch, ib.s2_code, ib.name AS branch_label,
            aba.holding_years_base, aba.holding_years_stress, aba.capital_lock_factor, aba.liquidity_need_pct, aba.weighting_mode, aba.notes
     FROM alm_v2_branch_assumptions aba
     JOIN insurance_branch ib ON ib.id_branch = aba.id_branch
     WHERE aba.config_id = ?
     ORDER BY ib.s2_code`,
    [config.id]
  );
  const resultAssetClasses = result
    ? await qa(
        `SELECT * FROM alm_v2_result_asset_classes WHERE result_id = ? ORDER BY id`,
        [result.id]
      )
    : [];
  const resultBuckets = result
    ? await qa(
        `SELECT * FROM alm_v2_result_duration_buckets WHERE result_id = ? ORDER BY id`,
        [result.id]
      )
    : [];

  let almV3Profile = await q1(
    `SELECT * FROM alm_v3_profiles WHERE captive_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1`,
    [captiveId]
  ).catch(() => null);

  let almV3Runs = [];
  let almV3RunSummaries = [];
  let almV3StressComparison = [];
  let almV3TimeSeries = [];
  let almV3StressConfigs = [];
  let almV3StressAssetShocks = [];
  let almV3Drilldown = null;
  let almV3Finance = null;
  if (almV3Profile) {
    await ensureAlmV3AlertThresholdDefaults(almV3Profile.id).catch(() => null);
    await ensureAlmV3StressDefaults(almV3Profile.id).catch(() => null);
    almV3Profile =
      (await q1(`SELECT * FROM alm_v3_profiles WHERE id = ? LIMIT 1`, [almV3Profile.id]).catch(() => null)) || almV3Profile;
    almV3Runs = await qa(
      `SELECT id, run_code, run_label, run_type, status, date_from, date_to, as_of_timestamp, scenario_json, created_at, ended_at
       FROM alm_v3_runs
       WHERE profile_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [almV3Profile.id]
    ).catch(() => []);

    almV3StressConfigs = await qa(
      `SELECT * FROM alm_v3_stress_scenarios WHERE profile_id = ? ORDER BY FIELD(UPPER(stress_code),'BASE','ADVERSE','SEVERE'), stress_code`,
      [almV3Profile.id]
    ).catch(() => []);
    if (almV3StressConfigs.length) {
      const cfgIds = almV3StressConfigs.map((r) => Number(r.id));
      const phc = cfgIds.map(() => "?").join(",");
      almV3StressAssetShocks = await qa(
        `SELECT * FROM alm_v3_stress_asset_class_shocks WHERE stress_scenario_id IN (${phc}) ORDER BY stress_scenario_id, asset_code`,
        cfgIds
      ).catch(() => []);
    }

    almV3RunSummaries = await qa(
      `SELECT
         r.id AS run_id,
         r.run_code,
         r.run_label,
         r.run_type,
         r.status,
         COUNT(s.id) AS snapshots_count,
         MIN(s.business_date) AS date_min,
         MAX(s.business_date) AS date_max,
         AVG(s.duration_gap) AS avg_duration_gap,
         MIN(s.duration_gap) AS min_duration_gap,
         MAX(s.duration_gap) AS max_duration_gap,
         AVG(s.liquidity_need_30d) AS avg_liquidity_need_30d,
         MAX(s.liquidity_need_30d) AS max_liquidity_need_30d,
         SUM(CASE WHEN s.net_liability_cashflow < 0 THEN 1 ELSE 0 END) AS deficit_days
       FROM alm_v3_runs r
       LEFT JOIN alm_v3_daily_snapshots s ON s.run_id = r.id
       WHERE r.profile_id = ?
       GROUP BY r.id
       ORDER BY r.id DESC
       LIMIT 20`,
      [almV3Profile.id]
    ).catch(() => []);

    const baseRun = almV3Runs.find((r) => r.run_type === "daily_snapshot" && String(r.run_code || "").includes("ALM_DAILY")) || almV3Runs[0] || null;
    if (baseRun) {
      const prefix = `${baseRun.run_code}__`;
      const stressRuns = almV3Runs.filter((r) => String(r.run_code || "").startsWith(prefix));
      const ids = [baseRun.id, ...stressRuns.map((r) => r.id)].filter(Boolean);
      if (ids.length) {
        const ph2 = ids.map(() => "?").join(",");
        almV3StressComparison = await qa(
          `SELECT
             r.id AS run_id, r.run_code, r.run_label, r.run_type, r.status,
             ds.business_date, ds.total_assets_mv, ds.total_cash_base_ccy, ds.total_liability_inflows, ds.total_liability_outflows,
             ds.net_liability_cashflow, ds.liquidity_buffer_available, ds.liquidity_need_1d, ds.liquidity_need_7d, ds.liquidity_need_30d,
             ds.duration_assets_weighted, ds.duration_liabilities_proxy, ds.duration_gap, ds.own_funds_proxy, ds.stress_peak_scr_ref
           FROM alm_v3_runs r
           JOIN (
             SELECT x.run_id, MAX(x.business_date) AS max_business_date
             FROM alm_v3_daily_snapshots x
             WHERE x.run_id IN (${ph2})
             GROUP BY x.run_id
           ) mx ON mx.run_id = r.id
           JOIN alm_v3_daily_snapshots ds ON ds.run_id = r.id AND ds.business_date = mx.max_business_date
           WHERE r.id IN (${ph2})
           ORDER BY r.id`,
          [...ids, ...ids]
        ).catch(() => []);

        const liqRows = await qa(
          `SELECT r.id AS run_id, l.horizon_code, l.net_liquidity_gap_amount, l.cumulative_liquidity_gap_amount
           FROM alm_v3_runs r
           JOIN (
             SELECT x.run_id, MAX(x.business_date) AS max_business_date
             FROM alm_v3_daily_snapshots x
             WHERE x.run_id IN (${ph2})
             GROUP BY x.run_id
           ) mx ON mx.run_id = r.id
           JOIN alm_v3_daily_snapshots ds ON ds.run_id = r.id AND ds.business_date = mx.max_business_date
           JOIN alm_v3_daily_liquidity_ladder l ON l.snapshot_id = ds.id
           WHERE r.id IN (${ph2})
           ORDER BY r.id, l.horizon_days`,
          [...ids, ...ids]
        ).catch(() => []);

        const liqByRun = liqRows.reduce((acc, row) => {
          const k = Number(row.run_id);
          if (!acc[k]) acc[k] = {};
          acc[k][row.horizon_code] = {
            net_liquidity_gap_amount: Number(row.net_liquidity_gap_amount || 0),
            cumulative_liquidity_gap_amount: Number(row.cumulative_liquidity_gap_amount || 0),
          };
          return acc;
        }, {});

        almV3StressComparison = almV3StressComparison.map((r) => ({
          ...r,
          liquidity_ladder: liqByRun[Number(r.run_id)] || {},
        }));
      }

      const chartPrefix = `${baseRun.run_code}__`;
      const chartRunIds = [baseRun.id]
        .concat(almV3Runs.filter((r) => String(r.run_code || "").startsWith(chartPrefix)).map((r) => r.id))
        .filter(Boolean);
      if (chartRunIds.length) {
        const ph3 = chartRunIds.map(() => "?").join(",");
        almV3TimeSeries = await qa(
          `SELECT
             r.id AS run_id,
             r.run_code,
             r.run_type,
             ds.business_date,
             ds.total_assets_mv,
             ds.total_cash_base_ccy,
             ds.total_liability_inflows,
             ds.total_liability_outflows,
             ds.net_liability_cashflow,
             ds.liquidity_buffer_available,
             ds.liquidity_need_7d,
             ds.liquidity_need_30d,
             ds.duration_gap
           FROM alm_v3_runs r
           JOIN alm_v3_daily_snapshots ds ON ds.run_id = r.id
           WHERE r.id IN (${ph3})
           ORDER BY ds.business_date, r.id`,
          chartRunIds
        ).catch(() => []);
      }

      const drillRunIdRequested = options?.alm_v3_run_id ? Number(options.alm_v3_run_id) : null;
      let drillRunId = drillRunIdRequested;
      if (!drillRunId || !almV3Runs.some((r) => Number(r.id) === drillRunId)) drillRunId = Number(baseRun.id);
      const drillDateRequested = options?.alm_v3_date ? String(options.alm_v3_date).slice(0, 10) : null;
      let drillSnapshot = null;
      if (drillRunId) {
        drillSnapshot = drillDateRequested
          ? await q1(
              `SELECT * FROM alm_v3_daily_snapshots WHERE run_id = ? AND business_date = ? LIMIT 1`,
              [drillRunId, drillDateRequested]
            ).catch(() => null)
          : null;
        if (!drillSnapshot) {
          drillSnapshot = await q1(
            `SELECT * FROM alm_v3_daily_snapshots WHERE run_id = ? ORDER BY business_date DESC LIMIT 1`,
            [drillRunId]
          ).catch(() => null);
        }
      }
      if (drillSnapshot) {
        const [durationLadder, liquidityLadder, assetClassRows, strataRows] = await Promise.all([
          qa(
            `SELECT dl.*, db.bucket_code, db.label AS bucket_label
             FROM alm_v3_daily_duration_ladder dl
             LEFT JOIN alm_v3_duration_buckets db ON db.id = dl.duration_bucket_id
             WHERE dl.snapshot_id = ? ORDER BY dl.business_date, db.display_order, dl.id`,
            [drillSnapshot.id]
          ).catch(() => []),
          qa(
            `SELECT * FROM alm_v3_daily_liquidity_ladder WHERE snapshot_id = ? ORDER BY horizon_days, id`,
            [drillSnapshot.id]
          ).catch(() => []),
          qa(
            `SELECT acs.*, ac.asset_code, ac.label AS asset_label
             FROM alm_v3_daily_asset_class_snapshots acs
             JOIN alm_v3_asset_classes ac ON ac.id = acs.asset_class_id
             WHERE acs.snapshot_id = ?
             ORDER BY ac.display_order, ac.id`,
            [drillSnapshot.id]
          ).catch(() => []),
          qa(
            `SELECT ss.*, st.strata_code, st.label AS strata_label
             FROM alm_v3_daily_strata_snapshots ss
             JOIN alm_v3_strata st ON st.id = ss.strata_id
             WHERE ss.snapshot_id = ?
             ORDER BY st.display_order, st.id`,
            [drillSnapshot.id]
          ).catch(() => []),
        ]);
        almV3Drilldown = {
          selected_run_id: drillRunId,
          selected_date: String(drillSnapshot.business_date).slice(0, 10),
          snapshot: drillSnapshot,
          duration_ladder: durationLadder,
          liquidity_ladder: liquidityLadder,
          asset_classes: assetClassRows,
          strata: strataRows,
        };
      }
    }

    const financeDateRequested = options?.finance_business_date ? String(options.finance_business_date).slice(0, 10) : null;
    const financeAssetCode = options?.finance_asset_code ? String(options.finance_asset_code) : null;
    const financeStrataCode = options?.finance_strata_code ? String(options.finance_strata_code) : null;
    const financeCounterpartyId = options?.finance_counterparty_id ? Number(options.finance_counterparty_id) : null;
    const financePositionId = options?.finance_position_id ? Number(options.finance_position_id) : null;

    const financeDates = await qa(
      `SELECT DISTINCT business_date
       FROM alm_v3_position_valuations_daily
       WHERE profile_id = ?
       ORDER BY business_date DESC
       LIMIT 370`,
      [almV3Profile.id]
    ).catch(() => []);
    const selectedFinanceDate = financeDateRequested || (financeDates[0] ? toIsoDate(financeDates[0].business_date) : null);
    const financeFilterClauses = ["p.profile_id = ?", "v.business_date = ?"];
    const financeParams = [almV3Profile.id, selectedFinanceDate];
    if (financeAssetCode) {
      financeFilterClauses.push("ac.asset_code = ?");
      financeParams.push(financeAssetCode);
    }
    if (financeStrataCode) {
      financeFilterClauses.push("st.strata_code = ?");
      financeParams.push(financeStrataCode);
    }
    if (financeCounterpartyId) {
      financeFilterClauses.push("cp.id = ?");
      financeParams.push(financeCounterpartyId);
    }
    const whereFinance = financeFilterClauses.join(" AND ");

    const financePositions = selectedFinanceDate
      ? await qa(
          `SELECT
             p.id AS position_id, p.portfolio_code, p.position_status, p.opened_on, p.closed_on, p.accounting_classification,
             st.strata_code, st.label AS strata_label,
             i.id AS instrument_id, i.instrument_code, i.instrument_name, i.instrument_type, i.currency, i.maturity_date, i.coupon_rate_pct,
             ac.asset_code, ac.label AS asset_label,
             cp.id AS counterparty_id, cp.name AS counterparty_name, cp.counterparty_type, cp.rating_value,
             v.business_date, v.quantity_eod, v.market_value_amount, v.book_value_amount, v.unrealized_pnl_amount,
             v.modified_duration_years, v.macaulay_duration_years, v.ytm_pct, v.stress_haircut_pct, v.clean_price_pct, v.dirty_price_pct
           FROM alm_v3_positions p
           JOIN alm_v3_instruments i ON i.id = p.instrument_id
           JOIN alm_v3_asset_classes ac ON ac.id = i.asset_class_id
           JOIN alm_v3_position_valuations_daily v ON v.position_id = p.id
           LEFT JOIN alm_v3_strata st ON st.id = p.strata_id
           LEFT JOIN alm_v3_counterparties cp ON cp.id = i.issuer_counterparty_id
           WHERE ${whereFinance}
           ORDER BY p.id ASC`,
          financeParams
        ).catch(() => [])
      : [];

    const financeAgg = financePositions.reduce(
      (acc, r) => {
        const mv = Number(r.market_value_amount || 0);
        const dur = Number(r.modified_duration_years || 0);
        acc.positions_count += 1;
        acc.market_value_total += mv;
        acc.book_value_total += Number(r.book_value_amount || 0);
        acc.pnl_total += Number(r.unrealized_pnl_amount || 0);
        acc.duration_num += mv * dur;
        acc.asset_codes.add(String(r.asset_code || ""));
        acc.counterparties.add(String(r.counterparty_name || "—"));
        return acc;
      },
      { positions_count: 0, market_value_total: 0, book_value_total: 0, pnl_total: 0, duration_num: 0, asset_codes: new Set(), counterparties: new Set() }
    );
    const financeKpis = {
      positions_count: financeAgg.positions_count,
      market_value_total: Number(financeAgg.market_value_total.toFixed(2)),
      book_value_total: Number(financeAgg.book_value_total.toFixed(2)),
      unrealized_pnl_total: Number(financeAgg.pnl_total.toFixed(2)),
      weighted_modified_duration_years: financeAgg.market_value_total > 0 ? Number((financeAgg.duration_num / financeAgg.market_value_total).toFixed(6)) : 0,
      asset_classes_count: financeAgg.asset_codes.size,
      counterparties_count: financeAgg.counterparties.size,
    };

    const [financeAssetClassOptions, financeStrataOptions, financeCounterpartyOptions] = await Promise.all([
      qa(`SELECT asset_code, label FROM alm_v3_asset_classes WHERE profile_id = ? AND active = 1 ORDER BY display_order, asset_code`, [almV3Profile.id]).catch(() => []),
      qa(`SELECT strata_code, label FROM alm_v3_strata WHERE profile_id = ? AND active = 1 ORDER BY display_order, strata_code`, [almV3Profile.id]).catch(() => []),
      qa(
        `SELECT DISTINCT cp.id, cp.name, cp.counterparty_type
         FROM alm_v3_positions p
         JOIN alm_v3_instruments i ON i.id = p.instrument_id
         LEFT JOIN alm_v3_counterparties cp ON cp.id = i.issuer_counterparty_id
         WHERE p.profile_id = ? AND cp.id IS NOT NULL
         ORDER BY cp.name`,
        [almV3Profile.id]
      ).catch(() => []),
    ]);

    const financePositionIds = financePositions.map((r) => Number(r.position_id)).filter((x) => Number.isFinite(x));
    let financePositionsHistorySeries = [];
    if (financePositionIds.length) {
      const placeholders = financePositionIds.map(() => "?").join(",");
      const historyRows = await qa(
        `SELECT
           v.business_date,
           p.id AS position_id,
           i.instrument_code,
           i.instrument_name,
           v.market_value_amount
         FROM alm_v3_position_valuations_daily v
         JOIN alm_v3_positions p ON p.id = v.position_id
         JOIN alm_v3_instruments i ON i.id = p.instrument_id
         WHERE v.profile_id = ?
           AND v.position_id IN (${placeholders})
         ORDER BY v.business_date ASC, p.id ASC`,
        [almV3Profile.id, ...financePositionIds]
      ).catch(() => []);
      financePositionsHistorySeries = historyRows.map((r) => ({
        date: toIsoDate(r.business_date),
        position_id: Number(r.position_id),
        instrument_code: r.instrument_code,
        instrument_name: r.instrument_name,
        market_value_amount: Number(r.market_value_amount || 0),
      }));
    }

    let financeSelectedPosition = financePositionId || (financePositions[0] ? Number(financePositions[0].position_id) : null);
    if (financeSelectedPosition && !financePositions.some((r) => Number(r.position_id) === Number(financeSelectedPosition))) {
      financeSelectedPosition = financePositions[0] ? Number(financePositions[0].position_id) : null;
    }
    let financePositionDetail = null;
    if (financeSelectedPosition) {
      const [detailRow, lots, history] = await Promise.all([
        q1(
          `SELECT
             p.id AS position_id, p.portfolio_code, p.position_status, p.opened_on, p.closed_on, p.accounting_classification, p.notes,
             st.strata_code, st.label AS strata_label,
             i.instrument_code, i.instrument_name, i.instrument_type, i.currency, i.isin, i.ticker, i.issue_date, i.maturity_date, i.coupon_rate_pct, i.coupon_frequency,
             ac.asset_code, ac.label AS asset_label,
             cp.name AS counterparty_name, cp.counterparty_type, cp.rating_value
           FROM alm_v3_positions p
           JOIN alm_v3_instruments i ON i.id = p.instrument_id
           JOIN alm_v3_asset_classes ac ON ac.id = i.asset_class_id
           LEFT JOIN alm_v3_strata st ON st.id = p.strata_id
           LEFT JOIN alm_v3_counterparties cp ON cp.id = i.issuer_counterparty_id
           WHERE p.id = ? AND p.profile_id = ?`,
          [financeSelectedPosition, almV3Profile.id]
        ).catch(() => null),
        qa(`SELECT * FROM alm_v3_position_lots WHERE position_id = ? ORDER BY trade_date, id`, [financeSelectedPosition]).catch(() => []),
        qa(
          `SELECT business_date, market_value_amount, book_value_amount, unrealized_pnl_amount, modified_duration_years, ytm_pct, clean_price_pct, dirty_price_pct
           FROM alm_v3_position_valuations_daily
           WHERE position_id = ?
           ORDER BY business_date DESC
           LIMIT 370`,
          [financeSelectedPosition]
        ).catch(() => []),
      ]);
      financePositionDetail = {
        position: detailRow,
        lots,
        history: history.slice().reverse(),
      };
    }

    almV3Finance = {
      selected_date: selectedFinanceDate,
      selected_position_id: financeSelectedPosition,
      filters: {
        asset_code: financeAssetCode || "",
        strata_code: financeStrataCode || "",
        counterparty_id: financeCounterpartyId || "",
      },
      dates: financeDates.map((r) => toIsoDate(r.business_date)).filter(Boolean),
      options: {
        asset_classes: financeAssetClassOptions,
        strata: financeStrataOptions,
        counterparties: financeCounterpartyOptions,
      },
      kpis: financeKpis,
      positions: financePositions,
      positions_history_series: financePositionsHistorySeries,
      position_detail: financePositionDetail,
    };
  }

  return {
    ok: true,
    orsa_sets: orsaSets,
    selected_set: selectedSet,
    selected_run_id: effectiveRunId,
    selected_run_ids: setRunIds,
    config,
    duration_buckets: durations,
    asset_allocations: assets,
    branch_assumptions: branchAssumptions,
    result: result ? { ...result, comments_json: parseJsonMaybe(result.comments_json) } : null,
    result_asset_classes: resultAssetClasses,
    result_duration_buckets: resultBuckets,
    alm_v3_profile: almV3Profile,
    alm_v3_alert_thresholds: almV3Profile
      ? {
          liq_alert_tension_threshold_eur: Number(almV3Profile.liq_alert_tension_threshold_eur ?? 0),
          liq_alert_vigilance_threshold_eur: Number(almV3Profile.liq_alert_vigilance_threshold_eur ?? 500000),
          duration_alert_vigilance_abs_years: Number(almV3Profile.duration_alert_vigilance_abs_years ?? 3),
          duration_alert_tension_abs_years: Number(almV3Profile.duration_alert_tension_abs_years ?? 5),
        }
      : null,
    alm_v3_runs: almV3Runs.map((r) => ({ ...r, scenario_json: parseJsonMaybe(r.scenario_json) })),
    alm_v3_run_summaries: almV3RunSummaries,
    alm_v3_stress_comparison: almV3StressComparison,
    alm_v3_time_series: almV3TimeSeries,
    alm_v3_stress_configs: almV3StressConfigs.map((r) => ({ ...r, comments_json: parseJsonMaybe(r.comments_json) })),
    alm_v3_stress_asset_shocks: almV3StressAssetShocks,
    alm_v3_drilldown: almV3Drilldown,
    alm_v3_finance: almV3Finance,
  };
}

router.get("/simulation", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const captiveId = Number(req.user?.captive_id);
    const requestedOrsaSetId = req.query.orsa_set_id ? Number(req.query.orsa_set_id) : null;

    const orsaSets = await qa(
      `SELECT
         ors.id,
         ors.code,
         ors.name,
         ors.base_run_id,
         ors.snapshot_date,
         ors.status,
         ors.created_at,
         ss.id AS scenario_id,
         ss.code AS scenario_code,
         ss.name AS scenario_name,
         ss.target_year
       FROM orsa_run_sets ors
       JOIN simulation_scenarios ss ON ss.id = ors.scenario_id
       WHERE ss.captive_id = ?
       ORDER BY ors.created_at DESC, ors.id DESC`,
      [captiveId]
    );

    let selectedSet = null;
    if (requestedOrsaSetId) {
      selectedSet = orsaSets.find((s) => Number(s.id) === requestedOrsaSetId) || null;
    }
    if (!selectedSet) selectedSet = orsaSets[0] || null;

    const scenarios = await qa(
      `SELECT id, code, name, status, target_year, created_at, updated_at
       FROM simulation_scenarios
       WHERE captive_id = ?
       ORDER BY target_year DESC, id DESC`,
      [captiveId]
    );

    const recentRuns = await qa(
      `SELECT sr.id, sr.scenario_id, sr.run_label, sr.status, sr.engine_version, sr.created_at, sr.started_at, sr.ended_at, ss.code AS scenario_code
       FROM simulation_runs sr
       JOIN simulation_scenarios ss ON ss.id = sr.scenario_id
       WHERE ss.captive_id = ?
       ORDER BY sr.id DESC
       LIMIT 20`,
      [captiveId]
    );
    const recentRunIds = recentRuns.map((r) => Number(r.id)).filter(Number.isFinite);
    const recentRunPlaceholders = recentRunIds.length ? recentRunIds.map(() => "?").join(",") : "NULL";
    const recentRunEngineDetails = recentRunIds.length
      ? await qa(
          `SELECT red.run_id, red.engine_catalog_id, red.engine_family, red.engine_code, red.engine_version, red.engine_title,
                  red.engine_config_json, red.modules_json, red.data_dependencies_json, red.warnings_json, red.execution_stats_json, red.notes,
                  sec.title AS catalog_title, sec.description AS catalog_description, sec.methodology_scope, sec.limitations, sec.script_name, sec.repo_path, sec.status AS catalog_status,
                  sec.modules_json AS catalog_modules_json, sec.parameters_schema_json, sec.metadata_json
           FROM simulation_run_engine_details red
           LEFT JOIN simulation_engine_catalog sec ON sec.id = red.engine_catalog_id
           WHERE red.run_id IN (${recentRunPlaceholders})
           ORDER BY red.run_id DESC`,
          recentRunIds
        ).catch(() => [])
      : [];
    const engineCatalog = await qa(
      `SELECT id, engine_family, engine_code, engine_version, title, description, methodology_scope, limitations, script_name, repo_path, status,
              modules_json, parameters_schema_json, metadata_json, created_at, updated_at
       FROM simulation_engine_catalog
       ORDER BY engine_family ASC, engine_code ASC, engine_version ASC`
    ).catch(() => []);

    const stressParams = await qa(
      `SELECT sp.scenario_id, sp.parameter_key, sp.value_json, sp.updated_at
       FROM simulation_parameters sp
       JOIN simulation_scenarios ss ON ss.id = sp.scenario_id
       WHERE ss.captive_id = ?
         AND sp.parameter_group = 's2'
         AND sp.parameter_key LIKE 'orsa_stress_%'
       ORDER BY sp.scenario_id DESC, sp.parameter_key ASC`,
      [captiveId]
    );

    const payload = {
      ok: true,
      scenarios,
      recent_runs: recentRuns,
      engine_catalog: engineCatalog.map((r) => ({
        ...r,
        modules_json: parseJsonMaybe(r.modules_json),
        parameters_schema_json: parseJsonMaybe(r.parameters_schema_json),
        metadata_json: parseJsonMaybe(r.metadata_json),
      })),
      recent_run_engine_details: recentRunEngineDetails.map((r) => ({
        ...r,
        engine_config_json: parseJsonMaybe(r.engine_config_json),
        modules_json: parseJsonMaybe(r.modules_json),
        data_dependencies_json: parseJsonMaybe(r.data_dependencies_json),
        warnings_json: parseJsonMaybe(r.warnings_json),
        execution_stats_json: parseJsonMaybe(r.execution_stats_json),
        catalog_modules_json: parseJsonMaybe(r.catalog_modules_json),
        parameters_schema_json: parseJsonMaybe(r.parameters_schema_json),
        metadata_json: parseJsonMaybe(r.metadata_json),
      })),
      orsa_sets: orsaSets,
      stress_parameters: stressParams.map((r) => ({ ...r, value_json: parseJsonMaybe(r.value_json) })),
      selected: null,
    };

    if (!selectedSet) return res.json(payload);

    const members = await qa(
      `SELECT osm.id, osm.run_id, osm.stress_code, osm.display_order, osm.assumption_json,
              sr.run_label, sr.status AS run_status, sr.engine_version
       FROM orsa_run_set_members osm
       JOIN simulation_runs sr ON sr.id = osm.run_id
       WHERE osm.orsa_set_id = ?
       ORDER BY osm.display_order ASC, osm.id ASC`,
      [selectedSet.id]
    );
    const selectedRunIds = [...new Set(members.map((m) => Number(m.run_id)).filter(Number.isFinite))];
    const selectedRunPlaceholders = selectedRunIds.length ? selectedRunIds.map(() => "?").join(",") : "NULL";
    const selectedRunEngineDetails = selectedRunIds.length
      ? await qa(
          `SELECT red.run_id, red.engine_catalog_id, red.engine_family, red.engine_code, red.engine_version, red.engine_title,
                  red.engine_config_json, red.modules_json, red.data_dependencies_json, red.warnings_json, red.execution_stats_json, red.notes,
                  sec.title AS catalog_title, sec.description AS catalog_description, sec.methodology_scope, sec.limitations, sec.script_name, sec.repo_path, sec.status AS catalog_status,
                  sec.modules_json AS catalog_modules_json, sec.parameters_schema_json, sec.metadata_json
           FROM simulation_run_engine_details red
           LEFT JOIN simulation_engine_catalog sec ON sec.id = red.engine_catalog_id
           WHERE red.run_id IN (${selectedRunPlaceholders})
           ORDER BY red.run_id DESC`,
          selectedRunIds
        ).catch(() => [])
      : [];

    const comparison = await qa(
      `SELECT *
       FROM orsa_run_comparison_snapshots
       WHERE orsa_set_id = ?
       ORDER BY FIELD(stress_code,'BASE','ADVERSE','SEVERE'), stress_code`,
      [selectedSet.id]
    );

    const runIds = [...new Set(members.map((m) => Number(m.run_id)).filter(Number.isFinite))];
    const snapshotDate = selectedSet.snapshot_date;
    const placeholders = runIds.length ? runIds.map(() => "?").join(",") : "NULL";

    const branchSnapshots = runIds.length
      ? await qa(
          `SELECT pbs.run_id, pbs.snapshot_date, ib.s2_code, ib.name AS branch_label,
                  pbs.contracts_count, pbs.clients_count, pbs.gwp_gross, pbs.gwp_net,
                  pbs.paid_gross, pbs.paid_net, pbs.incurred_gross, pbs.incurred_net, pbs.cat_loss_gross
           FROM portfolio_branch_snapshots pbs
           JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
           WHERE pbs.run_id IN (${placeholders}) AND pbs.snapshot_date = ?
           ORDER BY pbs.run_id, pbs.gwp_gross DESC`,
          [...runIds, snapshotDate]
        )
      : [];

    const s2Results = runIds.length
      ? await qa(
          `SELECT run_id, snapshot_date, scr_non_life, scr_counterparty, scr_market, scr_operational, scr_total, mcr, own_funds_eligible, solvency_ratio_pct, methodology_version
           FROM s2_scr_results
           WHERE run_id IN (${placeholders}) AND snapshot_date = ?
           ORDER BY run_id`,
          [...runIds, snapshotDate]
        )
      : [];

    const s2InputsByRun = runIds.length
      ? await qa(
          `SELECT s2.run_id, ib.s2_code, ib.name AS branch_label, s2.premium_volume, s2.reserve_volume, s2.cat_exposure, s2.counterparty_exposure, s2.sigma_premium, s2.sigma_reserve, s2.corr_group_code
           FROM s2_scr_inputs_non_life s2
           JOIN insurance_branch ib ON ib.id_branch = s2.id_branch
           WHERE s2.run_id IN (${placeholders}) AND s2.snapshot_date = ?
           ORDER BY s2.run_id, ib.s2_code`,
          [...runIds, snapshotDate]
        ).catch(() => [])
      : [];
    const baseS2Inputs = s2InputsByRun.filter((r) => Number(r.run_id) === Number(selectedSet.base_run_id));

    const frontingPrograms = await qa(
      `SELECT fp.*, ib.s2_code, ib.name AS branch_label,
              ip.name AS primary_insurer_name, isec.name AS secondary_insurer_name
       FROM fronting_programs fp
       JOIN insurance_branch ib ON ib.id_branch = fp.id_branch
       JOIN insurers ip ON ip.id = fp.primary_fronting_insurer_id
       LEFT JOIN insurers isec ON isec.id = fp.secondary_fronting_insurer_id
       WHERE fp.run_id IN (${placeholders})
       ORDER BY fp.run_id, fp.id_branch`,
      runIds
    ).catch(() => []);

    const frontingCounterparties = await qa(
      `SELECT fpc.fronting_program_id, fpc.insurer_id, fpc.role_code, fpc.share_pct, fpc.fee_share_pct, i.name AS insurer_name
       FROM fronting_program_counterparties fpc
       JOIN insurers i ON i.id = fpc.insurer_id
       JOIN fronting_programs fp ON fp.id = fpc.fronting_program_id
       WHERE fp.run_id IN (${placeholders})
       ORDER BY fp.run_id, fpc.role_code`,
      runIds
    ).catch(() => []);

    const frontingAdjustments = await qa(
      `SELECT fra.*, ib.s2_code, ib.name AS branch_label
       FROM fronting_run_adjustments fra
       JOIN insurance_branch ib ON ib.id_branch = fra.id_branch
       WHERE fra.run_id IN (${placeholders}) AND fra.snapshot_date = ?
       ORDER BY fra.run_id, fra.id_branch`,
      [...runIds, snapshotDate]
    ).catch(() => []);

    const frontingAllocations = await qa(
      `SELECT fca.*, i.name AS insurer_name
       FROM fronting_run_counterparty_allocations fca
       JOIN insurers i ON i.id = fca.insurer_id
       WHERE fca.run_id IN (${placeholders}) AND fca.snapshot_date = ?
       ORDER BY fca.run_id, fca.role_code`,
      [...runIds, snapshotDate]
    ).catch(() => []);

    const catConcentrationByRun = runIds.length
      ? await qa(
          `SELECT ccs.*, gz.region_name, gz.zone_type
           FROM cat_concentration_snapshots ccs
           LEFT JOIN geo_zones gz ON gz.code = ccs.geo_code
           WHERE ccs.run_id IN (${placeholders}) AND ccs.snapshot_date = ?
           ORDER BY ccs.run_id, ccs.property_gwp_gross DESC`,
          [...runIds, snapshotDate]
        ).catch(() => [])
      : [];
    const catConcentration = catConcentrationByRun.filter((r) => Number(r.run_id) === Number(selectedSet.base_run_id));

    const runChecks = await qa(
      `SELECT src.run_id, src.check_code, src.severity, src.status, src.metric_value, src.message, src.created_at
       FROM simulation_run_checks src
       WHERE src.run_id IN (${placeholders})
       ORDER BY src.id DESC
       LIMIT 200`,
      runIds
    ).catch(() => []);

    const comparisonByStress = Object.fromEntries(comparison.map((r) => [r.stress_code, r]));
    const base = comparisonByStress.BASE || comparison[0] || null;

    const frontingSummaryByRun = Object.values(
      frontingAdjustments.reduce((acc, row) => {
        const k = Number(row.run_id);
        if (!acc[k]) {
          acc[k] = {
            run_id: k,
            fronting_fee_total: 0,
            claims_handling_fee_total: 0,
            fronting_total_cost: 0,
            premium_net_to_captive_total: 0,
            counterparty_exposure_est_total: 0,
          };
        }
        acc[k].fronting_fee_total += Number(row.fronting_fee_amount || 0);
        acc[k].claims_handling_fee_total += Number(row.claims_handling_fee_amount || 0);
        acc[k].fronting_total_cost += Number(row.fronting_fee_amount || 0) + Number(row.claims_handling_fee_amount || 0);
        acc[k].premium_net_to_captive_total += Number(row.premium_net_to_captive_after_fees || 0);
        acc[k].counterparty_exposure_est_total += Number(row.estimated_counterparty_exposure || 0);
        return acc;
      }, {})
    );

    payload.selected = {
      set: selectedSet,
      members: members.map((m) => ({ ...m, assumption_json: parseJsonMaybe(m.assumption_json) })),
      comparison,
      summary: {
        base_run_id: selectedSet.base_run_id,
        snapshot_date: snapshotDate,
        base,
        deltas_vs_base: comparison.map((r) => ({
          stress_code: r.stress_code,
          run_id: r.run_id,
          delta_scr_total: base ? Number(r.scr_total || 0) - Number(base.scr_total || 0) : null,
          delta_solvency_ratio_pct: base ? Number(r.solvency_ratio_pct || 0) - Number(base.solvency_ratio_pct || 0) : null,
          delta_property_cat_exposure_s2: base ? Number(r.property_cat_exposure_s2 || 0) - Number(base.property_cat_exposure_s2 || 0) : null,
        })),
      },
      branch_snapshots: branchSnapshots,
      s2_results: s2Results,
      s2_inputs_by_run: s2InputsByRun,
      s2_inputs_base_run: baseS2Inputs,
      fronting_programs: frontingPrograms,
      fronting_counterparties: frontingCounterparties,
      fronting_adjustments: frontingAdjustments.map((r) => ({ ...r, assumption_json: parseJsonMaybe(r.assumption_json) })),
      fronting_allocations: frontingAllocations,
      fronting_summary_by_run: frontingSummaryByRun,
      cat_concentration_by_run: catConcentrationByRun,
      cat_concentration_base_run: catConcentration,
      run_checks: runChecks,
      run_engine_details: selectedRunEngineDetails.map((r) => ({
        ...r,
        engine_config_json: parseJsonMaybe(r.engine_config_json),
        modules_json: parseJsonMaybe(r.modules_json),
        data_dependencies_json: parseJsonMaybe(r.data_dependencies_json),
        warnings_json: parseJsonMaybe(r.warnings_json),
        execution_stats_json: parseJsonMaybe(r.execution_stats_json),
        catalog_modules_json: parseJsonMaybe(r.catalog_modules_json),
        parameters_schema_json: parseJsonMaybe(r.parameters_schema_json),
        metadata_json: parseJsonMaybe(r.metadata_json),
      })),
    };

    return res.json(payload);
  } catch (err) {
    console.error("GET /api/actuariat/simulation failed", err);
    return res.status(500).json({ error: "actuariat_simulation_fetch_failed" });
  }
});

router.put("/engine-catalog/:id", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "engine_catalog_id_invalid" });
    const existing = await q1(`SELECT id FROM simulation_engine_catalog WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: "engine_catalog_not_found" });

    const status = ["active", "deprecated"].includes(String(req.body?.status)) ? String(req.body.status) : "active";
    const title = String(req.body?.title || "").trim().slice(0, 190);
    const description = req.body?.description == null ? null : String(req.body.description);
    const methodologyScope = req.body?.methodology_scope == null ? null : String(req.body.methodology_scope);
    const limitations = req.body?.limitations == null ? null : String(req.body.limitations);
    const scriptName = req.body?.script_name == null ? null : String(req.body.script_name);
    const repoPath = req.body?.repo_path == null ? null : String(req.body.repo_path);
    const modules = Array.isArray(req.body?.modules_json) ? req.body.modules_json.map((x) => String(x)) : null;
    const metadata = req.body?.metadata_json && typeof req.body.metadata_json === "object" ? req.body.metadata_json : null;
    const paramsSchema = req.body?.parameters_schema_json && typeof req.body.parameters_schema_json === "object" ? req.body.parameters_schema_json : null;

    await pool.query(
      `UPDATE simulation_engine_catalog
       SET title = COALESCE(NULLIF(?, ''), title),
           description = ?,
           methodology_scope = ?,
           limitations = ?,
           script_name = ?,
           repo_path = ?,
           status = ?,
           modules_json = ?,
           metadata_json = ?,
           parameters_schema_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        title,
        description,
        methodologyScope,
        limitations,
        scriptName,
        repoPath,
        status,
        modules ? JSON.stringify(modules) : null,
        metadata ? JSON.stringify(metadata) : null,
        paramsSchema ? JSON.stringify(paramsSchema) : null,
        id,
      ]
    );

    const row = await q1(
      `SELECT id, engine_family, engine_code, engine_version, title, description, methodology_scope, limitations, script_name, repo_path, status,
              modules_json, parameters_schema_json, metadata_json, created_at, updated_at
       FROM simulation_engine_catalog WHERE id = ?`,
      [id]
    );
    return res.json({
      ok: true,
      engine_catalog: {
        ...row,
        modules_json: parseJsonMaybe(row.modules_json),
        parameters_schema_json: parseJsonMaybe(row.parameters_schema_json),
        metadata_json: parseJsonMaybe(row.metadata_json),
      },
    });
  } catch (err) {
    console.error("PUT /api/actuariat/engine-catalog/:id failed", err);
    return res.status(500).json({ error: "actuariat_engine_catalog_update_failed" });
  }
});

router.get("/engine-script", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const scriptNameRaw = String(req.query.script_name || "").trim();
    if (!scriptNameRaw) return res.status(400).json({ error: "engine_script_name_missing" });
    if (scriptNameRaw.includes("..") || path.isAbsolute(scriptNameRaw)) {
      return res.status(400).json({ error: "engine_script_path_invalid" });
    }
    const allowedPrefixes = ["src/", "ops/"];
    if (!allowedPrefixes.some((p) => scriptNameRaw.startsWith(p))) {
      return res.status(403).json({ error: "engine_script_path_forbidden" });
    }

    const repoRoot = process.cwd();
    const resolved = path.resolve(repoRoot, scriptNameRaw);
    const rel = path.relative(repoRoot, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return res.status(403).json({ error: "engine_script_path_outside_repo" });
    }

    const st = await fs.stat(resolved).catch(() => null);
    if (!st || !st.isFile()) return res.status(404).json({ error: "engine_script_not_found" });
    if (st.size > 512 * 1024) return res.status(413).json({ error: "engine_script_too_large" });

    const content = await fs.readFile(resolved, "utf8");
    return res.json({
      ok: true,
      script_name: scriptNameRaw,
      repo_path: repoRoot,
      size_bytes: st.size,
      content,
    });
  } catch (err) {
    console.error("GET /api/actuariat/engine-script failed", err);
    return res.status(500).json({ error: "actuariat_engine_script_fetch_failed" });
  }
});

router.put("/engine-script", authRequired, requireRole(...canEditEngineFiles), async (req, res) => {
  try {
    const scriptName = String(req.body?.script_name || "").trim().replace(/\\/g, "/");
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!scriptName) return res.status(400).json({ error: "script_name_required" });
    if (!(scriptName.startsWith("src/") || scriptName.startsWith("ops/"))) {
      return res.status(400).json({ error: "script_path_not_allowed" });
    }
    if (scriptName.includes("..")) return res.status(400).json({ error: "script_path_invalid" });
    const rootDir = path.resolve(process.cwd());
    const fullPath = path.resolve(rootDir, scriptName);
    if (!fullPath.startsWith(rootDir + path.sep)) {
      return res.status(400).json({ error: "script_path_escape_blocked" });
    }
    await fs.access(fullPath);
    await fs.writeFile(fullPath, content, "utf8");
    const stat = await fs.stat(fullPath);
    res.json({
      ok: true,
      script_name: scriptName,
      bytes_written: Buffer.byteLength(content, "utf8"),
      mtime: stat.mtime.toISOString(),
    });
  } catch (err) {
    console.error("PUT /api/actuariat/engine-script failed", err);
    res.status(500).json({ error: "engine_script_write_failed" });
  }
});

router.get("/alm-proxy", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const captiveId = Number(req.user?.captive_id);
    const requestedOrsaSetId = req.query.orsa_set_id ? Number(req.query.orsa_set_id) : null;
    const payload = await getAlmProxyPayload(captiveId, requestedOrsaSetId, {
      alm_v3_run_id: req.query.alm_v3_run_id,
      alm_v3_date: req.query.alm_v3_date,
      finance_business_date: req.query.finance_business_date,
      finance_asset_code: req.query.finance_asset_code,
      finance_strata_code: req.query.finance_strata_code,
      finance_counterparty_id: req.query.finance_counterparty_id,
      finance_position_id: req.query.finance_position_id,
      run_id: req.query.run_id,
    });
    return res.json(payload);
  } catch (err) {
    console.error("GET /api/actuariat/alm-proxy failed", err);
    return res.status(500).json({ error: "actuariat_alm_proxy_fetch_failed" });
  }
});

router.put("/alm-proxy/stress-config", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const captiveId = Number(req.user?.captive_id);
    const requestedOrsaSetId = req.body?.orsa_set_id ? Number(req.body.orsa_set_id) : null;
    const payload = await getAlmProxyPayload(captiveId, requestedOrsaSetId);
    const profile = payload?.alm_v3_profile;
    if (!profile?.id) return res.status(400).json({ error: "alm_v3_profile_missing" });
    await ensureAlmV3StressDefaults(Number(profile.id));
    await ensureAlmV3AlertThresholdDefaults(Number(profile.id));

    const scenarios = Array.isArray(req.body?.stress_configs) ? req.body.stress_configs : [];
    const shocks = Array.isArray(req.body?.asset_shocks) ? req.body.asset_shocks : [];
    const [existingScenarios] = await pool.query(`SELECT id FROM alm_v3_stress_scenarios WHERE profile_id = ?`, [Number(profile.id)]);
    const validScenarioIds = new Set(existingScenarios.map((r) => Number(r.id)));

    for (const row of scenarios) {
      if (!row?.id || !validScenarioIds.has(Number(row.id))) continue;
      await pool.query(
        `UPDATE alm_v3_stress_scenarios
         SET inflow_mult = ?, outflow_mult = ?,
             liquidity_source_mult_d1 = ?, liquidity_source_mult_d7 = ?, liquidity_source_mult_d30 = ?,
             liquidity_use_mult_d1 = ?, liquidity_use_mult_d7 = ?, liquidity_use_mult_d30 = ?,
             cash_floor_pct_assets = ?, allow_negative_cash = ?, allow_negative_liquidity_buffer = ?,
             duration_asset_shift_years = ?, duration_liability_mult = ?, own_funds_mult = ?, s2_mult = ?, cat_mult = ?,
             comments_json = ?
         WHERE id = ? AND profile_id = ?`,
        [
          clampNum(row.inflow_mult, 0, 5),
          clampNum(row.outflow_mult, 0, 8),
          clampNum(row.liquidity_source_mult_d1, 0, 3),
          clampNum(row.liquidity_source_mult_d7, 0, 3),
          clampNum(row.liquidity_source_mult_d30, 0, 3),
          clampNum(row.liquidity_use_mult_d1, 0, 8),
          clampNum(row.liquidity_use_mult_d7, 0, 8),
          clampNum(row.liquidity_use_mult_d30, 0, 8),
          row.cash_floor_pct_assets == null || row.cash_floor_pct_assets === "" ? null : clampNum(row.cash_floor_pct_assets, -2, 2),
          row.allow_negative_cash ? 1 : 0,
          row.allow_negative_liquidity_buffer ? 1 : 0,
          clampNum(row.duration_asset_shift_years, -5, 10),
          clampNum(row.duration_liability_mult, 0, 5),
          clampNum(row.own_funds_mult, 0, 5),
          clampNum(row.s2_mult, 0, 5),
          clampNum(row.cat_mult, 0, 10),
          row.comments_json ? JSON.stringify(row.comments_json) : null,
          Number(row.id),
          Number(profile.id),
        ]
      );
    }

    for (const row of shocks) {
      if (!row?.id) continue;
      await pool.query(
        `UPDATE alm_v3_stress_asset_class_shocks
         SET mv_mult = ?, duration_shift_years = ?,
             liquidity_source_mult_d1 = ?, liquidity_source_mult_d7 = ?, liquidity_source_mult_d30 = ?,
             active = ?
         WHERE id = ?`,
        [
          clampNum(row.mv_mult, 0, 3),
          clampNum(row.duration_shift_years, -5, 10),
          row.liquidity_source_mult_d1 == null || row.liquidity_source_mult_d1 === "" ? null : clampNum(row.liquidity_source_mult_d1, 0, 3),
          row.liquidity_source_mult_d7 == null || row.liquidity_source_mult_d7 === "" ? null : clampNum(row.liquidity_source_mult_d7, 0, 3),
          row.liquidity_source_mult_d30 == null || row.liquidity_source_mult_d30 === "" ? null : clampNum(row.liquidity_source_mult_d30, 0, 3),
          row.active === false ? 0 : 1,
          Number(row.id),
        ]
      );
    }

    if (req.body?.alert_thresholds && profile?.id) {
      const t = req.body.alert_thresholds || {};
      await pool.query(
        `UPDATE alm_v3_profiles
         SET liq_alert_tension_threshold_eur = ?,
             liq_alert_vigilance_threshold_eur = ?,
             duration_alert_vigilance_abs_years = ?,
             duration_alert_tension_abs_years = ?
         WHERE id = ?`,
        [
          clampNum(t.liq_alert_tension_threshold_eur ?? 0, -1_000_000_000, 1_000_000_000),
          clampNum(t.liq_alert_vigilance_threshold_eur ?? 500000, -1_000_000_000, 1_000_000_000),
          clampNum(t.duration_alert_vigilance_abs_years ?? 3, 0, 100),
          clampNum(t.duration_alert_tension_abs_years ?? 5, 0, 100),
          Number(profile.id),
        ]
      ).catch(() => null);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/actuariat/alm-proxy/stress-config failed", err);
    return res.status(500).json({ error: "actuariat_alm_proxy_stress_update_failed" });
  }
});

router.put("/alm-proxy/config", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const captiveId = Number(req.user?.captive_id);
    const requestedOrsaSetId = req.body?.orsa_set_id ? Number(req.body.orsa_set_id) : null;
    const selectedSetPayload = await getAlmProxyPayload(captiveId, requestedOrsaSetId);
    if (!selectedSetPayload.selected_set || !selectedSetPayload.config) {
      return res.status(400).json({ error: "alm_no_orsa_set_available" });
    }
    const configId = Number(selectedSetPayload.config.id);

    const assetAllocations = Array.isArray(req.body?.asset_allocations) ? req.body.asset_allocations : [];
    const branchAssumptions = Array.isArray(req.body?.branch_assumptions) ? req.body.branch_assumptions : [];

    const durationBuckets = await qa(`SELECT id, bucket_code FROM alm_v2_duration_buckets WHERE config_id = ?`, [configId]);
    const bucketIdByCode = Object.fromEntries(durationBuckets.map((b) => [String(b.bucket_code), Number(b.id)]));

    for (const row of assetAllocations) {
      if (!row?.allocation_id) continue;
      const bucketId =
        row.bucket_code == null || row.bucket_code === ""
          ? null
          : Number.isFinite(Number(row.duration_bucket_id))
          ? Number(row.duration_bucket_id)
          : bucketIdByCode[String(row.bucket_code)] || null;
      await pool.query(
        `UPDATE alm_v2_allocation_lines
         SET target_weight_pct = ?,
             duration_years_override = ?,
             liquidity_horizon_days_override = ?,
             duration_bucket_id = ?,
             comment_text = ?
         WHERE id = ? AND config_id = ?`,
        [
          Number(row.target_weight_pct || 0),
          row.duration_years_override == null || row.duration_years_override === "" ? null : Number(row.duration_years_override),
          row.liquidity_horizon_days_override == null || row.liquidity_horizon_days_override === "" ? null : Number(row.liquidity_horizon_days_override),
          bucketId,
          row.comment_text || null,
          Number(row.allocation_id),
          configId,
        ]
      );
    }

    for (const row of branchAssumptions) {
      if (!row?.id) continue;
      await pool.query(
        `UPDATE alm_v2_branch_assumptions
         SET holding_years_base = ?,
             holding_years_stress = ?,
             capital_lock_factor = ?,
             liquidity_need_pct = ?,
             weighting_mode = ?,
             notes = ?
         WHERE id = ? AND config_id = ?`,
        [
          Number(row.holding_years_base || 0),
          Number(row.holding_years_stress || 0),
          Number(row.capital_lock_factor || 1),
          Number(row.liquidity_need_pct || 0),
          row.weighting_mode || "incurred_reserve",
          row.notes || null,
          Number(row.id),
          configId,
        ]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/actuariat/alm-proxy/config failed", err);
    return res.status(500).json({ error: "actuariat_alm_proxy_update_failed" });
  }
});

router.post("/alm-proxy/recompute", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const captiveId = Number(req.user?.captive_id);
    const requestedOrsaSetId = req.body?.orsa_set_id ? Number(req.body.orsa_set_id) : null;
    const payload = await getAlmProxyPayload(captiveId, requestedOrsaSetId, { run_id: req.body?.run_id });
    if (!payload.selected_set || !payload.config) {
      return res.status(400).json({ error: "alm_no_orsa_set_available" });
    }
    await computeAndStoreAlmProxy({
      configId: Number(payload.config.id),
      selectedSet: payload.selected_set,
      referenceRunId: payload.selected_run_id,
    });
    const refreshed = await getAlmProxyPayload(captiveId, requestedOrsaSetId || payload.selected_set.id, { run_id: payload.selected_run_id });
    return res.json(refreshed);
  } catch (err) {
    console.error("POST /api/actuariat/alm-proxy/recompute failed", err);
    return res.status(500).json({ error: "actuariat_alm_proxy_recompute_failed" });
  }
});

router.post("/alm-proxy/rerun-v3-stress", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const startedAt = Date.now();
    const captiveId = Number(req.user?.captive_id);
    const requestedOrsaSetId = req.body?.orsa_set_id ? Number(req.body.orsa_set_id) : null;
    const payload = await getAlmProxyPayload(captiveId, requestedOrsaSetId, {
      alm_v3_run_id: req.body?.alm_v3_run_id,
      alm_v3_date: req.body?.alm_v3_date,
      run_id: req.body?.run_id,
    });
    const profile = payload?.alm_v3_profile;
    if (!profile?.id) return res.status(400).json({ error: "alm_v3_profile_missing" });
    const baseRunId = req.body?.base_run_id
      ? Number(req.body.base_run_id)
      : Number((payload.alm_v3_runs || []).find((r) => r.run_type === "daily_snapshot")?.id || 0);
    if (!baseRunId) return res.status(400).json({ error: "alm_v3_base_run_missing" });

    const scriptArgs = [
      "src/db/runAlmV3StressScenarios.js",
      "--profile-id",
      String(profile.id),
      "--base-run-id",
      String(baseRunId),
    ];
    if (payload.selected_set?.id) {
      scriptArgs.push("--orsa-set-id", String(payload.selected_set.id));
    }

    const { stdout, stderr } = await execFileAsync("node", scriptArgs, {
      cwd: process.cwd(),
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    let parsedStdout = null;
    try {
      parsedStdout = JSON.parse(String(stdout || "{}"));
    } catch {
      parsedStdout = null;
    }
    if (parsedStdout?.generated_stress_runs?.length) {
      const rerunIds = parsedStdout.generated_stress_runs.map((r) => Number(r.run_id)).filter(Number.isFinite);
      if (rerunIds.length) {
        const ph = rerunIds.map(() => "?").join(",");
        const runRows = await qa(
          `SELECT id, run_code, run_label, status, ended_at
           FROM alm_v3_runs
           WHERE id IN (${ph})`,
          rerunIds
        ).catch(() => []);
        const byId = Object.fromEntries(runRows.map((r) => [Number(r.id), r]));
        parsedStdout.generated_stress_runs = parsedStdout.generated_stress_runs.map((r) => ({
          ...r,
          run_code: byId[Number(r.run_id)]?.run_code || null,
          run_label: byId[Number(r.run_id)]?.run_label || null,
          run_status: byId[Number(r.run_id)]?.status || null,
          run_ended_at: byId[Number(r.run_id)]?.ended_at || null,
        }));
      }
    }
    const refreshed = await getAlmProxyPayload(captiveId, requestedOrsaSetId || payload.selected_set?.id, {
      alm_v3_run_id: req.body?.alm_v3_run_id,
      alm_v3_date: req.body?.alm_v3_date,
    });
    return res.json({
      ...refreshed,
      rerun_result: {
        ok: true,
        base_run_id: baseRunId,
        elapsed_ms: Date.now() - startedAt,
        summary: parsedStdout,
        stdout: String(stdout || "").slice(-20000),
        stderr: String(stderr || "").slice(-20000),
      },
    });
  } catch (err) {
    console.error("POST /api/actuariat/alm-proxy/rerun-v3-stress failed", err);
    return res.status(500).json({ error: "actuariat_alm_proxy_rerun_v3_stress_failed" });
  }
});

router.get("/s2-engine-config", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const scenarioId = Number(req.query.scenario_id || 0);
    if (!Number.isFinite(scenarioId) || scenarioId <= 0) return res.status(400).json({ error: "scenario_id_invalid" });
    const scenario = await q1(`SELECT id, captive_id, code FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario || Number(scenario.captive_id || 0) !== captiveId) return res.status(404).json({ error: "scenario_not_found" });

    const [paramRows] = await pool.query(
      `SELECT id, scenario_id, parameter_group, parameter_key, value_json, effective_from, updated_at
       FROM simulation_parameters
       WHERE scenario_id = ?
         AND parameter_group = 's2'
         AND parameter_key = 'engine_placeholder_config_v1'
       ORDER BY COALESCE(effective_from, '1900-01-01') DESC, updated_at DESC
       LIMIT 1`,
      [scenarioId]
    );
    const row = paramRows[0] || null;
    const config = await loadS2EnginePlaceholderConfig(scenarioId);
    return res.json({
      ok: true,
      scenario_id: scenarioId,
      scenario_code: scenario.code || null,
      source: row ? "simulation_parameters" : "defaults",
      config,
      parameter_row: row
        ? {
            id: Number(row.id || 0),
            effective_from: toIsoDate(row.effective_from),
            updated_at: row.updated_at,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /api/actuariat/s2-engine-config failed", err);
    return res.status(500).json({ error: "s2_engine_config_fetch_failed" });
  }
});

router.put("/s2-engine-config", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const scenarioId = Number(req.body?.scenario_id || 0);
    if (!Number.isFinite(scenarioId) || scenarioId <= 0) return res.status(400).json({ error: "scenario_id_invalid" });
    const scenario = await q1(`SELECT id, captive_id, code FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario || Number(scenario.captive_id || 0) !== captiveId) return res.status(404).json({ error: "scenario_not_found" });

    const fallbackCfg = await loadS2EnginePlaceholderConfig(0);
    const config = sanitizeS2EnginePlaceholderConfig(req.body?.config || {}, fallbackCfg);
    const effectiveFrom = toIsoDate(req.body?.effective_from) || toIsoDate(new Date());

    await pool.query(
      `INSERT INTO simulation_parameters (scenario_id, parameter_group, parameter_key, value_json, effective_from)
       VALUES (?, 's2', 'engine_placeholder_config_v1', ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = CURRENT_TIMESTAMP`,
      [scenarioId, JSON.stringify(config), effectiveFrom]
    );

    const [rows] = await pool.query(
      `SELECT id, effective_from, updated_at
       FROM simulation_parameters
       WHERE scenario_id = ? AND parameter_group = 's2' AND parameter_key = 'engine_placeholder_config_v1'
       ORDER BY COALESCE(effective_from, '1900-01-01') DESC, updated_at DESC
       LIMIT 1`,
      [scenarioId]
    );
    return res.json({
      ok: true,
      scenario_id: scenarioId,
      scenario_code: scenario.code || null,
      source: "simulation_parameters",
      config,
      parameter_row: rows[0]
        ? { id: Number(rows[0].id || 0), effective_from: toIsoDate(rows[0].effective_from), updated_at: rows[0].updated_at }
        : null,
    });
  } catch (err) {
    console.error("PUT /api/actuariat/s2-engine-config failed", err);
    return res.status(500).json({ error: "s2_engine_config_save_failed" });
  }
});

router.post("/s2-engine-config/rerun", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const scenarioId = Number(req.body?.scenario_id || 0);
    const runId = Number(req.body?.run_id || 0);
    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    if (!Number.isFinite(scenarioId) || scenarioId <= 0) return res.status(400).json({ error: "scenario_id_invalid" });
    if (!Number.isFinite(runId) || runId <= 0) return res.status(400).json({ error: "run_id_invalid" });
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });

    const scenario = await q1(`SELECT id, captive_id, code FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario || Number(scenario.captive_id || 0) !== captiveId) return res.status(404).json({ error: "scenario_not_found" });

    const run = await q1(
      `SELECT id, scenario_id
       FROM simulation_runs
       WHERE id = ? AND scenario_id = ?`,
      [runId, scenarioId]
    );
    if (!run) return res.status(404).json({ error: "run_not_found" });

    const startedAt = Date.now();
    const scriptArgs = [
      "src/db/applySimulationReinsuranceV1.js",
      "--scenario-id",
      String(scenarioId),
      "--run-id",
      String(runId),
      "--snapshot-date",
      snapshotDate,
    ];
    const { stdout, stderr } = await execFileAsync("node", scriptArgs, {
      cwd: process.cwd(),
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const s2 = await q1(
      `SELECT run_id, snapshot_date, scr_total, mcr, own_funds_eligible, solvency_ratio_pct, methodology_version
       FROM s2_scr_results
       WHERE run_id = ? AND snapshot_date = ?
       ORDER BY id DESC
       LIMIT 1`,
      [runId, snapshotDate]
    ).catch(() => null);

    return res.json({
      ok: true,
      scenario_id: scenarioId,
      scenario_code: scenario.code || null,
      run_id: runId,
      run_code: null,
      run_label: null,
      snapshot_date: snapshotDate,
      rerun_script: "applySimulationReinsuranceV1.js",
      elapsed_ms: Date.now() - startedAt,
      s2_result: s2
        ? {
            run_id: Number(s2.run_id || 0),
            snapshot_date: toIsoDate(s2.snapshot_date),
            scr_total: Number(s2.scr_total || 0),
            mcr: Number(s2.mcr || 0),
            own_funds_eligible: Number(s2.own_funds_eligible || 0),
            solvency_ratio_pct: Number(s2.solvency_ratio_pct || 0),
            methodology_version: s2.methodology_version || null,
          }
        : null,
      stdout: String(stdout || "").slice(-20000),
      stderr: String(stderr || "").slice(-20000),
    });
  } catch (err) {
    console.error("POST /api/actuariat/s2-engine-config/rerun failed", err);
    return res.status(500).json({ error: "s2_engine_config_rerun_failed" });
  }
});

router.get("/s2-real/list", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const year = Number(req.query.year || new Date().getUTCFullYear());
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return res.status(400).json({ error: "year_invalid" });
    const rows = await listS2RealSnapshotsByYear({ captiveId, year: Math.trunc(year) });
    return res.json({ ok: true, year: Math.trunc(year), rows });
  } catch (err) {
    console.error("GET /api/actuariat/s2-real/list failed", err);
    return res.status(500).json({ error: "s2_real_list_failed" });
  }
});

router.post("/s2-real/calculate", authRequired, requireRole(...canView), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const scenarioId = Number(req.body?.scenario_id || 0);
    if (!Number.isFinite(scenarioId) || scenarioId <= 0) return res.status(400).json({ error: "scenario_id_invalid" });
    const scenario = await q1(`SELECT id, captive_id, code FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario || Number(scenario.captive_id || 0) !== captiveId) return res.status(404).json({ error: "scenario_not_found" });

    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const referenceRunId = req.body?.reference_run_id ? Number(req.body.reference_run_id) : null;
    const ownFundsMode = String(req.body?.own_funds_mode || "auto");
    const ownFundsManualInputEur =
      req.body?.own_funds_manual_input_eur == null || req.body?.own_funds_manual_input_eur === ""
        ? null
        : Number(req.body?.own_funds_manual_input_eur);

    const payload = await calculateS2RealSnapshot({
      captiveId,
      scenarioId,
      referenceRunId,
      snapshotDate,
      ownFundsMode,
      ownFundsManualInputEur,
    });

    return res.json({
      ...payload,
      scenario_code: scenario.code || null,
      preview_only: true,
    });
  } catch (err) {
    console.error("POST /api/actuariat/s2-real/calculate failed", err);
    return res.status(500).json({ error: "s2_real_calculate_failed" });
  }
});

router.post("/s2-real/save", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const scenarioId = Number(req.body?.scenario_id || 0);
    if (!Number.isFinite(scenarioId) || scenarioId <= 0) return res.status(400).json({ error: "scenario_id_invalid" });
    const scenario = await q1(`SELECT id, captive_id, code FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario || Number(scenario.captive_id || 0) !== captiveId) return res.status(404).json({ error: "scenario_not_found" });

    const snapshotDate = toIsoDate(req.body?.snapshot_date);
    if (!snapshotDate) return res.status(400).json({ error: "snapshot_date_invalid" });
    const referenceRunId = req.body?.reference_run_id ? Number(req.body.reference_run_id) : null;
    const ownFundsMode = String(req.body?.own_funds_mode || "auto");
    const ownFundsManualInputEur =
      req.body?.own_funds_manual_input_eur == null || req.body?.own_funds_manual_input_eur === ""
        ? null
        : Number(req.body?.own_funds_manual_input_eur);
    const overwrite = req.body?.overwrite === true || String(req.body?.overwrite || "") === "1";

    const payload = await saveS2RealSnapshot({
      captiveId,
      scenarioId,
      referenceRunId,
      snapshotDate,
      ownFundsMode,
      ownFundsManualInputEur,
      overwrite,
      user: req.user || null,
    });

    return res.json({
      ...payload,
      scenario_code: scenario.code || null,
      preview_only: false,
    });
  } catch (err) {
    if (err?.code === "S2_REAL_SNAPSHOT_EXISTS") {
      return res.status(409).json({ error: "s2_real_snapshot_exists" });
    }
    console.error("POST /api/actuariat/s2-real/save failed", err);
    return res.status(500).json({ error: "s2_real_save_failed" });
  }
});

router.post("/s2-real/generate-monthly", authRequired, requireRole("admin", "cfo", "risk_manager", "actuaire"), async (req, res) => {
  try {
    const captiveId = getCaptiveId(req);
    if (!captiveId) return res.status(403).json({ error: "forbidden_scope" });
    const scenarioId = Number(req.body?.scenario_id || 0);
    if (!Number.isFinite(scenarioId) || scenarioId <= 0) return res.status(400).json({ error: "scenario_id_invalid" });
    const scenario = await q1(`SELECT id, captive_id, code FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario || Number(scenario.captive_id || 0) !== captiveId) return res.status(404).json({ error: "scenario_not_found" });

    const year = Number(req.body?.year || 0);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return res.status(400).json({ error: "year_invalid" });
    const referenceRunId = req.body?.reference_run_id ? Number(req.body.reference_run_id) : null;
    const ownFundsMode = String(req.body?.own_funds_mode || "auto");
    const ownFundsManualInputEur =
      req.body?.own_funds_manual_input_eur == null || req.body?.own_funds_manual_input_eur === ""
        ? null
        : Number(req.body?.own_funds_manual_input_eur);
    const overwrite = req.body?.overwrite === true || String(req.body?.overwrite || "") === "1";

    const monthEnds = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(Math.trunc(year), i + 1, 0));
      return d.toISOString().slice(0, 10);
    });

    const results = [];
    for (const snapshotDate of monthEnds) {
      try {
        const out = await saveS2RealSnapshot({
          captiveId,
          scenarioId,
          referenceRunId,
          snapshotDate,
          ownFundsMode,
          ownFundsManualInputEur,
          overwrite,
          user: req.user || null,
        });
        results.push({
          snapshot_date: snapshotDate,
          ok: true,
          saved_id: Number(out?.saved?.id || 0) || null,
          overwritten: !!out?.saved?.overwritten,
          scr_total: Number(out?.snapshot?.scr_total || 0),
          solvency_ratio_pct: out?.snapshot?.solvency_ratio_pct == null ? null : Number(out.snapshot.solvency_ratio_pct),
        });
      } catch (err) {
        results.push({
          snapshot_date: snapshotDate,
          ok: false,
          error: err?.code === "S2_REAL_SNAPSHOT_EXISTS" ? "s2_real_snapshot_exists" : "s2_real_save_failed",
        });
      }
    }

    return res.json({
      ok: true,
      scenario_id: scenarioId,
      scenario_code: scenario.code || null,
      year: Math.trunc(year),
      generated_count: results.filter((r) => r.ok).length,
      failed_count: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error("POST /api/actuariat/s2-real/generate-monthly failed", err);
    return res.status(500).json({ error: "s2_real_generate_monthly_failed" });
  }
});

export default router;
