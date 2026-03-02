"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import { apiRequest } from "@/lib/api";

type PortfolioBranch = {
  branch_code: string;
  branch_name: string;
  premiums_amount: number;
  estimated_amount: number;
  paid_amount: number;
};

type PortfolioSummaryResponse = {
  year: number;
  summary: {
    total_premiums: number;
    total_estimated: number;
    total_paid: number;
    branch_count: number;
    top5_branch_concentration_pct: number;
    dominant_branch_code: string | null;
    dominant_branch_name: string | null;
    dominant_branch_premiums: number;
  };
};

type PortfolioBreakdownResponse = {
  year: number;
  branches: PortfolioBranch[];
  top_partners: { partner_id: number; partner_name: string; premiums_amount: number }[];
  top_clients: { client_id: number; client_ref: string; premiums_amount: number }[];
};

type PortfolioPageDataResponse = PortfolioSummaryResponse & PortfolioBreakdownResponse & {
  cache_hit?: boolean;
};

function formatMoney(value: number | string | null | undefined, currency = "EUR") {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(Number(value || 0))).replace(/[\u202f\u00a0]/g, " ")} ${currency}`;
}
function formatPct(v: number) {
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)} %`;
}

function BranchBars({ rows, total }: { rows: PortfolioBranch[]; total: number }) {
  const top = rows.slice(0, 10);
  const max = Math.max(1, ...top.map((r) => r.premiums_amount));
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-600">Répartition primes encaissées par branche (Top 10)</div>
      <div className="space-y-2">
        {top.map((row) => {
          const width = (row.premiums_amount / max) * 100;
          const share = total > 0 ? (row.premiums_amount / total) * 100 : 0;
          return (
            <div key={`${row.branch_code}-${row.branch_name}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="truncate text-slate-700">{row.branch_code} - {row.branch_name}</div>
                <div className="shrink-0 text-slate-600">{formatMoney(row.premiums_amount)} ({formatPct(share)})</div>
              </div>
              <div className="h-3 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                <div className="h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, width))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopList({ title, rows, valueKey, labelKey }: { title: string; rows: any[]; valueKey: string; labelKey: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-medium text-slate-700">{title}</div>
      <div className="space-y-2">
        {rows.length ? rows.map((r, i) => (
          <div key={`${title}-${i}`} className="flex items-center justify-between gap-2 text-xs">
            <div className="truncate text-slate-700">{i + 1}. {String(r[labelKey] || "—")}</div>
            <div className="shrink-0 font-medium text-slate-900">{formatMoney(Number(r[valueKey] || 0))}</div>
          </div>
        )) : <div className="text-xs text-slate-500">Aucune donnée</div>}
      </div>
    </div>
  );
}

function PortfolioConcentrationGauge({
  rows,
  total,
}: {
  rows: PortfolioBranch[];
  total: number;
}) {
  const palette = [
    { bar: "bg-blue-700", card: "border-blue-700 bg-blue-700", text: "text-white" },
    { bar: "bg-blue-600", card: "border-blue-600 bg-blue-600", text: "text-white" },
    { bar: "bg-sky-600", card: "border-sky-600 bg-sky-600", text: "text-white" },
    { bar: "bg-cyan-600", card: "border-cyan-600 bg-cyan-600", text: "text-white" },
    { bar: "bg-teal-600", card: "border-teal-600 bg-teal-600", text: "text-white" },
  ] as const;

  const top = rows.slice(0, 5);
  const topSum = top.reduce((sum, r) => sum + Number(r.premiums_amount || 0), 0);
  const rowsTotal = rows.reduce((sum, r) => sum + Number(r.premiums_amount || 0), 0);
  const baseTotal = rowsTotal > 0 ? rowsTotal : Number(total || 0);
  const othersAmount = Math.max(0, baseTotal - topSum);
  const segments = [
    ...top.map((r, i) => {
      const amount = Number(r.premiums_amount || 0);
      const pct = baseTotal > 0 ? (amount / baseTotal) * 100 : 0;
      return {
        key: `top-${i + 1}`,
        label: `Top ${i + 1} — ${r.branch_code || "—"} ${r.branch_name || ""}`.trim(),
        shortLabel: `Top ${i + 1}`,
        amount,
        pct,
        ...palette[i],
      };
    }),
    ...(othersAmount > 0 || rows.length > 5
      ? [
          {
            key: "others",
            label: "Autres branches",
            shortLabel: "Autres",
            amount: othersAmount,
            pct: baseTotal > 0 ? (othersAmount / baseTotal) * 100 : 0,
            bar: "bg-slate-300",
            card: "border-slate-300 bg-slate-300",
            text: "text-slate-900",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>Concentration du portefeuille (base 100% = primes encaissées année)</span>
        <span className="font-medium text-slate-700">{formatMoney(baseTotal)}</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
        <div className="flex h-full w-full">
          {segments.map((s) => (
            <div
              key={s.key}
              className={s.bar}
              style={{ flexGrow: Math.max(0, s.amount), flexBasis: 0 }}
              title={`${s.label}: ${formatMoney(s.amount)} (${formatPct(s.pct)})`}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {segments.map((s) => (
          <div key={`${s.key}-legend`} className={`rounded-md border px-3 py-2 text-xs ${s.card} ${s.text}`}>
            <div className="font-medium">{s.shortLabel}</div>
            <div className="truncate">{s.label.replace(/^Top \d+ —\s*/, "")}</div>
            <div className="mt-0.5">
              <span className="font-semibold">{formatMoney(s.amount)}</span> ({formatPct(s.pct)})
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PortefeuillePage() {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [summary, setSummary] = useState<PortfolioSummaryResponse | null>(null);
  const [breakdown, setBreakdown] = useState<PortfolioBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableVisible, setTableVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiRequest<PortfolioPageDataResponse>(`/api/pilotage/portfolio-page-data?year=${year}`)
      .then((payload) => {
        if (cancelled) return;
        setSummary({ year: payload.year, summary: payload.summary });
        setBreakdown({
          year: payload.year,
          branches: Array.isArray(payload.branches) ? payload.branches : [],
          top_partners: Array.isArray(payload.top_partners) ? payload.top_partners : [],
          top_clients: Array.isArray(payload.top_clients) ? payload.top_clients : [],
        });
        setTableVisible(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement");
        setSummary(null);
        setBreakdown(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [year]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Portefeuille"
            description="Répartition par branche, top partenaires/clients et concentration (constat année)."
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-600">Année
              <select value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {Array.from({ length: 8 }, (_, i) => currentYear - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <Link href="/dashboard" className="text-xs text-blue-600 underline">Retour dashboard</Link>
          </div>
        </div>

        {loading ? <div className="rounded-md border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">Chargement…</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700">{error}</div> : null}

        {summary && breakdown ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Primes (année)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.total_premiums)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Sinistres enregistrés (année)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.total_estimated)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Règlements (année)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.total_paid)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Branches actives</div><div className="mt-1 text-sm font-semibold text-slate-900">{summary.summary.branch_count}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Branche dominante</div><div className="mt-1 text-sm font-semibold text-slate-900 truncate">{summary.summary.dominant_branch_code || "—"} {summary.summary.dominant_branch_name ? `- ${summary.summary.dominant_branch_name}` : ""}</div></div>
            </div>

            <PortfolioConcentrationGauge rows={breakdown.branches} total={Number(summary.summary.total_premiums || 0)} />

            <div className="grid gap-3 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <BranchBars rows={breakdown.branches} total={summary.summary.total_premiums} />
              </div>
              <div className="space-y-3">
                <TopList title="Top partenaires (primes)" rows={breakdown.top_partners} valueKey="premiums_amount" labelKey="partner_name" />
                <TopList title="Top clients (primes)" rows={breakdown.top_clients} valueKey="premiums_amount" labelKey="client_ref" />
              </div>
            </div>

            <div className="space-y-2">
              <ToggleTableHeader title="Tableau branches (année)" visible={tableVisible} onToggle={() => setTableVisible((v) => !v)} />
              {tableVisible ? (
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Branche</th>
                        <th className="px-3 py-2 text-right">Primes encaissées</th>
                        <th className="px-3 py-2 text-right">Sinistres enregistrés</th>
                        <th className="px-3 py-2 text-right">Règlements</th>
                        <th className="px-3 py-2 text-right">Ratio sinistres/primes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.branches.map((row) => {
                        const ratio = row.premiums_amount > 0 ? (row.estimated_amount / row.premiums_amount) * 100 : 0;
                        return (
                          <tr key={`${row.branch_code}-${row.branch_name}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-xs text-slate-700">{row.branch_code} - {row.branch_name}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.premiums_amount)}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.estimated_amount)}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.paid_amount)}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-700">{formatPct(ratio)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </RequireAuth>
  );
}
