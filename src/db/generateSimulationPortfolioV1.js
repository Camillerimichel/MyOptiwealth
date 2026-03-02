import pool from "./pool.js";
import { loadS2EnginePlaceholderConfig, s2CfgNum } from "./s2EngineConfig.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
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

function createRng(seed = 123456789) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickWeightedIndex(rng, cumulative) {
  const x = rng() * cumulative[cumulative.length - 1];
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (x <= cumulative[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function queryOne(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function queryAll(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function insertBatch(table, columns, rows) {
  if (!rows.length) return { insertId: null, affectedRows: 0 };
  const placeholders = rows.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  const flat = [];
  for (const row of rows) {
    for (const col of columns) flat.push(row[col] ?? null);
  }
  const [res] = await pool.query(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`,
    flat
  );
  return res;
}

async function ensureScenario(scenarioCode) {
  const scenario = await queryOne(
    `SELECT id, captive_id, code, target_year
     FROM simulation_scenarios
     WHERE code = ?
     ORDER BY id DESC
     LIMIT 1`,
    [scenarioCode]
  );
  if (!scenario) throw new Error(`Scenario introuvable: ${scenarioCode}`);
  return scenario;
}

async function createRun(scenarioId, runLabel, seed) {
  const [res] = await pool.query(
    `INSERT INTO simulation_runs (scenario_id, run_label, seed_value, status, engine_version, started_at)
     VALUES (?, ?, ?, 'running', 'v1-portfolio', NOW())`,
    [scenarioId, runLabel, seed]
  );
  return res.insertId;
}

async function finishRun(runId, status, notes) {
  await pool.query(
    `UPDATE simulation_runs SET status = ?, ended_at = NOW(), notes = ? WHERE id = ?`,
    [status, notes, runId]
  );
}

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

function buildBrokerWeights(count) {
  const weights = [];
  for (let i = 0; i < count; i += 1) {
    // Zipf-like distribution for Pareto behavior.
    weights.push(1 / Math.pow(i + 1, 0.9));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

function cumulative(weights) {
  const out = [];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    out.push(acc);
  }
  return out;
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function ensureProgrammes(captiveId) {
  const wanted = [
    { code: "SIM_MOTOR", label: "Motor", s2: "10" },
    { code: "SIM_PI", label: "Professional Indemnity", s2: "13" },
    { code: "SIM_MED", label: "Medical Malpractice", s2: "02" },
    { code: "SIM_PROP", label: "Property", s2: "08" },
    { code: "SIM_OTH", label: "Autres", s2: "16" },
  ];

  const byCode = {};
  const rows = await queryAll(
    `SELECT id, ligne_risque, branch_s2_code
     FROM programmes
     WHERE captive_id <=> ?`,
    [captiveId]
  );
  for (const r of rows) {
    byCode[r.ligne_risque] = r;
  }

  for (const p of wanted) {
    if (!byCode[p.code]) {
      await pool.query(
        `INSERT INTO programmes
          (captive_id, ligne_risque, statut, devise, branch_s2_code)
         VALUES (?, ?, 'actif', 'EUR', ?)`,
        [captiveId, p.code, p.s2]
      );
    }
  }

  const finalRows = await queryAll(
    `SELECT id, ligne_risque, branch_s2_code
     FROM programmes
     WHERE captive_id <=> ?
       AND ligne_risque IN ('SIM_MOTOR','SIM_PI','SIM_MED','SIM_PROP','SIM_OTH')`,
    [captiveId]
  );
  const map = {};
  for (const r of finalRows) map[r.ligne_risque] = r;

  // Ensure one baseline coverage + one baseline pricing row per simulation programme
  const coverageBlueprints = {
    SIM_MOTOR: { label: "Motor standard", coverage_type: "MOTOR", limit_per_claim: 100000, limit_annual: 200000 },
    SIM_PI: { label: "PI standard", coverage_type: "LIABILITY", limit_per_claim: 500000, limit_annual: 500000 },
    SIM_MED: { label: "Medical malpractice standard", coverage_type: "LIABILITY", limit_per_claim: 1000000, limit_annual: 1000000 },
    SIM_PROP: { label: "Property dommages", coverage_type: "PROPERTY", limit_per_claim: 300000, limit_annual: 300000 },
    SIM_OTH: { label: "Autres garanties", coverage_type: "OTHER", limit_per_claim: 50000, limit_annual: 50000 },
  };
  const pricingBlueprints = {
    SIM_MOTOR: { pricing_method: "FIXED_PREMIUM", premium_amount: 1500, minimum_premium: 900 },
    SIM_PI: { pricing_method: "FIXED_PREMIUM", premium_amount: 2000, minimum_premium: 1200 },
    SIM_MED: { pricing_method: "FIXED_PREMIUM", premium_amount: 4000, minimum_premium: 2500 },
    SIM_PROP: { pricing_method: "FIXED_PREMIUM", premium_amount: 1800, minimum_premium: 1000 },
    SIM_OTH: { pricing_method: "FIXED_PREMIUM", premium_amount: 280, minimum_premium: 100 },
  };
  const deductibleBlueprints = {
    SIM_MOTOR: { amount: 500, unit: "FIXED" },
    SIM_PI: { amount: 1500, unit: "FIXED" },
    SIM_MED: { amount: 5000, unit: "FIXED" },
    SIM_PROP: { amount: 1000, unit: "FIXED" },
    SIM_OTH: { amount: 250, unit: "FIXED" },
  };
  const generalExclusions = [
    { category: "GENERAL", description: "Fraude, dol ou acte intentionnel de l'assure." },
    {
      category: "GENERAL",
      description:
        "Guerre, invasion, emeute generalisee et actes de terrorisme (sauf extension expresse).",
    },
    {
      category: "GENERAL",
      description: "Risque nucleaire, rayonnements ionisants et contamination radioactive.",
    },
    {
      category: "GENERAL",
      description: "Amendes, penalites et sanctions non assurables selon la loi applicable.",
    },
  ];
  const specificExclusions = {
    SIM_MOTOR: [
      {
        category: "MOTOR",
        description:
          "Conduite sans permis valide ou sous l'emprise d'alcool/stupefiants (selon recours legal).",
      },
      {
        category: "MOTOR",
        description: "Utilisation du vehicule hors usage declare (competition, transport non autorise).",
      },
    ],
    SIM_PI: [
      {
        category: "LIABILITY",
        description: "Engagements contractuels excedant la responsabilite legale non declares.",
      },
      {
        category: "LIABILITY",
        description: "Sinistres connus ou circonstances connues avant prise d'effet.",
      },
    ],
    SIM_MED: [
      { category: "LIABILITY", description: "Actes hors champ d'habilitation/qualification declaree." },
      {
        category: "LIABILITY",
        description:
          "Sinistres lies a des faits anterieurs connus avant prise d'effet (known circumstances).",
      },
    ],
    SIM_PROP: [
      { category: "PROPERTY", description: "Usure normale, corrosion, vice d'entretien et defaut de maintenance." },
      { category: "PROPERTY", description: "Perte d'exploitation non declaree ou non souscrite explicitement." },
    ],
    SIM_OTH: [{ category: "OTHER", description: "Pertes indirectes non nommement garanties par le programme." }],
  };
  const generalConditions = [
    {
      title: "Declaration du sinistre",
      content:
        "Le sinistre doit etre declare sans retard excessif apres sa connaissance, avec les pieces justificatives disponibles.",
    },
    {
      title: "Cooperation",
      content:
        "L'assure s'engage a cooperer a l'instruction du dossier et a communiquer toute information utile.",
    },
    {
      title: "Mesures conservatoires",
      content:
        "L'assure doit prendre toutes mesures raisonnables pour limiter l'aggravation du dommage.",
    },
    {
      title: "Prime et suspension",
      content:
        "Le non-paiement de la prime peut entrainer suspension ou resiliation selon les dispositions contractuelles.",
    },
  ];
  const specificConditions = {
    SIM_MOTOR: [
      {
        title: "Conducteurs autorises",
        content: "Les conducteurs doivent respecter les conditions de validite et d'usage declarees au contrat.",
      },
    ],
    SIM_PI: [
      {
        title: "Periode de garantie",
        content:
          "Garantie declenchee selon la base de couverture definie au contrat (claims made / autre selon police).",
      },
    ],
    SIM_MED: [
      {
        title: "Tracabilite des actes",
        content:
          "La tenue de dossiers et la tracabilite des actes sont requises pour l'instruction des reclamations.",
      },
    ],
    SIM_PROP: [
      {
        title: "Prevention et protection",
        content:
          "Le maintien en etat des moyens de prevention/protection declares conditionne la garantie.",
      },
    ],
    SIM_OTH: [
      {
        title: "Conditions particulieres",
        content:
          "Les conditions particulieres du programme precisent les extensions et limitations applicables.",
      },
    ],
  };

  for (const [programmeCode, programme] of Object.entries(map)) {
    const covBp = coverageBlueprints[programmeCode];
    const priceBp = pricingBlueprints[programmeCode];
    const dedBp = deductibleBlueprints[programmeCode];
    if (!covBp || !priceBp || !dedBp) continue;

    const existingCoverage = await queryOne(
      `SELECT id_coverage
       FROM programme_coverages
       WHERE programme_id = ?
       ORDER BY id_coverage ASC
       LIMIT 1`,
      [programme.id]
    );
    let coverageId = existingCoverage?.id_coverage || null;
    if (!coverageId) {
      const [ins] = await pool.query(
        `INSERT INTO programme_coverages
          (programme_id, label, coverage_type, limit_per_claim, limit_annual, currency)
         VALUES (?, ?, ?, ?, ?, 'EUR')`,
        [programme.id, covBp.label, covBp.coverage_type, covBp.limit_per_claim, covBp.limit_annual]
      );
      coverageId = ins.insertId;
    }

    const existingPricing = await queryOne(
      `SELECT id_pricing
       FROM programme_pricing
       WHERE programme_id = ? AND coverage_id <=> ?
       ORDER BY id_pricing ASC
       LIMIT 1`,
      [programme.id, coverageId]
    );
    if (!existingPricing) {
      await pool.query(
        `INSERT INTO programme_pricing
          (programme_id, coverage_id, pricing_method, premium_amount, minimum_premium, currency, notes)
         VALUES (?, ?, ?, ?, ?, 'EUR', ?)`,
        [
          programme.id,
          coverageId,
          priceBp.pricing_method,
          priceBp.premium_amount,
          priceBp.minimum_premium,
          `Tarification de reference simulation (${programmeCode})`,
        ]
      );
    }

    const existingDeductible = await queryOne(
      `SELECT id_deductible
       FROM programme_deductibles
       WHERE programme_id = ? AND coverage_id <=> ?
       ORDER BY id_deductible ASC
       LIMIT 1`,
      [programme.id, coverageId]
    );
    if (!existingDeductible) {
      await pool.query(
        `INSERT INTO programme_deductibles
          (programme_id, coverage_id, amount, unit, currency, notes)
         VALUES (?, ?, ?, ?, 'EUR', ?)`,
        [
          programme.id,
          coverageId,
          dedBp.amount,
          dedBp.unit,
          `Franchise de reference simulation (${programmeCode})`,
        ]
      );
    }

    const exclusions = [...generalExclusions, ...(specificExclusions[programmeCode] || [])];
    for (const ex of exclusions) {
      const exists = await queryOne(
        `SELECT id_exclusion
         FROM programme_exclusions
         WHERE programme_id = ? AND category <=> ? AND description = ?
         LIMIT 1`,
        [programme.id, ex.category, ex.description]
      );
      if (!exists) {
        await pool.query(
          `INSERT INTO programme_exclusions (programme_id, category, description)
           VALUES (?, ?, ?)`,
          [programme.id, ex.category, ex.description]
        );
      }
    }

    const conditions = [...generalConditions, ...(specificConditions[programmeCode] || [])];
    for (const cond of conditions) {
      const exists = await queryOne(
        `SELECT id_condition
         FROM programme_conditions
         WHERE programme_id = ? AND title = ? AND content = ?
         LIMIT 1`,
        [programme.id, cond.title, cond.content]
      );
      if (!exists) {
        await pool.query(
          `INSERT INTO programme_conditions (programme_id, title, content)
           VALUES (?, ?, ?)`,
          [programme.id, cond.title, cond.content]
        );
      }
    }
  }

  return map;
}

async function getBranchIds(captiveId) {
  const rows = await queryAll(
    `SELECT id_branch, s2_code, name
     FROM insurance_branch
     WHERE captive_id = ?`,
    [captiveId]
  );
  const byS2 = {};
  for (const r of rows) byS2[r.s2_code] = r;
  for (const code of ["10", "13", "02", "08", "16"]) {
    if (!byS2[code]) throw new Error(`Branch S2 introuvable pour code ${code}`);
  }
  return byS2;
}

async function generateBrokers({ scenario, rng, brokerCount = 1100, batchSize = 300 }) {
  const existing = await queryOne(`SELECT COUNT(*) AS cnt FROM partners`);
  if (existing?.cnt > 0) {
    throw new Error("La table partners n'est pas vide. Génération V1 attend un environnement vierge.");
  }

  const weights = buildBrokerWeights(brokerCount);
  const rows = [];
  for (let i = 0; i < brokerCount; i += 1) {
    const n = String(i + 1).padStart(4, "0");
    const siren = String(900000000 + i); // 9 digits synthetic
    rows.push({
      siren,
      siret_siege: `${siren}00000`,
      raison_sociale: `Courtier Simulation ${n}`,
      statut: "actif",
      code_ape: "6622Z",
      pays: "FR",
      region: ["IDF", "ARA", "NAQ", "PACA", "HDF", "OCC"][i % 6],
      conformite_statut: "ok",
      date_maj: "2026-02-23",
    });
  }

  const cols = [
    "siren",
    "siret_siege",
    "raison_sociale",
    "statut",
    "code_ape",
    "pays",
    "region",
    "conformite_statut",
    "date_maj",
  ];

  for (let i = 0; i < rows.length; i += batchSize) {
    await insertBatch("partners", cols, rows.slice(i, i + batchSize));
  }

  const partners = await queryAll(
    `SELECT id, region
     FROM partners
     ORDER BY id ASC`
  );

  const profileRows = [];
  for (let i = 0; i < partners.length; i += 1) {
    const pct = (i + 1) / partners.length;
    const broker_segment = pct <= 0.2 ? "top" : pct <= 0.6 ? "core" : "tail";
    profileRows.push({
      partner_id: partners[i].id,
      scenario_id: scenario.id,
      broker_segment,
      pareto_weight: Number(weights[i].toFixed(6)),
      target_clients_count: null,
      target_contracts_count: null,
      target_gwp_amount: null,
      specialization_json: JSON.stringify({ preferred: ["motor", "pi", "property"] }),
      region_code: partners[i].region,
      zone_code: partners[i].region,
      is_active: 1,
    });
  }

  const profileCols = [
    "partner_id",
    "scenario_id",
    "broker_segment",
    "pareto_weight",
    "target_clients_count",
    "target_contracts_count",
    "target_gwp_amount",
    "specialization_json",
    "region_code",
    "zone_code",
    "is_active",
  ];
  for (let i = 0; i < profileRows.length; i += batchSize) {
    await insertBatch("partner_simulation_profiles", profileCols, profileRows.slice(i, i + batchSize));
  }

  return { partners, weights };
}

async function generateClients({
  scenario,
  rng,
  partners,
  partnerWeights,
  clientCount = 85000,
  batchSize = 1000,
}) {
  const cum = cumulative(partnerWeights);
  const clientRows = [];
  const clientMeta = [];
  const segmentPool = [
    { code: "particulier", p: 0.30 },
    { code: "pro", p: 0.25 },
    { code: "pme", p: 0.25 },
    { code: "sante", p: 0.10 },
    { code: "medical", p: 0.10 },
  ];
  const segCum = cumulative(segmentPool.map((s) => s.p));

  for (let i = 0; i < clientCount; i += 1) {
    const partnerIdx = pickWeightedIndex(rng, cum);
    const partnerId = partners[partnerIdx].id;
    const segIdx = pickWeightedIndex(rng, segCum);
    const segment = segmentPool[segIdx].code;
    const extRef = `SIMC-2028-${String(i + 1).padStart(6, "0")}`;
    const revenue =
      segment === "particulier" ? null : Math.round((20_000 + rng() * 5_000_000) * 100) / 100;
    const payroll =
      segment === "particulier" ? null : Math.round((10_000 + rng() * 2_000_000) * 100) / 100;

    clientRows.push({
      external_client_ref: extRef,
      type: segment === "particulier" ? "personne_physique" : "personne_morale",
      chiffre_affaires: revenue,
      masse_salariale: payroll,
      partner_id: partnerId,
    });
    clientMeta.push({ partnerId, segment });
  }

  const clientCols = [
    "external_client_ref",
    "type",
    "chiffre_affaires",
    "masse_salariale",
    "partner_id",
  ];
  for (let i = 0; i < clientRows.length; i += batchSize) {
    await insertBatch("clients", clientCols, clientRows.slice(i, i + batchSize));
  }

  const clients = await queryAll(
    `SELECT id, partner_id
     FROM clients
     ORDER BY id ASC`
  );
  if (clients.length !== clientCount) {
    throw new Error(`Nombre de clients inattendu: ${clients.length} != ${clientCount}`);
  }

  const profileRows = [];
  for (let i = 0; i < clients.length; i += 1) {
    const m = clientMeta[i];
    profileRows.push({
      client_id: clients[i].id,
      scenario_id: scenario.id,
      partner_id: m.partnerId,
      client_segment: m.segment,
      geo_code: ["FR-IDF", "FR-ARA", "FR-NAQ", "FR-PAC", "FR-HDF", "FR-OCC"][i % 6],
      equipment_score: Number((1 + rng() * 4).toFixed(4)),
      target_contracts_count: i < 5000 ? 2 : 3,
      risk_score: Number((0.1 + rng() * 0.9).toFixed(4)),
      price_sensitivity: Number((0.1 + rng() * 0.9).toFixed(4)),
      annual_revenue: clientRows[i].chiffre_affaires,
      payroll_amount: clientRows[i].masse_salariale,
      headcount: m.segment === "particulier" ? null : randInt(rng, 1, 500),
    });
  }

  const profileCols = [
    "client_id",
    "scenario_id",
    "partner_id",
    "client_segment",
    "geo_code",
    "equipment_score",
    "target_contracts_count",
    "risk_score",
    "price_sensitivity",
    "annual_revenue",
    "payroll_amount",
    "headcount",
  ];
  for (let i = 0; i < profileRows.length; i += batchSize) {
    await insertBatch("client_simulation_profiles", profileCols, profileRows.slice(i, i + batchSize));
  }

  return { clients, clientMeta };
}

function buildContractPlan() {
  // Exact total = 250,000
  const branchPlans = [
    {
      key: "motor",
      count: 40000,
      gwp: 60_000_000,
      programmeCode: "SIM_MOTOR",
      s2Code: "10",
    },
    {
      key: "pi",
      count: 25500,
      gwp: 51_000_000,
      programmeCode: "SIM_PI",
      s2Code: "13",
    },
    {
      key: "medical",
      count: 8500,
      gwp: 34_000_000,
      programmeCode: "SIM_MED",
      s2Code: "02",
    },
    {
      key: "property",
      count: 9000,
      gwp: 16_000_000,
      programmeCode: "SIM_PROP",
      s2Code: "08",
    },
    {
      key: "others",
      count: 167000,
      gwp: 47_000_000,
      programmeCode: "SIM_OTH",
      s2Code: "16",
    },
  ];

  const branchSlots = [];
  for (const p of branchPlans) {
    for (let i = 0; i < p.count; i += 1) branchSlots.push(p.key);
  }
  return { branchPlans, branchSlots };
}

function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function sampleFromBands(rng, bands) {
  const total = bands.reduce((s, b) => s + b.weight, 0);
  let x = rng() * total;
  for (const b of bands) {
    x -= b.weight;
    if (x <= 0) {
      const m = b.min + (b.max - b.min) * rng();
      return m;
    }
  }
  const last = bands[bands.length - 1];
  return last.min + (last.max - last.min) * rng();
}

function tariffConfigByBranch(branchKey, targetMean) {
  const common = { targetMean };
  switch (branchKey) {
    case "motor":
      return {
        ...common,
        minPremium: 450,
        maxPremium: 6500,
        bands: [
          { weight: 0.25, min: 0.55, max: 0.85 },
          { weight: 0.50, min: 0.85, max: 1.15 },
          { weight: 0.20, min: 1.15, max: 1.60 },
          { weight: 0.05, min: 1.60, max: 2.80 },
        ],
      };
    case "pi":
      return {
        ...common,
        minPremium: 600,
        maxPremium: 18000,
        bands: [
          { weight: 0.20, min: 0.50, max: 0.80 },
          { weight: 0.45, min: 0.80, max: 1.20 },
          { weight: 0.25, min: 1.20, max: 2.00 },
          { weight: 0.10, min: 2.00, max: 4.50 },
        ],
      };
    case "medical":
      return {
        ...common,
        minPremium: 1200,
        maxPremium: 50000,
        bands: [
          { weight: 0.15, min: 0.45, max: 0.80 },
          { weight: 0.45, min: 0.80, max: 1.25 },
          { weight: 0.25, min: 1.25, max: 2.20 },
          { weight: 0.15, min: 2.20, max: 6.00 },
        ],
      };
    case "property":
      return {
        ...common,
        minPremium: 500,
        maxPremium: 25000,
        bands: [
          { weight: 0.20, min: 0.50, max: 0.85 },
          { weight: 0.50, min: 0.85, max: 1.20 },
          { weight: 0.22, min: 1.20, max: 2.00 },
          { weight: 0.08, min: 2.00, max: 5.00 },
        ],
      };
    default:
      // "Autres" à prime moyenne faible, distribution plus tassée.
      return {
        ...common,
        minPremium: 40,
        maxPremium: 2500,
        bands: [
          { weight: 0.35, min: 0.35, max: 0.75 },
          { weight: 0.45, min: 0.75, max: 1.15 },
          { weight: 0.17, min: 1.15, max: 1.90 },
          { weight: 0.03, min: 1.90, max: 4.50 },
        ],
      };
  }
}

function buildCalibratedPremiumPool(rng, { count, gwp, branchKey }) {
  const targetMean = gwp / count;
  const cfg = tariffConfigByBranch(branchKey, targetMean);
  const raw = new Array(count);

  for (let i = 0; i < count; i += 1) {
    const bandMult = sampleFromBands(rng, cfg.bands);
    // Small local noise to avoid visible clustering.
    const jitter = 0.97 + rng() * 0.06;
    const value = cfg.targetMean * bandMult * jitter;
    raw[i] = Math.max(cfg.minPremium, Math.min(cfg.maxPremium, value));
  }

  const rawSum = raw.reduce((s, v) => s + v, 0) || 1;
  const scale = gwp / rawSum;
  const cents = raw.map((v) => Math.max(1, Math.round(v * scale * 100)));
  const targetCents = Math.round(gwp * 100);
  let delta = targetCents - cents.reduce((s, v) => s + v, 0);

  // Spread rounding correction over the pool to preserve realism.
  let idx = 0;
  while (delta !== 0 && idx < count * 20) {
    const i = idx % count;
    if (delta > 0) {
      cents[i] += 1;
      delta -= 1;
    } else if (cents[i] > 1) {
      cents[i] -= 1;
      delta += 1;
    }
    idx += 1;
  }

  const premiums = cents.map((c) => c / 100);
  shuffleInPlace(rng, premiums);
  return premiums;
}

function buildPremiumPools(rng, branchPlans) {
  const pools = {};
  for (const plan of branchPlans) {
    pools[plan.key] = buildCalibratedPremiumPool(rng, plan);
  }
  return pools;
}

function contractDateForIndex(rng, year) {
  return new Date(Date.UTC(year, 0, 1));
}

async function generateContractsAndPremiums({
  scenario,
  runId,
  rng,
  clients,
  clientMeta,
  programmesByCode,
  branchesByS2,
  batchSize = 800,
}) {
  const targetYear = Number(scenario?.target_year || 2028);
  const { branchPlans, branchSlots } = buildContractPlan();
  const totalContracts = branchSlots.length;
  if (clients.length !== 85000 || totalContracts !== 250000) {
    throw new Error("Paramètres inattendus pour la génération des contrats.");
  }

  shuffleInPlace(rng, branchSlots);

  const perClientTarget = new Array(clients.length);
  for (let i = 0; i < clients.length; i += 1) perClientTarget[i] = i < 5000 ? 2 : 3;
  const clientOrder = Array.from({ length: clients.length }, (_, i) => i);
  shuffleInPlace(rng, clientOrder);

  const slotClientIndexes = [];
  for (const idx of clientOrder) {
    for (let n = 0; n < perClientTarget[idx]; n += 1) {
      slotClientIndexes.push(idx);
    }
  }
  if (slotClientIndexes.length !== totalContracts) {
    throw new Error(`Nombre de slots clients invalide: ${slotClientIndexes.length}`);
  }
  shuffleInPlace(rng, slotClientIndexes);

  const planMap = Object.fromEntries(branchPlans.map((b) => [b.key, b]));
  const premiumPools = buildPremiumPools(rng, branchPlans);
  const premiumPoolIndexes = Object.fromEntries(branchPlans.map((b) => [b.key, 0]));

  let createdContracts = 0;
  let contractSerial = 0;

  const contractRowsBatch = [];
  const coverageRowsBatch = [];
  const premiumTermsBatch = [];
  const premiumPaymentsBatch = [];
  const premiumTxBatch = [];

  const branchCounters = {};
  const branchPremiumSums = {};
  for (const p of branchPlans) {
    branchCounters[p.key] = 0;
    branchPremiumSums[p.key] = 0;
  }
  const brokerGwp = new Map();
  const brokerContracts = new Map();
  const brokerClientSet = new Map();
  const branchStats = new Map(); // id_branch -> {contracts, clients:Set, gwp}

  async function flushBatches() {
    if (!contractRowsBatch.length) return;
    const contractCols = [
      "partner_id",
      "programme_id",
      "client_id",
      "statut",
      "date_debut",
      "date_fin",
      "devise",
    ];
    const contractRes = await insertBatch("contracts", contractCols, contractRowsBatch);
    const firstId = contractRes.insertId;
    const ids = Array.from({ length: contractRowsBatch.length }, (_, i) => firstId + i);

    for (let i = 0; i < ids.length; i += 1) {
      coverageRowsBatch[i].contract_id = ids[i];
      premiumTermsBatch[i].contract_id = ids[i];
      premiumPaymentsBatch[i].contract_id = ids[i];
      premiumTxBatch[i].contract_id = ids[i];
    }

    const covCols = [
      "contract_id",
      "id_branch",
      "programme_coverage_id",
      "coverage_label",
      "limit_per_claim",
      "limit_annual",
      "deductible_amount",
      "currency",
      "effective_from",
      "effective_to",
    ];
    await insertBatch("contract_coverages", covCols, coverageRowsBatch);
    const covLast = await queryOne(`SELECT MAX(id) AS max_id FROM contract_coverages`);
    const covFirst = covLast.max_id - coverageRowsBatch.length + 1;
    const coverageIds = Array.from({ length: coverageRowsBatch.length }, (_, i) => covFirst + i);
    for (let i = 0; i < coverageIds.length; i += 1) premiumTxBatch[i].contract_coverage_id = coverageIds[i];

    const termsCols = [
      "contract_id",
      "frequency",
      "amount",
      "currency",
      "start_date",
      "end_date",
    ];
    await insertBatch("contract_premium_terms", termsCols, premiumTermsBatch);

    const paymentsCols = ["contract_id", "paid_on", "amount", "currency", "reference", "notes"];
    await insertBatch("contract_premium_payments", paymentsCols, premiumPaymentsBatch);

    const premiumTxCols = [
      "scenario_id",
      "run_id",
      "contract_id",
      "contract_coverage_id",
      "transaction_type",
      "accounting_date",
      "effective_date",
      "amount_gross",
      "currency",
      "tax_amount",
      "commission_amount",
      "brokerage_amount",
      "source_ref",
    ];
    await insertBatch("premium_transactions", premiumTxCols, premiumTxBatch);

    createdContracts += contractRowsBatch.length;
    contractRowsBatch.length = 0;
    coverageRowsBatch.length = 0;
    premiumTermsBatch.length = 0;
    premiumPaymentsBatch.length = 0;
    premiumTxBatch.length = 0;
  }

  for (let i = 0; i < totalContracts; i += 1) {
    const branchKey = branchSlots[i];
    const clientIdx = slotClientIndexes[i];
    const client = clients[clientIdx];
    const clientProfile = clientMeta[clientIdx];
    const plan = planMap[branchKey];
    const programme = programmesByCode[plan.programmeCode];
    const branch = branchesByS2[plan.s2Code];
    const dateDebut = contractDateForIndex(rng, targetYear);
    const dateFin = new Date(Date.UTC(targetYear, 11, 31));
    branchCounters[branchKey] += 1;

    const poolIdx = premiumPoolIndexes[branchKey];
    let premium = premiumPools[branchKey][poolIdx];
    premiumPoolIndexes[branchKey] += 1;
    // Safety correction on very last row of the branch (should be near-zero delta after calibration).
    if (branchCounters[branchKey] === plan.count) {
      premium = Math.round((plan.gwp - branchPremiumSums[branchKey]) * 100) / 100;
    }
    branchPremiumSums[branchKey] += premium;

    contractSerial += 1;
    contractRowsBatch.push({
      partner_id: client.partner_id,
      programme_id: programme.id,
      client_id: client.id,
      statut: "actif",
      date_debut: yyyymmdd(dateDebut),
      date_fin: yyyymmdd(dateFin),
      devise: "EUR",
    });

    const baseLimit =
      branchKey === "medical"
        ? 1_000_000
        : branchKey === "pi"
          ? 500_000
          : branchKey === "property"
            ? 300_000
            : branchKey === "motor"
              ? 100_000
              : 50_000;
    const limitPerClaim = Math.round(baseLimit * (0.8 + rng() * 0.5));
    const deductible = Math.round((branchKey === "medical" ? 5000 : 1000) * (0.5 + rng()));
    coverageRowsBatch.push({
      contract_id: null,
      id_branch: branch.id_branch,
      programme_coverage_id: null,
      coverage_label: `SIM_${branchKey.toUpperCase()}_${String(contractSerial).padStart(6, "0")}`,
      limit_per_claim: limitPerClaim,
      limit_annual: limitPerClaim * (branchKey === "motor" ? 2 : 1),
      deductible_amount: deductible,
      currency: "EUR",
      effective_from: yyyymmdd(dateDebut),
      effective_to: yyyymmdd(dateFin),
    });

    premiumTermsBatch.push({
      contract_id: null,
      frequency: "ANNUAL",
      amount: premium,
      currency: "EUR",
      start_date: yyyymmdd(dateDebut),
      end_date: yyyymmdd(dateFin),
    });

    premiumPaymentsBatch.push({
      contract_id: null,
      paid_on: yyyymmdd(addDays(dateDebut, randInt(rng, 0, 30))),
      amount: premium,
      currency: "EUR",
      reference: `SIM-PAY-${contractSerial}`,
      notes: "Synthetic portfolio V1",
    });

    premiumTxBatch.push({
      scenario_id: scenario.id,
      run_id: runId,
      contract_id: null,
      contract_coverage_id: null,
      transaction_type: "ISSUED",
      accounting_date: yyyymmdd(dateDebut),
      effective_date: yyyymmdd(dateDebut),
      amount_gross: premium,
      currency: "EUR",
      tax_amount: 0,
      commission_amount: Math.round(premium * 0.1 * 100) / 100,
      brokerage_amount: Math.round(premium * 0.05 * 100) / 100,
      source_ref: `SIM-ISSUED-${contractSerial}`,
    });

    brokerGwp.set(client.partner_id, (brokerGwp.get(client.partner_id) || 0) + premium);
    brokerContracts.set(client.partner_id, (brokerContracts.get(client.partner_id) || 0) + 1);
    if (!brokerClientSet.has(client.partner_id)) brokerClientSet.set(client.partner_id, new Set());
    brokerClientSet.get(client.partner_id).add(client.id);

    if (!branchStats.has(branch.id_branch)) {
      branchStats.set(branch.id_branch, { contracts: 0, clients: new Set(), gwp: 0 });
    }
    const bs = branchStats.get(branch.id_branch);
    bs.contracts += 1;
    bs.clients.add(client.id);
    bs.gwp += premium;

    if (contractRowsBatch.length >= batchSize) {
      await flushBatches();
    }
  }
  await flushBatches();

  return {
    totalContracts: createdContracts,
    branchPremiumSums,
    brokerGwp,
    brokerContracts,
    brokerClientSet,
    branchStats,
  };
}

async function writeEligibility({
  scenario,
  clients,
  clientMeta,
  branchesByS2,
  batchSize = 1500,
}) {
  const rows = [];
  const branchSet = [
    branchesByS2["10"].id_branch,
    branchesByS2["13"].id_branch,
    branchesByS2["02"].id_branch,
    branchesByS2["08"].id_branch,
    branchesByS2["16"].id_branch,
  ];
  for (let i = 0; i < clients.length; i += 1) {
    const seg = clientMeta[i].segment;
    for (const idBranch of branchSet) {
      let status = "eligible";
      if (idBranch === branchesByS2["02"].id_branch && !["sante", "medical"].includes(seg)) {
        status = "conditional";
      }
      rows.push({
        client_id: clients[i].id,
        scenario_id: scenario.id,
        id_branch: idBranch,
        eligibility_status: status,
        reason_code: status === "conditional" ? "PROFILE_REVIEW" : null,
        max_limit: null,
      });
      if (rows.length >= batchSize) {
        await insertBatch(
          "client_branch_eligibility",
          ["client_id", "scenario_id", "id_branch", "eligibility_status", "reason_code", "max_limit"],
          rows.splice(0, rows.length)
        );
      }
    }
  }
  if (rows.length) {
    await insertBatch(
      "client_branch_eligibility",
      ["client_id", "scenario_id", "id_branch", "eligibility_status", "reason_code", "max_limit"],
      rows
    );
  }
}

async function writeSnapshots({
  scenario,
  runId,
  snapshotDate,
  captiveId,
  branchStats,
  brokerGwp,
  brokerContracts,
  brokerClientSet,
}) {
  const s2Cfg = await loadS2EnginePlaceholderConfig(scenario.id);
  let gwpTotal = 0;
  for (const v of brokerGwp.values()) gwpTotal += v;
  await pool.query(
    `INSERT INTO portfolio_snapshots
      (scenario_id, run_id, snapshot_date, captive_id, gwp_total, earned_premium_total, claims_paid_total, claims_incurred_total, rbns_total, ibnr_total, net_result_technical)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL)
     ON DUPLICATE KEY UPDATE
       gwp_total = VALUES(gwp_total),
       earned_premium_total = VALUES(earned_premium_total)`,
    [scenario.id, runId, snapshotDate, captiveId, gwpTotal, gwpTotal]
  );

  const pbsRows = [];
  for (const [idBranch, stats] of branchStats.entries()) {
    pbsRows.push({
      scenario_id: scenario.id,
      run_id: runId,
      snapshot_date: snapshotDate,
      id_branch: idBranch,
      contracts_count: stats.contracts,
      clients_count: stats.clients.size,
      gwp_gross: Math.round(stats.gwp * 100) / 100,
      gwp_net: Math.round(stats.gwp * 100) / 100,
      earned_gross: Math.round(stats.gwp * 100) / 100,
      earned_net: Math.round(stats.gwp * 100) / 100,
      paid_gross: 0,
      paid_net: 0,
      incurred_gross: 0,
      incurred_net: 0,
      rbns_gross: 0,
      ibnr_gross: 0,
      cat_loss_gross: 0,
    });
  }
  for (let i = 0; i < pbsRows.length; i += 100) {
    await insertBatch(
      "portfolio_branch_snapshots",
      [
        "scenario_id",
        "run_id",
        "snapshot_date",
        "id_branch",
        "contracts_count",
        "clients_count",
        "gwp_gross",
        "gwp_net",
        "earned_gross",
        "earned_net",
        "paid_gross",
        "paid_net",
        "incurred_gross",
        "incurred_net",
        "rbns_gross",
        "ibnr_gross",
        "cat_loss_gross",
      ],
      pbsRows.slice(i, i + 100)
    );
  }

  const brokerRows = [];
  const brokerEntries = Array.from(brokerGwp.entries()).map(([partnerId, gwp]) => ({
    partner_id: partnerId,
    gwp_amount: gwp,
    contracts_count: brokerContracts.get(partnerId) || 0,
    clients_count: brokerClientSet.get(partnerId)?.size || 0,
  }));
  brokerEntries.sort((a, b) => b.gwp_amount - a.gwp_amount);
  const total = gwpTotal || 1;
  for (let i = 0; i < brokerEntries.length; i += 1) {
    const e = brokerEntries[i];
    const share = e.gwp_amount / total;
    brokerRows.push({
      scenario_id: scenario.id,
      run_id: runId,
      snapshot_date: snapshotDate,
      partner_id: e.partner_id,
      rank_by_gwp: i + 1,
      gwp_amount: Math.round(e.gwp_amount * 100) / 100,
      gwp_share_pct: Number(share.toFixed(6)),
      contracts_count: e.contracts_count,
      clients_count: e.clients_count,
      hhi_contribution: Number((share * share).toFixed(8)),
    });
  }
  for (let i = 0; i < brokerRows.length; i += 500) {
    await insertBatch(
      "broker_concentration_snapshots",
      [
        "scenario_id",
        "run_id",
        "snapshot_date",
        "partner_id",
        "rank_by_gwp",
        "gwp_amount",
        "gwp_share_pct",
        "contracts_count",
        "clients_count",
        "hhi_contribution",
      ],
      brokerRows.slice(i, i + 500)
    );
  }

  await pool.query(
    `INSERT INTO s2_scr_results
      (scenario_id, run_id, snapshot_date, mcr, methodology_version)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mcr = VALUES(mcr), methodology_version = VALUES(methodology_version)`,
    [scenario.id, runId, snapshotDate, s2CfgNum(s2Cfg, "mcr_eur", 2700000), "v1-placeholder"]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioCode = String(args.scenario || "SIM_CAPTIVE_2028_BASE");
  const runLabel = String(args.run || `portfolio-v1-${Date.now()}`);
  const seed = Number(args.seed || 20280223);
  const rng = createRng(seed);

  let runId;
  try {
    const scenario = await ensureScenario(scenarioCode);
    const run = await createRun(scenario.id, runLabel, seed);
    runId = run;

    const programmesByCode = await ensureProgrammes(scenario.captive_id);
    const branchesByS2 = await getBranchIds(scenario.captive_id);

    const { partners, weights } = await generateBrokers({
      scenario,
      rng,
      brokerCount: Number(args.brokers || 1100),
    });
    await addCheck(runId, "BROKERS_CREATED", "info", "pass", "Courtiers synthétiques créés.", partners.length);

    const { clients, clientMeta } = await generateClients({
      scenario,
      rng,
      partners,
      partnerWeights: weights,
      clientCount: Number(args.clients || 85000),
    });
    await addCheck(runId, "CLIENTS_CREATED", "info", "pass", "Clients synthétiques créés.", clients.length);

    await writeEligibility({ scenario, clients, clientMeta, branchesByS2 });
    await addCheck(runId, "CLIENT_ELIGIBILITY_CREATED", "info", "pass", "Eligibilités par branche créées.");

    const contractResult = await generateContractsAndPremiums({
      scenario,
      runId,
      rng,
      clients,
      clientMeta,
      programmesByCode,
      branchesByS2,
    });
    await addCheck(
      runId,
      "CONTRACTS_CREATED",
      "info",
      "pass",
      "Contrats, couvertures et primes générés.",
      contractResult.totalContracts
    );

    const snapshotDate = `${Number(scenario.target_year || 2028)}-12-31`;
    await writeSnapshots({
      scenario,
      runId,
      snapshotDate,
      captiveId: scenario.captive_id,
      branchStats: contractResult.branchStats,
      brokerGwp: contractResult.brokerGwp,
      brokerContracts: contractResult.brokerContracts,
      brokerClientSet: contractResult.brokerClientSet,
    });
    await addCheck(runId, "SNAPSHOTS_CREATED", "info", "pass", "Snapshots portfolio/courtiers/S2 placeholder créés.");

    const [totals] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM partners) AS partners_count,
         (SELECT COUNT(*) FROM clients) AS clients_count,
         (SELECT COUNT(*) FROM contracts) AS contracts_count,
         (SELECT COALESCE(SUM(amount_gross),0) FROM premium_transactions WHERE run_id = ?) AS gwp_total`,
      [runId]
    );
    const t = totals[0];
    await addCheck(runId, "TOTALS_VALIDATED", "info", "pass", "Comptages et GWP calculés.");

    await finishRun(
      runId,
      "done",
      `Portfolio V1 généré: partners=${t.partners_count}, clients=${t.clients_count}, contracts=${t.contracts_count}, gwp=${t.gwp_total}`
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario_id: scenario.id,
          run_id: runId,
          totals: t,
          branch_gwp: contractResult.branchPremiumSums,
          next_steps: [
            "generate_claims_and_reserves",
            "apply_reinsurance_cessions",
            "compute_s2_inputs_non_life",
          ],
        },
        null,
        2
      )
    );
  } catch (err) {
    if (runId) await finishRun(runId, "failed", String(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
