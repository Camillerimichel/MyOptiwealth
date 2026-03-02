import pool from "./pool.js";

export async function findUserByEmail(email) {
  const [rows] = await pool.query(`SELECT * FROM users WHERE email = ? LIMIT 1`, [email]);
  return rows[0];
}

export async function getUserRoles(userId) {
  const [rows] = await pool.query(
    `SELECT r.name AS code
     FROM roles r
     JOIN users_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map((r) => r.code);
}

export async function getUserActiveCaptiveMemberships(userId) {
  const [rows] = await pool.query(
    `SELECT
       ucm.captive_id,
       c.code AS captive_code,
       c.name AS captive_name,
       ucm.role AS membership_role,
       ucm.is_owner
     FROM user_captive_memberships ucm
     JOIN captives c ON c.id = ucm.captive_id
     WHERE ucm.user_id = ?
       AND ucm.status = 'active'
       AND c.status = 'active'
       AND (ucm.date_debut IS NULL OR ucm.date_debut <= CURRENT_DATE())
       AND (ucm.date_fin IS NULL OR ucm.date_fin >= CURRENT_DATE())
     ORDER BY ucm.is_owner DESC, c.name ASC`,
    [userId]
  );
  return rows;
}
