"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { captiveMenu, dashboardMenu, documentationMenu, gestionMenu, menu, parametrageMenu, partnersMenu, pilotageMenu, programmesMenu } from "@/lib/menu";

type MenuItem = { href: string; label: string; section?: string; kind?: string };

const withoutBackItems = (items: MenuItem[]) => items.filter((item) => item.kind !== "back");

function SidebarInner() {
  const pathname = usePathname();
  const [expandedRoots, setExpandedRoots] = useState<string[]>([]);

  const isProgrammes = pathname?.startsWith("/programmes");
  const isPartners = pathname?.startsWith("/partenaires");
  const isGestion = pathname?.startsWith("/sinistres") || pathname?.startsWith("/primes");
  const isPilotage = pathname?.startsWith("/actuariat") || pathname?.startsWith("/finance") || pathname?.startsWith("/reporting");
  const isDashboardHub = pathname?.startsWith("/dashboard") || pathname?.startsWith("/pilotage");
  const isDocumentation = pathname?.startsWith("/documents");
  const isCaptiveBranch = pathname?.startsWith("/captive") || pathname?.startsWith("/superadmin");
  const isParametrage = pathname?.startsWith("/parametrage");

  const submenuByRoot: Record<string, MenuItem[]> = {
    "/dashboard": withoutBackItems(dashboardMenu),
    "/captive": withoutBackItems(captiveMenu),
    "/programmes": withoutBackItems(programmesMenu),
    "/partenaires": withoutBackItems(partnersMenu),
    "/sinistres": withoutBackItems(gestionMenu),
    "/actuariat": withoutBackItems(pilotageMenu),
    "/documents": withoutBackItems(documentationMenu),
    "/parametrage": withoutBackItems(parametrageMenu),
  };

  const isRootActive = (rootHref: string): boolean => {
    if (rootHref === "/dashboard") return !!isDashboardHub;
    if (rootHref === "/captive") return !!isCaptiveBranch;
    if (rootHref === "/programmes") return !!isProgrammes;
    if (rootHref === "/partenaires") return !!isPartners;
    if (rootHref === "/sinistres") return !!isGestion;
    if (rootHref === "/actuariat") return !!isPilotage;
    if (rootHref === "/documents") return !!isDocumentation;
    if (rootHref === "/parametrage") return !!isParametrage;
    return pathname?.startsWith(rootHref) ?? false;
  };

  const activeRootItem =
    menu.find((item) => isRootActive(item.href)) ?? menu.find((item) => pathname?.startsWith(item.href)) ?? null;

  function toggleRoot(rootHref: string) {
    setExpandedRoots((prev) => (prev.includes(rootHref) ? prev.filter((x) => x !== rootHref) : [...prev, rootHref]));
  }
  const currentPathLabel =
    pathname?.startsWith("/pilotage/qrt-traitements")
      ? "Tableau de bord > Traitements QRT"
      : pathname?.startsWith("/pilotage/solvabilite")
      ? "Tableau de bord > Solvabilité & conformité"
      : pathname?.startsWith("/pilotage/tresorerie")
      ? "Tableau de bord > Trésorerie & flux"
      : pathname?.startsWith("/pilotage/performance")
      ? "Tableau de bord > Performance technique"
      : pathname?.startsWith("/pilotage/portefeuille")
      ? "Tableau de bord > Portefeuille"
      : pathname?.startsWith("/pilotage/reassurance")
      ? "Tableau de bord > Réassurance / fronting"
      : pathname?.startsWith("/pilotage/operations")
      ? "Tableau de bord > Opérations QRT"
      : pathname?.startsWith("/pilotage")
      ? "Tableau de bord > Pilotage direction"
      : activeRootItem?.label || "Accueil";

  const logout = () => {
    try {
      window.localStorage.removeItem("captiva_token");
    } catch {
      // no-op
    }
    window.location.assign("/login");
  };

  return (
    <aside className="relative z-[90] flex h-full flex-col gap-6 overflow-visible border-r border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
      <div className="space-y-1">
        <div className="text-2xl font-semibold text-slate-900">Captiva</div>
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Risk & Assurance</div>
        <div className="pt-1 text-xs font-medium text-slate-600">{currentPathLabel}</div>
      </div>

      <nav className="w-full space-y-1 rounded-lg bg-slate-100/70 p-2 text-sm">
        {menu.map((item) => {
          const active = isRootActive(item.href);
          const subItems = submenuByRoot[item.href] || [];
          const hasSubmenu = subItems.length > 0;
          const expanded = hasSubmenu && (expandedRoots.includes(item.href) || activeRootItem?.href === item.href);
          return (
            <div key={item.href} className="relative w-full">
              {hasSubmenu ? (
                <div
                  className={`flex w-full items-center justify-between overflow-hidden rounded-md transition ${
                    active ? "bg-slate-300 text-slate-900" : "text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <Link
                    href={item.href}
                    className={`min-w-0 flex-1 px-3 py-2 transition ${active ? "font-semibold text-slate-900" : "text-slate-700"}`}
                  >
                    <span>{item.label}</span>
                  </Link>
                  <button
                    onClick={() => toggleRoot(item.href)}
                    className={`shrink-0 px-3 py-2 text-xs ${active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                    aria-label={expanded ? `Replier ${item.label}` : `Déplier ${item.label}`}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                </div>
              ) : (
                <Link
                  href={item.href}
                  className={`block w-full rounded-md px-3 py-2 transition ${
                    active ? "bg-slate-200 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{item.label}</span>
                </Link>
              )}

              {expanded ? (
                <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-2">
                  {subItems.map((subItem) => {
                    const subActive = pathname === subItem.href;
                    return (
                      <Link
                        key={subItem.href}
                        href={subItem.href}
                        className={`block rounded-md px-3 py-1.5 text-xs transition ${subActive ? "bg-slate-200 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
                      >
                        {subItem.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto">
        <button
          onClick={logout}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Se déconnecter
        </button>
      </div>
    </aside>
  );
}

export default function Sidebar() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600">Chargement du menu…</div>}>
      <SidebarInner />
    </Suspense>
  );
}
