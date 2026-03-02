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

function toNum(v, d = 2) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function dateToStr(d) {
  return d.toISOString().slice(0, 10);
}

function* dateRange(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    yield dateToStr(d);
  }
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

async function resolveLinkedOrsa(profileId) {
  const link = await q1(
    `SELECT ol.orsa_set_id, ors.code, ors.snapshot_date, ors.base_run_id
     FROM alm_v3_orsa_links ol
     JOIN orsa_run_sets ors ON ors.id = ol.orsa_set_id
     WHERE ol.profile_id = ? AND ol.active = 1
     ORDER BY ol.id DESC
     LIMIT 1`,
    [profileId]
  );
  if (!link) return null;

  const peak = await q1(
    `SELECT MAX(scr_total) AS scr_peak, MAX(CASE WHEN UPPER(stress_code)='BASE' THEN own_funds_eligible END) AS own_funds_base,
            MAX(CASE WHEN UPPER(stress_code)='BASE' THEN scr_total END) AS scr_base
     FROM orsa_run_comparison_snapshots
     WHERE orsa_set_id = ?`,
    [link.orsa_set_id]
  );
  return { ...link, ...peak };
}

async function ensureRun({ profileId, orsaSetId, runCode, runLabel, dateFrom, dateTo, asOfTimestamp }) {
  const existing = await q1(
    `SELECT * FROM alm_v3_runs WHERE profile_id = ? AND run_code = ?`,
    [profileId, runCode]
  );
  if (existing) {
    await pool.query(
      `UPDATE alm_v3_runs
       SET status = 'running', run_label = ?, date_from = ?, date_to = ?, as_of_timestamp = ?, started_at = NOW(), ended_at = NULL
       WHERE id = ?`,
      [runLabel, dateFrom, dateTo, asOfTimestamp, existing.id]
    );
    return existing.id;
  }
  const [ins] = await pool.query(
    `INSERT INTO alm_v3_runs
       (profile_id, orsa_set_id, run_code, run_label, run_type, status, date_from, date_to, as_of_timestamp, methodology_version, started_at)
     VALUES (?, ?, ?, ?, 'daily_snapshot', 'running', ?, ?, ?, 'alm-v3-daily-snapshot-v1', NOW())`,
    [profileId, orsaSetId || null, runCode, runLabel, dateFrom, dateTo, asOfTimestamp]
  );
  return ins.insertId;
}

async function clearRunData(runId, profileId, dateFrom, dateTo) {
  const snaps = await qa(
    `SELECT id FROM alm_v3_daily_snapshots WHERE run_id = ? AND business_date BETWEEN ? AND ?`,
    [runId, dateFrom, dateTo]
  );
  if (snaps.length) {
    const ids = snaps.map((r) => Number(r.id));
    const ph = ids.map(() => "?").join(",");
    await pool.query(`DELETE FROM alm_v3_daily_strata_snapshots WHERE snapshot_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM alm_v3_daily_asset_class_snapshots WHERE snapshot_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM alm_v3_daily_duration_ladder WHERE snapshot_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM alm_v3_daily_liquidity_ladder WHERE snapshot_id IN (${ph})`, ids);
  }
  await pool.query(
    `DELETE FROM alm_v3_daily_snapshots WHERE run_id = ? AND business_date BETWEEN ? AND ?`,
    [runId, dateFrom, dateTo]
  );
  await pool.query(
    `DELETE FROM alm_v3_cash_balances_daily WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
    [profileId, dateFrom, dateTo]
  );
  await pool.query(
    `DELETE FROM alm_v3_run_checks WHERE run_id = ?`,
    [runId]
  );
}

async function loadReferenceMaps(profileId) {
  const [cashAccounts, strata, assetClasses, durationBuckets] = await Promise.all([
    qa(`SELECT id, account_code, strata_id, account_type FROM alm_v3_cash_accounts WHERE profile_id = ? AND active = 1`, [profileId]),
    qa(`SELECT id, strata_code, label FROM alm_v3_strata WHERE profile_id = ? AND active = 1`, [profileId]),
    qa(`SELECT id, asset_code, label FROM alm_v3_asset_classes WHERE profile_id = ? AND active = 1`, [profileId]),
    qa(`SELECT id, bucket_code, label, min_years, max_years, display_order FROM alm_v3_duration_buckets WHERE profile_id = ? ORDER BY display_order`, [profileId]),
  ]);
  return { cashAccounts, strata, assetClasses, durationBuckets };
}

async function loadDailyAggregates(profileId, dateFrom, dateTo) {
  const [cashMovements, liabFlows, valsByPos, valsByAsset, valsByStrata, cashLikeAssetsDaily] = await Promise.all([
    qa(
      `SELECT business_date, cash_account_id,
              SUM(CASE WHEN direction='in' THEN amount_base_ccy ELSE 0 END) AS inflows,
              SUM(CASE WHEN direction='out' THEN amount_base_ccy ELSE 0 END) AS outflows
       FROM alm_v3_cash_movements
       WHERE profile_id = ? AND business_date BETWEEN ? AND ?
       GROUP BY business_date, cash_account_id`,
      [profileId, dateFrom, dateTo]
    ),
    qa(
      `SELECT business_date,
              SUM(CASE WHEN direction='in' THEN amount_base_ccy ELSE 0 END) AS inflows,
              SUM(CASE WHEN direction='out' THEN amount_base_ccy ELSE 0 END) AS outflows
       FROM alm_v3_liability_cashflows_daily
       WHERE profile_id = ? AND business_date BETWEEN ? AND ?
       GROUP BY business_date`,
      [profileId, dateFrom, dateTo]
    ),
    qa(
      `SELECT v.business_date, v.position_id, p.strata_id, i.asset_class_id,
              v.market_value_amount, v.book_value_amount, v.modified_duration_years
       FROM alm_v3_position_valuations_daily v
       JOIN alm_v3_positions p ON p.id = v.position_id
       JOIN alm_v3_instruments i ON i.id = p.instrument_id
       WHERE v.profile_id = ? AND v.business_date BETWEEN ? AND ?`,
      [profileId, dateFrom, dateTo]
    ),
    qa(
      `SELECT v.business_date, i.asset_class_id,
              SUM(v.market_value_amount) AS mv,
              SUM(v.book_value_amount) AS bv,
              SUM(v.market_value_amount * COALESCE(v.modified_duration_years,0)) AS dur_num,
              SUM(v.market_value_amount) AS dur_den
       FROM alm_v3_position_valuations_daily v
       JOIN alm_v3_positions p ON p.id = v.position_id
       JOIN alm_v3_instruments i ON i.id = p.instrument_id
       WHERE v.profile_id = ? AND v.business_date BETWEEN ? AND ?
       GROUP BY v.business_date, i.asset_class_id`,
      [profileId, dateFrom, dateTo]
    ),
    qa(
      `SELECT v.business_date, p.strata_id,
              SUM(v.market_value_amount) AS mv,
              SUM(v.market_value_amount * COALESCE(v.modified_duration_years,0)) AS dur_num
       FROM alm_v3_position_valuations_daily v
       JOIN alm_v3_positions p ON p.id = v.position_id
       WHERE v.profile_id = ? AND v.business_date BETWEEN ? AND ?
       GROUP BY v.business_date, p.strata_id`,
      [profileId, dateFrom, dateTo]
    ),
    qa(
      `SELECT v.business_date, SUM(v.market_value_amount) AS mv_cashlike
       FROM alm_v3_position_valuations_daily v
       JOIN alm_v3_positions p ON p.id = v.position_id
       JOIN alm_v3_instruments i ON i.id = p.instrument_id
       JOIN alm_v3_asset_classes ac ON ac.id = i.asset_class_id
       WHERE v.profile_id = ? AND v.business_date BETWEEN ? AND ?
         AND ac.asset_code = 'CASH'
       GROUP BY v.business_date`,
      [profileId, dateFrom, dateTo]
    ),
  ]);

  return { cashMovements, liabFlows, valsByPos, valsByAsset, valsByStrata, cashLikeAssetsDaily };
}

function indexRows(rows, keys) {
  const m = new Map();
  for (const r of rows) {
    const k = keys
      .map((key) => {
        const v = r[key];
        if (v instanceof Date) return dateToStr(v);
        return String(v ?? "");
      })
      .join("|");
    m.set(k, r);
  }
  return m;
}

async function buildCashBalancesDaily({ profileId, dateFrom, dateTo, cashAccounts, cashMovementRows }) {
  const movementIdx = new Map();
  for (const r of cashMovementRows) {
    const d = r.business_date instanceof Date ? dateToStr(r.business_date) : String(r.business_date).slice(0, 10);
    movementIdx.set(`${d}|${r.cash_account_id}`, {
      inflows: Number(r.inflows || 0),
      outflows: Number(r.outflows || 0),
    });
  }

  const openingByAccount = {};
  for (const ca of cashAccounts) openingByAccount[ca.id] = 0;

  let inserted = 0;
  for (const day of dateRange(dateFrom, dateTo)) {
    for (const ca of cashAccounts) {
      const mv = movementIdx.get(`${day}|${ca.id}`) || { inflows: 0, outflows: 0 };
      const opening = Number(openingByAccount[ca.id] || 0);
      const inflows = Number(mv.inflows || 0);
      const outflows = Number(mv.outflows || 0);
      const closing = opening + inflows - outflows;

      await pool.query(
        `INSERT INTO alm_v3_cash_balances_daily
           (profile_id, cash_account_id, business_date, opening_balance_amount, inflows_amount, outflows_amount, closing_balance_amount,
            currency, closing_balance_base_ccy, fx_rate_to_base, snapshot_timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'EUR', ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           opening_balance_amount = VALUES(opening_balance_amount),
           inflows_amount = VALUES(inflows_amount),
           outflows_amount = VALUES(outflows_amount),
           closing_balance_amount = VALUES(closing_balance_amount),
           closing_balance_base_ccy = VALUES(closing_balance_base_ccy),
           snapshot_timestamp = VALUES(snapshot_timestamp)`,
        [
          profileId,
          ca.id,
          day,
          toNum(opening),
          toNum(inflows),
          toNum(outflows),
          toNum(closing),
          toNum(closing),
          `${day} 23:59:59`,
        ]
      );
      openingByAccount[ca.id] = closing;
      inserted += 1;
    }
  }
  return inserted;
}

async function loadFutureLiabilityOutflows(profileId, dateFrom, dateTo) {
  const rows = await qa(
    `SELECT business_date, SUM(CASE WHEN direction='out' THEN amount_base_ccy ELSE 0 END) AS outflows
     FROM alm_v3_liability_cashflows_daily
     WHERE profile_id = ? AND business_date BETWEEN ? AND ?
     GROUP BY business_date
     ORDER BY business_date`,
    [profileId, dateFrom, dateTo]
  );
  const byDate = new Map(
    rows.map((r) => [
      r.business_date instanceof Date ? dateToStr(r.business_date) : String(r.business_date).slice(0, 10),
      Number(r.outflows || 0),
    ])
  );
  return byDate;
}

function sumFutureOutflows(byDate, currentDay, horizonDays) {
  const start = new Date(`${currentDay}T00:00:00Z`);
  let sum = 0;
  for (let i = 0; i < horizonDays; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    sum += Number(byDate.get(dateToStr(d)) || 0);
  }
  return sum;
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = await resolveProfile(args);
  const dateFrom = String(args["date-from"] || "2028-01-01");
  const dateTo = String(args["date-to"] || "2028-12-31");
  const runCode = String(args["run-code"] || `ALM_DAILY_${dateFrom}_${dateTo}`);
  const runLabel = String(args["run-label"] || `ALM daily snapshots ${dateFrom}..${dateTo}`);
  const asOfTimestamp = String(args["as-of"] || `${dateTo} 23:59:59`);
  const replace = args.replace !== "false";

  try {
    const orsaLink = await resolveLinkedOrsa(profile.id);
    const runId = await ensureRun({
      profileId: profile.id,
      orsaSetId: orsaLink?.orsa_set_id || null,
      runCode,
      runLabel,
      dateFrom,
      dateTo,
      asOfTimestamp,
    });

    if (replace) {
      await clearRunData(runId, profile.id, dateFrom, dateTo);
    }

    const refs = await loadReferenceMaps(profile.id);
    const daily = await loadDailyAggregates(profile.id, dateFrom, dateTo);
    const cashBalanceRowsInserted = await buildCashBalancesDaily({
      profileId: profile.id,
      dateFrom,
      dateTo,
      cashAccounts: refs.cashAccounts,
      cashMovementRows: daily.cashMovements,
    });

    const cashBalancesRows = await qa(
      `SELECT business_date, cash_account_id, closing_balance_base_ccy, inflows_amount, outflows_amount
       FROM alm_v3_cash_balances_daily
       WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
      [profile.id, dateFrom, dateTo]
    );
    const cashBalancesIdx = indexRows(cashBalancesRows, ["business_date", "cash_account_id"]);
    const liabDayIdx = indexRows(daily.liabFlows, ["business_date"]);
    const valsByAssetDay = new Map();
    for (const r of daily.valsByAsset) {
      const k = `${dateToStr(new Date(r.business_date))}|${r.asset_class_id}`;
      valsByAssetDay.set(k, r);
    }
    const valsByStrataDay = new Map();
    for (const r of daily.valsByStrata) {
      const k = `${dateToStr(new Date(r.business_date))}|${r.strata_id}`;
      valsByStrataDay.set(k, r);
    }
    const valsByPosDay = new Map();
    for (const r of daily.valsByPos) {
      const d = String(r.business_date).slice(0, 10);
      if (!valsByPosDay.has(d)) valsByPosDay.set(d, []);
      valsByPosDay.get(d).push(r);
    }
    const cashLikeByDay = indexRows(daily.cashLikeAssetsDaily, ["business_date"]);
    const futureOutflowsByDate = await loadFutureLiabilityOutflows(profile.id, dateFrom, dateTo);

    let snapshotsCount = 0;
    let strataSnapshotsCount = 0;
    let assetClassSnapshotsCount = 0;
    let durationRowsCount = 0;
    let liquidityRowsCount = 0;

    for (const day of dateRange(dateFrom, dateTo)) {
      const liab = liabDayIdx.get(`${day}`) || { inflows: 0, outflows: 0 };
      const totalLiabInflows = Number(liab.inflows || 0);
      const totalLiabOutflows = Number(liab.outflows || 0);
      const netLiabCashflow = totalLiabInflows - totalLiabOutflows;

      let totalCash = 0;
      let totalCashInflows = 0;
      let totalCashOutflows = 0;
      const cashByStrata = new Map();
      for (const ca of refs.cashAccounts) {
        const cb = cashBalancesIdx.get(`${day}|${ca.id}`);
        const closing = Number(cb?.closing_balance_base_ccy || 0);
        const inflows = Number(cb?.inflows_amount || 0);
        const outflows = Number(cb?.outflows_amount || 0);
        totalCash += closing;
        totalCashInflows += inflows;
        totalCashOutflows += outflows;
        if (ca.strata_id) {
          const prev = cashByStrata.get(ca.strata_id) || { cash: 0, inflows: 0, outflows: 0 };
          prev.cash += closing;
          prev.inflows += inflows;
          prev.outflows += outflows;
          cashByStrata.set(ca.strata_id, prev);
        }
      }

      let totalAssetsMv = 0;
      let totalAssetsBv = 0;
      let durNum = 0;
      let durDen = 0;
      for (const ac of refs.assetClasses) {
        const v = valsByAssetDay.get(`${day}|${ac.id}`);
        if (!v) continue;
        totalAssetsMv += Number(v.mv || 0);
        totalAssetsBv += Number(v.bv || 0);
        durNum += Number(v.dur_num || 0);
        durDen += Number(v.dur_den || 0);
      }
      const durationAssetsWeighted = durDen > 0 ? durNum / durDen : 0;

      const durationLiabProxy = orsaLink?.scr_peak ? Number((orsaLink.scr_peak > 0 ? (orsaLink.scr_peak / (orsaLink.scr_peak + 1)) * 5 : 0)) : null;
      const durationGap = durationLiabProxy != null ? durationAssetsWeighted - durationLiabProxy : null;

      const liqNeed1 = sumFutureOutflows(futureOutflowsByDate, day, 1);
      const liqNeed7 = sumFutureOutflows(futureOutflowsByDate, day, 7);
      const liqNeed30 = sumFutureOutflows(futureOutflowsByDate, day, 30);
      const cashLikeAssets = Number(cashLikeByDay.get(`${day}`)?.mv_cashlike || 0);
      const liquidityBuffer = totalCash + cashLikeAssets;

      const [insSnap] = await pool.query(
        `INSERT INTO alm_v3_daily_snapshots
           (run_id, profile_id, business_date, snapshot_timestamp, total_assets_mv, total_assets_bv, total_cash_base_ccy,
            total_liability_inflows, total_liability_outflows, net_liability_cashflow, liquidity_buffer_available,
            liquidity_need_1d, liquidity_need_7d, liquidity_need_30d, duration_assets_weighted, duration_liabilities_proxy,
            duration_gap, own_funds_proxy, stress_peak_scr_ref, comments_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           snapshot_timestamp = VALUES(snapshot_timestamp),
           total_assets_mv = VALUES(total_assets_mv),
           total_assets_bv = VALUES(total_assets_bv),
           total_cash_base_ccy = VALUES(total_cash_base_ccy),
           total_liability_inflows = VALUES(total_liability_inflows),
           total_liability_outflows = VALUES(total_liability_outflows),
           net_liability_cashflow = VALUES(net_liability_cashflow),
           liquidity_buffer_available = VALUES(liquidity_buffer_available),
           liquidity_need_1d = VALUES(liquidity_need_1d),
           liquidity_need_7d = VALUES(liquidity_need_7d),
           liquidity_need_30d = VALUES(liquidity_need_30d),
           duration_assets_weighted = VALUES(duration_assets_weighted),
           duration_liabilities_proxy = VALUES(duration_liabilities_proxy),
           duration_gap = VALUES(duration_gap),
           own_funds_proxy = VALUES(own_funds_proxy),
           stress_peak_scr_ref = VALUES(stress_peak_scr_ref),
           comments_json = VALUES(comments_json)`,
        [
          runId,
          profile.id,
          day,
          `${day} 23:59:59`,
          toNum(totalAssetsMv),
          toNum(totalAssetsBv),
          toNum(totalCash),
          toNum(totalLiabInflows),
          toNum(totalLiabOutflows),
          toNum(netLiabCashflow),
          toNum(liquidityBuffer),
          toNum(liqNeed1),
          toNum(liqNeed7),
          toNum(liqNeed30),
          toNum(durationAssetsWeighted, 6),
          durationLiabProxy == null ? null : toNum(durationLiabProxy, 6),
          durationGap == null ? null : toNum(durationGap, 6),
          orsaLink?.own_funds_base ? toNum(orsaLink.own_funds_base) : null,
          orsaLink?.scr_peak ? toNum(orsaLink.scr_peak) : null,
          JSON.stringify({ cash_inflows_total: toNum(totalCashInflows), cash_outflows_total: toNum(totalCashOutflows) }),
        ]
      );
      let snapshotId = insSnap.insertId;
      if (!snapshotId) {
        const snap = await q1(`SELECT id FROM alm_v3_daily_snapshots WHERE run_id = ? AND business_date = ?`, [runId, day]);
        snapshotId = snap?.id;
      }
      snapshotsCount += 1;

      // Strata snapshots
      for (const s of refs.strata) {
        const assetPart = valsByStrataDay.get(`${day}|${s.id}`);
        const cashPart = cashByStrata.get(s.id) || { cash: 0, inflows: 0, outflows: 0 };
        const mv = Number(assetPart?.mv || 0);
        const durNumStrata = Number(assetPart?.dur_num || 0);
        const durationStrata = mv > 0 ? durNumStrata / mv : 0;
        const inflows = Number(cashPart.inflows || 0);
        const outflows = Number(cashPart.outflows || 0);
        await pool.query(
          `INSERT INTO alm_v3_daily_strata_snapshots
             (snapshot_id, strata_id, business_date, assets_mv, cash_balance, inflows_amount, outflows_amount, net_cashflow_amount, duration_assets_weighted, liquidity_buffer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             assets_mv = VALUES(assets_mv),
             cash_balance = VALUES(cash_balance),
             inflows_amount = VALUES(inflows_amount),
             outflows_amount = VALUES(outflows_amount),
             net_cashflow_amount = VALUES(net_cashflow_amount),
             duration_assets_weighted = VALUES(duration_assets_weighted),
             liquidity_buffer = VALUES(liquidity_buffer)`,
          [
            snapshotId,
            s.id,
            day,
            toNum(mv),
            toNum(cashPart.cash || 0),
            toNum(inflows),
            toNum(outflows),
            toNum(inflows - outflows),
            toNum(durationStrata, 6),
            toNum((cashPart.cash || 0) + (s.strata_code === "OPERATING_LIQ" ? cashLikeAssets : 0)),
          ]
        );
        strataSnapshotsCount += 1;
      }

      // Asset class snapshots
      const totalAssetsForShare = totalAssetsMv || 1;
      for (const ac of refs.assetClasses) {
        const v = valsByAssetDay.get(`${day}|${ac.id}`);
        const mv = Number(v?.mv || 0);
        const bv = Number(v?.bv || 0);
        const dur = Number(v?.dur_den || 0) > 0 ? Number(v.dur_num || 0) / Number(v.dur_den || 1) : 0;
        await pool.query(
          `INSERT INTO alm_v3_daily_asset_class_snapshots
             (snapshot_id, asset_class_id, business_date, market_value_amount, book_value_amount, share_of_assets_pct, duration_weighted_years, liquidity_horizon_days_weighted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             market_value_amount = VALUES(market_value_amount),
             book_value_amount = VALUES(book_value_amount),
             share_of_assets_pct = VALUES(share_of_assets_pct),
             duration_weighted_years = VALUES(duration_weighted_years),
             liquidity_horizon_days_weighted = VALUES(liquidity_horizon_days_weighted)`,
          [
            snapshotId,
            ac.id,
            day,
            toNum(mv),
            toNum(bv),
            toNum((mv / totalAssetsForShare) * 100, 4),
            toNum(dur, 6),
            null,
          ]
        );
        assetClassSnapshotsCount += 1;
      }

      // Duration ladder - assets by bucket using position durations, liabilities by future outflow in bucket window
      const posVals = valsByPosDay.get(day) || [];
      for (const b of refs.durationBuckets) {
        let assetsAmount = 0;
        for (const pv of posVals) {
          const dur = Number(pv.modified_duration_years || 0);
          const minY = Number(b.min_years || 0);
          const maxY = b.max_years == null ? null : Number(b.max_years);
          const inBucket = dur >= minY && (maxY == null ? true : dur < maxY);
          if (inBucket) assetsAmount += Number(pv.market_value_amount || 0);
        }

        const startDate = new Date(`${day}T00:00:00Z`);
        const minDays = Math.max(0, Math.floor(Number(b.min_years || 0) * 365));
        const maxDays = b.max_years == null ? null : Math.floor(Number(b.max_years) * 365);
        let liabOutBucket = 0;
        const hardCapDays = Math.min(maxDays == null ? 3650 : maxDays, 3650); // 10y cap
        for (let i = minDays; i < hardCapDays; i += 1) {
          const d = new Date(startDate);
          d.setUTCDate(d.getUTCDate() + i);
          liabOutBucket += Number(futureOutflowsByDate.get(dateToStr(d)) || 0);
        }

        await pool.query(
          `INSERT INTO alm_v3_daily_duration_ladder
             (snapshot_id, duration_bucket_id, business_date, assets_amount, liability_outflows_amount, net_gap_amount, cumulative_gap_amount)
           VALUES (?, ?, ?, ?, ?, ?, NULL)
           ON DUPLICATE KEY UPDATE
             assets_amount = VALUES(assets_amount),
             liability_outflows_amount = VALUES(liability_outflows_amount),
             net_gap_amount = VALUES(net_gap_amount)`,
          [snapshotId, b.id, day, toNum(assetsAmount), toNum(liabOutBucket), toNum(assetsAmount - liabOutBucket)]
        );
        durationRowsCount += 1;
      }

      // Liquidity ladder 1d / 7d / 30d
      const horizons = [
        ["D1", 1],
        ["D7", 7],
        ["D30", 30],
      ];
      for (const [code, days] of horizons) {
        const liqUses = sumFutureOutflows(futureOutflowsByDate, day, days);
        // Liquidity sources proxy = total cash + cash-like assets with duration <= horizon
        const posRows = posVals.filter((pv) => Number(pv.modified_duration_years || 999) * 365 <= days);
        const shortAssetLiquidation = posRows.reduce((s, pv) => s + Number(pv.market_value_amount || 0), 0);
        const liqSources = totalCash + shortAssetLiquidation;
        await pool.query(
          `INSERT INTO alm_v3_daily_liquidity_ladder
             (snapshot_id, horizon_code, horizon_days, liquidity_sources_amount, liquidity_uses_amount, net_liquidity_gap_amount, cumulative_liquidity_gap_amount)
           VALUES (?, ?, ?, ?, ?, ?, NULL)
           ON DUPLICATE KEY UPDATE
             liquidity_sources_amount = VALUES(liquidity_sources_amount),
             liquidity_uses_amount = VALUES(liquidity_uses_amount),
             net_liquidity_gap_amount = VALUES(net_liquidity_gap_amount)`,
          [snapshotId, code, days, toNum(liqSources), toNum(liqUses), toNum(liqSources - liqUses)]
        );
        liquidityRowsCount += 1;
      }
    }

    // Fill cumulative gaps per snapshot for duration and liquidity ladders
    const snapshots = await qa(
      `SELECT id, business_date FROM alm_v3_daily_snapshots WHERE run_id = ? ORDER BY business_date`,
      [runId]
    );
    for (const s of snapshots) {
      const dRows = await qa(
        `SELECT id, net_gap_amount FROM alm_v3_daily_duration_ladder WHERE snapshot_id = ? ORDER BY id`,
        [s.id]
      );
      let cum = 0;
      for (const r of dRows) {
        cum += Number(r.net_gap_amount || 0);
        await pool.query(`UPDATE alm_v3_daily_duration_ladder SET cumulative_gap_amount = ? WHERE id = ?`, [toNum(cum), r.id]);
      }

      const lRows = await qa(
        `SELECT id, horizon_days, net_liquidity_gap_amount FROM alm_v3_daily_liquidity_ladder WHERE snapshot_id = ? ORDER BY horizon_days`,
        [s.id]
      );
      let lCum = 0;
      for (const r of lRows) {
        lCum += Number(r.net_liquidity_gap_amount || 0);
        await pool.query(`UPDATE alm_v3_daily_liquidity_ladder SET cumulative_liquidity_gap_amount = ? WHERE id = ?`, [toNum(lCum), r.id]);
      }
    }

    const checks = [
      {
        code: "ALM_V3_DAILY_SNAPSHOTS_CREATED",
        severity: "info",
        status: "pass",
        metric: snapshotsCount,
        message: `Snapshots journaliers créés sur ${dateFrom}..${dateTo}`,
      },
      {
        code: "ALM_V3_HAS_LIABILITY_FLOWS",
        severity: "warning",
        status: snapshotsCount > 0 ? "pass" : "warn",
        metric: snapshotsCount,
        message: "Vérifier la présence de flux passifs quotidiens sur la période.",
      },
    ];
    for (const c of checks) {
      await pool.query(
        `INSERT INTO alm_v3_run_checks (run_id, check_code, severity, status, metric_value, message)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [runId, c.code, c.severity, c.status, c.metric, c.message]
      );
    }

    await pool.query(
      `UPDATE alm_v3_runs
       SET status = 'completed', ended_at = NOW()
       WHERE id = ?`,
      [runId]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          profile: { id: profile.id, code: profile.code },
          run: { id: runId, code: runCode, date_from: dateFrom, date_to: dateTo },
          linked_orsa: orsaLink
            ? {
                orsa_set_id: orsaLink.orsa_set_id,
                code: orsaLink.code,
                scr_peak: toNum(orsaLink.scr_peak),
                own_funds_base: toNum(orsaLink.own_funds_base),
              }
            : null,
          outputs: {
            cash_balance_rows: cashBalanceRowsInserted,
            daily_snapshots: snapshotsCount,
            strata_snapshots: strataSnapshotsCount,
            asset_class_snapshots: assetClassSnapshotsCount,
            duration_ladder_rows: durationRowsCount,
            liquidity_ladder_rows: liquidityRowsCount,
          },
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
