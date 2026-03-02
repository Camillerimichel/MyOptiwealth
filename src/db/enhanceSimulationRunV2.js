import pool from "./pool.js";
import { loadS2EnginePlaceholderConfig, s2CfgNum } from "./s2EngineConfig.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) out[k] = true;
    else {
      out[k] = v;
      i += 1;
    }
  }
  return out;
}

function rngFactory(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

async function q1(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function qa(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function insertBatch(table, cols, rows) {
  if (!rows.length) return null;
  const placeholders = rows.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
  const vals = [];
  for (const r of rows) {
    for (const c of cols) vals.push(r[c] ?? null);
  }
  const [res] = await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${placeholders}`, vals);
  return res;
}

async function addCheck(runId, code, severity, status, message, metricValue = null) {
  await pool.query(
    `INSERT INTO simulation_run_checks (run_id, check_code, severity, status, metric_value, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, code, severity, status, metricValue, message]
  );
}

async function ensureInsurer(name) {
  await pool.query(`INSERT IGNORE INTO insurers (name) VALUES (?)`, [name]);
  return q1(`SELECT id, name FROM insurers WHERE name = ?`, [name]);
}

async function upsertTreaty({
  scenarioId,
  runId,
  captiveId,
  code,
  name,
  treatyType,
  insurerId,
}) {
  await pool.query(
    `INSERT INTO reinsurance_treaties
      (scenario_id, run_id, captive_id, code, name, treaty_type, counterparty_insurer_id, inception_date, expiry_date, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2028-01-01', '2028-12-31', 'EUR', 'active')
     ON DUPLICATE KEY UPDATE
       run_id = VALUES(run_id),
       name = VALUES(name),
       counterparty_insurer_id = VALUES(counterparty_insurer_id),
       updated_at = CURRENT_TIMESTAMP`,
    [scenarioId, runId, captiveId, code, name, treatyType, insurerId]
  );
  return q1(`SELECT id FROM reinsurance_treaties WHERE scenario_id = ? AND code = ?`, [scenarioId, code]);
}

function sampleWithoutReplacement(rng, arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

async function generateCatEventsAndClaims({ scenarioId, runId, captiveId, snapshotDate, rng }) {
  const existing = await q1(`SELECT COUNT(*) AS cnt FROM cat_events WHERE run_id = ?`, [runId]);
  if ((existing?.cnt || 0) > 0) {
    return { skipped: true, reason: "cat_events already exist", catClaims: 0 };
  }

  const propertyBranch = await q1(
    `SELECT id_branch, s2_code FROM insurance_branch WHERE captive_id = ? AND s2_code = '08' LIMIT 1`,
    [captiveId]
  );
  if (!propertyBranch) throw new Error("Branche Property (S2 08) introuvable");

  const propertyExposures = await qa(
    `SELECT
       c.id AS contract_id,
       c.partner_id,
       c.client_id,
       c.programme_id,
       c.date_debut,
       c.date_fin,
       cc.id AS contract_coverage_id,
       cc.id_branch
     FROM premium_transactions pt
     JOIN contracts c ON c.id = pt.contract_id
     JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
     JOIN insurance_branch ib ON ib.id_branch = cc.id_branch
     WHERE pt.run_id = ? AND pt.transaction_type = 'ISSUED' AND ib.s2_code = '08'`,
    [runId]
  );
  if (!propertyExposures.length) throw new Error("Aucune exposition Property pour générer les CAT events");

  const catEvents = [
    {
      event_code: `SIMCAT-${runId}-001`,
      event_date: "2028-05-18",
      event_type: "HAIL",
      severity_index: 1.25,
      loss_multiplier: 1.7,
      geo_scope_json: JSON.stringify({ regions: ["FR-HDF", "FR-IDF"] }),
      claim_count: 220,
      avg_sev: 42000,
    },
    {
      event_code: `SIMCAT-${runId}-002`,
      event_date: "2028-10-03",
      event_type: "FLOOD",
      severity_index: 1.55,
      loss_multiplier: 2.1,
      geo_scope_json: JSON.stringify({ regions: ["FR-NAQ", "FR-OCC", "FR-PAC"] }),
      claim_count: 160,
      avg_sev: 68000,
    },
  ];

  await insertBatch(
    "cat_events",
    [
      "scenario_id",
      "run_id",
      "event_code",
      "event_date",
      "event_type",
      "geo_scope_json",
      "severity_index",
      "loss_multiplier",
    ],
    catEvents.map((e) => ({
      scenario_id: scenarioId,
      run_id: runId,
      ...e,
    }))
  );
  const insertedCatEvents = await qa(`SELECT id, event_code, event_date, event_type FROM cat_events WHERE run_id = ? ORDER BY id`, [runId]);

  const sinRows = [];
  const lineRows = [];
  const payRows = [];
  const evtRows = [];
  const resRows = [];
  const metaRows = [];
  let serial = 0;
  let totalPaid = 0;
  let totalIncurred = 0;
  let totalRbns = 0;
  let totalIbnr = 0;
  let catLossGross = 0;

  const pickedGlobal = new Set();
  for (let idx = 0; idx < insertedCatEvents.length; idx += 1) {
    const ce = insertedCatEvents[idx];
    const cfg = catEvents[idx];
    const available = propertyExposures.filter((_, i) => !pickedGlobal.has(i));
    const picks = sampleWithoutReplacement(rng, available, cfg.claim_count);
    for (const e of picks) {
      const originalIndex = propertyExposures.indexOf(e);
      if (originalIndex >= 0) pickedGlobal.add(originalIndex);

      serial += 1;
      const occ = new Date(`${cfg.event_date}T00:00:00Z`);
      const decl = addDays(occ, randInt(rng, 1, 25));
      const est = Math.round(cfg.avg_sev * (0.6 + 2.4 * Math.pow(rng(), 2)) * 100) / 100;
      const open = rng() < 0.35;
      const paid = open ? Math.round(est * (0.2 + 0.5 * rng()) * 100) / 100 : Math.round(est * (0.95 + 0.05 * rng()) * 100) / 100;
      const rbns = open ? Math.round(Math.max(0, est - paid) * (0.9 + 0.2 * rng()) * 100) / 100 : 0;
      const ibnr = open ? Math.round(est * (0.01 + 0.04 * rng()) * 100) / 100 : 0;
      const incurred = paid + rbns + ibnr;
      const statut = open ? "en_cours" : "clos";

      sinRows.push({
        programme_id: e.programme_id,
        partner_id: e.partner_id,
        client_id: e.client_id,
        date_survenue: isoDate(occ),
        date_decl: isoDate(decl),
        statut,
        montant_estime: incurred,
        montant_paye: paid,
        devise: "EUR",
        description: `SIM_RUN_${runId}_CAT_${ce.event_code}_${String(serial).padStart(6, "0")}`,
      });
      lineRows.push({
        sinistre_id: null,
        id_branch: propertyBranch.id_branch,
        statut,
        montant_estime: incurred,
        montant_paye: paid,
        montant_recours: 0,
        montant_franchise: Math.round(Math.min(10000, est * 0.03) * 100) / 100,
        description: `CAT ${ce.event_type} synthetic claim`,
      });

      const payments = [];
      const p1 = Math.round(paid * (0.45 + 0.25 * rng()) * 100) / 100;
      const p2 = Math.round((paid - p1) * 100) / 100;
      if (p1 > 0) payments.push({ date: isoDate(addDays(decl, randInt(rng, 5, 60))), montant: p1 });
      if (p2 > 0) payments.push({ date: isoDate(addDays(decl, randInt(rng, 30, 180))), montant: p2 });

      const events = [
        {
          sinistre_id: null,
          sinistre_ligne_id: null,
          event_type: "OPEN",
          event_date: `${isoDate(decl)} 09:00:00`,
          status_after: "ouvert",
          payload_json: JSON.stringify({ cat_event_code: ce.event_code, cat: true }),
        },
        {
          sinistre_id: null,
          sinistre_ligne_id: null,
          event_type: open ? "UPDATE" : "CLOSE",
          event_date: `${open ? snapshotDate : isoDate(addDays(decl, randInt(rng, 20, 240)))} 17:00:00`,
          status_after: statut,
          payload_json: JSON.stringify({ rbns, ibnr, cat_event_code: ce.event_code }),
        },
      ];

      resRows.push({
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

      for (const p of payments) {
        payRows.push({ sinistre_id: null, sinistre_ligne_id: null, date: p.date, montant: p.montant });
      }
      for (const ev of events) evtRows.push(ev);
      metaRows.push({ eventCount: events.length, paymentCount: payments.length, reserveCount: 1 });

      totalPaid += paid;
      totalIncurred += incurred;
      totalRbns += rbns;
      totalIbnr += ibnr;
      catLossGross += incurred;
    }
  }

  // Batch insert all generated CAT claims.
  const sinRes = await insertBatch(
    "sinistres",
    ["programme_id", "partner_id", "client_id", "date_survenue", "date_decl", "statut", "montant_estime", "montant_paye", "devise", "description"],
    sinRows
  );
  const sinFirst = sinRes.insertId;
  const sinIds = Array.from({ length: sinRows.length }, (_, i) => sinFirst + i);
  for (let i = 0; i < lineRows.length; i += 1) lineRows[i].sinistre_id = sinIds[i];

  const lineRes = await insertBatch(
    "sinistre_lignes",
    ["sinistre_id", "id_branch", "statut", "montant_estime", "montant_paye", "montant_recours", "montant_franchise", "description"],
    lineRows
  );
  const lineFirst = lineRes.insertId;
  const lineIds = Array.from({ length: lineRows.length }, (_, i) => lineFirst + i);

  let ePtr = 0;
  let pPtr = 0;
  let rPtr = 0;
  for (let i = 0; i < lineIds.length; i += 1) {
    for (let k = 0; k < metaRows[i].eventCount; k += 1) {
      evtRows[ePtr].sinistre_id = sinIds[i];
      evtRows[ePtr].sinistre_ligne_id = lineIds[i];
      ePtr += 1;
    }
    for (let k = 0; k < metaRows[i].paymentCount; k += 1) {
      payRows[pPtr].sinistre_id = sinIds[i];
      payRows[pPtr].sinistre_ligne_id = lineIds[i];
      pPtr += 1;
    }
    for (let k = 0; k < metaRows[i].reserveCount; k += 1) {
      resRows[rPtr].sinistre_id = sinIds[i];
      resRows[rPtr].sinistre_ligne_id = lineIds[i];
      rPtr += 1;
    }
  }

  await insertBatch("claim_events", ["sinistre_id", "sinistre_ligne_id", "event_type", "event_date", "status_after", "payload_json"], evtRows);
  await insertBatch("reglements", ["sinistre_id", "sinistre_ligne_id", "date", "montant"], payRows);
  await insertBatch(
    "claim_reserve_snapshots",
    ["scenario_id", "run_id", "sinistre_id", "sinistre_ligne_id", "snapshot_date", "rbns_gross", "ibnr_gross", "expense_reserve_gross", "rbns_net", "ibnr_net", "case_outstanding_gross", "paid_to_date_gross", "currency"],
    resRows
  );

  await pool.query(
    `UPDATE portfolio_snapshots
     SET claims_paid_total = COALESCE(claims_paid_total,0) + ?,
         claims_incurred_total = COALESCE(claims_incurred_total,0) + ?,
         rbns_total = COALESCE(rbns_total,0) + ?,
         ibnr_total = COALESCE(ibnr_total,0) + ?
     WHERE run_id = ? AND snapshot_date = ?`,
    [totalPaid, totalIncurred, totalRbns, totalIbnr, runId, snapshotDate]
  );
  await pool.query(
    `UPDATE portfolio_branch_snapshots
     SET paid_gross = COALESCE(paid_gross,0) + ?,
         incurred_gross = COALESCE(incurred_gross,0) + ?,
         rbns_gross = COALESCE(rbns_gross,0) + ?,
         ibnr_gross = COALESCE(ibnr_gross,0) + ?,
         cat_loss_gross = COALESCE(cat_loss_gross,0) + ?
     WHERE run_id = ? AND snapshot_date = ? AND id_branch = ?`,
    [totalPaid, totalIncurred, totalRbns, totalIbnr, catLossGross, runId, snapshotDate, propertyBranch.id_branch]
  );

  await addCheck(runId, "CAT_EVENTS_CREATED", "info", "pass", "CAT events et sinistres Property générés.", sinRows.length);
  return {
    skipped: false,
    catClaims: sinRows.length,
    totalPaid,
    totalIncurred,
    totalRbns,
    totalIbnr,
    catLossGross,
    propertyBranchId: propertyBranch.id_branch,
  };
}

async function applyXolAndStopLoss({ scenarioId, runId, captiveId, snapshotDate }) {
  const insurer = await ensureInsurer("SIM REINSURER CAT/SL");

  const propertyBranch = await q1(`SELECT id_branch FROM insurance_branch WHERE captive_id = ? AND s2_code = '08'`, [captiveId]);

  const xolTreaty = await upsertTreaty({
    scenarioId,
    runId,
    captiveId,
    code: `SIM_XOL_PROP_RUN_${runId}`,
    name: "XoL Property CAT",
    treatyType: "XOL",
    insurerId: insurer.id,
  });
  const slTreaty = await upsertTreaty({
    scenarioId,
    runId,
    captiveId,
    code: `SIM_SL_PORT_RUN_${runId}`,
    name: "Stop Loss Portefeuille",
    treatyType: "STOP_LOSS",
    insurerId: insurer.id,
  });

  await pool.query(`DELETE FROM reinsurance_treaty_scopes WHERE treaty_id IN (?, ?)`, [xolTreaty.id, slTreaty.id]);
  await pool.query(`DELETE FROM reinsurance_treaty_terms WHERE treaty_id IN (?, ?)`, [xolTreaty.id, slTreaty.id]);
  await insertBatch("reinsurance_treaty_scopes", ["treaty_id", "id_branch", "programme_id", "priority_order"], [
    { treaty_id: xolTreaty.id, id_branch: propertyBranch.id_branch, programme_id: null, priority_order: 1 },
    { treaty_id: slTreaty.id, id_branch: null, programme_id: null, priority_order: 1 },
  ]);
  await insertBatch("reinsurance_treaty_terms", ["treaty_id", "term_type", "value_numeric", "value_json", "effective_from", "effective_to"], [
    { treaty_id: xolTreaty.id, term_type: "ATTACHMENT", value_numeric: 50000, value_json: null, effective_from: "2028-01-01", effective_to: "2028-12-31" },
    { treaty_id: xolTreaty.id, term_type: "LIMIT", value_numeric: 500000, value_json: null, effective_from: "2028-01-01", effective_to: "2028-12-31" },
    { treaty_id: slTreaty.id, term_type: "ATTACHMENT", value_numeric: 62400000, value_json: null, effective_from: "2028-01-01", effective_to: "2028-12-31" },
    { treaty_id: slTreaty.id, term_type: "LIMIT", value_numeric: 10000000, value_json: null, effective_from: "2028-01-01", effective_to: "2028-12-31" },
  ]);

  const already = await q1(
    `SELECT COUNT(*) AS cnt FROM reinsurance_claim_cessions WHERE run_id = ? AND treaty_id IN (?, ?)`,
    [runId, xolTreaty.id, slTreaty.id]
  );
  if ((already?.cnt || 0) > 0) {
    return { skipped: true, reason: "xol/sl cessions already exist" };
  }

  const lineRows = await qa(
    `SELECT
       sl.id AS sinistre_ligne_id,
       sl.sinistre_id,
       sl.id_branch,
       COALESCE(sl.montant_paye,0) AS paid_gross,
       COALESCE(crs.rbns_gross,0) + COALESCE(crs.ibnr_gross,0) AS reserve_gross,
       COALESCE(sl.montant_paye,0) + COALESCE(crs.rbns_gross,0) + COALESCE(crs.ibnr_gross,0) AS incurred_gross
     FROM sinistre_lignes sl
     JOIN sinistres s ON s.id = sl.sinistre_id
     LEFT JOIN claim_reserve_snapshots crs
       ON crs.sinistre_ligne_id = sl.id
      AND crs.run_id = ?
      AND crs.snapshot_date = ?
     WHERE s.description LIKE ?`,
    [runId, snapshotDate, `SIM_RUN_${runId}_%`]
  );

  const xolAttachment = 50000;
  const xolLimit = 500000;
  const xolCessions = [];
  let xolPaidCed = 0;
  let xolReserveCed = 0;
  for (const r of lineRows) {
    if (r.id_branch !== propertyBranch.id_branch) continue;
    const total = Number(r.incurred_gross || 0);
    if (total <= xolAttachment) continue;
    const totalCededPotential = Math.min(xolLimit, total - xolAttachment);
    if (totalCededPotential <= 0) continue;
    const paid = Number(r.paid_gross || 0);
    const reserve = Number(r.reserve_gross || 0);
    const ratioPaid = total > 0 ? paid / total : 0;
    const paidCed = Math.round(totalCededPotential * ratioPaid * 100) / 100;
    const reserveCed = Math.round((totalCededPotential - paidCed) * 100) / 100;
    if (paidCed > 0) {
      xolCessions.push({
        scenario_id: scenarioId,
        run_id: runId,
        treaty_id: xolTreaty.id,
        sinistre_id: r.sinistre_id,
        sinistre_ligne_id: r.sinistre_ligne_id,
        event_date: snapshotDate,
        cession_type: "PAID",
        amount_ceded: paidCed,
        currency: "EUR",
      });
      xolPaidCed += paidCed;
    }
    if (reserveCed > 0) {
      xolCessions.push({
        scenario_id: scenarioId,
        run_id: runId,
        treaty_id: xolTreaty.id,
        sinistre_id: r.sinistre_id,
        sinistre_ligne_id: r.sinistre_ligne_id,
        event_date: snapshotDate,
        cession_type: "RESERVE",
        amount_ceded: reserveCed,
        currency: "EUR",
      });
      xolReserveCed += reserveCed;
    }
  }

  const ps = await q1(`SELECT gwp_total, claims_incurred_total FROM portfolio_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  const threshold = 0.30 * Number(ps.gwp_total || 0);
  const incurredTotal = Number(ps.claims_incurred_total || 0);
  const slRecoverable = Math.max(0, Math.min(10000000, (incurredTotal - threshold) * 0.8));

  const slCessions = [];
  let slAllocated = 0;
  if (slRecoverable > 0) {
    const linesSorted = lineRows
      .map((r) => ({ ...r, incurred_gross: Number(r.incurred_gross || 0) }))
      .filter((r) => r.incurred_gross > 0)
      .sort((a, b) => b.incurred_gross - a.incurred_gross);
    const top = linesSorted.slice(0, Math.min(1500, linesSorted.length));
    const sumTop = top.reduce((s, r) => s + r.incurred_gross, 0) || 1;
    for (let i = 0; i < top.length; i += 1) {
      let ceded = Math.round((slRecoverable * top[i].incurred_gross / sumTop) * 100) / 100;
      if (i === top.length - 1) ceded = Math.round((slRecoverable - slAllocated) * 100) / 100;
      if (ceded <= 0) continue;
      slAllocated += ceded;
      slCessions.push({
        scenario_id: scenarioId,
        run_id: runId,
        treaty_id: slTreaty.id,
        sinistre_id: top[i].sinistre_id,
        sinistre_ligne_id: top[i].sinistre_ligne_id,
        event_date: snapshotDate,
        cession_type: "RECOVERY",
        amount_ceded: ceded,
        currency: "EUR",
      });
    }
  }

  const allCessions = [...xolCessions, ...slCessions];
  for (let i = 0; i < allCessions.length; i += 2000) {
    await insertBatch(
      "reinsurance_claim_cessions",
      ["scenario_id", "run_id", "treaty_id", "sinistre_id", "sinistre_ligne_id", "event_date", "cession_type", "amount_ceded", "currency"],
      allCessions.slice(i, i + 2000)
    );
  }

  await addCheck(runId, "REINSURANCE_XOL_SL_APPLIED", "info", "pass", "XoL Property et Stop Loss appliqués.", xolPaidCed + xolReserveCed + slAllocated);

  return {
    skipped: false,
    xolPaidCed,
    xolReserveCed,
    stopLossCed: slAllocated,
    xolCessions: xolCessions.length,
    slCessions: slCessions.length,
  };
}

async function recomputeNetAndS2({ scenarioId, runId, snapshotDate }) {
  // Reset reserve net to gross then subtract reserve cessions across all treaties
  await pool.query(
    `UPDATE claim_reserve_snapshots
     SET rbns_net = rbns_gross, ibnr_net = ibnr_gross
     WHERE run_id = ? AND snapshot_date = ?`,
    [runId, snapshotDate]
  );

  const reserveCedByLine = await qa(
    `SELECT sinistre_ligne_id, SUM(amount_ceded) AS reserve_ceded
     FROM reinsurance_claim_cessions
     WHERE run_id = ? AND event_date = ? AND cession_type = 'RESERVE' AND sinistre_ligne_id IS NOT NULL
     GROUP BY sinistre_ligne_id`,
    [runId, snapshotDate]
  );
  const reserveMap = new Map(reserveCedByLine.map((r) => [r.sinistre_ligne_id, Number(r.reserve_ceded || 0)]));
  const reserveSnaps = await qa(`SELECT id, sinistre_ligne_id, rbns_gross, ibnr_gross FROM claim_reserve_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  for (const rs of reserveSnaps) {
    const grossReserve = Number(rs.rbns_gross || 0) + Number(rs.ibnr_gross || 0);
    const ceded = reserveMap.get(rs.sinistre_ligne_id) || 0;
    const ratio = grossReserve > 0 ? Math.min(1, ceded / grossReserve) : 0;
    const rbnsNet = Math.round(Number(rs.rbns_gross || 0) * (1 - ratio) * 100) / 100;
    const ibnrNet = Math.round(Number(rs.ibnr_gross || 0) * (1 - ratio) * 100) / 100;
    await pool.query(`UPDATE claim_reserve_snapshots SET rbns_net = ?, ibnr_net = ? WHERE id = ?`, [rbnsNet, ibnrNet, rs.id]);
  }

  const cedPrem = await qa(
    `SELECT cc.id_branch, SUM(rpc.amount_ceded) AS ceded
     FROM reinsurance_premium_cessions rpc
     JOIN premium_transactions pt ON pt.id = rpc.premium_transaction_id
     JOIN contract_coverages cc ON cc.id = pt.contract_coverage_id
     WHERE rpc.run_id = ?
     GROUP BY cc.id_branch`,
    [runId]
  );
  const cedPremMap = new Map(cedPrem.map((r) => [r.id_branch, Number(r.ceded || 0)]));

  const cedClaims = await qa(
    `SELECT sl.id_branch,
            SUM(CASE WHEN rcc.cession_type='PAID' THEN rcc.amount_ceded ELSE 0 END) AS paid_ceded,
            SUM(CASE WHEN rcc.cession_type='RESERVE' THEN rcc.amount_ceded ELSE 0 END) AS reserve_ceded,
            SUM(CASE WHEN rcc.cession_type='RECOVERY' THEN rcc.amount_ceded ELSE 0 END) AS recovery_ceded
     FROM reinsurance_claim_cessions rcc
     JOIN sinistre_lignes sl ON sl.id = rcc.sinistre_ligne_id
     WHERE rcc.run_id = ?
     GROUP BY sl.id_branch`,
    [runId]
  );
  const cedClaimMap = new Map(
    cedClaims.map((r) => [
      r.id_branch,
      {
        paid: Number(r.paid_ceded || 0),
        reserve: Number(r.reserve_ceded || 0),
        recovery: Number(r.recovery_ceded || 0),
      },
    ])
  );

  const pbsRows = await qa(`SELECT id, id_branch, gwp_gross, paid_gross, incurred_gross FROM portfolio_branch_snapshots WHERE run_id = ? AND snapshot_date = ?`, [runId, snapshotDate]);
  for (const r of pbsRows) {
    const p = cedPremMap.get(r.id_branch) || 0;
    const c = cedClaimMap.get(r.id_branch) || { paid: 0, reserve: 0, recovery: 0 };
    const gwpNet = Math.max(0, Number(r.gwp_gross || 0) - p);
    const paidNet = Math.max(0, Number(r.paid_gross || 0) - c.paid - c.recovery);
    const incurredNet = Math.max(0, Number(r.incurred_gross || 0) - c.paid - c.reserve - c.recovery);
    await pool.query(
      `UPDATE portfolio_branch_snapshots
       SET gwp_net = ?, earned_net = ?, paid_net = ?, incurred_net = ?
       WHERE id = ?`,
      [gwpNet, gwpNet, paidNet, incurredNet, r.id]
    );
  }

  await pool.query(
    `UPDATE s2_scr_inputs_non_life s2
     JOIN portfolio_branch_snapshots pbs
       ON pbs.run_id = s2.run_id AND pbs.snapshot_date = s2.snapshot_date AND pbs.id_branch = s2.id_branch
     SET s2.reserve_volume = COALESCE(pbs.rbns_gross,0) + COALESCE(pbs.ibnr_gross,0),
         s2.counterparty_exposure = (COALESCE(pbs.gwp_gross,0)-COALESCE(pbs.gwp_net,0)) + (COALESCE(pbs.incurred_gross,0)-COALESCE(pbs.incurred_net,0))
     WHERE s2.run_id = ? AND s2.snapshot_date = ?`,
    [runId, snapshotDate]
  );

  const s2Cfg = await loadS2EnginePlaceholderConfig(scenarioId);
  const s2Agg = await q1(
    `SELECT
       SUM(COALESCE(premium_volume,0) * COALESCE(sigma_premium,0)) AS prem_charge,
       SUM(COALESCE(reserve_volume,0) * COALESCE(sigma_reserve,0)) AS reserve_charge,
       SUM(COALESCE(cat_exposure,0) * ?) AS cat_charge,
       SUM(COALESCE(counterparty_exposure,0) * ?) AS cpty_charge
     FROM s2_scr_inputs_non_life
     WHERE run_id = ? AND snapshot_date = ?`,
    [
      s2CfgNum(s2Cfg, "cat_xol_v2.cat_charge_factor", 0.30),
      s2CfgNum(s2Cfg, "cat_xol_v2.counterparty_charge_factor", 0.10),
      runId,
      snapshotDate,
    ]
  );
  const scrNonLife =
    (Number(s2Agg.prem_charge || 0) + Number(s2Agg.reserve_charge || 0) + Number(s2Agg.cat_charge || 0)) *
    s2CfgNum(s2Cfg, "cat_xol_v2.nonlife_multiplier", 0.76);
  const scrCounterparty = Number(s2Agg.cpty_charge || 0);
  const scrMarket = 0;
  const scrOperational = s2CfgNum(s2Cfg, "cat_xol_v2.operational_fixed_eur", 450000);
  const scrBscr = scrNonLife + scrCounterparty + scrMarket;
  const scrTotal = scrBscr + scrOperational;
  const ownFunds = s2CfgNum(s2Cfg, "own_funds_eligible_base_eur", 12_000_000);
  await pool.query(
    `UPDATE s2_scr_results
     SET scr_non_life = ?, scr_counterparty = ?, scr_market = ?, scr_operational = ?, scr_bscr = ?, scr_total = ?,
         own_funds_eligible = ?, solvency_ratio_pct = ?, methodology_version = 'v2-cat-xol-sl-placeholder'
     WHERE run_id = ? AND snapshot_date = ?`,
    [
      Math.round(scrNonLife * 100) / 100,
      Math.round(scrCounterparty * 100) / 100,
      scrMarket,
      scrOperational,
      Math.round(scrBscr * 100) / 100,
      Math.round(scrTotal * 100) / 100,
      ownFunds,
      Math.round((ownFunds / scrTotal) * 10000) / 100,
      runId,
      snapshotDate,
    ]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarioId = Number(args["scenario-id"] || 1);
  const runId = Number(args["run-id"] || 3);
  const snapshotDate = String(args["snapshot-date"] || "2028-12-31");
  const rng = rngFactory(Number(args.seed || 20280225));

  try {
    const scenario = await q1(`SELECT id, captive_id FROM simulation_scenarios WHERE id = ?`, [scenarioId]);
    if (!scenario) throw new Error(`Scenario ${scenarioId} introuvable`);

    const cat = await generateCatEventsAndClaims({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      snapshotDate,
      rng,
    });

    const re = await applyXolAndStopLoss({
      scenarioId,
      runId,
      captiveId: scenario.captive_id,
      snapshotDate,
    });

    await recomputeNetAndS2({ scenarioId, runId, snapshotDate });
    await addCheck(runId, "V2_RECOMPUTE_DONE", "info", "pass", "Recalcul net/S2 après CAT + XoL + StopLoss");

    const summary = await q1(
      `SELECT
         ps.gwp_total,
         ps.claims_paid_total,
         ps.claims_incurred_total,
         ps.rbns_total,
         ps.ibnr_total,
         s2.scr_total,
         s2.solvency_ratio_pct
       FROM portfolio_snapshots ps
       LEFT JOIN s2_scr_results s2 ON s2.run_id = ps.run_id AND s2.snapshot_date = ps.snapshot_date
       WHERE ps.run_id = ? AND ps.snapshot_date = ?`,
      [runId, snapshotDate]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          run_id: runId,
          scenario_id: scenarioId,
          cat,
          reinsurance: re,
          summary,
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
