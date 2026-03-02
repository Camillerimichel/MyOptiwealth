"use client";

type MonthOption = { month: string };

export default function PeriodZoomControls({
  months,
  fromMonth,
  toMonth,
  onChangeFrom,
  onChangeTo,
  onReset,
}: {
  months: MonthOption[];
  fromMonth: string;
  toMonth: string;
  onChangeFrom: (month: string) => void;
  onChangeTo: (month: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
      <div className="space-y-1">
        <label className="text-xs text-slate-600">Début</label>
        <select value={fromMonth} onChange={(e) => onChangeFrom(e.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
          {months.map((m) => (
            <option key={`from-${m.month}`} value={m.month}>
              {m.month}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-slate-600">Fin</label>
        <select value={toMonth} onChange={(e) => onChangeTo(e.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
          {months.map((m) => (
            <option key={`to-${m.month}`} value={m.month}>
              {m.month}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button type="button" onClick={onReset} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50">
          Réinitialiser zoom
        </button>
      </div>
    </div>
  );
}

