import pool from "../db/pool.js";

export async function logAudit(userId, entity, entityId, action, payload = null) {
  try {
    await pool.query(
      `INSERT INTO audit_trail (user_id, entity, entity_id, action, payload)
       VALUES (?,?,?,?,?)`,
      [
        userId || null,
        entity || "unknown",
        entityId ?? null,
        action || "unknown",
        payload === undefined || payload === null ? null : JSON.stringify(payload),
      ]
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[audit] insert_failed", err?.message || err);
    }
  }
}
