import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import pool from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";
import { validate } from "../utils/validator.js";
import { logAudit } from "../utils/audit.js";

const router = Router();

const membershipRoleEnum = z.enum(["owner", "intervenant", "manager", "viewer"]);
const userStatusEnum = z.enum(["active", "disabled"]);
const membershipStatusEnum = z.enum(["active", "disabled"]);

const assignSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).optional(),
  user_status: userStatusEnum.default("active"),
  roles: z.array(z.string().min(1)).optional(),
  membership: z
    .object({
      role: membershipRoleEnum.default("intervenant"),
      is_owner: z.coerce.number().int().min(0).max(1).default(0),
      status: membershipStatusEnum.default("active"),
      date_debut: z.string().optional().nullable(),
      date_fin: z.string().optional().nullable(),
    })
    .default({}),
});

const patchSchema = z.object({
  user_status: userStatusEnum.optional(),
  roles: z.array(z.string().min(1)).optional(),
  membership: z
    .object({
      role: membershipRoleEnum.optional(),
      is_owner: z.coerce.number().int().min(0).max(1).optional(),
      status: membershipStatusEnum.optional(),
      date_debut: z.string().optional().nullable(),
      date_fin: z.string().optional().nullable(),
    })
    .optional(),
});

function getCaptiveId(req) {
  return Number(req.user?.captive_id || 0);
}

function isSuperAdmin(req) {
  return Array.isArray(req.user?.roles) && req.user.roles.includes("super_admin");
}

function canManageCaptiveUsers(req) {
  if (isSuperAdmin(req)) return true;
  if (req.user?.is_owner) return true;
  return req.user?.membership_role === "manager";
}

function normalizeRoleNames(roles = []) {
  return [...new Set(roles.map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
}

function normalizeMembership(next) {
  const normalized = {
    role: next.role ?? "intervenant",
    is_owner: Number(next.is_owner ?? 0) ? 1 : 0,
    status: next.status ?? "active",
    date_debut: next.date_debut || null,
    date_fin: next.date_fin || null,
  };
  if (normalized.role === "owner") normalized.is_owner = 1;
  if (normalized.is_owner === 1 && normalized.role !== "owner") normalized.role = "owner";
  return normalized;
}

async function userHasSuperAdmin(conn, userId) {
  const [rows] = await conn.query(
    `SELECT 1
     FROM users_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.name = 'super_admin'
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function replaceBusinessRoles(conn, userId, roles) {
  const normalized = normalizeRoleNames(roles);
  if (normalized.includes("super_admin")) {
    const err = new Error("forbidden_role");
    err.code = "forbidden_role";
    throw err;
  }
  await conn.query(
    `DELETE ur
     FROM users_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
       AND r.name <> 'super_admin'`,
    [userId]
  );
  if (!normalized.length) return;
  const [roleRows] = await conn.query(`SELECT id, name FROM roles WHERE name IN (?)`, [normalized]);
  const found = new Set(roleRows.map((r) => r.name));
  const missing = normalized.filter((r) => !found.has(r));
  if (missing.length) {
    const err = new Error("invalid_roles");
    err.code = "invalid_roles";
    err.details = missing;
    throw err;
  }
  for (const role of roleRows) {
    await conn.query(`INSERT IGNORE INTO users_roles(user_id, role_id) VALUES (?,?)`, [userId, role.id]);
  }
}

async function countOtherActiveOwners(conn, captiveId, userId) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total
     FROM user_captive_memberships
     WHERE captive_id = ?
       AND status = 'active'
       AND is_owner = 1
       AND user_id <> ?`,
    [captiveId, userId]
  );
  return Number(row?.total || 0);
}

router.use(authRequired);
router.use((req, res, next) => {
  if (!canManageCaptiveUsers(req)) return res.status(403).json({ error: "forbidden_scope" });
  next();
});

router.get("/", async (req, res) => {
  const captiveId = getCaptiveId(req);
  const q = String(req.query.q || "").trim();
  const membershipStatus = req.query.membership_status ? String(req.query.membership_status) : null;
  const userStatus = req.query.user_status ? String(req.query.user_status) : null;
  const where = ["ucm.captive_id = ?"];
  const params = [captiveId];
  if (membershipStatus) {
    where.push("ucm.status = ?");
    params.push(membershipStatus);
  }
  if (userStatus) {
    where.push("u.status = ?");
    params.push(userStatus);
  }
  if (q) {
    where.push("u.email LIKE ?");
    params.push(`%${q}%`);
  }
  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.status AS user_status,
       ucm.role AS membership_role,
       ucm.is_owner,
       ucm.status AS membership_status,
       ucm.date_debut,
       ucm.date_fin,
       GROUP_CONCAT(DISTINCT CASE WHEN r.name <> 'super_admin' THEN r.name END ORDER BY r.name) AS roles
     FROM user_captive_memberships ucm
     JOIN users u ON u.id = ucm.user_id
     LEFT JOIN users_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE ${where.join(" AND ")}
     GROUP BY u.id, u.email, u.status, ucm.role, ucm.is_owner, ucm.status, ucm.date_debut, ucm.date_fin
     ORDER BY u.email ASC`,
    params
  );
  res.json(
    rows.map((row) => ({
      ...row,
      is_owner: Boolean(row.is_owner),
      roles: row.roles ? String(row.roles).split(",") : [],
    }))
  );
});

router.post("/", validate(assignSchema), async (req, res) => {
  const captiveId = getCaptiveId(req);
  const requesterIsOwner = Boolean(req.user?.is_owner) || isSuperAdmin(req);
  const membership = normalizeMembership(req.body.membership || {});
  if (!requesterIsOwner && membership.is_owner === 1) {
    return res.status(403).json({ error: "forbidden_owner_assignment" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [req.body.email]);
    let userId = users[0]?.id;
    let created = false;

    if (!userId) {
      if (!req.body.password) {
        await conn.rollback();
        return res.status(400).json({ error: "missing_password_for_new_user" });
      }
      const hash = await bcrypt.hash(req.body.password, 10);
      const [r] = await conn.query(`INSERT INTO users(email, password_hash, status) VALUES (?,?,?)`, [
        req.body.email,
        hash,
        req.body.user_status || "active",
      ]);
      userId = r.insertId;
      created = true;
    } else {
      if (!isSuperAdmin(req) && (await userHasSuperAdmin(conn, userId))) {
        await conn.rollback();
        return res.status(403).json({ error: "forbidden_target_user" });
      }
    }

    if (req.body.roles !== undefined) {
      await replaceBusinessRoles(conn, userId, req.body.roles);
    }

    await conn.query(
      `INSERT INTO user_captive_memberships
        (user_id, captive_id, role, is_owner, status, date_debut, date_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         is_owner = VALUES(is_owner),
         status = VALUES(status),
         date_debut = VALUES(date_debut),
         date_fin = VALUES(date_fin),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        captiveId,
        membership.role,
        membership.is_owner,
        membership.status,
        membership.date_debut,
        membership.date_fin,
      ]
    );

    await conn.commit();
    await logAudit(req.user?.uid, "captive_user_membership", userId, "upsert", {
      captive_id: captiveId,
      email: req.body.email,
      created_user: created,
      membership,
      roles: req.body.roles,
    });
    res.status(created ? 201 : 200).json({ user_id: userId, created_user: created });
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "duplicate_email_or_membership" });
    }
    if (err?.code === "invalid_roles") {
      return res.status(400).json({ error: "invalid_roles", details: err.details || [] });
    }
    if (err?.code === "forbidden_role") {
      return res.status(403).json({ error: "forbidden_role" });
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.patch("/:userId", validate(patchSchema), async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: "invalid_user_id" });
  const captiveId = getCaptiveId(req);
  const requesterIsOwner = Boolean(req.user?.is_owner) || isSuperAdmin(req);
  if (
    req.body.user_status === undefined &&
    req.body.roles === undefined &&
    req.body.membership === undefined
  ) {
    return res.status(400).json({ error: "no_fields" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [memberships] = await conn.query(
      `SELECT user_id, role, is_owner, status, date_debut, date_fin
       FROM user_captive_memberships
       WHERE user_id = ? AND captive_id = ?
       LIMIT 1`,
      [userId, captiveId]
    );
    if (!memberships.length) {
      await conn.rollback();
      return res.status(404).json({ error: "membership_not_found" });
    }
    const current = memberships[0];
    if (!requesterIsOwner && Number(current.is_owner) === 1) {
      await conn.rollback();
      return res.status(403).json({ error: "forbidden_owner_assignment" });
    }
    if (!isSuperAdmin(req) && (await userHasSuperAdmin(conn, userId))) {
      await conn.rollback();
      return res.status(403).json({ error: "forbidden_target_user" });
    }

    const mergedMembership = normalizeMembership({
      role: req.body.membership?.role ?? current.role,
      is_owner: req.body.membership?.is_owner ?? current.is_owner,
      status: req.body.membership?.status ?? current.status,
      date_debut:
        req.body.membership?.date_debut !== undefined ? req.body.membership?.date_debut : current.date_debut,
      date_fin: req.body.membership?.date_fin !== undefined ? req.body.membership?.date_fin : current.date_fin,
    });

    const ownerWillBeRemoved =
      Number(current.is_owner) === 1 &&
      current.status === "active" &&
      (mergedMembership.is_owner !== 1 || mergedMembership.status !== "active");
    if (ownerWillBeRemoved) {
      const otherOwners = await countOtherActiveOwners(conn, captiveId, userId);
      if (otherOwners === 0) {
        await conn.rollback();
        return res.status(400).json({ error: "last_owner_protection" });
      }
    }
    if (!requesterIsOwner && mergedMembership.is_owner === 1) {
      await conn.rollback();
      return res.status(403).json({ error: "forbidden_owner_assignment" });
    }

    if (req.body.roles !== undefined) {
      await replaceBusinessRoles(conn, userId, req.body.roles);
    }
    if (req.body.user_status !== undefined) {
      await conn.query(`UPDATE users SET status = ? WHERE id = ?`, [req.body.user_status, userId]);
    }
    if (req.body.membership !== undefined) {
      await conn.query(
        `UPDATE user_captive_memberships
         SET role = ?, is_owner = ?, status = ?, date_debut = ?, date_fin = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND captive_id = ?`,
        [
          mergedMembership.role,
          mergedMembership.is_owner,
          mergedMembership.status,
          mergedMembership.date_debut,
          mergedMembership.date_fin,
          userId,
          captiveId,
        ]
      );
    }

    await conn.commit();
    await logAudit(req.user?.uid, "captive_user_membership", userId, "update", {
      captive_id: captiveId,
      payload: req.body,
    });
    res.json({ user_id: userId, updated: true });
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "duplicate_email_or_membership" });
    }
    if (err?.code === "invalid_roles") {
      return res.status(400).json({ error: "invalid_roles", details: err.details || [] });
    }
    if (err?.code === "forbidden_role") {
      return res.status(403).json({ error: "forbidden_role" });
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.delete("/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: "invalid_user_id" });
  if (!isSuperAdmin(req) && Number(req.user?.uid) === userId) {
    return res.status(400).json({ error: "cannot_remove_self" });
  }
  const captiveId = getCaptiveId(req);
  const requesterIsOwner = Boolean(req.user?.is_owner) || isSuperAdmin(req);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [memberships] = await conn.query(
      `SELECT user_id, is_owner, status
       FROM user_captive_memberships
       WHERE user_id = ? AND captive_id = ?
       LIMIT 1`,
      [userId, captiveId]
    );
    if (!memberships.length) {
      await conn.rollback();
      return res.status(404).json({ error: "membership_not_found" });
    }
    const target = memberships[0];
    if (!isSuperAdmin(req) && (await userHasSuperAdmin(conn, userId))) {
      await conn.rollback();
      return res.status(403).json({ error: "forbidden_target_user" });
    }
    if (!requesterIsOwner && Number(target.is_owner) === 1) {
      await conn.rollback();
      return res.status(403).json({ error: "forbidden_owner_assignment" });
    }
    if (Number(target.is_owner) === 1 && target.status === "active") {
      const otherOwners = await countOtherActiveOwners(conn, captiveId, userId);
      if (otherOwners === 0) {
        await conn.rollback();
        return res.status(400).json({ error: "last_owner_protection" });
      }
    }

    await conn.query(`DELETE FROM user_captive_memberships WHERE user_id = ? AND captive_id = ?`, [
      userId,
      captiveId,
    ]);
    await conn.commit();
    await logAudit(req.user?.uid, "captive_user_membership", userId, "delete", {
      captive_id: captiveId,
    });
    res.json({ user_id: userId, removed: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

export default router;
