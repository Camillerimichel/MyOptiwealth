"use client";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import Link from "next/link";

export default function Page() {
  return (
    <RequireAuth>
      <div className="space-y-6">
        <PageTitle
          title="Clients"
          description="Page temporaire — le module Clients sera disponible très prochainement."
        />

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <div className="text-sm font-semibold">Maintenance en cours</div>
          <p className="text-sm mt-1">
            L'accès aux données clients est momentanément indisponible. Nous finalisons la mise à jour
            et rétablissons l'affichage rapidement.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-5">
          <div className="text-sm font-semibold">Que faire en attendant ?</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>Consulter le tableau de bord pour une vue globale.</li>
            <li>Vérifier les contrats et sinistres en cours.</li>
            <li>Revenir ici dans quelques minutes.</li>
          </ul>
          <div className="mt-4 flex gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Aller au dashboard
            </Link>
            <Link
              href="/programmes"
              className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Voir les contrats
            </Link>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
