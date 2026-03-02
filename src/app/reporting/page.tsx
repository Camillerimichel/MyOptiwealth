"use client";
import { useEffect, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";

type ReportJob = {
  id: number;
  report_type: string;
  format: string;
  status: string;
  file_path: string | null;
  captive_id: number | null;
  exercise: number | null;
  tz_name?: string | null;
  created_at: string;
};

type Template = {
  id: number;
  name: string;
  description: string | null;
  definition: any;
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

export default function ReportingPage() {
  const [reportFormat, setReportFormat] = useState("pdf");
  const [reportType, setReportType] = useState("standard");
  const [reportExercise, setReportExercise] = useState("");
  const [reportCaptiveId, setReportCaptiveId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<{ id: number; name: string }[]>([]);
  const [templateDetail, setTemplateDetail] = useState<Template | null>(null);
  const [lastReport, setLastReport] = useState<ReportJob | null>(null);
  const [recentReports, setRecentReports] = useState<ReportJob[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [pdfSummary, setPdfSummary] = useState(true);
  const [pdfTopSinistres, setPdfTopSinistres] = useState(true);
  const [pdfByStatus, setPdfByStatus] = useState(true);
  const [pdfByProgramme, setPdfByProgramme] = useState(true);
  const [scheduleAt, setScheduleAt] = useState("");
  const [tzOffset, setTzOffset] = useState<number>(new Date().getTimezoneOffset());
  const [tzName, setTzName] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [scheduledPage, setScheduledPage] = useState(1);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [createdByFilter, setCreatedByFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("queued");

  async function loadLast() {
    try {
      const me = await fetchWithToken<{ roles: string[] }>("/api/auth/me");
      setIsAdmin(me.roles?.includes("admin"));
      const reportsRes = await fetchWithToken<any>(`/api/reports?limit=${limit}&page=${page}`);
      const reports = Array.isArray(reportsRes) ? reportsRes : reportsRes.items || [];
      if (me.roles?.includes("admin")) {
        const tpls = await fetchWithToken<any>("/api/reports/templates");
        setTemplates(Array.isArray(tpls) ? tpls : []);
      } else {
        setTemplates([]);
      }
      setLastReport(reports[0] || null);
      setRecentReports(reports);
      if (!Array.isArray(reportsRes)) setTotal(reportsRes.total || 0);
      const schedParams = new URLSearchParams();
      schedParams.set("limit", "10");
      schedParams.set("page", String(scheduledPage));
      if (createdByFilter) schedParams.set("created_by", createdByFilter);
      if (statusFilter) schedParams.set("status", statusFilter);
      const schedRes = await fetchWithToken<any>(
        `/api/reports/scheduled?${schedParams.toString()}`
      );
      const schedItems = Array.isArray(schedRes) ? schedRes : schedRes.items || [];
      setScheduled(schedItems);
      if (!Array.isArray(schedRes)) setScheduledTotal(schedRes.total || 0);
    } catch (err: any) {
      setError(err.message || "Erreur");
    }
  }

  useEffect(() => {
    loadLast();
  }, [page, scheduledPage, createdByFilter, statusFilter]);

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
        template_override:
          reportFormat === "pdf"
            ? {
                pdf: {
                  include_summary: pdfSummary,
                  include_top_sinistres: pdfTopSinistres,
                  include_by_status: pdfByStatus,
                  include_by_programme: pdfByProgramme,
                },
              }
            : null,
      });
      const report = await fetchWithToken<ReportJob>(`/api/reports/${res.report_job_id}`);
      setLastReport(report);
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplateDetail(id: string) {
    if (!id || !isAdmin) {
      setTemplateDetail(null);
      return;
    }
    try {
      const tpl = await fetchWithToken<Template>(`/api/reports/templates/${id}`);
      setTemplateDetail(tpl);
    } catch (err: any) {
      setError(err.message || "Erreur");
    }
  }

  async function previewReport() {
    try {
      setLoading(true);
      setError(null);
      const res = await postWithToken<any>("/api/reports/preview", {
        template_id: templateId ? Number(templateId) : null,
        exercise: reportExercise ? Number(reportExercise) : null,
        captive_id: reportCaptiveId ? Number(reportCaptiveId) : null,
        limit: 5,
        template_override: {
          pdf: {
            include_summary: pdfSummary,
            include_top_sinistres: pdfTopSinistres,
            include_by_status: pdfByStatus,
            include_by_programme: pdfByProgramme,
          },
        },
      });
      setPreview(res);
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function scheduleReport() {
    if (!scheduleAt) {
      setError("Date/heure de planification requise");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await postWithToken("/api/reports/schedule", {
        report_type: reportType,
        format: reportFormat,
        exercise: reportExercise ? Number(reportExercise) : null,
        captive_id: reportCaptiveId ? Number(reportCaptiveId) : null,
        template_id: templateId ? Number(templateId) : null,
        template_override:
          reportFormat === "pdf"
            ? {
                pdf: {
                  include_summary: pdfSummary,
                  include_top_sinistres: pdfTopSinistres,
                  include_by_status: pdfByStatus,
                  include_by_programme: pdfByProgramme,
                },
              }
            : null,
        scheduled_at: scheduleAt,
        tz_offset_minutes: tzOffset,
        tz_name: tzName,
      });
      await loadLast();
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

  async function downloadReport(report: ReportJob) {
    try {
      const token = localStorage.getItem("captiva_token");
      const res = await fetch(`/api/reports/${report.id}/download`, {
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
      a.download = `report_${report.id}.${report.format === "pdf" ? "pdf" : report.format === "xlsx" ? "xlsx" : "json"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Erreur");
    }
  }

  async function rerunReport(reportId: number) {
    try {
      setLoading(true);
      setError(null);
      await postWithToken(`/api/reports/${reportId}/rerun`, {});
      await loadLast();
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <PageTitle title="Reporting" description="Génération, historique et téléchargement des rapports produits." />
          <button
            onClick={loadLast}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          >
            Rafraîchir
          </button>
        </div>

        {error && <p className="text-sm text-red-600">Erreur: {error}</p>}

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold">Générer un report</div>
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
              onChange={(e) => {
                setTemplateId(e.target.value);
                loadTemplateDetail(e.target.value);
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1"
            >
              <option value="">Standard</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={pdfSummary}
                  onChange={(e) => setPdfSummary(e.target.checked)}
                />
                Summary
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={pdfTopSinistres}
                  onChange={(e) => setPdfTopSinistres(e.target.checked)}
                />
                Top sinistres
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={pdfByStatus}
                  onChange={(e) => setPdfByStatus(e.target.checked)}
                />
                Par statut
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={pdfByProgramme}
                  onChange={(e) => setPdfByProgramme(e.target.checked)}
                />
                Par programme
              </label>
            </div>
            <button
              onClick={enqueueReport}
              className="rounded-md border border-slate-200 bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              Lancer
            </button>
            <button
              onClick={previewReport}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
            >
              Prévisualiser
            </button>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            />
            <label className="text-slate-600">Timezone (UTC offset min)</label>
            <input
              type="number"
              value={tzOffset}
              onChange={(e) => setTzOffset(Number(e.target.value))}
              className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            />
            <label className="text-slate-600">Timezone (IANA)</label>
            <input
              value={tzName}
              onChange={(e) => setTzName(e.target.value)}
              list="iana-timezones"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            />
            <datalist id="iana-timezones">
              <option value="UTC" />
              <option value="Europe/Paris" />
              <option value="Europe/London" />
              <option value="America/New_York" />
              <option value="America/Chicago" />
              <option value="America/Los_Angeles" />
              <option value="Asia/Dubai" />
              <option value="Asia/Singapore" />
            </datalist>
            <button
              onClick={scheduleReport}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
            >
              Planifier
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

        {isAdmin && templateDetail && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold">Template sélectionné</div>
            <div className="text-xs text-slate-600">{templateDetail.name}</div>
            <pre className="mt-2 overflow-auto rounded bg-slate-50 p-3 text-xs">
              {JSON.stringify(templateDetail.definition, null, 2)}
            </pre>
          </div>
        )}

        {preview && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold">Prévisualisation (extrait)</div>
            <div className="mt-2 space-y-3">
              {Object.entries(preview.preview || {}).map(([name, rows]: any) => (
                <div key={name} className="overflow-auto rounded border border-slate-100">
                  <div className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-600">
                    {name}
                  </div>
                  <table className="min-w-full text-xs">
                    <thead className="bg-white text-left text-[10px] uppercase text-slate-500">
                      <tr>
                        {rows?.[0] ? Object.keys(rows[0]).map((k: string) => (
                          <th key={k} className="px-2 py-1">{k}</th>
                        )) : (
                          <th className="px-2 py-1">Aucune donnée</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(rows || []).map((r: any, idx: number) => (
                        <tr key={idx} className="border-t border-slate-100">
                          {Object.keys(r).map((k) => (
                            <td key={k} className="px-2 py-1">{String(r[k])}</td>
                          ))}
                        </tr>
                      ))}
                      {!rows?.length && (
                        <tr>
                          <td className="px-2 py-2 text-slate-500">Aucun enregistrement.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">
            10 derniers reports
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2">Exercice</th>
                  <th className="px-3 py-2">Captive</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentReports.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.id}</td>
                    <td className="px-3 py-2">{r.report_type}</td>
                    <td className="px-3 py-2">{r.format}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{r.exercise ?? "—"}</td>
                    <td className="px-3 py-2">{r.captive_id ?? "—"}</td>
                    <td className="px-3 py-2">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <details className="inline-block">
                        <summary className="cursor-pointer rounded-md border border-slate-200 px-2 py-1 text-xs">
                          Actions
                        </summary>
                        <div className="mt-1 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-sm">
                          <button
                            onClick={() => {
                              (document.activeElement as HTMLElement | null)?.blur();
                              if (r.file_path) downloadReport(r);
                            }}
                            className="block w-full px-2 py-1 text-left hover:bg-slate-50 disabled:opacity-50"
                            disabled={!r.file_path}
                          >
                            Télécharger
                          </button>
                          <button
                            onClick={() => {
                              if (confirm("Relancer ce report ?")) rerunReport(r.id);
                            }}
                            className="block w-full px-2 py-1 text-left hover:bg-slate-50"
                          >
                            Re-run
                          </button>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
                {!recentReports.length && (
                  <tr>
                    <td className="px-3 py-4 text-sm text-slate-500" colSpan={8}>
                      Aucun report.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm">
            <span className="text-slate-600">
              Page {page} · Total {total || recentReports.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                disabled={page === 1}
              >
                Précédent
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                disabled={total ? page * limit >= total : false}
              >
                Suivant
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">
            Reports planifiés
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <label className="text-slate-600">Filtrer par créateur</label>
            <input
              value={createdByFilter}
              onChange={(e) => setCreatedByFilter(e.target.value)}
              placeholder="email ou id"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            />
            <label className="text-slate-600">Statut</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            >
              <option value="">Tous</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2">Exercice</th>
                  <th className="px-3 py-2">Captive</th>
                  <th className="px-3 py-2">Créé par</th>
                  <th className="px-3 py-2">Timezone</th>
                  <th className="px-3 py-2">Planifié</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.id}</td>
                    <td className="px-3 py-2">{r.report_type}</td>
                    <td className="px-3 py-2">{r.format}</td>
                    <td className="px-3 py-2">{r.job_status || r.status}</td>
                    <td className="px-3 py-2">{r.exercise ?? "—"}</td>
                    <td className="px-3 py-2">{r.captive_id ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.created_by_email || r.created_by_user_id || "—"}
                    </td>
                    <td className="px-3 py-2">{r.tz_name || "—"}</td>
                    <td className="px-3 py-2">
                      {r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={async () => {
                          try {
                            if (!confirm("Annuler ce report planifié ?")) return;
                            await fetch(`/api/reports/scheduled/${r.id}`, {
                              method: "DELETE",
                              headers: {
                                Authorization: `Bearer ${localStorage.getItem("captiva_token") || ""}`,
                              },
                            });
                            await loadLast();
                          } catch (err: any) {
                            setError(err.message || "Erreur");
                          }
                        }}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
                      >
                        Annuler
                      </button>
                    </td>
                  </tr>
                ))}
                {!scheduled.length && (
                  <tr>
                    <td className="px-3 py-4 text-sm text-slate-500" colSpan={10}>
                      Aucun report planifié.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm">
            <span className="text-slate-600">
              Page {scheduledPage} · Total {scheduledTotal || scheduled.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScheduledPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                disabled={scheduledPage === 1}
              >
                Précédent
              </button>
              <button
                onClick={() => setScheduledPage((p) => p + 1)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                disabled={scheduledTotal ? scheduledPage * 10 >= scheduledTotal : false}
              >
                Suivant
              </button>
            </div>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
