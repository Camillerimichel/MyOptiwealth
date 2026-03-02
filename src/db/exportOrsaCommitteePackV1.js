import fs from "node:fs/promises";
import path from "node:path";
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

function fmtEur(v) {
  if (v == null) return "n/a";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v));
}

function fmtPct(v) {
  if (v == null) return "n/a";
  return `${Number(v).toFixed(2)} %`;
}

function delta(a, b) {
  if (a == null || b == null) return null;
  return Number(a) - Number(b);
}

function safeNum(v) {
  return Number(v || 0);
}

function buildMarkdown({ setRow, rows, branchRowsByRun, frontingByRun }) {
  const byStress = Object.fromEntries(rows.map((r) => [r.stress_code, r]));
  const base = byStress.BASE;
  const adverse = byStress.ADVERSE;
  const severe = byStress.SEVERE;

  const keyMessages = [];
  if (base && severe) {
    keyMessages.push(
      `Le ratio de solvabilité passe de ${fmtPct(base.solvency_ratio_pct)} (BASE) à ${fmtPct(severe.solvency_ratio_pct)} (SEVERE), soit ${fmtPct(delta(severe.solvency_ratio_pct, base.solvency_ratio_pct))} d'écart.`
    );
    keyMessages.push(
      `Le SCR total augmente de ${fmtEur(delta(severe.scr_total, base.scr_total))} entre BASE et SEVERE.`
    );
    keyMessages.push(
      `L'exposition CAT Property S2 passe de ${fmtEur(base.property_cat_exposure_s2)} à ${fmtEur(severe.property_cat_exposure_s2)}.`
    );
  }
  if (adverse && base) {
    keyMessages.push(
      `En ADVERSE, les claims incurred augmentent de ${fmtEur(delta(adverse.claims_incurred_total, base.claims_incurred_total))} vs BASE.`
    );
  }
  if (base && (frontingByRun[base.run_id]?.fronting_total_cost || 0) > 0) {
    keyMessages.push(
      `Le coût de fronting (fees + gestion sinistres) en BASE est de ${fmtEur(frontingByRun[base.run_id].fronting_total_cost)}.`
    );
  }
  if (severe && base && ((frontingByRun[severe.run_id]?.fronting_total_cost || 0) > 0 || (frontingByRun[base.run_id]?.fronting_total_cost || 0) > 0)) {
    keyMessages.push(
      `Le coût de fronting varie de ${fmtEur(safeNum(frontingByRun[base.run_id]?.fronting_total_cost))} (BASE) à ${fmtEur(
        safeNum(frontingByRun[severe.run_id]?.fronting_total_cost)
      )} (SEVERE).`
    );
  }

  const tableHeader = `| Stress | Run | GWP | Claims Incurred | SCR Total | Solvency Ratio | CAT Property S2 | Coût fronting |\n|---|---:|---:|---:|---:|---:|---:|---:|`;
  const tableRows = rows
    .map(
      (r) =>
        `| ${r.stress_code} | ${r.run_id} | ${fmtEur(r.gwp_total)} | ${fmtEur(r.claims_incurred_total)} | ${fmtEur(
          r.scr_total
        )} | ${fmtPct(r.solvency_ratio_pct)} | ${fmtEur(r.property_cat_exposure_s2)} | ${fmtEur(
          frontingByRun[r.run_id]?.fronting_total_cost || 0
        )} |`
    )
    .join("\n");

  const branchSection = rows
    .map((r) => {
      const branchRows = branchRowsByRun[r.run_id] || [];
      const header = `### ${r.stress_code} (run ${r.run_id})`;
      const lines = [
        `| Branche S2 | GWP brut | GWP net | Incurred brut | Incurred net | CAT brut |`,
        `|---|---:|---:|---:|---:|---:|`,
        ...branchRows.map(
          (b) =>
            `| ${b.s2_code} | ${fmtEur(b.gwp_gross)} | ${fmtEur(b.gwp_net)} | ${fmtEur(b.incurred_gross)} | ${fmtEur(
              b.incurred_net
            )} | ${fmtEur(b.cat_loss_gross)} |`
        ),
      ];
      return `${header}\n\n${lines.join("\n")}`;
    })
    .join("\n\n");

  return `# Pack Comité ORSA - ${setRow.code}

## Contexte

- Set ORSA: \`${setRow.code}\`
- Nom: ${setRow.name}
- Scénario: \`${setRow.scenario_code}\` (${setRow.scenario_name})
- Run de base: \`${setRow.base_run_id}\`
- Date de snapshot: \`${setRow.snapshot_date}\`
- Statut: \`${setRow.status}\`

## Messages clés

${keyMessages.map((m) => `- ${m}`).join("\n")}

## Synthèse comparative

${tableHeader}
${tableRows}

## Vue par branche (brut/net)

${branchSection}

## Notes de méthode

- Comparaison ORSA V1 basée sur des stress agrégés (snapshots) et non sur une regénération complète des sinistres.
- Les métriques S2 restent des placeholders calibrés pour cadrage et simulation.
- L'exposition CAT Property S2 intègre un proxy dérivé de la concentration géographique.
- Les coûts de fronting V2 sont enrichis depuis \`fronting_run_adjustments\` (si présents sur les runs du set).
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const orsaSetId = Number(args["orsa-set-id"] || 1);
  const outDir = String(args["out-dir"] || "/tmp");

  try {
    const setRow = await q1(
      `SELECT ors.*, ss.code AS scenario_code, ss.name AS scenario_name
       FROM orsa_run_sets ors
       JOIN simulation_scenarios ss ON ss.id = ors.scenario_id
       WHERE ors.id = ?`,
      [orsaSetId]
    );
    if (!setRow) throw new Error(`ORSA set ${orsaSetId} introuvable`);

    const rows = await qa(
      `SELECT
         stress_code,
         run_id,
         snapshot_date,
         gwp_total,
         claims_incurred_total,
         scr_total,
         solvency_ratio_pct,
         property_cat_exposure_s2
       FROM orsa_run_comparison_snapshots
       WHERE orsa_set_id = ?
       ORDER BY FIELD(stress_code,'BASE','ADVERSE','SEVERE'), stress_code`,
      [orsaSetId]
    );
    if (!rows.length) throw new Error(`Aucune comparaison ORSA pour set ${orsaSetId}`);

    const frontingRows = await qa(
      `SELECT
         osm.run_id,
         COALESCE(SUM(fra.fronting_fee_amount),0) AS fronting_fee_total,
         COALESCE(SUM(fra.claims_handling_fee_amount),0) AS claims_handling_fee_total,
         COALESCE(SUM(fra.fronting_fee_amount + fra.claims_handling_fee_amount),0) AS fronting_total_cost
       FROM orsa_run_set_members osm
       LEFT JOIN fronting_run_adjustments fra
         ON fra.run_id = osm.run_id
        AND fra.snapshot_date = ?
       WHERE osm.orsa_set_id = ?
       GROUP BY osm.run_id`,
      [setRow.snapshot_date, orsaSetId]
    );
    const frontingByRun = Object.fromEntries(
      frontingRows.map((r) => [
        Number(r.run_id),
        {
          fronting_fee_total: Number(r.fronting_fee_total || 0),
          claims_handling_fee_total: Number(r.claims_handling_fee_total || 0),
          fronting_total_cost: Number(r.fronting_total_cost || 0),
        },
      ])
    );

    const branchRowsByRun = {};
    for (const r of rows) {
      branchRowsByRun[r.run_id] = await qa(
        `SELECT
           ib.s2_code,
           pbs.gwp_gross, pbs.gwp_net,
           pbs.incurred_gross, pbs.incurred_net,
           pbs.cat_loss_gross
         FROM portfolio_branch_snapshots pbs
         JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
         WHERE pbs.run_id = ? AND pbs.snapshot_date = ?
         ORDER BY pbs.gwp_gross DESC`,
        [r.run_id, r.snapshot_date]
      );
    }

    const md = buildMarkdown({ setRow, rows, branchRowsByRun, frontingByRun });
    await fs.mkdir(outDir, { recursive: true });
    const safeCode = String(setRow.code).replace(/[^a-zA-Z0-9_-]/g, "_");
    const mdPath = path.join(outDir, `orsa_${safeCode}_committee_pack.md`);
    await fs.writeFile(mdPath, md, "utf8");

    console.log(
      JSON.stringify(
        {
          ok: true,
          orsa_set_id: orsaSetId,
          file: mdPath,
          rows: rows.length,
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
