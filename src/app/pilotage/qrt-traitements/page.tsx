"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import { apiRequest } from "@/lib/api";

type WorkflowRun = {
  id: number;
  source: "real" | "simulation";
  snapshot_date: string;
  status: "running" | "success" | "failed";
};

type ExportItem = {
  id: number;
  source: "real" | "simulation";
  snapshot_date: string;
  taxonomy_version: string | null;
  jurisdiction: string | null;
  facts_count: number | null;
  status: "draft" | "published";
  created_at: string;
};

type SubmissionItem = {
  export_id: number;
  status: "ready" | "submitted" | "failed";
  prepared_at: string | null;
  submitted_at: string | null;
};

type ApprovalItem = {
  export_id: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

type FactItem = {
  template_code: string;
  concept_code: string;
  value_decimal: number | string;
};

type Cycle = "quarterly" | "annual";

type PeriodRow = {
  key: string;
  cycle: Cycle;
  label: string;
  dueDate: string;
  year: number;
  exportItem: ExportItem | null;
  workflowStatus: "running" | "success" | "failed" | "none";
  approvalStatus: "pending" | "approved" | "rejected" | "none";
  submissionStatus: "ready" | "submitted" | "failed" | "none";
  progress: number;
  stageLabel: string;
};

type Preview = {
  ownFunds: number | null;
  scr: number | null;
  mcr: number | null;
  coverageRatio: number | null;
  templates: Array<{ code: string; label: string; concepts: number }>;
};

type CycleGuide = {
  title: string;
  subtitle: string;
  dueRule: string;
  obligations: Array<{ code: string; label: string; detail: string }>;
  executionNotes: string[];
};

type TriggerZoneKey = "taxonomy" | "jurisdiction" | "facts" | "status";

const QRT_TEMPLATE_LABELS: Record<string, string> = {
  "S.02.01": "Bilan prudentiel",
  "S.23.01": "Fonds propres",
  "S.25.01": "SCR",
  "S.28.01": "MCR",
};

const TRIGGER_ZONE_HELP: Record<TriggerZoneKey, { title: string; detail: string }> = {
  taxonomy: {
    title: "Taxonomie",
    detail: "Version du dictionnaire XBRL utilisée pour générer les QRT. Elle doit correspondre au référentiel attendu par le régulateur.",
  },
  jurisdiction: {
    title: "Juridiction",
    detail: "Code pays/régulateur cible de l'export (ex: FR). Il détermine le périmètre réglementaire appliqué lors du traitement.",
  },
  facts: {
    title: "Nb facts",
    detail: "Nombre de faits XBRL produits dans l'export. C'est un indicateur de volumétrie et de complétude des données calculées.",
  },
  status: {
    title: "Statut export",
    detail: "État de l'export QRT: brouillon ou publié. Seul un export publié est destiné à la chaîne de validation/soumission finale.",
  },
};

const CYCLE_GUIDES: Record<Cycle, CycleGuide> = {
  quarterly: {
    title: "Tâches trimestrielles - QRT obligatoires",
    subtitle: "Socle prudentiel minimum à produire à chaque trimestre civil.",
    dueRule: "Échéance de référence: fin de trimestre (31/03, 30/06, 30/09, 31/12).",
    obligations: [
      { code: "S.02.01", label: "Bilan prudentiel", detail: "Etat des actifs, passifs et provisions techniques." },
      { code: "S.23.01", label: "Fonds propres", detail: "Niveau et qualité des fonds propres éligibles." },
      { code: "S.25.01", label: "SCR", detail: "Exigence de capital de solvabilité (SCR total)." },
      { code: "S.28.01", label: "MCR", detail: "Exigence minimale de capital (MCR)." },
    ],
    executionNotes: [
      "Lancer build + validation + export pour le snapshot de fin de trimestre.",
      "Obtenir validation interne avant soumission.",
      "Conserver les preuves (horodatage, export, statut de soumission).",
    ],
  },
  annual: {
    title: "Tâches annuelles - QRT obligatoires",
    subtitle: "Production de clôture annuelle avec les mêmes états prudentiels sur l'arrêté de fin d'année.",
    dueRule: "Échéance de référence: clôture annuelle au 31/12 (avec cycle de validation et soumission annuel).",
    obligations: [
      { code: "S.02.01", label: "Bilan prudentiel annuel", detail: "Photographie prudentielle complète à l'arrêté annuel." },
      { code: "S.23.01", label: "Fonds propres annuels", detail: "Niveau de fonds propres retenu pour la clôture annuelle." },
      { code: "S.25.01", label: "SCR annuel", detail: "Mesure SCR de fin d'exercice utilisée pour la couverture." },
      { code: "S.28.01", label: "MCR annuel", detail: "Mesure MCR de fin d'exercice." },
    ],
    executionNotes: [
      "Lancer le traitement sur snapshot 31/12 avec contrôles renforcés.",
      "Tracer les validations, rejets éventuels et corrections avant soumission finale.",
      "Archiver les éléments de preuve pour audit/régulateur.",
    ],
  },
};

function fmtTs(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR");
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

function parseYmd(v: string) {
  return new Date(`${v}T00:00:00Z`);
}

function toYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function endOfQuarter(year: number, quarter: number) {
  const month = quarter * 3;
  const d = new Date(Date.UTC(year, month, 0));
  return toYmd(d);
}

function endOfYear(year: number) {
  return `${year}-12-31`;
}

function quarterOfDate(d: Date) {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}

function quarterLabel(year: number, quarter: number) {
  return `T${quarter} ${year}`;
}

function badgeTone(status: string) {
  if (["failed", "rejected"].includes(status)) return "bg-rose-100 text-rose-700";
  if (["running", "pending", "ready", "draft"].includes(status)) return "bg-amber-100 text-amber-700";
  if (["success", "approved", "submitted", "published"].includes(status)) return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function uiStatus(status: string) {
  const map: Record<string, string> = {
    none: "n/a",
    running: "en cours",
    success: "succès",
    failed: "échec",
    pending: "en attente",
    approved: "approuvée",
    rejected: "rejetée",
    ready: "prête",
    submitted: "soumise",
    draft: "brouillon",
    published: "publiée",
  };
  return map[status] || status;
}

function calcProgress(
  workflowStatus: PeriodRow["workflowStatus"],
  approvalStatus: PeriodRow["approvalStatus"],
  submissionStatus: PeriodRow["submissionStatus"]
) {
  let progress = 0;
  if (workflowStatus === "running") progress = 25;
  if (workflowStatus === "success") progress = 45;
  if (approvalStatus === "pending") progress = 60;
  if (approvalStatus === "approved") progress = 75;
  if (submissionStatus === "ready") progress = 85;
  if (submissionStatus === "submitted") progress = 100;
  if (workflowStatus === "failed" || approvalStatus === "rejected" || submissionStatus === "failed") progress = Math.max(progress, 35);
  return progress;
}

function stageLabel(row: Pick<PeriodRow, "workflowStatus" | "approvalStatus" | "submissionStatus">) {
  if (row.submissionStatus === "submitted") return "Soumis régulateur";
  if (row.submissionStatus === "failed") return "Échec soumission";
  if (row.submissionStatus === "ready") return "Prêt à soumettre";
  if (row.approvalStatus === "approved") return "Validation interne OK";
  if (row.approvalStatus === "pending") return "Validation interne";
  if (row.approvalStatus === "rejected") return "Validation rejetée";
  if (row.workflowStatus === "success") return "Traitement terminé";
  if (row.workflowStatus === "running") return "Traitement en cours";
  if (row.workflowStatus === "failed") return "Échec traitement";
  return "À lancer";
}

function normalizeApprovalStatus(v: string | undefined): PeriodRow["approvalStatus"] {
  if (v === "pending" || v === "approved" || v === "rejected") return v;
  return "none";
}

function normalizeSubmissionStatus(v: string | undefined): PeriodRow["submissionStatus"] {
  if (v === "ready" || v === "submitted" || v === "failed") return v;
  return "none";
}

export default function QrtTraitementsPage() {
  const [cycle, setCycle] = useState<Cycle>("quarterly");
  const [hoverGuide, setHoverGuide] = useState<Cycle | null>(null);
  const [hoverZone, setHoverZone] = useState<TriggerZoneKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [rows, setRows] = useState<PeriodRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [exportsRsp, runsRsp, approvalsRsp, submissionsRsp] = await Promise.all([
        apiRequest<{ ok: true; items: ExportItem[] }>("/api/qrt/export/list?source=real&limit=300"),
        apiRequest<{ ok: true; items: WorkflowRun[] }>("/api/qrt/workflow/runs?source=real"),
        apiRequest<{ ok: true; items: ApprovalItem[] }>("/api/qrt/approvals"),
        apiRequest<{ ok: true; items: SubmissionItem[] }>("/api/qrt/submissions"),
      ]);

      const exportsItems = (exportsRsp?.items || []).filter((e) => e.source === "real");
      const runs = (runsRsp?.items || []).filter((r) => r.source === "real");
      const approvals = approvalsRsp?.items || [];
      const submissions = submissionsRsp?.items || [];

      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentQuarter = quarterOfDate(now);

      const quarterPeriods: Array<{ key: string; label: string; start: string; end: string; year: number; dueDate: string }> = [];
      for (let i = 0; i < 8; i += 1) {
        const qIdx = currentQuarter - i;
        const shiftYears = Math.floor((qIdx - 1) / 4);
        const quarter = ((qIdx - 1 + 4000) % 4) + 1;
        const year = currentYear + shiftYears;
        const startMonth = (quarter - 1) * 3;
        const start = toYmd(new Date(Date.UTC(year, startMonth, 1)));
        const end = endOfQuarter(year, quarter);
        quarterPeriods.push({
          key: `Q${quarter}-${year}`,
          label: quarterLabel(year, quarter),
          start,
          end,
          year,
          dueDate: end,
        });
      }

      const annualPeriods: Array<{ key: string; label: string; start: string; end: string; year: number; dueDate: string }> = [];
      for (let y = currentYear; y >= currentYear - 3; y -= 1) {
        annualPeriods.push({
          key: `Y-${y}`,
          label: `Annuel ${y}`,
          start: `${y}-01-01`,
          end: `${y}-12-31`,
          year: y,
          dueDate: endOfYear(y),
        });
      }

      const approvalByExport = new Map<number, ApprovalItem>();
      for (const a of approvals) {
        if (!approvalByExport.has(Number(a.export_id))) approvalByExport.set(Number(a.export_id), a);
      }
      const submissionByExport = new Map<number, SubmissionItem>();
      for (const s of submissions) {
        if (!submissionByExport.has(Number(s.export_id))) submissionByExport.set(Number(s.export_id), s);
      }

      const findLatestExportInRange = (start: string, end: string) => {
        return (
          exportsItems
            .filter((e) => e.snapshot_date >= start && e.snapshot_date <= end)
            .sort((a, b) => String(b.snapshot_date).localeCompare(String(a.snapshot_date)) || Number(b.id) - Number(a.id))[0] || null
        );
      };

      const findWorkflowStatusInRange = (start: string, end: string): PeriodRow["workflowStatus"] => {
        const scoped = runs.filter((r) => r.snapshot_date >= start && r.snapshot_date <= end);
        if (scoped.some((r) => r.status === "running")) return "running";
        if (scoped.some((r) => r.status === "failed")) return "failed";
        if (scoped.some((r) => r.status === "success")) return "success";
        return "none";
      };

      const builtQuarterRows: PeriodRow[] = quarterPeriods.map((p) => {
        const exp = findLatestExportInRange(p.start, p.end);
        const workflowStatus = findWorkflowStatusInRange(p.start, p.end);
        const approvalStatus = exp ? normalizeApprovalStatus(approvalByExport.get(Number(exp.id))?.status) : "none";
        const submissionStatus = exp ? normalizeSubmissionStatus(submissionByExport.get(Number(exp.id))?.status) : "none";
        const rowBase = {
          key: p.key,
          cycle: "quarterly" as const,
          label: p.label,
          dueDate: p.dueDate,
          year: p.year,
          exportItem: exp,
          workflowStatus,
          approvalStatus,
          submissionStatus,
          progress: 0,
          stageLabel: "",
        };
        const progress = calcProgress(rowBase.workflowStatus, rowBase.approvalStatus, rowBase.submissionStatus);
        return { ...rowBase, progress, stageLabel: stageLabel(rowBase) };
      });

      const builtAnnualRows: PeriodRow[] = annualPeriods.map((p) => {
        const exp = findLatestExportInRange(p.start, p.end);
        const workflowStatus = findWorkflowStatusInRange(p.start, p.end);
        const approvalStatus = exp ? normalizeApprovalStatus(approvalByExport.get(Number(exp.id))?.status) : "none";
        const submissionStatus = exp ? normalizeSubmissionStatus(submissionByExport.get(Number(exp.id))?.status) : "none";
        const rowBase = {
          key: p.key,
          cycle: "annual" as const,
          label: p.label,
          dueDate: p.dueDate,
          year: p.year,
          exportItem: exp,
          workflowStatus,
          approvalStatus,
          submissionStatus,
          progress: 0,
          stageLabel: "",
        };
        const progress = calcProgress(rowBase.workflowStatus, rowBase.approvalStatus, rowBase.submissionStatus);
        return { ...rowBase, progress, stageLabel: stageLabel(rowBase) };
      });

      const allRows = [...builtQuarterRows, ...builtAnnualRows];
      setRows(allRows);
      setSelectedKey((prev) => prev || builtQuarterRows[0]?.key || null);
      setLastRefresh(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur chargement calendrier QRT");
    } finally {
      setLoading(false);
    }
  }

  const visibleRows = useMemo(() => rows.filter((r) => r.cycle === cycle), [rows, cycle]);
  const selectedRow = useMemo(() => visibleRows.find((r) => r.key === selectedKey) || visibleRows[0] || null, [visibleRows, selectedKey]);
  const selectedExportId = selectedRow?.exportItem?.id ?? null;
  const selectedExportSource = selectedRow?.exportItem?.source ?? null;
  const selectedExportSnapshotDate = selectedRow?.exportItem?.snapshot_date ?? null;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setSelectedKey((prev) => (prev && visibleRows.some((r) => r.key === prev) ? prev : visibleRows[0]?.key || null));
  }, [cycle, visibleRows]);

  useEffect(() => {
    let active = true;
    if (!selectedExportId || !selectedExportSource || !selectedExportSnapshotDate) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    apiRequest<{ ok: true; facts: FactItem[] }>(`/api/qrt/facts?source=${selectedExportSource}&snapshot_date=${selectedExportSnapshotDate}`)
      .then((rsp) => {
        if (!active) return;
        const facts = rsp?.facts || [];
        const pick = (tpl: string, concept: string) => {
          const row = facts.find((f) => String(f.template_code) === tpl && String(f.concept_code) === concept);
          const n = Number(row?.value_decimal);
          return Number.isFinite(n) ? n : null;
        };
        const ownFunds = pick("S.23.01", "OF.BasicOwnFundsEligible");
        const scr = pick("S.25.01", "SCR.Total");
        const mcr = pick("S.28.01", "MCR.Total");
        const coverageRatio = ownFunds != null && scr != null && scr > 0 ? (ownFunds / scr) * 100 : null;
        const templateCount = new Map<string, number>();
        for (const f of facts) {
          const code = String(f.template_code || "").trim();
          if (!code) continue;
          templateCount.set(code, (templateCount.get(code) || 0) + 1);
        }
        const templates = Array.from(templateCount.entries())
          .map(([code, concepts]) => ({
            code,
            label: QRT_TEMPLATE_LABELS[code] || "Template QRT",
            concepts,
          }))
          .sort((a, b) => a.code.localeCompare(b.code));
        setPreview({ ownFunds, scr, mcr, coverageRatio, templates });
      })
      .catch(() => {
        if (!active) return;
        setPreview(null);
      })
      .finally(() => {
        if (!active) return;
        setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedExportId, selectedExportSnapshotDate, selectedExportSource]);

  const stats = useMemo(() => {
    const list = visibleRows;
    return {
      total: list.length,
      done: list.filter((r) => r.submissionStatus === "submitted").length,
      inProgress: list.filter((r) => r.progress > 0 && r.progress < 100).length,
      late: list.filter((r) => parseYmd(r.dueDate).getTime() < Date.now() && r.submissionStatus !== "submitted").length,
    };
  }, [visibleRows]);

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Calendrier QRT"
            description="Suivi des QRT normalisés avec lecture par tâches trimestrielles et annuelles."
          />
          <div className="flex items-center gap-2">
            <Link href="/pilotage/operations" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">Opérations QRT</Link>
            <button onClick={loadData} disabled={loading} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {loading ? "Actualisation..." : "Rafraîchir"}
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-500">Dernière actualisation: {fmtTs(lastRefresh)}</div>
        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="relative mb-3 flex items-center gap-2">
            <button
              onClick={() => setCycle("quarterly")}
              onMouseEnter={() => setHoverGuide("quarterly")}
              onMouseLeave={() => setHoverGuide(null)}
              onFocus={() => setHoverGuide("quarterly")}
              onBlur={() => setHoverGuide(null)}
              className={`rounded px-3 py-1.5 text-sm ${cycle === "quarterly" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Tâches trimestrielles
            </button>
            <button
              onClick={() => setCycle("annual")}
              onMouseEnter={() => setHoverGuide("annual")}
              onMouseLeave={() => setHoverGuide(null)}
              onFocus={() => setHoverGuide("annual")}
              onBlur={() => setHoverGuide(null)}
              className={`rounded px-3 py-1.5 text-sm ${cycle === "annual" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Tâches annuelles
            </button>
            {hoverGuide ? (
              <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                <div className="text-sm font-semibold text-slate-900">{CYCLE_GUIDES[hoverGuide].title}</div>
                <div className="mt-1 text-xs text-slate-600">{CYCLE_GUIDES[hoverGuide].subtitle}</div>
                <div className="mt-1 text-xs text-slate-600">{CYCLE_GUIDES[hoverGuide].dueRule}</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {CYCLE_GUIDES[hoverGuide].obligations.map((o) => (
                    <div key={`${hoverGuide}-${o.code}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-xs font-semibold text-slate-900">{o.code} - {o.label}</div>
                      <div className="mt-1 text-xs text-slate-700">{o.detail}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs font-medium text-slate-900">Points de lancement à respecter</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {CYCLE_GUIDES[hoverGuide].executionNotes.map((n) => (
                    <li key={`${hoverGuide}-${n}`}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Périodes suivies</div><div className="text-xl font-semibold">{stats.total}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Soumises</div><div className="text-xl font-semibold">{stats.done}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">En cours</div><div className="text-xl font-semibold">{stats.inProgress}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Échéance dépassée</div><div className="text-xl font-semibold">{stats.late}</div></div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-base font-semibold">Avancement des périodes</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2">Période</th>
                    <th>Échéance</th>
                    <th>Étape</th>
                    <th>Workflow</th>
                    <th>Validation</th>
                    <th>Soumission</th>
                    <th>Avancement</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.key} className={`border-t border-slate-100 ${selectedRow?.key === r.key ? "bg-slate-50" : ""}`}>
                      <td className="py-2">
                        <button onClick={() => setSelectedKey(r.key)} className="text-left">
                          <div className="font-medium">{r.label}</div>
                          <div className="text-xs text-slate-500">{r.exportItem ? `Export #${r.exportItem.id}` : "Aucun export"}</div>
                        </button>
                      </td>
                      <td className="text-xs">{fmtDate(r.dueDate)}</td>
                      <td className="text-xs">{r.stageLabel}</td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs ${badgeTone(r.workflowStatus)}`}>{uiStatus(r.workflowStatus)}</span></td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs ${badgeTone(r.approvalStatus)}`}>{uiStatus(r.approvalStatus)}</span></td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs ${badgeTone(r.submissionStatus)}`}>{uiStatus(r.submissionStatus)}</span></td>
                      <td className="w-40">
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${r.progress >= 85 ? "bg-emerald-500" : r.progress >= 50 ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${r.progress}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{r.progress}%</div>
                      </td>
                    </tr>
                  ))}
                  {!visibleRows.length ? (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-slate-500">Aucune période disponible.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-base font-semibold">QRT déclenchés</h2>
            {!selectedRow?.exportItem ? (
              <div className="text-sm text-slate-500">Aucun export disponible sur la période sélectionnée.</div>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Export</div>
                  <div className="font-medium">#{selectedRow.exportItem.id} • snapshot {selectedRow.exportItem.snapshot_date}</div>
                </div>
                <div className="relative grid grid-cols-2 gap-2 text-xs">
                  {hoverZone ? (
                    <div className="pointer-events-none absolute -top-2 right-0 z-20 w-80 -translate-y-full rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                      <div className="text-sm font-semibold text-slate-900">{TRIGGER_ZONE_HELP[hoverZone].title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-600">{TRIGGER_ZONE_HELP[hoverZone].detail}</div>
                    </div>
                  ) : null}
                  <div
                    className="rounded border border-slate-200 p-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    tabIndex={0}
                    onMouseEnter={() => setHoverZone("taxonomy")}
                    onMouseLeave={() => setHoverZone((prev) => (prev === "taxonomy" ? null : prev))}
                    onFocus={() => setHoverZone("taxonomy")}
                    onBlur={() => setHoverZone((prev) => (prev === "taxonomy" ? null : prev))}
                  >
                    <div className="text-slate-500">Taxonomie</div>
                    <div className="font-medium text-slate-900">{selectedRow.exportItem.taxonomy_version || "—"}</div>
                  </div>
                  <div
                    className="rounded border border-slate-200 p-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    tabIndex={0}
                    onMouseEnter={() => setHoverZone("jurisdiction")}
                    onMouseLeave={() => setHoverZone((prev) => (prev === "jurisdiction" ? null : prev))}
                    onFocus={() => setHoverZone("jurisdiction")}
                    onBlur={() => setHoverZone((prev) => (prev === "jurisdiction" ? null : prev))}
                  >
                    <div className="text-slate-500">Juridiction</div>
                    <div className="font-medium text-slate-900">{selectedRow.exportItem.jurisdiction || "—"}</div>
                  </div>
                  <div
                    className="rounded border border-slate-200 p-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    tabIndex={0}
                    onMouseEnter={() => setHoverZone("facts")}
                    onMouseLeave={() => setHoverZone((prev) => (prev === "facts" ? null : prev))}
                    onFocus={() => setHoverZone("facts")}
                    onBlur={() => setHoverZone((prev) => (prev === "facts" ? null : prev))}
                  >
                    <div className="text-slate-500">Nb facts</div>
                    <div className="font-medium text-slate-900">{selectedRow.exportItem.facts_count ?? "—"}</div>
                  </div>
                  <div
                    className="rounded border border-slate-200 p-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    tabIndex={0}
                    onMouseEnter={() => setHoverZone("status")}
                    onMouseLeave={() => setHoverZone((prev) => (prev === "status" ? null : prev))}
                    onFocus={() => setHoverZone("status")}
                    onBlur={() => setHoverZone((prev) => (prev === "status" ? null : prev))}
                  >
                    <div className="text-slate-500">Statut export</div>
                    <div className="font-medium text-slate-900">{uiStatus(selectedRow.exportItem.status)}</div>
                  </div>
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <div className="mb-2 text-xs text-slate-500">Détail normalisé des QRT inclus</div>
                  {previewLoading ? (
                    <div className="text-xs text-slate-500">Chargement des templates QRT...</div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {preview?.templates?.map((tpl) => (
                        <div key={tpl.code} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                          <div className="font-medium text-slate-900">{tpl.code} - {tpl.label}</div>
                          <div className="text-slate-500">{tpl.concepts} concept(s) détecté(s)</div>
                        </div>
                      ))}
                      {!preview?.templates?.length ? <div className="text-slate-500">Aucun template QRT détecté.</div> : null}
                    </div>
                  )}
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <div className="mb-2 text-xs text-slate-500">Lecture rapide des indicateurs</div>
                  {previewLoading ? (
                    <div className="text-xs text-slate-500">Chargement des indicateurs...</div>
                  ) : (
                    <div className="space-y-1 text-xs">
                      <div>Fonds propres éligibles (S.23.01): <span className="font-medium text-slate-900">{preview?.ownFunds != null ? preview.ownFunds.toLocaleString("fr-FR") : "—"}</span></div>
                      <div>SCR total (S.25.01): <span className="font-medium text-slate-900">{preview?.scr != null ? preview.scr.toLocaleString("fr-FR") : "—"}</span></div>
                      <div>MCR total (S.28.01): <span className="font-medium text-slate-900">{preview?.mcr != null ? preview.mcr.toLocaleString("fr-FR") : "—"}</span></div>
                      <div>Couverture SCR: <span className="font-medium text-slate-900">{preview?.coverageRatio != null ? `${preview.coverageRatio.toFixed(2)} %` : "—"}</span></div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </RequireAuth>
  );
}
