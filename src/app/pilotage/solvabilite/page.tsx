"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import TwoSegmentGaugePanel from "@/components/pilotage/TwoSegmentGaugePanel";
import { apiRequest } from "@/lib/api";

type SolvencySnapshot = {
  run_id: number | null;
  snapshot_date: string | null;
  own_funds_eligible: number;
  scr_total: number;
  mcr: number;
  solvency_ratio_pct: number | null;
  methodology_version: string | null;
  scr_non_life?: number;
  scr_counterparty?: number;
  scr_market?: number;
  scr_operational?: number;
  source?: "real" | "simulation" | null;
  reference_run_id?: number | null;
  status?: string | null;
};

type SolvencyPageData = {
  year: number;
  source_mode?: "real" | "simulation" | "auto";
  selected_run_id?: number | null;
  available_runs?: Array<{ run_id: number; latest_snapshot_date: string | null; snapshots_count: number }>;
  summary: {
    latest_snapshot: SolvencySnapshot | null;
    latest_alm_snapshot_date: string | null;
    solvency_ratio_pct: number | null;
    mcr_coverage_pct: number | null;
    data_freshness_days: number | null;
    alm_freshness_days: number | null;
    alert_level: "ok" | "warning" | "critical";
    alert_messages: string[];
    year_snapshots_count: number;
    source?: "real" | "simulation" | null;
  };
  monthly: Array<{
    month: string;
    label: string;
    snapshot_date: string | null;
    run_id: number | null;
    own_funds_eligible: number;
    scr_total: number;
    mcr: number;
    scr_non_life?: number;
    scr_counterparty?: number;
    scr_market?: number;
    scr_operational?: number;
    solvency_ratio_pct: number | null;
    mcr_coverage_pct: number | null;
    source?: "real" | "simulation" | null;
    reference_run_id?: number | null;
    status?: string | null;
  }>;
  recent_snapshots: SolvencySnapshot[];
  cache_hit?: boolean;
};

function formatMoney(value: number | null | undefined) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(Number(value || 0))).replace(/[\u202f\u00a0]/g, " ")} €`;
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value))} %`;
}

function formatSignedMoney(value: number | null | undefined) {
  const n = Number(value || 0);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(n)).replace(" €", "")} €`;
}

function formatSignedPctPoints(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(n))} pts`;
}

function solvencyRatioValueClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "text-slate-700";
  const n = Number(value);
  if (n < 100) return "text-rose-700";
  if (n < 120) return "text-amber-700";
  return "text-emerald-700";
}

function mcrCoverageValueClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "text-slate-700";
  const n = Number(value);
  if (n < 100) return "text-rose-700";
  if (n < 120) return "text-amber-700";
  return "text-emerald-700";
}

function riskCellClass(value: number | null | undefined, kind: "scr" | "mcr") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "text-slate-500 bg-slate-50";
  }
  const klass = kind === "scr" ? solvencyRatioValueClass(value) : mcrCoverageValueClass(value);
  if (klass.includes("rose")) return `${klass} bg-rose-50`;
  if (klass.includes("amber")) return `${klass} bg-amber-50`;
  if (klass.includes("emerald")) return `${klass} bg-emerald-50`;
  return `${klass} bg-slate-50`;
}

function statusBadge(level: "ok" | "warning" | "critical") {
  if (level === "critical") return "border-rose-200 bg-rose-50 text-rose-700";
  if (level === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

const KPI_TOOLTIPS = {
  ratioScr: "Ratio SCR = Fonds propres éligibles / SCR. En dessous de 100%, la couverture du capital requis SCR est insuffisante.",
  mcrCoverage: "Couverture MCR = Fonds propres éligibles / MCR. Le MCR est le minimum réglementaire absolu de capital.",
  ownFunds: "Fonds propres éligibles retenus dans le calcul de solvabilité (capital disponible utilisable pour couvrir SCR/MCR).",
  scrTotal: "SCR total (Solvency Capital Requirement) : capital requis pour absorber un choc défavorable (vision simplifiée S2).",
  mcr: "MCR (Minimum Capital Requirement) : seuil minimal réglementaire de capital. En dessous, situation critique.",
  lastS2: "Date du dernier snapshot S2 utilisé pour les indicateurs affichés (run de solvabilité le plus récent).",
} as const;

const TABLE_TOOLTIPS = {
  month: "Mois de rattachement dans l'année sélectionnée.",
  snapshot: "Date de la dernière photo S2 disponible pour le mois concerné.",
  ratioScr: "Ratio SCR du snapshot (Fonds propres éligibles / SCR).",
  mcrCoverage: "Couverture MCR du snapshot (Fonds propres éligibles / MCR).",
  ownFunds: "Fonds propres éligibles retenus dans le snapshot.",
  scr: "SCR total du snapshot.",
  run: "Identifiant du run de simulation / calcul S2 ayant produit le snapshot.",
  mcr: "Minimum Capital Requirement calculé sur le snapshot.",
  methodology: "Version/méthodologie du moteur ou du calcul ayant produit le résultat S2.",
} as const;

function InfoLabel({
  label,
  help,
  align = "left",
  className = "",
}: {
  label: string;
  help: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex items-center gap-1 ${className}`}>
      <span>{label}</span>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-600">
        i
      </span>
      <span
        className={`pointer-events-none absolute z-20 hidden w-72 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-[11px] font-normal leading-4 text-slate-700 shadow-lg group-hover:block ${
          align === "right" ? "right-0 top-full mt-1" : "left-0 top-full mt-1"
        }`}
      >
        {help}
      </span>
    </span>
  );
}

function ratioGaugeData(base: number, threshold: number, actual: number) {
  const cappedActual = Math.max(0, Math.min(base, actual));
  const remaining = Math.max(0, base - cappedActual);
  const actualPct = base > 0 ? (cappedActual / base) * 100 : 0;
  const remainingPct = base > 0 ? (remaining / base) * 100 : 0;
  const thresholdPct = base > 0 ? (threshold / base) * 100 : 0;
  return { cappedActual, remaining, actualPct, remainingPct, thresholdPct };
}

function SolvencyMonthlyTrendChart({
  rows,
  year,
}: {
  rows: SolvencyPageData["monthly"];
  year: number;
}) {
  const points = rows.filter((r) => !!r.snapshot_date && (r.solvency_ratio_pct !== null || r.mcr_coverage_pct !== null));
  if (!points.length) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
        Aucune donnée mensuelle exploitable pour tracer les courbes sur {year}.
      </div>
    );
  }

  function MetricChartCard({
    title,
    color,
    values,
  }: {
    title: string;
    color: string;
    values: Array<number | null>;
  }) {
    const width = 480;
    const height = 260;
    const leftPad = 56;
    const rightPad = 12;
    const topPad = 16;
    const bottomPad = 34;
    const plotW = width - leftPad - rightPad;
    const plotH = height - topPad - bottomPad;
    const series = values.filter((v): v is number => v !== null && Number.isFinite(Number(v)));
    if (!series.length) {
      return (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          {title}: aucune donnée sur {year}.
        </div>
      );
    }

    const rawMax = Math.max(120, ...series, 1);
    const maxVal = Math.ceil(rawMax / 20) * 20;
    const x = (i: number) => leftPad + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v: number) => topPad + plotH - (Math.max(0, v) / maxVal) * plotH;
    const linePts = values
      .map((v, i) => (v === null || !Number.isFinite(Number(v)) ? null : `${x(i)},${y(Number(v))}`))
      .filter(Boolean)
      .join(" ");

    return (
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-medium text-slate-700">{title}</div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${title} sur ${year}`}>
          {[100, 120].filter((t) => t <= maxVal).map((threshold) => (
            <line
              key={`th-${title}-${threshold}`}
              x1={leftPad}
              x2={width - rightPad}
              y1={y(threshold)}
              y2={y(threshold)}
              stroke={threshold === 100 ? "#ef4444" : "#f59e0b"}
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.9"
            />
          ))}
          {Array.from({ length: 6 }, (_, i) => {
            const val = (maxVal / 5) * i;
            const yy = y(val);
            return (
              <g key={`${title}-grid-${i}`}>
                <line x1={leftPad} x2={width - rightPad} y1={yy} y2={yy} stroke="#e2e8f0" strokeWidth="1" />
                <text x={leftPad - 8} y={yy + 4} textAnchor="end" fontSize="10" fill="#475569">
                  {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(val)}%
                </text>
              </g>
            );
          })}
          {points.map((m, i) => (
            <text key={`${title}-m-${m.month}`} x={x(i)} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
              {m.month.slice(5)}
            </text>
          ))}
          {linePts ? <polyline fill="none" stroke={color} strokeWidth="2.5" points={linePts} /> : null}
          {values.map((v, i) => (
            v === null || !Number.isFinite(Number(v)) ? null : (
              <circle key={`${title}-dot-${points[i]?.month || i}`} cx={x(i)} cy={y(Number(v))} r={2.6} fill={color}>
                <title>{`${points[i]?.label || points[i]?.month || ""} ${year} - ${title}: ${formatPct(Number(v))}`}</title>
              </circle>
            )
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MetricChartCard
        title="Évolution du Ratio SCR"
        color="#2563eb"
        values={points.map((m) => m.solvency_ratio_pct)}
      />
      <MetricChartCard
        title="Évolution de la Couverture MCR"
        color="#0f766e"
        values={points.map((m) => m.mcr_coverage_pct)}
      />
    </div>
  );
}

function kEuroLabel(value: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(value / 1000)).replace(/[\u202f\u00a0]/g, " ")} k€`;
}

function RecentSnapshotsStackedChart({ rows }: { rows: SolvencySnapshot[] }) {
  const points = [...rows]
    .filter((r) => !!r.snapshot_date)
    .sort((a, b) => {
      const da = String(a.snapshot_date || "");
      const db = String(b.snapshot_date || "");
      if (da !== db) return da.localeCompare(db);
      return Number(a.run_id || 0) - Number(b.run_id || 0);
    });

  if (!points.length) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
        Aucun snapshot S2 disponible pour tracer le graphique.
      </div>
    );
  }

  const width = 980;
  const height = 320;
  const leftPad = 76;
  const rightPad = 16;
  const topPad = 16;
  const bottomPad = 52;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;

  const mcrVals = points.map((p) => Math.max(0, Number(p.mcr || 0)));
  const scrVals = points.map((p) => Math.max(0, Number(p.scr_total || 0)));
  const ownFundsVals = points.map((p) => Math.max(0, Number(p.own_funds_eligible || 0)));
  const stackedTotalVals = points.map((p) => Math.max(0, Number(p.mcr || 0)) + Math.max(0, Number(p.scr_total || 0)));
  const maxValRaw = Math.max(1, ...mcrVals, ...scrVals, ...stackedTotalVals, ...ownFundsVals);
  const maxVal = Math.ceil((maxValRaw * 1.1) / 1000) * 1000;
  const x = (i: number) => leftPad + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => topPad + plotH - (Math.max(0, v) / maxVal) * plotH;

  const linePts = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const stackedAreaPath = (topVals: number[], baseVals: number[]) => {
    if (!topVals.length) return "";
    const top = topVals.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
    const base = baseVals.map((v, i) => `${x(i)},${y(v)}`).reverse().join(" L ");
    return `M ${top} L ${base} Z`;
  };

  const mcrBase = mcrVals;
  const scrStackTop = points.map((_, i) => mcrBase[i] + scrVals[i]);
  const zeroBase = points.map(() => 0);
  const tickCount = 4;
  const xLabelEvery = points.length > 10 ? 2 : 1;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-medium text-slate-700">FP éligibles vs empilement MCR + SCR</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[900px] w-full" role="img" aria-label="Comparaison fonds propres éligibles et exigences SCR/MCR">
        {Array.from({ length: tickCount + 1 }, (_, i) => {
          const val = (maxVal / tickCount) * i;
          const yy = y(val);
          return (
            <g key={`grid-${i}`}>
              <line x1={leftPad} x2={width - rightPad} y1={yy} y2={yy} stroke="#e2e8f0" strokeWidth="1" />
              <text x={leftPad - 10} y={yy + 4} textAnchor="end" fontSize="11" fill="#475569">{kEuroLabel(val)}</text>
            </g>
          );
        })}

        {points.map((p, i) => (
          (i % xLabelEvery === 0 || i === points.length - 1) ? (
            <text key={`x-${p.snapshot_date}-${p.run_id}`} x={x(i)} y={height - 12} textAnchor="middle" fontSize="10" fill="#64748b">
              {String(p.snapshot_date).slice(5)}
            </text>
          ) : null
        ))}

        <path d={stackedAreaPath(mcrBase, zeroBase)} fill="#fca5a5" opacity="0.55" />
        <path d={stackedAreaPath(scrStackTop, mcrBase)} fill="#fde68a" opacity="0.7" />
        <polyline fill="none" stroke="#dc2626" strokeWidth="1.5" points={linePts(mcrBase)} opacity="0.85" />
        <polyline fill="none" stroke="#d97706" strokeWidth="1.8" points={linePts(scrStackTop)} opacity="0.95" />
        <polyline fill="none" stroke="#2563eb" strokeWidth="2.6" points={linePts(ownFundsVals)} />

        {points.map((p, i) => (
          <g key={`dot-${p.snapshot_date}-${p.run_id}`}>
            <circle cx={x(i)} cy={y(ownFundsVals[i])} r={2.6} fill="#2563eb">
              <title>{`${p.snapshot_date} (run ${p.run_id ?? "—"}) - FP éligibles: ${formatMoney(p.own_funds_eligible)}`}</title>
            </circle>
            <circle cx={x(i)} cy={y(scrStackTop[i])} r={2.1} fill="#d97706">
              <title>{`${p.snapshot_date} (run ${p.run_id ?? "—"}) - MCR + SCR: ${formatMoney(mcrBase[i] + scrVals[i])}`}</title>
            </circle>
            <circle cx={x(i)} cy={y(mcrBase[i])} r={2.1} fill="#dc2626">
              <title>{`${p.snapshot_date} (run ${p.run_id ?? "—"}) - MCR: ${formatMoney(p.mcr)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-blue-600 bg-blue-600 px-2 py-1 text-white">Courbe bleue: FP éligibles</span>
        <span className="rounded-md border border-red-300 bg-red-100 px-2 py-1 text-red-800">Zone rouge: MCR</span>
        <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-amber-800">Zone jaune: SCR (ajouté au-dessus du MCR)</span>
        <span className="rounded-md border border-amber-600 bg-amber-600 px-2 py-1 text-white">Ligne orange: total empilé MCR + SCR</span>
      </div>
    </div>
  );
}

export default function SolvabilitePage() {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [sourceMode, setSourceMode] = useState<"auto" | "real" | "simulation">("auto");
  const [runId, setRunId] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SolvencyPageData | null>(null);
  const [monthlyTableVisible, setMonthlyTableVisible] = useState(false);
  const [monthlyTrendVisible, setMonthlyTrendVisible] = useState(false);
  const [tableVisible, setTableVisible] = useState(false);
  const [deltaMonth, setDeltaMonth] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    qs.set("year", String(year));
    qs.set("source", sourceMode);
    if (runId > 0) qs.set("run_id", String(runId));
    apiRequest<SolvencyPageData>(`/api/pilotage/solvabilite-page-data?${qs.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setMonthlyTableVisible(false);
        setMonthlyTrendVisible(false);
        setTableVisible(false);
        const monthsWithSnapshots = (payload.monthly || []).filter((m) => !!m.snapshot_date);
        const monthWithPrev =
          [...monthsWithSnapshots]
            .reverse()
            .find((m) => {
              const idx = payload.monthly.findIndex((x) => x.month === m.month);
              return payload.monthly.slice(0, idx).some((x) => !!x.snapshot_date);
            }) || null;
        setDeltaMonth((monthWithPrev || monthsWithSnapshots[monthsWithSnapshots.length - 1] || payload.monthly[payload.monthly.length - 1])?.month || "");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, runId, sourceMode]);

  const latest = data?.summary.latest_snapshot || null;
  const scrGauge = useMemo(() => {
    const ownFunds = Number(latest?.own_funds_eligible || 0);
    const scr = Number(latest?.scr_total || 0);
    const compliant = ownFunds >= scr;
    const base = Math.max(compliant ? ownFunds : scr, 1);
    const leftAmount = compliant ? scr : ownFunds;
    const rightAmount = Math.max(base - leftAmount, 0);
    return {
      compliant,
      base,
      leftAmount,
      rightAmount,
      leftPct: base > 0 ? (leftAmount / base) * 100 : 0,
      rightPct: base > 0 ? (rightAmount / base) * 100 : 0,
    };
  }, [latest]);
  const mcrGauge = useMemo(() => {
    const ownFunds = Number(latest?.own_funds_eligible || 0);
    const mcr = Number(latest?.mcr || 0);
    const compliant = ownFunds >= mcr;
    const base = Math.max(compliant ? ownFunds : mcr, 1);
    const leftAmount = compliant ? mcr : ownFunds;
    const rightAmount = Math.max(base - leftAmount, 0);
    return {
      compliant,
      base,
      leftAmount,
      rightAmount,
      leftPct: base > 0 ? (leftAmount / base) * 100 : 0,
      rightPct: base > 0 ? (rightAmount / base) * 100 : 0,
    };
  }, [latest]);

  const monthlyDelta = useMemo(() => {
    if (!data?.monthly?.length || !deltaMonth) return null;
    const idx = data.monthly.findIndex((m) => m.month === deltaMonth);
    if (idx <= 0) return null;
    const current = data.monthly[idx];
    if (!current?.snapshot_date) return null;
    let previous: (typeof data.monthly)[number] | null = null;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (data.monthly[i]?.snapshot_date) {
        previous = data.monthly[i];
        break;
      }
    }
    if (!previous) return null;
    return {
      current,
      previous,
      deltas: {
        scr_non_life: Number(current.scr_non_life || 0) - Number(previous.scr_non_life || 0),
        scr_counterparty: Number(current.scr_counterparty || 0) - Number(previous.scr_counterparty || 0),
        scr_market: Number(current.scr_market || 0) - Number(previous.scr_market || 0),
        scr_operational: Number(current.scr_operational || 0) - Number(previous.scr_operational || 0),
        scr_total: Number(current.scr_total || 0) - Number(previous.scr_total || 0),
        own_funds_eligible: Number(current.own_funds_eligible || 0) - Number(previous.own_funds_eligible || 0),
        solvency_ratio_pts:
          (current.solvency_ratio_pct == null ? 0 : Number(current.solvency_ratio_pct)) -
          (previous.solvency_ratio_pct == null ? 0 : Number(previous.solvency_ratio_pct)),
      },
    };
  }, [data, deltaMonth]);

  const variationRows = useMemo(() => {
    if (!monthlyDelta) return [];
    return [
      { key: "scr_non_life", label: "SCR non-vie", prev: Number(monthlyDelta.previous.scr_non_life || 0), cur: Number(monthlyDelta.current.scr_non_life || 0), delta: monthlyDelta.deltas.scr_non_life },
      { key: "scr_counterparty", label: "SCR contrepartie", prev: Number(monthlyDelta.previous.scr_counterparty || 0), cur: Number(monthlyDelta.current.scr_counterparty || 0), delta: monthlyDelta.deltas.scr_counterparty },
      { key: "scr_market", label: "SCR marché", prev: Number(monthlyDelta.previous.scr_market || 0), cur: Number(monthlyDelta.current.scr_market || 0), delta: monthlyDelta.deltas.scr_market },
      { key: "scr_operational", label: "SCR opérationnel", prev: Number(monthlyDelta.previous.scr_operational || 0), cur: Number(monthlyDelta.current.scr_operational || 0), delta: monthlyDelta.deltas.scr_operational },
      { key: "scr_total", label: "SCR total", prev: Number(monthlyDelta.previous.scr_total || 0), cur: Number(monthlyDelta.current.scr_total || 0), delta: monthlyDelta.deltas.scr_total },
      { key: "own_funds_eligible", label: "Fonds propres éligibles", prev: Number(monthlyDelta.previous.own_funds_eligible || 0), cur: Number(monthlyDelta.current.own_funds_eligible || 0), delta: monthlyDelta.deltas.own_funds_eligible },
    ];
  }, [monthlyDelta]);

  const scrWaterfall = useMemo(() => {
    if (!monthlyDelta) return null;
    const start = Number(monthlyDelta.previous.scr_total || 0);
    const end = Number(monthlyDelta.current.scr_total || 0);
    const contributions = [
      { key: "scr_non_life", label: "Non-vie", delta: Number(monthlyDelta.deltas.scr_non_life || 0) },
      { key: "scr_counterparty", label: "Contrepartie", delta: Number(monthlyDelta.deltas.scr_counterparty || 0) },
      { key: "scr_market", label: "Marché", delta: Number(monthlyDelta.deltas.scr_market || 0) },
      { key: "scr_operational", label: "Opérationnel", delta: Number(monthlyDelta.deltas.scr_operational || 0) },
    ];
    let running = start;
    const steps = contributions.map((c) => {
      const from = running;
      const to = running + c.delta;
      running = to;
      return { ...c, from, to, low: Math.min(from, to), high: Math.max(from, to) };
    });
    const values = [start, end, ...steps.flatMap((s) => [s.low, s.high])];
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const range = Math.max(max - min, 1);
    const pct = (v: number) => ((v - min) / range) * 100;
    return { start, end, steps, min, max, range, pct };
  }, [monthlyDelta]);

  const ratioWaterfall = useMemo(() => {
    if (!monthlyDelta) return null;
    const ofPrev = Number(monthlyDelta.previous.own_funds_eligible || 0);
    const ofCur = Number(monthlyDelta.current.own_funds_eligible || 0);
    const scrPrev = Number(monthlyDelta.previous.scr_total || 0);
    const scrCur = Number(monthlyDelta.current.scr_total || 0);
    const ratioPrev = Number(monthlyDelta.previous.solvency_ratio_pct || 0);
    const ratioCur = Number(monthlyDelta.current.solvency_ratio_pct || 0);

    if (scrPrev <= 0 || scrCur <= 0) return null;

    const ratioAfterOwnFunds = scrPrev > 0 ? (ofCur / scrPrev) * 100 : ratioPrev;
    const deltaOwnFundsPts = ratioAfterOwnFunds - ratioPrev;
    const deltaScrPts = ratioCur - ratioAfterOwnFunds;

    const stepsBase = [
      { key: "own_funds_effect", label: "Effet Δ FP", delta: deltaOwnFundsPts },
      { key: "scr_effect", label: "Effet Δ SCR", delta: deltaScrPts },
    ];
    let running = ratioPrev;
    const steps = stepsBase.map((s) => {
      const from = running;
      const to = running + s.delta;
      running = to;
      return { ...s, from, to, low: Math.min(from, to), high: Math.max(from, to) };
    });
    const values = [ratioPrev, ratioCur, ...steps.flatMap((s) => [s.low, s.high])];
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const range = Math.max(max - min, 1);
    const pct = (v: number) => ((v - min) / range) * 100;

    return {
      start: ratioPrev,
      end: ratioCur,
      steps,
      pct,
      deltaOwnFundsPts,
      deltaScrPts,
      ofPrev,
      ofCur,
      scrPrev,
      scrCur,
    };
  }, [monthlyDelta]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Solvabilité & conformité"
            description="Vue régulateur (MVP) : SCR, MCR, fonds propres, fraîcheur des calculs et alertes."
          />
          <Link href="/dashboard" className="text-xs text-blue-600 underline">
            Retour dashboard
          </Link>
        </div>

        <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Périmètre de lecture</div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-slate-700">
              Source
              <select
                value={sourceMode}
                onChange={(e) => setSourceMode((e.target.value as "auto" | "real" | "simulation") || "auto")}
                className="ml-2 h-9 min-w-[220px] rounded-md border-2 border-slate-400 bg-white px-2 text-sm font-medium text-slate-900"
              >
                <option value="auto">Auto (réel prioritaire)</option>
                <option value="real">Réel</option>
                <option value="simulation">Simulation</option>
              </select>
            </label>

            <label className="text-xs text-slate-700">
              Année
              <select value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {Array.from({ length: 8 }, (_, i) => currentYear - 3 + i).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-700">
              Run S2
              <select
                value={runId}
                onChange={(e) => setRunId(Number(e.target.value) || 0)}
                className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                <option value={0}>Auto (dernier run)</option>
                {(data?.available_runs || []).map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {`Run ${r.run_id}${r.latest_snapshot_date ? ` (${r.latest_snapshot_date})` : ""}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? <div className="rounded-md border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">Chargement…</div> : null}
        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-700">{error}</div> : null}

        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusBadge(data.summary.alert_level)}`}>
                {data.summary.alert_level === "critical" ? "Critique" : data.summary.alert_level === "warning" ? "Vigilance" : "OK"}
              </span>
              <span className="text-xs text-slate-500">
                Snapshots S2 sur l'année : {data.summary.year_snapshots_count}
              </span>
              <span className="text-xs text-slate-500">
                Source : {data.source_mode === "real" ? "réel" : data.source_mode === "simulation" ? "simulation" : "auto"}
              </span>
              <span className="text-xs text-slate-500">
                Run affiché : {data.selected_run_id ? `#${data.selected_run_id}` : "auto"}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500"><InfoLabel label="Ratio SCR" help={KPI_TOOLTIPS.ratioScr} /></div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatPct(data.summary.solvency_ratio_pct)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500"><InfoLabel label="Couverture MCR" help={KPI_TOOLTIPS.mcrCoverage} /></div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatPct(data.summary.mcr_coverage_pct)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500"><InfoLabel label="Fonds propres éligibles" help={KPI_TOOLTIPS.ownFunds} /></div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(latest?.own_funds_eligible)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500"><InfoLabel label="SCR total" help={KPI_TOOLTIPS.scrTotal} /></div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(latest?.scr_total)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500"><InfoLabel label="MCR" help={KPI_TOOLTIPS.mcr} /></div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(latest?.mcr)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500"><InfoLabel label="Dernier snapshot S2" help={KPI_TOOLTIPS.lastS2} align="right" /></div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{latest?.snapshot_date || "—"}</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Fraîcheur: {data.summary.data_freshness_days ?? "—"} j{latest?.source ? ` | ${latest.source === "real" ? "réel" : "simulation"}` : ""}
                </div>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <TwoSegmentGaugePanel
                caption={scrGauge.compliant ? "Couverture SCR (décomposition des FP éligibles)" : "Couverture SCR (base = SCR requis)"}
                totalLabel={formatMoney(scrGauge.base)}
                leftPct={scrGauge.leftPct}
                rightPct={scrGauge.rightPct}
                left={{
                  label: scrGauge.compliant ? "SCR couvert" : "FP éligibles",
                  amountLabel: formatMoney(scrGauge.leftAmount),
                  pctLabel: formatPct(scrGauge.leftPct),
                  barColorClass: "bg-emerald-600",
                  cardClass: "border-emerald-600 bg-emerald-600",
                  textClass: "text-white",
                }}
                right={{
                  label: Number(latest?.own_funds_eligible || 0) >= Number(latest?.scr_total || 0) ? "Marge" : "Insuffisance",
                  amountLabel: formatMoney(scrGauge.rightAmount),
                  pctLabel: formatPct(scrGauge.rightPct),
                  barColorClass: Number(latest?.own_funds_eligible || 0) >= Number(latest?.scr_total || 0) ? "bg-slate-300" : "bg-rose-400",
                  cardClass: Number(latest?.own_funds_eligible || 0) >= Number(latest?.scr_total || 0) ? "border-slate-300 bg-slate-300" : "border-rose-400 bg-rose-400",
                  textClass: Number(latest?.own_funds_eligible || 0) >= Number(latest?.scr_total || 0) ? "text-slate-900" : "text-white",
                }}
              />

              <TwoSegmentGaugePanel
                caption={mcrGauge.compliant ? "Couverture MCR (décomposition des FP éligibles)" : "Couverture MCR (base = MCR requis)"}
                totalLabel={formatMoney(mcrGauge.base)}
                leftPct={mcrGauge.leftPct}
                rightPct={mcrGauge.rightPct}
                left={{
                  label: mcrGauge.compliant ? "MCR couvert" : "FP éligibles",
                  amountLabel: formatMoney(mcrGauge.leftAmount),
                  pctLabel: formatPct(mcrGauge.leftPct),
                  barColorClass: "bg-blue-600",
                  cardClass: "border-blue-600 bg-blue-600",
                  textClass: "text-white",
                }}
                right={{
                  label: Number(latest?.own_funds_eligible || 0) >= Number(latest?.mcr || 0) ? "Marge" : "Insuffisance",
                  amountLabel: formatMoney(mcrGauge.rightAmount),
                  pctLabel: formatPct(mcrGauge.rightPct),
                  barColorClass: Number(latest?.own_funds_eligible || 0) >= Number(latest?.mcr || 0) ? "bg-slate-300" : "bg-rose-400",
                  cardClass: Number(latest?.own_funds_eligible || 0) >= Number(latest?.mcr || 0) ? "border-slate-300 bg-slate-300" : "border-rose-400 bg-rose-400",
                  textClass: Number(latest?.own_funds_eligible || 0) >= Number(latest?.mcr || 0) ? "text-slate-900" : "text-white",
                }}
              />
            </div>

            <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-900">Variation mensuelle du besoin de fonds propres (SCR)</div>
                  <div className="text-xs text-slate-500">Comparaison du mois sélectionné avec le dernier mois précédent disposant d’un snapshot S2.</div>
                </div>
                <label className="text-xs text-slate-700">
                  Mois analysé
                  <select
                    value={deltaMonth}
                    onChange={(e) => setDeltaMonth(e.target.value)}
                    className="ml-2 h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
                  >
                    {(data.monthly || [])
                      .filter((m) => !!m.snapshot_date)
                      .map((m) => (
                        <option key={m.month} value={m.month}>
                          {m.label} ({m.snapshot_date})
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              {monthlyDelta ? (
                <>
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 md:col-span-2">
                      <div className="text-[11px] text-slate-500">Période comparée</div>
                      <div className="mt-1 text-xs font-medium text-slate-900">
                        {monthlyDelta.previous.label} ({monthlyDelta.previous.snapshot_date || "—"}) → {monthlyDelta.current.label} ({monthlyDelta.current.snapshot_date || "—"})
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="text-[11px] text-slate-500">Δ SCR total</div>
                      <div className={`mt-1 text-sm font-semibold ${monthlyDelta.deltas.scr_total >= 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        {formatSignedMoney(monthlyDelta.deltas.scr_total)}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="text-[11px] text-slate-500">Δ Ratio solvabilité</div>
                      <div className={`mt-1 text-sm font-semibold ${monthlyDelta.deltas.solvency_ratio_pts >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatSignedPctPoints(monthlyDelta.deltas.solvency_ratio_pts)}
                      </div>
                    </div>
                  </div>

                  {scrWaterfall ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 text-xs font-medium text-slate-700">Waterfall SCR (M-1 → M)</div>
                      <div className="space-y-2">
                        <div className="grid grid-cols-[120px_1fr_90px] items-center gap-2 text-xs">
                          <div className="text-slate-600">SCR départ</div>
                          <div className="relative h-6 rounded bg-white">
                            <div
                              className="absolute top-1 bottom-1 rounded bg-slate-500"
                              style={{
                                left: "0%",
                                width: `${Math.max(2, scrWaterfall.pct(scrWaterfall.start))}%`,
                              }}
                            />
                          </div>
                          <div className="text-right font-medium text-slate-700">{formatMoney(scrWaterfall.start)}</div>
                        </div>

                        {scrWaterfall.steps.map((step) => {
                          const deltaPositive = step.delta >= 0;
                          const left = scrWaterfall.pct(step.low);
                          const width = Math.max(1.5, scrWaterfall.pct(step.high) - scrWaterfall.pct(step.low));
                          const connectorLeft = scrWaterfall.pct(step.from);
                          return (
                            <div key={step.key} className="grid grid-cols-[120px_1fr_90px] items-center gap-2 text-xs">
                              <div className="text-slate-600">{step.label}</div>
                              <div className="relative h-6 rounded bg-white">
                                <div
                                  className="absolute top-1/2 h-px bg-slate-300"
                                  style={{ left: `${Math.min(left, connectorLeft)}%`, width: `${Math.max(0.5, Math.abs(connectorLeft - left))}%` }}
                                />
                                <div
                                  className={`absolute top-1 bottom-1 rounded ${deltaPositive ? "bg-rose-500" : "bg-emerald-500"}`}
                                  style={{ left: `${left}%`, width: `${width}%` }}
                                />
                              </div>
                              <div className={`text-right font-medium ${deltaPositive ? "text-rose-700" : "text-emerald-700"}`}>
                                {formatSignedMoney(step.delta)}
                              </div>
                            </div>
                          );
                        })}

                        <div className="grid grid-cols-[120px_1fr_90px] items-center gap-2 text-xs">
                          <div className="text-slate-600">SCR fin</div>
                          <div className="relative h-6 rounded bg-white">
                            <div
                              className="absolute top-1 bottom-1 rounded bg-blue-600"
                              style={{
                                left: "0%",
                                width: `${Math.max(2, scrWaterfall.pct(scrWaterfall.end))}%`,
                              }}
                            />
                          </div>
                          <div className="text-right font-medium text-slate-900">{formatMoney(scrWaterfall.end)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-rose-500" /> Hausse du SCR</span>
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-emerald-500" /> Baisse du SCR</span>
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-slate-500" /> SCR M-1</span>
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-blue-600" /> SCR M</span>
                      </div>
                    </div>
                  ) : null}

                  {ratioWaterfall ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 text-xs font-medium text-slate-700">Waterfall ratio SCR (M-1 → M)</div>
                      <div className="space-y-2">
                        <div className="grid grid-cols-[120px_1fr_110px] items-center gap-2 text-xs">
                          <div className="text-slate-600">Ratio départ</div>
                          <div className="relative h-6 rounded bg-white">
                            <div
                              className="absolute top-1 bottom-1 rounded bg-slate-500"
                              style={{ left: "0%", width: `${Math.max(2, ratioWaterfall.pct(ratioWaterfall.start))}%` }}
                            />
                          </div>
                          <div className="text-right font-medium text-slate-700">{formatPct(ratioWaterfall.start)}</div>
                        </div>

                        {ratioWaterfall.steps.map((step) => {
                          const positive = step.delta >= 0;
                          const left = ratioWaterfall.pct(step.low);
                          const width = Math.max(1.5, ratioWaterfall.pct(step.high) - ratioWaterfall.pct(step.low));
                          const connectorLeft = ratioWaterfall.pct(step.from);
                          return (
                            <div key={step.key} className="grid grid-cols-[120px_1fr_110px] items-center gap-2 text-xs">
                              <div className="text-slate-600">{step.label}</div>
                              <div className="relative h-6 rounded bg-white">
                                <div
                                  className="absolute top-1/2 h-px bg-slate-300"
                                  style={{ left: `${Math.min(left, connectorLeft)}%`, width: `${Math.max(0.5, Math.abs(connectorLeft - left))}%` }}
                                />
                                <div
                                  className={`absolute top-1 bottom-1 rounded ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
                                  style={{ left: `${left}%`, width: `${width}%` }}
                                />
                              </div>
                              <div className={`text-right font-medium ${positive ? "text-emerald-700" : "text-rose-700"}`}>
                                {formatSignedPctPoints(step.delta)}
                              </div>
                            </div>
                          );
                        })}

                        <div className="grid grid-cols-[120px_1fr_110px] items-center gap-2 text-xs">
                          <div className="text-slate-600">Ratio fin</div>
                          <div className="relative h-6 rounded bg-white">
                            <div
                              className="absolute top-1 bottom-1 rounded bg-blue-600"
                              style={{ left: "0%", width: `${Math.max(2, ratioWaterfall.pct(ratioWaterfall.end))}%` }}
                            />
                          </div>
                          <div className="text-right font-medium text-slate-900">{formatPct(ratioWaterfall.end)}</div>
                        </div>
                      </div>

                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                          <div className="font-medium text-slate-700">Effet Δ FP</div>
                          <div className="mt-1">
                            {formatMoney(ratioWaterfall.ofPrev)} → {formatMoney(ratioWaterfall.ofCur)} ({formatSignedMoney(ratioWaterfall.ofCur - ratioWaterfall.ofPrev)})
                          </div>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                          <div className="font-medium text-slate-700">Effet Δ SCR</div>
                          <div className="mt-1">
                            {formatMoney(ratioWaterfall.scrPrev)} → {formatMoney(ratioWaterfall.scrCur)} ({formatSignedMoney(ratioWaterfall.scrCur - ratioWaterfall.scrPrev)})
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs">Composante</th>
                          <th className="px-3 py-2 text-right text-xs">M-1</th>
                          <th className="px-3 py-2 text-right text-xs">M</th>
                          <th className="px-3 py-2 text-right text-xs">Delta</th>
                          <th className="px-3 py-2 text-left text-xs">Observation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variationRows.map((row) => {
                          const positive = Number(row.delta || 0) >= 0;
                          return (
                            <tr key={row.key} className="border-t border-slate-100">
                              <td className="px-3 py-2 text-xs text-slate-700">{row.label}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.prev)}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cur)}</td>
                              <td className={`px-3 py-2 text-right text-xs font-medium ${positive ? "text-rose-700" : "text-emerald-700"}`}>
                                {formatSignedMoney(row.delta)}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-500">{positive ? "Hausse" : "Baisse"}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-2 text-xs font-medium text-slate-700">Ratio solvabilité</td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${solvencyRatioValueClass(monthlyDelta.previous.solvency_ratio_pct)}`}>
                            {formatPct(monthlyDelta.previous.solvency_ratio_pct)}
                          </td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${solvencyRatioValueClass(monthlyDelta.current.solvency_ratio_pct)}`}>
                            {formatPct(monthlyDelta.current.solvency_ratio_pct)}
                          </td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${monthlyDelta.deltas.solvency_ratio_pts >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {formatSignedPctPoints(monthlyDelta.deltas.solvency_ratio_pts)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500">points de ratio</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Pas assez de données mensuelles pour calculer une variation (minimum : 2 mois avec snapshot S2).
                </div>
              )}
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="mb-2 text-xs font-medium text-slate-700">Alertes & traçabilité</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 text-xs text-slate-600">
                  <div>Dernier snapshot S2 : <span className="font-medium text-slate-900">{latest?.snapshot_date || "—"}</span></div>
                  <div>Run S2 : <span className="font-medium text-slate-900">{latest?.run_id ?? "—"}</span></div>
                  <div>Source S2 : <span className="font-medium text-slate-900">{latest?.source === "real" ? "Réel" : latest?.source === "simulation" ? "Simulation" : "—"}</span></div>
                  <div>Méthodologie : <span className="font-medium text-slate-900">{latest?.methodology_version || "—"}</span></div>
                  <div>Dernier snapshot ALM : <span className="font-medium text-slate-900">{data.summary.latest_alm_snapshot_date || "—"}</span></div>
                  <div>Fraîcheur ALM : <span className="font-medium text-slate-900">{data.summary.alm_freshness_days ?? "—"} j</span></div>
                </div>
                <div className="space-y-1">
                  {data.summary.alert_messages.length ? (
                    data.summary.alert_messages.map((msg, idx) => (
                      <div key={`${idx}-${msg}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {msg}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                      Aucun signal de vigilance détecté sur les seuils MVP.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <ToggleTableHeader
                title="Suivi mensuel (dernière photo S2 par mois sur l'année)"
                visible={monthlyTableVisible}
                onToggle={() => setMonthlyTableVisible((v) => !v)}
                rightActions={
                  <button
                    type="button"
                    onClick={() => setMonthlyTrendVisible((v) => !v)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                      monthlyTrendVisible
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                    title={monthlyTrendVisible ? "Masquer les courbes d'évolution" : "Afficher les courbes d'évolution"}
                    aria-label={monthlyTrendVisible ? "Masquer les courbes d'évolution" : "Afficher les courbes d'évolution"}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 3v18h18" />
                      <path d="M7 15l4-4 3 3 5-6" />
                    </svg>
                  </button>
                }
              />
              {monthlyTrendVisible ? <SolvencyMonthlyTrendChart rows={data.monthly} year={year} /> : null}
              {monthlyTableVisible ? (
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left"><InfoLabel label="Mois" help={TABLE_TOOLTIPS.month} /></th>
                        <th className="px-3 py-2 text-left"><InfoLabel label="Snapshot" help={TABLE_TOOLTIPS.snapshot} /></th>
                        <th className="px-3 py-2 text-left">Source</th>
                        <th className="px-3 py-2 text-right"><InfoLabel label="Ratio SCR" help={TABLE_TOOLTIPS.ratioScr} align="right" className="justify-end" /></th>
                        <th className="px-3 py-2 text-right"><InfoLabel label="Couverture MCR" help={TABLE_TOOLTIPS.mcrCoverage} align="right" className="justify-end" /></th>
                        <th className="px-3 py-2 text-right"><InfoLabel label="FP éligibles" help={TABLE_TOOLTIPS.ownFunds} align="right" className="justify-end" /></th>
                        <th className="px-3 py-2 text-right"><InfoLabel label="SCR" help={TABLE_TOOLTIPS.scr} align="right" className="justify-end" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.monthly.map((row) => (
                        <tr key={row.month} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-xs text-slate-700">{row.label}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{row.snapshot_date || "—"}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{row.source === "real" ? "Réel" : row.source === "simulation" ? "Simulation" : "—"}</td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${riskCellClass(row.solvency_ratio_pct, "scr")}`}>{formatPct(row.solvency_ratio_pct)}</td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${riskCellClass(row.mcr_coverage_pct, "mcr")}`}>{formatPct(row.mcr_coverage_pct)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{row.snapshot_date ? formatMoney(row.own_funds_eligible) : "—"}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{row.snapshot_date ? formatMoney(row.scr_total) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <ToggleTableHeader title="Historique récent des snapshots S2" visible={tableVisible} onToggle={() => setTableVisible((v) => !v)} />
              {tableVisible ? (
                <div className="space-y-3">
                  <RecentSnapshotsStackedChart rows={data.recent_snapshots} />
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left"><InfoLabel label="Date snapshot" help={TABLE_TOOLTIPS.snapshot} /></th>
                          <th className="px-3 py-2 text-right"><InfoLabel label="Run" help={TABLE_TOOLTIPS.run} align="right" className="justify-end" /></th>
                          <th className="px-3 py-2 text-left">Source</th>
                          <th className="px-3 py-2 text-right"><InfoLabel label="FP éligibles" help={TABLE_TOOLTIPS.ownFunds} align="right" className="justify-end" /></th>
                          <th className="px-3 py-2 text-right"><InfoLabel label="SCR" help={TABLE_TOOLTIPS.scr} align="right" className="justify-end" /></th>
                          <th className="px-3 py-2 text-right"><InfoLabel label="MCR" help={TABLE_TOOLTIPS.mcr} align="right" className="justify-end" /></th>
                          <th className="px-3 py-2 text-right"><InfoLabel label="Ratio SCR" help={TABLE_TOOLTIPS.ratioScr} align="right" className="justify-end" /></th>
                          <th className="px-3 py-2 text-left"><InfoLabel label="Méthodologie" help={TABLE_TOOLTIPS.methodology} /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent_snapshots.map((row) => (
                          <tr key={`${row.snapshot_date}-${row.run_id}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-xs text-slate-700">{row.snapshot_date || "—"}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{row.run_id ?? "—"}</td>
                            <td className="px-3 py-2 text-xs text-slate-700">{row.source === "real" ? "Réel" : row.source === "simulation" ? "Simulation" : "—"}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.own_funds_eligible)}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.scr_total)}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.mcr)}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatPct(row.solvency_ratio_pct)}</td>
                            <td className="px-3 py-2 text-xs text-slate-700">{row.methodology_version || "—"}</td>
                          </tr>
                        ))}
                        {!data.recent_snapshots.length ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-3 text-xs text-slate-500">
                              Aucun snapshot S2 sur l'année sélectionnée.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </RequireAuth>
  );
}
