#!/usr/bin/env node
import "dotenv/config";
import process from "node:process";
import express from "express";
import nodemailer from "nodemailer";

const app = express();
app.use(express.json({ limit: "128kb" }));

const PORT = Math.max(1, Number(process.env.MAIL_GATEWAY_PORT || 8787));
const HOST = String(process.env.MAIL_GATEWAY_HOST || "127.0.0.1").trim() || "127.0.0.1";
const PATH_ALERT = String(process.env.MAIL_GATEWAY_PATH || "/qrt-alert").trim() || "/qrt-alert";
const TOKEN = String(process.env.MAIL_GATEWAY_TOKEN || "").trim();
const PROVIDER = String(process.env.MAIL_PROVIDER || "smtp").trim().toLowerCase();

const FROM_EMAIL = String(process.env.MAIL_FROM_EMAIL || "").trim();
const FROM_NAME = String(process.env.MAIL_FROM_NAME || "CAPTIVA").trim();

const SMTP_HOST = String(process.env.MAIL_SMTP_HOST || "").trim();
const SMTP_PORT = Math.max(1, Number(process.env.MAIL_SMTP_PORT || 587));
const SMTP_USER = String(process.env.MAIL_SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.MAIL_SMTP_PASS || "").trim();

const BREVO_API_KEY = String(process.env.BREVO_API_KEY || "").trim();

let smtpTransport = null;

function mask(input) {
  const s = String(input || "");
  if (!s) return "<empty>";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

function parseRecipients(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => String(x || "").trim().toLowerCase())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

function authOk(req) {
  if (!TOKEN) return true;
  const headerToken = String(req.get("x-captiva-token") || "").trim();
  const auth = String(req.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return headerToken === TOKEN || bearer === TOKEN;
}

async function sendViaSmtp({ to, subject, text }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
    throw new Error("smtp_config_incomplete");
  }
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  const from = FROM_NAME ? `${FROM_NAME} <${FROM_EMAIL}>` : FROM_EMAIL;
  const info = await smtpTransport.sendMail({
    from,
    to: to.join(","),
    subject,
    text,
  });
  return { provider: "smtp", id: String(info?.messageId || "smtp_sent") };
}

async function sendViaBrevo({ to, subject, text }) {
  if (!BREVO_API_KEY || !FROM_EMAIL) {
    throw new Error("brevo_config_incomplete");
  }
  const rsp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { email: FROM_EMAIL, name: FROM_NAME || undefined },
      to: to.map((email) => ({ email })),
      subject,
      textContent: text,
    }),
  });
  const bodyText = await rsp.text();
  if (!rsp.ok) {
    throw new Error(`brevo_http_${rsp.status}:${bodyText.slice(0, 300)}`);
  }
  return { provider: "brevo", id: bodyText.slice(0, 300) || "brevo_sent" };
}

async function dispatchMail(payload) {
  if (PROVIDER === "brevo") return sendViaBrevo(payload);
  return sendViaSmtp(payload);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    path: PATH_ALERT,
    token_required: Boolean(TOKEN),
  });
});

app.post(PATH_ALERT, async (req, res) => {
  if (!authOk(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const to = parseRecipients(req.body?.to);
  const subject = String(req.body?.subject || "QRT alert").trim().slice(0, 255);
  const text = String(req.body?.text || "").slice(0, 30000);

  if (!to.length) return res.status(400).json({ error: "to_invalid" });
  if (!subject) return res.status(400).json({ error: "subject_missing" });

  try {
    const sent = await dispatchMail({ to, subject, text });
    return res.json({ ok: true, ...sent });
  } catch (err) {
    const msg = String(err?.message || "send_failed").slice(0, 500);
    return res.status(502).json({ error: msg });
  }
});

app.listen(PORT, HOST, () => {
  const cfg = {
    host: HOST,
    port: PORT,
    path: PATH_ALERT,
    provider: PROVIDER,
    token_required: Boolean(TOKEN),
    from_email: mask(FROM_EMAIL),
    smtp_host: mask(SMTP_HOST),
    smtp_user: mask(SMTP_USER),
    brevo_key: mask(BREVO_API_KEY),
  };
  console.log(JSON.stringify({ ok: true, service: "captiva-mail-gateway", config: cfg }, null, 2));
});
