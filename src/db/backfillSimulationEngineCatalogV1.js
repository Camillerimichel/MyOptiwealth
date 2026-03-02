import fs from "node:fs/promises";
import path from "node:path";
import pool from "./pool.js";

function classifyEngine(versionRaw) {
  const version = String(versionRaw || "").trim() || "unknown";
  const lower = version.toLowerCase();
  let family = "SIMULATION";
  if (lower.includes("alm")) family = "ALM";
  else if (lower.includes("orsa")) family = "ORSA";
  else if (lower.includes("s2") || lower.includes("solv")) family = "S2";
  else if (lower.includes("cat")) family = "CAT";
  else if (lower.includes("fronting")) family = "FRONTING";
  else if (lower.includes("reins")) family = "REINSURANCE";

  const modules = [];
  if (lower.includes("geo")) modules.push("cat_geo");
  if (lower.includes("cat")) modules.push("cat_risk");
  if (lower.includes("fronting")) modules.push("fronting");
  if (lower.includes("qs")) modules.push("quota_share");
  if (lower.includes("xol")) modules.push("xol");
  if (lower.includes("sl")) modules.push("stop_loss");
  if (lower.includes("s2")) modules.push("s2");
  if (lower.includes("orsa")) modules.push("orsa");
  if (lower.includes("placeholder")) modules.push("placeholder_methodology");
  if (!modules.length) modules.push("core");

  const engineCode = `${family}_${version.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`.slice(0, 120);
  const title = `${family} - ${version}`;
  const description = `Référentiel V1 auto-généré depuis simulation_runs.engine_version (${version}).`;
  const methodologyScope = family === "ALM"
    ? "Calculs ALM / liquidité / duration (selon script exécuté) - V1 référentiel."
    : family === "ORSA"
      ? "Stress ORSA et agrégats de comparaison - V1 référentiel."
      : family === "S2"
        ? "Calculs Solvabilité II simplifiés / placeholders selon version."
        : "Moteur de simulation / agrégats techniques.";
  const limitations = lower.includes("placeholder")
    ? "Version placeholder / simplifiée : résultats exploitables pour cadrage mais non équivalents à un moteur réglementaire complet."
    : "Version V1 référencée automatiquement ; vérifier modules et paramètres pour audit complet.";

  let scriptName = null;
  if (lower.includes("alm") && lower.includes("stress")) scriptName = "src/db/runAlmV3StressScenarios.js";
  else if (lower.includes("alm") && lower.includes("daily")) scriptName = "src/db/runAlmV3DailySnapshots.js";
  else if (lower.includes("alm")) scriptName = "src/db/seedAlmV3Foundation.js";
  else if (lower.includes("orsa")) scriptName = "src/db/generateOrsaStressRunsV1.js";
  else if (lower.includes("fronting")) scriptName = "src/db/applyFrontingMotorRunV2.js";
  else if (lower.includes("s2")) scriptName = "src/db/recomputeS2FromGeoCatV1.js";
  else if (lower.includes("cat")) scriptName = "src/db/buildCatConcentrationV1.js";

  const repoPath = "/var/www/CAPTIVA";
  const commonParams = [
    { key: "engine_version", label: "Version moteur", type: "string", source: "simulation_runs.engine_version", description: "Identifiant de version de logique utilisé par le run." },
    { key: "run_label", label: "Label de run", type: "string", source: "simulation_runs.run_label", description: "Libellé de l'exécution pour contexte métier/technique." },
    { key: "notes", label: "Notes run", type: "string", source: "simulation_runs.notes", description: "Notes libres associées à l'exécution (si renseignées)." },
  ];
  const familyParams = {
    ORSA: [
      { key: "stress_code", label: "Code stress", type: "string", source: "orsa_run_set_members.stress_code", description: "Scénario ORSA associé au run (BASE / ADVERSE / SEVERE)." },
      { key: "assumption_json", label: "Hypothèses de stress", type: "json", source: "orsa_run_set_members.assumption_json", description: "Multiplicateurs globaux et stress spécifiques par branche appliqués au run." },
      { key: "comparison_snapshot", label: "Comparaison ORSA", type: "json", source: "orsa_run_comparison_snapshots", description: "Résultats consolidés (GWP, sinistres, SCR, solvabilité) par stress." },
    ],
    S2: [
      { key: "s2_inputs_non_life", label: "Inputs S2 non-vie", type: "table/json", source: "s2_scr_inputs_non_life", description: "Volumes premium/réserve/CAT/contrepartie et paramètres sigma par branche." },
      { key: "s2_results", label: "Résultats SCR/MCR", type: "table/json", source: "s2_scr_results", description: "Résultats synthétiques S2 (SCR, MCR, solvabilité) pour le run." },
      { key: "snapshot_date", label: "Date snapshot S2", type: "date", source: "s2_scr_results.snapshot_date", description: "Date de calcul des agrégats S2 pour le run." },
    ],
    ALM: [
      { key: "alm_profile", label: "Profil ALM", type: "string/json", source: "alm_v3_profiles", description: "Profil ALM de référence utilisé pour les stress / snapshots journaliers." },
      { key: "daily_snapshots", label: "Snapshots ALM journaliers", type: "table/json", source: "alm_v3_daily_snapshots", description: "Agrégats journaliers (cash, actifs, gaps liquidité, duration)." },
      { key: "stress_config", label: "Stress ALM V3", type: "json", source: "alm_v3_stress_scenarios + alm_v3_stress_asset_class_shocks", description: "Paramètres de stress globaux et chocs par classe d’actifs." },
    ],
    CAT: [
      { key: "cat_geo_concentration", label: "Concentration CAT géographique", type: "table/json", source: "cat_concentration_snapshots", description: "Concentration Property par zone et métriques HHI / exposition pondérée." },
      { key: "cat_events", label: "Événements CAT", type: "table/json", source: "cat_events", description: "Événements CAT simulés utilisés dans le run (si présents)." },
    ],
    FRONTING: [
      { key: "fronting_program", label: "Programme de fronting", type: "table/json", source: "fronting_programs", description: "Structure fronting (assureurs, rétrocession, fees) associée au run." },
      { key: "fronting_adjustments", label: "Ajustements économiques", type: "table/json", source: "fronting_run_adjustments", description: "Primes nettes, frais de fronting, coûts claims handling et exposition de contrepartie." },
      { key: "co_fronting_allocations", label: "Répartition co-fronting", type: "table/json", source: "fronting_run_counterparty_allocations", description: "Ventilation A/B des coûts et expositions de contrepartie." },
    ],
    REINSURANCE: [
      { key: "reinsurance_treaties", label: "Traités de réassurance", type: "table/json", source: "reinsurance_treaties + treaty_terms", description: "Structure des traités actifs (QS/XoL/Stop Loss)." },
      { key: "cessions", label: "Cessions primes/sinistres", type: "table/json", source: "reinsurance_premium_cessions + reinsurance_claim_cessions", description: "Flux de cession et recoveries utilisés pour le run." },
    ],
    SIMULATION: [
      { key: "scenario_parameters", label: "Paramètres de simulation", type: "json", source: "simulation_parameters", description: "Paramètres de simulation utilisés en amont (portfolio, claims, S2, etc.)." },
      { key: "run_checks", label: "Contrôles de run", type: "table/json", source: "simulation_run_checks", description: "Contrôles de cohérence et métriques de validation du run." },
    ],
  };
  const parametersSchema = [...commonParams, ...(familyParams[family] || [])];

  return { family, engineCode, title, description, methodologyScope, limitations, modules, scriptName, repoPath, parametersSchema };
}

async function applyDdl() {
  const ddlPath = path.resolve(process.cwd(), "ops/sql/simulation_engine_catalog_v1.sql");
  const ddl = await fs.readFile(ddlPath, "utf8");
  const statements = ddl
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

async function main() {
  await applyDdl();

  const [versions] = await pool.query(
    `SELECT DISTINCT engine_version
     FROM simulation_runs
     WHERE engine_version IS NOT NULL AND TRIM(engine_version) <> ''`
  );

  const catalogIdsByVersion = new Map();

  for (const row of versions) {
    const engineVersion = String(row.engine_version || "").trim();
    const c = classifyEngine(engineVersion);
    await pool.query(
      `INSERT INTO simulation_engine_catalog
         (engine_family, engine_code, engine_version, title, description, methodology_scope, limitations, script_name, repo_path, status, modules_json, parameters_schema_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, JSON_OBJECT('source','backfill_v1'))
       ON DUPLICATE KEY UPDATE
         engine_family = VALUES(engine_family),
         title = VALUES(title),
         description = VALUES(description),
         methodology_scope = VALUES(methodology_scope),
         limitations = VALUES(limitations),
         script_name = COALESCE(VALUES(script_name), script_name),
         repo_path = COALESCE(VALUES(repo_path), repo_path),
         modules_json = VALUES(modules_json),
         parameters_schema_json = VALUES(parameters_schema_json),
         updated_at = CURRENT_TIMESTAMP`,
      [
        c.family,
        c.engineCode,
        engineVersion,
        c.title,
        c.description,
        c.methodologyScope,
        c.limitations,
        c.scriptName,
        c.repoPath,
        JSON.stringify(c.modules),
        JSON.stringify(c.parametersSchema),
      ]
    );
    const [catRows] = await pool.query(
      `SELECT id FROM simulation_engine_catalog WHERE engine_code = ? AND engine_version = ? LIMIT 1`,
      [c.engineCode, engineVersion]
    );
    if (catRows[0]?.id) catalogIdsByVersion.set(engineVersion, Number(catRows[0].id));
  }

  const [runs] = await pool.query(
    `SELECT sr.id, sr.engine_version, sr.run_label, sr.status, sr.notes, sr.started_at, sr.ended_at, sr.created_at
     FROM simulation_runs sr
     WHERE sr.engine_version IS NOT NULL AND TRIM(sr.engine_version) <> ''`
  );

  let upserts = 0;
  for (const run of runs) {
    const engineVersion = String(run.engine_version || "").trim();
    const c = classifyEngine(engineVersion);
    const started = run.started_at ? new Date(run.started_at).getTime() : null;
    const ended = run.ended_at ? new Date(run.ended_at).getTime() : null;
    const durationMs = started && ended && ended >= started ? ended - started : null;
    const warnings = [];
    if (engineVersion.toLowerCase().includes("placeholder")) warnings.push("placeholder_methodology");
    const executionStats = {
      run_status: run.status || null,
      duration_ms: durationMs,
      started_at: run.started_at || null,
      ended_at: run.ended_at || null,
      created_at: run.created_at || null,
    };
    const engineConfig = {
      run_label: run.run_label || null,
      engine_version: engineVersion,
      notes: run.notes || null,
    };
    const dataDependencies = {
      source: "simulation_runs",
      engine_version_column: true,
      notes_column: !!run.notes,
    };
    await pool.query(
      `INSERT INTO simulation_run_engine_details
         (run_id, engine_catalog_id, engine_family, engine_code, engine_version, engine_title,
          engine_config_json, modules_json, data_dependencies_json, warnings_json, execution_stats_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         engine_catalog_id = VALUES(engine_catalog_id),
         engine_family = VALUES(engine_family),
         engine_code = VALUES(engine_code),
         engine_version = VALUES(engine_version),
         engine_title = VALUES(engine_title),
         engine_config_json = VALUES(engine_config_json),
         modules_json = VALUES(modules_json),
         data_dependencies_json = VALUES(data_dependencies_json),
         warnings_json = VALUES(warnings_json),
         execution_stats_json = VALUES(execution_stats_json),
         notes = VALUES(notes),
         updated_at = CURRENT_TIMESTAMP`,
      [
        run.id,
        catalogIdsByVersion.get(engineVersion) || null,
        c.family,
        c.engineCode,
        engineVersion,
        c.title,
        JSON.stringify(engineConfig),
        JSON.stringify(c.modules),
        JSON.stringify(dataDependencies),
        JSON.stringify(warnings),
        JSON.stringify(executionStats),
        run.notes || null,
      ]
    );
    upserts += 1;
  }

  const [counts] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM simulation_engine_catalog) AS catalog_count,
       (SELECT COUNT(*) FROM simulation_run_engine_details) AS run_details_count`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        distinct_engine_versions: versions.length,
        run_engine_detail_upserts: upserts,
        catalog_count: Number(counts?.[0]?.catalog_count || 0),
        run_details_count: Number(counts?.[0]?.run_details_count || 0),
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });
