import { Router } from "express";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.get("/me", authRequired, (req, res) => {
  const { sub, uid, roles, captive_id, membership_role, is_owner } = req.user || {};
  res.json({
    email: sub,
    id: uid,
    roles: roles || [],
    captive_id,
    membership_role,
    is_owner: Boolean(is_owner),
  });
});

export default router;
