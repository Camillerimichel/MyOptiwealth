"use client";

type SegmentLegend = {
  label: string;
  amountLabel: string;
  pctLabel: string;
  barColorClass: string;
  cardClass: string;
  textClass: string;
};

export default function TwoSegmentGaugePanel({
  caption,
  totalLabel,
  leftPct,
  rightPct,
  left,
  right,
}: {
  caption: string;
  totalLabel: string;
  leftPct: number;
  rightPct: number;
  left: SegmentLegend;
  right: SegmentLegend;
}) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>{caption}</span>
        <span className="font-medium text-slate-700">{totalLabel}</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
        <div className="flex h-full w-full">
          <div className={`h-full ${left.barColorClass}`} style={{ width: `${Math.max(0, Math.min(100, leftPct))}%` }} />
          <div className={`h-full ${right.barColorClass}`} style={{ width: `${Math.max(0, Math.min(100, rightPct))}%` }} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className={`rounded-md border px-3 py-2 text-xs ${left.cardClass} ${left.textClass}`}>
          {left.label}: <span className="font-semibold">{left.amountLabel}</span> ({left.pctLabel})
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${right.cardClass} ${right.textClass}`}>
          {right.label}: <span className="font-semibold">{right.amountLabel}</span> ({right.pctLabel})
        </div>
      </div>
    </div>
  );
}

