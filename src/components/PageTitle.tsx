import type { ReactNode } from "react";

type PageTitleProps = {
  title: string;
  description?: ReactNode;
  kicker?: string;
  titleAddon?: ReactNode;
  className?: string;
};

export default function PageTitle({
  title,
  description,
  kicker = "Pilotage et analyses",
  titleAddon,
  className = "",
}: PageTitleProps) {
  return (
    <div className={`rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-950 to-slate-800 p-5 text-white shadow-sm ${className}`.trim()}>
      <div className="text-xs uppercase tracking-[0.2em] text-slate-300">{kicker}</div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {titleAddon}
      </div>
      {description ? <p className="mt-1 text-sm text-slate-200">{description}</p> : null}
    </div>
  );
}
