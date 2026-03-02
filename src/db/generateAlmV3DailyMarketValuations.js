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

function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}
function r(v, d = 2) {
  const p = 10 ** d;
  return Math.round(n(v) * p) / p;
}
function dateToStr(d) {
  return d.toISOString().slice(0, 10);
}
function* eachDay(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) yield new Date(d);
}

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function valuationModel(assetCode, dayIndex, totalDays, basePrice, baseDuration, baseMv) {
  const t = totalDays > 1 ? dayIndex / (totalDays - 1) : 0;
  const cyc1 = Math.sin(2 * Math.PI * t);
  const cyc2 = Math.sin(6 * Math.PI * t + 0.7);
  let price = basePrice;
  let modDur = baseDuration;
  let ytm = null;
  let haircut = 0;

  switch (assetCode) {
    case "CASH":
      price = 100 + 0.03 * cyc2;
      modDur = 0.05;
      ytm = 2.1 + 0.08 * cyc1;
      haircut = 0.0;
      break;
    case "BOND_ST":
      price = basePrice + 0.8 * cyc1 + 0.35 * cyc2 + 0.25 * (t - 0.5);
      modDur = Math.max(0.2, baseDuration - 0.7 * t + 0.08 * cyc2);
      ytm = 2.7 + 0.35 * cyc1 + 0.2 * t;
      haircut = 0.5;
      break;
    case "BOND_MT":
      price = basePrice + 1.5 * cyc1 + 0.9 * cyc2 - 0.55 * t;
      modDur = Math.max(0.8, baseDuration - 0.9 * t + 0.15 * cyc2);
      ytm = 3.25 + 0.45 * cyc1 + 0.35 * t;
      haircut = 1.5;
      break;
    case "BOND_LT":
      price = basePrice + 2.4 * cyc1 + 1.3 * cyc2 - 1.1 * t;
      modDur = Math.max(1.5, baseDuration - 1.2 * t + 0.25 * cyc2);
      ytm = 3.55 + 0.55 * cyc1 + 0.5 * t;
      haircut = 3.0;
      break;
    case "DIVERS":
      price = basePrice + 3.8 * cyc1 + 2.1 * cyc2 + 0.8 * t;
      modDur = Math.max(1, baseDuration + 0.2 * cyc1);
      ytm = 4.2 + 0.9 * cyc1 + 0.6 * cyc2;
      haircut = 8.0;
      break;
    default:
      price = basePrice + cyc1;
      modDur = baseDuration;
      ytm = null;
      haircut = 2.0;
  }

  const mvScale = price / (basePrice || 100);
  const marketValue = Math.max(0, baseMv * mvScale);
  const bookValue = assetCode === "DIVERS" ? baseMv * (1 + 0.002 * t) : baseMv * (1 - 0.001 * t);
  const accrued = assetCode.startsWith("BOND") ? marketValue * 0.0025 : 0;
  const pnl = marketValue - bookValue;
  const convexity =
    assetCode === "BOND_LT" ? 0.9 + 0.08 * cyc1 : assetCode.startsWith("BOND") ? 0.35 + 0.04 * cyc2 : null;

  return {
    dirty_price_pct: r(price, 6),
    clean_price_pct: r(price, 6),
    market_value_amount: r(marketValue, 2),
    book_value_amount: r(bookValue, 2),
    accrued_interest_amount: r(accrued, 2),
    unrealized_pnl_amount: r(pnl, 2),
    modified_duration_years: r(modDur, 6),
    macaulay_duration_years: r(modDur * 1.05, 6),
    convexity: convexity == null ? null : r(convexity, 8),
    ytm_pct: ytm == null ? null : r(ytm, 6),
    stress_haircut_pct: r(haircut, 4),
  };
}

async function resolveProfile(args) {
  if (args["profile-id"]) return q1(`SELECT * FROM alm_v3_profiles WHERE id = ?`, [Number(args["profile-id"])]);
  return q1(`SELECT * FROM alm_v3_profiles WHERE code = ? ORDER BY id DESC LIMIT 1`, [String(args["profile-code"] || "ALM_V3_DEFAULT")]);
}

async function main() {
  const args = parseArgs(process.argv);
  const dateFrom = String(args["date-from"] || "2026-01-01");
  const dateTo = String(args["date-to"] || "2026-12-31");
  const replace = args.replace !== "false";

  try {
    const profile = await resolveProfile(args);
    if (!profile) throw new Error("Profil ALM V3 introuvable");

    const positions = await qa(
      `SELECT p.id AS position_id, p.portfolio_code, i.id AS instrument_id, i.instrument_code, i.instrument_type, ac.asset_code, ac.default_duration_years
       FROM alm_v3_positions p
       JOIN alm_v3_instruments i ON i.id = p.instrument_id
       JOIN alm_v3_asset_classes ac ON ac.id = i.asset_class_id
       WHERE p.profile_id = ? AND p.position_status = 'active'
       ORDER BY p.id`,
      [profile.id]
    );
    if (!positions.length) throw new Error("Aucune position ALM V3 active");

    const baseDate = String(args["base-date"] || dateTo);
    const baseValRows = await qa(
      `SELECT v.position_id, v.quantity_eod, v.dirty_price_pct, v.market_value_amount, v.modified_duration_years, v.ytm_pct
       FROM alm_v3_position_valuations_daily v
       JOIN alm_v3_positions p ON p.id = v.position_id
       WHERE v.profile_id = ? AND v.business_date = ?`,
      [profile.id, baseDate]
    );
    const baseByPos = Object.fromEntries(baseValRows.map((r) => [Number(r.position_id), r]));

    if (replace) {
      await pool.query(
        `DELETE v FROM alm_v3_position_valuations_daily v
         JOIN alm_v3_positions p ON p.id = v.position_id
         WHERE v.profile_id = ? AND v.business_date BETWEEN ? AND ?`,
        [profile.id, dateFrom, dateTo]
      );
    }

    const days = [...eachDay(dateFrom, dateTo)];
    const totalDays = days.length;
    let upserts = 0;

    for (const p of positions) {
      const seed = hash01(`${p.instrument_code}|${dateFrom}|${dateTo}`);
      const base = baseByPos[p.position_id] || {};
      const qty = n(base.quantity_eod || 1);
      const basePrice = n(base.dirty_price_pct || 100);
      const baseDuration = n(base.modified_duration_years || p.default_duration_years || 1);
      const baseMv = n(base.market_value_amount || qty * basePrice || 1_000_000);
      const ytmBase = n(base.ytm_pct || 2.5);

      for (let i = 0; i < days.length; i += 1) {
        const d = days[i];
        const ds = dateToStr(d);
        const v = valuationModel(
          p.asset_code,
          i + Math.floor(seed * 7),
          totalDays,
          basePrice + seed * 0.8,
          Math.max(0.05, baseDuration + (seed - 0.5) * 0.3),
          baseMv
        );
        const ytmPct = v.ytm_pct == null ? null : r(v.ytm_pct + (ytmBase ? (ytmBase - v.ytm_pct) * 0.1 : 0), 6);

        await pool.query(
          `INSERT INTO alm_v3_position_valuations_daily
             (profile_id, position_id, business_date, valuation_timestamp, quantity_eod, dirty_price_pct, clean_price_pct, market_value_amount,
              book_value_amount, accrued_interest_amount, unrealized_pnl_amount, fx_rate_to_base, modified_duration_years, macaulay_duration_years,
              convexity, ytm_pct, stress_haircut_pct, source_system, source_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'SIM_MKT', ?)
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
             convexity = VALUES(convexity),
             ytm_pct = VALUES(ytm_pct),
             stress_haircut_pct = VALUES(stress_haircut_pct),
             source_ref = VALUES(source_ref)`,
          [
            profile.id,
            p.position_id,
            ds,
            `${ds} 23:59:59`,
            qty,
            v.dirty_price_pct,
            v.clean_price_pct,
            v.market_value_amount,
            v.book_value_amount,
            v.accrued_interest_amount,
            v.unrealized_pnl_amount,
            v.modified_duration_years,
            v.macaulay_duration_years,
            v.convexity,
            ytmPct,
            v.stress_haircut_pct,
            `${p.instrument_code}:${ds}`,
          ]
        );
        upserts += 1;
      }
    }

    const summary = await q1(
      `SELECT COUNT(*) AS rows_count, MIN(business_date) AS min_d, MAX(business_date) AS max_d,
              SUM(market_value_amount) AS sum_mv
       FROM alm_v3_position_valuations_daily
       WHERE profile_id = ? AND business_date BETWEEN ? AND ?`,
      [profile.id, dateFrom, dateTo]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          profile: { id: profile.id, code: profile.code },
          range: { date_from: dateFrom, date_to: dateTo, replace },
          positions_count: positions.length,
          valuation_upserts: upserts,
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
