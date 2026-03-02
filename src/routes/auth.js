import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  findUserByEmail,
  getUserRoles,
  getUserActiveCaptiveMemberships,
} from "../db/userRepo.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password, captive_id } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "missing_credentials" });

  let requestedCaptiveId = null;
  if (captive_id !== undefined && captive_id !== null && captive_id !== "") {
    requestedCaptiveId = Number(captive_id);
    if (!Number.isInteger(requestedCaptiveId) || requestedCaptiveId <= 0) {
      return res.status(400).json({ error: "invalid_captive_id" });
    }
  }

  const user = await findUserByEmail(email);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  const roles = await getUserRoles(user.id);
  const memberships = await getUserActiveCaptiveMemberships(user.id);
  if (!memberships.length) {
    return res.status(403).json({ error: "no_active_captive_membership" });
  }

  let selectedMembership = null;
  if (requestedCaptiveId !== null) {
    selectedMembership = memberships.find((m) => Number(m.captive_id) === requestedCaptiveId) || null;
    if (!selectedMembership) {
      return res.status(403).json({ error: "invalid_captive_membership" });
    }
  } else if (memberships.length === 1) {
    selectedMembership = memberships[0];
  } else {
    return res.status(400).json({
      error: "captive_selection_required",
      captives: memberships.map((m) => ({
        id: m.captive_id,
        code: m.captive_code,
        name: m.captive_name,
        role: m.membership_role,
        is_owner: Boolean(m.is_owner),
      })),
    });
  }

  const token = jwt.sign(
    {
      sub: user.email,
      uid: user.id,
      roles,
      cid: selectedMembership.captive_id,
      crole: selectedMembership.membership_role,
      cown: Number(selectedMembership.is_owner) ? 1 : 0,
    },
    process.env.JWT_SECRET,
    {
    expiresIn: "12h",
    }
  );
  res.json({
    token,
    roles,
    captive: {
      id: selectedMembership.captive_id,
      code: selectedMembership.captive_code,
      name: selectedMembership.captive_name,
      role: selectedMembership.membership_role,
      is_owner: Boolean(selectedMembership.is_owner),
    },
  });
});

export default router;
