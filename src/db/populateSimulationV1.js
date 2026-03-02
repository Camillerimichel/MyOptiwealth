import pool from "./pool.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function buildBaseParameters() {
  return [
    {
      parameter_group: "portfolio",
      parameter_key: "targets",
      value_json: {
        gwp_total_eur: 208_000_000,
        clients_count: 85_000,
        contracts_count: 250_000,
        brokers_count: 1_100,
        target_year: 2028,
      },
    },
    {
      parameter_group: "portfolio",
      parameter_key: "gwp_by_branch",
      value_json: {
        motor: 60_000_000,
        professional_indemnity: 51_000_000,
        medical_malpractice: 34_000_000,
        property: 16_000_000,
        autres: 47_000_000,
      },
    },
    {
      parameter_group: "portfolio",
      parameter_key: "average_premium_by_branch",
      value_json: {
        motor: 1500,
        professional_indemnity: 2000,
        medical_malpractice: 4000,
        property: 1800,
      },
    },
    {
      parameter_group: "distribution",
      parameter_key: "broker_pareto",
      value_json: {
        top_share_brokers_pct: 20,
        top_share_gwp_pct_min: 60,
        top_share_gwp_pct_max: 70,
        active_brokers_range: [800, 1500],
      },
    },
    {
      parameter_group: "claims",
      parameter_key: "branch_profiles",
      value_json: {
        motor: { frequency: "high", severity: "medium", tail: "short" },
        professional_indemnity: { frequency: "medium", severity: "high", tail: "long" },
        medical_malpractice: { frequency: "low_medium", severity: "very_high", tail: "very_long" },
        property: { frequency: "medium", severity: "medium_high", tail: "short", cat_sensitive: true },
      },
    },
    {
      parameter_group: "reinsurance",
      parameter_key: "v1_scope",
      value_json: {
        enable_quota_share: true,
        enable_stop_loss: true,
        enable_xol: false,
      },
    },
    {
      parameter_group: "s2",
      parameter_key: "baseline",
      value_json: {
        non_life_only: true,
        mcr_absolute_non_life_eur: 2_700_000,
        governance_required: ["actuarial", "risk", "compliance", "internal_audit", "orsa", "qrt"],
      },
    },
  ];
}

async function getDefaultCaptiveId() {
  const [rows] = await pool.query(
    `SELECT id, code, name
     FROM captives
     WHERE status = 'active'
     ORDER BY id ASC
     LIMIT 1`
  );
  if (!rows[0]) {
    throw new Error("Aucune captive active trouvée dans la table captives.");
  }
  return rows[0];
}

async function ensureScenario({ captiveId, code, name, targetYear }) {
  await pool.query(
    `INSERT INTO simulation_scenarios (captive_id, code, name, target_year, status, data_origin)
     VALUES (?, ?, ?, ?, 'draft', 'synthetic')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       target_year = VALUES(target_year),
       updated_at = CURRENT_TIMESTAMP`,
    [captiveId, code, name, targetYear]
  );

  const [rows] = await pool.query(
    `SELECT id, captive_id, code, name, target_year
     FROM simulation_scenarios
     WHERE captive_id = ? AND code = ?
     LIMIT 1`,
    [captiveId, code]
  );
  return rows[0];
}

async function createRun({ scenarioId, runLabel, seedValue }) {
  const [res] = await pool.query(
    `INSERT INTO simulation_runs (scenario_id, run_label, seed_value, status, engine_version, started_at)
     VALUES (?, ?, ?, 'running', ?, NOW())`,
    [scenarioId, runLabel, seedValue, "v1-skeleton"]
  );
  return res.insertId;
}

async function replaceScenarioParameters({ scenarioId, params }) {
  for (const p of params) {
    await pool.query(
      `INSERT INTO simulation_parameters (scenario_id, parameter_group, parameter_key, value_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value_json = VALUES(value_json),
         updated_at = CURRENT_TIMESTAMP`,
      [scenarioId, p.parameter_group, p.parameter_key, JSON.stringify(p.value_json)]
    );
  }
}

async function addRunCheck(runId, checkCode, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, checkCode, severity, status, metricValue, message]
  );
}

async function markRunDone(runId, notes) {
  await pool.query(
    `UPDATE simulation_runs
     SET status = 'done', ended_at = NOW(), notes = ?
     WHERE id = ?`,
    [notes, runId]
  );
}

async function markRunFailed(runId, err) {
  if (!runId) return;
  await pool.query(
    `UPDATE simulation_runs
     SET status = 'failed', ended_at = NOW(), notes = ?
     WHERE id = ?`,
    [String(err?.message || err), runId]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const targetYear = Number(args.year || 2028);
  const scenarioCode = String(args.scenario || "SIM_CAPTIVE_2028_BASE");
  const scenarioName = String(args.name || "Simulation captive 2028 - base");
  const runLabel = String(args.run || `bootstrap-${Date.now()}`);
  const seedValue = args.seed ? Number(args.seed) : 20280208;

  let runId = null;

  try {
    const captive = await getDefaultCaptiveId();
    const scenario = await ensureScenario({
      captiveId: captive.id,
      code: scenarioCode,
      name: scenarioName,
      targetYear,
    });

    await replaceScenarioParameters({
      scenarioId: scenario.id,
      params: buildBaseParameters(),
    });

    runId = await createRun({
      scenarioId: scenario.id,
      runLabel,
      seedValue,
    });

    await addRunCheck(
      runId,
      "PHASE0_SCENARIO_BOOTSTRAP",
      "info",
      "pass",
      "Scenario, run et paramètres de base créés."
    );

    await addRunCheck(
      runId,
      "TODO_PHASES_PENDING",
      "warning",
      "pass",
      "Phases de génération courtiers/clients/contrats/primes/sinistres/réassurance/S2 non implémentées dans ce squelette."
    );

    await markRunDone(
      runId,
      "Bootstrap V1 exécuté. Étapes suivantes à implémenter: brokers, clients, contracts, premiums, claims, reinsurance, S2."
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          captive: { id: captive.id, code: captive.code, name: captive.name },
          scenario: { id: scenario.id, code: scenario.code, target_year: scenario.target_year },
          run: { id: runId, label: runLabel, status: "done" },
          next_steps: [
            "generate_brokers",
            "generate_clients",
            "generate_contracts",
            "generate_premiums",
            "generate_claims",
            "apply_reinsurance",
            "compute_s2_aggregates",
          ],
        },
        null,
        2
      )
    );
  } catch (err) {
    await markRunFailed(runId, err);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

