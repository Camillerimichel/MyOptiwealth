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

function sqlDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
async function qa(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function resolveProfile(args) {
  if (args["profile-id"]) {
    const row = await q1(`SELECT * FROM alm_v3_profiles WHERE id = ?`, [Number(args["profile-id"])]);
    if (!row) throw new Error(`Profil ALM V3 introuvable: ${args["profile-id"]}`);
    return row;
  }
  const code = String(args["profile-code"] || "ALM_V3_DEFAULT");
  const row = await q1(`SELECT * FROM alm_v3_profiles WHERE code = ? ORDER BY id DESC LIMIT 1`, [code]);
  if (!row) throw new Error(`Profil ALM V3 introuvable pour code=${code}`);
  return row;
}

function defaultDateRange() {
  return { from: "2026-01-01", to: "2026-12-31" };
}

async function resolveCashAccounts(profileId) {
  const rows = await qa(
    `SELECT id, account_code, account_type
     FROM alm_v3_cash_accounts
     WHERE profile_id = ? AND active = 1`,
    [profileId]
  );
  const byType = {};
  const byCode = {};
  for (const r of rows) {
    byCode[r.account_code] = r;
    if (!byType[r.account_type]) byType[r.account_type] = r;
  }
  return { byType, byCode, rows };
}

async function resolveCounterpartyByInsurer(profileId) {
  const rows = await qa(
    `SELECT id, code, counterparty_type, metadata_json
     FROM alm_v3_counterparties
     WHERE profile_id = ?`,
    [profileId]
  );
  const map = new Map();
  for (const r of rows) {
    let meta = null;
    try {
      meta = r.metadata_json ? JSON.parse(r.metadata_json) : null;
    } catch {
      meta = null;
    }
    if (meta?.insurer_id != null) map.set(Number(meta.insurer_id), r);
  }
  return map;
}

async function clearRange(profileId, dateFrom, dateTo) {
  await pool.query(
    `DELETE FROM alm_v3_cash_movements WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
    [profileId, dateFrom, dateTo]
  );
  await pool.query(
    `DELETE FROM alm_v3_liability_cashflows_daily WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
    [profileId, dateFrom, dateTo]
  );
}

async function insertPremiumInflows({ profile, dateFrom, dateTo, cashAccounts }) {
  const cashAccount = cashAccounts.byType.operating || cashAccounts.byCode.CASH_OP_MAIN || null;
  const [resLiab] = await pool.query(
    `INSERT INTO alm_v3_liability_cashflows_daily
       (profile_id, business_date, event_timestamp, cashflow_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
        id_branch, programme_id, contract_id, partner_id, client_id, source_table, source_pk, source_ref, comment_text)
     SELECT
       ? AS profile_id,
       cpp.paid_on AS business_date,
       CAST(CONCAT(cpp.paid_on, ' 12:00:00') AS DATETIME) AS event_timestamp,
       'premium_in' AS cashflow_type,
       'in' AS direction,
       cpp.amount AS amount_amount,
       COALESCE(cpp.currency,'EUR') AS currency,
       cpp.amount AS amount_base_ccy,
       1 AS fx_rate_to_base,
       cc.id_branch,
       c.programme_id,
       c.id AS contract_id,
       c.partner_id,
       c.client_id,
       'contract_premium_payments' AS source_table,
       cpp.id AS source_pk,
       cpp.reference AS source_ref,
       COALESCE(cpp.notes, 'Encaissement prime') AS comment_text
     FROM contract_premium_payments cpp
     JOIN contracts c ON c.id = cpp.contract_id
     LEFT JOIN (
       SELECT contract_id, MIN(id_branch) AS id_branch
       FROM contract_coverages
       GROUP BY contract_id
     ) cc ON cc.contract_id = c.id
     WHERE cpp.paid_on BETWEEN ? AND ?`,
    [profile.id, dateFrom, dateTo]
  );

  let resCash = { affectedRows: 0 };
  if (cashAccount) {
    [resCash] = await pool.query(
      `INSERT INTO alm_v3_cash_movements
         (profile_id, cash_account_id, business_date, event_timestamp, movement_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
          source_entity, source_entity_id, source_ref, comment_text)
       SELECT
         ?,
         ?,
         cpp.paid_on,
         CAST(CONCAT(cpp.paid_on, ' 12:00:00') AS DATETIME),
         'premium_in',
         'in',
         cpp.amount,
         COALESCE(cpp.currency,'EUR'),
         cpp.amount,
         1,
         'contract_premium_payments',
         cpp.id,
         cpp.reference,
         COALESCE(cpp.notes, 'Encaissement prime')
       FROM contract_premium_payments cpp
       WHERE cpp.paid_on BETWEEN ? AND ?`,
      [profile.id, cashAccount.id, dateFrom, dateTo]
    );
  }

  return { liability_rows: resLiab.affectedRows || 0, cash_rows: resCash.affectedRows || 0 };
}

async function insertClaimOutflows({ profile, dateFrom, dateTo, cashAccounts }) {
  const cashAccount = cashAccounts.byType.claims || cashAccounts.byCode.CASH_CLAIMS || cashAccounts.byType.operating || null;
  const [resLiab] = await pool.query(
    `INSERT INTO alm_v3_liability_cashflows_daily
       (profile_id, business_date, event_timestamp, cashflow_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
        id_branch, programme_id, contract_id, partner_id, client_id, sinistre_id, sinistre_ligne_id, reglement_id,
        source_table, source_pk, source_ref, comment_text)
     SELECT
       ?,
       r.date,
       CAST(CONCAT(r.date, ' 12:00:00') AS DATETIME),
       'claim_paid_out',
       'out',
       r.montant,
       'EUR',
       r.montant,
       1,
       sl.id_branch,
       s.programme_id,
       NULL AS contract_id,
       NULL AS partner_id,
       NULL AS client_id,
       s.id,
       r.sinistre_ligne_id,
       r.id,
       'reglements',
       r.id,
       CONCAT('REG-', r.id),
       'Paiement sinistre'
     FROM reglements r
     JOIN sinistres s ON s.id = r.sinistre_id
     LEFT JOIN sinistre_lignes sl ON sl.id = r.sinistre_ligne_id
     WHERE r.date BETWEEN ? AND ?`,
    [profile.id, dateFrom, dateTo]
  );

  let resCash = { affectedRows: 0 };
  if (cashAccount) {
    [resCash] = await pool.query(
      `INSERT INTO alm_v3_cash_movements
         (profile_id, cash_account_id, business_date, event_timestamp, movement_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
          source_entity, source_entity_id, source_ref, comment_text)
       SELECT
         ?,
         ?,
         r.date,
         CAST(CONCAT(r.date, ' 12:00:00') AS DATETIME),
         'claim_out',
         'out',
         r.montant,
         'EUR',
         r.montant,
         1,
         'reglements',
         r.id,
         CONCAT('REG-', r.id),
         'Paiement sinistre'
       FROM reglements r
       WHERE r.date BETWEEN ? AND ?`,
      [profile.id, cashAccount.id, dateFrom, dateTo]
    );
  }
  return { liability_rows: resLiab.affectedRows || 0, cash_rows: resCash.affectedRows || 0 };
}

async function insertReinsuranceFlows({ profile, dateFrom, dateTo, cashAccounts, cpByInsurer }) {
  const reinsCash = cashAccounts.byType.reinsurance || cashAccounts.byCode.CASH_REINS || cashAccounts.byType.operating || null;

  const [resPremLiab] = await pool.query(
    `INSERT INTO alm_v3_liability_cashflows_daily
       (profile_id, business_date, event_timestamp, cashflow_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
        id_branch, programme_id, contract_id, treaty_id, source_table, source_pk, source_ref, comment_text)
     SELECT
       ?,
       rpc.accounting_date,
       CAST(CONCAT(rpc.accounting_date, ' 12:00:00') AS DATETIME),
       'reinsurance_premium_out',
       'out',
       COALESCE(rpc.net_cost, rpc.amount_ceded),
       'EUR',
       COALESCE(rpc.net_cost, rpc.amount_ceded),
       1,
       cc.id_branch,
       c.programme_id,
       c.id,
       rpc.treaty_id,
       'reinsurance_premium_cessions',
       rpc.id,
       rt.code,
       CONCAT('Prime réassurance ', rt.treaty_type)
     FROM reinsurance_premium_cessions rpc
     JOIN reinsurance_treaties rt ON rt.id = rpc.treaty_id
     JOIN premium_transactions pt ON pt.id = rpc.premium_transaction_id
     JOIN contracts c ON c.id = pt.contract_id
     LEFT JOIN (
       SELECT contract_id, MIN(id_branch) AS id_branch
       FROM contract_coverages
       GROUP BY contract_id
     ) cc ON cc.contract_id = c.id
     WHERE rpc.accounting_date BETWEEN ? AND ?`,
    [profile.id, dateFrom, dateTo]
  );

  let resPremCash = { affectedRows: 0 };
  if (reinsCash) {
    [resPremCash] = await pool.query(
      `INSERT INTO alm_v3_cash_movements
         (profile_id, cash_account_id, business_date, event_timestamp, movement_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
          counterparty_id, source_entity, source_entity_id, source_ref, comment_text)
       SELECT
         ?,
         ?,
         rpc.accounting_date,
         CAST(CONCAT(rpc.accounting_date, ' 12:00:00') AS DATETIME),
         'reinsurance_out',
         'out',
         COALESCE(rpc.net_cost, rpc.amount_ceded),
         'EUR',
         COALESCE(rpc.net_cost, rpc.amount_ceded),
         1,
         NULL,
         'reinsurance_premium_cessions',
         rpc.id,
         rt.code,
         CONCAT('Prime réassurance ', rt.treaty_type)
       FROM reinsurance_premium_cessions rpc
       JOIN reinsurance_treaties rt ON rt.id = rpc.treaty_id
       WHERE rpc.accounting_date BETWEEN ? AND ?`,
      [profile.id, reinsCash.id, dateFrom, dateTo]
    );
  }

  // Claims recoveries / paid cessions treated as cash inflows (RESERVE is non-cash -> excluded)
  const claimCessions = await qa(
    `SELECT rcc.id, rcc.event_date, rcc.amount_ceded, rcc.cession_type, rcc.treaty_id,
            rcc.sinistre_id, rcc.sinistre_ligne_id, rt.code AS treaty_code, rt.counterparty_insurer_id,
            sl.id_branch, s.programme_id
     FROM reinsurance_claim_cessions rcc
     JOIN reinsurance_treaties rt ON rt.id = rcc.treaty_id
     JOIN sinistres s ON s.id = rcc.sinistre_id
     LEFT JOIN sinistre_lignes sl ON sl.id = rcc.sinistre_ligne_id
     WHERE rcc.event_date BETWEEN ? AND ?
       AND rcc.cession_type IN ('PAID','RECOVERY')`,
    [dateFrom, dateTo]
  );

  let liabCount = 0;
  let cashCount = 0;
  for (const row of claimCessions) {
    const eventDate = sqlDate(row.event_date);
    await pool.query(
      `INSERT INTO alm_v3_liability_cashflows_daily
         (profile_id, business_date, event_timestamp, cashflow_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
          id_branch, programme_id, sinistre_id, sinistre_ligne_id, treaty_id, source_table, source_pk, source_ref, comment_text)
       VALUES (?, ?, ?, 'reinsurance_recovery_in', 'in', ?, 'EUR', ?, 1, ?, ?, ?, ?, ?, 'reinsurance_claim_cessions', ?, ?, ?)`,
      [
        profile.id,
        eventDate,
        `${eventDate} 12:00:00`,
        row.amount_ceded,
        row.amount_ceded,
        row.id_branch || null,
        row.programme_id || null,
        row.sinistre_id,
        row.sinistre_ligne_id || null,
        row.treaty_id,
        row.id,
        row.treaty_code,
        `Recovery réassurance (${row.cession_type})`,
      ]
    );
    liabCount += 1;

    if (reinsCash) {
      const cp = cpByInsurer.get(Number(row.counterparty_insurer_id)) || null;
      await pool.query(
        `INSERT INTO alm_v3_cash_movements
           (profile_id, cash_account_id, business_date, event_timestamp, movement_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
            counterparty_id, source_entity, source_entity_id, source_ref, comment_text)
         VALUES (?, ?, ?, ?, 'reinsurance_in', 'in', ?, 'EUR', ?, 1, ?, 'reinsurance_claim_cessions', ?, ?, ?)`,
        [
            profile.id,
            reinsCash.id,
            eventDate,
            `${eventDate} 12:00:00`,
          row.amount_ceded,
          row.amount_ceded,
          cp?.id || null,
          row.id,
          row.treaty_code,
          `Recovery réassurance (${row.cession_type})`,
        ]
      );
      cashCount += 1;
    }
  }

  return {
    reinsurance_premium_out_liability_rows: resPremLiab.affectedRows || 0,
    reinsurance_premium_out_cash_rows: resPremCash.affectedRows || 0,
    reinsurance_recovery_liability_rows: liabCount,
    reinsurance_recovery_cash_rows: cashCount,
  };
}

async function insertFrontingFeeFlows({ profile, dateFrom, dateTo, cashAccounts, cpByInsurer }) {
  const frontingCash = cashAccounts.byType.fronting || cashAccounts.byCode.CASH_FRONTING || cashAccounts.byType.operating || null;

  const rows = await qa(
    `SELECT fra.id, fra.snapshot_date, fra.id_branch, fra.fronting_fee_amount, fra.claims_handling_fee_amount,
            fp.primary_fronting_insurer_id, fp.secondary_fronting_insurer_id, fp.run_id
     FROM fronting_run_adjustments fra
     JOIN fronting_programs fp ON fp.id = fra.fronting_program_id
     WHERE fra.snapshot_date BETWEEN ? AND ?
       AND (COALESCE(fra.fronting_fee_amount,0) <> 0 OR COALESCE(fra.claims_handling_fee_amount,0) <> 0)`,
    [dateFrom, dateTo]
  ).catch(() => []);

  let liabRows = 0;
  let cashRows = 0;

  for (const r of rows) {
    const snapshotDate = sqlDate(r.snapshot_date);
    if (Number(r.fronting_fee_amount || 0) > 0) {
      await pool.query(
        `INSERT INTO alm_v3_liability_cashflows_daily
           (profile_id, business_date, event_timestamp, cashflow_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
            id_branch, source_table, source_pk, source_ref, comment_text)
         VALUES (?, ?, ?, 'fronting_fee_out', 'out', ?, 'EUR', ?, 1, ?, 'fronting_run_adjustments', ?, ?, ?)`,
        [
          profile.id,
          snapshotDate,
          `${snapshotDate} 12:00:00`,
          r.fronting_fee_amount,
          r.fronting_fee_amount,
          r.id_branch || null,
          r.id,
          `FRA-${r.id}`,
          `Frais fronting (run ${r.run_id})`,
        ]
      );
      liabRows += 1;
      if (frontingCash) {
        const cp = cpByInsurer.get(Number(r.primary_fronting_insurer_id)) || null;
        await pool.query(
          `INSERT INTO alm_v3_cash_movements
             (profile_id, cash_account_id, business_date, event_timestamp, movement_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
              counterparty_id, source_entity, source_entity_id, source_ref, comment_text)
           VALUES (?, ?, ?, ?, 'fronting_fee_out', 'out', ?, 'EUR', ?, 1, ?, 'fronting_run_adjustments', ?, ?, ?)`,
          [
            profile.id,
            frontingCash.id,
            snapshotDate,
            `${snapshotDate} 12:00:00`,
            r.fronting_fee_amount,
            r.fronting_fee_amount,
            cp?.id || null,
            r.id,
            `FRA-${r.id}`,
            `Frais fronting (run ${r.run_id})`,
          ]
        );
        cashRows += 1;
      }
    }

    if (Number(r.claims_handling_fee_amount || 0) > 0) {
      await pool.query(
        `INSERT INTO alm_v3_liability_cashflows_daily
           (profile_id, business_date, event_timestamp, cashflow_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
            id_branch, source_table, source_pk, source_ref, comment_text)
         VALUES (?, ?, ?, 'claims_handling_fee_out', 'out', ?, 'EUR', ?, 1, ?, 'fronting_run_adjustments', ?, ?, ?)`,
        [
          profile.id,
          snapshotDate,
          `${snapshotDate} 12:05:00`,
          r.claims_handling_fee_amount,
          r.claims_handling_fee_amount,
          r.id_branch || null,
          r.id,
          `FRA-${r.id}`,
          `Frais gestion sinistres fronting (run ${r.run_id})`,
        ]
      );
      liabRows += 1;
      if (frontingCash) {
        const cp = cpByInsurer.get(Number(r.primary_fronting_insurer_id)) || null;
        await pool.query(
          `INSERT INTO alm_v3_cash_movements
             (profile_id, cash_account_id, business_date, event_timestamp, movement_type, direction, amount_amount, currency, amount_base_ccy, fx_rate_to_base,
              counterparty_id, source_entity, source_entity_id, source_ref, comment_text)
           VALUES (?, ?, ?, ?, 'fronting_fee_out', 'out', ?, 'EUR', ?, 1, ?, 'fronting_run_adjustments', ?, ?, ?)`,
          [
            profile.id,
            frontingCash.id,
            snapshotDate,
            `${snapshotDate} 12:05:00`,
            r.claims_handling_fee_amount,
            r.claims_handling_fee_amount,
            cp?.id || null,
            r.id,
            `FRA-${r.id}`,
            `Frais gestion sinistres fronting (run ${r.run_id})`,
          ]
        );
        cashRows += 1;
      }
    }
  }

  return { fronting_liability_rows: liabRows, fronting_cash_rows: cashRows };
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = await resolveProfile(args);
  const defaults = defaultDateRange();
  const dateFrom = String(args["date-from"] || defaults.from);
  const dateTo = String(args["date-to"] || defaults.to);
  const replace = args.replace !== "false";

  try {
    const cashAccounts = await resolveCashAccounts(profile.id);
    const cpByInsurer = await resolveCounterpartyByInsurer(profile.id);

    if (replace) {
      await clearRange(profile.id, dateFrom, dateTo);
    }

    const premium = await insertPremiumInflows({ profile, dateFrom, dateTo, cashAccounts });
    const claims = await insertClaimOutflows({ profile, dateFrom, dateTo, cashAccounts });
    const reinsurance = await insertReinsuranceFlows({ profile, dateFrom, dateTo, cashAccounts, cpByInsurer });
    const fronting = await insertFrontingFeeFlows({ profile, dateFrom, dateTo, cashAccounts, cpByInsurer });

    const totals = await q1(
      `SELECT
         COUNT(*) AS rows_count,
         SUM(CASE WHEN direction='in' THEN amount_base_ccy ELSE 0 END) AS inflows,
         SUM(CASE WHEN direction='out' THEN amount_base_ccy ELSE 0 END) AS outflows
       FROM alm_v3_liability_cashflows_daily
       WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
      [profile.id, dateFrom, dateTo]
    );

    const cashTotals = await q1(
      `SELECT
         COUNT(*) AS rows_count,
         SUM(CASE WHEN direction='in' THEN amount_base_ccy ELSE 0 END) AS inflows,
         SUM(CASE WHEN direction='out' THEN amount_base_ccy ELSE 0 END) AS outflows
       FROM alm_v3_cash_movements
       WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
      [profile.id, dateFrom, dateTo]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          profile: { id: profile.id, code: profile.code, name: profile.name },
          range: { date_from: dateFrom, date_to: dateTo, replace },
          inserted: {
            premium,
            claims,
            reinsurance,
            fronting,
          },
          liability_cashflows_summary: totals,
          cash_movements_summary: cashTotals,
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
