import { documentationMenu } from "@/lib/documentation";

export const menu = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/captive", label: "Captive" },
  { href: "/actuariat", label: "Pilotage et analyses" },
  { href: "/programmes", label: "Contrats d’assurance" },
  { href: "/partenaires", label: "Intervenants" },
  { href: "/sinistres", label: "Gestion back office" },
  { href: "/documents", label: "Documentation métier" },
  { href: "/parametrage", label: "Paramétrage" },
];

export const dashboardMenu = [
  { href: "/pilotage", label: "Pilotage direction", section: "pilotage" },
  { href: "/pilotage/operations", label: "Opérations QRT", section: "operations" },
  { href: "/pilotage/qrt-traitements", label: "Traitements QRT", section: "qrt-traitements" },
];

export const gestionMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  { href: "/sinistres", label: "Sinistres", section: "sinistres" },
  { href: "/primes", label: "Primes", section: "primes" },
];

export const pilotageMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  { href: "/actuariat?section=overview", label: "Simulation overview", section: "overview" },
  { href: "/actuariat?section=orsa", label: "ORSA", section: "orsa" },
  { href: "/actuariat?section=s2", label: "Solvabilité II (S2)", section: "s2" },
  { href: "/actuariat?section=fronting", label: "Fronting", section: "fronting" },
  { href: "/actuariat?section=cat", label: "CAT géographique", section: "cat" },
  { href: "/actuariat?section=alm", label: "ALM / Fonds propres", section: "alm" },
  { href: "/actuariat?section=finance", label: "Finance ALM / Actifs", section: "finance" },
  { href: "/reporting", label: "Reporting", section: "reporting" },
];

export const captiveMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  { href: "/superadmin?section=captives", label: "Captives", section: "captives" },
  { href: "/captive?section=branches", label: "Branches", section: "branches" },
  { href: "/captive?section=categories", label: "Catégories", section: "categories" },
  { href: "/captive?section=branch-categories", label: "Branches ↔ Catégories", section: "branch-categories" },
  { href: "/captive?section=policies", label: "Politiques d’éligibilité", section: "policies" },
  { href: "/captive?section=risk-parameters", label: "Paramètres de risque", section: "risk-parameters" },
  { href: "/captive?section=reinsurance", label: "Réassurance & fronting", section: "reinsurance" },
  { href: "/captive?section=programs", label: "Programmes", section: "programs" },
  { href: "/captive?section=program-branches", label: "Programmes ↔ Branches", section: "program-branches" },
  { href: "/captive?section=capital", label: "Capital & stress", section: "capital" },
  { href: "/captive?section=policy-versions", label: "Versions de politique", section: "policy-versions" },
  { href: "/captive?section=audit", label: "Journal d’audit", section: "audit" },
];

export const programmesMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  { href: "/programmes?section=programmes", label: "Contrats d’assurance", section: "programmes" },
  { href: "/programmes?section=layers", label: "Sous-contrats / Tranches", section: "layers" },
  { href: "/programmes?section=pricing", label: "Tarification", section: "pricing" },
  { href: "/programmes?section=coverages", label: "Garanties", section: "coverages" },
  { href: "/programmes?section=deductibles", label: "Franchises", section: "deductibles" },
  { href: "/programmes?section=exclusions", label: "Exclusions", section: "exclusions" },
  { href: "/programmes?section=conditions", label: "Conditions particulières", section: "conditions" },
  { href: "/programmes?section=fronting", label: "Assureurs fronting", section: "fronting" },
  { href: "/programmes?section=reinsurance", label: "Réassureurs", section: "reinsurance" },
  { href: "/programmes?section=carriers", label: "Assureurs / Portage", section: "carriers" },
  { href: "/programmes?section=documents", label: "Documents & pièces", section: "documents" },
  { href: "/programmes?section=versions", label: "Historique & validations", section: "versions" },
];

export const partnersMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  { href: "/partenaires?section=liste", label: "Liste partenaires", section: "liste" },
  { href: "/partenaires?section=assureurs", label: "Assureurs", section: "assureurs" },
  { href: "/partenaires?section=correspondants", label: "Correspondants", section: "correspondants" },
  { href: "/partenaires?section=clients", label: "Clients", section: "clients" },
  { href: "/partenaires?section=contrats", label: "Contrats <-> clients", section: "contrats" },
  { href: "/partenaires?section=contrats-partenaires", label: "Contrats <-> partenaires", section: "contrats-partenaires" },
  { href: "/partenaires?section=documents", label: "Documents <-> Partenaires", section: "documents" },
];

export const parametrageMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  { href: "/parametrage", label: "Vue d’ensemble", section: "overview" },
  { href: "/superadmin?section=users", label: "Utilisateurs globaux", section: "users" },
  { href: "/parametrage/jobs", label: "Monitoring jobs", section: "jobs" },
  { href: "/parametrage/templates", label: "Templates de rapports", section: "templates" },
];

export { documentationMenu };
