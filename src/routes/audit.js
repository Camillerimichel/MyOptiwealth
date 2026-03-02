import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";

const router = Router();
const canView = ["admin", "cfo", "risk_manager", "conseil"];

router.get("/", authRequired, requireRole(...canView), async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
  const where = [];
  const params = [];

  if (req.query.entity) {
    where.push("entity = ?");
    params.push(String(req.query.entity));
  }
  if (req.query.action) {
    where.push("action = ?");
    params.push(String(req.query.action));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT id, user_id, entity, entity_id, action, payload, created_at
     FROM audit_trail
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...params, limit]
  );
  res.json(rows);
});

export default router;
