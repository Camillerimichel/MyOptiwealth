"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import InfoHint from "@/components/InfoHint";
import { apiRequest } from "@/lib/api";

const SECTION_DEFAULT = "liste";

type Partner = {
  id: number;
  siren: string;
  siret_siege?: string | null;
  raison_sociale: string;
  statut: string;
  code_ape?: string | null;
  adresse_siege?: string | null;
  date_immatriculation?: string | null;
  date_maj?: string | null;
  pays?: string | null;
  region?: string | null;
  conformite_statut?: string | null;
  conformite_notes?: string | null;
  nb_programmes?: number;
  programmes?: string | null;
  clients_contrats?: number;
};

type Insurer = {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  stats?: Record<string, number>;
};

type Programme = {
  id: number;
  ligne_risque: string;
  branch_s2_code?: string | null;
  statut?: string;
};

type PartnerProgrammePairing = {
  partner_id: number;
  programme_id: number;
  is_active: number;
  created_at?: string | null;
  partner_name: string;
  partner_statut: string;
  branch_s2_code?: string | null;
  ligne_risque: string;
  programme_statut: string;
};

type Correspondant = {
  id: number;
  type: "commercial" | "back_office";
  nom: string;
  email: string;
  telephone?: string | null;
  created_at?: string;
};

type Client = {
  id: number;
  nom: string;
  type: "personne_morale" | "personne_physique";
  chiffre_affaires?: number | string | null;
  masse_salariale?: number | string | null;
  partner_id?: number | null;
  partner_name?: string | null;
  partner_siren?: string | null;
  created_at?: string;
};

type Contract = {
  id: number;
  partner_id: number;
  programme_id: number;
  client_id: number;
  statut: string;
  date_debut?: string | null;
  date_fin?: string | null;
  devise?: string | null;
  created_at?: string;
  updated_at?: string;
  partner_name?: string | null;
  partner_siren?: string | null;
  client_nom?: string | null;
  client_chiffre_affaires?: number | string | null;
  client_masse_salariale?: number | string | null;
  ligne_risque?: string | null;
  branch_s2_code?: string | null;
  branch_name?: string | null;
};

type Address = {
  id: number;
  partner_id: number;
  type: "siege" | "facturation" | "correspondance" | "autre";
  ligne1: string;
  ligne2?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  region?: string | null;
  pays?: string | null;
  email?: string | null;
  telephone?: string | null;
  created_at?: string;
};

type Mandataire = {
  id: number;
  partner_id: number;
  nom: string;
  prenom?: string | null;
  role: string;
  email?: string | null;
  telephone?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  created_at?: string;
};

type PartnerDetail = {
  partner: Partner;
  programmes: any[];
  correspondants: any[];
  documents: any[];
  addresses?: Address[];
  mandataires?: Mandataire[];
  contracts: { total_contracts: number; clients_contrats: number };
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function parseOptionalNumber(value: string | number | null | undefined) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function LoadingPopup({
  show,
  title = "Chargement en cours",
  message = "Veuillez patienter, les données sont en cours de récupération.",
}: {
  show: boolean;
  title?: string;
  message?: string;
}) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
          <div>
            <div className="text-sm font-semibold text-slate-800">{title}</div>
            <div className="text-xs text-slate-500">{message}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/\u202f/g, " ");
}

function formatAmountDecimal(value: string | number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const num = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n)
    .replace(/[\u202f\u00a0]/g, " ");
  return currency ? `${num} ${currency}` : num;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function containsPartnerFilter(
  search: unknown,
  partnerName: unknown,
  partnerSiren: unknown,
  partnerId: unknown
) {
  const query = normalizeSearchText(search);
  if (!query) return true;
  const idText = String(partnerId ?? "").trim();
  const haystack = normalizeSearchText(
    [partnerName, partnerSiren, idText, idText ? `#${idText}` : ""]
      .map((value) => String(value ?? ""))
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(query);
}

function containsClientFilter(search: unknown, clientName: unknown, clientId: unknown) {
  const query = normalizeSearchText(search);
  if (!query) return true;
  const idText = String(clientId ?? "").trim();
  const haystack = normalizeSearchText(
    [clientName, idText, idText ? `#${idText}` : ""]
      .map((value) => String(value ?? ""))
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(query);
}

function containsS2Filter(search: unknown, s2Code: unknown) {
  const query = String(search ?? "").trim().toUpperCase();
  if (!query) return true;
  return String(s2Code ?? "").toUpperCase().includes(query);
}

function containsLineFilter(search: unknown, line: unknown) {
  const query = normalizeSearchText(search);
  if (!query) return true;
  return normalizeSearchText(line).includes(query);
}

function SectionHeader({
  title,
  description,
  action,
  help,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  help?: string;
}) {
  const defaultHelp =
    help ||
    `Rôle du bloc : section "${title}" pour piloter et visualiser les données métiers liées aux partenaires.${
      description ? ` ${description}` : ""
    }\n\nLecture : utilisez les vues Création / Visualisation, les filtres et les KPI pour qualifier le périmètre affiché avant de modifier des données.\n\nLeviers : filtres, pagination, mode de vue, et actions de création / appairage / édition selon la section.\n\nAbrégés utiles : GWP = primes brutes émises, S2 = Solvabilité II, RC = responsabilité civile.`;
  return (
    <div className="space-y-3">
      <PageTitle className="w-full" title={title} description={description} titleAddon={<InfoHint text={defaultHelp} />} />
      {action ? <div className="flex justify-end">{action}</div> : null}
    </div>
  );
}

function PartnersPage() {
  const searchParams = useSearchParams();
  const section = searchParams.get("section") || SECTION_DEFAULT;

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [kpi, setKpi] = useState({ total: 0, actifs: 0, anomalies: 0 });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [insurersList, setInsurersList] = useState<Insurer[]>([]);
  const [insurersLoading, setInsurersLoading] = useState(false);
  const [insurersError, setInsurersError] = useState<string | null>(null);
  const [insurersPage, setInsurersPage] = useState(1);
  const [insurersLimit, setInsurersLimit] = useState(25);
  const [insurersTotal, setInsurersTotal] = useState(0);
  const [insurersSearch, setInsurersSearch] = useState("");
  const [insurersSortBy, setInsurersSortBy] = useState<"" | "name">("");
  const [insurersSortDir, setInsurersSortDir] = useState<"asc" | "desc">("asc");
  const [insurerDraft, setInsurerDraft] = useState({ name: "" });
  const [showInsurerModal, setShowInsurerModal] = useState(false);
  const [editingInsurer, setEditingInsurer] = useState<Insurer | null>(null);

  const [newPartner, setNewPartner] = useState({
    siren: "",
    raison_sociale: "",
    statut: "brouillon",
    pays: "FR",
    code_ape: "",
  });


  const [filterQ, setFilterQ] = useState("");
  const [searchPartnerQuery, setSearchPartnerQuery] = useState("");
  const [filterStatut, setFilterStatut] = useState("");
  const [filterProgramme, setFilterProgramme] = useState("");
  const [filterCommercial, setFilterCommercial] = useState("");
  const [filterBackOffice, setFilterBackOffice] = useState("");
  const [filterConformite, setFilterConformite] = useState("");
  const [filterPays, setFilterPays] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [partnersSortBy, setPartnersSortBy] = useState<"" | "raison_sociale" | "siren" | "clients_contrats">("");
  const [partnersSortDir, setPartnersSortDir] = useState<"asc" | "desc">("asc");

  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [correspondants, setCorrespondants] = useState<Correspondant[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [activePartnerBlock, setActivePartnerBlock] = useState<
    "none" | "correspondant" | "programme" | "clientele" | "adresses" | "mandataires" | "documents"
  >("none");
  const activePartnerBlockTopRef = useRef<HTMLDivElement | null>(null);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [editingMandataire, setEditingMandataire] = useState<Mandataire | null>(null);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [savingPartner, setSavingPartner] = useState(false);
  const [assignmentPartnerId, setAssignmentPartnerId] = useState<string>("");
  const [assignmentCorrespondantId, setAssignmentCorrespondantId] = useState<string>("");
  const [assignmentRole, setAssignmentRole] = useState<"commercial" | "back_office">("commercial");
  const [programPartnerId, setProgramPartnerId] = useState<string>("");
  const [programId, setProgramId] = useState<string>("");
  const [programAssignError, setProgramAssignError] = useState<string | null>(null);
  const [assigningProgramme, setAssigningProgramme] = useState(false);
  const [detailContract, setDetailContract] = useState({
    programme_id: "",
    client_id: "",
    statut: "actif",
    date_debut: "",
    date_fin: "",
    devise: "EUR",
  });
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [clientsProgrammeFilter, setClientsProgrammeFilter] = useState("");
  const [clientsRefFilter, setClientsRefFilter] = useState("");
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showContractModal, setShowContractModal] = useState(false);
  const [selectedContractDetail, setSelectedContractDetail] = useState<Contract | null>(null);
  const [contractModalLoading, setContractModalLoading] = useState(false);
  const [contractModalExtra, setContractModalExtra] = useState<any | null>(null);
  const [clientSaveError, setClientSaveError] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [clientModalContracts, setClientModalContracts] = useState<Contract[]>([]);
  const [clientModalContractsLoading, setClientModalContractsLoading] = useState(false);
  const [clientsPage, setClientsPage] = useState(1);
  const [clientsLimit, setClientsLimit] = useState(25);
  const [clientsTotal, setClientsTotal] = useState(0);
  const [clientsStats, setClientsStats] = useState<{
    total: number;
    personnes_morales: number;
    personnes_physiques: number;
    rattaches: number;
    taux_rattachement: number;
  }>({
    total: 0,
    personnes_morales: 0,
    personnes_physiques: 0,
    rattaches: 0,
    taux_rattachement: 0,
  });
  const [clientsPartnerFilter, setClientsPartnerFilter] = useState("");
  const [clientsPartnerQuery, setClientsPartnerQuery] = useState("");
  const [clientsSearch, setClientsSearch] = useState("");
  const [clientsSortBy, setClientsSortBy] = useState<"" | "nom" | "partner" | "chiffre_affaires" | "masse_salariale">("");
  const [clientsSortDir, setClientsSortDir] = useState<"asc" | "desc">("asc");
  const [newClientWithContract, setNewClientWithContract] = useState({
    nom: "",
    type: "personne_morale",
    chiffre_affaires: "",
    masse_salariale: "",
    programme_id: "",
    statut: "actif",
    date_debut: "",
    date_fin: "",
    devise: "EUR",
  });
  const [newClientError, setNewClientError] = useState<string | null>(null);

  const [correspondantsList, setCorrespondantsList] = useState<Correspondant[]>([]);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [detailClients, setDetailClients] = useState<Client[]>([]);
  const [detailClientsPage, setDetailClientsPage] = useState(1);
  const [detailContracts, setDetailContracts] = useState<Contract[]>([]);
  const [contractsList, setContractsList] = useState<Contract[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [partnersView, setPartnersView] = useState<"creation" | "visualisation">("visualisation");
  const [insurersView, setInsurersView] = useState<"creation" | "visualisation">("visualisation");
  const [correspondantsView, setCorrespondantsView] = useState<"creation" | "visualisation">("visualisation");
  const [clientsView, setClientsView] = useState<"creation" | "visualisation">("visualisation");
  const [contractClientView, setContractClientView] = useState<"apparaige" | "visualisation">("visualisation");
  const [contractClientPage, setContractClientPage] = useState(1);
  const [contractClientSearch, setContractClientSearch] = useState("");
  const [contractClientPartnerFilter, setContractClientPartnerFilter] = useState("");
  const [contractClientSearchInput, setContractClientSearchInput] = useState("");
  const [contractClientPartnerInput, setContractClientPartnerInput] = useState("");
  const [contractClientS2Filter, setContractClientS2Filter] = useState("");
  const [contractClientLineFilter, setContractClientLineFilter] = useState("");
  const [contractClientVisualRows, setContractClientVisualRows] = useState<any[]>([]);
  const [contractClientVisualTotal, setContractClientVisualTotal] = useState(0);
  const [contractClientVisualLoading, setContractClientVisualLoading] = useState(false);
  const [selectedContractClientId, setSelectedContractClientId] = useState<string>("");
  const [selectedContractProgrammeIds, setSelectedContractProgrammeIds] = useState<string[]>([]);
  const [contractClientPartnerProgrammes, setContractClientPartnerProgrammes] = useState<PartnerProgrammePairing[]>([]);
  const [contractPairingBusy, setContractPairingBusy] = useState(false);
  const [contractPairingError, setContractPairingError] = useState<string | null>(null);
  const [contractPairingInfo, setContractPairingInfo] = useState<string | null>(null);
  const [partnerProgrammePartnerFilter, setPartnerProgrammePartnerFilter] = useState("");
  const [partnerProgrammeS2Filter, setPartnerProgrammeS2Filter] = useState("");
  const [partnerProgrammeLineFilter, setPartnerProgrammeLineFilter] = useState("");

  const clientsKpi = useMemo(() => {
    return {
      total: clientsStats.total || clientsTotal,
      personnesMorales: clientsStats.personnes_morales || 0,
      personnesPhysiques: clientsStats.personnes_physiques || 0,
      rattaches: clientsStats.rattaches || 0,
      tauxRattachement: clientsStats.taux_rattachement || 0,
    };
  }, [clientsStats, clientsTotal]);
  const [partnerProgrammeLinks, setPartnerProgrammeLinks] = useState<PartnerProgrammePairing[]>([]);
  const [partnerProgrammeView, setPartnerProgrammeView] = useState<"apparaige" | "visualisation">("visualisation");
  const [partnerProgrammePage, setPartnerProgrammePage] = useState(1);
  const [partnerProgrammeVisualRows, setPartnerProgrammeVisualRows] = useState<PartnerProgrammePairing[]>([]);
  const [partnerProgrammeVisualTotal, setPartnerProgrammeVisualTotal] = useState(0);
  const [partnerProgrammeVisualLoading, setPartnerProgrammeVisualLoading] = useState(false);
  const [documentsView, setDocumentsView] = useState<"creation" | "visualisation">("visualisation");
  const [selectedPairPartnerId, setSelectedPairPartnerId] = useState<string>("");
  const [selectedPairProgrammeIds, setSelectedPairProgrammeIds] = useState<string[]>([]);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingInfo, setPairingInfo] = useState<string | null>(null);
  const contractListTopRef = useRef<HTMLDivElement | null>(null);

  const [docsPartners, setDocsPartners] = useState<Partner[]>([]);
  const [docsPartnerId, setDocsPartnerId] = useState<string>("");
  const [documentsList, setDocumentsList] = useState<any[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [detailDocuments, setDetailDocuments] = useState<any[]>([]);
  const [detailDocumentsLoading, setDetailDocumentsLoading] = useState(false);
  const [newDocument, setNewDocument] = useState({
    doc_type: "KBIS",
    file_name: "",
    status: "valide",
    expiry_date: "",
    storage_provider: "",
    storage_ref: "",
    file_base64: "",
  });

  const [newCorrespondant, setNewCorrespondant] = useState({
    type: "commercial",
    nom: "",
    email: "",
    telephone: "",
  });
  const [showCorrespondantModal, setShowCorrespondantModal] = useState(false);
  const [editingCorrespondant, setEditingCorrespondant] = useState<Correspondant | null>(null);
  const [newClient, setNewClient] = useState({
    nom: "",
    type: "personne_morale",
    partner_id: "",
    chiffre_affaires: "",
    masse_salariale: "",
  });

  const pagination = useMemo(() => {
    const pages = Math.max(1, Math.ceil(total / limit));
    return { pages };
  }, [total, limit]);

  const detailProgrammeOptions = useMemo(() => {
    const clientIds = new Set(detailClients.map((c) => Number(c.id)));
    const programmeIds = Array.from(
      new Set(
        detailContracts
          .filter((contract) => clientIds.has(Number(contract.client_id)))
          .map((contract) => Number(contract.programme_id))
      )
    );
    return programmeIds
      .map((id) => {
        const programme = programmes.find((p) => Number(p.id) === id);
        return { id, label: programme?.ligne_risque || `#${id}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
  }, [detailClients, detailContracts, programmes]);

  const filteredDetailClients = useMemo(() => {
    return detailClients.filter((client) => {
      const ref = String(client.nom || "").toLowerCase();
      const query = clientsRefFilter.trim().toLowerCase();
      if (query && !ref.includes(query)) return false;
      if (!clientsProgrammeFilter) return true;
      return detailContracts.some(
        (contract) =>
          Number(contract.client_id) === Number(client.id) &&
          String(contract.programme_id) === clientsProgrammeFilter
      );
    });
  }, [detailClients, detailContracts, clientsProgrammeFilter, clientsRefFilter]);

  const detailClientsPagination = useMemo(() => {
    const pageSize = 25;
    const totalItems = filteredDetailClients.length;
    const pages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(1, detailClientsPage), pages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return { pageSize, totalItems, pages, currentPage, start, end };
  }, [filteredDetailClients.length, detailClientsPage]);

  const paginatedDetailClients = useMemo(() => {
    return filteredDetailClients.slice(detailClientsPagination.start, detailClientsPagination.end);
  }, [filteredDetailClients, detailClientsPagination.start, detailClientsPagination.end]);

  const detailContractSummary = useMemo(() => {
    const total = detailContracts.length;
    const activeContracts = detailContracts.filter((contract) => contract.statut === "actif");
    const activeClients = new Set(activeContracts.map((contract) => Number(contract.client_id))).size;
    const inactiveContracts = Math.max(total - activeContracts.length, 0);
    return { total, activeContracts: activeContracts.length, inactiveContracts, activeClients };
  }, [detailContracts]);

  const filteredPairPartners = useMemo(() => {
    return [...partners]
      .filter((partner) => {
        return containsPartnerFilter(
          partnerProgrammePartnerFilter,
          partner.raison_sociale,
          partner.siren,
          partner.id
        );
      })
      .sort((a, b) => String(a.raison_sociale || "").localeCompare(String(b.raison_sociale || ""), "fr", { sensitivity: "base" }));
  }, [partners, partnerProgrammePartnerFilter]);

  const filteredPairProgrammes = useMemo(() => {
    return [...programmes]
      .filter((programme) => {
        if (!containsS2Filter(partnerProgrammeS2Filter, programme.branch_s2_code)) return false;
        if (!containsLineFilter(partnerProgrammeLineFilter, programme.ligne_risque)) return false;
        return true;
      })
      .sort((a, b) => String(a.ligne_risque || "").localeCompare(String(b.ligne_risque || ""), "fr", { sensitivity: "base" }));
  }, [programmes, partnerProgrammeS2Filter, partnerProgrammeLineFilter]);

  const filteredPartnerProgrammeLinks = useMemo(() => {
    const partnersById = new Map(partners.map((partner) => [Number(partner.id), partner]));
    return partnerProgrammeLinks.filter((link) => {
      const partner = partnersById.get(Number(link.partner_id));
      const matchPartner = containsPartnerFilter(
        partnerProgrammePartnerFilter,
        link.partner_name || partner?.raison_sociale,
        partner?.siren,
        link.partner_id
      );
      const matchS2 = containsS2Filter(partnerProgrammeS2Filter, link.branch_s2_code);
      const matchLine = containsLineFilter(partnerProgrammeLineFilter, link.ligne_risque);
      return matchPartner && matchS2 && matchLine;
    });
  }, [
    partnerProgrammeLinks,
    partners,
    partnerProgrammePartnerFilter,
    partnerProgrammeS2Filter,
    partnerProgrammeLineFilter,
  ]);

  const partnerProgrammeS2Options = useMemo(() => {
    const values = new Set<string>();
    for (const link of partnerProgrammeLinks) {
      const code = String(link.branch_s2_code || "").trim().toUpperCase();
      if (code) values.add(code);
    }
    for (const programme of programmes) {
      const code = String(programme.branch_s2_code || "").trim().toUpperCase();
      if (code) values.add(code);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "fr"));
  }, [partnerProgrammeLinks, programmes]);

  const partnerProgrammeLineOptions = useMemo(() => {
    const values = new Set<string>();
    for (const link of partnerProgrammeLinks) {
      const line = String(link.ligne_risque || "").trim();
      if (line) values.add(line);
    }
    for (const programme of programmes) {
      const line = String(programme.ligne_risque || "").trim();
      if (line) values.add(line);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  }, [partnerProgrammeLinks, programmes]);

  const contractClientVisualKpis = useMemo(() => {
    const rows = contractClientVisualRows || [];
    const active = rows.filter((r) => String(r.statut || "").toLowerCase() === "actif").length;
    const uniquePartners = new Set(rows.map((r) => Number(r.partner_id || 0)).filter(Boolean)).size;
    const uniqueClients = new Set(rows.map((r) => Number(r.client_id || 0)).filter(Boolean)).size;
    return {
      total: contractClientVisualTotal,
      pageCount: rows.length,
      active,
      uniquePartners,
      uniqueClients,
    };
  }, [contractClientVisualRows, contractClientVisualTotal]);

  const partnerProgrammeVisualKpis = useMemo(() => {
    const rows = partnerProgrammeVisualRows || [];
    const activeLinks = rows.filter((r) => Number(r.is_active ?? 1) === 1).length;
    const uniquePartners = new Set(rows.map((r) => Number(r.partner_id || 0)).filter(Boolean)).size;
    const uniqueProgrammes = new Set(rows.map((r) => Number(r.programme_id || 0)).filter(Boolean)).size;
    return {
      total: partnerProgrammeVisualTotal,
      pageCount: rows.length,
      activeLinks,
      uniquePartners,
      uniqueProgrammes,
    };
  }, [partnerProgrammeVisualRows, partnerProgrammeVisualTotal]);

  const documentsKpis = useMemo(() => {
    const rows = documentsList || [];
    const valides = rows.filter((d) => String(d.status || "").toLowerCase() === "valide").length;
    const expires = rows.filter((d) => String(d.status || "").toLowerCase() === "expire").length;
    const manquants = rows.filter((d) => String(d.status || "").toLowerCase() === "manquant").length;
    const typed = new Set(rows.map((d) => String(d.doc_type || "").trim()).filter(Boolean)).size;
    return {
      selectedPartner: docsPartnerId ? 1 : 0,
      total: rows.length,
      valides,
      expires,
      manquants,
      typed,
    };
  }, [documentsList, docsPartnerId]);

  const selectedPairExistingProgrammeIds = useMemo(() => {
    if (!selectedPairPartnerId) return new Set<string>();
    return new Set(
      partnerProgrammeLinks
        .filter((link) => String(link.partner_id) === selectedPairPartnerId)
        .map((link) => String(link.programme_id))
    );
  }, [partnerProgrammeLinks, selectedPairPartnerId]);

  const selectedPairCreatableIds = useMemo(
    () => selectedPairProgrammeIds.filter((programmeId) => !selectedPairExistingProgrammeIds.has(programmeId)),
    [selectedPairProgrammeIds, selectedPairExistingProgrammeIds]
  );

  const selectedContractClient = useMemo(
    () => clientsList.find((client) => String(client.id) === selectedContractClientId) || null,
    [clientsList, selectedContractClientId]
  );

  const eligibleContractClientPartnerIds = useMemo(() => {
    return new Set(
      contractClientPartnerProgrammes
        .filter((link) => Number(link.is_active ?? 1) === 1)
        .map((link) => Number(link.partner_id))
    );
  }, [contractClientPartnerProgrammes]);

  const filteredContractClients = useMemo(() => {
    const partnersById = new Map(partners.map((partner) => [Number(partner.id), partner]));
    const clientQuery = contractClientSearch.trim().toLowerCase();
    const partnerQuery = contractClientPartnerFilter.trim().toLowerCase();
    return [...clientsList]
      .filter((client) => {
        const partnerId = Number(client.partner_id || 0);
        if (!partnerId || !eligibleContractClientPartnerIds.has(partnerId)) return false;
        const partner = partnersById.get(partnerId);
        const partnerName = String(client.partner_name || partner?.raison_sociale || "").toLowerCase();
        const partnerSiren = String(client.partner_siren || partner?.siren || "").toLowerCase();
        const partnerIdText = String(partnerId);
        const clientName = String(client.nom || "").toLowerCase();
        const clientIdText = String(client.id || "");
        const matchPartner =
          !partnerQuery ||
          partnerName.includes(partnerQuery) ||
          partnerSiren.includes(partnerQuery) ||
          partnerIdText.includes(partnerQuery) ||
          (`#${partnerIdText}`).includes(partnerQuery);
        const matchClient =
          !clientQuery ||
          clientName.includes(clientQuery) ||
          clientIdText.includes(clientQuery) ||
          (`#${clientIdText}`).includes(clientQuery);
        return matchPartner && matchClient;
      })
      .sort((a, b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity: "base" }));
  }, [
    clientsList,
    contractClientSearch,
    contractClientPartnerFilter,
    eligibleContractClientPartnerIds,
    partners,
  ]);

  const filteredContractProgrammes = useMemo(() => {
    const selectedPartnerId = Number(selectedContractClient?.partner_id || 0);
    const allowedProgrammeIds =
      selectedPartnerId > 0
        ? new Set(
            contractClientPartnerProgrammes
              .filter(
                (link) =>
                  Number(link.partner_id) === selectedPartnerId &&
                  Number(link.is_active ?? 1) === 1
              )
              .map((link) => Number(link.programme_id))
          )
        : null;
    return [...programmes]
      .filter((programme) => {
        if (allowedProgrammeIds && !allowedProgrammeIds.has(Number(programme.id))) return false;
        if (!containsS2Filter(contractClientS2Filter, programme.branch_s2_code)) return false;
        if (!containsLineFilter(contractClientLineFilter, programme.ligne_risque)) return false;
        return true;
      })
      .sort((a, b) => String(a.ligne_risque || "").localeCompare(String(b.ligne_risque || ""), "fr", { sensitivity: "base" }));
  }, [
    programmes,
    contractClientS2Filter,
    contractClientLineFilter,
    selectedContractClient?.partner_id,
    contractClientPartnerProgrammes,
  ]);

  const selectedContractExistingProgrammeIds = useMemo(() => {
    if (!selectedContractClientId) return new Set<string>();
    return new Set(
      contractsList
        .filter((contract) => String(contract.client_id) === selectedContractClientId)
        .map((contract) => String(contract.programme_id))
    );
  }, [contractsList, selectedContractClientId]);

  const selectedContractCreatableIds = useMemo(
    () => selectedContractProgrammeIds.filter((programmeId) => !selectedContractExistingProgrammeIds.has(programmeId)),
    [selectedContractProgrammeIds, selectedContractExistingProgrammeIds]
  );

  const filteredContractsForView = useMemo(() => {
    const clientsById = new Map(clientsList.map((client) => [Number(client.id), client]));
    const programmesById = new Map(programmes.map((programme) => [Number(programme.id), programme]));
    const partnersById = new Map(partners.map((partner) => [Number(partner.id), partner]));
    const clientQuery = contractClientSearch.trim().toLowerCase();
    const partnerQuery = contractClientPartnerFilter.trim().toLowerCase();
    return contractsList.filter((contract) => {
      const client = clientsById.get(Number(contract.client_id));
      const programme = programmesById.get(Number(contract.programme_id));
    const partner = partnersById.get(Number(contract.partner_id));
    const partnerName = String(client?.partner_name || partner?.raison_sociale || "").toLowerCase();
    const partnerSiren = String(client?.partner_siren || partner?.siren || "").toLowerCase();
    const partnerIdText = String(contract.partner_id || "");
    const clientName = String(client?.nom || "").toLowerCase();
    const clientIdText = String(client?.id || contract.client_id || "");
    const matchPartner =
      !partnerQuery ||
      partnerName.includes(partnerQuery) ||
      partnerSiren.includes(partnerQuery) ||
      partnerIdText.includes(partnerQuery) ||
      (`#${partnerIdText}`).includes(partnerQuery);
    const matchClient =
      !clientQuery ||
      clientName.includes(clientQuery) ||
      clientIdText.includes(clientQuery) ||
      (`#${clientIdText}`).includes(clientQuery);
    const matchS2 = containsS2Filter(contractClientS2Filter, programme?.branch_s2_code);
    const matchLine = containsLineFilter(contractClientLineFilter, programme?.ligne_risque);
    return matchPartner && matchClient && matchS2 && matchLine;
  });
  }, [
    contractsList,
    clientsList,
    programmes,
    partners,
    contractClientSearch,
    contractClientPartnerFilter,
    contractClientS2Filter,
    contractClientLineFilter,
  ]);

  const contractS2Options = useMemo(() => {
    const seen = new Set<string>();
    const options: { code: string; label: string }[] = [];
    const clientsById = new Map(clientsList.map((client) => [Number(client.id), client]));
    const programmesById = new Map(programmes.map((programme) => [Number(programme.id), programme]));
    const partnersById = new Map(partners.map((partner) => [Number(partner.id), partner]));
    const clientQuery = contractClientSearch.trim().toLowerCase();
    const partnerQuery = contractClientPartnerFilter.trim().toLowerCase();

    for (const contract of contractsList) {
      const client = clientsById.get(Number(contract.client_id));
      const partner = partnersById.get(Number(contract.partner_id));
      const programme = programmesById.get(Number(contract.programme_id));
      if (!programme) continue;

      const partnerName = String(client?.partner_name || partner?.raison_sociale || "").toLowerCase();
      const partnerSiren = String(client?.partner_siren || partner?.siren || "").toLowerCase();
      const partnerIdText = String(contract.partner_id || "");
      const clientName = String(client?.nom || "").toLowerCase();
      const clientIdText = String(client?.id || contract.client_id || "");
      const matchPartner =
        !partnerQuery ||
        partnerName.includes(partnerQuery) ||
        partnerSiren.includes(partnerQuery) ||
        partnerIdText.includes(partnerQuery) ||
        (`#${partnerIdText}`).includes(partnerQuery);
      const matchClient =
        !clientQuery ||
        clientName.includes(clientQuery) ||
        clientIdText.includes(clientQuery) ||
        (`#${clientIdText}`).includes(clientQuery);
      const matchLine = containsLineFilter(contractClientLineFilter, programme.ligne_risque);
      if (!(matchPartner && matchClient && matchLine)) continue;

      const s2 = String(programme.branch_s2_code || "").trim().toUpperCase();
      if (!s2 || seen.has(s2)) continue;
      seen.add(s2);
      options.push({ code: s2, label: programme.ligne_risque || s2 });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
  }, [
    contractsList,
    clientsList,
    partners,
    programmes,
    contractClientSearch,
    contractClientPartnerFilter,
    contractClientLineFilter,
  ]);

  const contractClientPagination = useMemo(() => {
    const pageSize = 25;
    const totalItems = filteredContractsForView.length;
    const pages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(1, contractClientPage), pages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return { pageSize, totalItems, pages, currentPage, start, end };
  }, [filteredContractsForView.length, contractClientPage]);

  const paginatedContractsForView = useMemo(() => {
    return filteredContractsForView.slice(contractClientPagination.start, contractClientPagination.end);
  }, [filteredContractsForView, contractClientPagination.start, contractClientPagination.end]);

  const eligibleContractClientsCount = useMemo(() => {
    return clientsList.filter((client) => {
      const partnerId = Number(client.partner_id || 0);
      return !!partnerId && eligibleContractClientPartnerIds.has(partnerId);
    }).length;
  }, [clientsList, eligibleContractClientPartnerIds]);

  const applyContractFilters = () => {
    setContractClientPage(1);
    setContractClientSearch(contractClientSearchInput);
    setContractClientPartnerFilter(contractClientPartnerInput);
    setReloadKey((k) => k + 1);
    if (contractListTopRef.current) {
      contractListTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    let ignore = false;
    async function loadOptions() {
      try {
        const res = await apiRequest<Paginated<Programme>>("/api/programmes?page=1&limit=1000");
        if (!ignore) setProgrammes(res.data || []);
      } catch {
        if (!ignore) setProgrammes([]);
      }
      try {
        const res = await apiRequest<Paginated<Correspondant>>("/api/partners/correspondants?page=1&limit=1000");
        if (!ignore) setCorrespondants(res.data || []);
      } catch {
        if (!ignore) setCorrespondants([]);
      }
    }
    loadOptions();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (section !== "liste") return;
    let ignore = false;
    async function loadPartners() {
      setLoadingPartners(true);
      setPartnersError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(limit));
        if (filterQ) params.set("q", filterQ);
        if (filterStatut) params.set("statut", filterStatut);
        if (filterProgramme) params.set("programme_id", filterProgramme);
        if (filterCommercial) params.set("commercial_id", filterCommercial);
        if (filterBackOffice) params.set("back_office_id", filterBackOffice);
        if (filterConformite) params.set("conformite_statut", filterConformite);
        if (filterPays) params.set("pays", filterPays);
        if (filterRegion) params.set("region", filterRegion);
        if (partnersSortBy) {
          params.set("sort_by", partnersSortBy);
          params.set("sort_dir", partnersSortDir);
        }
        const res = await apiRequest<Paginated<Partner>>(`/api/partners?${params.toString()}`);
        if (!ignore) {
          const items = res.data || [];
          setPartners(items);
          const computedTotal = res.pagination?.total || res.stats?.total || 0;
          setTotal(computedTotal);
          setKpi({
            total: computedTotal,
            actifs: res.stats?.actifs ?? items.filter((p) => p.statut === "actif").length,
            anomalies:
              res.stats?.anomalies ?? items.filter((p) => p.conformite_statut === "anomalie").length,
          });
        }
      } catch (err: any) {
        if (!ignore) {
          setPartnersError(err?.message || "Erreur chargement partenaires");
          setPartners([]);
          setTotal(0);
        }
      } finally {
        if (!ignore) setLoadingPartners(false);
      }
    }
    loadPartners();
    return () => {
      ignore = true;
    };
  }, [
    section,
    page,
    limit,
    filterQ,
    filterStatut,
    filterProgramme,
    filterCommercial,
    filterBackOffice,
    filterConformite,
    filterPays,
    filterRegion,
    partnersSortBy,
    partnersSortDir,
    reloadKey,
  ]);

  useEffect(() => {
    if (!selectedPartnerId) {
      setDetail(null);
      return;
    }
    let ignore = false;
    async function loadDetail() {
      setLoadingDetail(true);
      try {
        const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
        if (!ignore) {
          setDetail(res);
          setEditingPartner(res.partner);
          setAssignmentPartnerId(String(res.partner.id));
          setProgramPartnerId(String(res.partner.id));
        }
      } catch {
        if (!ignore) setDetail(null);
      } finally {
        if (!ignore) setLoadingDetail(false);
      }
    }
    loadDetail();
    return () => {
      ignore = true;
    };
  }, [selectedPartnerId]);

  useEffect(() => {
    if (section !== "liste" || !selectedPartnerId) return;
    let ignore = false;
    async function loadDetailContracts() {
      try {
        const res = await apiRequest<Paginated<Contract>>(`/api/partners/contracts?page=1&limit=200&partner_id=${selectedPartnerId}`);
        if (!ignore) setDetailContracts(res.data || []);
      } catch {
        if (!ignore) setDetailContracts([]);
      }
    }
    loadDetailContracts();
    return () => {
      ignore = true;
    };
  }, [section, selectedPartnerId, reloadKey]);

  useEffect(() => {
    if (section !== "liste" || !selectedPartnerId) return;
    let ignore = false;
    async function loadDetailClients() {
      try {
        const batchSize = 100;
        let currentPage = 1;
        let totalItems = 0;
        const allClients: Client[] = [];
        while (true) {
          const res = await apiRequest<Paginated<Client>>(
            `/api/partners/clients?page=${currentPage}&limit=${batchSize}&partner_id=${selectedPartnerId}`
          );
          const chunk = res.data || [];
          allClients.push(...chunk);
          totalItems = Number(res.pagination?.total || chunk.length || 0);
          if (!chunk.length || allClients.length >= totalItems) break;
          currentPage += 1;
        }
        if (!ignore) setDetailClients(allClients);
      } catch {
        if (!ignore) setDetailClients([]);
      }
    }
    loadDetailClients();
    return () => {
      ignore = true;
    };
  }, [section, selectedPartnerId, reloadKey]);

  useEffect(() => {
    if (!showPartnerModal || !selectedPartnerId) return;
    setClientsProgrammeFilter("");
    setClientsRefFilter("");
    setDetailClientsPage(1);
    setActivePartnerBlock("none");
    setEditingAddress(null);
    setEditingMandataire(null);
  }, [showPartnerModal, selectedPartnerId]);

  useEffect(() => {
    if (!clientsProgrammeFilter) return;
    const exists = detailProgrammeOptions.some((option) => String(option.id) === clientsProgrammeFilter);
    if (!exists) {
      setClientsProgrammeFilter("");
      setDetailClientsPage(1);
    }
  }, [clientsProgrammeFilter, detailProgrammeOptions]);

  useEffect(() => {
    if (!showPartnerModal) return;
    const maxPage = Math.max(1, Math.ceil(filteredDetailClients.length / 25));
    if (detailClientsPage > maxPage) setDetailClientsPage(maxPage);
  }, [showPartnerModal, filteredDetailClients.length, detailClientsPage]);

  useEffect(() => {
    if (!showPartnerModal || activePartnerBlock === "none") return;
    const timer = window.setTimeout(() => {
      activePartnerBlockTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showPartnerModal, activePartnerBlock]);

  useEffect(() => {
    if (section !== "correspondants") return;
    let ignore = false;
    async function loadCorrespondants() {
      setListLoading(true);
      try {
        const res = await apiRequest<Paginated<Correspondant>>("/api/partners/correspondants?page=1&limit=200");
        if (!ignore) setCorrespondantsList(res.data || []);
      } catch {
        if (!ignore) setCorrespondantsList([]);
      } finally {
        if (!ignore) setListLoading(false);
      }
    }
    loadCorrespondants();
    return () => {
      ignore = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "clients") return;
    let ignore = false;
    async function loadClients() {
      setListLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(clientsPage));
        params.set("limit", String(clientsLimit));
        if (clientsPartnerQuery.trim()) params.set("partner_q", clientsPartnerQuery.trim());
        if (clientsSearch) params.set("q", clientsSearch);
        if (clientsSortBy) {
          params.set("sort_by", clientsSortBy);
          params.set("sort_dir", clientsSortDir);
        }
        const [clientsRes, partnersRes] = await Promise.all([
          apiRequest<Paginated<Client>>(`/api/partners/clients?${params.toString()}`),
          apiRequest<Paginated<Partner>>("/api/partners?page=1&limit=1000"),
        ]);
        if (!ignore) {
          setClientsList(clientsRes.data || []);
          setClientsTotal(clientsRes.pagination?.total || 0);
          setClientsStats({
            total: Number(clientsRes.stats?.total || clientsRes.pagination?.total || 0),
            personnes_morales: Number(clientsRes.stats?.personnes_morales || 0),
            personnes_physiques: Number(clientsRes.stats?.personnes_physiques || 0),
            rattaches: Number(clientsRes.stats?.rattaches || 0),
            taux_rattachement: Number(clientsRes.stats?.taux_rattachement || 0),
          });
          setPartners(partnersRes.data || []);
        }
      } catch {
        if (!ignore) {
          setClientsList([]);
          setClientsTotal(0);
          setClientsStats({
            total: 0,
            personnes_morales: 0,
            personnes_physiques: 0,
            rattaches: 0,
            taux_rattachement: 0,
          });
          setPartners([]);
        }
      } finally {
        if (!ignore) setListLoading(false);
      }
    }
    loadClients();
    return () => {
      ignore = true;
    };
  }, [section, clientsPage, clientsLimit, clientsPartnerQuery, clientsSearch, clientsSortBy, clientsSortDir]);

  useEffect(() => {
    if (section !== "assureurs") return;
    let ignore = false;
    async function loadInsurers() {
      setInsurersLoading(true);
      setInsurersError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(insurersPage));
        params.set("limit", String(insurersLimit));
        if (insurersSearch.trim()) params.set("q", insurersSearch.trim());
        if (insurersSortBy) {
          params.set("sort_by", insurersSortBy);
          params.set("sort_dir", insurersSortDir);
        }
        const res = await apiRequest<Paginated<Insurer>>(`/api/partners/insurers?${params.toString()}`);
        if (!ignore) {
          setInsurersList(res.data || []);
          setInsurersTotal(res.pagination?.total || 0);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setInsurersList([]);
          setInsurersTotal(0);
          setInsurersError(errorMessage(err, "Erreur de chargement des assureurs."));
        }
      } finally {
        if (!ignore) setInsurersLoading(false);
      }
    }
    loadInsurers();
    return () => {
      ignore = true;
    };
  }, [section, insurersPage, insurersLimit, insurersSearch, insurersSortBy, insurersSortDir, reloadKey]);

  useEffect(() => {
    if (!showClientModal || !editingClient?.id) {
      setClientModalContracts([]);
      setClientModalContractsLoading(false);
      return;
    }
    const clientId = editingClient.id;
    let ignore = false;
    async function loadClientContracts() {
      setClientModalContractsLoading(true);
      try {
        const res = await apiRequest<Paginated<Contract>>(
          `/api/partners/contracts?page=1&limit=200&client_id=${clientId}`
        );
        if (!ignore) setClientModalContracts(res.data || []);
      } catch {
        if (!ignore) setClientModalContracts([]);
      } finally {
        if (!ignore) setClientModalContractsLoading(false);
      }
    }
    loadClientContracts();
    return () => {
      ignore = true;
    };
  }, [showClientModal, editingClient?.id]);

  useEffect(() => {
    const contractId = selectedContractDetail?.id;
    if (!showContractModal || !contractId) {
      setContractModalExtra(null);
      setContractModalLoading(false);
      return;
    }
    let ignore = false;
    async function loadContractDetail() {
      setContractModalLoading(true);
      try {
        const res = await apiRequest<any>(`/api/partners/contracts/${contractId}/details`);
        if (!ignore) {
          if (res?.contract) setSelectedContractDetail(res.contract);
          setContractModalExtra(res || null);
        }
      } catch {
        if (!ignore) setContractModalExtra(null);
      } finally {
        if (!ignore) setContractModalLoading(false);
      }
    }
    loadContractDetail();
    return () => {
      ignore = true;
    };
  }, [showContractModal, selectedContractDetail?.id]);

  useEffect(() => {
    if (section !== "contrats" || contractClientView !== "apparaige") return;
    let ignore = false;
    async function fetchAllPages<T>(basePath: string, pageSize: number): Promise<T[]> {
      const all: T[] = [];
      let currentPage = 1;
      let totalItems = 0;
      while (true) {
        const separator = basePath.includes("?") ? "&" : "?";
        const res = await apiRequest<Paginated<T>>(
          `${basePath}${separator}page=${currentPage}&limit=${pageSize}`
        );
        const chunk = res.data || [];
        all.push(...chunk);
        totalItems = Number(res.pagination?.total || chunk.length || 0);
        if (!chunk.length || all.length >= totalItems) break;
        currentPage += 1;
      }
      return all;
    }
    async function loadContracts() {
      setListLoading(true);
      try {
        const [allContracts, allPartners, allClients, allLinks] = await Promise.all([
          fetchAllPages<Contract>("/api/partners/contracts", 10000),
          fetchAllPages<Partner>("/api/partners", 10000),
          fetchAllPages<Client>("/api/partners/clients", 10000),
          fetchAllPages<PartnerProgrammePairing>("/api/partners/partner-programmes", 10000),
        ]);
        if (!ignore) {
          setContractsList(allContracts);
          setPartners(allPartners);
          setClientsList(allClients);
          setContractClientPartnerProgrammes(allLinks);
        }
      } catch {
        if (!ignore) {
          setContractsList([]);
          setPartners([]);
          setClientsList([]);
          setContractClientPartnerProgrammes([]);
        }
      } finally {
        if (!ignore) setListLoading(false);
      }
    }
    loadContracts();
    return () => {
      ignore = true;
    };
  }, [section, contractClientView, reloadKey]);

  useEffect(() => {
    if (section !== "contrats" || contractClientView !== "visualisation") return;
    let ignore = false;
    async function loadContractsVisualPage() {
      setContractClientVisualLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(contractClientPage));
        params.set("limit", "25");
        if (contractClientPartnerFilter.trim()) params.set("partner_q", contractClientPartnerFilter.trim());
        if (contractClientSearch.trim()) params.set("client_q", contractClientSearch.trim());
        if (contractClientS2Filter.trim()) params.set("s2_code", contractClientS2Filter.trim());
        if (contractClientLineFilter.trim()) params.set("ligne", contractClientLineFilter.trim());
        const res = await apiRequest<Paginated<any>>(`/api/partners/contracts?${params.toString()}`);
        if (!ignore) {
          setContractClientVisualRows(res.data || []);
          setContractClientVisualTotal(Number(res.pagination?.total || 0));
        }
      } catch {
        if (!ignore) {
          setContractClientVisualRows([]);
          setContractClientVisualTotal(0);
        }
      } finally {
        if (!ignore) setContractClientVisualLoading(false);
      }
    }
    loadContractsVisualPage();
    return () => {
      ignore = true;
    };
  }, [
    section,
    contractClientView,
    contractClientPage,
    contractClientSearch,
    contractClientPartnerFilter,
    contractClientS2Filter,
    contractClientLineFilter,
    reloadKey,
  ]);

  useEffect(() => {
    if (section !== "contrats-partenaires" || partnerProgrammeView !== "apparaige") return;
    let ignore = false;
    async function loadPartnerProgrammeLinks() {
      setListLoading(true);
      try {
        const [linksRes, partnersRes, programmesRes] = await Promise.all([
          apiRequest<Paginated<PartnerProgrammePairing>>("/api/partners/partner-programmes?page=1&limit=1000"),
          apiRequest<Paginated<Partner>>("/api/partners?page=1&limit=1000"),
          apiRequest<Paginated<Programme>>("/api/programmes?page=1&limit=1000"),
        ]);
        if (!ignore) {
          setPartnerProgrammeLinks(linksRes.data || []);
          setPartners(partnersRes.data || []);
          setProgrammes(programmesRes.data || []);
        }
      } catch {
        if (!ignore) {
          setPartnerProgrammeLinks([]);
          setPartners([]);
        }
      } finally {
        if (!ignore) setListLoading(false);
      }
    }
    loadPartnerProgrammeLinks();
    return () => {
      ignore = true;
    };
  }, [section, partnerProgrammeView, reloadKey]);

  useEffect(() => {
    if (section !== "contrats-partenaires" || partnerProgrammeView !== "visualisation") return;
    let ignore = false;
    async function loadPartnerProgrammeLinksVisual() {
      setPartnerProgrammeVisualLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(partnerProgrammePage));
        params.set("limit", "25");
        if (partnerProgrammePartnerFilter.trim()) params.set("partner_q", partnerProgrammePartnerFilter.trim());
        if (partnerProgrammeS2Filter.trim()) params.set("s2_code", partnerProgrammeS2Filter.trim());
        if (partnerProgrammeLineFilter.trim()) params.set("ligne", partnerProgrammeLineFilter.trim());
        const res = await apiRequest<Paginated<PartnerProgrammePairing>>(
          `/api/partners/partner-programmes?${params.toString()}`
        );
        if (!ignore) {
          setPartnerProgrammeVisualRows(res.data || []);
          setPartnerProgrammeVisualTotal(Number(res.pagination?.total || 0));
        }
      } catch {
        if (!ignore) {
          setPartnerProgrammeVisualRows([]);
          setPartnerProgrammeVisualTotal(0);
        }
      } finally {
        if (!ignore) setPartnerProgrammeVisualLoading(false);
      }
    }
    loadPartnerProgrammeLinksVisual();
    return () => {
      ignore = true;
    };
  }, [
    section,
    partnerProgrammeView,
    partnerProgrammePage,
    partnerProgrammePartnerFilter,
    partnerProgrammeS2Filter,
    partnerProgrammeLineFilter,
    reloadKey,
  ]);

  useEffect(() => {
    if (section !== "contrats-partenaires") return;
    setPartnerProgrammeView("visualisation");
  }, [section]);

  useEffect(() => {
    if (section !== "liste") return;
    setPartnersView("visualisation");
  }, [section]);

  useEffect(() => {
    if (section !== "assureurs") return;
    setInsurersView("visualisation");
  }, [section]);

  useEffect(() => {
    if (section !== "correspondants") return;
    setCorrespondantsView("visualisation");
  }, [section]);

  useEffect(() => {
    if (section !== "clients") return;
    setClientsView("visualisation");
  }, [section]);

  useEffect(() => {
    if (section !== "contrats") return;
    setContractClientView("visualisation");
    setContractClientPage(1);
    setContractClientSearchInput(contractClientSearch);
    setContractClientPartnerInput(contractClientPartnerFilter);
  }, [section]);

  useEffect(() => {
    if (section !== "contrats" || contractClientView !== "apparaige") return;
    const maxPage = Math.max(1, Math.ceil(filteredContractsForView.length / 25));
    if (contractClientPage > maxPage) setContractClientPage(maxPage);
  }, [section, contractClientView, filteredContractsForView.length, contractClientPage]);

  useEffect(() => {
    setPartnerProgrammePage(1);
  }, [partnerProgrammePartnerFilter, partnerProgrammeS2Filter, partnerProgrammeLineFilter, partnerProgrammeView]);

  useEffect(() => {
    if (!contractClientS2Filter) return;
    if (!contractS2Options.some((opt) => opt.code === contractClientS2Filter)) {
      setContractClientS2Filter("");
    }
  }, [contractClientS2Filter, contractS2Options]);

  useEffect(() => {
    setSelectedContractProgrammeIds([]);
    setContractPairingError(null);
    setContractPairingInfo(null);
  }, [selectedContractClientId]);

  useEffect(() => {
    if (!selectedContractClientId) return;
    const stillVisible = filteredContractClients.some((client) => String(client.id) === selectedContractClientId);
    if (!stillVisible) setSelectedContractClientId("");
  }, [filteredContractClients, selectedContractClientId]);

  useEffect(() => {
    setSelectedPairProgrammeIds([]);
    setPairingError(null);
    setPairingInfo(null);
  }, [selectedPairPartnerId]);

  useEffect(() => {
    if (section !== "documents") return;
    let ignore = false;
    async function loadDocsPartners() {
      try {
        const res = await apiRequest<Paginated<Partner>>("/api/partners?page=1&limit=200");
        if (!ignore) setDocsPartners(res.data || []);
      } catch {
        if (!ignore) setDocsPartners([]);
      }
    }
    loadDocsPartners();
    return () => {
      ignore = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "documents" || !docsPartnerId) {
      setDocumentsList([]);
      return;
    }
    let ignore = false;
    async function loadDocuments() {
      setDocumentsLoading(true);
      try {
        const res = await apiRequest<{ data: any[] }>(`/api/partners/${docsPartnerId}/documents`);
        if (!ignore) setDocumentsList(res.data || []);
      } catch {
        if (!ignore) setDocumentsList([]);
      } finally {
        if (!ignore) setDocumentsLoading(false);
      }
    }
    loadDocuments();
    return () => {
      ignore = true;
    };
  }, [section, docsPartnerId]);

  useEffect(() => {
    if (!showPartnerModal || activePartnerBlock !== "documents" || !selectedPartnerId) {
      setDetailDocuments([]);
      setDetailDocumentsLoading(false);
      return;
    }
    let ignore = false;
    async function loadDetailDocuments() {
      setDetailDocumentsLoading(true);
      try {
        const res = await apiRequest<{ data: any[] }>(`/api/partners/${selectedPartnerId}/documents`);
        if (!ignore) setDetailDocuments(res.data || []);
      } catch {
        if (!ignore) setDetailDocuments([]);
      } finally {
        if (!ignore) setDetailDocumentsLoading(false);
      }
    }
    loadDetailDocuments();
    return () => {
      ignore = true;
    };
  }, [showPartnerModal, activePartnerBlock, selectedPartnerId]);

  function resetFilters() {
    setSearchPartnerQuery("");
    setFilterQ("");
    setFilterStatut("");
    setFilterProgramme("");
    setFilterCommercial("");
    setFilterBackOffice("");
    setFilterConformite("");
    setFilterPays("");
    setFilterRegion("");
    setPartnersSortBy("");
    setPartnersSortDir("asc");
    setPage(1);
  }

  function applyPartnerSearch() {
    setPage(1);
    setFilterQ(searchPartnerQuery.trim());
  }

  function togglePartnersSort(field: "raison_sociale" | "siren" | "clients_contrats") {
    setPage(1);
    if (partnersSortBy === field) {
      setPartnersSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setPartnersSortBy(field);
    setPartnersSortDir("asc");
  }

  function partnerSortMarker(field: "raison_sociale" | "siren" | "clients_contrats") {
    if (partnersSortBy !== field) return "↕";
    return partnersSortDir === "asc" ? "↑" : "↓";
  }

  function toggleClientsSort(field: "nom" | "partner" | "chiffre_affaires" | "masse_salariale") {
    setClientsPage(1);
    if (clientsSortBy === field) {
      setClientsSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setClientsSortBy(field);
    setClientsSortDir("asc");
  }

  function clientsSortMarker(field: "nom" | "partner" | "chiffre_affaires" | "masse_salariale") {
    if (clientsSortBy !== field) return "↕";
    return clientsSortDir === "asc" ? "↑" : "↓";
  }

  function toggleInsurersSort(field: "name") {
    setInsurersPage(1);
    if (insurersSortBy === field) {
      setInsurersSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setInsurersSortBy(field);
    setInsurersSortDir("asc");
  }

  function insurersSortMarker(field: "name") {
    if (insurersSortBy !== field) return "↕";
    return insurersSortDir === "asc" ? "↑" : "↓";
  }

  async function createInsurer() {
    const name = insurerDraft.name.trim();
    if (!name) return;
    setInsurersError(null);
    try {
      await apiRequest("/api/partners/insurers", "POST", { name });
      setInsurerDraft({ name: "" });
      setInsurersPage(1);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setInsurersError(errorMessage(err, "Erreur création assureur."));
    }
  }

  async function saveInsurer() {
    const insurerId = Number(editingInsurer?.id || 0);
    const name = String(editingInsurer?.name || "").trim();
    if (!insurerId || !name) return;
    setInsurersError(null);
    try {
      await apiRequest(`/api/partners/insurers/${insurerId}`, "PATCH", { name });
      setShowInsurerModal(false);
      setEditingInsurer(null);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setInsurersError(errorMessage(err, "Erreur modification assureur."));
    }
  }

  async function deleteInsurer(insurerId: number) {
    if (!confirm("Supprimer cet assureur ?")) return;
    setInsurersError(null);
    try {
      await apiRequest(`/api/partners/insurers/${insurerId}`, "DELETE");
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setInsurersError(errorMessage(err, "Erreur suppression assureur."));
    }
  }

  async function exportCsv() {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "1000");
    params.set("format", "csv");
    params.set("all", "1");
    if (filterQ) params.set("q", filterQ);
    if (filterStatut) params.set("statut", filterStatut);
    if (filterProgramme) params.set("programme_id", filterProgramme);
    if (filterCommercial) params.set("commercial_id", filterCommercial);
    if (filterBackOffice) params.set("back_office_id", filterBackOffice);
    if (filterConformite) params.set("conformite_statut", filterConformite);
    if (filterPays) params.set("pays", filterPays);
    if (filterRegion) params.set("region", filterRegion);
    if (partnersSortBy) {
      params.set("sort_by", partnersSortBy);
      params.set("sort_dir", partnersSortDir);
    }
    const res = await fetch(`/api/partners?${params.toString()}`, {
      headers: {
        "Content-Type": "text/csv",
        ...(typeof window !== "undefined" && localStorage.getItem("myoptiwealth_token")
          ? { Authorization: `Bearer ${localStorage.getItem("myoptiwealth_token")}` }
          : {}),
      },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "partenaires.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function createPartner() {
    if (!newPartner.siren || !newPartner.raison_sociale) return;
    await apiRequest("/api/partners", "POST", {
      siren: newPartner.siren,
      raison_sociale: newPartner.raison_sociale,
      statut: newPartner.statut,
      pays: newPartner.pays || "FR",
      code_ape: newPartner.code_ape || null,
    });
    setNewPartner({ siren: "", raison_sociale: "", statut: "brouillon", pays: "FR", code_ape: "" });
    setPage(1);
    setReloadKey((k) => k + 1);
  }

  async function exportPartnerJson() {
    if (!selectedPartnerId) return;
    const res = await fetch(`/api/partners/${selectedPartnerId}?format=json`, {
      headers: {
        ...(typeof window !== "undefined" && localStorage.getItem("myoptiwealth_token")
          ? { Authorization: `Bearer ${localStorage.getItem("myoptiwealth_token")}` }
          : {}),
      },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `partenaire_${selectedPartnerId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function savePartner() {
    if (!editingPartner) return;
    setSavingPartner(true);
    try {
      await apiRequest(`/api/partners/${editingPartner.id}`, "PATCH", {
        statut: editingPartner.statut,
        conformite_statut: editingPartner.conformite_statut,
        conformite_notes: editingPartner.conformite_statut === "anomalie" ? (editingPartner.conformite_notes || "") : null,
      });
      if (selectedPartnerId) {
        const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
        setDetail(res);
        setEditingPartner(res.partner);
      }
      setReloadKey((k) => k + 1);
    } finally {
      setSavingPartner(false);
    }
  }

  async function saveAddress() {
    if (!selectedPartnerId || !editingAddress) return;
    if (!editingAddress.ligne1) return;
    if (editingAddress.id) {
      await apiRequest(`/api/partners/${selectedPartnerId}/addresses/${editingAddress.id}`, "PATCH", {
        type: editingAddress.type,
        ligne1: editingAddress.ligne1,
        ligne2: editingAddress.ligne2 || null,
        code_postal: editingAddress.code_postal || null,
        ville: editingAddress.ville || null,
        region: editingAddress.region || null,
        pays: editingAddress.pays || "FR",
        email: editingAddress.email || null,
        telephone: editingAddress.telephone || null,
      });
    } else {
      await apiRequest(`/api/partners/${selectedPartnerId}/addresses`, "POST", {
        type: editingAddress.type,
        ligne1: editingAddress.ligne1,
        ligne2: editingAddress.ligne2 || null,
        code_postal: editingAddress.code_postal || null,
        ville: editingAddress.ville || null,
        region: editingAddress.region || null,
        pays: editingAddress.pays || "FR",
        email: editingAddress.email || null,
        telephone: editingAddress.telephone || null,
      });
    }
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
    setEditingAddress({
      id: 0,
      partner_id: selectedPartnerId,
      type: "siege",
      ligne1: "",
    });
  }

  async function deleteAddress(id: number) {
    if (!selectedPartnerId) return;
    if (!confirm("Supprimer cette adresse ?")) return;
    await apiRequest(`/api/partners/${selectedPartnerId}/addresses/${id}`, "DELETE");
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
  }

  async function saveMandataire() {
    if (!selectedPartnerId || !editingMandataire) return;
    if (!editingMandataire.nom || !editingMandataire.role) return;
    if (!editingMandataire.email || !editingMandataire.telephone || !editingMandataire.date_debut) return;
    if (editingMandataire.id) {
      await apiRequest(`/api/partners/${selectedPartnerId}/mandataires/${editingMandataire.id}`, "PATCH", {
        nom: editingMandataire.nom,
        prenom: editingMandataire.prenom || null,
        role: editingMandataire.role,
        email: editingMandataire.email,
        telephone: editingMandataire.telephone,
        date_debut: editingMandataire.date_debut,
        date_fin: editingMandataire.date_fin || null,
      });
    } else {
      await apiRequest(`/api/partners/${selectedPartnerId}/mandataires`, "POST", {
        nom: editingMandataire.nom,
        prenom: editingMandataire.prenom || null,
        role: editingMandataire.role,
        email: editingMandataire.email,
        telephone: editingMandataire.telephone,
        date_debut: editingMandataire.date_debut,
        date_fin: editingMandataire.date_fin || null,
      });
    }
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
    setEditingMandataire({
      id: 0,
      partner_id: selectedPartnerId,
      nom: "",
      role: "gerant",
      email: "",
      telephone: "",
      date_debut: "",
    });
  }

  async function deleteMandataire(id: number) {
    if (!selectedPartnerId) return;
    if (!confirm("Supprimer ce mandataire ?")) return;
    await apiRequest(`/api/partners/${selectedPartnerId}/mandataires/${id}`, "DELETE");
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
  }

  async function deleteAssignment(id: number) {
    if (!selectedPartnerId) return;
    if (!confirm("Retirer ce correspondant ?")) return;
    await apiRequest(`/api/partners/${selectedPartnerId}/correspondants/${id}`, "DELETE");
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
    setEditingPartner(res.partner);
  }

  async function assignCorrespondant() {
    if (!assignmentPartnerId || !assignmentCorrespondantId) return;
    await apiRequest(`/api/partners/${assignmentPartnerId}/correspondants`, "POST", {
      correspondant_id: Number(assignmentCorrespondantId),
      role: assignmentRole,
      statut: "actif",
    });
    if (selectedPartnerId && Number(assignmentPartnerId) === selectedPartnerId) {
      const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
      setDetail(res);
      setEditingPartner(res.partner);
    }
  }

  async function removeProgramme(programmeId: number) {
    if (!selectedPartnerId) return;
    if (!confirm("Retirer ce programme ?")) return;
    await apiRequest(`/api/partners/${selectedPartnerId}/programmes/${programmeId}`, "DELETE");
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
    setEditingPartner(res.partner);
  }

  async function assignProgramme() {
    setProgramAssignError(null);
    const partnerIdToUse = programPartnerId || (detail ? String(detail.partner.id) : "");
    if (!partnerIdToUse || !programId) {
      setProgramAssignError("Sélectionnez un partenaire et un programme.");
      return;
    }
    setAssigningProgramme(true);
    try {
      await apiRequest(`/api/partners/${partnerIdToUse}/programmes`, "POST", {
        programme_id: Number(programId),
      });
      if (selectedPartnerId && Number(partnerIdToUse) === selectedPartnerId) {
        const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
        setDetail(res);
        setEditingPartner(res.partner);
      }
    } catch (err: any) {
      setProgramAssignError(err?.message || "Erreur d'association programme");
    } finally {
      setAssigningProgramme(false);
    }
  }

  function togglePairProgrammeSelection(programmeId: string) {
    if (!selectedPairPartnerId || selectedPairExistingProgrammeIds.has(programmeId)) return;
    setSelectedPairProgrammeIds((current) =>
      current.includes(programmeId) ? current.filter((id) => id !== programmeId) : [...current, programmeId]
    );
  }

  function toggleContractProgrammeSelection(programmeId: string) {
    if (!selectedContractClient || !selectedContractClient.partner_id) return;
    if (selectedContractExistingProgrammeIds.has(programmeId)) return;
    setSelectedContractProgrammeIds((current) =>
      current.includes(programmeId) ? current.filter((id) => id !== programmeId) : [...current, programmeId]
    );
  }

  async function createContractClientPairings() {
    setContractPairingError(null);
    setContractPairingInfo(null);
    if (!selectedContractClient) {
      setContractPairingError("Sélectionnez un client.");
      return;
    }
    if (!selectedContractClient.partner_id) {
      setContractPairingError("Ce client n'est rattaché à aucun partenaire.");
      return;
    }
    if (!selectedContractProgrammeIds.length) {
      setContractPairingError("Sélectionnez au moins un contrat.");
      return;
    }
    if (!selectedContractCreatableIds.length) {
      setContractPairingInfo("Tous les contrats sélectionnés sont déjà appairés avec ce client.");
      return;
    }

    setContractPairingBusy(true);
    try {
      let created = 0;
      const already = selectedContractProgrammeIds.length - selectedContractCreatableIds.length;
      let failed = 0;
      let firstError = "";

      for (const programmeId of selectedContractCreatableIds) {
        try {
          await apiRequest("/api/partners/contracts", "POST", {
            partner_id: Number(selectedContractClient.partner_id),
            programme_id: Number(programmeId),
            client_id: Number(selectedContractClient.id),
            statut: "actif",
            date_debut: null,
            date_fin: null,
            devise: "EUR",
          });
          created += 1;
        } catch (err: unknown) {
          failed += 1;
          if (!firstError) firstError = errorMessage(err, "Erreur d'appairage contrat/client");
        }
      }

      if (created > 0) {
        setSelectedContractProgrammeIds([]);
        setReloadKey((value) => value + 1);
      }
      if (failed > 0) {
        setContractPairingError(
          firstError ? `${failed} appairage(s) en erreur (${firstError}).` : `${failed} appairage(s) en erreur.`
        );
      }
      const infoParts: string[] = [];
      if (created > 0) infoParts.push(`${created} appairage(s) créé(s).`);
      if (already > 0) infoParts.push(`${already} déjà existant(s).`);
      if (infoParts.length) setContractPairingInfo(infoParts.join(" "));
    } finally {
      setContractPairingBusy(false);
    }
  }

  async function deleteContractPairing(contractId: number) {
    if (!confirm("Supprimer cet appairage contrat/client ?")) return;
    setContractPairingError(null);
    setContractPairingInfo(null);
    try {
      await apiRequest(`/api/partners/contracts/${contractId}`, "DELETE");
      setContractPairingInfo("Appairage supprimé.");
      setReloadKey((value) => value + 1);
    } catch (err: unknown) {
      setContractPairingError(errorMessage(err, "Erreur de suppression de l'appairage"));
    }
  }

  async function createPartnerProgrammePairing() {
    setPairingError(null);
    setPairingInfo(null);
    if (!selectedPairPartnerId) {
      setPairingError("Sélectionnez un partenaire.");
      return;
    }
    if (!selectedPairProgrammeIds.length) {
      setPairingError("Sélectionnez au moins un contrat.");
      return;
    }
    if (!selectedPairCreatableIds.length) {
      setPairingInfo("Tous les contrats sélectionnés sont déjà appairés avec ce partenaire.");
      return;
    }
    setPairingBusy(true);
    try {
      let created = 0;
      let already = selectedPairProgrammeIds.length - selectedPairCreatableIds.length;
      let failed = 0;

      for (const programmeId of selectedPairCreatableIds) {
        try {
          const response = await apiRequest<{ ok: boolean; created: boolean }>("/api/partners/partner-programmes", "POST", {
            partner_id: Number(selectedPairPartnerId),
            programme_id: Number(programmeId),
          });
          if (response.created) created += 1;
          else already += 1;
        } catch {
          failed += 1;
        }
      }

      if (created > 0) {
        setReloadKey((value) => value + 1);
      }
      if (failed > 0) {
        setPairingError(`${failed} appairage(s) en erreur.`);
      }
      const infoParts: string[] = [];
      if (created > 0) infoParts.push(`${created} appairage(s) créé(s).`);
      if (already > 0) infoParts.push(`${already} déjà existant(s).`);
      if (infoParts.length) setPairingInfo(infoParts.join(" "));
    } catch (err: unknown) {
      setPairingError(errorMessage(err, "Erreur pendant l'appairage"));
    } finally {
      setPairingBusy(false);
    }
  }

  async function deletePartnerProgrammePairing(partnerId: number, programmeId: number) {
    if (!confirm("Supprimer cet appairage contrat/partenaire ?")) return;
    setPairingError(null);
    setPairingInfo(null);
    try {
      await apiRequest(`/api/partners/partner-programmes/${partnerId}/${programmeId}`, "DELETE");
      setPairingInfo("Appairage supprimé.");
      setReloadKey((value) => value + 1);
    } catch (err: unknown) {
      setPairingError(errorMessage(err, "Erreur de suppression de l'appairage"));
    }
  }

  async function deleteDetailContract(id: number) {
    if (!confirm("Supprimer ce contrat ?")) return;
    await apiRequest(`/api/partners/contracts/${id}`, "DELETE");
    if (selectedPartnerId) {
      const res = await apiRequest<Paginated<Contract>>(`/api/partners/contracts?page=1&limit=200&partner_id=${selectedPartnerId}`);
      setDetailContracts(res.data || []);
    }
    setReloadKey((k) => k + 1);
  }

  async function createContractFromDetail() {
    if (!selectedPartnerId || !detailContract.programme_id || !detailContract.client_id) return;
    await apiRequest("/api/partners/contracts", "POST", {
      partner_id: selectedPartnerId,
      programme_id: Number(detailContract.programme_id),
      client_id: Number(detailContract.client_id),
      statut: detailContract.statut,
      date_debut: detailContract.date_debut || null,
      date_fin: detailContract.date_fin || null,
      devise: detailContract.devise,
    });
    const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
    setDetail(res);
    setEditingPartner(res.partner);
    setDetailContract({ programme_id: "", client_id: "", statut: "actif", date_debut: "", date_fin: "", devise: "EUR" });
    setReloadKey((k) => k + 1);
  }

  async function createClientWithContract() {
    setNewClientError(null);
    if (!selectedPartnerId) {
      setNewClientError("Sélectionnez un partenaire.");
      return;
    }
    if (
      !newClientWithContract.nom ||
      !newClientWithContract.programme_id ||
      !newClientWithContract.date_debut ||
      !newClientWithContract.date_fin
    ) {
      setNewClientError("Réf. client externe, programme et dates sont obligatoires.");
      return;
    }
    try {
      const client = await apiRequest<Client>("/api/partners/clients", "POST", {
        partner_id: selectedPartnerId,
        external_client_ref: newClientWithContract.nom,
        type: newClientWithContract.type,
        chiffre_affaires: parseOptionalNumber(newClientWithContract.chiffre_affaires),
        masse_salariale: parseOptionalNumber(newClientWithContract.masse_salariale),
      });
      await apiRequest("/api/partners/contracts", "POST", {
        partner_id: selectedPartnerId,
        programme_id: Number(newClientWithContract.programme_id),
        client_id: client.id,
        statut: newClientWithContract.statut,
        date_debut: newClientWithContract.date_debut || null,
        date_fin: newClientWithContract.date_fin || null,
        devise: newClientWithContract.devise,
      });
      const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
      setDetail(res);
      setEditingPartner(res.partner);
      setNewClientWithContract({
        nom: "",
        type: "personne_morale",
        chiffre_affaires: "",
        masse_salariale: "",
        programme_id: "",
        statut: "actif",
        date_debut: "",
        date_fin: "",
        devise: "EUR",
      });
      setShowNewClientModal(false);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg === "partner_not_active") {
        setNewClientError("Impossible de créer un contrat : le partenaire doit être en statut « actif ».");
      } else {
        setNewClientError(msg || "Erreur création client/contrat");
      }
    }
  }

  async function saveCorrespondant() {
    if (!editingCorrespondant) return;
    if (!editingCorrespondant.nom || !editingCorrespondant.email) return;
    if (editingCorrespondant.id) {
      await apiRequest(`/api/partners/correspondants/${editingCorrespondant.id}`, "PATCH", {
        type: editingCorrespondant.type,
        nom: editingCorrespondant.nom,
        email: editingCorrespondant.email,
        telephone: editingCorrespondant.telephone || null,
      });
    } else {
      await apiRequest("/api/partners/correspondants", "POST", {
        type: editingCorrespondant.type,
        nom: editingCorrespondant.nom,
        email: editingCorrespondant.email,
        telephone: editingCorrespondant.telephone || null,
      });
    }
    const res = await apiRequest<Paginated<Correspondant>>("/api/partners/correspondants?page=1&limit=200");
    setCorrespondantsList(res.data || []);
    setEditingCorrespondant(null);
    setShowCorrespondantModal(false);
    setNewCorrespondant({ type: "commercial", nom: "", email: "", telephone: "" });
  }

  async function createCorrespondant() {
    if (!newCorrespondant.nom || !newCorrespondant.email) return;
    await apiRequest("/api/partners/correspondants", "POST", {
      type: newCorrespondant.type,
      nom: newCorrespondant.nom,
      email: newCorrespondant.email,
      telephone: newCorrespondant.telephone || null,
    });
    const res = await apiRequest<Paginated<Correspondant>>("/api/partners/correspondants?page=1&limit=200");
    setCorrespondantsList(res.data || []);
    setNewCorrespondant({ type: "commercial", nom: "", email: "", telephone: "" });
  }

  async function createClient() {
    if (!newClient.nom || !newClient.partner_id) return;
    await apiRequest("/api/partners/clients", "POST", {
      partner_id: Number(newClient.partner_id),
      external_client_ref: newClient.nom,
      type: newClient.type,
      chiffre_affaires: parseOptionalNumber(newClient.chiffre_affaires),
      masse_salariale: parseOptionalNumber(newClient.masse_salariale),
    });
    const res = await apiRequest<Paginated<Client>>("/api/partners/clients?page=1&limit=200");
    setClientsList(res.data || []);
    setNewClient({ nom: "", type: "personne_morale", partner_id: "", chiffre_affaires: "", masse_salariale: "" });
  }

  async function saveClient() {
    if (!editingClient) return;
    if (!editingClient.nom || !editingClient.partner_id) {
      setClientSaveError("Réf. externe et partenaire sont obligatoires.");
      return;
    }
    setClientSaveError(null);
    setSavingClient(true);
    try {
      await apiRequest(`/api/partners/clients/${editingClient.id}`, "PATCH", {
        external_client_ref: editingClient.nom,
        type: editingClient.type,
        partner_id: editingClient.partner_id,
        chiffre_affaires: parseOptionalNumber(editingClient.chiffre_affaires),
        masse_salariale: parseOptionalNumber(editingClient.masse_salariale),
      });
      if (selectedPartnerId) {
        const res = await apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`);
        setDetail(res);
      }
      const clientsRes = await apiRequest<Paginated<Client>>("/api/partners/clients?page=1&limit=200");
      setClientsList(clientsRes.data || []);
      setEditingClient(null);
      setShowClientModal(false);
    } finally {
      setSavingClient(false);
    }
  }

  async function createDocument() {
    if (!docsPartnerId || !newDocument.file_name) return;
    await apiRequest(`/api/partners/${docsPartnerId}/documents`, "POST", {
      doc_type: newDocument.doc_type,
      file_name: newDocument.file_name,
      status: newDocument.status,
      expiry_date: newDocument.expiry_date || null,
      storage_provider: newDocument.storage_provider || null,
      storage_ref: newDocument.storage_ref || null,
      file_base64: newDocument.file_base64 || null,
    });
    const res = await apiRequest<{ data: any[] }>(`/api/partners/${docsPartnerId}/documents`);
    setDocumentsList(res.data || []);
    setNewDocument({
      doc_type: "KBIS",
      file_name: "",
      status: "valide",
      expiry_date: "",
      storage_provider: "",
      storage_ref: "",
      file_base64: "",
    });
  }

  async function createDetailDocument() {
    if (!selectedPartnerId || !newDocument.file_name) return;
    await apiRequest(`/api/partners/${selectedPartnerId}/documents`, "POST", {
      doc_type: newDocument.doc_type,
      file_name: newDocument.file_name,
      status: newDocument.status,
      expiry_date: newDocument.expiry_date || null,
      storage_provider: newDocument.storage_provider || null,
      storage_ref: newDocument.storage_ref || null,
      file_base64: newDocument.file_base64 || null,
    });
    const [detailRes, docsRes] = await Promise.all([
      apiRequest<PartnerDetail>(`/api/partners/${selectedPartnerId}`),
      apiRequest<{ data: any[] }>(`/api/partners/${selectedPartnerId}/documents`),
    ]);
    setDetail(detailRes);
    setEditingPartner(detailRes.partner);
    setDetailDocuments(docsRes.data || []);
    setNewDocument({
      doc_type: "KBIS",
      file_name: "",
      status: "valide",
      expiry_date: "",
      storage_provider: "",
      storage_ref: "",
      file_base64: "",
    });
  }

  function viewContractPdf(contract: Contract) {
    const programme = programmes.find((p) => Number(p.id) === Number(contract.programme_id));
    const params = new URLSearchParams();
    params.set("programme_id", String(contract.programme_id));
    if (programme?.ligne_risque) params.set("programme_name", programme.ligne_risque);
    window.open(`/programmes/preview?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  return (
    <RequireAuth>
      <div className="space-y-6">
        {section === "liste" && (
          <>
            <SectionHeader
              title="Partenaires"
              description="Liste des partenaires (courtiers) avec filtres, KPIs et accès à la fiche détaillée."
            />

            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setPartnersView("creation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  partnersView === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </button>
              <button
                type="button"
                onClick={() => setPartnersView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  partnersView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {partnersView === "creation" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={newPartner.raison_sociale}
                    onChange={(e) => setNewPartner((s) => ({ ...s, raison_sociale: e.target.value }))}
                    placeholder="Raison sociale"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newPartner.siren}
                    onChange={(e) => setNewPartner((s) => ({ ...s, siren: e.target.value }))}
                    placeholder="SIREN"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newPartner.code_ape}
                    onChange={(e) => setNewPartner((s) => ({ ...s, code_ape: e.target.value }))}
                    placeholder="Code APE"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <select
                    value={newPartner.statut}
                    onChange={(e) => setNewPartner((s) => ({ ...s, statut: e.target.value }))}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="brouillon">brouillon</option>
                    <option value="en_validation">en_validation</option>
                    <option value="actif">actif</option>
                  </select>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={createPartner}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Ajouter un partenaire
                  </button>
                </div>
              </div>
            )}

            {partnersView === "visualisation" && (
              <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
                <div className="text-2xl font-semibold text-slate-800">{kpi.total}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Actifs</div>
                <div className="text-2xl font-semibold text-slate-800">{kpi.actifs}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Anomalies</div>
                <div className="text-2xl font-semibold text-rose-600">{kpi.anomalies}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Taux anomalies</div>
                <div className="text-2xl font-semibold text-slate-800">
                  {kpi.total ? ((kpi.anomalies / kpi.total) * 100).toFixed(2) : "0.00"}%
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex flex-1 items-center gap-2">
                  <input
                    value={searchPartnerQuery}
                    onChange={(e) => setSearchPartnerQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyPartnerSearch();
                    }}
                    placeholder="Raison sociale ou SIREN"
                    className="h-10 min-w-[24ch] flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <button
                    onClick={applyPartnerSearch}
                    className="h-10 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Rechercher
                  </button>
                </div>
                <button
                  onClick={() => setShowFilters((value) => !value)}
                  className="ml-3 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {showFilters ? "Masquer les filtres" : "Afficher les filtres"}
                </button>
              </div>
              {showFilters && (
                <>
                  <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                    <div className="md:col-span-3 lg:col-span-4 flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Filtres rapides</span>
                      <button
                        onClick={() => {
                          setFilterStatut("actif");
                          setPage(1);
                        }}
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs"
                      >
                        Actifs
                      </button>
                      <button
                        onClick={() => {
                          setFilterConformite("anomalie");
                          setPage(1);
                        }}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700"
                      >
                        Anomalies
                      </button>
                      <button
                        onClick={() => {
                          setFilterStatut("en_validation");
                          setPage(1);
                        }}
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs"
                      >
                        En validation
                      </button>
                      <button
                        onClick={resetFilters}
                        className="ml-auto rounded-full border border-slate-200 px-3 py-1 text-xs"
                      >
                        Réinitialiser
                      </button>
                    </div>
                    <select
                      value={filterStatut}
                      onChange={(e) => setFilterStatut(e.target.value)}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="">Statut</option>
                      <option value="brouillon">brouillon</option>
                      <option value="en_validation">en_validation</option>
                      <option value="actif">actif</option>
                      <option value="anomalie">anomalie</option>
                      <option value="gele">gelé</option>
                      <option value="supprime">supprimé</option>
                    </select>
                    <select
                      value={filterProgramme}
                      onChange={(e) => setFilterProgramme(e.target.value)}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="">Contrat</option>
                      {programmes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.ligne_risque}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filterCommercial}
                      onChange={(e) => setFilterCommercial(e.target.value)}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="">Commercial</option>
                      {correspondants
                        .filter((c) => c.type === "commercial")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nom}
                          </option>
                        ))}
                    </select>
                    <select
                      value={filterBackOffice}
                      onChange={(e) => setFilterBackOffice(e.target.value)}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="">Back-office</option>
                      {correspondants
                        .filter((c) => c.type === "back_office")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nom}
                          </option>
                        ))}
                    </select>
                    <select
                      value={filterConformite}
                      onChange={(e) => setFilterConformite(e.target.value)}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="">Conformité</option>
                      <option value="en_attente">en_attente</option>
                      <option value="ok">ok</option>
                      <option value="anomalie">anomalie</option>
                    </select>
                    <input
                      value={filterPays}
                      onChange={(e) => setFilterPays(e.target.value.toUpperCase())}
                      placeholder="Pays (FR, ES…)"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <input
                      value={filterRegion}
                      onChange={(e) => setFilterRegion(e.target.value)}
                      placeholder="Région"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-500">Filtres actifs :</span>
                    {filterQ && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">q: {filterQ}</span>}
                    {filterStatut && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">statut: {filterStatut}</span>}
                    {filterProgramme && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">contrat: {filterProgramme}</span>}
                    {filterCommercial && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">commercial: {filterCommercial}</span>}
                    {filterBackOffice && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">back-office: {filterBackOffice}</span>}
                    {filterConformite && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">conformité: {filterConformite}</span>}
                    {filterPays && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">pays: {filterPays}</span>}
                    {filterRegion && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">région: {filterRegion}</span>}
                    {partnersSortBy && (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                        tri: {partnersSortBy} ({partnersSortDir})
                      </span>
                    )}
                    {!filterQ &&
                      !filterStatut &&
                      !filterProgramme &&
                      !filterCommercial &&
                      !filterBackOffice &&
                      !filterConformite &&
                      !filterPays &&
                      !filterRegion &&
                      !partnersSortBy && (
                      <span className="text-slate-400">aucun</span>
                      )}
                  </div>
                </>
              )}
            </div>
            <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
                <LoadingPopup
                  show={loadingPartners}
                  title="Chargement de la liste partenaires"
                  message="Le volume de données peut nécessiter quelques secondes."
                />
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="text-sm font-medium text-slate-700">
                    {`${total} partenaires`}
                  </div>
                  <button
                    onClick={exportCsv}
                    className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Exporter CSV
                  </button>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                    >
                      ←
                    </button>
                    <span>
                      Page {page} / {pagination.pages}
                    </span>
                    <button
                      disabled={page >= pagination.pages}
                      onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                      className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                    >
                      →
                    </button>
                    <select
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      className="rounded-md border border-slate-200 px-2 py-1"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>
                {partnersError ? (
                  <div className="px-4 py-6 text-sm text-red-600">{partnersError}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2 text-left">
                            <button
                              onClick={() => togglePartnersSort("raison_sociale")}
                              className="inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              Raison sociale <span className="text-xs">{partnerSortMarker("raison_sociale")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-left">
                            <button
                              onClick={() => togglePartnersSort("siren")}
                              className="inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              SIREN <span className="text-xs">{partnerSortMarker("siren")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-center">Statut</th>
                          <th className="px-4 py-2 text-left">Contrat</th>
                          <th className="px-4 py-2 text-center">Conformité</th>
                          <th className="px-4 py-2 text-right">
                            <button
                              onClick={() => togglePartnersSort("clients_contrats")}
                              className="ml-auto inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              Clients/contrats <span className="text-xs">{partnerSortMarker("clients_contrats")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-left">MAJ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {partners.map((p) => (
                          <tr
                            key={p.id}
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => {
                              setSelectedPartnerId(p.id);
                              setShowPartnerModal(true);
                            }}
                          >
                            <td className="px-4 py-2 font-medium text-slate-800">{p.raison_sociale}</td>
                            <td className="px-4 py-2 text-slate-600">{p.siren}</td>
                            <td className="px-4 py-2 text-center">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                  p.statut === "actif"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : p.statut === "anomalie"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {p.statut}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-600">{p.programmes || "—"}</td>
                            <td className="px-4 py-2 text-center">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                  p.conformite_statut === "anomalie"
                                    ? "bg-rose-100 text-rose-700"
                                    : p.conformite_statut === "ok"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {p.conformite_statut || "en_attente"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right text-slate-600">{p.clients_contrats ?? 0}</td>
                            <td className="px-4 py-2 text-slate-600">{formatDate(p.date_maj)}</td>
                          </tr>
                        ))}
                        {!partners.length && !loadingPartners && (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                              Aucun partenaire.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
            </>
            )}

            {showPartnerModal && (
              <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10">
                <div className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
                    <div className="text-base font-semibold text-slate-700">Fiche partenaire</div>
                    <button
                      onClick={() => setShowPartnerModal(false)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Fermer
                    </button>
                  </div>
                  <div className="px-6 py-5 text-sm">
                    {loadingDetail && <div className="text-slate-500">Chargement…</div>}
                    {!loadingDetail && !detail && (
                      <div className="text-slate-500">Sélectionnez un partenaire dans la liste pour afficher la fiche.</div>
                    )}
                    {detail && (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-3">
                            <div className="text-base font-semibold text-slate-800">{detail.partner.raison_sociale}</div>
                            <div className="text-xs text-slate-500">Description partenaire</div>
                          </div>
                          <div className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                              <div className="grid gap-2">
                                <label className="text-xs font-semibold text-slate-500">Statut partenaire</label>
                                <select
                                  value={editingPartner?.statut || detail.partner.statut}
                                  onChange={(e) => setEditingPartner((s) => (s ? { ...s, statut: e.target.value } : s))}
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                >
                                  <option value="brouillon">brouillon</option>
                                  <option value="en_validation">en_validation</option>
                                  <option value="actif">actif</option>
                                  <option value="anomalie">anomalie</option>
                                  <option value="gele">gelé</option>
                                  <option value="supprime">supprimé</option>
                                </select>
                              </div>
                              <div className="grid gap-2">
                                <label className="text-xs font-semibold text-slate-500">Conformité</label>
                                <select
                                  value={editingPartner?.conformite_statut || detail.partner.conformite_statut || "en_attente"}
                                  onChange={(e) =>
                                    setEditingPartner((s) => (s ? { ...s, conformite_statut: e.target.value } : s))
                                  }
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                >
                                  <option value="en_attente">en_attente</option>
                                  <option value="ok">ok</option>
                                  <option value="anomalie">anomalie</option>
                                </select>
                              </div>
                              <button
                                onClick={savePartner}
                                className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-60"
                                disabled={savingPartner}
                              >
                                {savingPartner ? "Enregistrement…" : "Enregistrer"}
                              </button>
                            </div>
                            {editingPartner?.conformite_statut === "anomalie" && (
                              <textarea
                                value={editingPartner?.conformite_notes || ""}
                                onChange={(e) =>
                                  setEditingPartner((s) => (s ? { ...s, conformite_notes: e.target.value } : s))
                                }
                                placeholder="Notes de conformité"
                                className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                              />
                            )}
                            <div className="grid gap-3 md:grid-cols-3">
                              <div className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Références</div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>SIREN: {detail.partner.siren || "—"}</div>
                                  <div>Code APE: {detail.partner.code_ape || "—"}</div>
                                  <div>Pays: {detail.partner.pays || "—"}</div>
                                </div>
                              </div>
                              <button
                                onClick={() => setActivePartnerBlock("programme")}
                                className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Synthèse des contrats
                                </div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>Total: {detailContractSummary.total}</div>
                                  <div>Actifs: {detailContractSummary.activeContracts}</div>
                                  <div>Autres statuts: {detailContractSummary.inactiveContracts}</div>
                                </div>
                                <div className="mt-auto pt-2 text-xs text-slate-500">Afficher le bloc Affecter un programme</div>
                              </button>
                              <button
                                onClick={() => setActivePartnerBlock("clientele")}
                                className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Synthèse des clients actifs
                                </div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>Clients actifs: {detailContractSummary.activeClients}</div>
                                  <div>Clients référencés: {detailClients.length}</div>
                                  <div>Clients sous contrat: {detail.contracts?.clients_contrats ?? 0}</div>
                                </div>
                                <div className="mt-auto pt-2 text-xs text-slate-500">Afficher le bloc Voir la clientèle</div>
                              </button>
                              <button
                                onClick={() => {
                                  setActivePartnerBlock("adresses");
                                  if (!editingAddress) {
                                    setEditingAddress({
                                      id: 0,
                                      partner_id: detail.partner.id,
                                      type: "siege",
                                      ligne1: "",
                                    });
                                  }
                                }}
                                className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Adresses</div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>Total: {detail.addresses?.length || 0}</div>
                                  <div>Accès au bloc de gestion des adresses</div>
                                </div>
                              </button>
                              <button
                                onClick={() => {
                                  setActivePartnerBlock("mandataires");
                                  if (!editingMandataire) {
                                    setEditingMandataire({
                                      id: 0,
                                      partner_id: detail.partner.id,
                                      nom: "",
                                      role: "gerant",
                                      email: "",
                                      telephone: "",
                                      date_debut: "",
                                    });
                                  }
                                }}
                                className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dirigeants / mandataires</div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>Total: {detail.mandataires?.length || 0}</div>
                                  <div>Accès au bloc de gestion des mandataires</div>
                                </div>
                              </button>
                              <button
                                onClick={() => setActivePartnerBlock("correspondant")}
                                className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Affecter un correspondant
                                </div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>Correspondants affectés: {((detail && detail.correspondants) || []).length}</div>
                                  <div>Accès au bloc d’affectation</div>
                                </div>
                              </button>
                              <button
                                onClick={() => setActivePartnerBlock("documents")}
                                className="flex min-h-[130px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Documents du partenaire
                                </div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>Total: {detailDocuments.length || detail?.documents?.length || 0}</div>
                                  <div>Accès au bloc de gestion documentaire</div>
                                </div>
                              </button>
                            </div>
                          </div>
                        </div>
                        <div ref={activePartnerBlockTopRef} />

                        {activePartnerBlock === "correspondant" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-700">Affecter un correspondant</div>
                              <button
                                onClick={() => setActivePartnerBlock("none")}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                Masquer
                              </button>
                            </div>
                            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div>
                              <div className="text-xs font-semibold text-slate-500">Correspondants affectés</div>
                              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Nom</th>
                                      <th className="px-3 py-2 text-left">Type</th>
                                      <th className="px-3 py-2 text-left">Email</th>
                                      <th className="px-3 py-2 text-left">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {((detail && detail.correspondants) || []).map((c: any) => (
                                      <tr key={c.assignment_id ?? c.id}>
                                        <td className="px-3 py-2 text-slate-700">{c.nom || "—"}</td>
                                        <td className="px-3 py-2 text-slate-600">{c.role || c.type || "—"}</td>
                                        <td className="px-3 py-2 text-slate-600">{c.email || "—"}</td>
                                        <td className="px-3 py-2">
                                          <button
                                            onClick={() => deleteAssignment(c.assignment_id ?? c.id)}
                                            className="text-xs text-red-600 underline"
                                          >
                                            Retirer
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                    {!detail?.correspondants?.length && (
                                      <tr>
                                        <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                                          Aucun correspondant
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                            <div className="mt-3 border-t border-slate-200 pt-3">
                              <div className="text-xs font-semibold text-slate-500">Affecter un correspondant</div>
                              <div className="mt-2 grid gap-2">
                                <select
                                  value={assignmentPartnerId || String(detail.partner.id)}
                                  onChange={(e) => setAssignmentPartnerId(e.target.value)}
                                  className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                                >
                                  <option value="">Partenaire</option>
                                  {partners.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.raison_sociale}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={assignmentCorrespondantId}
                                  onChange={(e) => {
                                    const nextId = e.target.value;
                                    setAssignmentCorrespondantId(nextId);
                                    const selected = correspondants.find((c) => String(c.id) === nextId);
                                    if (selected?.type) setAssignmentRole(selected.type);
                                  }}
                                  className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                                >
                                  <option value="">Correspondant</option>
                                  {correspondants.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.nom} • {c.type}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={assignCorrespondant}
                                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                  Affecter
                                </button>
                              </div>
                            </div>
                          </div>
                          </div>
                        )}

                        {activePartnerBlock === "programme" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-700">Synthèse des contrats</div>
                              <button
                                onClick={() => setActivePartnerBlock("none")}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                Masquer
                              </button>
                            </div>
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div>
                              <div className="text-xs font-semibold text-slate-500">Contrats existants</div>
                              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Contrat</th>
                                      <th className="px-3 py-2 text-left">Programme</th>
                                      <th className="px-3 py-2 text-left">Client</th>
                                      <th className="px-3 py-2 text-left">Statut</th>
                                      <th className="px-3 py-2 text-left">Période</th>
                                      <th className="px-3 py-2 text-left">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {detailContracts.map((contract) => {
                                      const programmeLabel =
                                        programmes.find((p) => Number(p.id) === Number(contract.programme_id))?.ligne_risque ||
                                        `#${contract.programme_id}`;
                                      const clientLabel =
                                        detailClients.find((c) => Number(c.id) === Number(contract.client_id))?.nom ||
                                        `#${contract.client_id}`;
                                      return (
                                        <tr key={contract.id}>
                                          <td className="px-3 py-2 text-slate-700">#{contract.id}</td>
                                          <td className="px-3 py-2 text-slate-700">{programmeLabel}</td>
                                          <td className="px-3 py-2 text-slate-700">{clientLabel}</td>
                                          <td className="px-3 py-2 text-slate-600">{contract.statut || "—"}</td>
                                          <td className="px-3 py-2 text-slate-600">
                                            {formatDate(contract.date_debut)} → {formatDate(contract.date_fin)}
                                          </td>
                                          <td className="px-3 py-2">
                                            <button
                                              onClick={() => viewContractPdf(contract)}
                                              className="text-xs text-blue-600 underline"
                                            >
                                              Voir
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    {!detailContracts.length && (
                                      <tr>
                                        <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                                          Aucun contrat
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                            <div className="mt-3 border-t border-slate-200 pt-3">
                              <div className="text-xs font-semibold text-slate-500">Associer un programme</div>
                              <div className="mt-2 grid gap-2">
                                <select
                                  value={programPartnerId || String(detail.partner.id)}
                                  onChange={(e) => setProgramPartnerId(e.target.value)}
                                  className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                                >
                                  <option value="">Partenaire</option>
                                  {partners.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.raison_sociale}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={programId}
                                  onChange={(e) => setProgramId(e.target.value)}
                                  className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                                >
                                  <option value="">Programme</option>
                                  {programmes
                                    .filter((p) => !(((detail && detail.programmes) || []).some((dp: any) => dp.id === p.id)))
                                    .map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.ligne_risque}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  onClick={assignProgramme}
                                  disabled={!(programPartnerId || detail?.partner?.id) || !programId || assigningProgramme}
                                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                  {assigningProgramme ? "Association..." : "Associer"}
                                </button>
                                {programAssignError && <div className="text-xs text-red-600">{programAssignError}</div>}
                              </div>
                            </div>
                          </div>
                          </div>
                        )}

                        {activePartnerBlock === "clientele" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-700">Voir la clientèle</div>
                            <button
                              onClick={() => setActivePartnerBlock("none")}
                              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              Masquer
                            </button>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Réf. client externe</span>
                            <input
                              value={clientsRefFilter}
                              onChange={(e) => {
                                setDetailClientsPage(1);
                                setClientsRefFilter(e.target.value);
                              }}
                              placeholder="Filtrer par référence"
                              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                            />
                            <span className="text-xs uppercase tracking-wide text-slate-500">Filtre programme</span>
                            <select
                              value={clientsProgrammeFilter}
                              onChange={(e) => {
                                setDetailClientsPage(1);
                                setClientsProgrammeFilter(e.target.value);
                              }}
                              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                            >
                              <option value="">Tous</option>
                              {detailProgrammeOptions.map((p) => (
                                <option key={p.id} value={String(p.id)}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-3 rounded-xl border border-slate-200 bg-white shadow-sm">
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-4 py-2 text-left">Réf. client externe</th>
                                    <th className="px-4 py-2 text-left">Type</th>
                                    <th className="px-4 py-2 text-left">CA</th>
                                    <th className="px-4 py-2 text-left">Masse salariale</th>
                                    <th className="px-4 py-2 text-left">Programme</th>
                                    <th className="px-4 py-2 text-left">Statut contrat</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {paginatedDetailClients.map((client) => {
                                    const matchingContracts = detailContracts.filter((contract) => {
                                      if (Number(contract.client_id) !== Number(client.id)) return false;
                                      if (!clientsProgrammeFilter) return true;
                                      return String(contract.programme_id) === clientsProgrammeFilter;
                                    });
                                    const programmeLabels = Array.from(
                                      new Set(
                                        matchingContracts.map((contract) => {
                                          const programme = programmes.find((p) => p.id === contract.programme_id);
                                          return programme?.ligne_risque || `#${contract.programme_id}`;
                                        })
                                      )
                                    );
                                    const statutLabels = Array.from(new Set(matchingContracts.map((contract) => contract.statut))).filter(Boolean);
                                    return (
                                      <tr
                                        key={client.id}
                                        className="cursor-pointer hover:bg-slate-50"
                                        onClick={() => {
                                          setEditingClient(client);
                                          setShowClientModal(true);
                                        }}
                                      >
                                        <td className="px-4 py-2 font-medium text-slate-800">{client.nom || `#${client.id}`}</td>
                                        <td className="px-4 py-2 text-slate-600">{client.type || "—"}</td>
                                        <td className="px-4 py-2 text-slate-600">{formatAmount(client.chiffre_affaires)}</td>
                                        <td className="px-4 py-2 text-slate-600">{formatAmount(client.masse_salariale)}</td>
                                        <td className="px-4 py-2 text-slate-600">{programmeLabels.join(" | ") || "—"}</td>
                                        <td className="px-4 py-2 text-slate-600">{statutLabels.join(" | ") || "—"}</td>
                                      </tr>
                                    );
                                  })}
                                  {!filteredDetailClients.length && (
                                    <tr>
                                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                                        Aucun client.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                              <div className="text-xs text-slate-500">
                                {detailClientsPagination.totalItems > 0
                                  ? `Affichage ${detailClientsPagination.start + 1}-${Math.min(
                                      detailClientsPagination.end,
                                      detailClientsPagination.totalItems
                                    )} sur ${detailClientsPagination.totalItems}`
                                  : "Affichage 0 sur 0"}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setDetailClientsPage((p) => Math.max(1, p - 1))}
                                  disabled={detailClientsPagination.currentPage <= 1}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
                                >
                                  Précédent
                                </button>
                                <span className="text-xs text-slate-500">
                                  Page {detailClientsPagination.currentPage} / {detailClientsPagination.pages}
                                </span>
                                <button
                                  onClick={() => setDetailClientsPage((p) => Math.min(detailClientsPagination.pages, p + 1))}
                                  disabled={detailClientsPagination.currentPage >= detailClientsPagination.pages}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
                                >
                                  Suivant
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="text-xs font-semibold text-slate-500">Actions de création</div>
                            <div className="mt-2 flex justify-end">
                              <button
                                onClick={() => setShowNewClientModal(true)}
                                className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                              >
                                Nouveau client
                              </button>
                            </div>
                          </div>
                          </div>
                        )}

                        {activePartnerBlock === "adresses" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-700">Adresses</div>
                              <button
                                onClick={() => setActivePartnerBlock("none")}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                Masquer
                              </button>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div>
                                <div className="text-xs font-semibold text-slate-500">Adresses existantes</div>
                                <ul className="mt-2 space-y-2 text-sm">
                                  {(detail.addresses || []).map((a) => (
                                    <li key={a.id} className="rounded-md border border-slate-200 p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <div>
                                          <div className="font-medium text-slate-800">
                                            {a.type} • {a.ligne1}
                                          </div>
                                          <div className="text-xs text-slate-500">
                                            {a.code_postal || ""} {a.ville || ""} {a.pays || ""}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => setEditingAddress(a)}
                                            className="text-xs text-slate-600 underline"
                                          >
                                            modifier
                                          </button>
                                          <button
                                            onClick={() => deleteAddress(a.id)}
                                            className="text-xs text-red-600 underline"
                                          >
                                            supprimer
                                          </button>
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                  {!detail.addresses?.length && <li className="text-slate-400">Aucune adresse.</li>}
                                </ul>
                              </div>
                              <div className="mt-3 border-t border-slate-200 pt-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-slate-500">Créer / modifier une adresse</div>
                                  <button
                                    onClick={() =>
                                      setEditingAddress({
                                        id: 0,
                                        partner_id: detail.partner.id,
                                        type: "siege",
                                        ligne1: "",
                                      })
                                    }
                                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                  >
                                    Nouvelle adresse
                                  </button>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <select
                                  value={editingAddress?.type || "siege"}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, type: e.target.value as any } : s))}
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                >
                                  <option value="siege">siege</option>
                                  <option value="facturation">facturation</option>
                                  <option value="correspondance">correspondance</option>
                                  <option value="autre">autre</option>
                                </select>
                                <input
                                  value={editingAddress?.ligne1 || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, ligne1: e.target.value } : s))}
                                  placeholder="Adresse ligne 1"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.ligne2 || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, ligne2: e.target.value } : s))}
                                  placeholder="Adresse ligne 2"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.code_postal || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, code_postal: e.target.value } : s))}
                                  placeholder="Code postal"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.ville || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, ville: e.target.value } : s))}
                                  placeholder="Ville"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.region || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, region: e.target.value } : s))}
                                  placeholder="Région"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.pays || "FR"}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, pays: e.target.value.toUpperCase() } : s))}
                                  placeholder="Pays"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.email || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, email: e.target.value } : s))}
                                  placeholder="Email"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingAddress?.telephone || ""}
                                  onChange={(e) => setEditingAddress((s) => (s ? { ...s, telephone: e.target.value } : s))}
                                  placeholder="Téléphone"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={saveAddress}
                                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                  {editingAddress?.id ? "Enregistrer" : "Créer"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {activePartnerBlock === "mandataires" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-700">Dirigeants / mandataires</div>
                              <button
                                onClick={() => setActivePartnerBlock("none")}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                Masquer
                              </button>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div>
                                <div className="text-xs font-semibold text-slate-500">Mandataires existants</div>
                                <ul className="mt-2 space-y-2 text-sm">
                                  {(detail.mandataires || []).map((m) => (
                                    <li key={m.id} className="rounded-md border border-slate-200 p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <div>
                                          <div className="font-medium text-slate-800">
                                            {m.prenom ? `${m.prenom} ` : ""}
                                            {m.nom} • {m.role}
                                          </div>
                                          <div className="text-xs text-slate-500">
                                            {m.email || "—"} {m.telephone ? `• ${m.telephone}` : ""}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => setEditingMandataire(m)}
                                            className="text-xs text-slate-600 underline"
                                          >
                                            modifier
                                          </button>
                                          <button
                                            onClick={() => deleteMandataire(m.id)}
                                            className="text-xs text-red-600 underline"
                                          >
                                            supprimer
                                          </button>
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                  {!detail.mandataires?.length && <li className="text-slate-400">Aucun mandataire.</li>}
                                </ul>
                              </div>
                              <div className="mt-3 border-t border-slate-200 pt-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-slate-500">Créer / modifier un mandataire</div>
                                  <button
                                    onClick={() =>
                                      setEditingMandataire({
                                        id: 0,
                                        partner_id: detail.partner.id,
                                        nom: "",
                                        role: "gerant",
                                        email: "",
                                        telephone: "",
                                        date_debut: "",
                                      })
                                    }
                                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                  >
                                    Nouveau mandataire
                                  </button>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <input
                                  value={editingMandataire?.nom || ""}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, nom: e.target.value } : s))}
                                  placeholder="Nom"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingMandataire?.prenom || ""}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, prenom: e.target.value } : s))}
                                  placeholder="Prénom"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <select
                                  value={editingMandataire?.role || "gerant"}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, role: e.target.value } : s))}
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                >
                                  <option value="gerant">gérant</option>
                                  <option value="president">président</option>
                                  <option value="directeur_general">directeur général</option>
                                  <option value="administrateur">administrateur</option>
                                  <option value="mandataire_social">mandataire social</option>
                                  <option value="autre">autre</option>
                                </select>
                                <input
                                  value={editingMandataire?.email || ""}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, email: e.target.value } : s))}
                                  placeholder="Email (obligatoire)"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingMandataire?.telephone || ""}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, telephone: e.target.value } : s))}
                                  placeholder="Téléphone E.164 (ex: +33612345678)"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingMandataire?.date_debut || ""}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, date_debut: e.target.value } : s))}
                                  placeholder="Date début (YYYY-MM-DD) *"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  value={editingMandataire?.date_fin || ""}
                                  onChange={(e) => setEditingMandataire((s) => (s ? { ...s, date_fin: e.target.value } : s))}
                                  placeholder="Date fin (YYYY-MM-DD)"
                                  className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={saveMandataire}
                                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                  {editingMandataire?.id ? "Enregistrer" : "Créer"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {activePartnerBlock === "documents" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-700">Documents du partenaire</div>
                              <button
                                onClick={() => setActivePartnerBlock("none")}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                Masquer
                              </button>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="rounded-lg border border-slate-200 bg-white">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-600">
                                      <tr>
                                        <th className="px-4 py-2 text-left">Type</th>
                                        <th className="px-4 py-2 text-left">Nom fichier</th>
                                        <th className="px-4 py-2 text-left">Statut</th>
                                        <th className="px-4 py-2 text-left">Expiration</th>
                                        <th className="px-4 py-2 text-left">GED</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {detailDocumentsLoading && (
                                        <tr>
                                          <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                                            Chargement…
                                          </td>
                                        </tr>
                                      )}
                                      {!detailDocumentsLoading &&
                                        detailDocuments.map((d: any) => (
                                        <tr key={d.id}>
                                          <td className="px-4 py-2 text-slate-700">{d.doc_type}</td>
                                          <td className="px-4 py-2 text-slate-600">
                                            {d.file_name}
                                            {d.file_path ? (
                                              <a
                                                className="ml-2 text-xs text-blue-600 underline"
                                                href={`/api/partners/${detail.partner.id}/documents/${d.id}/view`}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                voir
                                              </a>
                                            ) : null}
                                          </td>
                                          <td className="px-4 py-2 text-slate-600">{d.status}</td>
                                          <td className="px-4 py-2 text-slate-600">{formatDate(d.expiry_date)}</td>
                                          <td className="px-4 py-2 text-slate-600">
                                            {d.storage_provider ? `${d.storage_provider} • ${d.storage_ref || ""}` : "—"}
                                          </td>
                                        </tr>
                                      ))}
                                      {!detailDocumentsLoading && !detailDocuments.length && (
                                        <tr>
                                          <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                                            Aucun document.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                              <div className="mt-3 border-t border-slate-200 pt-3">
                                <div className="text-xs font-semibold text-slate-500">Ajouter un document</div>
                                <div className="mt-2 grid gap-3 md:grid-cols-3">
                                  <select
                                    value={newDocument.doc_type}
                                    onChange={(e) => setNewDocument((s) => ({ ...s, doc_type: e.target.value }))}
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  >
                                    <option value="KBIS">KBIS</option>
                                    <option value="ID">ID</option>
                                    <option value="LCBFT">LCBFT</option>
                                    <option value="OTHER">OTHER</option>
                                  </select>
                                  <select
                                    value={newDocument.status}
                                    onChange={(e) => setNewDocument((s) => ({ ...s, status: e.target.value }))}
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  >
                                    <option value="valide">valide</option>
                                    <option value="expire">expire</option>
                                    <option value="manquant">manquant</option>
                                  </select>
                                  <input
                                    type="file"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      const reader = new FileReader();
                                      reader.onload = () => {
                                        const base64 = typeof reader.result === "string" ? reader.result : "";
                                        setNewDocument((s) => ({ ...s, file_base64: base64, file_name: file.name }));
                                      };
                                      reader.readAsDataURL(file);
                                    }}
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  />
                                  <input
                                    value={newDocument.file_name}
                                    onChange={(e) => setNewDocument((s) => ({ ...s, file_name: e.target.value }))}
                                    placeholder="Nom du fichier"
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  />
                                  <input
                                    value={newDocument.expiry_date}
                                    onChange={(e) => setNewDocument((s) => ({ ...s, expiry_date: e.target.value }))}
                                    placeholder="Date d'expiration (YYYY-MM-DD)"
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  />
                                  <input
                                    value={newDocument.storage_provider}
                                    onChange={(e) => setNewDocument((s) => ({ ...s, storage_provider: e.target.value }))}
                                    placeholder="GED (provider)"
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  />
                                  <input
                                    value={newDocument.storage_ref}
                                    onChange={(e) => setNewDocument((s) => ({ ...s, storage_ref: e.target.value }))}
                                    placeholder="Référence GED"
                                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                                  />
                                  <div className="md:col-span-2 flex justify-end">
                                    <button
                                      onClick={createDetailDocument}
                                      disabled={!newDocument.file_name}
                                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                    >
                                      Ajouter
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showNewClientModal && detail && (
              <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/55 px-4 py-12">
                <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
                    <div className="text-base font-semibold text-slate-700">Nouveau client + contrat</div>
                    <button
                      onClick={() => setShowNewClientModal(false)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Fermer
                    </button>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={newClientWithContract.nom}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, nom: e.target.value }))}
                        placeholder="Réf. client externe"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      />
                      <select
                        value={newClientWithContract.type}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, type: e.target.value }))}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="personne_morale">personne_morale</option>
                        <option value="personne_physique">personne_physique</option>
                      </select>
                      <input
                        value={newClientWithContract.chiffre_affaires}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, chiffre_affaires: e.target.value }))}
                        placeholder="CA"
                        type="number"
                        min={0}
                        step="0.01"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={newClientWithContract.masse_salariale}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, masse_salariale: e.target.value }))}
                        placeholder="Masse salariale"
                        type="number"
                        min={0}
                        step="0.01"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      />
                      <select
                        value={newClientWithContract.programme_id}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, programme_id: e.target.value }))}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="">Programme</option>
                        {((detail && detail.programmes) || []).map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.ligne_risque || p.name || p.id}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newClientWithContract.statut}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, statut: e.target.value }))}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="brouillon">brouillon</option>
                        <option value="actif">actif</option>
                        <option value="suspendu">suspendu</option>
                        <option value="resilie">resilie</option>
                      </select>
                      <input
                        value={newClientWithContract.date_debut}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, date_debut: e.target.value }))}
                        placeholder="Date début (YYYY-MM-DD)"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={newClientWithContract.date_fin}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, date_fin: e.target.value }))}
                        placeholder="Date fin (YYYY-MM-DD)"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={newClientWithContract.devise}
                        onChange={(e) => setNewClientWithContract((s) => ({ ...s, devise: e.target.value }))}
                        placeholder="Devise"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                    {newClientError && <div className="text-sm text-red-600">{newClientError}</div>}
                    <div className="flex justify-end">
                      <button
                        onClick={createClientWithContract}
                        disabled={
                          !newClientWithContract.nom ||
                          !newClientWithContract.programme_id ||
                          !newClientWithContract.date_debut ||
                          !newClientWithContract.date_fin
                        }
                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        Créer client + contrat
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {section === "assureurs" && (
          <div className="space-y-4">
            <SectionHeader
              title="Assureurs"
              description="Référentiel des assureurs utilisé dans les contrats d’assurance, fronting, réassurance et portage."
            />
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setInsurersView("creation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  insurersView === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </button>
              <button
                type="button"
                onClick={() => setInsurersView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  insurersView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {insurersView === "creation" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={insurerDraft.name}
                    onChange={(e) => setInsurerDraft({ name: e.target.value })}
                    placeholder="Nom assureur"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <button
                    onClick={createInsurer}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            )}

            {insurersView === "visualisation" && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={insurersSearch}
                      onChange={(e) => {
                        setInsurersPage(1);
                        setInsurersSearch(e.target.value);
                      }}
                      placeholder="Recherche assureur"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <div />
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-slate-500">Par page</span>
                      <select
                        value={String(insurersLimit)}
                        onChange={(e) => {
                          setInsurersPage(1);
                          setInsurersLimit(Number(e.target.value));
                        }}
                        className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                      >
                        <option value="10">10</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                      </select>
                    </div>
                  </div>
                </div>
                {insurersError && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {insurersError}
                  </div>
                )}
                <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
                  <LoadingPopup
                    show={listLoading}
                    title="Chargement des clients"
                    message="Récupération de la liste des clients et de leurs rattachements."
                  />
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                    <div>Liste des assureurs ({insurersTotal})</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2 text-left">
                            <button
                              onClick={() => toggleInsurersSort("name")}
                              className="inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              Nom <span className="text-xs">{insurersSortMarker("name")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-left">Créé le</th>
                          <th className="px-4 py-2 text-left">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {insurersLoading && (
                          <tr>
                            <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                              Chargement…
                            </td>
                          </tr>
                        )}
                        {!insurersLoading &&
                          insurersList.map((insurer) => (
                            <tr
                              key={insurer.id}
                              className="cursor-pointer hover:bg-slate-50"
                              onClick={() => {
                                setEditingInsurer(insurer);
                                setShowInsurerModal(true);
                              }}
                            >
                              <td className="px-4 py-2 font-medium text-slate-800">{insurer.name}</td>
                              <td className="px-4 py-2 text-slate-600">{formatDate(insurer.created_at)}</td>
                              <td className="px-4 py-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteInsurer(insurer.id);
                                  }}
                                  className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                                >
                                  Supprimer
                                </button>
                              </td>
                            </tr>
                          ))}
                        {!insurersLoading && !insurersList.length && (
                          <tr>
                            <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                              Aucun assureur.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
                    <div>
                      Page {insurersPage} / {Math.max(1, Math.ceil(insurersTotal / insurersLimit))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setInsurersPage((p) => Math.max(1, p - 1))}
                        disabled={insurersPage <= 1}
                        className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                      >
                        Précédent
                      </button>
                      <button
                        onClick={() => setInsurersPage((p) => p + 1)}
                        disabled={insurersPage >= Math.max(1, Math.ceil(insurersTotal / insurersLimit))}
                        className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
            {showInsurerModal && editingInsurer && (
              <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10">
                <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
                    <div className="text-base font-semibold text-slate-700">Modifier l’assureur</div>
                    <button
                      onClick={() => {
                        setShowInsurerModal(false);
                        setEditingInsurer(null);
                      }}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Fermer
                    </button>
                  </div>
                  <div className="space-y-4 px-6 py-5">
                    <input
                      value={editingInsurer.name}
                      onChange={(e) =>
                        setEditingInsurer((current) => (current ? { ...current, name: e.target.value } : current))
                      }
                      placeholder="Nom assureur"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setShowInsurerModal(false);
                          setEditingInsurer(null);
                        }}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={saveInsurer}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        Enregistrer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {section === "correspondants" && (
          <div className="space-y-4">
            <SectionHeader title="Correspondants" description="Commerciaux et back-office rattachés." />
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setCorrespondantsView("creation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  correspondantsView === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </button>
              <button
                type="button"
                onClick={() => setCorrespondantsView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  correspondantsView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {correspondantsView === "creation" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-4">
                  <select
                    value={newCorrespondant.type}
                    onChange={(e) => setNewCorrespondant((s) => ({ ...s, type: e.target.value as any }))}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="commercial">commercial</option>
                    <option value="back_office">back_office</option>
                  </select>
                  <input
                    value={newCorrespondant.nom}
                    onChange={(e) => setNewCorrespondant((s) => ({ ...s, nom: e.target.value }))}
                    placeholder="Nom"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newCorrespondant.email}
                    onChange={(e) => setNewCorrespondant((s) => ({ ...s, email: e.target.value }))}
                    placeholder="Email"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newCorrespondant.telephone || ""}
                    onChange={(e) => setNewCorrespondant((s) => ({ ...s, telephone: e.target.value }))}
                    placeholder="Téléphone"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={createCorrespondant}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Ajouter un correspondant
                  </button>
                </div>
              </div>
            )}

            {correspondantsView === "visualisation" && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={clientsSearch}
                      onChange={(e) => {
                        setClientsPage(1);
                        setClientsSearch(e.target.value);
                      }}
                      placeholder="Recherche client"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <input
                      value={clientsPartnerQuery}
                      onChange={(e) => {
                        setClientsPage(1);
                        setClientsPartnerQuery(e.target.value);
                      }}
                      placeholder="Recherche partenaire (nom ou SIREN)"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-xs text-slate-500">Par page</span>
                      <select
                        value={String(clientsLimit)}
                        onChange={(e) => {
                          setClientsPage(1);
                          setClientsLimit(Number(e.target.value));
                        }}
                        className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                      >
                        <option value="10">10</option>
                        <option value="15">15</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                    Liste des correspondants
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2 text-left">Nom</th>
                          <th className="px-4 py-2 text-left">Type</th>
                          <th className="px-4 py-2 text-left">Email</th>
                          <th className="px-4 py-2 text-left">Téléphone</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {listLoading && (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                              Chargement…
                            </td>
                          </tr>
                        )}
                        {!listLoading &&
                          correspondantsList.map((c) => (
                            <tr
                              key={c.id}
                              className="cursor-pointer hover:bg-slate-50"
                              onClick={() => {
                                setEditingCorrespondant(c);
                                setShowCorrespondantModal(true);
                              }}
                            >
                              <td className="px-4 py-2 font-medium text-slate-800">{c.nom}</td>
                              <td className="px-4 py-2 text-slate-600">{c.type}</td>
                              <td className="px-4 py-2 text-slate-600">{c.email}</td>
                              <td className="px-4 py-2 text-slate-600">{c.telephone || "—"}</td>
                            </tr>
                          ))}
                        {!listLoading && !correspondantsList.length && (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                              Aucun correspondant.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {showCorrespondantModal && editingCorrespondant && (
              <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10">
                <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
                    <div className="text-base font-semibold text-slate-700">
                      {editingCorrespondant.id ? "Modifier le correspondant" : "Ajouter un correspondant"}
                    </div>
                    <button
                      onClick={() => setShowCorrespondantModal(false)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Fermer
                    </button>
                  </div>
                  <div className="px-6 py-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        value={editingCorrespondant.type}
                        onChange={(e) => setEditingCorrespondant((s) => (s ? { ...s, type: e.target.value as any } : s))}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="commercial">commercial</option>
                        <option value="back_office">back_office</option>
                      </select>
                      <input
                        value={editingCorrespondant.nom}
                        onChange={(e) => setEditingCorrespondant((s) => (s ? { ...s, nom: e.target.value } : s))}
                        placeholder="Nom"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                      <input
                        value={editingCorrespondant.email}
                        onChange={(e) => setEditingCorrespondant((s) => (s ? { ...s, email: e.target.value } : s))}
                        placeholder="Email"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                      <input
                        value={editingCorrespondant.telephone || ""}
                        onChange={(e) => setEditingCorrespondant((s) => (s ? { ...s, telephone: e.target.value } : s))}
                        placeholder="Téléphone"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={saveCorrespondant}
                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        {editingCorrespondant.id ? "Enregistrer" : "Créer"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {section === "clients" && (
          <div className="space-y-4">
            <SectionHeader title="Clients" description="Clients rattachés aux partenaires." />
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setClientsView("creation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  clientsView === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </button>
              <button
                type="button"
                onClick={() => setClientsView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  clientsView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {clientsView === "creation" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-6">
                  <input
                    value={newClient.nom}
                    onChange={(e) => setNewClient((s) => ({ ...s, nom: e.target.value }))}
                    placeholder="Réf. client externe"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <select
                    value={newClient.type}
                    onChange={(e) => setNewClient((s) => ({ ...s, type: e.target.value }))}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="personne_morale">personne_morale</option>
                    <option value="personne_physique">personne_physique</option>
                  </select>
                  <select
                    value={newClient.partner_id}
                    onChange={(e) => setNewClient((s) => ({ ...s, partner_id: e.target.value }))}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="">Partenaire</option>
                    {partners.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.raison_sociale}
                      </option>
                    ))}
                  </select>
                  <input
                    value={newClient.chiffre_affaires}
                    onChange={(e) => setNewClient((s) => ({ ...s, chiffre_affaires: e.target.value }))}
                    placeholder="CA"
                    type="number"
                    min={0}
                    step="0.01"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newClient.masse_salariale}
                    onChange={(e) => setNewClient((s) => ({ ...s, masse_salariale: e.target.value }))}
                    placeholder="Masse salariale"
                    type="number"
                    min={0}
                    step="0.01"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <button
                    onClick={createClient}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            )}

            {clientsView === "visualisation" && (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
                    <div className="text-2xl font-semibold text-slate-800">{formatAmount(clientsKpi.total)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Personnes morales</div>
                    <div className="text-2xl font-semibold text-slate-800">{formatAmount(clientsKpi.personnesMorales)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Personnes physiques</div>
                    <div className="text-2xl font-semibold text-slate-800">{formatAmount(clientsKpi.personnesPhysiques)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Taux de rattachement</div>
                    <div className="text-2xl font-semibold text-slate-800">
                      {`${clientsKpi.tauxRattachement.toFixed(2)}%`}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={clientsSearch}
                      onChange={(e) => {
                        setClientsPage(1);
                        setClientsSearch(e.target.value);
                      }}
                      placeholder="Recherche client"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <input
                      value={clientsPartnerQuery}
                      onChange={(e) => {
                        setClientsPage(1);
                        setClientsPartnerQuery(e.target.value);
                      }}
                      placeholder="Recherche partenaire"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-xs text-slate-500">Par page</span>
                      <select
                        value={String(clientsLimit)}
                        onChange={(e) => {
                          setClientsPage(1);
                          setClientsLimit(Number(e.target.value));
                        }}
                        className="rounded-md border border-slate-200 px-2 py-2 text-sm"
                      >
                        <option value="10">10</option>
                        <option value="15">15</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                    <div>Liste des clients</div>
                    <div className="text-xs text-slate-500">{clientsTotal} total</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[1200px] text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2 text-left whitespace-nowrap">
                            <button onClick={() => toggleClientsSort("nom")} className="inline-flex items-center gap-1 hover:text-slate-900">
                              Nom <span className="text-xs">{clientsSortMarker("nom")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-left whitespace-nowrap">Type</th>
                          <th className="px-4 py-2 text-right whitespace-nowrap">
                            <button
                              onClick={() => toggleClientsSort("chiffre_affaires")}
                              className="inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              CA <span className="text-xs">{clientsSortMarker("chiffre_affaires")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-right whitespace-nowrap">
                            <button
                              onClick={() => toggleClientsSort("masse_salariale")}
                              className="inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              Masse salariale <span className="text-xs">{clientsSortMarker("masse_salariale")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-left whitespace-nowrap">
                            <button
                              onClick={() => toggleClientsSort("partner")}
                              className="inline-flex items-center gap-1 hover:text-slate-900"
                            >
                              Partenaire <span className="text-xs">{clientsSortMarker("partner")}</span>
                            </button>
                          </th>
                          <th className="px-4 py-2 text-left whitespace-nowrap">SIREN partenaire</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {!listLoading &&
                          clientsList.map((c) => {
                            const partner = partners.find((p) => p.id === c.partner_id);
                            return (
                              <tr
                                key={c.id}
                                className="cursor-pointer hover:bg-slate-50"
                                onClick={() => {
                                  setEditingClient(c);
                                  setShowClientModal(true);
                                  setClientSaveError(null);
                                }}
                              >
                                <td className="px-4 py-2 font-medium text-blue-700 underline underline-offset-2 whitespace-nowrap">{c.nom}</td>
                                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{c.type}</td>
                                <td className="px-4 py-2 text-slate-600 text-right whitespace-nowrap tabular-nums">{formatAmount(c.chiffre_affaires)}</td>
                                <td className="px-4 py-2 text-slate-600 text-right whitespace-nowrap tabular-nums">{formatAmount(c.masse_salariale)}</td>
                                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                                  {c.partner_name || partner?.raison_sociale || (c.partner_id ? `#${c.partner_id}` : "—")}
                                </td>
                                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{c.partner_siren || partner?.siren || "—"}</td>
                              </tr>
                            );
                          })}
                        {!listLoading && !clientsList.length && (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                              Aucun client.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
                    <div>
                      Page {clientsPage} / {Math.max(1, Math.ceil(clientsTotal / clientsLimit))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setClientsPage((p) => Math.max(1, p - 1))}
                        disabled={clientsPage <= 1}
                        className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                      >
                        Précédent
                      </button>
                      <button
                        onClick={() => setClientsPage((p) => p + 1)}
                        disabled={clientsPage >= Math.max(1, Math.ceil(clientsTotal / clientsLimit))}
                        className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {section === "contrats" && (
          <div className="space-y-4" ref={contractListTopRef}>
            <SectionHeader
              title="Contrats <-> clients"
              description="Gestion des contrats clients associés aux partenaires."
            />
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setContractClientView("apparaige")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  contractClientView === "apparaige" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Apparaige
              </button>
              <button
                type="button"
                onClick={() => setContractClientView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  contractClientView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {contractClientView === "visualisation" && (
              <div className="grid gap-3 md:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Appairages total</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(contractClientVisualKpis.total)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Lignes (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(contractClientVisualKpis.pageCount)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Actifs (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(contractClientVisualKpis.active)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Partenaires (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(contractClientVisualKpis.uniquePartners)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Clients (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(contractClientVisualKpis.uniqueClients)}</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-5">
                <input
                  value={contractClientPartnerInput}
                  onChange={(e) => setContractClientPartnerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyContractFilters();
                    }
                  }}
                  placeholder="Recherche partenaire (Entrée pour filtrer)"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
                <input
                  value={contractClientSearchInput}
                  onChange={(e) => setContractClientSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyContractFilters();
                    }
                  }}
                  placeholder="Recherche client (Entrée pour filtrer)"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
                <select
                  value={contractClientS2Filter}
                  onChange={(e) => setContractClientS2Filter(e.target.value)}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="">Filtre contrats (code S2)</option>
                  {contractS2Options.map((s2) => (
                    <option key={`contract-s2-${s2.code}`} value={s2.code}>
                      {s2.label}
                    </option>
                  ))}
                </select>
                <input
                  value={contractClientLineFilter}
                  onChange={(e) => setContractClientLineFilter(e.target.value)}
                  placeholder="Filtre contrats (ligne)"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
                <button
                  onClick={() => {
                    setContractClientPage(1);
                    setContractClientSearch("");
                    setContractClientPartnerFilter("");
                    setContractClientSearchInput("");
                    setContractClientPartnerInput("");
                    setContractClientS2Filter("");
                    setContractClientLineFilter("");
                  }}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Réinitialiser filtres
                </button>
              </div>
              <div className="mt-2">
                <button
                  onClick={applyContractFilters}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Appliquer les filtres
                </button>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Clients éligibles: {eligibleContractClientsCount} • Clients affichés: {filteredContractClients.length}
              </div>
            </div>

            {contractClientView === "apparaige" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Clients ({filteredContractClients.length})
                    </div>
                    <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {filteredContractClients.map((client) => {
                        const active = String(client.id) === selectedContractClientId;
                        const partnerLabel =
                          client.partner_name ||
                          partners.find((partner) => Number(partner.id) === Number(client.partner_id))?.raison_sociale ||
                          "Sans partenaire";
                        return (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => setSelectedContractClientId(String(client.id))}
                            className={`w-full px-3 py-2 text-left text-sm ${active ? "bg-blue-50 text-blue-900" : "hover:bg-slate-50"}`}
                          >
                            <div className="font-medium">{client.nom}</div>
                            <div className="text-xs text-slate-500">
                              {partnerLabel} • #{client.id}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              CA {formatAmount(client.chiffre_affaires)} • Masse salariale {formatAmount(client.masse_salariale)}
                            </div>
                          </button>
                        );
                      })}
                      {!filteredContractClients.length && (
                        <div className="px-3 py-4 text-sm text-slate-500">Aucun client trouvé.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Contrats ({filteredContractProgrammes.length})
                    </div>
                    {!selectedContractClient && (
                      <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Sélectionnez d’abord un client pour autoriser l&apos;appairage des contrats.
                      </div>
                    )}
                    {!!selectedContractClient && !selectedContractClient.partner_id && (
                      <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Ce client n&apos;est rattaché à aucun partenaire, l&apos;appairage est bloqué.
                      </div>
                    )}
                    <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {filteredContractProgrammes.map((programme) => {
                        const programmeId = String(programme.id);
                        const selected = selectedContractProgrammeIds.includes(programmeId);
                        const alreadyLinked = selectedContractExistingProgrammeIds.has(programmeId);
                        const disabled =
                          contractPairingBusy || !selectedContractClient || !selectedContractClient.partner_id || alreadyLinked;
                        return (
                          <button
                            key={programme.id}
                            type="button"
                            onClick={() => toggleContractProgrammeSelection(programmeId)}
                            disabled={disabled}
                            className={`w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed ${
                              selected
                                ? "bg-blue-50 text-blue-900"
                                : alreadyLinked
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "hover:bg-slate-50"
                            } ${!selectedContractClient ? "opacity-60" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{programme.ligne_risque}</div>
                              <span className="text-[11px] uppercase tracking-wide">
                                {alreadyLinked ? "Déjà appairé" : selected ? "Sélectionné" : "À appairer"}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              S2 {programme.branch_s2_code || "—"} • #{programme.id}
                            </div>
                          </button>
                        );
                      })}
                      {!filteredContractProgrammes.length && (
                        <div className="px-3 py-4 text-sm text-slate-500">Aucun contrat trouvé.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={createContractClientPairings}
                    disabled={
                      contractPairingBusy ||
                      !selectedContractClient ||
                      !selectedContractClient.partner_id ||
                      !selectedContractProgrammeIds.length ||
                      !selectedContractCreatableIds.length
                    }
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {contractPairingBusy
                      ? "Appairage..."
                      : selectedContractCreatableIds.length
                        ? `Appairer la sélection (${selectedContractCreatableIds.length})`
                        : "Aucun nouveau contrat"}
                  </button>
                  <span className="text-xs text-slate-500">
                    {selectedContractProgrammeIds.length} contrat(s) sélectionné(s)
                  </span>
                  {contractPairingError && <span className="text-sm text-rose-600">{contractPairingError}</span>}
                  {contractPairingInfo && <span className="text-sm text-emerald-700">{contractPairingInfo}</span>}
                </div>
              </div>
            )}

            {contractClientView === "visualisation" && (
              <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
                <LoadingPopup
                  show={contractClientVisualLoading}
                  title="Chargement des contrats / clients"
                  message="Récupération des appairages et filtres appliqués."
                />
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                  Appairages existants ({contractClientVisualTotal})
                </div>
                <div className="overflow-x-auto">
                  <table
                    className="min-w-full text-sm"
                    key={`${contractClientSearch}|${contractClientPartnerFilter}|${contractClientS2Filter}|${contractClientLineFilter}|${contractClientPage}`}
                  >
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 text-left">Partenaire</th>
                        <th className="px-4 py-2 text-left">Client</th>
                        <th className="px-4 py-2 text-right">CA</th>
                        <th className="px-4 py-2 text-right">Masse salariale</th>
                        <th className="px-4 py-2 text-left">Contrat</th>
                        <th className="px-4 py-2 text-center">Statut</th>
                        <th className="px-4 py-2 text-left">Période</th>
                        <th className="px-4 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!contractClientVisualLoading &&
                        contractClientVisualRows.map((contract) => {
                          return (
                          <tr
                            key={contract.id}
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => {
                              setSelectedContractDetail(contract);
                              setShowContractModal(true);
                            }}
                          >
                            <td className="px-4 py-2 text-slate-600">
                              {contract.partner_name ?? `#${contract.partner_id}`}
                            </td>
                        <td className="px-4 py-2 text-slate-600">
                          {contract.client_nom ?? `#${contract.client_id}`}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600 tabular-nums">
                          {formatAmount(contract.client_chiffre_affaires)}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600 tabular-nums">
                          {formatAmount(contract.client_masse_salariale)}
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {contract.ligne_risque ?? `#${contract.programme_id}`}
                        </td>
                        <td className="px-4 py-2 text-center text-slate-600">{contract.statut}</td>
                            <td className="px-4 py-2 text-slate-600">
                              {formatDate(contract.date_debut)} → {formatDate(contract.date_fin)}
                            </td>
                            <td className="px-4 py-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteContractPairing(contract.id);
                                }}
                                className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                              >
                                Retirer
                              </button>
                            </td>
                          </tr>
                        )})}
                      {!contractClientVisualLoading && !contractClientVisualRows.length && (
                        <tr>
                          <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                            Aucun appairage trouvé.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                  <div>
                    Page {contractClientPage} / {Math.max(1, Math.ceil(contractClientVisualTotal / 25))} • 25 / page
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setContractClientPage((p) => Math.max(1, p - 1))}
                      disabled={contractClientPage <= 1 || contractClientVisualLoading}
                      className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                    >
                      Précédent
                    </button>
                    <button
                      onClick={() =>
                        setContractClientPage((p) => Math.min(Math.max(1, Math.ceil(contractClientVisualTotal / 25)), p + 1))
                      }
                      disabled={
                        contractClientVisualLoading ||
                        contractClientPage >= Math.max(1, Math.ceil(contractClientVisualTotal / 25))
                      }
                      className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {section === "contrats-partenaires" && (
          <div className="space-y-4">
            <SectionHeader
              title="Contrats <-> partenaires"
              description="Appairage des partenaires avec les contrats d’assurance (filtres par nom partenaire, code S2 et ligne)."
            />

            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setPartnerProgrammeView("apparaige")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  partnerProgrammeView === "apparaige" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Apparaige
              </button>
              <button
                type="button"
                onClick={() => setPartnerProgrammeView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  partnerProgrammeView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {partnerProgrammeView === "visualisation" && (
              <div className="grid gap-3 md:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Appairages total</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(partnerProgrammeVisualKpis.total)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Lignes (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(partnerProgrammeVisualKpis.pageCount)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Actifs (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(partnerProgrammeVisualKpis.activeLinks)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Partenaires (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(partnerProgrammeVisualKpis.uniquePartners)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Contrats (page)</div>
                  <div className="text-xl font-semibold text-slate-800">{formatAmount(partnerProgrammeVisualKpis.uniqueProgrammes)}</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-4">
                <input
                  value={partnerProgrammePartnerFilter}
                  onChange={(e) => setPartnerProgrammePartnerFilter(e.target.value)}
                  placeholder="Filtre partenaires (nom)"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
                <select
                  value={partnerProgrammeS2Filter}
                  onChange={(e) => setPartnerProgrammeS2Filter(e.target.value.toUpperCase())}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="">Filtres contrats (code S2)</option>
                  {partnerProgrammeS2Options.map((code) => (
                    <option key={`pp-s2-${code}`} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <select
                  value={partnerProgrammeLineFilter}
                  onChange={(e) => setPartnerProgrammeLineFilter(e.target.value)}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="">Filtres contrats (lignes)</option>
                  {partnerProgrammeLineOptions.map((line) => (
                    <option key={`pp-line-${line}`} value={line}>
                      {line}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setPartnerProgrammePartnerFilter("");
                    setPartnerProgrammeS2Filter("");
                    setPartnerProgrammeLineFilter("");
                  }}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Réinitialiser filtres
                </button>
              </div>
            </div>

            {partnerProgrammeView === "apparaige" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Partenaires ({filteredPairPartners.length})
                    </div>
                    <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {filteredPairPartners.map((partner) => {
                        const active = String(partner.id) === selectedPairPartnerId;
                        return (
                          <button
                            key={partner.id}
                            type="button"
                            onClick={() => setSelectedPairPartnerId(String(partner.id))}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                              active ? "bg-blue-50 text-blue-900" : "hover:bg-slate-50"
                            }`}
                          >
                            <span className="font-medium">{partner.raison_sociale}</span>
                            <span className="text-xs text-slate-500">#{partner.id}</span>
                          </button>
                        );
                      })}
                      {!filteredPairPartners.length && (
                        <div className="px-3 py-4 text-sm text-slate-500">Aucun partenaire trouvé.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Contrats ({filteredPairProgrammes.length})
                    </div>
                    {!selectedPairPartnerId && (
                      <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Sélectionnez d’abord un partenaire pour autoriser l&apos;appairage des contrats.
                      </div>
                    )}
                    <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {filteredPairProgrammes.map((programme) => {
                        const programmeId = String(programme.id);
                        const selected = selectedPairProgrammeIds.includes(programmeId);
                        const alreadyLinked = selectedPairExistingProgrammeIds.has(programmeId);
                        const disabled = pairingBusy || !selectedPairPartnerId || alreadyLinked;
                        return (
                          <button
                            key={programme.id}
                            type="button"
                            onClick={() => togglePairProgrammeSelection(programmeId)}
                            disabled={disabled}
                            className={`w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed ${
                              selected
                                ? "bg-blue-50 text-blue-900"
                                : alreadyLinked
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "hover:bg-slate-50"
                            } ${!selectedPairPartnerId ? "opacity-60" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{programme.ligne_risque}</div>
                              <span className="text-[11px] uppercase tracking-wide">
                                {alreadyLinked ? "Déjà appairé" : selected ? "Sélectionné" : "À appairer"}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              S2 {programme.branch_s2_code || "—"} • #{programme.id}
                            </div>
                          </button>
                        );
                      })}
                      {!filteredPairProgrammes.length && (
                        <div className="px-3 py-4 text-sm text-slate-500">Aucun contrat trouvé.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={createPartnerProgrammePairing}
                    disabled={pairingBusy || !selectedPairPartnerId || !selectedPairProgrammeIds.length || !selectedPairCreatableIds.length}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pairingBusy
                      ? "Appairage..."
                      : selectedPairCreatableIds.length
                        ? `Appairer la sélection (${selectedPairCreatableIds.length})`
                        : "Aucun nouveau contrat"}
                  </button>
                  <span className="text-xs text-slate-500">
                    {selectedPairProgrammeIds.length} contrat(s) sélectionné(s)
                  </span>
                  {pairingError && <span className="text-sm text-rose-600">{pairingError}</span>}
                  {pairingInfo && <span className="text-sm text-emerald-700">{pairingInfo}</span>}
                </div>
              </div>
            )}

            {partnerProgrammeView === "visualisation" && (
              <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
                <LoadingPopup
                  show={partnerProgrammeVisualLoading}
                  title="Chargement des contrats / partenaires"
                  message="Récupération des appairages partenaires et programmes."
                />
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                  Appairages existants ({partnerProgrammeVisualTotal})
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 text-left">Partenaire</th>
                        <th className="px-4 py-2 text-left">Code S2</th>
                        <th className="px-4 py-2 text-left">Ligne</th>
                        <th className="px-4 py-2 text-left">Statut contrat</th>
                        <th className="px-4 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!partnerProgrammeVisualLoading &&
                        partnerProgrammeVisualRows.map((link) => (
                          <tr key={`${link.partner_id}-${link.programme_id}`}>
                            <td className="px-4 py-2 text-slate-700">{link.partner_name}</td>
                            <td className="px-4 py-2 text-slate-600">{link.branch_s2_code || "—"}</td>
                            <td className="px-4 py-2 text-slate-600">{link.ligne_risque}</td>
                            <td className="px-4 py-2 text-slate-600">{link.programme_statut || "—"}</td>
                            <td className="px-4 py-2">
                              <button
                                onClick={() => deletePartnerProgrammePairing(link.partner_id, link.programme_id)}
                                className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                              >
                                Retirer
                              </button>
                            </td>
                          </tr>
                        ))}
                      {!partnerProgrammeVisualLoading && !partnerProgrammeVisualRows.length && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                            Aucun appairage trouvé.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                  <div>
                    Page {partnerProgrammePage} / {Math.max(1, Math.ceil(partnerProgrammeVisualTotal / 25))} • 25 / page
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPartnerProgrammePage((p) => Math.max(1, p - 1))}
                      disabled={partnerProgrammePage <= 1 || partnerProgrammeVisualLoading}
                      className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                    >
                      Précédent
                    </button>
                    <button
                      onClick={() =>
                        setPartnerProgrammePage((p) =>
                          Math.min(Math.max(1, Math.ceil(partnerProgrammeVisualTotal / 25)), p + 1)
                        )
                      }
                      disabled={
                        partnerProgrammeVisualLoading ||
                        partnerProgrammePage >= Math.max(1, Math.ceil(partnerProgrammeVisualTotal / 25))
                      }
                      className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {section === "documents" && (
          <div className="space-y-4">
            <SectionHeader title="Documents partenaires" description="Pièces Kbis, ID et LCBFT." />

            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setDocumentsView("creation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  documentsView === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </button>
              <button
                type="button"
                onClick={() => setDocumentsView("visualisation")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  documentsView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </button>
            </div>

            {documentsView === "creation" && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <select
                    value={docsPartnerId}
                    onChange={(e) => setDocsPartnerId(e.target.value)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="">Sélectionner un partenaire</option>
                    {docsPartners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.raison_sociale}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newDocument.doc_type}
                    onChange={(e) => setNewDocument((s) => ({ ...s, doc_type: e.target.value }))}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="KBIS">KBIS</option>
                    <option value="ID">ID</option>
                    <option value="LCBFT">LCBFT</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                  <select
                    value={newDocument.status}
                    onChange={(e) => setNewDocument((s) => ({ ...s, status: e.target.value }))}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="valide">valide</option>
                    <option value="expire">expire</option>
                    <option value="manquant">manquant</option>
                  </select>
                  <input
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = typeof reader.result === "string" ? reader.result : "";
                        setNewDocument((s) => ({ ...s, file_base64: result, file_name: file.name }));
                      };
                      reader.readAsDataURL(file);
                    }}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newDocument.file_name}
                    onChange={(e) => setNewDocument((s) => ({ ...s, file_name: e.target.value }))}
                    placeholder="Nom du fichier"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newDocument.expiry_date}
                    onChange={(e) => setNewDocument((s) => ({ ...s, expiry_date: e.target.value }))}
                    placeholder="Date d'expiration (YYYY-MM-DD)"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newDocument.storage_provider}
                    onChange={(e) => setNewDocument((s) => ({ ...s, storage_provider: e.target.value }))}
                    placeholder="GED (provider)"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <input
                    value={newDocument.storage_ref}
                    onChange={(e) => setNewDocument((s) => ({ ...s, storage_ref: e.target.value }))}
                    placeholder="Référence GED"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <button
                    onClick={createDocument}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            )}

            {documentsView === "visualisation" && (
              <>
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Partenaire sélectionné</div>
                    <div className="text-xl font-semibold text-slate-800">{documentsKpis.selectedPartner ? "Oui" : "Non"}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Documents</div>
                    <div className="text-xl font-semibold text-slate-800">{formatAmount(documentsKpis.total)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Valides</div>
                    <div className="text-xl font-semibold text-emerald-700">{formatAmount(documentsKpis.valides)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Expirés</div>
                    <div className="text-xl font-semibold text-amber-700">{formatAmount(documentsKpis.expires)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Types présents</div>
                    <div className="text-xl font-semibold text-slate-800">{formatAmount(documentsKpis.typed)}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <select
                      value={docsPartnerId}
                      onChange={(e) => setDocsPartnerId(e.target.value)}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="">Sélectionner un partenaire</option>
                      {docsPartners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.raison_sociale}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                    Documents {docsPartnerId ? `(${documentsList.length})` : ""}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2 text-left">Type</th>
                          <th className="px-4 py-2 text-left">Nom fichier</th>
                          <th className="px-4 py-2 text-left">Statut</th>
                          <th className="px-4 py-2 text-left">Expiration</th>
                          <th className="px-4 py-2 text-left">GED</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {documentsLoading && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                              Chargement…
                            </td>
                          </tr>
                        )}
                        {!documentsLoading && !!docsPartnerId &&
                          documentsList.map((d) => (
                            <tr key={d.id}>
                              <td className="px-4 py-2 text-slate-700">{d.doc_type}</td>
                              <td className="px-4 py-2 text-slate-600">
                                {d.file_name}
                                {d.file_path ? (
                                  <a
                                    className="ml-2 text-xs text-blue-600 underline"
                                    href={`/api/partners/${docsPartnerId}/documents/${d.id}/view`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    voir
                                  </a>
                                ) : null}
                              </td>
                              <td className="px-4 py-2 text-slate-600">{d.status}</td>
                              <td className="px-4 py-2 text-slate-600">{formatDate(d.expiry_date)}</td>
                              <td className="px-4 py-2 text-slate-600">
                                {d.storage_provider ? `${d.storage_provider} • ${d.storage_ref || ""}` : "—"}
                              </td>
                            </tr>
                          ))}
                        {!documentsLoading && !!docsPartnerId && !documentsList.length && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                              Aucun document.
                            </td>
                          </tr>
                        )}
                        {!documentsLoading && !docsPartnerId && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                              Sélectionnez un partenaire pour afficher les documents.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

        {showClientModal && editingClient && (
          <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/55 px-4 py-12">
            <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
                <div className="text-base font-semibold text-slate-700">Client</div>
                <button
                  onClick={() => {
                    setShowClientModal(false);
                    setClientSaveError(null);
                  }}
                  className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Fermer
                </button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 md:grid-cols-5">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Réf. client externe</div>
                      <div className="mt-1 text-sm text-slate-800">{editingClient.nom || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</div>
                      <div className="mt-1 text-sm text-slate-800">{editingClient.type || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Partenaire</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {partners.find((p) => Number(p.id) === Number(editingClient.partner_id))?.raison_sociale ||
                          (editingClient.partner_id ? `#${editingClient.partner_id}` : "—")}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">CA</div>
                      <div className="mt-1 text-sm text-slate-800">{formatAmount(editingClient.chiffre_affaires)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Masse salariale</div>
                      <div className="mt-1 text-sm text-slate-800">{formatAmount(editingClient.masse_salariale)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                    Contrats souscrits
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2 text-left">Contrat</th>
                          <th className="px-4 py-2 text-left">Partenaire</th>
                          <th className="px-4 py-2 text-left">Programme</th>
                          <th className="px-4 py-2 text-left">Statut</th>
                          <th className="px-4 py-2 text-left">Période</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {clientModalContractsLoading && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                              Chargement…
                            </td>
                          </tr>
                        )}
                        {!clientModalContractsLoading &&
                          clientModalContracts.map((contract) => (
                            <tr key={contract.id}>
                              <td className="px-4 py-2 text-slate-700">#{contract.id}</td>
                              <td className="px-4 py-2 text-slate-700">
                                {partners.find((p) => Number(p.id) === Number(contract.partner_id))?.raison_sociale ||
                                  `#${contract.partner_id}`}
                              </td>
                              <td className="px-4 py-2 text-slate-700">
                                {programmes.find((p) => Number(p.id) === Number(contract.programme_id))?.ligne_risque ||
                                  `#${contract.programme_id}`}
                              </td>
                              <td className="px-4 py-2 text-slate-600">{contract.statut || "—"}</td>
                              <td className="px-4 py-2 text-slate-600">
                                {formatDate(contract.date_debut)} → {formatDate(contract.date_fin)}
                              </td>
                            </tr>
                          ))}
                        {!clientModalContractsLoading && !clientModalContracts.length && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                              Aucun contrat.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showContractModal && selectedContractDetail && (
          <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-slate-900/55 px-4 py-12">
            <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
                <div>
                  <div className="text-base font-semibold text-slate-800">
                    {selectedContractDetail.ligne_risque || "Contrat client"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {selectedContractDetail.partner_name || "Partenaire non renseigné"} •{" "}
                    {selectedContractDetail.client_nom || "Client non renseigné"}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowContractModal(false);
                    setSelectedContractDetail(null);
                  }}
                  className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Fermer
                </button>
              </div>

              <div className="px-6 py-5">
                <div className="grid gap-4">
                  {contractModalLoading && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                      Chargement du détail du contrat…
                    </div>
                  )}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-700">Synthèse</div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Statut</div>
                        <div className="mt-1 text-sm font-medium text-slate-800">{selectedContractDetail.statut || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Devise</div>
                        <div className="mt-1 text-sm font-medium text-slate-800">{selectedContractDetail.devise || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Date de début</div>
                        <div className="mt-1 text-sm font-medium text-slate-800">{formatDate(selectedContractDetail.date_debut)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Date de fin</div>
                        <div className="mt-1 text-sm font-medium text-slate-800">{formatDate(selectedContractDetail.date_fin)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Programme</div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Intitulé du programme</span>
                          <span className="text-right font-medium text-slate-800">
                            {selectedContractDetail.ligne_risque || "—"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Branche</span>
                          <span className="text-right font-medium text-slate-800">
                            {selectedContractDetail.branch_name || "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Parties prenantes</div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Partenaire</span>
                          <span className="text-right font-medium text-slate-800">
                            {selectedContractDetail.partner_name || "—"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">SIREN partenaire</span>
                          <span className="text-right font-medium text-slate-800">
                            {selectedContractDetail.partner_siren || "—"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Client</span>
                          <span className="text-right font-medium text-slate-800">
                            {selectedContractDetail.client_nom || "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Données client</div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Chiffre d'affaires</span>
                          <span className="text-right font-medium text-slate-800 tabular-nums">
                            {formatAmountDecimal(selectedContractDetail.client_chiffre_affaires, "EUR")}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Masse salariale</span>
                          <span className="text-right font-medium text-slate-800 tabular-nums">
                            {formatAmountDecimal(selectedContractDetail.client_masse_salariale, "EUR")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Traçabilité</div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Créé le</span>
                          <span className="text-right font-medium text-slate-800">
                            {formatDate(selectedContractDetail.created_at)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Mis à jour le</span>
                          <span className="text-right font-medium text-slate-800">
                            {formatDate(selectedContractDetail.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Prime (contrat)</div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Montant payé cumulé</span>
                          <span className="text-right font-medium text-slate-800 tabular-nums">
                            {formatAmountDecimal(contractModalExtra?.premiums?.summary?.total_paid, selectedContractDetail.devise || "EUR")}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Nombre de règlements de prime</span>
                          <span className="text-right font-medium text-slate-800">
                            {formatAmount(contractModalExtra?.premiums?.summary?.payments_count)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">Dernier règlement</span>
                          <span className="text-right font-medium text-slate-800">
                            {formatDate(contractModalExtra?.premiums?.summary?.last_paid_on)}
                          </span>
                        </div>
                        {(contractModalExtra?.premiums?.terms || []).slice(0, 3).map((term: any, idx: number) => (
                          <div key={`term-${idx}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="text-xs text-slate-500">
                              {term.frequency || "—"} • {formatDate(term.start_date)} → {formatDate(term.end_date)}
                            </div>
                            <div className="text-sm font-medium text-slate-800 tabular-nums">
                              {formatAmountDecimal(term.amount, term.currency || selectedContractDetail.devise || "EUR")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Garanties</div>
                      <div className="space-y-2 text-sm">
                        {(contractModalExtra?.programme?.coverages || []).slice(0, 5).map((cov: any, idx: number) => (
                          <div key={`cov-${idx}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="font-medium text-slate-800">{cov.label || "—"}</div>
                            <div className="text-xs text-slate-500">
                              Limite sinistre: {formatAmountDecimal(cov.limit_per_claim, cov.currency || "EUR")} • Limite annuelle:{" "}
                              {formatAmountDecimal(cov.limit_annual, cov.currency || "EUR")}
                            </div>
                          </div>
                        ))}
                        {!contractModalExtra?.programme?.coverages?.length && (
                          <div className="text-slate-500">Aucune garantie renseignée.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Franchises</div>
                      <div className="space-y-2 text-sm">
                        {(contractModalExtra?.programme?.deductibles || []).slice(0, 5).map((d: any, idx: number) => (
                          <div key={`ded-${idx}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="font-medium text-slate-800">
                              {formatAmountDecimal(d.amount, d.currency || "EUR")}
                            </div>
                            <div className="text-xs text-slate-500">{d.notes || d.unit || "—"}</div>
                          </div>
                        ))}
                        {!contractModalExtra?.programme?.deductibles?.length && (
                          <div className="text-slate-500">Aucune franchise renseignée.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Exclusions</div>
                      <div className="space-y-2 text-sm">
                        {(contractModalExtra?.programme?.exclusions || []).slice(0, 5).map((ex: any, idx: number) => (
                          <div key={`ex-${idx}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="font-medium text-slate-800">{ex.category || "Exclusion"}</div>
                            <div className="text-xs text-slate-500">{ex.description || "—"}</div>
                          </div>
                        ))}
                        {!contractModalExtra?.programme?.exclusions?.length && (
                          <div className="text-slate-500">Aucune exclusion renseignée.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 text-sm font-semibold text-slate-700">Conditions particulières</div>
                      <div className="space-y-2 text-sm">
                        {(contractModalExtra?.programme?.conditions || []).slice(0, 5).map((c: any, idx: number) => (
                          <div key={`cond-${idx}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="font-medium text-slate-800">{c.title || "Condition"}</div>
                            <div className="text-xs text-slate-500">{c.content || "—"}</div>
                          </div>
                        ))}
                        {!contractModalExtra?.programme?.conditions?.length && (
                          <div className="text-slate-500">Aucune condition renseignée.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

    </RequireAuth>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PartnersPage />
    </Suspense>
  );
}
