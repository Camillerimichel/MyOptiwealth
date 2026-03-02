#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import pool from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { buildQrtFacts, listQrtFacts } from "../src/db/qrtService.js";

function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function stableDimsKey(dims) {
  if (!dims || typeof dims !== "object" || Array.isArray(dims)) return "{}";
  const keys = Object.keys(dims).sort();
  const out = {};
  for (const k of keys) out[k] = dims[k];
  return JSON.stringify(out);
}

function safeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlNameSafe(s) {
  const x = String(s || "").replace(/[^A-Za-z0-9_]/g, "_");
  if (!x) return "Fact_Unknown";
  return /^[A-Za-z_]/.test(x) ? x : `F_${x}`;
}

function conceptElementName(templateCode, conceptCode) {
  const t = xmlNameSafe(String(templateCode || "").replaceAll(".", "_"));
  const c = xmlNameSafe(String(conceptCode || "").replaceAll(".", "_"));
  return `${t}__${c}`;
}

function buildXml({ facts, snapshotDate, captiveId, source }) {
  const contexts = new Map();
  for (const f of facts) {
    const key = stableDimsKey(f.dimensions_json);
    if (!contexts.has(key)) contexts.set(key, { id: `c${contexts.size + 1}`, dims: f.dimensions_json || {} });
  }
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:cap="https://captiva-risks.com/xbrl/qrt-lite">`
  );
  lines.push(`  <cap:metadata captiveId="${safeXml(captiveId)}" source="${safeXml(source)}" snapshotDate="${safeXml(snapshotDate)}"/>`);
  for (const ctx of contexts.values()) {
    lines.push(`  <xbrli:context id="${ctx.id}">`);
    lines.push("    <xbrli:entity><xbrli:identifier scheme=\"https://captiva-risks.com/entity-id\">SMOKE</xbrli:identifier></xbrli:entity>");
    lines.push(`    <xbrli:period><xbrli:instant>${safeXml(snapshotDate)}</xbrli:instant></xbrli:period>`);
    lines.push("  </xbrli:context>");
  }
  lines.push('  <xbrli:unit id="u_EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>');
  lines.push('  <xbrli:unit id="u_PCT"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>');
  for (const f of facts) {
    const ctxId = contexts.get(stableDimsKey(f.dimensions_json))?.id || "c1";
    const unitRef = String(f.unit_code || "EUR").toUpperCase() === "PCT" ? "u_PCT" : "u_EUR";
    const el = conceptElementName(f.template_code, f.concept_code);
    lines.push(
      `  <cap:${el} contextRef="${ctxId}" unitRef="${unitRef}" decimals="2">${safeXml(f.value_decimal)}</cap:${el}>`
    );
  }
  lines.push("</xbrli:xbrl>");
  return `${lines.join("\n")}\n`;
}

function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

async function upsertExport({
  captiveId,
  source,
  snapshotDate,
  filePath,
  xmlSha256,
  factsCount,
  workflowRequestKey,
  status,
  isLocked,
}) {
  await pool.query(`DELETE FROM qrt_exports WHERE captive_id = ? AND workflow_request_key = ?`, [captiveId, workflowRequestKey]);
  await pool.query(
    `INSERT INTO qrt_exports
      (captive_id, source, snapshot_date, workflow_request_key, taxonomy_version, jurisdiction, file_path, xml_sha256, facts_count, status, is_locked, created_by_user_id, created_by_name, published_at, published_by_user_id, published_by_name, locked_at, locked_by_user_id, locked_by_name)
     VALUES (?,?,?,?, '2.8.0', 'MT', ?, ?, ?, ?, ?, 1, 'smoke-seed', ?, 1, 'smoke-seed', ?, 1, 'smoke-seed')`,
    [
      captiveId,
      source,
      snapshotDate,
      workflowRequestKey,
      filePath,
      xmlSha256,
      factsCount,
      status,
      isLocked ? 1 : 0,
      status === "published" ? new Date() : null,
      isLocked ? new Date() : null,
    ]
  );
}

async function main() {
  await migrate();

  const source = "real";
  const captiveIdFromEnv = Number(process.env.SMOKE_CAPTIVE_ID || 0);
  const captiveId = captiveIdFromEnv > 0 ? captiveIdFromEnv : null;

  let targetCaptiveId = captiveId;
  if (!targetCaptiveId) {
    const [rows] = await pool.query(
      `SELECT captive_id
       FROM s2_scr_results_real
       GROUP BY captive_id
       ORDER BY MAX(snapshot_date) DESC
       LIMIT 1`
    );
    targetCaptiveId = Number(rows?.[0]?.captive_id || 0);
  }
  if (!targetCaptiveId) throw new Error("no_captive_with_s2_real_snapshot");

  const [s2Rows] = await pool.query(
    `SELECT snapshot_date
     FROM s2_scr_results_real
     WHERE captive_id = ?
     ORDER BY snapshot_date DESC, id DESC
     LIMIT 1`,
    [targetCaptiveId]
  );
  const snapshotDate = toIsoDate(s2Rows?.[0]?.snapshot_date);
  if (!snapshotDate) throw new Error("no_s2_real_snapshot_for_captive");

  const built = await buildQrtFacts({
    captiveId: targetCaptiveId,
    source,
    snapshotDate,
  });
  if (!built?.validation?.ok) {
    throw new Error(`qrt_facts_validation_failed:${(built.validation?.errors || []).join(",")}`);
  }

  const facts = await listQrtFacts({ captiveId: targetCaptiveId, source, snapshotDate });
  if (!facts.length) throw new Error("qrt_facts_empty_after_build");

  const outDir = path.join(process.cwd(), "storage", "output", "qrt");
  await fs.mkdir(outDir, { recursive: true });

  const xmlLocked = buildXml({ facts, snapshotDate, captiveId: targetCaptiveId, source });
  const xmlLockedPath = path.join(outDir, `qrt_smoke_seed_locked_${targetCaptiveId}_${snapshotDate}.xml`);
  await fs.writeFile(xmlLockedPath, xmlLocked, "utf8");
  const hashLocked = sha256(xmlLocked);
  await upsertExport({
    captiveId: targetCaptiveId,
    source,
    snapshotDate,
    filePath: xmlLockedPath,
    xmlSha256: hashLocked,
    factsCount: facts.length,
    workflowRequestKey: "smoke_seed_locked",
    status: "published",
    isLocked: true,
  });

  const xmlDraft = buildXml({ facts, snapshotDate, captiveId: targetCaptiveId, source });
  const xmlDraftPath = path.join(outDir, `qrt_smoke_seed_draft_${targetCaptiveId}_${snapshotDate}.xml`);
  await fs.writeFile(xmlDraftPath, xmlDraft, "utf8");
  const hashDraft = sha256(xmlDraft);
  await upsertExport({
    captiveId: targetCaptiveId,
    source,
    snapshotDate,
    filePath: xmlDraftPath,
    xmlSha256: hashDraft,
    factsCount: facts.length,
    workflowRequestKey: "smoke_seed_draft",
    status: "draft",
    isLocked: false,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        captive_id: targetCaptiveId,
        source,
        snapshot_date: snapshotDate,
        facts_count: facts.length,
        exports_seeded: ["smoke_seed_locked", "smoke_seed_draft"],
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
