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

async function shiftYear(table, column, fromYear, toYear) {
  const [res] = await pool.query(
    `UPDATE ${table}
     SET ${column} = DATE_SUB(${column}, INTERVAL ? YEAR)
     WHERE ${column} IS NOT NULL
       AND YEAR(${column}) = ?`,
    [fromYear - toYear, fromYear]
  );
  return res.affectedRows || 0;
}

async function rangeFor(table, column) {
  return q1(`SELECT MIN(${column}) AS min_d, MAX(${column}) AS max_d, COUNT(*) AS n FROM ${table}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const fromYear = Number(args["from-year"] || 2028);
  const toYear = Number(args["to-year"] || 2026);
  const includeTrailingYear = args["include-trailing-year"] !== "false"; // shift 2029->2027 too, etc.

  const updates = [];

  try {
    // Primary ALM source flows
    updates.push({ table: "contract_premium_payments", column: "paid_on", rows: await shiftYear("contract_premium_payments", "paid_on", fromYear, toYear) });
    updates.push({ table: "reglements", column: "date", rows: await shiftYear("reglements", "date", fromYear, toYear) });
    updates.push({ table: "reinsurance_premium_cessions", column: "accounting_date", rows: await shiftYear("reinsurance_premium_cessions", "accounting_date", fromYear, toYear) });
    updates.push({ table: "reinsurance_claim_cessions", column: "event_date", rows: await shiftYear("reinsurance_claim_cessions", "event_date", fromYear, toYear) });
    updates.push({ table: "fronting_run_adjustments", column: "snapshot_date", rows: await shiftYear("fronting_run_adjustments", "snapshot_date", fromYear, toYear) });

    // Useful consistency shifts for simulation premium/accounting dates and claim dating
    updates.push({ table: "premium_transactions", column: "accounting_date", rows: await shiftYear("premium_transactions", "accounting_date", fromYear, toYear) });
    updates.push({ table: "premium_transactions", column: "effective_date", rows: await shiftYear("premium_transactions", "effective_date", fromYear, toYear) });
    updates.push({ table: "sinistres", column: "date_survenue", rows: await shiftYear("sinistres", "date_survenue", fromYear, toYear) });
    updates.push({ table: "sinistres", column: "date_decl", rows: await shiftYear("sinistres", "date_decl", fromYear, toYear) });
    updates.push({ table: "claim_reserve_snapshots", column: "snapshot_date", rows: await shiftYear("claim_reserve_snapshots", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "cat_events", column: "event_date", rows: await shiftYear("cat_events", "event_date", fromYear, toYear) });
    updates.push({ table: "cat_concentration_snapshots", column: "snapshot_date", rows: await shiftYear("cat_concentration_snapshots", "snapshot_date", fromYear, toYear) });

    if (includeTrailingYear) {
      updates.push({ table: "contract_premium_payments", column: "paid_on", rows: await shiftYear("contract_premium_payments", "paid_on", fromYear + 1, toYear + 1) });
      updates.push({ table: "reglements", column: "date", rows: await shiftYear("reglements", "date", fromYear + 1, toYear + 1) });
      updates.push({ table: "reinsurance_premium_cessions", column: "accounting_date", rows: await shiftYear("reinsurance_premium_cessions", "accounting_date", fromYear + 1, toYear + 1) });
      updates.push({ table: "reinsurance_claim_cessions", column: "event_date", rows: await shiftYear("reinsurance_claim_cessions", "event_date", fromYear + 1, toYear + 1) });
      updates.push({ table: "premium_transactions", column: "accounting_date", rows: await shiftYear("premium_transactions", "accounting_date", fromYear + 1, toYear + 1) });
      updates.push({ table: "premium_transactions", column: "effective_date", rows: await shiftYear("premium_transactions", "effective_date", fromYear + 1, toYear + 1) });
      updates.push({ table: "sinistres", column: "date_survenue", rows: await shiftYear("sinistres", "date_survenue", fromYear + 1, toYear + 1) });
      updates.push({ table: "sinistres", column: "date_decl", rows: await shiftYear("sinistres", "date_decl", fromYear + 1, toYear + 1) });
      updates.push({ table: "claim_reserve_snapshots", column: "snapshot_date", rows: await shiftYear("claim_reserve_snapshots", "snapshot_date", fromYear + 1, toYear + 1) });
    }

    // Refresh common snapshots / results dates (optional consistency)
    updates.push({ table: "portfolio_snapshots", column: "snapshot_date", rows: await shiftYear("portfolio_snapshots", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "portfolio_branch_snapshots", column: "snapshot_date", rows: await shiftYear("portfolio_branch_snapshots", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "broker_concentration_snapshots", column: "snapshot_date", rows: await shiftYear("broker_concentration_snapshots", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "s2_scr_inputs_non_life", column: "snapshot_date", rows: await shiftYear("s2_scr_inputs_non_life", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "s2_scr_results", column: "snapshot_date", rows: await shiftYear("s2_scr_results", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "orsa_run_sets", column: "snapshot_date", rows: await shiftYear("orsa_run_sets", "snapshot_date", fromYear, toYear) });
    updates.push({ table: "orsa_run_comparison_snapshots", column: "snapshot_date", rows: await shiftYear("orsa_run_comparison_snapshots", "snapshot_date", fromYear, toYear) });

    const ranges = {
      contract_premium_payments: await rangeFor("contract_premium_payments", "paid_on"),
      reglements: await rangeFor("reglements", "date"),
      reinsurance_premium_cessions: await rangeFor("reinsurance_premium_cessions", "accounting_date"),
      reinsurance_claim_cessions: await rangeFor("reinsurance_claim_cessions", "event_date"),
      fronting_run_adjustments: await rangeFor("fronting_run_adjustments", "snapshot_date"),
      orsa_run_sets: await rangeFor("orsa_run_sets", "snapshot_date"),
    };

    console.log(JSON.stringify({ ok: true, from_year: fromYear, to_year: toYear, updates, ranges }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
