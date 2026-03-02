import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing_token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const captiveId = Number(payload?.cid);
    if (!Number.isInteger(captiveId) || captiveId <= 0) {
      return res.status(401).json({ error: "invalid_token_scope" });
    }
    req.user = {
      ...payload,
      captive_id: captiveId,
      membership_role: payload?.crole || null,
      is_owner: Number(payload?.cown) === 1,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) return res.status(403).json({ error: "forbidden" });
    const has = req.user.roles.some((r) => roles.includes(r));
    if (!has) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
