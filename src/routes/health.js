import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "myoptiwealth-api",
    now: new Date().toISOString(),
  });
});

export default router;
