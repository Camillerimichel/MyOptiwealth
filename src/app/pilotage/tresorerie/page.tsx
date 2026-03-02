"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import PeriodZoomControls from "@/components/pilotage/PeriodZoomControls";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import TwoSegmentGaugePanel from "@/components/pilotage/TwoSegmentGaugePanel";
import { apiRequest } from "@/lib/api";

type TreasuryMonth = {
  month: string;
  label: string;
  inflows_amount: number;
  outflows_amount: number;
  net_amount: number;
  cumulative_inflows: number;
  cumulative_outflows: number;
  cumulative_net: number;
};

type TreasuryTrendResponse = {
  year: number;
  totals: { inflows: number; outflows: number; net: number };
  months: TreasuryMonth[];
};

type TreasurySummaryResponse = {
  year: number;
  summary: {
    cash_observe_label: string;
    inflows_cumulative: number;
    outflows_cumulative: number;
    net_cumulative: number;
    current_month: string | null;
    current_month_inflows: number;
    current_month_outflows: number;
    current_month_net: number;
    gross_flow_cumulative: number;
  };
};

function formatMoney(value: number | string | null | undefined, currency = "EUR") {
  const n = Number(value || 0);
  const grouped = new Intl.NumberFormat("fr-FR", {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(Math.round(n))
    .replace(/[\u202f\u00a0]/g, " ");
  return `${grouped} ${currency}`;
}

function formatSignedMoney(value: number, currency = "EUR") {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatMoney(Math.abs(value), currency)}`;
}

function kEuroLabel(value: number) {
  const k = value / 1000;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(k)).replace(/\u202f/g, " ")} k€`;
}

function TreasuryTrendChart({ months }: { months: TreasuryMonth[] }) {
  const width = 920;
  const height = 300;
  const leftPad = 72;
  const rightPad = 20;
  const topPad = 20;
  const bottomPad = 40;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;

  const maxVal = Math.max(
    1,
    ...months.flatMap((m) => [Math.abs(m.inflows_amount), Math.abs(m.outflows_amount), Math.abs(m.cumulative_net)])
  );
  const yForAbs = (v: number) => topPad + plotH - (Math.max(0, v) / maxVal) * plotH;
  const xForIndex = (i: number) => leftPad + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);

  const netPoints = months.map((m, i) => `${xForIndex(i)},${yForAbs(Math.abs(m.cumulative_net))}`).join(" ");
  const ticks = 4;
  const step = maxVal / ticks;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[860px] w-full" role="img" aria-label="Évolution des flux de trésorerie observés">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const yValue = step * i;
          const y = yForAbs(yValue);
          return (
            <g key={`tick-${i}`}>
              <line x1={leftPad} x2={width - rightPad} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={leftPad - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#475569">{kEuroLabel(yValue)}</text>
            </g>
          );
        })}

        {months.map((m, i) => {
          const x = xForIndex(i);
          const slotW = months.length <= 1 ? 30 : plotW / months.length;
          const barW = Math.max(8, Math.min(18, slotW * 0.24));
          const inflowY = yForAbs(m.inflows_amount);
          const outflowY = yForAbs(m.outflows_amount);
          return (
            <g key={m.month}>
              <rect x={x - barW - 2} y={inflowY} width={barW} height={topPad + plotH - inflowY} fill="#2563eb" opacity="0.85">
                <title>{`${m.month} encaissements primes: ${formatMoney(m.inflows_amount)}`}</title>
              </rect>
              <rect x={x + 2} y={outflowY} width={barW} height={topPad + plotH - outflowY} fill="#ef4444" opacity="0.8">
                <title>{`${m.month} règlements sinistres: ${formatMoney(m.outflows_amount)}`}</title>
              </rect>
              <text x={x} y={height - 12} textAnchor="middle" fontSize="10" fill="#64748b">{m.month.slice(5)}</text>
            </g>
          );
        })}

        {netPoints ? <polyline fill="none" stroke="#0f766e" strokeWidth="2.5" points={netPoints} /> : null}
        {months.map((m, i) => {
          const x = xForIndex(i);
          const y = yForAbs(Math.abs(m.cumulative_net));
          return <circle key={`net-dot-${m.month}`} cx={x} cy={y} r={2.5} fill="#0f766e"><title>{`${m.month} cumul net (abs): ${formatSignedMoney(m.cumulative_net)}`}</title></circle>;
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-blue-600 bg-blue-600 px-2 py-1 text-white">Barres bleues: encaissements primes</span>
        <span className="rounded-md border border-red-500 bg-red-500 px-2 py-1 text-white">Barres rouges: règlements sinistres</span>
        <span className="rounded-md border border-teal-700 bg-teal-700 px-2 py-1 text-white">Courbe: cumul net observé (valeur absolue)</span>
      </div>
    </div>
  );
}

export default function TresoreriePage() {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [summary, setSummary] = useState<TreasurySummaryResponse | null>(null);
  const [trend, setTrend] = useState<TreasuryTrendResponse | null>(null);
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
      apiRequest<TreasurySummaryResponse>(`/api/pilotage/treasury-summary?year=${year}`),
      apiRequest<TreasuryTrendResponse>(`/api/pilotage/treasury-cashflow-trend?year=${year}`),
    ])
      .then(([sumJson, trendJson]) => {
        if (cancelled) return;
        setSummary(sumJson);
        setTrend(trendJson);
        const months = Array.isArray(trendJson?.months) ? trendJson.months : [];
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
    if (!trend?.months?.length) return [] as TreasuryMonth[];
    return trend.months.filter((m) => {
      if (fromMonth && m.month < fromMonth) return false;
      if (toMonth && m.month > toMonth) return false;
      return true;
    });
  }, [trend, fromMonth, toMonth]);

  const periodSummary = useMemo(() => {
    if (!monthsFiltered.length) return null;
    const last = monthsFiltered[monthsFiltered.length - 1];
    const gross = Math.max(0, Number(last.cumulative_inflows || 0) + Number(last.cumulative_outflows || 0));
    const inflow = Math.max(0, Number(last.cumulative_inflows || 0));
    const outflow = Math.max(0, Number(last.cumulative_outflows || 0));
    const inflowPct = gross > 0 ? (inflow / gross) * 100 : 0;
    const outflowPct = gross > 0 ? (outflow / gross) * 100 : 0;
    return {
      from: monthsFiltered[0].month,
      to: last.month,
      gross,
      inflow,
      outflow,
      inflowPct,
      outflowPct,
    };
  }, [monthsFiltered]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Trésorerie & flux"
            description="Constat des flux observés : encaissements primes vs règlements sinistres."
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-600">
              Année
              <select value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {Array.from({ length: 8 }, (_, i) => currentYear - 3 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <Link href="/dashboard" className="text-xs text-blue-600 underline">Retour dashboard</Link>
          </div>
        </div>

        {loading ? <div className="rounded-md border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">Chargement…</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700">{error}</div> : null}

        {summary && trend ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Encaissements primes (cumul année)</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.inflows_cumulative)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Règlements sinistres (cumul année)</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(summary.summary.outflows_cumulative)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Flux net observé (cumul année)</div>
                <div className={`mt-1 text-sm font-semibold ${summary.summary.net_cumulative >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatSignedMoney(summary.summary.net_cumulative)}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Flux net du mois ({summary.summary.current_month || "—"})</div>
                <div className={`mt-1 text-sm font-semibold ${summary.summary.current_month_net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatSignedMoney(summary.summary.current_month_net)}
                </div>
              </div>
            </div>

            <PeriodZoomControls
              months={trend.months}
              fromMonth={fromMonth}
              toMonth={toMonth}
              onChangeFrom={(next) => {
                setFromMonth(next);
                if (toMonth && next > toMonth) setToMonth(next);
              }}
              onChangeTo={(next) => {
                setToMonth(next);
                if (fromMonth && next < fromMonth) setFromMonth(next);
              }}
              onReset={() => {
                setFromMonth(trend.months[0]?.month || "");
                setToMonth(trend.months[trend.months.length - 1]?.month || "");
              }}
            />

            <TreasuryTrendChart months={monthsFiltered} />

            {periodSummary ? (
              <TwoSegmentGaugePanel
                caption={`Jauge de flux (${periodSummary.from} -> ${periodSummary.to}) - base 100% = flux bruts cumulés`}
                totalLabel={formatMoney(periodSummary.gross)}
                leftPct={periodSummary.inflowPct}
                rightPct={periodSummary.outflowPct}
                left={{
                  label: "Encaissements primes",
                  amountLabel: formatMoney(periodSummary.inflow),
                  pctLabel: `${periodSummary.inflowPct.toFixed(1)}%`,
                  barColorClass: "bg-blue-600",
                  cardClass: "border-blue-600 bg-blue-600",
                  textClass: "text-white",
                }}
                right={{
                  label: "Règlements sinistres",
                  amountLabel: formatMoney(periodSummary.outflow),
                  pctLabel: `${periodSummary.outflowPct.toFixed(1)}%`,
                  barColorClass: "bg-red-500",
                  cardClass: "border-red-500 bg-red-500",
                  textClass: "text-white",
                }}
              />
            ) : null}

            <div className="space-y-2">
              <ToggleTableHeader title="Tableau des flux mensuels" visible={tableVisible} onToggle={() => setTableVisible((v) => !v)} />
              {tableVisible ? (
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Mois</th>
                        <th className="px-3 py-2 text-right">Encaissements primes</th>
                        <th className="px-3 py-2 text-right">Règlements sinistres</th>
                        <th className="px-3 py-2 text-right">Flux net mois</th>
                        <th className="px-3 py-2 text-right">Cumul encaissements</th>
                        <th className="px-3 py-2 text-right">Cumul règlements</th>
                        <th className="px-3 py-2 text-right">Cumul net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthsFiltered.map((row) => (
                        <tr key={row.month} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-xs text-slate-700">{row.month}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.inflows_amount)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.outflows_amount)}</td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${row.net_amount >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedMoney(row.net_amount)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_inflows)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_outflows)}</td>
                          <td className={`px-3 py-2 text-right text-xs font-medium ${row.cumulative_net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedMoney(row.cumulative_net)}</td>
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
