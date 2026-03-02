import pool from "./pool.js";

const DEFAULT_S2_ENGINE_PLACEHOLDER_CONFIG = {
  own_funds_eligible_base_eur: 12_000_000,
  mcr_eur: 2_700_000,
  claims_v1: {
    cat_charge_factor: 0.25,
    nonlife_multiplier: 0.8,
    operational_min_eur: 100_000,
    operational_per_claim_eur: 50,
  },
  reinsurance_v1: {
    cat_charge_factor: 0.25,
    counterparty_charge_factor: 0.08,
    nonlife_multiplier: 0.78,
    operational_fixed_eur: 350_000,
  },
  cat_xol_v2: {
    cat_charge_factor: 0.3,
    counterparty_charge_factor: 0.1,
    nonlife_multiplier: 0.76,
    operational_fixed_eur: 450_000,
  },
  fronting_v2: {
    cat_charge_factor: 0.3,
    counterparty_charge_factor: 0.1,
    nonlife_multiplier: 0.76,
    operational_fixed_eur: 450_000,
  },
};

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) return override;
  const out = { ...base };
  if (!isPlainObject(override)) return out;
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function parseJsonMaybe(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadS2EnginePlaceholderConfig(scenarioId) {
  if (!Number.isFinite(Number(scenarioId)) || Number(scenarioId) <= 0) {
    return structuredClone(DEFAULT_S2_ENGINE_PLACEHOLDER_CONFIG);
  }
  const [rows] = await pool.query(
    `SELECT value_json
     FROM simulation_parameters
     WHERE scenario_id = ?
       AND parameter_group = 's2'
       AND parameter_key = 'engine_placeholder_config_v1'
     ORDER BY COALESCE(effective_from, '1900-01-01') DESC, updated_at DESC
     LIMIT 1`,
    [Number(scenarioId)]
  );
  const override = parseJsonMaybe(rows?.[0]?.value_json);
  return deepMerge(structuredClone(DEFAULT_S2_ENGINE_PLACEHOLDER_CONFIG), override || {});
}

export function s2CfgNum(config, path, fallback) {
  const value = path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), config);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

