"use client";

import type { ReactNode } from "react";

export default function ToggleTableHeader({
  title,
  visible,
  onToggle,
  rightActions,
}: {
  title: string;
  visible: boolean;
  onToggle: () => void;
  rightActions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs font-medium text-slate-700">{title}</div>
      <div className="flex items-center gap-2">
        {rightActions}
        <button type="button" onClick={onToggle} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {visible ? "Masquer" : "Afficher"}
        </button>
      </div>
    </div>
  );
}
