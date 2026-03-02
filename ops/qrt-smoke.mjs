#!/usr/bin/env node
import process from "node:process";

const BASE_URL = String(process.env.API_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const EMAIL = String(process.env.SMOKE_EMAIL || process.env.ADMIN_EMAIL || "admin@myoptiwealth.local");
const PASSWORD = String(process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || "ChangeMe123!");
const CAPTIVE_ID = process.env.SMOKE_CAPTIVE_ID == null ? null : Number(process.env.SMOKE_CAPTIVE_ID);
const TOKEN_OVERRIDE = String(process.env.SMOKE_TOKEN || "").trim();
const STRICT = String(process.env.SMOKE_STRICT || "false").toLowerCase() === "true";

let failures = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonRequest(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const rsp = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await rsp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: rsp.status, ok: rsp.ok, data };
}

function logStep(name, ok, detail = "") {
  const prefix = ok ? "[OK]" : "[KO]";
  const suffix = detail ? ` ${detail}` : "";
  console.log(`${prefix} ${name}${suffix}`);
}

function expectStatus(name, response, acceptedStatuses) {
  const accepted = new Set(acceptedStatuses);
  const ok = accepted.has(response.status);
  logStep(name, ok, `status=${response.status}`);
  if (!ok) {
    failures += 1;
    console.log("  response:", JSON.stringify(response.data));
  }
  return ok;
}

async function main() {
  console.log(`QRT smoke on ${BASE_URL} (strict=${STRICT ? "on" : "off"})`);

  let token = TOKEN_OVERRIDE;
  if (!token) {
    const loginPayload = { email: EMAIL, password: PASSWORD };
    if (Number.isInteger(CAPTIVE_ID) && CAPTIVE_ID > 0) loginPayload.captive_id = CAPTIVE_ID;
    const login = await jsonRequest("/api/auth/login", { method: "POST", body: loginPayload });
    if (!expectStatus("auth/login", login, [200])) process.exit(1);
    token = login.data?.token;
    if (!token) {
      console.log("No token in login response.");
      process.exit(1);
    }
  } else {
    logStep("auth/token override", true);
  }

  const me = await jsonRequest("/api/auth/me", { token });
  expectStatus("auth/me", me, [200]);

  const governanceGet = await jsonRequest("/api/qrt/governance", { token });
  expectStatus("qrt/governance GET", governanceGet, [200]);

  const governancePut = await jsonRequest("/api/qrt/governance", {
    method: "PUT",
    token,
    body: { require_double_validation: false },
  });
  expectStatus("qrt/governance PUT", governancePut, [200]);

  const guardrailsGet = await jsonRequest("/api/qrt/guardrails?source=real", { token });
  expectStatus("qrt/guardrails GET", guardrailsGet, [200]);

  const guardrailsPut = await jsonRequest("/api/qrt/guardrails", {
    method: "PUT",
    token,
    body: {
      source: "real",
      max_delta_scr_eur: 1000000000,
      max_delta_mcr_eur: 1000000000,
      max_delta_own_funds_eur: 1000000000,
      max_ratio_drop_pct: 100,
      block_on_breach: false,
    },
  });
  expectStatus("qrt/guardrails PUT", guardrailsPut, [200]);

  const health = await jsonRequest("/api/qrt/health", { token });
  expectStatus("qrt/health", health, STRICT ? [200] : [200, 503]);

  const dashboard = await jsonRequest("/api/qrt/dashboard", { token });
  expectStatus("qrt/dashboard", dashboard, [200]);

  const compliance = await jsonRequest("/api/qrt/compliance/status", { token });
  expectStatus("qrt/compliance/status", compliance, STRICT ? [200] : [200, 409]);

  const runs = await jsonRequest("/api/qrt/workflow/runs", { token });
  expectStatus("qrt/workflow/runs", runs, [200]);

  const events = await jsonRequest("/api/qrt/events", { token });
  expectStatus("qrt/events", events, [200]);

  const archiveLogs = await jsonRequest("/api/qrt/archive/logs", { token });
  expectStatus("qrt/archive/logs", archiveLogs, [200]);

  const hooksBefore = await jsonRequest("/api/qrt/webhooks", { token });
  expectStatus("qrt/webhooks GET", hooksBefore, [200]);

  const createdHook = await jsonRequest("/api/qrt/webhooks", {
    method: "POST",
    token,
    body: {
      event_code: "smoke.test",
      target_url: `${BASE_URL}/health`,
      secret_token: "smoke-secret",
    },
  });
  if (expectStatus("qrt/webhooks POST", createdHook, [201])) {
    const webhookId = Number(createdHook.data?.webhook_id || 0);
    if (webhookId > 0) {
      const updatedHook = await jsonRequest(`/api/qrt/webhooks/${webhookId}`, {
        method: "PUT",
        token,
        body: { is_active: false },
      });
      expectStatus("qrt/webhooks PUT", updatedHook, [200]);

      const deletedHook = await jsonRequest(`/api/qrt/webhooks/${webhookId}`, {
        method: "DELETE",
        token,
      });
      expectStatus("qrt/webhooks DELETE", deletedHook, [200]);
    }
  }

  const exportsList = await jsonRequest("/api/qrt/export/list?limit=1", { token });
  expectStatus("qrt/export/list", exportsList, [200]);
  const latestExport = exportsList.data?.items?.[0] || null;
  if (latestExport?.id) {
    const exportId = Number(latestExport.id);
    const snapshotDate = String(latestExport.snapshot_date || "").slice(0, 10);
    const verify = await jsonRequest(`/api/qrt/export/${exportId}/verify-integrity`, { token });
    expectStatus("qrt/export/:id/verify-integrity", verify, STRICT ? [200] : [200, 409]);

    if (snapshotDate) {
      const guardCheck = await jsonRequest("/api/qrt/guardrails/check", {
        method: "POST",
        token,
        body: { source: "real", snapshot_date: snapshotDate },
      });
      expectStatus("qrt/guardrails/check", guardCheck, STRICT ? [200] : [200, 422]);

      const compare = await jsonRequest(`/api/qrt/comparison/real-vs-simulation?snapshot_date=${snapshotDate}`, { token });
      expectStatus("qrt/comparison/real-vs-simulation", compare, STRICT ? [200] : [200, 400]);
    }

    const approvals = await jsonRequest("/api/qrt/approvals?status=pending", { token });
    expectStatus("qrt/approvals", approvals, [200]);

    const approvalReq = await jsonRequest("/api/qrt/approvals/request", {
      method: "POST",
      token,
      body: { export_id: exportId, comment_text: "smoke approval request" },
    });
    expectStatus("qrt/approvals/request", approvalReq, STRICT ? [201] : [201, 409, 404]);

    const prepareSubmission = await jsonRequest("/api/qrt/submissions/prepare", {
      method: "POST",
      token,
      body: { export_id: exportId },
    });
    expectStatus("qrt/submissions/prepare", prepareSubmission, STRICT ? [201] : [201, 400, 404, 409]);
  } else {
    if (STRICT) {
      logStep("export-dependent checks", false, "no export found");
      failures += 1;
    } else {
      logStep("export-dependent checks", true, "skipped (no export yet)");
    }
  }

  const submissions = await jsonRequest("/api/qrt/submissions", { token });
  expectStatus("qrt/submissions GET", submissions, [200]);
  const latestSubmission = submissions.data?.items?.[0] || null;
  if (latestSubmission?.id) {
    const subDownload = await jsonRequest(`/api/qrt/submissions/${Number(latestSubmission.id)}/download`, { token });
    expectStatus("qrt/submissions/:id/download", subDownload, STRICT ? [200] : [200, 404]);
  }

  const runsAfter = await jsonRequest("/api/qrt/workflow/runs", { token });
  if (expectStatus("qrt/workflow/runs refresh", runsAfter, [200])) {
    const runId = Number(runsAfter.data?.items?.[0]?.id || 0);
    if (runId > 0) {
      const runGet = await jsonRequest(`/api/qrt/workflow/runs/${runId}`, { token });
      expectStatus("qrt/workflow/runs/:id", runGet, STRICT ? [200] : [200, 404]);
    }
  }

  const eventList = await jsonRequest("/api/qrt/events", { token });
  if (expectStatus("qrt/events refresh", eventList, [200])) {
    const eventId = Number(eventList.data?.items?.[0]?.id || 0);
    if (eventId > 0) {
      const replay = await jsonRequest(`/api/qrt/events/${eventId}/replay`, { method: "POST", token });
      expectStatus("qrt/events/:id/replay", replay, STRICT ? [200] : [200, 404]);
    }
  }

  await sleep(50);
  if (failures > 0) {
    console.log(`QRT smoke done with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log("QRT smoke done.");
}

main().catch((err) => {
  console.error("Smoke failed:", err?.message || err);
  process.exit(1);
});
