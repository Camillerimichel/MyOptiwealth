export type DocumentationDoc = {
  key: string;
  path: string;
  label: string;
  description: string;
};

export const documentationDocs: DocumentationDoc[] = [
  {
    key: "qrt-process",
    path: "Documentation métier/QRT_Process.md",
    label: "Processus QRT",
    description: "Cadre opérationnel, schémas de processus et planning semestriel/annuel.",
  },
  {
    key: "qrt-technical",
    path: "Documentation métier/QRT_Technical.md",
    label: "Technique QRT",
    description: "Dossier technique régulateur et éléments de validation FINTECH.",
  },
  {
    key: "tableau-de-bord",
    path: "Tableau de bord.md",
    label: "Tableau de bord",
    description: "Approche top-down des blocs, pages thématiques et principes UI/KPI.",
  },
  {
    key: "s2-solvabilite-metier",
    path: "s2_solvabilite_metier.md",
    label: "S2 / Solvabilité (métier)",
    description: "Guide métier de lecture, production des snapshots réels et pilotage de la solvabilité.",
  },
  {
    key: "moteurs-simulation-parametres",
    path: "moteurs_simulation_et_parametres.md",
    label: "Moteurs de simulation & paramètres",
    description: "Vue explicative des moteurs (sinistres, réassurance, fronting, S2, ALM) et de leurs paramètres.",
  },
  {
    key: "mode-emploi-alm-fonds-propres",
    path: "mode_emploi_alm_fonds_propres.md",
    label: "Mode d'emploi ALM / Fonds propres",
    description: "Guide détaillé ALM V2/V3, stress, alertes et lecture de l'interface.",
  },
  {
    key: "process-analyse-simulation-captive",
    path: "process_analyse_simulation_captive.md",
    label: "Process d'analyse simulation captive",
    description: "Mode opératoire pour rejouer, analyser et exporter des runs de simulation/ORSA.",
  },
  {
    key: "readme-metier",
    path: "readme_metier.md",
    label: "README métier",
    description: "Vue fonctionnelle métier, socle captive et gouvernance.",
  },
  {
    key: "readme-start",
    path: "readme_start.md",
    label: "README start",
    description: "Point d'entrée et démarrage du projet.",
  },
  {
    key: "ops-sinistres-curl",
    path: "ops/sinistres-curl.md",
    label: "Ops / Sinistres curl",
    description: "Commandes et exemples curl pour les opérations sinistres.",
  },
  {
    key: "ops-taches-automatiques-cron",
    path: "ops/taches_automatiques_cron.md",
    label: "Ops / Tâches automatiques (cron)",
    description: "Recensement des crons système, jobs applicatifs et refresh automatiques.",
  },
];

export const documentationMenu = [
  { href: "/dashboard", label: "Retour", kind: "back" },
  ...documentationDocs.map((doc) => ({
    href: `/documents?doc=${encodeURIComponent(doc.key)}`,
    label: doc.label,
    section: doc.key,
  })),
];

export function getDocumentationDocByKey(key: string | null | undefined): DocumentationDoc | null {
  if (!key) return null;
  return documentationDocs.find((doc) => doc.key === key) || null;
}
