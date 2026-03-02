"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import PeriodZoomControls from "@/components/pilotage/PeriodZoomControls";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import TwoSegmentGaugePanel from "@/components/pilotage/TwoSegmentGaugePanel";
import { apiRequest } from "@/lib/api";

type PerformanceMonth = {
  month: string;
  label: string;
  premiums_amount: number;
  estimated_amount: number;
  paid_amount: number;
  cumulative_premiums: number;
  cumulative_estimated: number;
  cumulative_paid: number;
};

type PerformanceTrendResponse = {
  year: number;
  totals: { premiums: number; estimated: number; paid: number };
  months: PerformanceMonth[];
};

type PerformanceSummaryResponse = {
  year: number;
  summary: {
    premiums_cumulative: number;
    estimated_cumulative: number;
    paid_cumulative: number;
    sp_estimated_pct: number;
    sp_paid_pct: number;
    current_month: string | null;
    current_month_premiums: number;
    current_month_estimated: number;
    current_month_paid: number;
  };
};

function formatMoney(value: number | string | null | undefined, currency = "EUR") {
  const n = Number(value || 0);
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/[\u202f\u00a0]/g, " ")} ${currency}`;
}

function formatPct(value: number) {
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`;
}

function kEuroLabel(value: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(value / 1000)).replace(/\u202f/g, " ")} k€`;
}

function PerformanceChart({ months }: { months: PerformanceMonth[] }) {
  const width = 980;
  const height = 320;
  const leftPad = 76;
  const rightPad = 18;
  const topPad = 18;
  const bottomPad = 40;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;
  const maxVal = Math.max(1, ...months.flatMap((m) => [m.cumulative_premiums, m.cumulative_estimated, m.cumulative_paid]));
  const x = (i: number) => leftPad + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
  const y = (v: number) => topPad + plotH - (Math.max(0, v) / maxVal) * plotH;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[900px] w-full" role="img" aria-label="Performance technique cumulée">
        {Array.from({ length: 5 }, (_, i) => {
          const val = (maxVal / 4) * i;
          const yy = y(val);
          return (
            <g key={i}>
              <line x1={leftPad} x2={width - rightPad} y1={yy} y2={yy} stroke="#e2e8f0" strokeWidth="1" />
              <text x={leftPad - 10} y={yy + 4} textAnchor="end" fontSize="11" fill="#475569">{kEuroLabel(val)}</text>
            </g>
          );
        })}
        {months.map((m, i) => (
          <text key={`m-${m.month}`} x={x(i)} y={height - 12} textAnchor="middle" fontSize="10" fill="#64748b">{m.month.slice(5)}</text>
        ))}
        <polyline fill="none" stroke="#2563eb" strokeWidth="2.5" points={line(months.map((m) => m.cumulative_premiums))} />
        <polyline fill="none" stroke="#f59e0b" strokeWidth="2.5" points={line(months.map((m) => m.cumulative_estimated))} />
        <polyline fill="none" stroke="#ef4444" strokeWidth="2.5" points={line(months.map((m) => m.cumulative_paid))} />
        {months.map((m, i) => (
          <g key={`dots-${m.month}`}>
            <circle cx={x(i)} cy={y(m.cumulative_premiums)} r={2.5} fill="#2563eb"><title>{`${m.month} cumul primes: ${formatMoney(m.cumulative_premiums)}`}</title></circle>
            <circle cx={x(i)} cy={y(m.cumulative_estimated)} r={2.5} fill="#f59e0b"><title>{`${m.month} cumul sinistres enregistrés: ${formatMoney(m.cumulative_estimated)}`}</title></circle>
            <circle cx={x(i)} cy={y(m.cumulative_paid)} r={2.5} fill="#ef4444"><title>{`${m.month} cumul règlements: ${formatMoney(m.cumulative_paid)}`}</title></circle>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-blue-600 bg-blue-600 px-2 py-1 text-white">Cumul primes encaissées</span>
        <span className="rounded-md border border-amber-500 bg-amber-500 px-2 py-1 text-slate-900">Cumul sinistres enregistrés</span>
        <span className="rounded-md border border-red-500 bg-red-500 px-2 py-1 text-white">Cumul règlements</span>
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [summary, setSummary] = useState<PerformanceSummaryResponse | null>(null);
  const [trend, setTrend] = useState<PerformanceTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [tableVisible, setTableVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiRequest<PerformanceSummaryResponse>(`/api/pilotage/performance-summary?year=${year}`),
      apiRequest<PerformanceTrendResponse>(`/api/pilotage/performance-trend?year=${year}`),
    ])
      .then(([s, t]) => {
        if (cancelled) return;
        setSummary(s);
        setTrend(t);
        const months = Array.isArray(t?.months) ? t.months : [];
        setFromMonth(months[0]?.month || "");
        setToMonth(months[months.length - 1]?.month || "");
        setTableVisible(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement");
        setSummary(null);
        setTrend(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const monthsFiltered = useMemo(() => {
    if (!trend?.months?.length) return [] as PerformanceMonth[];
    return trend.months.filter((m) => (!fromMonth || m.month >= fromMonth) && (!toMonth || m.month <= toMonth));
  }, [trend, fromMonth, toMonth]);

  const periodGauge = useMemo(() => {
    if (!monthsFiltered.length) return null;
    const last = monthsFiltered[monthsFiltered.length - 1];
    const premiums = Math.max(0, Number(last.cumulative_premiums || 0));
    const estimated = Math.max(0, Number(last.cumulative_estimated || 0));
    const estimatedCapped = Math.min(estimated, premiums);
    const remaining = Math.max(premiums - estimatedCapped, 0);
    const estimatedPct = premiums > 0 ? (estimatedCapped / premiums) * 100 : 0;
    const remainingPct = premiums > 0 ? (remaining / premiums) * 100 : 0;
    return {
      from: monthsFiltered[0].month,
      to: last.month,
      premiums,
      estimated,
      estimatedCapped,
      remaining,
      estimatedPct,
      remainingPct,
    };
  }, [monthsFiltered]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Performance technique"
            description="Primes encaissées, sinistres enregistrés, règlements et ratios techniques (constat)."
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-600">
              Année
              <select value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {Array.from({ length: 8 }, (_, i) => currentYear - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <Link href="/dashboard" className="text-xs text-blue-600 underline">Retour dashboard</Link>
          </div>
        </div>

        {loading ? <div className="rounded-md border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">Chargement…</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700">{error}</div> : null}

        {summary && trend ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Primes encaissées (cumul)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.premiums_cumulative)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Sinistres enregistrés (cumul)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.estimated_cumulative)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Règlements (cumul)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.paid_cumulative)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Ratio sinistres/primes</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatPct(summary.summary.sp_estimated_pct)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Ratio règlements/primes</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatPct(summary.summary.sp_paid_pct)}</div></div>
            </div>

            <PeriodZoomControls
              months={trend.months}
              fromMonth={fromMonth}
              toMonth={toMonth}
              onChangeFrom={(next) => { setFromMonth(next); if (toMonth && next > toMonth) setToMonth(next); }}
              onChangeTo={(next) => { setToMonth(next); if (fromMonth && next < fromMonth) setFromMonth(next); }}
              onReset={() => {
                setFromMonth(trend.months[0]?.month || "");
                setToMonth(trend.months[trend.months.length - 1]?.month || "");
              }}
            />

            <PerformanceChart months={monthsFiltered} />

            {periodGauge ? (
              <TwoSegmentGaugePanel
                caption={`Jauge fin de période (${periodGauge.from} -> ${periodGauge.to}) - base 100% = cumul primes encaissées`}
                totalLabel={formatMoney(periodGauge.premiums)}
                leftPct={periodGauge.estimatedPct}
                rightPct={periodGauge.remainingPct}
                left={{
                  label: "Sinistres enregistrés (cumul)",
                  amountLabel: formatMoney(periodGauge.estimated),
                  pctLabel: formatPct(periodGauge.estimatedPct),
                  barColorClass: "bg-amber-500",
                  cardClass: "border-amber-500 bg-amber-500",
                  textClass: "text-slate-900",
                }}
                right={{
                  label: "Marge brute (primes - sinistres)",
                  amountLabel: formatMoney(periodGauge.remaining),
                  pctLabel: formatPct(periodGauge.remainingPct),
                  barColorClass: "bg-emerald-500",
                  cardClass: "border-emerald-500 bg-emerald-500",
                  textClass: "text-white",
                }}
              />
            ) : null}

            <div className="space-y-2">
              <ToggleTableHeader title="Tableau mensuel de performance" visible={tableVisible} onToggle={() => setTableVisible((v) => !v)} />
              {tableVisible ? (
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Mois</th>
                        <th className="px-3 py-2 text-right">Primes encaissées</th>
                        <th className="px-3 py-2 text-right">Sinistres enregistrés</th>
                        <th className="px-3 py-2 text-right">Règlements</th>
                        <th className="px-3 py-2 text-right">Cumul primes</th>
                        <th className="px-3 py-2 text-right">Cumul sinistres</th>
                        <th className="px-3 py-2 text-right">Cumul règlements</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthsFiltered.map((row) => (
                        <tr key={row.month} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-xs text-slate-700">{row.month}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.premiums_amount)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.estimated_amount)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.paid_amount)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_premiums)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_estimated)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_paid)}</td>
                        </tr>
                      ))}
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
