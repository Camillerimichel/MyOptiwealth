"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import PeriodZoomControls from "@/components/pilotage/PeriodZoomControls";
import SegmentedGaugePanel from "@/components/pilotage/SegmentedGaugePanel";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import TwoSegmentGaugePanel from "@/components/pilotage/TwoSegmentGaugePanel";
import { apiRequest } from "@/lib/api";

type Programme = {
  id: number;
  ligne_risque: string;
  branch_s2_code?: string | null;
  limite?: string | number | null;
  franchise?: string | number | null;
  devise?: string | null;
};

type Branch = {
  id_branch: number;
  s2_code: string;
  name: string;
  is_active?: number;
  category_code?: string | null;
  category_name?: string | null;
};

type ProgrammeCoverage = {
  id_coverage: number;
  programme_id: number;
  label: string;
  coverage_type?: string | null;
  limit_per_claim?: string | number | null;
  limit_annual?: string | number | null;
  currency?: string | null;
};

type ProgrammeDeductible = {
  id_deductible: number;
  programme_id: number;
  coverage_id?: number | null;
  amount?: string | number | null;
  unit?: "FIXED" | "PERCENTAGE" | string | null;
  currency?: string | null;
  notes?: string | null;
};

type Partner = {
  id: number;
  raison_sociale: string;
  siren?: string | null;
};

type ClientOption = {
  id: number;
  nom: string;
  partner_id?: number | null;
  type?: string | null;
  chiffre_affaires?: string | number | null;
  masse_salariale?: string | number | null;
};

type PartnerContract = {
  id: number;
  partner_id: number;
  client_id: number;
  programme_id: number;
  statut: string;
};

type Sinistre = {
  id: number;
  programme_id: number;
  partner_id?: number | null;
  client_id?: number | null;
  client_ref?: string | null;
  partner_name?: string | null;
  partner_siren?: string | null;
  ligne_risque?: string | null;
  programme_branch_s2_code?: string | null;
  programme_branch_name?: string | null;
  programme_assureur?: string | null;
  programme_limite?: string | number | null;
  programme_franchise?: string | number | null;
  programme_devise?: string | null;
  statut: "ouvert" | "en_cours" | "clos" | "rejete";
  montant_estime: string | number;
  montant_paye: string | number;
  devise: string;
  description?: string | null;
  date_survenue?: string | null;
  date_decl?: string | null;
  lignes_count?: number;
};

type SinistreLigne = {
  id: number;
  sinistre_id: number;
  id_branch: number;
  statut: "ouvert" | "en_cours" | "clos" | "rejete";
  montant_estime: string | number;
  montant_paye: string | number;
  montant_recours: string | number;
  montant_franchise: string | number;
  description?: string | null;
  branch_s2_code?: string | null;
  branch_name?: string | null;
};

type SinistreDetail = Sinistre & {
  lignes: SinistreLigne[];
};

type Reglement = {
  id: number;
  sinistre_id: number;
  sinistre_ligne_id?: number | null;
  date?: string | null;
  montant: string | number;
  branch_s2_code?: string | null;
  branch_name?: string | null;
};

type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};

type StatsTotals = {
  total: number;
  ouvert: number;
  en_cours: number;
  clos: number;
  rejete: number;
};

type BranchStat = StatsTotals & {
  id_branch: number;
  s2_code?: string | null;
  name?: string | null;
};

type LigneStat = StatsTotals & {
  ligne_key: string;
  ligne_label: string;
};

type SinistreTreeStats = {
  selected_branch: number | null;
  branches: BranchStat[];
  lines: LigneStat[];
};

type SinistreReglementsCumulMonth = {
  month: string;
  label: string;
  estimated_amount: number;
  paid_amount: number;
  cumulative_estimated: number;
  cumulative_paid: number;
  cumulative_estimated_open: number;
  cumulative_estimated_en_cours: number;
  cumulative_estimated_clos: number;
  cumulative_estimated_rejete: number;
};

type SinistreReglementsCumulResponse = {
  year: number;
  totals: {
    estimated: number;
    paid: number;
  };
  months: SinistreReglementsCumulMonth[];
};

const STATUTS = ["ouvert", "en_cours", "clos", "rejete"] as const;
const STATUT_RANK: Record<(typeof STATUTS)[number], number> = {
  ouvert: 1,
  en_cours: 2,
  clos: 3,
  rejete: 3,
};

function formatMoney(value: string | number | null | undefined, currency = "EUR") {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const rounded = Math.round(n);
  const grouped = new Intl.NumberFormat("fr-FR", {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(rounded)
    .replace(/[\u202f\u00a0]/g, " ");
  return `${grouped} ${currency}`.trim();
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

function formatNumber(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/\u202f/g, " ");
}

function formatDeductible(value?: ProgrammeDeductible | null, fallbackCurrency = "EUR") {
  if (!value) return "—";
  const amount = value.amount;
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  if ((value.unit || "").toUpperCase() === "PERCENTAGE") {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n)} %`;
  }
  return formatMoney(n, value.currency || fallbackCurrency);
}

function toAmount(value: string | number | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function SinistresCumulChart({ months }: { months: SinistreReglementsCumulMonth[] }) {
  if (!months.length) return null;
  const width = 860;
  const height = 320;
  const pad = { top: 18, right: 18, bottom: 36, left: 84 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxY = Math.max(1, ...months.map((m) => Math.max(m.cumulative_estimated, m.cumulative_paid)));
  const xFor = (idx: number) => pad.left + (months.length <= 1 ? 0 : (idx / (months.length - 1)) * innerW);
  const yFor = (v: number) => pad.top + innerH - (Math.max(0, v) / maxY) * innerH;
  const fmtAxis = (v: number) => `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k€`;
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const value = (maxY / 4) * i;
    return { value, y: yFor(value) };
  });
  const estimatedPath = months
    .map((m, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(m.cumulative_estimated).toFixed(1)}`)
    .join(" ");
  const paidPath = months
    .map((m, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(m.cumulative_paid).toFixed(1)}`)
    .join(" ");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
        <rect x={0} y={0} width={width} height={height} fill="white" />
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} y1={t.y} x2={width - pad.right} y2={t.y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.left - 10} y={t.y + 4} textAnchor="end" fontSize="11" fill="#64748b">
              {fmtAxis(t.value)}
            </text>
          </g>
        ))}
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="#94a3b8" strokeWidth="1" />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="#94a3b8" strokeWidth="1" />
        <path d={estimatedPath} fill="none" stroke="#0f766e" strokeWidth="2.5" />
        <path d={paidPath} fill="none" stroke="#2563eb" strokeWidth="2.5" />
        {months.map((m, i) => (
          <g key={m.month}>
            <circle cx={xFor(i)} cy={yFor(m.cumulative_estimated)} r="3" fill="#0f766e" />
            <circle cx={xFor(i)} cy={yFor(m.cumulative_paid)} r="3" fill="#2563eb" />
            <text x={xFor(i)} y={height - 14} textAnchor="middle" fontSize="10" fill="#64748b">
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <div className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-teal-700" />
          <span>Cumul sinistres en cours</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-blue-600" />
          <span>Cumul règlements</span>
        </div>
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "";
  const mapped: Record<string, string> = {
    missing_branch_ventilation: "La ventilation par branche est requise.",
    branch_not_in_scope: "La branche sélectionnée n'est pas autorisée pour cette captive.",
    duplicate_branch_in_ventilation: "Cette branche est déjà présente dans la ventilation.",
    line_branch_exists: "Cette branche existe déjà sur ce sinistre.",
    reglement_line_required: "Choisis une ligne de sinistre pour enregistrer le règlement.",
    line_has_reglements: "Impossible de supprimer une ligne ayant déjà des règlements.",
    cannot_delete_last_line: "Impossible de supprimer la dernière ligne du sinistre.",
    line_status_regression_not_allowed: "Impossible de revenir à un statut antérieur.",
    reglement_limit_reached: "Règlement impossible: plafond atteint (estimation - franchise).",
    reglement_limit_exceeded: "Règlement impossible: le montant dépasse le reste disponible (estimation - franchise).",
    partner_not_found: "Partenaire introuvable.",
    client_not_found: "Client introuvable.",
    client_partner_mismatch: "Le client sélectionné n'est pas rattaché à ce partenaire.",
    client_partner_programme_contract_missing: "Aucun contrat valide trouvé pour ce client, ce partenaire et cette ligne.",
  };
  return mapped[code] || code || fallback;
}

function badgeClass(statut: string) {
  if (statut === "clos") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (statut === "rejete") return "border-red-300 bg-red-50 text-red-700";
  if (statut === "en_cours") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-blue-300 bg-blue-50 text-blue-700";
}

function formatStatutLabel(statut: string) {
  return statut.replace("_", " ");
}

function getAllowedLineStatuses(current: (typeof STATUTS)[number]) {
  if (current === "clos" || current === "rejete") return [current];
  return STATUTS.filter((status) => STATUT_RANK[status] >= STATUT_RANK[current]);
}

function toLigneKey(value?: string | null) {
  const raw = (value || "").trim();
  return raw || "__EMPTY__";
}

function sameLigneKey(a?: string | null, b?: string | null) {
  const keyA = toLigneKey(a);
  const keyB = toLigneKey(b);
  if (keyA === "__EMPTY__" || keyB === "__EMPTY__") return keyA === keyB;
  return normalizeRiskLabel(keyA) === normalizeRiskLabel(keyB);
}

function normalizeCode(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function normalizeRiskLabel(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function SinistresPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawView = searchParams.get("view");
  const view = rawView === "creation" || rawView === "graphiques" ? rawView : "visualisation";
  const initialGraphYear = (() => {
    const n = Number(searchParams.get("year") || new Date().getUTCFullYear());
    return Number.isInteger(n) ? Math.max(2000, Math.min(2100, n)) : new Date().getUTCFullYear();
  })();
  const initialBranchId = (() => {
    const n = Number(searchParams.get("id_branch") || 0);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const initialLigneKey = (searchParams.get("ligne_risque") || "").trim();
  const initialStatut = (searchParams.get("statut") || "").trim();
  const initialPartnerQuery = (searchParams.get("partner_q") || "").trim();
  const initialClientQuery = (searchParams.get("client_q") || "").trim();
  const initialSortEstime = (searchParams.get("sort_estime") || "").trim().toLowerCase();
  const initialSortPaye = (searchParams.get("sort_paye") || "").trim().toLowerCase();

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [programmeCoverages, setProgrammeCoverages] = useState<ProgrammeCoverage[]>([]);
  const [programmeDeductibles, setProgrammeDeductibles] = useState<ProgrammeDeductible[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);

  const [sinistres, setSinistres] = useState<Sinistre[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [filterStatut, setFilterStatut] = useState<string>(initialStatut);
  const [filterPartnerQuery, setFilterPartnerQuery] = useState<string>(initialPartnerQuery);
  const [filterClientQuery, setFilterClientQuery] = useState<string>(initialClientQuery);
  const [sortEstime, setSortEstime] = useState<string>(initialSortEstime === "asc" || initialSortEstime === "desc" ? initialSortEstime : "");
  const [sortPaye, setSortPaye] = useState<string>(initialSortPaye === "asc" || initialSortPaye === "desc" ? initialSortPaye : "");
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(initialBranchId);
  const [selectedLigneKey, setSelectedLigneKey] = useState<string>(initialLigneKey);
  const [loadingStats, setLoadingStats] = useState(false);
  const [branchStats, setBranchStats] = useState<BranchStat[]>([]);
  const [lineStats, setLineStats] = useState<LigneStat[]>([]);
  const [selectedSinistreId, setSelectedSinistreId] = useState<number | null>(null);
  const [graphYear, setGraphYear] = useState<number>(initialGraphYear);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphData, setGraphData] = useState<SinistreReglementsCumulResponse | null>(null);
  const [graphFromMonth, setGraphFromMonth] = useState<string>("");
  const [graphToMonth, setGraphToMonth] = useState<string>("");
  const [graphTableVisible, setGraphTableVisible] = useState<boolean>(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"ventilation" | "reglements">("ventilation");
  const [detail, setDetail] = useState<SinistreDetail | null>(null);
  const [reglements, setReglements] = useState<Reglement[]>([]);
  const [reglementModalMessage, setReglementModalMessage] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    partner_id: "",
    client_id: "",
    client_ref: "",
    programme_id: "",
    id_branch: "",
    coverage_id: "",
    date_survenue: "",
    date_decl: "",
    statut: "ouvert",
    devise: "EUR",
    montant_estime: "",
    description: "",
  });
  const [createContracts, setCreateContracts] = useState<PartnerContract[]>([]);
  const [createContractsLoading, setCreateContractsLoading] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientPickerSearch, setClientPickerSearch] = useState("");
  const [clientPickerLoading, setClientPickerLoading] = useState(false);
  const [clientPickerResults, setClientPickerResults] = useState<ClientOption[]>([]);
  const [clientPickerError, setClientPickerError] = useState<string | null>(null);
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [partnerPickerCandidates, setPartnerPickerCandidates] = useState<ClientOption[]>([]);

  const [reglementForm, setReglementForm] = useState({
    sinistre_ligne_id: "",
    date: "",
    montant: "",
  });
  const [lineStatusDrafts, setLineStatusDrafts] = useState<Record<number, SinistreLigne["statut"]>>({});
  const [savingLineStatuses, setSavingLineStatuses] = useState(false);

  const maxPage = Math.max(1, Math.ceil(total / limit));
  const hasVisualisationContext = Boolean(selectedBranchId && selectedLigneKey);
  const activeBranches = useMemo(() => branches.filter((b) => Number(b.is_active ?? 1) === 1), [branches]);
  const selectedCreateProgramme = useMemo(() => {
    const programmeId = Number(createForm.programme_id || 0);
    if (!Number.isInteger(programmeId) || programmeId <= 0) return null;
    return programmes.find((programme) => programme.id === programmeId) || null;
  }, [createForm.programme_id, programmes]);
  const selectedCreateProgrammeCurrency = useMemo(
    () => (selectedCreateProgramme?.devise || createForm.devise || "EUR").toUpperCase(),
    [createForm.devise, selectedCreateProgramme]
  );
  const selectedCreateProgrammeGarantieLabel = useMemo(
    () => formatMoney(selectedCreateProgramme?.limite, selectedCreateProgrammeCurrency),
    [selectedCreateProgramme, selectedCreateProgrammeCurrency]
  );
  const selectedCreateProgrammeFranchiseLabel = useMemo(
    () => formatMoney(selectedCreateProgramme?.franchise, selectedCreateProgrammeCurrency),
    [selectedCreateProgramme, selectedCreateProgrammeCurrency]
  );
  const selectedProgrammeCoverages = useMemo(() => {
    if (!selectedCreateProgramme) return [];
    return programmeCoverages.filter((coverage) => Number(coverage.programme_id) === Number(selectedCreateProgramme.id));
  }, [programmeCoverages, selectedCreateProgramme]);
  const selectedCreateCoverage = useMemo(() => {
    const coverageId = Number(createForm.coverage_id || 0);
    if (!Number.isInteger(coverageId) || coverageId <= 0) return null;
    return selectedProgrammeCoverages.find((coverage) => Number(coverage.id_coverage) === coverageId) || null;
  }, [createForm.coverage_id, selectedProgrammeCoverages]);
  const selectedCreateCoverageCurrency = useMemo(
    () => (selectedCreateCoverage?.currency || selectedCreateProgrammeCurrency).toUpperCase(),
    [selectedCreateCoverage, selectedCreateProgrammeCurrency]
  );
  const selectedCreateCoverageLimitPerClaimLabel = useMemo(
    () => formatMoney(selectedCreateCoverage?.limit_per_claim, selectedCreateCoverageCurrency),
    [selectedCreateCoverage, selectedCreateCoverageCurrency]
  );
  const selectedCreateCoverageLimitAnnualLabel = useMemo(
    () => formatMoney(selectedCreateCoverage?.limit_annual, selectedCreateCoverageCurrency),
    [selectedCreateCoverage, selectedCreateCoverageCurrency]
  );
  const selectedCreateCoverageDeductible = useMemo(() => {
    if (!selectedCreateProgramme) return null;
    const programmeId = Number(selectedCreateProgramme.id);
    const programmeEntries = programmeDeductibles.filter((entry) => Number(entry.programme_id) === programmeId);
    if (programmeEntries.length === 0) return null;
    const coverageId = Number(selectedCreateCoverage?.id_coverage || 0);
    if (coverageId > 0) {
      const exactCoverage = programmeEntries.find((entry) => Number(entry.coverage_id || 0) === coverageId);
      if (exactCoverage) return exactCoverage;
    }
    return programmeEntries.find((entry) => entry.coverage_id === null || entry.coverage_id === undefined) || null;
  }, [programmeDeductibles, selectedCreateCoverage, selectedCreateProgramme]);
  const selectedCreateCoverageFranchiseLabel = useMemo(
    () => formatDeductible(selectedCreateCoverageDeductible, selectedCreateCoverageCurrency),
    [selectedCreateCoverageCurrency, selectedCreateCoverageDeductible]
  );
  const selectedCreateCoverageFranchiseAmount = useMemo(() => {
    if (!selectedCreateCoverageDeductible) return null;
    if ((selectedCreateCoverageDeductible.unit || "").toUpperCase() !== "FIXED") return null;
    return toAmount(selectedCreateCoverageDeductible.amount);
  }, [selectedCreateCoverageDeductible]);
  const selectedCreateLigneKey = useMemo(() => {
    if (selectedCreateProgramme) return toLigneKey(selectedCreateProgramme.ligne_risque);
    if (hasVisualisationContext) return selectedLigneKey;
    return "";
  }, [hasVisualisationContext, selectedCreateProgramme, selectedLigneKey]);
  const contextualProgrammes = useMemo(() => {
    if (!createForm.client_id || !createForm.partner_id) return [];
    if (!createContracts.length) return [];
    const allowedProgrammeIds = new Set(createContracts.map((contract) => Number(contract.programme_id)));
    const contractProgrammes = programmes.filter((programme) => allowedProgrammeIds.has(Number(programme.id)));
    if (!hasVisualisationContext) return contractProgrammes;
    const inContext = contractProgrammes.filter((programme) => sameLigneKey(programme.ligne_risque, selectedLigneKey));
    return inContext.length ? inContext : contractProgrammes;
  }, [
    createContracts,
    createForm.client_id,
    createForm.partner_id,
    hasVisualisationContext,
    programmes,
    selectedLigneKey,
  ]);
  const hasContextProgrammeMatch = useMemo(() => {
    if (!hasVisualisationContext) return true;
    if (!createForm.client_id || !createForm.partner_id) return true;
    if (!createContracts.length) return true;
    const allowedProgrammeIds = new Set(createContracts.map((contract) => Number(contract.programme_id)));
    return programmes.some(
      (programme) => allowedProgrammeIds.has(Number(programme.id)) && sameLigneKey(programme.ligne_risque, selectedLigneKey)
    );
  }, [
    createContracts,
    createForm.client_id,
    createForm.partner_id,
    hasVisualisationContext,
    programmes,
    selectedLigneKey,
  ]);
  const contextualCreationAllowedS2Codes = useMemo(() => {
    if (selectedCreateProgramme) {
      const selectedCode = normalizeCode(selectedCreateProgramme.branch_s2_code);
      return selectedCode ? new Set([selectedCode]) : new Set<string>();
    }
    if (!selectedCreateLigneKey) return new Set<string>();
    return new Set(
      programmes
        .filter((programme) => sameLigneKey(programme.ligne_risque, selectedCreateLigneKey))
        .map((programme) => normalizeCode(programme.branch_s2_code))
        .filter(Boolean)
    );
  }, [programmes, selectedCreateLigneKey, selectedCreateProgramme]);
  const contextualCreationBranches = useMemo(() => {
    if (contextualCreationAllowedS2Codes.size === 0) return [];
    return activeBranches.filter((branch) => contextualCreationAllowedS2Codes.has(normalizeCode(branch.s2_code)));
  }, [activeBranches, contextualCreationAllowedS2Codes]);
  const selectedCreatePartner = useMemo(() => {
    const partnerId = Number(createForm.partner_id || 0);
    if (!Number.isInteger(partnerId) || partnerId <= 0) return null;
    return partners.find((partner) => Number(partner.id) === partnerId) || null;
  }, [createForm.partner_id, partners]);
  const selectedBranch = useMemo(
    () => branchStats.find((branch) => branch.id_branch === selectedBranchId) || null,
    [branchStats, selectedBranchId]
  );
  const selectedLine = useMemo(
    () => lineStats.find((line) => line.ligne_key === selectedLigneKey) || null,
    [lineStats, selectedLigneKey]
  );
  const visualisationStep = !selectedBranchId ? 1 : !selectedLigneKey ? 2 : 3;
  const reglementCapacity = useMemo(() => {
    if (!detail) return null;
    const totalEstime = detail.lignes?.length
      ? detail.lignes.reduce((sum, line) => sum + toAmount(line.montant_estime), 0)
      : toAmount(detail.montant_estime);
    const franchiseLignes = detail.lignes?.reduce((max, line) => Math.max(max, toAmount(line.montant_franchise)), 0) || 0;
    const franchiseGlobale = Math.max(franchiseLignes, toAmount(detail.programme_franchise), 0);
    const totalRegle = reglements.reduce((sum, reg) => sum + toAmount(reg.montant), 0);
    const plafond = Math.max(totalEstime - franchiseGlobale, 0);
    const restant = Math.max(plafond - totalRegle, 0);
    return { totalEstime, franchiseGlobale, totalRegle, plafond, restant };
  }, [detail, reglements]);
  const reglementLocked = (reglementCapacity?.restant || 0) <= 1e-6;
  const graphMonthsFiltered = useMemo(() => {
    if (!graphData?.months?.length) return [];
    const from = graphFromMonth || graphData.months[0]?.month || "";
    const to = graphToMonth || graphData.months[graphData.months.length - 1]?.month || "";
    return graphData.months.filter((m) => m.month >= from && m.month <= to);
  }, [graphData, graphFromMonth, graphToMonth]);
  const graphPeriodSummary = useMemo(() => {
    if (!graphMonthsFiltered.length) return null;
    const last = graphMonthsFiltered[graphMonthsFiltered.length - 1];
    const estimated = Math.max(0, Number(last.cumulative_estimated || 0));
    const paid = Math.max(0, Number(last.cumulative_paid || 0));
    const paidCapped = Math.min(paid, estimated);
    const remaining = Math.max(estimated - paidCapped, 0);
    const paidPct = estimated > 0 ? (paidCapped / estimated) * 100 : 0;
    const remainingPct = estimated > 0 ? (remaining / estimated) * 100 : 0;
    return {
      estimated,
      paid,
      paidCapped,
      remaining,
      paidPct,
      remainingPct,
      from: graphMonthsFiltered[0]?.month || "",
      to: last.month,
      statusOpen: Math.max(0, Number(last.cumulative_estimated_open || 0)),
      statusInProgress: Math.max(0, Number(last.cumulative_estimated_en_cours || 0)),
      statusClosed: Math.max(0, Number(last.cumulative_estimated_clos || 0)),
      statusRejected: Math.max(0, Number(last.cumulative_estimated_rejete || 0)),
    };
  }, [graphMonthsFiltered]);
  const hasLineStatusChanges = useMemo(() => {
    if (!detail?.lignes?.length) return false;
    return detail.lignes.some((line) => (lineStatusDrafts[line.id] || line.statut) !== line.statut);
  }, [detail, lineStatusDrafts]);
  const creationViewHref = useMemo(() => {
    const params = new URLSearchParams({ view: "creation" });
    if (hasVisualisationContext && selectedBranchId && selectedLigneKey) {
      params.set("id_branch", String(selectedBranchId));
      params.set("ligne_risque", selectedLigneKey);
    }
    if (filterStatut) params.set("statut", filterStatut);
    if (filterPartnerQuery) params.set("partner_q", filterPartnerQuery);
    if (filterClientQuery) params.set("client_q", filterClientQuery);
    if (sortEstime) params.set("sort_estime", sortEstime);
    if (sortPaye) params.set("sort_paye", sortPaye);
    return `/sinistres?${params.toString()}`;
  }, [filterClientQuery, filterPartnerQuery, filterStatut, hasVisualisationContext, selectedBranchId, selectedLigneKey, sortEstime, sortPaye]);
  const visualisationViewHref = useMemo(() => {
    const params = new URLSearchParams({ view: "visualisation" });
    if (hasVisualisationContext && selectedBranchId && selectedLigneKey) {
      params.set("id_branch", String(selectedBranchId));
      params.set("ligne_risque", selectedLigneKey);
    }
    if (filterStatut) params.set("statut", filterStatut);
    if (filterPartnerQuery) params.set("partner_q", filterPartnerQuery);
    if (filterClientQuery) params.set("client_q", filterClientQuery);
    if (sortEstime) params.set("sort_estime", sortEstime);
    if (sortPaye) params.set("sort_paye", sortPaye);
    return `/sinistres?${params.toString()}`;
  }, [filterClientQuery, filterPartnerQuery, filterStatut, hasVisualisationContext, selectedBranchId, selectedLigneKey, sortEstime, sortPaye]);
  const graphiquesViewHref = useMemo(() => {
    const params = new URLSearchParams({ view: "graphiques", year: String(graphYear) });
    return `/sinistres?${params.toString()}`;
  }, [graphYear]);

  const loadOptions = useCallback(async () => {
    const [programmesRes, branchesRes, coveragesRes, deductiblesRes, partnersRes] = await Promise.all([
      apiRequest<Paginated<Programme>>("/api/programmes?page=1&limit=1000"),
      apiRequest<{ data: Branch[] }>("/api/captive/branches?page=1&limit=1000"),
      apiRequest<Paginated<ProgrammeCoverage>>("/api/programmes/coverages?page=1&limit=1000"),
      apiRequest<Paginated<ProgrammeDeductible>>("/api/programmes/deductibles?page=1&limit=1000"),
      apiRequest<Paginated<Partner>>("/api/partners?page=1&limit=1000"),
    ]);
    const nextProgrammes = programmesRes.data || [];
    const nextBranches = branchesRes.data || [];
    const nextCoverages = coveragesRes.data || [];
    const nextDeductibles = deductiblesRes.data || [];
    const nextPartners = partnersRes.data || [];
    setProgrammes(nextProgrammes);
    setBranches(nextBranches);
    setProgrammeCoverages(nextCoverages);
    setProgrammeDeductibles(nextDeductibles);
    setPartners(nextPartners);
    setCreateForm((prev) => {
      const programme_id = prev.programme_id || "";
      const defaultCoverage = nextCoverages.find((coverage) => String(coverage.programme_id) === programme_id);
      return {
        ...prev,
        programme_id,
        id_branch: prev.id_branch || "",
        coverage_id: prev.coverage_id || String(defaultCoverage?.id_coverage || ""),
      };
    });
  }, []);

  const loadSinistres = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      if (view === "visualisation" && (!selectedBranchId || !selectedLigneKey)) {
        setSinistres([]);
        setTotal(0);
        return;
      }
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (filterStatut) params.set("statut", filterStatut);
      if (filterPartnerQuery) params.set("partner_q", filterPartnerQuery);
      if (filterClientQuery) params.set("client_q", filterClientQuery);
      if (sortEstime) params.set("sort_estime", sortEstime);
      if (sortPaye) params.set("sort_paye", sortPaye);
      if (selectedBranchId) params.set("id_branch", String(selectedBranchId));
      if (selectedLigneKey) params.set("ligne_risque", selectedLigneKey);
      const res = await apiRequest<Paginated<Sinistre>>(`/api/sinistres?${params.toString()}`);
      setSinistres(res.data || []);
      setTotal(res.pagination?.total || 0);
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Erreur de chargement des sinistres."));
    } finally {
      setLoadingList(false);
    }
  }, [filterClientQuery, filterPartnerQuery, filterStatut, limit, page, selectedBranchId, selectedLigneKey, sortEstime, sortPaye, view]);

  const loadTreeStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId) params.set("id_branch", String(selectedBranchId));
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const stats = await apiRequest<SinistreTreeStats>(`/api/sinistres/stats/arborescence${suffix}`);
      setBranchStats(Array.isArray(stats.branches) ? stats.branches : []);
      setLineStats(Array.isArray(stats.lines) ? stats.lines : []);
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Erreur de chargement des statistiques de sinistres."));
      setBranchStats([]);
      setLineStats([]);
    } finally {
      setLoadingStats(false);
    }
  }, [selectedBranchId]);

  const loadGraphData = useCallback(async () => {
    if (view !== "graphiques") return;
    setGraphLoading(true);
    try {
      const res = await apiRequest<SinistreReglementsCumulResponse>(`/api/sinistres/stats/reglements-cumul?year=${graphYear}`);
      setGraphData(res);
      setGraphFromMonth(res.months[0]?.month || "");
      setGraphToMonth(res.months[res.months.length - 1]?.month || "");
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Erreur de chargement des graphiques sinistres."));
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  }, [graphYear, view]);

  const loadSinistreDetail = useCallback(async (sinistreId: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const [sinistreRes, reglementsRes] = await Promise.all([
        apiRequest<SinistreDetail>(`/api/sinistres/${sinistreId}`),
        apiRequest<Reglement[]>(`/api/sinistres/${sinistreId}/reglements`),
      ]);
      setDetail(sinistreRes);
      setReglements(Array.isArray(reglementsRes) ? reglementsRes : []);
      setReglementForm((prev) => ({
        ...prev,
        sinistre_ligne_id: prev.sinistre_ligne_id || String(sinistreRes.lignes?.[0]?.id || ""),
      }));
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Erreur de chargement du sinistre."));
      setDetail(null);
      setReglements([]);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadOptions().catch((error: unknown) => setError(getErrorMessage(error, "Erreur de chargement des référentiels.")));
  }, [loadOptions]);

  useEffect(() => {
    loadSinistres().catch((error: unknown) => setError(getErrorMessage(error, "Erreur de chargement des sinistres.")));
  }, [loadSinistres]);

  useEffect(() => {
    if (view !== "visualisation") return;
    loadTreeStats().catch((error: unknown) =>
      setError(getErrorMessage(error, "Erreur de chargement des statistiques de sinistres."))
    );
  }, [loadTreeStats, view]);

  useEffect(() => {
    if (view !== "graphiques") return;
    loadGraphData().catch((error: unknown) =>
      setError(getErrorMessage(error, "Erreur de chargement des graphiques sinistres."))
    );
  }, [loadGraphData, view]);

  useEffect(() => {
    if (!selectedBranchId && selectedLigneKey) {
      setSelectedLigneKey("");
      setPage(1);
    }
  }, [selectedBranchId, selectedLigneKey]);

  useEffect(() => {
    if (view !== "visualisation") return;
    if (!selectedLigneKey) return;
    if (lineStats.some((line) => sameLigneKey(line.ligne_key, selectedLigneKey))) return;
    setSelectedLigneKey("");
    setPage(1);
  }, [lineStats, selectedLigneKey, view]);

  useEffect(() => {
    if (!detailOpen || !selectedSinistreId) return;
    loadSinistreDetail(selectedSinistreId).catch((error: unknown) =>
      setError(getErrorMessage(error, "Erreur de chargement du détail sinistre."))
    );
  }, [detailOpen, loadSinistreDetail, selectedSinistreId]);

  useEffect(() => {
    if (view !== "visualisation") return;
    const params = new URLSearchParams({ view: "visualisation" });
    if (selectedBranchId) params.set("id_branch", String(selectedBranchId));
    if (selectedLigneKey) params.set("ligne_risque", selectedLigneKey);
    if (filterStatut) params.set("statut", filterStatut);
    if (filterPartnerQuery) params.set("partner_q", filterPartnerQuery);
    if (filterClientQuery) params.set("client_q", filterClientQuery);
    if (sortEstime) params.set("sort_estime", sortEstime);
    if (sortPaye) params.set("sort_paye", sortPaye);
    router.replace(`/sinistres?${params.toString()}`);
  }, [
    filterClientQuery,
    filterPartnerQuery,
    filterStatut,
    router,
    selectedBranchId,
    selectedLigneKey,
    sortEstime,
    sortPaye,
    view,
  ]);

  useEffect(() => {
    if (view !== "graphiques") return;
    const params = new URLSearchParams({ view: "graphiques", year: String(graphYear) });
    router.replace(`/sinistres?${params.toString()}`);
  }, [graphYear, router, view]);

  useEffect(() => {
    if (!createForm.client_id || !createForm.partner_id) {
      setCreateContracts([]);
      setCreateContractsLoading(false);
      return;
    }
    let ignore = false;
    async function loadCreateContracts() {
      setCreateContractsLoading(true);
      try {
        const params = new URLSearchParams({
          page: "1",
          limit: "200",
          client_id: createForm.client_id,
          partner_id: createForm.partner_id,
        });
        const res = await apiRequest<Paginated<PartnerContract>>(`/api/partners/contracts?${params.toString()}`);
        if (!ignore) setCreateContracts(res.data || []);
      } catch {
        if (!ignore) setCreateContracts([]);
      } finally {
        if (!ignore) setCreateContractsLoading(false);
      }
    }
    loadCreateContracts();
    return () => {
      ignore = true;
    };
  }, [createForm.client_id, createForm.partner_id]);

  useEffect(() => {
    if (contextualProgrammes.length === 0) {
      setCreateForm((prev) => ({ ...prev, programme_id: "" }));
      return;
    }
    if (createForm.programme_id && contextualProgrammes.some((programme) => String(programme.id) === createForm.programme_id)) {
      return;
    }
    setCreateForm((prev) => ({ ...prev, programme_id: String(contextualProgrammes[0].id) }));
  }, [contextualProgrammes, createForm.programme_id]);

  useEffect(() => {
    if (selectedProgrammeCoverages.length === 0) {
      setCreateForm((prev) => ({ ...prev, coverage_id: "" }));
      return;
    }
    if (
      createForm.coverage_id &&
      selectedProgrammeCoverages.some((coverage) => String(coverage.id_coverage) === createForm.coverage_id)
    ) {
      return;
    }
    setCreateForm((prev) => ({ ...prev, coverage_id: String(selectedProgrammeCoverages[0].id_coverage) }));
  }, [createForm.coverage_id, selectedProgrammeCoverages]);

  useEffect(() => {
    if (contextualCreationBranches.length === 0) {
      setCreateForm((prev) => ({ ...prev, id_branch: "" }));
      return;
    }
    if (
      createForm.id_branch &&
      contextualCreationBranches.some((branch) => String(branch.id_branch) === createForm.id_branch)
    ) {
      return;
    }
    setCreateForm((prev) => ({ ...prev, id_branch: String(contextualCreationBranches[0].id_branch) }));
  }, [contextualCreationBranches, createForm.id_branch]);

  useEffect(() => {
    if (!detail) {
      setLineStatusDrafts({});
      return;
    }
    const nextDrafts: Record<number, SinistreLigne["statut"]> = {};
    for (const line of detail.lignes || []) {
      nextDrafts[line.id] = line.statut;
    }
    setLineStatusDrafts(nextDrafts);
  }, [detail]);

  function applyClientSelection(client: ClientOption) {
    const partnerId = Number(client.partner_id || 0);
    const clientId = Number(client.id || 0);
    if (!partnerId || !clientId) return;
    const partner = partners.find((item) => Number(item.id) === partnerId);
    setCreateForm((prev) => ({
      ...prev,
      client_id: String(clientId),
      partner_id: String(partnerId),
      client_ref: client.nom || "",
      programme_id: "",
      id_branch: "",
      coverage_id: "",
    }));
    setClientPickerOpen(false);
    setPartnerPickerOpen(false);
    setClientPickerError(null);
    setMessage(`Client ${client.nom || `#${clientId}`} sélectionné${partner ? ` (${partner.raison_sociale})` : ""}.`);
  }

  async function searchClientByReference() {
    const query = clientPickerSearch.trim();
    if (!query) {
      setClientPickerError("Saisis une référence client.");
      return;
    }
    setClientPickerLoading(true);
    setClientPickerError(null);
    try {
      const params = new URLSearchParams({ page: "1", limit: "200", q: query, with_contracts: "1" });
      const res = await apiRequest<Paginated<ClientOption>>(`/api/partners/clients?${params.toString()}`);
      const rows = (res.data || []).filter((row) => Number(row.partner_id || 0) > 0);
      const candidates = rows.map((row) => ({
        ...row,
        partner_id: Number(row.partner_id || 0),
      }));
      setClientPickerResults(candidates);
      if (!candidates.length) {
        setClientPickerError("Aucun client trouvé pour cette référence.");
        return;
      }
      setPartnerPickerCandidates([]);
      setPartnerPickerOpen(false);
    } catch (error: unknown) {
      setClientPickerError(getErrorMessage(error, "Recherche client impossible."));
      setClientPickerResults([]);
      setPartnerPickerCandidates([]);
      setPartnerPickerOpen(false);
    } finally {
      setClientPickerLoading(false);
    }
  }

  async function createSinistre(e: FormEvent) {
    e.preventDefault();
    if (!createForm.client_id || !createForm.partner_id) {
      setError("Le client et le partenaire sont obligatoires.");
      return;
    }
    if (!createContracts.length) {
      setError("Aucun contrat disponible pour ce client et ce partenaire.");
      return;
    }
    if (!createForm.programme_id || !createForm.id_branch) {
      setError("Ligne et branche sont obligatoires.");
      return;
    }
    if (createForm.montant_estime === "") {
      setError("Le montant estimé est obligatoire.");
      return;
    }
    const montantEstime = Number(createForm.montant_estime);
    if (!Number.isFinite(montantEstime) || montantEstime < 0) {
      setError("Le montant estimé est invalide.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const resolvedFranchise =
        selectedCreateCoverageFranchiseAmount === null
          ? toAmount(selectedCreateProgramme?.franchise)
          : selectedCreateCoverageFranchiseAmount;
      const payload = {
        programme_id: Number(createForm.programme_id),
        partner_id: Number(createForm.partner_id),
        client_id: Number(createForm.client_id),
        date_survenue: createForm.date_survenue || null,
        date_decl: createForm.date_decl || null,
        statut: createForm.statut,
        devise: createForm.devise || "EUR",
        description: createForm.description || null,
        lignes: [
          {
            id_branch: Number(createForm.id_branch),
            statut: createForm.statut,
            montant_estime: montantEstime,
            montant_paye: 0,
            montant_recours: 0,
            montant_franchise: resolvedFranchise,
            description: createForm.description || null,
          },
        ],
      };
      const created = await apiRequest<SinistreDetail>("/api/sinistres", "POST", payload);
      setCreateForm((prev) => ({
        ...prev,
        date_survenue: "",
        date_decl: "",
        montant_estime: "",
        description: "",
      }));
      setMessage(`Sinistre #${created.id} créé.`);
      setPage(1);
      await Promise.all([loadSinistres(), loadTreeStats()]);
      setSelectedSinistreId(created.id);
      setDetailOpen(true);
      router.push(visualisationViewHref);
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Création du sinistre impossible."));
    }
  }

  function setLineStatusDraft(lineId: number, statut: SinistreLigne["statut"]) {
    setLineStatusDrafts((prev) => ({ ...prev, [lineId]: statut }));
  }

  async function validateLineStatuses() {
    if (!selectedSinistreId || !detail?.lignes?.length) return;
    const changedLines = detail.lignes
      .map((line) => ({ id: line.id, statut: lineStatusDrafts[line.id] || line.statut, initialStatut: line.statut }))
      .filter((line) => line.statut !== line.initialStatut);
    const invalidTransition = changedLines.find(
      (line) => !getAllowedLineStatuses(line.initialStatut).includes(line.statut)
    );
    if (invalidTransition) {
      setError("Impossible de revenir à un statut antérieur.");
      return;
    }
    if (!changedLines.length) {
      setMessage("Aucun changement de statut à valider.");
      return;
    }
    setSavingLineStatuses(true);
    setError(null);
    try {
      await Promise.all(
        changedLines.map((line) =>
          apiRequest(`/api/sinistres/${selectedSinistreId}/lignes/${line.id}`, "PATCH", { statut: line.statut })
        )
      );
      await Promise.all([loadSinistres(), loadTreeStats(), loadSinistreDetail(selectedSinistreId)]);
      setMessage("Statuts des lignes mis à jour.");
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Validation des statuts impossible."));
    } finally {
      setSavingLineStatuses(false);
    }
  }

  async function createReglement(e: FormEvent) {
    e.preventDefault();
    if (!selectedSinistreId) return;
    if (!reglementForm.montant) {
      setError("Le montant du règlement est obligatoire.");
      return;
    }
    const montantValue = Number(reglementForm.montant);
    if (!Number.isFinite(montantValue) || montantValue <= 0) {
      setError("Le montant du règlement doit être supérieur à zéro.");
      return;
    }
    if (reglementLocked) {
      setReglementModalMessage("Plafond de règlement atteint pour ce sinistre. Aucun paiement supplémentaire n'est autorisé.");
      return;
    }
    if (reglementCapacity && montantValue > reglementCapacity.restant + 1e-6) {
      setReglementModalMessage(
        `Montant saisi supérieur au maximum autorisé. Maximum disponible: ${formatMoney(reglementCapacity.restant, detail?.devise)}.`
      );
      return;
    }
    setError(null);
    try {
      await apiRequest(`/api/sinistres/${selectedSinistreId}/reglements`, "POST", {
        sinistre_ligne_id: reglementForm.sinistre_ligne_id ? Number(reglementForm.sinistre_ligne_id) : undefined,
        date: reglementForm.date || null,
        montant: montantValue,
      });
      setReglementForm((prev) => ({ ...prev, date: "", montant: "" }));
      await Promise.all([loadSinistres(), loadTreeStats(), loadSinistreDetail(selectedSinistreId)]);
      setMessage("Règlement enregistré.");
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : "";
      if (code === "reglement_limit_reached") {
        setReglementModalMessage("Plafond de règlement atteint pour ce sinistre. Aucun paiement supplémentaire n'est autorisé.");
        return;
      }
      if (code === "reglement_limit_exceeded") {
        setReglementModalMessage(
          `Montant saisi supérieur au maximum autorisé. Maximum disponible: ${formatMoney(reglementCapacity?.restant || 0, detail?.devise)}.`
        );
        return;
      }
      setError(getErrorMessage(error, "Création du règlement impossible."));
    }
  }

  function openSinistreDetail(sinistreId: number) {
    setSelectedSinistreId(sinistreId);
    setDetailTab("ventilation");
    setDetailOpen(true);
    setMessage(null);
    setReglementModalMessage(null);
  }

  function toggleStatutFilter(statut: string) {
    setFilterStatut((prev) => (prev === statut ? "" : statut));
    setPage(1);
  }

  function selectBranch(branchId: number) {
    setSelectedBranchId(branchId);
    setSelectedLigneKey("");
    setPage(1);
  }

  function selectLine(lineKey: string) {
    setSelectedLigneKey(lineKey);
    setPage(1);
  }

  function goBackToBranches() {
    setSelectedBranchId(null);
    setSelectedLigneKey("");
    setPage(1);
  }

  function goBackToLines() {
    setSelectedLigneKey("");
    setPage(1);
  }

  function clearVisualisationFilters() {
    setFilterStatut("");
    setFilterPartnerQuery("");
    setFilterClientQuery("");
    setSortEstime("");
    setSortPaye("");
    setSelectedBranchId(null);
    setSelectedLigneKey("");
    setPage(1);
  }

  function cancelCreationForm() {
    setCreateForm((prev) => ({
      ...prev,
      date_survenue: "",
      date_decl: "",
      statut: "ouvert",
      devise: "EUR",
      montant_estime: "",
      description: "",
    }));
    setError(null);
    setMessage(null);
  }

  function goBackToVisualisation() {
    setError(null);
    setMessage(null);
    router.push(visualisationViewHref);
  }

  return (
    <RequireAuth>
      <div className="space-y-6 [&_select]:h-10 [&_input]:h-10">
        <PageTitle
          title="Sinistres"
          description="Gère la création et la visualisation des sinistres avec ventilation par branche."
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>
        ) : null}

        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
          <Link
            href={creationViewHref}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Création
          </Link>
          <Link
            href={visualisationViewHref}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Visualisation
          </Link>
          <Link
            href={graphiquesViewHref}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "graphiques" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Graphiques
          </Link>
        </div>

        {view === "creation" ? (
          <form onSubmit={createSinistre} className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-800">Création de sinistre</h2>
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              La création initialise un dossier sinistre et une première ligne de ventilation par branche.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-slate-600">
                Réf. client
                <input
                  value={createForm.client_ref || ""}
                  readOnly
                  disabled
                  placeholder="Sélectionner via la modale client"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <label className="text-xs text-slate-600">
                Partenaire
                <input
                  value={selectedCreatePartner?.raison_sociale || ""}
                  readOnly
                  disabled
                  placeholder="Déterminé après choix client"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    setClientPickerOpen(true);
                    setClientPickerError(null);
                    setPartnerPickerOpen(false);
                    setPartnerPickerCandidates([]);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Choisir le client
                </button>
                {createForm.client_id && createForm.partner_id ? (
                  <p className="mt-2 text-xs text-emerald-700">
                    Client #{createForm.client_id} rattaché au partenaire #{createForm.partner_id}.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-700">
                    La sélection client + partenaire est obligatoire avant la création.
                  </p>
                )}
                {createContractsLoading ? (
                  <p className="mt-1 text-xs text-slate-500">Chargement des contrats du client...</p>
                ) : null}
                {createForm.client_id && createForm.partner_id && !createContractsLoading && createContracts.length === 0 ? (
                  <p className="mt-1 text-xs text-red-600">
                    Aucun contrat disponible pour ce couple client/partenaire.
                  </p>
                ) : null}
              </div>

              <label className="text-xs text-slate-600">
                Ligne
                <select
                  value={createForm.programme_id}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, programme_id: e.target.value }))}
                  disabled={!createForm.client_id || !createForm.partner_id || createContractsLoading}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Choisir une ligne</option>
                  {contextualProgrammes.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.id} - {p.ligne_risque}
                    </option>
                  ))}
                </select>
                {!hasContextProgrammeMatch ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Aucun contrat client sur la ligne &quot;{selectedLigneKey}&quot;. Affichage de toutes les lignes contractées.
                  </p>
                ) : null}
              </label>

              <label className="text-xs text-slate-600">
                Code S2
                <select
                  value={createForm.id_branch}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, id_branch: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Choisir un code S2</option>
                  {contextualCreationBranches.map((b) => (
                    <option key={b.id_branch} value={b.id_branch}>
                      {`${b.s2_code || `#${b.id_branch}`} - ${b.name || "Branche"}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-600">
                Garantie déclenchée
                <select
                  value={createForm.coverage_id}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, coverage_id: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Choisir une garantie</option>
                  {selectedProgrammeCoverages.map((coverage) => (
                    <option key={coverage.id_coverage} value={coverage.id_coverage}>
                      {coverage.label || `Garantie #${coverage.id_coverage}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-600">
                Date survenue
                <input
                  type="date"
                  value={createForm.date_survenue}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, date_survenue: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-slate-600">
                Date déclaration
                <input
                  type="date"
                  value={createForm.date_decl}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, date_decl: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-slate-600">
                Statut initial
                <select
                  value={createForm.statut}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, statut: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {STATUTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-600">
                Devise
                <input
                  value={createForm.devise}
                  maxLength={3}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, devise: e.target.value.toUpperCase() }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-slate-600">
                Montant estimé (ligne)
                <input
                  type="number"
                  min={0}
                  step="1"
                  required
                  value={createForm.montant_estime}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, montant_estime: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-slate-600">
                Limite sinistre ponctuel
                <input
                  value={selectedCreateCoverageLimitPerClaimLabel}
                  disabled
                  readOnly
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <label className="text-xs text-slate-600">
                Limite annuelle
                <input
                  value={selectedCreateCoverageLimitAnnualLabel}
                  disabled
                  readOnly
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <label className="text-xs text-slate-600">
                Franchise garantie
                <input
                  value={selectedCreateCoverageFranchiseLabel}
                  disabled
                  readOnly
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <label className="text-xs text-slate-600">
                Garantie (contrat)
                <input
                  value={selectedCreateProgrammeGarantieLabel}
                  disabled
                  readOnly
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <label className="text-xs text-slate-600">
                Franchise (contrat)
                <input
                  value={selectedCreateProgrammeFranchiseLabel}
                  disabled
                  readOnly
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <label className="text-xs text-slate-600 md:col-span-2">
                Description
                <textarea
                  rows={3}
                  value={createForm.description}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelCreationForm}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={goBackToVisualisation}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Retour
              </button>
              <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Créer le sinistre
              </button>
            </div>
          </form>
        ) : null}

        {view === "visualisation" ? (
          <div className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-800">
                  Liste des sinistres
                  {visualisationStep === 3 ? ` - ${selectedLine?.ligne_label || selectedLigneKey || "Ligne"}` : ""}
                </h2>
                <p className="text-xs text-slate-500">
                  Arborescence de sélection: branche, puis ligne, puis statut.
                </p>
              </div>
              {visualisationStep === 3 ? (
                <button
                  type="button"
                  onClick={goBackToLines}
                  className="h-10 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Retour aux lignes
                </button>
              ) : null}
              {visualisationStep === 3 ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-slate-600">
                    Partenaire
                    <input
                      value={filterPartnerQuery}
                      onChange={(e) => {
                        setFilterPartnerQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Nom partenaire"
                      className="mt-1 min-w-[170px] rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Client
                    <input
                      value={filterClientQuery}
                      onChange={(e) => {
                        setFilterClientQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Réf. client"
                      className="mt-1 min-w-[150px] rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Statut
                    <select
                      value={filterStatut}
                      onChange={(e) => {
                        setFilterStatut(e.target.value);
                        setPage(1);
                      }}
                      className="mt-1 min-w-[130px] rounded-md border border-slate-300 px-3 text-sm"
                    >
                      <option value="">Tous</option>
                      {STATUTS.map((s) => (
                        <option key={s} value={s}>
                          {formatStatutLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-600">
                    Tri estimé
                    <select
                      value={sortEstime}
                      onChange={(e) => {
                        setSortEstime(e.target.value);
                        setPage(1);
                      }}
                      className="mt-1 min-w-[130px] rounded-md border border-slate-300 px-3 text-sm"
                    >
                      <option value="">Par défaut</option>
                      <option value="desc">Décroissant</option>
                      <option value="asc">Croissant</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-600">
                    Tri payé
                    <select
                      value={sortPaye}
                      onChange={(e) => {
                        setSortPaye(e.target.value);
                        setPage(1);
                      }}
                      className="mt-1 min-w-[130px] rounded-md border border-slate-300 px-3 text-sm"
                    >
                      <option value="">Par défaut</option>
                      <option value="desc">Décroissant</option>
                      <option value="asc">Croissant</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={clearVisualisationFilters}
                    disabled={
                      !filterStatut &&
                      !filterPartnerQuery &&
                      !filterClientQuery &&
                      !sortEstime &&
                      !sortPaye &&
                      !selectedBranchId &&
                      !selectedLigneKey
                    }
                    className="h-10 rounded-md border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Réinitialiser
                  </button>
                </div>
              ) : null}
            </div>

            {visualisationStep === 1 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">1. Blocs par branche</h3>
                  <div className="text-xs text-slate-600">
                    {loadingStats ? "Mise à jour..." : `${branchStats.length} branches`}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {branchStats.length === 0 ? (
                    <div className="sm:col-span-2 xl:col-span-3 rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-500">
                      {loadingStats ? "Chargement des statistiques..." : "Aucune donnée de branche."}
                    </div>
                  ) : (
                    branchStats.map((branch) => (
                      <div
                        key={branch.id_branch}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectBranch(branch.id_branch)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectBranch(branch.id_branch);
                          }
                        }}
                        className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300"
                      >
                        <div className="text-sm font-semibold text-slate-800">
                          {branch.s2_code || "—"} - {branch.name || "Branche"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">Total estimé: {formatMoney(branch.total, "EUR")}</div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {STATUTS.map((statut) => (
                            <button
                              key={statut}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleStatutFilter(statut);
                              }}
                              className={`inline-flex items-center justify-between rounded-md border px-2 py-1 text-[11px] ${
                                filterStatut === statut
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <span>{formatStatutLabel(statut)}</span>
                              <span className="font-semibold">{formatMoney(branch[statut], "EUR")}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {visualisationStep === 2 ? (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">
                    2. Blocs par ligne pour {selectedBranch?.s2_code || "—"} - {selectedBranch?.name || "Branche"}
                  </h3>
                  <button
                    type="button"
                    onClick={goBackToBranches}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Retour aux branches
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {lineStats.length === 0 ? (
                    <div className="sm:col-span-2 xl:col-span-3 rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-500">
                      Aucune ligne trouvée pour cette branche.
                    </div>
                  ) : (
                    lineStats.map((line) => (
                      <div
                        key={line.ligne_key}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectLine(line.ligne_key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectLine(line.ligne_key);
                          }
                        }}
                        className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300"
                      >
                        <div className="text-sm font-semibold text-slate-800">{line.ligne_label}</div>
                        <div className="mt-1 text-xs text-slate-600">Total estimé: {formatMoney(line.total, "EUR")}</div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {STATUTS.map((statut) => (
                            <button
                              key={statut}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleStatutFilter(statut);
                              }}
                              className={`inline-flex items-center justify-between rounded-md border px-2 py-1 text-[11px] ${
                                filterStatut === statut
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <span>{formatStatutLabel(statut)}</span>
                              <span className="font-semibold">{formatMoney(line[statut], "EUR")}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {visualisationStep === 3 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">
                    Filtre actif: {selectedBranch ? `${selectedBranch.s2_code || "—"} - ${selectedBranch.name || "Branche"}` : "—"} /{" "}
                    {selectedLine?.ligne_label || "—"} / {filterStatut ? formatStatutLabel(filterStatut) : "Tous statuts"}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Partenaire</th>
                        <th className="px-3 py-2 text-left">Client</th>
                        <th className="px-3 py-2 text-center">Statut</th>
                        <th className="px-3 py-2 text-right">Estimé</th>
                        <th className="px-3 py-2 text-right">Payé</th>
                        <th className="px-3 py-2 text-center">Lignes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingList ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                            Chargement...
                          </td>
                        </tr>
                      ) : sinistres.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                            Aucun sinistre pour les filtres en cours.
                          </td>
                        </tr>
                      ) : (
                        sinistres.map((s) => (
                          <tr
                            key={s.id}
                            className={`border-t border-slate-100 align-top ${
                              selectedSinistreId === s.id ? "bg-blue-50" : "hover:bg-slate-50"
                            } cursor-pointer`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openSinistreDetail(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openSinistreDetail(s.id);
                              }
                            }}
                            title="Ouvrir le détail"
                          >
                            <td className="px-3 py-2 text-blue-700 underline decoration-dotted underline-offset-2">
                              {s.partner_name || "—"}
                            </td>
                            <td className="px-3 py-2 text-blue-700 underline decoration-dotted underline-offset-2">{s.client_ref || "—"}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${badgeClass(s.statut)}`}>{s.statut}</span>
                            </td>
                            <td className="px-3 py-2 text-right">{formatMoney(s.montant_estime, s.devise)}</td>
                            <td className="px-3 py-2 text-right">{formatMoney(s.montant_paye, s.devise)}</td>
                            <td className="px-3 py-2 text-center">{s.lignes_count ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Précédent
                  </button>
                  <div className="text-xs text-slate-600">
                    Page {page} / {maxPage} • Total {total}
                  </div>
                  <button
                    type="button"
                    disabled={page >= maxPage}
                    onClick={() => setPage((prev) => Math.min(maxPage, prev + 1))}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "graphiques" ? (
          <div className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-800">Graphiques (constat)</h2>
                <p className="text-xs text-slate-500">Cadres de suivi sinistres. De nouveaux graphiques seront ajoutés ici.</p>
              </div>
              <label className="text-xs text-slate-600">
                Année
                <select
                  value={String(graphYear)}
                  onChange={(e) => setGraphYear(Number(e.target.value) || new Date().getUTCFullYear())}
                  className="mt-1 min-w-[120px] rounded-md border border-slate-300 px-3 text-sm"
                >
                  {Array.from({ length: 8 }, (_, i) => new Date().getUTCFullYear() - 3 + i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Suivi règlements</h3>
                  <p className="text-xs text-slate-500">
                    Cumul des montants de sinistres estimés vs cumul des règlements encaissés (constat) - année {graphData?.year || graphYear}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    Cumul sinistres en cours: <span className="font-semibold">{formatMoney(graphData?.totals?.estimated || 0, "EUR")}</span>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    Cumul règlements: <span className="font-semibold">{formatMoney(graphData?.totals?.paid || 0, "EUR")}</span>
                  </div>
                </div>
              </div>

              {graphLoading ? (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">Chargement du graphique...</div>
              ) : !graphData ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                  Aucune donnée graphique disponible.
                </div>
              ) : (
                <>
                  <PeriodZoomControls
                    months={graphData.months}
                    fromMonth={graphFromMonth}
                    toMonth={graphToMonth}
                    onChangeFrom={(next) => {
                      setGraphFromMonth(next);
                      if (graphToMonth && next > graphToMonth) setGraphToMonth(next);
                    }}
                    onChangeTo={(next) => {
                      setGraphToMonth(next);
                      if (graphFromMonth && next < graphFromMonth) setGraphFromMonth(next);
                    }}
                    onReset={() => {
                      setGraphFromMonth(graphData.months[0]?.month || "");
                      setGraphToMonth(graphData.months[graphData.months.length - 1]?.month || "");
                    }}
                  />

                  <SinistresCumulChart months={graphMonthsFiltered} />
                  {graphPeriodSummary ? (
                    <div className="space-y-2">
                      <TwoSegmentGaugePanel
                        caption={`Jauge fin de période (${graphPeriodSummary.from} -> ${graphPeriodSummary.to}) - base 100% = cumul sinistres en cours`}
                        totalLabel={formatMoney(graphPeriodSummary.estimated, "EUR")}
                        leftPct={graphPeriodSummary.paidPct}
                        rightPct={graphPeriodSummary.remainingPct}
                        left={{
                          label: "Règlements (fin période)",
                          amountLabel: formatMoney(graphPeriodSummary.paidCapped, "EUR"),
                          pctLabel: `${graphPeriodSummary.paidPct.toFixed(1)}%`,
                          barColorClass: "bg-blue-600",
                          cardClass: "border-blue-600 bg-blue-600",
                          textClass: "text-white",
                        }}
                        right={{
                          label: "Reste à payer (fin période)",
                          amountLabel: formatMoney(graphPeriodSummary.remaining, "EUR"),
                          pctLabel: `${graphPeriodSummary.remainingPct.toFixed(1)}%`,
                          barColorClass: "bg-slate-300",
                          cardClass: "border-slate-300 bg-slate-300",
                          textClass: "text-slate-900",
                        }}
                      />
                      {(() => {
                        const base = Math.max(0, graphPeriodSummary.estimated);
                        const openPct = base > 0 ? (graphPeriodSummary.statusOpen / base) * 100 : 0;
                        const inProgressPct = base > 0 ? (graphPeriodSummary.statusInProgress / base) * 100 : 0;
                        const closedPct = base > 0 ? (graphPeriodSummary.statusClosed / base) * 100 : 0;
                        const rejectedPct = base > 0 ? (graphPeriodSummary.statusRejected / base) * 100 : 0;
                        return (
                          <SegmentedGaugePanel
                            caption="Répartition des sinistres en cours (base 100% = cumul sinistres en cours, fin de période)"
                            segments={[
                              {
                                key: "open",
                                label: "Ouverts",
                                pct: openPct,
                                barColorClass: "bg-amber-400",
                                cardClass: "border-amber-400 bg-amber-400",
                                textClass: "text-slate-900",
                              },
                              {
                                key: "in_progress",
                                label: "En cours",
                                pct: inProgressPct,
                                barColorClass: "bg-sky-500",
                                cardClass: "border-sky-500 bg-sky-500",
                                textClass: "text-white",
                              },
                              {
                                key: "closed",
                                label: "Clos",
                                pct: closedPct,
                                barColorClass: "bg-emerald-500",
                                cardClass: "border-emerald-500 bg-emerald-500",
                                textClass: "text-white",
                              },
                              {
                                key: "rejected",
                                label: "Rejetés",
                                pct: rejectedPct,
                                barColorClass: "bg-rose-500",
                                cardClass: "border-rose-500 bg-rose-500",
                                textClass: "text-white",
                              },
                            ]}
                          />
                        );
                      })()}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <ToggleTableHeader
                      title="Tableau de sinistres (mensuel)"
                      visible={graphTableVisible}
                      onToggle={() => setGraphTableVisible((v) => !v)}
                    />
                    {graphTableVisible ? (
                      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="px-3 py-2 text-left">Mois</th>
                              <th className="px-3 py-2 text-right">Sinistre enregistré</th>
                              <th className="px-3 py-2 text-right">Règlements mois</th>
                              <th className="px-3 py-2 text-right">Cumul sinistres en cours</th>
                              <th className="px-3 py-2 text-right">Cumul règlements</th>
                            </tr>
                          </thead>
                          <tbody>
                            {graphMonthsFiltered.map((row) => (
                              <tr key={row.month} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-xs text-slate-700">{row.month}</td>
                                <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.estimated_amount, "EUR")}</td>
                                <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.paid_amount, "EUR")}</td>
                                <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_estimated, "EUR")}</td>
                                <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_paid, "EUR")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}

        {clientPickerOpen ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 p-4">
            <div className="flex min-h-full items-start justify-center py-8">
              <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Sélection du client</h3>
                    <p className="text-xs text-slate-600">
                      Recherche par référence client puis sélection manuelle dans la liste.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setClientPickerOpen(false);
                      setClientPickerError(null);
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Fermer
                  </button>
                </div>
                <div className="space-y-3 p-4">
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      searchClientByReference().catch(() => undefined);
                    }}
                  >
                    <label className="min-w-[18rem] flex-1 text-xs text-slate-600">
                      Référence client
                      <input
                        value={clientPickerSearch}
                        onChange={(e) => setClientPickerSearch(e.target.value)}
                        placeholder="Ex: 100028320-CL001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={clientPickerLoading}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {clientPickerLoading ? "Recherche..." : "Rechercher"}
                    </button>
                  </form>
                  {clientPickerError ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {clientPickerError}
                    </div>
                  ) : null}
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left">Réf. client</th>
                          <th className="px-3 py-2 text-left">Partenaire</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">CA</th>
                          <th className="px-3 py-2 text-left">Masse salariale</th>
                          <th className="px-3 py-2 text-left">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {clientPickerResults.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-500">
                              Aucun résultat affiché.
                            </td>
                          </tr>
                        ) : (
                          clientPickerResults.map((row) => (
                            <tr key={`${row.id}-${row.partner_id || 0}`}>
                              <td className="px-3 py-2 text-slate-700">{row.nom || `#${row.id}`}</td>
                              <td className="px-3 py-2 text-slate-700">
                                {partners.find((partner) => Number(partner.id) === Number(row.partner_id || 0))?.raison_sociale ||
                                  (row.partner_id ? `#${row.partner_id}` : "—")}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{row.type || "—"}</td>
                              <td className="px-3 py-2 text-slate-600">{formatNumber(row.chiffre_affaires)}</td>
                              <td className="px-3 py-2 text-slate-600">{formatNumber(row.masse_salariale)}</td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => applyClientSelection(row)}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  Choisir
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {partnerPickerOpen ? (
          <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-4">
            <div className="flex min-h-full items-start justify-center py-10">
              <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Choix du partenaire</h3>
                    <p className="text-xs text-slate-600">
                      Cette référence client existe chez plusieurs partenaires.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPartnerPickerOpen(false);
                      setPartnerPickerCandidates([]);
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Fermer
                  </button>
                </div>
                <div className="space-y-2 p-4">
                  {partnerPickerCandidates.map((candidate) => {
                    const partner = partners.find((item) => Number(item.id) === Number(candidate.partner_id || 0));
                    return (
                      <button
                        key={`${candidate.id}-${candidate.partner_id || 0}`}
                        type="button"
                        onClick={() => applyClientSelection(candidate)}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <div className="text-sm font-medium text-slate-800">
                          {partner?.raison_sociale || `Partenaire #${candidate.partner_id}`}
                        </div>
                        <div className="text-xs text-slate-600">
                          Réf. client: {candidate.nom || `#${candidate.id}`}
                          {partner?.siren ? ` • SIREN ${partner.siren}` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {detailOpen ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 p-4">
            <div className="flex min-h-full items-start justify-center py-2">
              <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {detail ? `Détail sinistre #${detail.id}` : "Détail sinistre"}
                    </h3>
                    <p className="text-xs text-slate-600">
                      {detail
                        ? `${detail.ligne_risque || `Ligne #${detail.programme_id}`} • Survenue ${formatDate(detail.date_survenue)}`
                        : "Chargement du dossier..."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailOpen(false);
                      setReglementModalMessage(null);
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Fermer
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {error ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                  ) : null}
                  {message ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>
                  ) : null}
                  {loadingDetail || !detail ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Chargement...
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-6">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Statut global: <span className={`rounded-full border px-2 py-0.5 ${badgeClass(detail.statut)}`}>{detail.statut}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Estimé: <span className="font-semibold">{formatMoney(detail.montant_estime, detail.devise)}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Payé: <span className="font-semibold">{formatMoney(detail.montant_paye, detail.devise)}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Déclaration: <span className="font-semibold">{formatDate(detail.date_decl)}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Client: <span className="font-semibold">{detail.client_ref || "—"}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Partenaire: <span className="font-semibold">{detail.partner_name || "—"}</span>
                        </div>
                      </div>

                      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ligne</h4>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            Ligne:{" "}
                            <span className="font-semibold">
                              {detail.ligne_risque || `Ligne #${detail.programme_id}`}
                            </span>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            Branche:{" "}
                            <span className="font-semibold">
                              {detail.programme_branch_s2_code || "—"}
                              {detail.programme_branch_name ? ` - ${detail.programme_branch_name}` : ""}
                            </span>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            Assureur: <span className="font-semibold">{detail.programme_assureur || "—"}</span>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            Franchise socle:{" "}
                            <span className="font-semibold">
                              {formatMoney(detail.programme_franchise, detail.programme_devise || detail.devise)}
                            </span>
                          </div>
                        </div>
                      </section>

                      <div className="space-y-3">
                        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
                          <button
                            type="button"
                            onClick={() => setDetailTab("ventilation")}
                            className={`rounded-md px-3 py-1.5 text-xs ${
                              detailTab === "ventilation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Ventilation par branche
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailTab("reglements")}
                            className={`rounded-md px-3 py-1.5 text-xs ${
                              detailTab === "reglements" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Règlements
                          </button>
                        </div>

                        {detailTab === "ventilation" ? (
                          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ventilation par branche</h4>
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                              <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-3 py-2 text-left">Branche</th>
                                    <th className="px-3 py-2 text-left">Statut</th>
                                    <th className="px-3 py-2 text-right">Estimé</th>
                                    <th className="px-3 py-2 text-right">Franchise</th>
                                    <th className="px-3 py-2 text-right">Payé</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.lignes?.map((line) => (
                                    <tr key={line.id} className="border-t border-slate-100">
                                      <td className="px-3 py-2 text-xs text-slate-700">
                                        <div className="font-medium">
                                          {line.branch_s2_code || "—"} - {line.branch_name || "Branche"}
                                        </div>
                                        <div className="text-slate-500">Ligne #{line.id}</div>
                                      </td>
                                      <td className="px-3 py-2">
                                        <select
                                          value={lineStatusDrafts[line.id] || line.statut}
                                          onChange={(e) => setLineStatusDraft(line.id, e.target.value as SinistreLigne["statut"])}
                                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                                        >
                                          {getAllowedLineStatuses(line.statut).map((s) => (
                                            <option key={s} value={s}>
                                              {s}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td className="px-3 py-2 text-right text-xs text-slate-700">
                                        {formatMoney(line.montant_estime, detail.devise)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-xs text-slate-700">
                                        {formatMoney(line.montant_franchise, detail.devise)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-xs text-slate-700">
                                        {formatMoney(line.montant_paye, detail.devise)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                              <p className="text-xs text-slate-600">Modifie les statuts puis valide en une fois.</p>
                              <button
                                type="button"
                                onClick={validateLineStatuses}
                                disabled={!hasLineStatusChanges || savingLineStatuses}
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {savingLineStatuses ? "Validation..." : "Valider les statuts"}
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {detailTab === "reglements" ? (
                          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Règlements</h4>
                            {reglementCapacity ? (
                              <div className="grid gap-2 sm:grid-cols-3">
                                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                  Plafond max:{" "}
                                  <span className="font-semibold">{formatMoney(reglementCapacity.plafond, detail.devise)}</span>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                  Déjà réglé:{" "}
                                  <span className="font-semibold">{formatMoney(reglementCapacity.totalRegle, detail.devise)}</span>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                  Reste dispo:{" "}
                                  <span className="font-semibold">{formatMoney(reglementCapacity.restant, detail.devise)}</span>
                                </div>
                              </div>
                            ) : null}
                            {reglementLocked ? (
                              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                Zone de saisie verrouillée: plafond de règlement atteint.
                              </div>
                            ) : null}
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                              <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-3 py-2 text-left">Date</th>
                                    <th className="px-3 py-2 text-left">Branche</th>
                                    <th className="px-3 py-2 text-right">Montant</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {reglements.length === 0 ? (
                                    <tr>
                                      <td colSpan={3} className="px-3 py-3 text-center text-xs text-slate-500">
                                        Aucun règlement.
                                      </td>
                                    </tr>
                                  ) : (
                                    reglements.map((reg) => (
                                      <tr key={reg.id} className="border-t border-slate-100">
                                        <td className="px-3 py-2 text-xs text-slate-700">{formatDate(reg.date)}</td>
                                        <td className="px-3 py-2 text-xs text-slate-700">
                                          {reg.branch_s2_code || "—"} - {reg.branch_name || "Branche"}
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs text-slate-700">
                                          {formatMoney(reg.montant, detail.devise)}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>

                            <form onSubmit={createReglement} className="grid gap-2 md:grid-cols-2">
                              <label className="text-xs text-slate-600 md:col-span-2">
                                Ligne de sinistre
                                <select
                                  value={reglementForm.sinistre_ligne_id}
                                  onChange={(e) => setReglementForm((prev) => ({ ...prev, sinistre_ligne_id: e.target.value }))}
                                  disabled={reglementLocked}
                                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                                >
                                  <option value="">Choisir</option>
                                  {detail.lignes?.map((line) => (
                                    <option key={line.id} value={line.id}>
                                      Ligne #{line.id} - {line.branch_s2_code || "—"} {line.branch_name || ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs text-slate-600">
                                Date
                                <input
                                  type="date"
                                  value={reglementForm.date}
                                  onChange={(e) => setReglementForm((prev) => ({ ...prev, date: e.target.value }))}
                                  disabled={reglementLocked}
                                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Montant
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  max={reglementCapacity ? Math.max(Math.floor(reglementCapacity.restant), 0) : undefined}
                                  value={reglementForm.montant}
                                  onChange={(e) => setReglementForm((prev) => ({ ...prev, montant: e.target.value }))}
                                  disabled={reglementLocked}
                                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                                />
                              </label>
                              <div className="md:col-span-2">
                                <button
                                  disabled={reglementLocked}
                                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  Ajouter un règlement
                                </button>
                              </div>
                            </form>
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {reglementModalMessage ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <h4 className="text-sm font-semibold text-slate-900">Montant non autorisé</h4>
              <p className="mt-2 text-sm text-slate-700">{reglementModalMessage}</p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setReglementModalMessage(null)}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Retour
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </RequireAuth>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Chargement…</p>}>
      <SinistresPageContent />
    </Suspense>
  );
}
