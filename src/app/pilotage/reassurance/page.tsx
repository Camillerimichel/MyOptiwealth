"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import PeriodZoomControls from "@/components/pilotage/PeriodZoomControls";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import TwoSegmentGaugePanel from "@/components/pilotage/TwoSegmentGaugePanel";
import { apiRequest } from "@/lib/api";

type ReinsSummary = {
  year: number;
  summary: {
    premium_ceded: number;
    commission_reinsurance: number;
    net_cost: number;
    claim_paid_ceded: number;
    claim_reserve_ceded: number;
    claim_recovery: number;
    fronting_fee_total: number;
    claims_handling_fee_total: number;
    premium_net_to_captive_total: number;
    counterparty_exposure_est_total: number;
    runs_with_premium_cessions: number;
    runs_with_claim_cessions: number;
  };
};

type ReinsTrendMonth = {
  month: string;
  label: string;
  premium_ceded_amount: number;
  recovery_amount: number;
  fronting_cost_amount: number;
  cumulative_premium_ceded: number;
  cumulative_recovery: number;
  cumulative_fronting_cost: number;
};

type ReinsTrend = {
  year: number;
  totals: { premium_ceded: number; recovery: number; fronting_cost: number };
  months: ReinsTrendMonth[];
};

function formatMoney(v: number | string | null | undefined, c = "EUR") {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(Number(v || 0))).replace(/[\u202f\u00a0]/g, " ")} ${c}`;
}
function formatPct(v: number) {
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)} %`;
}
function kEuroLabel(v: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v / 1000)).replace(/\u202f/g, " ")} k€`;
}

function ReinsChart({ months }: { months: ReinsTrendMonth[] }) {
  const width = 980, height = 320, left = 76, right = 18, top = 18, bottom = 40;
  const plotW = width - left - right, plotH = height - top - bottom;
  const maxVal = Math.max(1, ...months.flatMap((m) => [m.cumulative_premium_ceded, m.cumulative_recovery, m.cumulative_fronting_cost]));
  const x = (i: number) => left + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
  const y = (v: number) => top + plotH - (Math.max(0, v) / maxVal) * plotH;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[900px] w-full" role="img" aria-label="Flux réassurance et fronting">
        {Array.from({ length: 5 }, (_, i) => {
          const val = (maxVal / 4) * i; const yy = y(val);
          return <g key={i}><line x1={left} x2={width-right} y1={yy} y2={yy} stroke="#e2e8f0" /><text x={left-10} y={yy+4} textAnchor="end" fontSize="11" fill="#475569">{kEuroLabel(val)}</text></g>;
        })}
        {months.map((m, i) => <text key={m.month} x={x(i)} y={height-12} textAnchor="middle" fontSize="10" fill="#64748b">{m.month.slice(5)}</text>)}
        <polyline fill="none" stroke="#2563eb" strokeWidth="2.5" points={line(months.map((m)=>m.cumulative_premium_ceded))} />
        <polyline fill="none" stroke="#16a34a" strokeWidth="2.5" points={line(months.map((m)=>m.cumulative_recovery))} />
        <polyline fill="none" stroke="#ef4444" strokeWidth="2.5" points={line(months.map((m)=>m.cumulative_fronting_cost))} />
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-blue-600 bg-blue-600 px-2 py-1 text-white">Cumul primes cédées</span>
        <span className="rounded-md border border-emerald-600 bg-emerald-600 px-2 py-1 text-white">Cumul recoveries</span>
        <span className="rounded-md border border-red-500 bg-red-500 px-2 py-1 text-white">Cumul coûts fronting</span>
      </div>
    </div>
  );
}

export default function ReassurancePage() {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [summary, setSummary] = useState<ReinsSummary | null>(null);
  const [trend, setTrend] = useState<ReinsTrend | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [tableVisible, setTableVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([
      apiRequest<ReinsSummary>(`/api/pilotage/reinsurance-summary?year=${year}`),
      apiRequest<ReinsTrend>(`/api/pilotage/reinsurance-trend?year=${year}`),
    ])
      .then(([s, t]) => {
        if (cancelled) return;
        setSummary(s); setTrend(t);
        const months = Array.isArray(t?.months) ? t.months : [];
        setFromMonth(months[0]?.month || "");
        setToMonth(months[months.length - 1]?.month || "");
        setTableVisible(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement");
        setSummary(null); setTrend(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  const monthsFiltered = useMemo(() => {
    if (!trend?.months?.length) return [] as ReinsTrendMonth[];
    return trend.months.filter((m) => (!fromMonth || m.month >= fromMonth) && (!toMonth || m.month <= toMonth));
  }, [trend, fromMonth, toMonth]);

  const hasData = useMemo(() => {
    if (!summary) return false;
    const s = summary.summary;
    return [s.premium_ceded, s.claim_recovery, s.fronting_fee_total, s.claims_handling_fee_total, s.claim_paid_ceded, s.claim_reserve_ceded].some((v) => Math.abs(Number(v || 0)) > 0);
  }, [summary]);

  const gauge = useMemo(() => {
    if (!summary) return null;
    const recovery = Math.max(0, summary.summary.claim_recovery || 0);
    const costs = Math.max(0, (summary.summary.fronting_fee_total || 0) + (summary.summary.claims_handling_fee_total || 0));
    const base = Math.max(1, recovery + costs);
    return {
      base,
      recovery,
      costs,
      recoveryPct: (recovery / base) * 100,
      costsPct: (costs / base) * 100,
    };
  }, [summary]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Réassurance / fronting"
            description="MVP partiel (constat simulation) : cessions, recoveries et coûts de fronting agrégés."
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

        {summary && trend ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Primes cédées</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.premium_ceded)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Recoveries</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.claim_recovery)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Coûts fronting</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney((summary.summary.fronting_fee_total||0)+(summary.summary.claims_handling_fee_total||0))}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Exposition contrepartie (est.)</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.counterparty_exposure_est_total)}</div></div>
              <div className="rounded-md border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Runs avec cessions</div><div className="mt-1 text-sm font-semibold text-slate-900">{summary.summary.runs_with_premium_cessions}/{summary.summary.runs_with_claim_cessions}</div></div>
            </div>

            {!hasData ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-800">
                Aucune donnée de réassurance/fronting détectée sur l’année sélectionnée (tables de simulation/fronting). La page reste prête pour affichage dès alimentation des runs.
              </div>
            ) : (
              <>
                <PeriodZoomControls
                  months={trend.months}
                  fromMonth={fromMonth}
                  toMonth={toMonth}
                  onChangeFrom={(next) => { setFromMonth(next); if (toMonth && next > toMonth) setToMonth(next); }}
                  onChangeTo={(next) => { setToMonth(next); if (fromMonth && next < fromMonth) setFromMonth(next); }}
                  onReset={() => { setFromMonth(trend.months[0]?.month || ""); setToMonth(trend.months[trend.months.length - 1]?.month || ""); }}
                />

                <ReinsChart months={monthsFiltered} />

                {gauge ? (
                  <TwoSegmentGaugePanel
                    caption="Recoveries vs coûts de fronting (base 100% = recoveries + coûts de fronting)"
                    totalLabel={formatMoney(gauge.base)}
                    leftPct={gauge.recoveryPct}
                    rightPct={gauge.costsPct}
                    left={{
                      label: "Recoveries",
                      amountLabel: formatMoney(gauge.recovery),
                      pctLabel: formatPct(gauge.recoveryPct),
                      barColorClass: "bg-emerald-600",
                      cardClass: "border-emerald-600 bg-emerald-600",
                      textClass: "text-white",
                    }}
                    right={{
                      label: "Coûts de fronting",
                      amountLabel: formatMoney(gauge.costs),
                      pctLabel: formatPct(gauge.costsPct),
                      barColorClass: "bg-red-500",
                      cardClass: "border-red-500 bg-red-500",
                      textClass: "text-white",
                    }}
                  />
                ) : null}

                <div className="space-y-2">
                  <ToggleTableHeader title="Tableau mensuel réassurance/fronting" visible={tableVisible} onToggle={() => setTableVisible((v) => !v)} />
                  {tableVisible ? (
                    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 text-left">Mois</th>
                            <th className="px-3 py-2 text-right">Primes cédées</th>
                            <th className="px-3 py-2 text-right">Recoveries</th>
                            <th className="px-3 py-2 text-right">Coûts fronting</th>
                            <th className="px-3 py-2 text-right">Cumul cessions</th>
                            <th className="px-3 py-2 text-right">Cumul recoveries</th>
                            <th className="px-3 py-2 text-right">Cumul coûts fronting</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthsFiltered.map((m) => (
                            <tr key={m.month} className="border-t border-slate-100">
                              <td className="px-3 py-2 text-xs text-slate-700">{m.month}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(m.premium_ceded_amount)}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(m.recovery_amount)}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(m.fronting_cost_amount)}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(m.cumulative_premium_ceded)}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(m.cumulative_recovery)}</td>
                              <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(m.cumulative_fronting_cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </RequireAuth>
  );
}
