import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authRequired, requireRole } from "../middleware/auth.js";
import pool from "../db/pool.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
const canManage = ["super_admin"];

const userCreate = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  roles: z.array(z.string()).optional().default([]),
});

const userPatch = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roles: z.array(z.string()).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

router.get("/", authRequired, requireRole(...canManage), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.status, GROUP_CONCAT(r.name) as roles
     FROM users u
     LEFT JOIN users_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     GROUP BY u.id`
  );
  res.json(rows);
});

router.post("/", authRequired, requireRole(...canManage), validate(userCreate), async (req, res) => {
  const { email, password, roles } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO users(email, password_hash, status) VALUES (?,?,?)`,
    [email, hash, "active"]
  );
  const userId = result.insertId;
  if (roles?.length) {
    const [roleRows] = await pool.query(`SELECT id,name FROM roles WHERE name IN (?)`, [roles]);
    for (const r of roleRows) {
      await pool.query(`INSERT IGNORE INTO users_roles(user_id, role_id) VALUES (?,?)`, [userId, r.id]);
    }
  }
  await logAudit(req.user?.id, "user", userId, "create", { email, roles });
  res.status(201).json({ id: userId, email, roles: roles || [] });
});

router.patch("/:id", authRequired, requireRole(...canManage), validate(userPatch), async (req, res) => {
  const { email, password, roles, status } = req.body;
  const sets = [];
  const values = [];
  if (email !== undefined) { sets.push("email = ?"); values.push(email); }
  if (password !== undefined) { sets.push("password_hash = ?"); values.push(await bcrypt.hash(password, 10)); }
  if (status !== undefined) { sets.push("status = ?"); values.push(status); }
  if (sets.length) {
    values.push(req.params.id);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, values);
  }
  if (roles !== undefined) {
    await pool.query(`DELETE FROM users_roles WHERE user_id = ?`, [req.params.id]);
    if (roles.length) {
      const [roleRows] = await pool.query(`SELECT id,name FROM roles WHERE name IN (?)`, [roles]);
      for (const r of roleRows) {
        await pool.query(`INSERT IGNORE INTO users_roles(user_id, role_id) VALUES (?,?)`, [req.params.id, r.id]);
      }
    }
  }
  await logAudit(req.user?.id, "user", Number(req.params.id), "update", req.body);
  res.json({ id: Number(req.params.id), updated: true });
});

export default router;
