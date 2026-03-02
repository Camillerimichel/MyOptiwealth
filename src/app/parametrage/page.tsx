import Link from "next/link";
import PageTitle from "@/components/PageTitle";

const modules = [
  {
    href: "/captive",
    title: "Référentiel Captive",
    description: "Branches, catégories, politiques d’éligibilité, risque, réassurance, capital.",
  },
  {
    href: "/programmes",
    title: "Contrats d’assurance",
    description: "Configuration des contrats, garanties, franchises, exclusions, versions et pièces.",
  },
  {
    href: "/parametrage/jobs",
    title: "Monitoring jobs",
    description: "Pilotage des jobs techniques et déclenchement de rapports.",
  },
  {
    href: "/parametrage/templates",
    title: "Templates de rapports",
    description: "Gestion des modèles de rapports (PDF/XLSX/CSV/JSON).",
  },
];

export default function ParametragePage() {
  return (
    <div className="space-y-5">
      <PageTitle
        title="Paramétrage"
        description="Zone d’administration fonctionnelle. Les référentiels et la configuration des contrats sont centralisés ici."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-sm font-semibold text-slate-900">{module.title}</div>
            <div className="mt-1 text-sm text-slate-600">{module.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
