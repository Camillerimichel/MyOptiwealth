import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";

const router = Router();
const canView = ["admin"];

router.get("/health", authRequired, requireRole(...canView), async (_req, res) => {
  const [[queued]] = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE status = 'queued'`);
  const [[running]] = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE status = 'running'`);
  const [[failed]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM jobs
     WHERE status = 'failed'
       AND created_at >= (NOW() - INTERVAL 1 DAY)`
  );
  const [[lastDone]] = await pool.query(
    `SELECT finished_at
     FROM jobs
     WHERE status = 'done' AND finished_at IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 1`
  );
  res.json({
    queue_size: Number(queued?.total || 0),
    running_count: Number(running?.total || 0),
    failed_count: Number(failed?.total || 0),
    last_done: lastDone?.finished_at || null,
  });
});

router.get("/", authRequired, requireRole(...canView), async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const where = [];
  const params = [];
  if (req.query.status) {
    where.push("status = ?");
    params.push(String(req.query.status));
  }
  if (req.query.type) {
    where.push("type LIKE ?");
    params.push(`%${String(req.query.type)}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT id, type, status, tries, last_error, scheduled_at, started_at, finished_at, created_at
     FROM jobs
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...params, limit]
  );
  res.json(rows);
});

export default router;
