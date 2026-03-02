"use client";

import Link from "next/link";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";

type PilotageBlock = {
  title: string;
  href: string;
  status: "available" | "coming_soon";
  description: string;
  bullets: string[];
};

const blocks: PilotageBlock[] = [
  {
    title: "Solvabilité & conformité",
    href: "/pilotage/solvabilite",
    status: "available",
    description: "Vue régulateur MVP : SCR, MCR, fonds propres, fraîcheur des calculs et alertes.",
    bullets: ["SCR / MCR", "Traçabilité snapshot", "Vigilances"],
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
    description: "Console d’exploitation QRT: plannings, tâches de suivi et alertes erreurs.",
    bullets: ["Scheduler", "Tâches opérationnelles", "Alerting mail"],
  },
  {
    title: "Traitements QRT",
    href: "/pilotage/qrt-traitements",
    status: "available",
    description: "Calendrier QRT avec tâches trimestrielles et annuelles, avancement et aperçu du contenu.",
    bullets: ["Vue trimestrielle/annuelle", "Étape courante", "Aperçu des données QRT"],
  },
];

export default function PilotageDirectionPage() {
  return (
    <RequireAuth>
      <div className="space-y-6">
        <PageTitle
          title="Pilotage direction"
          description="Hub top-down du tableau de bord direction avec blocs cliquables vers les pages thématiques."
        />

        <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-800">Blocs de pilotage</h2>
            <div className="text-xs text-slate-500">Blocs 1 & 2 (MVP)</div>
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
                    {block.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2">
                        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${isAvailable ? "bg-blue-500" : "bg-slate-400"}`} />
                        <span>{b}</span>
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
      </div>
    </RequireAuth>
  );
}
