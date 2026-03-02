import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";

const router = Router();
const canView = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

router.get("/", authRequired, requireRole(...canView), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const [[programmes]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM programmes
     WHERE captive_id = ?`,
    [captiveId]
  );
  const [[sinistres]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM sinistres s
     JOIN programmes p ON p.id = s.programme_id
     WHERE p.captive_id = ?`,
    [captiveId]
  );
  const [[reglements]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM reglements r
     JOIN sinistres s ON s.id = r.sinistre_id
     JOIN programmes p ON p.id = s.programme_id
     WHERE p.captive_id = ?`,
    [captiveId]
  );

  let qrt = null;
  try {
    const [[pendingApprovals]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM qrt_approvals a
       JOIN qrt_exports e ON e.id = a.export_id
       WHERE e.captive_id = ?
         AND a.status = 'pending'`,
      [captiveId]
    );
    const [[failedRuns24h]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM qrt_workflow_runs
       WHERE captive_id = ?
         AND status = 'failed'
         AND started_at >= (NOW() - INTERVAL 1 DAY)`,
      [captiveId]
    );
    const [[overdueTasks]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM qrt_tasks
       WHERE captive_id = ?
         AND status IN ('todo','in_progress','blocked')
         AND due_date IS NOT NULL
         AND due_date < CURRENT_DATE()`,
      [captiveId]
    );
    const [[blockedTasks]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM qrt_tasks
       WHERE captive_id = ?
         AND status = 'blocked'`,
      [captiveId]
    );
    const [[nextSchedule]] = await pool.query(
      `SELECT id, name, job_code, next_run_at
       FROM qrt_schedules
       WHERE captive_id = ?
         AND is_active = 1
       ORDER BY next_run_at ASC, id ASC
       LIMIT 1`,
      [captiveId]
    );
    const [[latestLockedExport]] = await pool.query(
      `SELECT id, source, snapshot_date, locked_at
       FROM qrt_exports
       WHERE captive_id = ?
         AND is_locked = 1
       ORDER BY locked_at DESC, id DESC
       LIMIT 1`,
      [captiveId]
    );
    const [[latestSubmission]] = await pool.query(
      `SELECT s.id, s.status, s.prepared_at, s.submitted_at, s.submission_ref
       FROM qrt_submissions s
       JOIN qrt_exports e ON e.id = s.export_id
       WHERE e.captive_id = ?
       ORDER BY s.prepared_at DESC, s.id DESC
       LIMIT 1`,
      [captiveId]
    );
    qrt = {
      pending_approvals: Number(pendingApprovals?.total || 0),
      failed_runs_24h: Number(failedRuns24h?.total || 0),
      overdue_tasks: Number(overdueTasks?.total || 0),
      blocked_tasks: Number(blockedTasks?.total || 0),
      next_schedule: nextSchedule || null,
      latest_locked_export: latestLockedExport || null,
      latest_submission: latestSubmission || null,
    };
  } catch {
    qrt = null;
  }

  res.json({
    programmes: Number(programmes?.total || 0),
    sinistres: Number(sinistres?.total || 0),
    reglements: Number(reglements?.total || 0),
    qrt,
  });
});

export default router;
