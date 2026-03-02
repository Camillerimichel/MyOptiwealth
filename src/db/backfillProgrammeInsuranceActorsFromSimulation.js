import pool from "./pool.js";

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

async function q1(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function qa(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function insertProgrammeInsurerIfMissing({ programmeId, insurerName, insurerType, sharePct }) {
  const exists = await q1(
    `SELECT id_insurer
     FROM programme_insurers
     WHERE programme_id = ?
       AND insurer_name = ?
       AND insurer_type = ?
       AND ((share_pct IS NULL AND ? IS NULL) OR share_pct = ?)
     LIMIT 1`,
    [programmeId, insurerName, insurerType, sharePct, sharePct]
  );
  if (exists) return false;
  await pool.query(
    `INSERT INTO programme_insurers (programme_id, insurer_name, insurer_type, share_pct)
     VALUES (?, ?, ?, ?)`,
    [programmeId, insurerName, insurerType, sharePct]
  );
  return true;
}

async function insertProgrammeCarrierIfMissing({ programmeId, carrierName, role, sharePct }) {
  const exists = await q1(
    `SELECT id_carrier
     FROM programme_carriers
     WHERE programme_id = ?
       AND carrier_name = ?
       AND role = ?
       AND ((share_pct IS NULL AND ? IS NULL) OR share_pct = ?)
     LIMIT 1`,
    [programmeId, carrierName, role, sharePct, sharePct]
  );
  if (exists) return false;
  await pool.query(
    `INSERT INTO programme_carriers (programme_id, carrier_name, role, share_pct)
     VALUES (?, ?, ?, ?)`,
    [programmeId, carrierName, role, sharePct]
  );
  return true;
}

function normalizeShare(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return Math.round(n * 10000) / 100;
  return Math.round(n * 100) / 100;
}

async function main() {
  const args = parseArgs(process.argv);
  const explicitRunId = args["run-id"] ? Number(args["run-id"]) : null;
  const includeGlobalStopLoss = !args["no-global-stoploss"];

  const stats = {
    selected_run_id: null,
    inserted: {
      programme_insurers_fronting: 0,
      programme_insurers_reinsurance: 0,
      programme_carriers_fronting: 0,
      programme_carriers_existing_assureur: 0,
    },
    skipped_existing: 0,
    warnings: [],
  };

  try {
    const programmes = await qa(`SELECT id, ligne_risque, branch_s2_code, assureur, statut FROM programmes ORDER BY id`);
    const branches = await qa(`SELECT id_branch, s2_code, name FROM insurance_branch`);
    const insurers = await qa(`SELECT id, name FROM insurers`);
    const branchById = new Map(branches.map((b) => [Number(b.id_branch), b]));
    const insurerNameById = new Map(insurers.map((i) => [Number(i.id), String(i.name)]));
    const programmesByS2 = new Map();
    for (const p of programmes) {
      const key = String(p.branch_s2_code || "").trim();
      if (!key) continue;
      if (!programmesByS2.has(key)) programmesByS2.set(key, []);
      programmesByS2.get(key).push(p);
    }

    const baseRun = explicitRunId
      ? { base_run_id: explicitRunId }
      : await q1(`SELECT base_run_id FROM orsa_run_sets ORDER BY id DESC LIMIT 1`);
    const selectedRunId = Number(baseRun?.base_run_id || 0) || null;
    stats.selected_run_id = selectedRunId;

    // 1) Fronting -> programme_insurers (FRONTING) + programme_carriers (FRONTING)
    const frontingPrograms = await qa(
      `SELECT fp.*, ib.s2_code
       FROM fronting_programs fp
       JOIN insurance_branch ib ON ib.id_branch = fp.id_branch
       ${selectedRunId ? "WHERE fp.run_id = ?" : ""}
       ORDER BY fp.run_id ASC, fp.id ASC`,
      selectedRunId ? [selectedRunId] : []
    ).catch(() => []);

    for (const fp of frontingPrograms) {
      const scopedProgrammes = programmesByS2.get(String(fp.s2_code || "")) || [];
      if (!scopedProgrammes.length) {
        stats.warnings.push(`Aucun programme trouvé pour la branche S2 ${fp.s2_code} (fronting_program ${fp.id}).`);
        continue;
      }

      const cps = await qa(
        `SELECT fpc.*, i.name AS insurer_name
         FROM fronting_program_counterparties fpc
         JOIN insurers i ON i.id = fpc.insurer_id
         WHERE fpc.fronting_program_id = ?
         ORDER BY FIELD(fpc.role_code,'PRIMARY','SECONDARY','OTHER'), fpc.id`,
        [fp.id]
      ).catch(() => []);

      const counterparties =
        cps.length > 0
          ? cps.map((c) => ({
              insurer_name: c.insurer_name,
              role_code: c.role_code,
              share_pct: normalizeShare(c.share_pct),
            }))
          : [
              fp.primary_fronting_insurer_id
                ? {
                    insurer_name: insurerNameById.get(Number(fp.primary_fronting_insurer_id)),
                    role_code: "PRIMARY",
                    share_pct: 100,
                  }
                : null,
              fp.secondary_fronting_insurer_id
                ? {
                    insurer_name: insurerNameById.get(Number(fp.secondary_fronting_insurer_id)),
                    role_code: "SECONDARY",
                    share_pct: null,
                  }
                : null,
            ].filter(Boolean);

      for (const p of scopedProgrammes) {
        for (const cp of counterparties) {
          if (!cp?.insurer_name) continue;
          const insInserted = await insertProgrammeInsurerIfMissing({
            programmeId: p.id,
            insurerName: cp.insurer_name,
            insurerType: "FRONTING",
            sharePct: cp.share_pct,
          });
          if (insInserted) stats.inserted.programme_insurers_fronting += 1;
          else stats.skipped_existing += 1;

          const carrierInserted = await insertProgrammeCarrierIfMissing({
            programmeId: p.id,
            carrierName: cp.insurer_name,
            role: "FRONTING",
            sharePct: cp.share_pct,
          });
          if (carrierInserted) stats.inserted.programme_carriers_fronting += 1;
          else stats.skipped_existing += 1;
        }
      }
    }

    // 2) Reinsurance treaties -> programme_insurers (REINSURANCE)
    const reTreaties = await qa(
      `SELECT rt.id, rt.run_id, rt.code, rt.treaty_type, rt.counterparty_insurer_id, i.name AS insurer_name
       FROM reinsurance_treaties rt
       LEFT JOIN insurers i ON i.id = rt.counterparty_insurer_id
       WHERE rt.status = 'active'
         AND rt.treaty_type IN ('QUOTA_SHARE','XOL','STOP_LOSS')
         ${selectedRunId ? "AND rt.run_id = ?" : ""}
       ORDER BY rt.id`,
      selectedRunId ? [selectedRunId] : []
    );

    for (const t of reTreaties) {
      if (!t.insurer_name) continue;
      const scopes = await qa(
        `SELECT id_branch, programme_id FROM reinsurance_treaty_scopes WHERE treaty_id = ? ORDER BY priority_order, id`,
        [t.id]
      );
      const termCession = await q1(
        `SELECT value_numeric FROM reinsurance_treaty_terms WHERE treaty_id = ? AND term_type = 'CESSION_RATE' ORDER BY id DESC LIMIT 1`,
        [t.id]
      );
      const sharePct = normalizeShare(termCession?.value_numeric);

      const programmeTargets = new Map();
      for (const s of scopes) {
        if (s.programme_id) {
          const p = programmes.find((x) => Number(x.id) === Number(s.programme_id));
          if (p) programmeTargets.set(Number(p.id), p);
          continue;
        }
        if (s.id_branch) {
          const b = branchById.get(Number(s.id_branch));
          const list = b ? programmesByS2.get(String(b.s2_code || "")) || [] : [];
          for (const p of list) programmeTargets.set(Number(p.id), p);
          continue;
        }
      }

      // Optional handling of portfolio-level stop-loss (global scope)
      if (!programmeTargets.size && t.treaty_type === "STOP_LOSS" && includeGlobalStopLoss) {
        for (const p of programmes) programmeTargets.set(Number(p.id), p);
      }

      for (const p of programmeTargets.values()) {
        const inserted = await insertProgrammeInsurerIfMissing({
          programmeId: p.id,
          insurerName: t.insurer_name,
          insurerType: "REINSURANCE",
          sharePct,
        });
        if (inserted) stats.inserted.programme_insurers_reinsurance += 1;
        else stats.skipped_existing += 1;
      }
    }

    // 3) Legacy programmes.assureur -> programme_carriers (LEAD) if present
    for (const p of programmes) {
      const raw = String(p.assureur || "").trim();
      if (!raw) continue;
      const inserted = await insertProgrammeCarrierIfMissing({
        programmeId: p.id,
        carrierName: raw,
        role: "LEAD",
        sharePct: 100,
      });
      if (inserted) stats.inserted.programme_carriers_existing_assureur += 1;
      else stats.skipped_existing += 1;
    }

    const programmeInsurersCount = await q1(`SELECT COUNT(*) AS c FROM programme_insurers`);
    const programmeCarriersCount = await q1(`SELECT COUNT(*) AS c FROM programme_carriers`);
    const preview = await qa(
      `SELECT 'programme_insurers' AS src, programme_id, insurer_name AS actor_name, insurer_type AS actor_kind, share_pct
       FROM programme_insurers
       UNION ALL
       SELECT 'programme_carriers' AS src, programme_id, carrier_name AS actor_name, role AS actor_kind, share_pct
       FROM programme_carriers
       ORDER BY programme_id, src, actor_name
       LIMIT 50`
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          ...stats,
          totals_after: {
            programme_insurers: Number(programmeInsurersCount?.c || 0),
            programme_carriers: Number(programmeCarriersCount?.c || 0),
          },
          preview,
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

