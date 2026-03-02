"use client";

type Seg = {
  key: string;
  label: string;
  pct: number;
  barColorClass: string;
  cardClass: string;
  textClass: string;
};

export default function SegmentedGaugePanel({
  caption,
  segments,
}: {
  caption: string;
  segments: Seg[];
}) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs text-slate-600">{caption}</div>
      <div className="h-4 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
        <div className="flex h-full w-full">
          {segments.map((s) => (
            <div key={s.key} className={`h-full ${s.barColorClass}`} style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }} />
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {segments.map((s) => (
          <div key={`${s.key}-card`} className={`rounded-md border px-3 py-2 text-xs ${s.cardClass} ${s.textClass}`}>
            {s.label}: <span className="font-semibold">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

