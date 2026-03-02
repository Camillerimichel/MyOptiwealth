import pool from "./pool.js";
import { loadS2EnginePlaceholderConfig, s2CfgNum } from "./s2EngineConfig.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith("--")) args[k] = true;
    else {
      args[k] = n;
      i += 1;
    }
  }
  return args;
}

function createRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function dateISO(d) {
  return d.toISOString().slice(0, 10);
}

function parseDateOrFallback(value, fallback) {
  if (!value) return new Date(fallback);
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return new Date(fallback);
  return d;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

async function queryAll(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function insertBatch(table, columns, rows) {
  if (!rows.length) return null;
  const placeholders = rows.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  const values = [];
  for (const r of rows) {
    for (const c of columns) values.push(r[c] ?? null);
  }
  const [res] = await pool.query(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`,
    values
  );
  return res;
}

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

function branchKeyFromS2(s2) {
  if (s2 === "10") return "motor";
  if (s2 === "13") return "pi";
  if (s2 === "02") return "medical";
  if (s2 === "08") return "property";
  return "others";
}

function branchClaimProfile(branchKey) {
  switch (branchKey) {
    case "motor":
      return { freq: 0.08, avgSev: 4500, openRatio: 0.18, reportLag: [1, 20], payLag: [5, 60] };
    case "pi":
      return { freq: 0.03, avgSev: 25000, openRatio: 0.45, reportLag: [15, 120], payLag: [60, 300] };
    case "medical":
      return { freq: 0.02, avgSev: 85000, openRatio: 0.60, reportLag: [30, 180], payLag: [90, 365] };
    case "property":
      return { freq: 0.04, avgSev: 18000, openRatio: 0.25, reportLag: [1, 45], payLag: [10, 120] };
    default:
      return { freq: 0.015, avgSev: 3000, openRatio: 0.15, reportLag: [1, 30], payLag: [5, 90] };
  }
}

function severity(rng, avg) {
  // Light skew with bounded multiplier.
  const mult = 0.3 + 2.2 * Math.pow(rng(), 2);
  return Math.round(avg * mult * 100) / 100;
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const runId = Number(args["run-id"] || 3);
  const seed = Number(args.seed || 20280224);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");
  const rng = createRng(seed);

  try {
    const scenario = await queryOne(
      `SELECT id, captive_id FROM simulation_scenarios WHERE id = ?`,
      [scenarioId]
    );
    if (!scenario) throw new Error(`Scenario ${scenarioId} introuvable`);

    const run = await queryOne(
      `SELECT id, scenario_id, status FROM simulation_runs WHERE id = ?`,
      [runId]
    );
    if (!run) throw new Error(`Run ${runId} introuvable`);
    if (run.scenario_id !== scenarioId) throw new Error(`Run ${runId} ne correspond pas au scenario ${scenarioId}`);

    const existingClaims = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM sinistres
       WHERE description LIKE ?`,
      [`SIM_RUN_${runId}_%`]
    );
    if (existingClaims?.cnt > 0) {
      throw new Error(`Des sinistres synthétiques existent déjà pour run ${runId} (${existingClaims.cnt}).`);
    }

    const exposures = await queryAll(
      `SELECT
         c.id AS contract_id,
         c.partner_id,
         c.client_id,
         c.programme_id,
         c.date_debut,
         c.date_fin,
         cc.id AS contract_coverage_id,
         cc.id_branch,
         ib.s2_code
       FROM premium_transactions pt
       JOIN contracts c ON c.id = pt.contract_id
       JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
       JOIN insurance_branch ib ON ib.id_branch = cc.id_branch
       WHERE pt.run_id = ?
         AND pt.transaction_type = 'ISSUED'
       ORDER BY pt.id`,
      [runId]
    );
    if (!exposures.length) throw new Error(`Aucune exposition trouvée pour run ${runId}`);

    const sinistresRows = [];
    const lignesRows = [];
    const reglementsRows = [];
    const claimEventsRows = [];
    const reserveRows = [];

    const branchAgg = new Map(); // id_branch -> stats
    let totalClaims = 0;
    let totalPaid = 0;
    let totalIncurred = 0;
    let totalRbns = 0;
    let totalIbnr = 0;

    const BATCH_CLAIMS = 1000;

    async function flushClaimsBatch() {
      if (!sinistresRows.length) return;

      const sinCols = [
        "programme_id",
        "partner_id",
        "client_id",
        "date_survenue",
        "date_decl",
        "statut",
        "montant_estime",
        "montant_paye",
        "devise",
        "description",
      ];
      const sinRes = await insertBatch("sinistres", sinCols, sinistresRows);
      const sinFirst = sinRes.insertId;
      const sinIds = Array.from({ length: sinistresRows.length }, (_, i) => sinFirst + i);
      for (let i = 0; i < sinIds.length; i += 1) {
        lignesRows[i].sinistre_id = sinIds[i];
      }

      const ligneCols = [
        "sinistre_id",
        "id_branch",
        "statut",
        "montant_estime",
        "montant_paye",
        "montant_recours",
        "montant_franchise",
        "description",
      ];
      const ligneRes = await insertBatch("sinistre_lignes", ligneCols, lignesRows);
      const lineFirst = ligneRes.insertId;
      const lineIds = Array.from({ length: lignesRows.length }, (_, i) => lineFirst + i);
      // Assign IDs to dependent rows through positional metadata arrays.
      let eventPtr = 0;
      let payPtr = 0;
      let resPtr = 0;
      for (let i = 0; i < lineIds.length; i += 1) {
        const meta = flushClaimsBatch.meta[i];
        for (let k = 0; k < meta.eventCount; k += 1) {
          claimEventsRows[eventPtr].sinistre_id = sinIds[i];
          claimEventsRows[eventPtr].sinistre_ligne_id = lineIds[i];
          eventPtr += 1;
        }
        for (let k = 0; k < meta.paymentCount; k += 1) {
          reglementsRows[payPtr].sinistre_id = sinIds[i];
          reglementsRows[payPtr].sinistre_ligne_id = lineIds[i];
          payPtr += 1;
        }
        for (let k = 0; k < meta.reserveCount; k += 1) {
          reserveRows[resPtr].sinistre_id = sinIds[i];
          reserveRows[resPtr].sinistre_ligne_id = lineIds[i];
          resPtr += 1;
        }
      }

      if (claimEventsRows.length) {
        await insertBatch(
          "claim_events",
          ["sinistre_id", "sinistre_ligne_id", "event_type", "event_date", "status_after", "payload_json"],
          claimEventsRows
        );
      }
      if (reglementsRows.length) {
        await insertBatch(
          "reglements",
          ["sinistre_id", "sinistre_ligne_id", "date", "montant"],
          reglementsRows
        );
      }
      if (reserveRows.length) {
        await insertBatch(
          "claim_reserve_snapshots",
          [
            "scenario_id",
            "run_id",
            "sinistre_id",
            "sinistre_ligne_id",
            "snapshot_date",
            "rbns_gross",
            "ibnr_gross",
            "expense_reserve_gross",
            "rbns_net",
            "ibnr_net",
            "case_outstanding_gross",
            "paid_to_date_gross",
            "currency",
          ],
          reserveRows
        );
      }

      sinistresRows.length = 0;
      lignesRows.length = 0;
      reglementsRows.length = 0;
      claimEventsRows.length = 0;
      reserveRows.length = 0;
      flushClaimsBatch.meta = [];
    }
    flushClaimsBatch.meta = [];

    for (const e of exposures) {
      const bKey = branchKeyFromS2(e.s2_code);
      const p = branchClaimProfile(bKey);
      if (rng() > p.freq) continue;

      totalClaims += 1;
      const dateDebut = parseDateOrFallback(e.date_debut, "2028-01-01T00:00:00Z");
      const dateFin = parseDateOrFallback(e.date_fin, "2028-12-31T00:00:00Z");
      const occ = addDays(dateDebut, randInt(rng, 0, Math.max(1, Math.floor((dateFin - dateDebut) / 86400000))));
      const decl = addDays(occ, randInt(rng, p.reportLag[0], p.reportLag[1]));
      const est = severity(rng, p.avgSev);
      const isOpen = rng() < p.openRatio;
      const paid = isOpen ? Math.round(est * (0.15 + rng() * 0.55) * 100) / 100 : est;
      const rbns = isOpen ? Math.round(Math.max(0, est - paid) * (0.85 + 0.3 * rng()) * 100) / 100 : 0;
      const ibnr =
        isOpen && (bKey === "pi" || bKey === "medical")
          ? Math.round(est * (0.05 + 0.2 * rng()) * 100) / 100
          : 0;
      const incurred = paid + rbns + ibnr;
      const statut = isOpen ? choice(rng, ["ouvert", "en_cours"]) : "clos";
      const payDate1 = addDays(decl, randInt(rng, p.payLag[0], p.payLag[1]));
      const eventOpenDate = decl;
      const eventCloseDate = isOpen ? null : addDays(payDate1, randInt(rng, 0, 30));

      sinistresRows.push({
        programme_id: e.programme_id,
        partner_id: e.partner_id,
        client_id: e.client_id,
        date_survenue: dateISO(occ),
        date_decl: dateISO(decl),
        statut,
        montant_estime: Math.round(incurred * 100) / 100,
        montant_paye: paid,
        devise: "EUR",
        description: `SIM_RUN_${runId}_CLAIM_${String(totalClaims).padStart(7, "0")}`,
      });

      lignesRows.push({
        sinistre_id: null,
        id_branch: e.id_branch,
        statut,
        montant_estime: Math.round(incurred * 100) / 100,
        montant_paye: paid,
        montant_recours: 0,
        montant_franchise: Math.round(Math.min(5000, est * 0.02) * 100) / 100,
        description: `Synthetic ${bKey} claim`,
      });

      const events = [
        {
          sinistre_id: null,
          sinistre_ligne_id: null,
          event_type: "OPEN",
          event_date: `${dateISO(eventOpenDate)} 09:00:00`,
          status_after: "ouvert",
          payload_json: JSON.stringify({ source: "simulation", branch: bKey }),
        },
      ];
      if (!isOpen) {
        events.push({
          sinistre_id: null,
          sinistre_ligne_id: null,
          event_type: "CLOSE",
          event_date: `${dateISO(eventCloseDate)} 18:00:00`,
          status_after: "clos",
          payload_json: JSON.stringify({ source: "simulation" }),
        });
      } else {
        events.push({
          sinistre_id: null,
          sinistre_ligne_id: null,
          event_type: "UPDATE",
          event_date: `${snapshotDate} 12:00:00`,
          status_after: statut,
          payload_json: JSON.stringify({ rbns, ibnr }),
        });
      }
      for (const ev of events) claimEventsRows.push(ev);

      const payments = [];
      if (paid > 0) {
        if (isOpen && paid > 1000) {
          const part1 = Math.round(paid * (0.4 + 0.3 * rng()) * 100) / 100;
          const part2 = Math.round((paid - part1) * 100) / 100;
          payments.push({
            sinistre_id: null,
            sinistre_ligne_id: null,
            date: dateISO(payDate1),
            montant: part1,
          });
          payments.push({
            sinistre_id: null,
            sinistre_ligne_id: null,
            date: dateISO(addDays(payDate1, randInt(rng, 7, 120))),
            montant: part2,
          });
        } else {
          payments.push({
            sinistre_id: null,
            sinistre_ligne_id: null,
            date: dateISO(payDate1),
            montant: paid,
          });
        }
      }
      for (const pay of payments) reglementsRows.push(pay);

      reserveRows.push({
        scenario_id: scenarioId,
        run_id: runId,
        sinistre_id: null,
        sinistre_ligne_id: null,
        snapshot_date: snapshotDate,
        rbns_gross: rbns,
        ibnr_gross: ibnr,
        expense_reserve_gross: Math.round((rbns + ibnr) * 0.03 * 100) / 100,
        rbns_net: rbns,
        ibnr_net: ibnr,
        case_outstanding_gross: rbns + ibnr,
        paid_to_date_gross: paid,
        currency: "EUR",
      });

      flushClaimsBatch.meta.push({
        eventCount: events.length,
        paymentCount: payments.length,
        reserveCount: 1,
      });

      totalPaid += paid;
      totalRbns += rbns;
      totalIbnr += ibnr;
      totalIncurred += incurred;

      if (!branchAgg.has(e.id_branch)) {
        branchAgg.set(e.id_branch, { paid: 0, incurred: 0, rbns: 0, ibnr: 0, claimCount: 0 });
      }
      const agg = branchAgg.get(e.id_branch);
      agg.paid += paid;
      agg.incurred += incurred;
      agg.rbns += rbns;
      agg.ibnr += ibnr;
      agg.claimCount += 1;

      if (sinistresRows.length >= BATCH_CLAIMS) await flushClaimsBatch();
    }
    await flushClaimsBatch();

    await addCheck(runId, "CLAIMS_CREATED", "info", "pass", "Sinistres synthétiques générés.", totalClaims);

    // Update portfolio snapshots with claims and reserves.
    await pool.query(
      `UPDATE portfolio_snapshots
       SET claims_paid_total = ?,
           claims_incurred_total = ?,
           rbns_total = ?,
           ibnr_total = ?
       WHERE run_id = ? AND snapshot_date = ?`,
      [
        Math.round(totalPaid * 100) / 100,
        Math.round(totalIncurred * 100) / 100,
        Math.round(totalRbns * 100) / 100,
        Math.round(totalIbnr * 100) / 100,
        runId,
        snapshotDate,
      ]
    );

    for (const [idBranch, agg] of branchAgg.entries()) {
      await pool.query(
        `UPDATE portfolio_branch_snapshots
         SET paid_gross = ?, paid_net = ?, incurred_gross = ?, incurred_net = ?, rbns_gross = ?, ibnr_gross = ?
         WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
        [
          Math.round(agg.paid * 100) / 100,
          Math.round(agg.paid * 100) / 100,
          Math.round(agg.incurred * 100) / 100,
          Math.round(agg.incurred * 100) / 100,
          Math.round(agg.rbns * 100) / 100,
          Math.round(agg.ibnr * 100) / 100,
          runId,
          snapshotDate,
          idBranch,
        ]
      );
    }

    // Populate simplified S2 inputs from portfolio branch snapshots.
    await pool.query(`DELETE FROM s2_scr_inputs_non_life WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
    await pool.query(
      `INSERT INTO s2_scr_inputs_non_life
        (scenario_id, run_id, snapshot_date, id_branch, premium_volume, reserve_volume, cat_exposure, counterparty_exposure, sigma_premium, sigma_reserve, corr_group_code)
       SELECT
         pbs.scenario_id,
         pbs.run_id,
         pbs.snapshot_date,
         pbs.id_branch,
         COALESCE(pbs.gwp_gross,0) AS premium_volume,
         COALESCE(pbs.rbns_gross,0) + COALESCE(pbs.ibnr_gross,0) AS reserve_volume,
         CASE WHEN ib.s2_code = '08' THEN COALESCE(pbs.gwp_gross,0) * 0.20 ELSE 0 END AS cat_exposure,
         0 AS counterparty_exposure,
         CASE
           WHEN ib.s2_code IN ('13','02') THEN 0.14
           WHEN ib.s2_code = '08' THEN 0.12
           WHEN ib.s2_code = '10' THEN 0.10
           ELSE 0.08
         END AS sigma_premium,
         CASE
           WHEN ib.s2_code IN ('13','02') THEN 0.16
           WHEN ib.s2_code = '08' THEN 0.12
           WHEN ib.s2_code = '10' THEN 0.10
           ELSE 0.08
         END AS sigma_reserve,
         'NL' AS corr_group_code
       FROM portfolio_branch_snapshots pbs
       JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
       WHERE pbs.run_id = ? AND pbs.snapshot_date = ?`,
      [runId, snapshotDate]
    );

    const s2Cfg = await loadS2EnginePlaceholderConfig(scenarioId);

    // Very simplified SCR placeholder from inputs (now parameterized through simulation_parameters.s2).
    const s2agg = await queryOne(
      `SELECT
         SUM(COALESCE(premium_volume,0) * COALESCE(sigma_premium,0)) AS prem_charge,
         SUM(COALESCE(reserve_volume,0) * COALESCE(sigma_reserve,0)) AS reserve_charge,
         SUM(COALESCE(cat_exposure,0) * ?) AS cat_charge
       FROM s2_scr_inputs_non_life
       WHERE run_id = ? AND snapshot_date = ?`,
      [s2CfgNum(s2Cfg, "claims_v1.cat_charge_factor", 0.25), runId, snapshotDate]
    );
    const scrNonLife =
      (Number(s2agg?.prem_charge || 0) + Number(s2agg?.reserve_charge || 0) + Number(s2agg?.cat_charge || 0)) *
      s2CfgNum(s2Cfg, "claims_v1.nonlife_multiplier", 0.8);
    const scrCounterparty = 0;
    const scrMarket = 0;
    const scrOperational = Math.max(
      s2CfgNum(s2Cfg, "claims_v1.operational_min_eur", 100000),
      Number(totalClaims > 0 ? totalClaims * s2CfgNum(s2Cfg, "claims_v1.operational_per_claim_eur", 50) : 0)
    );
    const scrBscr = scrNonLife + scrCounterparty + scrMarket;
    const scrTotal = scrBscr + scrOperational;
    const mcr = s2CfgNum(s2Cfg, "mcr_eur", 2_700_000);
    const ownFunds = s2CfgNum(s2Cfg, "own_funds_eligible_base_eur", 12_000_000);
    const solvencyRatio = scrTotal > 0 ? (ownFunds / scrTotal) * 100 : null;

    await pool.query(
      `UPDATE s2_scr_results
       SET scr_non_life = ?,
           scr_counterparty = ?,
           scr_market = ?,
           scr_operational = ?,
           scr_bscr = ?,
           scr_total = ?,
           mcr = ?,
           own_funds_eligible = ?,
           solvency_ratio_pct = ?,
           methodology_version = 'v1-claims-placeholder'
       WHERE run_id = ? AND snapshot_date = ?`,
      [
        Math.round(scrNonLife * 100) / 100,
        scrCounterparty,
        scrMarket,
        Math.round(scrOperational * 100) / 100,
        Math.round(scrBscr * 100) / 100,
        Math.round(scrTotal * 100) / 100,
        mcr,
        ownFunds,
        solvencyRatio ? Math.round(solvencyRatio * 100) / 100 : null,
        runId,
        snapshotDate,
      ]
    );

    await addCheck(runId, "S2_INPUTS_UPDATED", "info", "pass", "Inputs S2 non-vie et résultat placeholder recalculés.");

    const summary = {
      claims_count: totalClaims,
      paid_total: Math.round(totalPaid * 100) / 100,
      incurred_total: Math.round(totalIncurred * 100) / 100,
      rbns_total: Math.round(totalRbns * 100) / 100,
      ibnr_total: Math.round(totalIbnr * 100) / 100,
      run_id: runId,
      scenario_id: scenarioId,
    };
    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
