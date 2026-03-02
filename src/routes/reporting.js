import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
const canView = ["admin", "cfo", "risk_manager", "actuaire", "conseil"];

router.get("/", authRequired, requireRole(...canView), async (_req, res) => {
  res.json({
    ok: true,
    message: "Utiliser /api/reports pour la génération et le suivi des reportings.",
  });
});

export default router;
