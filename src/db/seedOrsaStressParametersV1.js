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

async function upsertParam(scenarioId, key, value) {
  await pool.query(
    `INSERT INTO simulation_parameters (scenario_id, parameter_group, parameter_key, value_json)
     VALUES (?, 's2', ?, ?)
     ON DUPLICATE KEY UPDATE
       value_json = VALUES(value_json),
       updated_at = CURRENT_TIMESTAMP`,
    [scenarioId, key, JSON.stringify(value)]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);

  const adverse = {
    portfolio: { gwp_mult: 0.965 },
    claims: { paid_mult: 1.17, incurred_mult: 1.21, rbns_mult: 1.24, ibnr_mult: 1.23, property_cat_loss_mult: 1.30 },
    reinsurance: { premium_ceded_mult: 1.00, claims_ceded_mult: 1.10 },
    s2: { cat_exposure_mult: 1.25, nonlife_mult: 1.12, counterparty_mult: 1.10, operational_mult: 1.06 },
    own_funds: { mult: 0.90 },
    branches: {
      "08": {
        claims: { property_cat_loss_mult: 1.20, incurred_mult: 1.08, rbns_mult: 1.10, ibnr_mult: 1.08 },
        s2: { cat_exposure_mult: 1.15 },
      },
      "13": {
        claims: { incurred_mult: 1.07, rbns_mult: 1.10, ibnr_mult: 1.12 },
      },
      "02": {
        claims: { incurred_mult: 1.09, rbns_mult: 1.12, ibnr_mult: 1.15 },
      },
    },
  };
  const severe = {
    portfolio: { gwp_mult: 0.90 },
    claims: { paid_mult: 1.42, incurred_mult: 1.52, rbns_mult: 1.58, ibnr_mult: 1.62, property_cat_loss_mult: 1.75 },
    reinsurance: { premium_ceded_mult: 1.00, claims_ceded_mult: 1.22 },
    s2: { cat_exposure_mult: 1.70, nonlife_mult: 1.33, counterparty_mult: 1.24, operational_mult: 1.14 },
    own_funds: { mult: 0.76 },
    branches: {
      "08": {
        claims: { property_cat_loss_mult: 1.35, incurred_mult: 1.15, rbns_mult: 1.18, ibnr_mult: 1.20 },
        s2: { cat_exposure_mult: 1.35 },
      },
      "13": {
        claims: { incurred_mult: 1.12, rbns_mult: 1.18, ibnr_mult: 1.22 },
        s2: { counterparty_mult: 1.06 },
      },
      "02": {
        claims: { incurred_mult: 1.15, rbns_mult: 1.20, ibnr_mult: 1.25 },
        s2: { counterparty_mult: 1.08 },
      },
      "10": {
        portfolio: { gwp_mult: 0.97 },
        claims: { paid_mult: 1.05, incurred_mult: 1.06 },
      },
    },
  };

  try {
    await upsertParam(scenarioId, "orsa_stress_adverse", adverse);
    await upsertParam(scenarioId, "orsa_stress_severe", severe);
    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario_id: scenarioId,
          params_written: ["orsa_stress_adverse", "orsa_stress_severe"],
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
