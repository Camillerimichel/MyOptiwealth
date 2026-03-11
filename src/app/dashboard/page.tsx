"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import { apiRequest } from "@/lib/api";

type DashboardBlock = {
  title: string;
  href: string;
  status: "available" | "coming_soon";
  description: string;
  bullets: string[];
};

type DashboardApiPayload = {
  qrt?: {
    pending_approvals: number;
    failed_runs_24h: number;
    overdue_tasks: number;
    blocked_tasks: number;
    next_schedule: { next_run_at: string | null } | null;
    latest_locked_export: { source: string; snapshot_date: string; locked_at: string | null } | null;
    latest_submission: { status: string; submitted_at: string | null } | null;
  } | null;
};

const blocks: DashboardBlock[] = [
  {
    title: "Solvabilité & conformité",
    href: "/pilotage/solvabilite",
    status: "available",
    description: "Vue régulateur MVP : SCR, MCR, fonds propres, fraîcheur des calculs et alertes de seuils.",
    bullets: ["Ratio SCR / MCR", "Traçabilité snapshot", "Alertes de vigilance"],
  },
  {
    title: "Primes",
    href: "/primes",
    status: "available",
    description: "Encaissements vs attendus, suivi par branche, graphiques globaux et détails.",
    bullets: ["Jauges globales", "Graphiques branche/global", "Zoom et tableau masquable"],
  },
  {
    title: "Sinistres",
    href: "/sinistres?view=graphiques",
    status: "available",
    description: "Suivi des règlements, cumuls, statuts et jauges de fin de période.",
    bullets: ["Cumuls sinistres/règlements", "Jauges statuts", "Zoom et tableau masquable"],
  },
  {
    title: "Trésorerie & flux",
    href: "/pilotage/tresorerie",
    status: "available",
    description: "Constat des flux observés : encaissements primes, règlements sinistres et flux net cumulé.",
    bullets: ["Cumuls entrants/sortants", "Jauge de flux", "Zoom et tableau masquable"],
  },
  {
    title: "Performance technique",
    href: "/pilotage/performance",
    status: "available",
    description: "Primes encaissées, sinistres enregistrés, règlements et ratios techniques en constat.",
    bullets: ["Ratios S/P", "Cumuls mensuels", "Zoom et tableau masquable"],
  },
  {
    title: "Portefeuille",
    href: "/pilotage/portefeuille",
    status: "available",
    description: "Répartition par branche, top partenaires/clients et concentration du portefeuille.",
    bullets: ["Branches", "Top partenaires/clients", "Concentration top 5"],
  },
  {
    title: "Réassurance / fronting",
    href: "/pilotage/reassurance",
    status: "available",
    description: "MVP partiel (simulation) : cessions, recoveries, coûts de fronting et exposition contrepartie.",
    bullets: ["Cessions / recoveries", "Coûts fronting", "Fallback si pas de données"],
  },
  {
    title: "Opérations QRT",
    href: "/pilotage/operations",
    status: "available",
    description: "Pilotage opérationnel isolé: plannings d’exécution, tâches et alerting mail sur incidents.",
    bullets: ["Plannings automatisés", "Backlog tâches", "Alertes erreurs"],
  },
];

export default function DashboardPage() {
  const yearBadge = `Année ${new Date().getUTCFullYear()}`;
  const [ops, setOps] = useState<DashboardApiPayload["qrt"]>(null);

  useEffect(() => {
    let active = true;
    apiRequest<DashboardApiPayload>("/api/dashboard")
      .then((payload) => {
        if (!active) return;
        setOps(payload?.qrt || null);
      })
      .catch(() => {
        if (!active) return;
        setOps(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <RequireAuth>
      <div className="space-y-6">
        <PageTitle
          title="Tableau de bord"
          description="Vue top-down avec blocs cliquables vers les pages thématiques de pilotage."
          titleAddon={(
            <a
              href="https://myoptiwealth.fr/settings/workspace?create=1"
              className="ml-auto inline-flex items-center rounded-md border border-slate-500 px-2 py-1 text-sm font-semibold text-white hover:bg-slate-700"
              title="Créer un workspace"
              aria-label="Créer un workspace"
            >
              /
            </a>
          )}
        />

        <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-800">Pilotage direction</h2>
            <div className="text-xs text-slate-500">Blocs 1 & 2 (MVP) • {yearBadge}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {blocks.map((block) => {
              const isAvailable = block.status === "available";
              const content = (
                <div
                  className={`h-full rounded-lg border p-4 transition ${
                    isAvailable
                      ? "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                      : "border-dashed border-slate-300 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">{block.title}</h3>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        isAvailable
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {isAvailable ? "Disponible" : "MVP à venir"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{block.description}</p>
                  <ul className="mt-3 space-y-1 text-xs text-slate-600">
                    {block.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2">
                        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${isAvailable ? "bg-blue-500" : "bg-slate-400"}`} />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );

              return isAvailable ? (
                <Link key={block.title} href={block.href} className="block">
                  {content}
                </Link>
              ) : (
                <div key={block.title}>{content}</div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-800">Suivi opérationnel QRT</h2>
            <Link href="/pilotage/operations" className="text-xs text-blue-600 underline">
              Ouvrir la console opérations
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Approvals en attente</div>
              <div className="text-xl font-semibold text-slate-900">{ops?.pending_approvals ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Runs KO (24h)</div>
              <div className="text-xl font-semibold text-slate-900">{ops?.failed_runs_24h ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Tâches en retard</div>
              <div className="text-xl font-semibold text-slate-900">{ops?.overdue_tasks ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Tâches bloquées</div>
              <div className="text-xl font-semibold text-slate-900">{ops?.blocked_tasks ?? "—"}</div>
            </div>
          </div>
        </section>
      </div>
    </RequireAuth>
  );
}
