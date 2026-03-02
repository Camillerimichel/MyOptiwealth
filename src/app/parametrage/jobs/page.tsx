"use client";
import { useEffect, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";

type JobHealth = {
  queue_size: number;
  running_count: number;
  failed_count: number;
  last_done: string | null;
};

type JobItem = {
  id: number;
  type: string;
  status: string;
  tries: number;
  last_error: string | null;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type ReportJob = {
  id: number;
  report_type: string;
  format: string;
  status: string;
  file_path: string | null;
  captive_id: number | null;
  exercise: number | null;
  created_at: string;
};

async function fetchWithToken<T>(url: string): Promise<T> {
  const token = localStorage.getItem("captiva_token");
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function postWithToken<T>(url: string, body: any): Promise<T> {
  const token = localStorage.getItem("captiva_token");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export default function JobsPage() {
  const [health, setHealth] = useState<JobHealth | null>(null);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [type, setType] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [reportFormat, setReportFormat] = useState<string>("pdf");
  const [reportType, setReportType] = useState<string>("standard");
  const [reportExercise, setReportExercise] = useState<string>("");
  const [reportCaptiveId, setReportCaptiveId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [templates, setTemplates] = useState<{ id: number; name: string }[]>([]);
  const [lastReport, setLastReport] = useState<ReportJob | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const me = await fetchWithToken<{ roles: string[] }>("/api/auth/me");
      setIsAdmin(me.roles?.includes("admin"));
      const h = await fetchWithToken<JobHealth>("/api/jobs/health");
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      if (limit) params.set("limit", String(limit));
      const q = params.toString() ? `?${params.toString()}` : "";
      const j = await fetchWithToken<JobItem[]>(`/api/jobs${q}`);
      const reportsRes = await fetchWithToken<any>(`/api/reports?limit=1`);
      const reports = Array.isArray(reportsRes) ? reportsRes : reportsRes.items || [];
      const tpls = await fetchWithToken<any>("/api/reports/templates");
      setTemplates(Array.isArray(tpls) ? tpls : []);
      setHealth(h);
      setJobs(j);
      setLastReport(reports[0] || null);
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status, type, limit]);

  async function enqueueReport() {
    try {
      setLoading(true);
      setError(null);
      const res = await postWithToken<{ report_job_id: number }>("/api/reports", {
        report_type: reportType,
        format: reportFormat,
        exercise: reportExercise ? Number(reportExercise) : null,
        captive_id: reportCaptiveId ? Number(reportCaptiveId) : null,
        template_id: templateId ? Number(templateId) : null,
      });
      const report = await fetchWithToken<ReportJob>(`/api/reports/${res.report_job_id}`);
      setLastReport(report);
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function downloadLastReport() {
    if (!lastReport) return;
    try {
      const token = localStorage.getItem("captiva_token");
      const res = await fetch(`/api/reports/${lastReport.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || "Erreur download";
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report_${lastReport.id}.${lastReport.format === "pdf" ? "pdf" : lastReport.format === "xlsx" ? "xlsx" : "json"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Erreur");
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle title="Monitoring Jobs" />
          <button
            onClick={load}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          >
            Rafraîchir
          </button>
        </div>

        {error && <p className="text-sm text-red-600">Erreur: {error}</p>}
        {!isAdmin && !loading && (
          <p className="text-sm text-slate-600">Accès réservé aux administrateurs.</p>
        )}

        {isAdmin && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold">Lancer un report</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <label className="text-slate-600">Type</label>
              <input
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1"
              />
              <label className="text-slate-600">Format</label>
              <select
                value={reportFormat}
                onChange={(e) => setReportFormat(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1"
              >
                <option value="pdf">pdf</option>
                <option value="xlsx">xlsx</option>
                <option value="csv">csv</option>
                <option value="json">json</option>
              </select>
              <label className="text-slate-600">Exercice</label>
              <input
                value={reportExercise}
                onChange={(e) => setReportExercise(e.target.value)}
                placeholder="2026"
                className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1"
              />
              <label className="text-slate-600">Captive ID</label>
              <input
                value={reportCaptiveId}
                onChange={(e) => setReportCaptiveId(e.target.value)}
                placeholder="1"
                className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1"
              />
              <label className="text-slate-600">Template</label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1"
              >
                <option value="">Standard</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={enqueueReport}
                className="rounded-md border border-slate-200 bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                Lancer
              </button>
              {lastReport && (
                <span className="text-slate-600">
                  Dernier report: #{lastReport.id} ({lastReport.status})
                  {lastReport.exercise ? ` • Ex ${lastReport.exercise}` : ""}
                  {lastReport.captive_id ? ` • Captive ${lastReport.captive_id}` : ""}
                </span>
              )}
              {lastReport?.file_path && (
                <button
                  onClick={downloadLastReport}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
                >
                  Télécharger
                </button>
              )}
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Queue</div>
            <div className="text-lg font-semibold">{health?.queue_size ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">Running</div>
            <div className="text-lg font-semibold">{health?.running_count ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">Failed (24h)</div>
            <div className="text-lg font-semibold">{health?.failed_count ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">Dernier job terminé</div>
            <div className="text-sm font-medium">
              {health?.last_done ? new Date(health.last_done).toLocaleString() : "—"}
            </div>
          </div>
          </div>
        )}

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-slate-600">Filtre statut</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1"
          >
            <option value="">Tous</option>
            <option value="queued">queued</option>
            <option value="running">running</option>
            <option value="done">done</option>
            <option value="failed">failed</option>
          </select>
          <label className="text-slate-600">Type</label>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="report_generate"
            className="rounded-md border border-slate-200 bg-white px-2 py-1"
          />
          <label className="text-slate-600">Limite</label>
          <input
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 50)}
            type="number"
            min={1}
            max={200}
            className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1"
          />
          {loading && <span className="text-slate-500">Chargement…</span>}
          </div>
        )}

        {isAdmin && (
          <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Tries</th>
                <th className="px-3 py-2">Planifié</th>
                <th className="px-3 py-2">Début</th>
                <th className="px-3 py-2">Fin</th>
                <th className="px-3 py-2">Erreur</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{j.id}</td>
                  <td className="px-3 py-2">{j.type}</td>
                  <td className="px-3 py-2">{j.status}</td>
                  <td className="px-3 py-2">{j.tries}</td>
                  <td className="px-3 py-2">{new Date(j.scheduled_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {j.started_at ? new Date(j.started_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-red-600">
                    {j.last_error || "—"}
                  </td>
                </tr>
              ))}
              {!jobs.length && (
                <tr>
                  <td className="px-3 py-4 text-sm text-slate-500" colSpan={8}>
                    Aucun job.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
