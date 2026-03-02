import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";

import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import authMeRouter from "./routes/authMe.js";
import dashboardRouter from "./routes/dashboard.js";
import usersRouter from "./routes/users.js";
import programmesRouter from "./routes/programmes.js";
import sinistresRouter from "./routes/sinistres.js";
import reportingRouter from "./routes/reporting.js";
import actuariatRouter from "./routes/actuariat.js";
import exportRouter from "./routes/export.js";
import auditRouter from "./routes/audit.js";
import jobsRouter from "./routes/jobs.js";
import reportsRouter from "./routes/reports.js";
import captiveRouter from "./routes/captive.js";
import captiveUsersRouter from "./routes/captiveUsers.js";
import partnersRouter from "./routes/partners.js";
import superadminRouter from "./routes/superadmin.js";
import primesRouter from "./routes/primes.js";
import pilotageRouter from "./routes/pilotage.js";
import qrtRouter from "./routes/qrt.js";

import { migrate } from "./db/migrate.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 1000);
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED === "true";

app.use(helmet());
app.set("trust proxy", 1);
const allowedOrigins = [
  "https://capitva-risks.com",
  "https://www.capitva-risks.com",
  "https://captiva-risks.com",
  "https://www.captiva-risks.com",
  "http://localhost:3200",
  "http://127.0.0.1:3200",
  "http://72.61.94.45:3200",
];
app.use(
  cors({
    origin: (o, cb) => (!o || allowedOrigins.includes(o) ? cb(null, true) : cb(new Error("CORS blocked"), false)),
    credentials: true,
  })
);
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});
if (rateLimitEnabled) {
  app.use(limiter);
}
app.use(express.json());

// Prépare le schéma (idempotent)
await migrate();

// Routes publiques
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/auth", authMeRouter);

// Routes protégées
app.use("/api/dashboard", dashboardRouter);
app.use("/api/users", usersRouter);
app.use("/api/programmes", programmesRouter);
app.use("/api/sinistres", sinistresRouter);
app.use("/api/reporting", reportingRouter);
app.use("/api/actuariat", actuariatRouter);
app.use("/api/export", exportRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/captive", captiveRouter);
app.use("/api/captive/users", captiveUsersRouter);
app.use("/api/partners", partnersRouter);
app.use("/api/superadmin", superadminRouter);
app.use("/api/primes", primesRouter);
app.use("/api/pilotage", pilotageRouter);
app.use("/api/qrt", qrtRouter);

// 404
app.use((req, res) => res.status(404).json({ error: "not_found" }));

app.listen(port, () => {
  console.log("CAPTIVA API listening on port " + port);
});
