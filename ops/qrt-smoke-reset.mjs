#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

import pool from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

async function safeUnlink(filePath) {
  if (!filePath) return false;
  try {
    await fs.unlink(String(filePath));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await migrate();

  const [seedExports] = await pool.query(
    `SELECT id, file_path
     FROM qrt_exports
     WHERE workflow_request_key IN ('smoke_seed_locked', 'smoke_seed_draft')`
  );
  for (const e of seedExports || []) {
    await safeUnlink(e.file_path);
  }
  await pool.query(`DELETE FROM qrt_exports WHERE workflow_request_key IN ('smoke_seed_locked', 'smoke_seed_draft')`);

  const [smokeSubmissions] = await pool.query(
    `SELECT id, package_path
     FROM qrt_submissions
     WHERE prepared_by_name = 'smoke-seed'
        OR package_path LIKE '%submission_%'`
  );
  for (const s of smokeSubmissions || []) {
    await safeUnlink(s.package_path);
  }
  await pool.query(`DELETE FROM qrt_submissions WHERE prepared_by_name = 'smoke-seed' OR package_path LIKE '%submission_%'`);

  await pool.query(`DELETE FROM qrt_approvals WHERE requested_by_name = 'smoke-seed' OR comment_text LIKE '%smoke approval request%'`);
  await pool.query(`DELETE FROM qrt_archive_logs WHERE archived_by_name = 'smoke-seed'`);
  await pool.query(`DELETE FROM qrt_workflow_runs WHERE workflow_request_key LIKE 'smoke_%' OR started_by_name = 'smoke-seed'`);
  await pool.query(`DELETE FROM qrt_event_logs WHERE event_code LIKE 'smoke.%' OR error_text = 'no_active_webhook'`);
  await pool.query(`DELETE FROM qrt_webhooks WHERE event_code = 'smoke.test'`);

  console.log(JSON.stringify({ ok: true, reset: "completed" }, null, 2));
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
