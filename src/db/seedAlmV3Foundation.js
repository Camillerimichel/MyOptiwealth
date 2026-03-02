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

async function getDefaultCaptive() {
  const row = await q1(`SELECT id, code, name FROM captives WHERE status = 'active' ORDER BY id LIMIT 1`);
  if (!row) throw new Error("Aucune captive active trouvée");
  return row;
}

async function getLatestOrsaSet(captiveId) {
  return q1(
    `SELECT ors.id, ors.code, ors.snapshot_date, ors.scenario_id, ors.base_run_id
     FROM orsa_run_sets ors
     JOIN simulation_scenarios ss ON ss.id = ors.scenario_id
     WHERE ss.captive_id = ?
     ORDER BY ors.created_at DESC, ors.id DESC
     LIMIT 1`,
    [captiveId]
  );
}

async function ensureProfile({ captiveId, scenarioId, code, name }) {
  await pool.query(
    `INSERT INTO alm_v3_profiles (captive_id, scenario_id, code, name, status, is_default, base_currency, valuation_timezone)
     VALUES (?, ?, ?, ?, 'active', 1, 'EUR', 'Europe/Paris')
     ON DUPLICATE KEY UPDATE
       scenario_id = VALUES(scenario_id),
       name = VALUES(name),
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
    [captiveId, scenarioId || null, code, name]
  );
  return q1(`SELECT * FROM alm_v3_profiles WHERE captive_id = ? AND code = ?`, [captiveId, code]);
}

async function ensureStrata(profileId) {
  const defaults = [
    ["OPERATING_LIQ", "Trésorerie opérationnelle", "Encaissements / décaissements quotidiens", 1],
    ["CLAIMS_BUFFER", "Buffer sinistres", "Liquidité court terme pour paiements sinistres", 2],
    ["CORE_BONDS", "Noyau obligataire", "Portage de duration cœur", 3],
    ["LONG_TAIL_MATCH", "Matching long-tail", "Adossement PI / Medical", 4],
    ["RETURN_BUCKET", "Poche rendement", "Diversification / rendement", 5],
  ];
  for (const [code, label, purpose, order] of defaults) {
    await pool.query(
      `INSERT INTO alm_v3_strata (profile_id, strata_code, label, purpose, display_order, active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE label = VALUES(label), purpose = VALUES(purpose), display_order = VALUES(display_order), active = 1`,
      [profileId, code, label, purpose, order]
    );
  }
  const rows = await qa(`SELECT id, strata_code, label FROM alm_v3_strata WHERE profile_id = ?`, [profileId]);
  return Object.fromEntries(rows.map((r) => [r.strata_code, r]));
}

async function ensureDurationBuckets(profileId) {
  const defaults = [
    ["LT1", "< 1 an", 0, 1, 1],
    ["Y1_3", "1 à 3 ans", 1, 3, 2],
    ["Y3_7", "3 à 7 ans", 3, 7, 3],
    ["Y7P", "> 7 ans", 7, null, 4],
  ];
  for (const [code, label, min, max, order] of defaults) {
    await pool.query(
      `INSERT INTO alm_v3_duration_buckets (profile_id, bucket_code, label, min_years, max_years, display_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), min_years = VALUES(min_years), max_years = VALUES(max_years), display_order = VALUES(display_order)`,
      [profileId, code, label, min, max, order]
    );
  }
  const rows = await qa(`SELECT * FROM alm_v3_duration_buckets WHERE profile_id = ? ORDER BY display_order`, [profileId]);
  return Object.fromEntries(rows.map((r) => [r.bucket_code, r]));
}

async function ensureAssetClasses(profileId) {
  const defaults = [
    ["CASH", "Trésorerie / monétaire", "liquidity", 0.25, 30, 0.5, 1],
    ["BOND_ST", "Obligataire court terme", "fixed_income", 1.5, 90, 2.5, 2],
    ["BOND_MT", "Obligataire moyen terme", "fixed_income", 4.0, 180, 5.0, 3],
    ["BOND_LT", "Obligataire long terme", "fixed_income", 8.0, 365, 8.0, 4],
    ["DIVERS", "Actifs de rendement diversifiés", "diversified", 5.0, 270, 12.0, 5],
  ];
  for (const [code, label, family, dur, liq, vol, order] of defaults) {
    await pool.query(
      `INSERT INTO alm_v3_asset_classes
         (profile_id, asset_code, label, asset_family, default_duration_years, default_liquidity_days, default_volatility_pct, active, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         asset_family = VALUES(asset_family),
         default_duration_years = VALUES(default_duration_years),
         default_liquidity_days = VALUES(default_liquidity_days),
         default_volatility_pct = VALUES(default_volatility_pct),
         active = 1,
         display_order = VALUES(display_order)`,
      [profileId, code, label, family, dur, liq, vol, order]
    );
  }
  const rows = await qa(`SELECT * FROM alm_v3_asset_classes WHERE profile_id = ? ORDER BY display_order`, [profileId]);
  return Object.fromEntries(rows.map((r) => [r.asset_code, r]));
}

async function ensureCounterparties(profileId) {
  const defaults = [
    ["bank", "BANK_MAIN", "Banque principale ALM"],
    ["custodian", "CUSTODY_MAIN", "Dépositaire principal"],
    ["issuer", "FR_TRESOR", "État français / Trésor"],
    ["issuer", "CORP_INVEST_A", "Émetteur corporate investment grade A"],
    ["fund_manager", "FM_DIVERS_A", "Société de gestion fonds diversifiés A"],
  ];
  for (const [type, code, name] of defaults) {
    await pool.query(
      `INSERT INTO alm_v3_counterparties (profile_id, counterparty_type, code, name, active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), active = 1`,
      [profileId, type, code, name]
    );
  }

  // Mirror insurers into ALM counterparties (useful for fronting / reinsurance cashflow attribution)
  const insurers = await qa(`SELECT id, name FROM insurers ORDER BY id`);
  for (const ins of insurers) {
    const upper = String(ins.name || "").toUpperCase();
    const type = upper.includes("FRONTING") ? "fronting_insurer" : upper.includes("REINSURER") ? "reinsurer" : "other";
    const code = `INS_${ins.id}`;
    await pool.query(
      `INSERT INTO alm_v3_counterparties (profile_id, counterparty_type, code, name, active, metadata_json)
       VALUES (?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), counterparty_type = VALUES(counterparty_type), active = 1, metadata_json = VALUES(metadata_json)`,
      [profileId, type, code, ins.name, JSON.stringify({ insurer_id: ins.id })]
    );
  }

  const rows = await qa(`SELECT * FROM alm_v3_counterparties WHERE profile_id = ?`, [profileId]);
  return Object.fromEntries(rows.map((r) => [r.code, r]));
}

async function ensureCashAccounts(profileId, strataByCode, cpByCode) {
  const defaults = [
    ["CASH_OP_MAIN", "Compte opérationnel principal", "OPERATING_LIQ", "operating", "BANK_MAIN", 1],
    ["CASH_CLAIMS", "Compte de règlements sinistres", "CLAIMS_BUFFER", "claims", "BANK_MAIN", 1],
    ["CASH_FRONTING", "Compte flux fronting", "OPERATING_LIQ", "fronting", "BANK_MAIN", 1],
    ["CASH_REINS", "Compte flux réassurance", "OPERATING_LIQ", "reinsurance", "BANK_MAIN", 1],
    ["CASH_INVEST", "Compte d'investissement", "CORE_BONDS", "investment", "BANK_MAIN", 1],
  ];
  for (const [code, label, strataCode, accountType, bankCode, active] of defaults) {
    await pool.query(
      `INSERT INTO alm_v3_cash_accounts (profile_id, strata_id, account_code, label, currency, bank_counterparty_id, account_type, active)
       VALUES (?, ?, ?, ?, 'EUR', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         strata_id = VALUES(strata_id),
         label = VALUES(label),
         bank_counterparty_id = VALUES(bank_counterparty_id),
         account_type = VALUES(account_type),
         active = VALUES(active)`,
      [profileId, strataByCode[strataCode]?.id || null, code, label, cpByCode[bankCode]?.id || null, accountType, active]
    );
  }
  const rows = await qa(`SELECT * FROM alm_v3_cash_accounts WHERE profile_id = ?`, [profileId]);
  return Object.fromEntries(rows.map((r) => [r.account_code, r]));
}

async function ensureInstrumentsAndPositions({
  profile,
  businessDate,
  assetByCode,
  strataByCode,
  cpByCode,
  orsaSet,
  resetValuationOnly,
}) {
  const v2Result = orsaSet
    ? await q1(
        `SELECT * FROM alm_v2_results
         WHERE orsa_set_id = ?
         ORDER BY generated_at DESC, id DESC
         LIMIT 1`,
        [orsaSet.id]
      )
    : null;
  const v2Rows = v2Result
    ? await qa(`SELECT * FROM alm_v2_result_asset_classes WHERE result_id = ? ORDER BY id`, [v2Result.id])
    : [];

  const v2ByCode = Object.fromEntries(v2Rows.map((r) => [String(r.asset_code || ""), r]));

  const instrumentTemplates = [
    {
      instrument_code: "ALM_CASH_POOL_EUR",
      instrument_name: "Pool monétaire EUR",
      instrument_type: "cash",
      asset_code: "CASH",
      issuer_code: "BANK_MAIN",
      maturity_date: null,
      coupon_rate_pct: null,
      strata_code: "OPERATING_LIQ",
      portfolio_code: "ALM_LIQ_CORE",
      price: 100,
    },
    {
      instrument_code: "ALM_OAT_2028_1Y",
      instrument_name: "OAT courte échéance simulée",
      instrument_type: "bond_fixed",
      asset_code: "BOND_ST",
      issuer_code: "FR_TRESOR",
      maturity_date: "2027-12-31",
      coupon_rate_pct: 2.1,
      strata_code: "CORE_BONDS",
      portfolio_code: "ALM_FI_ST",
      price: 100.2,
    },
    {
      instrument_code: "ALM_CORP_2030_MT",
      instrument_name: "Obligation corporate MT simulée",
      instrument_type: "bond_fixed",
      asset_code: "BOND_MT",
      issuer_code: "CORP_INVEST_A",
      maturity_date: "2030-12-31",
      coupon_rate_pct: 3.15,
      strata_code: "CORE_BONDS",
      portfolio_code: "ALM_FI_MT",
      price: 99.4,
    },
    {
      instrument_code: "ALM_OAT_2036_LT",
      instrument_name: "OAT long terme simulée",
      instrument_type: "bond_fixed",
      asset_code: "BOND_LT",
      issuer_code: "FR_TRESOR",
      maturity_date: "2036-12-31",
      coupon_rate_pct: 3.0,
      strata_code: "LONG_TAIL_MATCH",
      portfolio_code: "ALM_FI_LT",
      price: 97.8,
    },
    {
      instrument_code: "ALM_FUND_DIVERS_A",
      instrument_name: "Fonds diversifié rendement A",
      instrument_type: "fund",
      asset_code: "DIVERS",
      issuer_code: "FM_DIVERS_A",
      maturity_date: null,
      coupon_rate_pct: null,
      strata_code: "RETURN_BUCKET",
      portfolio_code: "ALM_RETURN",
      price: 103.5,
    },
  ];

  const seeded = [];

  for (const t of instrumentTemplates) {
    const asset = assetByCode[t.asset_code];
    if (!asset) continue;
    await pool.query(
      `INSERT INTO alm_v3_instruments
         (profile_id, instrument_code, instrument_name, instrument_type, asset_class_id, issuer_counterparty_id, currency, issue_date, maturity_date, coupon_rate_pct, coupon_frequency, default_duration_years, active)
       VALUES (?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         instrument_name = VALUES(instrument_name),
         instrument_type = VALUES(instrument_type),
         asset_class_id = VALUES(asset_class_id),
         issuer_counterparty_id = VALUES(issuer_counterparty_id),
         maturity_date = VALUES(maturity_date),
         coupon_rate_pct = VALUES(coupon_rate_pct),
         default_duration_years = VALUES(default_duration_years),
         active = 1`,
      [
        profile.id,
        t.instrument_code,
        t.instrument_name,
        t.instrument_type,
        asset.id,
        cpByCode[t.issuer_code]?.id || null,
        "2026-01-01",
        t.maturity_date,
        t.coupon_rate_pct,
        t.coupon_rate_pct == null ? null : "ANNUAL",
        asset.default_duration_years,
      ]
    );

    const instrument = await q1(
      `SELECT * FROM alm_v3_instruments WHERE profile_id = ? AND instrument_code = ?`,
      [profile.id, t.instrument_code]
    );

    let position = await q1(
      `SELECT * FROM alm_v3_positions WHERE profile_id = ? AND instrument_id = ? AND portfolio_code = ? LIMIT 1`,
      [profile.id, instrument.id, t.portfolio_code]
    );
    if (!position) {
      const [insPos] = await pool.query(
        `INSERT INTO alm_v3_positions
           (profile_id, strata_id, instrument_id, portfolio_code, position_status, opened_on, accounting_classification, book_currency)
         VALUES (?, ?, ?, ?, 'active', ?, 'FAIR_VALUE', 'EUR')`,
        [profile.id, strataByCode[t.strata_code]?.id || null, instrument.id, t.portfolio_code, businessDate]
      );
      position = await q1(`SELECT * FROM alm_v3_positions WHERE id = ?`, [insPos.insertId]);
    }

    let lot = await q1(
      `SELECT * FROM alm_v3_position_lots WHERE position_id = ? ORDER BY id ASC LIMIT 1`,
      [position.id]
    );
    const v2Alloc = v2ByCode[t.asset_code];
    const allocAmount = Number(v2Alloc?.allocated_own_funds_amount || 0);
    const defaultNotionalByAsset = {
      CASH: 8_000_000,
      BOND_ST: 12_000_000,
      BOND_MT: 10_000_000,
      BOND_LT: 6_000_000,
      DIVERS: 4_000_000,
    };
    const marketValue = allocAmount > 0 ? allocAmount : defaultNotionalByAsset[t.asset_code] || 1_000_000;
    const quantity = t.price > 0 ? marketValue / t.price : marketValue;

    if (!lot) {
      await pool.query(
        `INSERT INTO alm_v3_position_lots
           (position_id, lot_code, trade_date, settlement_date, quantity, nominal_amount, unit_cost, transaction_currency, source_system, source_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'EUR', 'SIM', ?)`,
        [
          position.id,
          `${t.instrument_code}_LOT1`,
          businessDate,
          businessDate,
          Number(quantity.toFixed(6)),
          Number(marketValue.toFixed(2)),
          Number(t.price.toFixed(6)),
          `seed-${profile.code}`,
        ]
      );
    }

    if (resetValuationOnly) {
      await pool.query(
        `DELETE FROM alm_v3_position_valuations_daily WHERE position_id = ? AND business_date = ?`,
        [position.id, businessDate]
      );
    }

    await pool.query(
      `INSERT INTO alm_v3_position_valuations_daily
         (profile_id, position_id, business_date, valuation_timestamp, quantity_eod, dirty_price_pct, clean_price_pct, market_value_amount, book_value_amount,
          accrued_interest_amount, unrealized_pnl_amount, fx_rate_to_base, modified_duration_years, macaulay_duration_years, ytm_pct, source_system, source_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'SIM', ?)
       ON DUPLICATE KEY UPDATE
         valuation_timestamp = VALUES(valuation_timestamp),
         quantity_eod = VALUES(quantity_eod),
         dirty_price_pct = VALUES(dirty_price_pct),
         clean_price_pct = VALUES(clean_price_pct),
         market_value_amount = VALUES(market_value_amount),
         book_value_amount = VALUES(book_value_amount),
         accrued_interest_amount = VALUES(accrued_interest_amount),
         unrealized_pnl_amount = VALUES(unrealized_pnl_amount),
         modified_duration_years = VALUES(modified_duration_years),
         macaulay_duration_years = VALUES(macaulay_duration_years),
         ytm_pct = VALUES(ytm_pct),
         source_ref = VALUES(source_ref)`,
      [
        profile.id,
        position.id,
        businessDate,
        `${businessDate} 23:59:59`,
        Number(quantity.toFixed(6)),
        Number(t.price.toFixed(6)),
        Number(t.price.toFixed(6)),
        Number(marketValue.toFixed(2)),
        Number((marketValue * 0.995).toFixed(2)),
        t.instrument_type.startsWith("bond") ? Number((marketValue * 0.003).toFixed(2)) : 0,
        Number((marketValue * 0.005).toFixed(2)),
        Number(asset.default_duration_years || 0),
        Number((asset.default_duration_years || 0) * 1.05),
        t.instrument_type.startsWith("bond") ? Number((t.coupon_rate_pct || 2.5).toFixed(4)) : null,
        `seed-val-${profile.code}-${businessDate}`,
      ]
    );

    seeded.push({
      instrument_code: t.instrument_code,
      asset_code: t.asset_code,
      position_id: position.id,
      market_value_amount: Number(marketValue.toFixed(2)),
    });
  }

  return seeded;
}

async function ensureOrsaLink(profileId, orsaSetId) {
  if (!orsaSetId) return;
  await pool.query(
    `INSERT INTO alm_v3_orsa_links (profile_id, orsa_set_id, link_role, active)
     VALUES (?, ?, 'comparison', 1)
     ON DUPLICATE KEY UPDATE active = 1`,
    [profileId, orsaSetId]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const profileCode = String(args["profile-code"] || "ALM_V3_DEFAULT");
  const profileName = String(args["profile-name"] || "ALM V3 - fondation");
  const businessDate = String(args["business-date"] || "2026-12-31");
  const requestedOrsaSetId = args["orsa-set-id"] ? Number(args["orsa-set-id"]) : null;
  const resetValuationOnly = !!args["reset-valuation-only"];

  try {
    const captive = await getDefaultCaptive();
    const orsaSet = requestedOrsaSetId
      ? await q1(`SELECT id, code, snapshot_date, scenario_id, base_run_id FROM orsa_run_sets WHERE id = ?`, [requestedOrsaSetId])
      : await getLatestOrsaSet(captive.id);

    const profile = await ensureProfile({
      captiveId: captive.id,
      scenarioId: orsaSet?.scenario_id || null,
      code: profileCode,
      name: profileName,
    });

    const strataByCode = await ensureStrata(profile.id);
    await ensureDurationBuckets(profile.id);
    const assetByCode = await ensureAssetClasses(profile.id);
    const cpByCode = await ensureCounterparties(profile.id);
    const cashByCode = await ensureCashAccounts(profile.id, strataByCode, cpByCode);
    const seededPositions = await ensureInstrumentsAndPositions({
      profile,
      businessDate,
      assetByCode,
      strataByCode,
      cpByCode,
      orsaSet,
      resetValuationOnly,
    });
    await ensureOrsaLink(profile.id, orsaSet?.id || null);

    console.log(
      JSON.stringify(
        {
          ok: true,
          profile: { id: profile.id, code: profile.code, name: profile.name },
          orsa_set: orsaSet ? { id: orsaSet.id, code: orsaSet.code, snapshot_date: orsaSet.snapshot_date } : null,
          business_date: businessDate,
          counts: {
            strata: Object.keys(strataByCode).length,
            asset_classes: Object.keys(assetByCode).length,
            counterparties: Object.keys(cpByCode).length,
            cash_accounts: Object.keys(cashByCode).length,
            seeded_positions: seededPositions.length,
          },
          positions_seeded: seededPositions,
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
