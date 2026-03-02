"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import PeriodZoomControls from "@/components/pilotage/PeriodZoomControls";
import ToggleTableHeader from "@/components/pilotage/ToggleTableHeader";
import TwoSegmentGaugePanel from "@/components/pilotage/TwoSegmentGaugePanel";
import { apiRequest } from "@/lib/api";

type PrimeBranchStat = {
  id_branch: number | null;
  s2_code?: string | null;
  name?: string | null;
  total_contracts: number;
  contracts_up_to_date: number;
  contracts_late: number;
  contracts_to_configure: number;
  compliance_pct: number;
  total_paid: string | number;
  total_outstanding: string | number;
  total_expected: string | number;
  total_late: string | number;
  total_annual_expected: string | number;
};

type PrimeContract = {
  id: number;
  partner_id: number;
  client_id: number;
  programme_id: number;
  statut: string;
  date_debut?: string | null;
  date_fin?: string | null;
  devise?: string | null;
  ligne_risque?: string | null;
  branch_s2_code?: string | null;
  id_branch?: number | null;
  branch_code?: string | null;
  branch_name?: string | null;
  client_ref?: string | null;
  partner_name?: string | null;
  premium_frequency?: "ANNUAL" | "QUARTERLY" | "MONTHLY" | null;
  premium_frequency_label?: string;
  premium_amount?: string | number | null;
  premium_currency?: string | null;
  premium_start_date?: string | null;
  premium_end_date?: string | null;
  expected_due_to_date?: string | number;
  outstanding_to_date?: string | number;
  total_paid?: string | number;
  periods_due?: number;
  next_due_date?: string | null;
  payment_status?: "a_jour" | "en_retard" | "a_configurer";
  payment_status_label?: string;
  in_compliance?: boolean;
};

type PrimeScheduleRow = {
  due_date: string;
  expected_amount: string | number;
  paid_amount: string | number;
  outstanding_amount: string | number;
  status: "payee" | "en_retard";
  status_label: string;
};

type PrimePaymentRow = {
  id: number;
  contract_id: number;
  paid_on: string;
  amount: string | number;
  currency?: string | null;
  reference?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

type PrimeDetailResponse = {
  contract: PrimeContract;
  schedule: PrimeScheduleRow[];
  payments: PrimePaymentRow[];
  totals: {
    expected_due_to_date: string | number;
    paid_to_date: string | number;
    outstanding_to_date: string | number;
    periods_due: number;
    next_due_date?: string | null;
  };
};

type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  filters?: {
    statuts?: string[];
  };
};

type PrimeTreeStats = {
  selected_branch: number | null;
  branches: PrimeBranchStat[];
};

type PrimePageBootstrapResponse = {
  stats: PrimeTreeStats;
  list: Paginated<PrimeContract>;
};

type BranchPaymentTrendMonth = {
  month: string;
  label: string;
  paid_amount: number;
  expected_amount: number;
  cumulative_paid: number;
  cumulative_expected: number;
};

type BranchPaymentTrendResponse = {
  branch: {
    id_branch: number | null;
    s2_code?: string | null;
    name?: string | null;
  };
  year: number;
  total_paid_year: number;
  total_annual_expected: number;
  months: BranchPaymentTrendMonth[];
};

const PAYMENT_STATUSES = ["a_jour", "en_retard", "a_configurer"] as const;

function formatMoney(value: string | number | null | undefined, currency = "EUR") {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const grouped = new Intl.NumberFormat("fr-FR", {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(Math.round(n))
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

function formatStatusLabel(status: string) {
  if (status === "a_jour") return "À jour";
  if (status === "en_retard") return "En retard";
  if (status === "a_configurer") return "À configurer";
  return status;
}

function statusBadgeClass(status?: string | null) {
  if (status === "a_jour") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "en_retard") return "border-red-300 bg-red-50 text-red-700";
  return "border-amber-300 bg-amber-50 text-amber-700";
}

function getErrorMessage(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "";
  const mapped: Record<string, string> = {
    forbidden_scope: "Branche non autorisée pour cette captive.",
    contract_not_found: "Contrat introuvable.",
    contract_id_invalid: "Identifiant de contrat invalide.",
  };
  return mapped[code] || code || fallback;
}

function LoadingOverlay({ visible, message }: { visible: boolean; message: string }) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900">Chargement en cours</div>
            <div className="text-sm text-slate-600">{message}</div>
            <div className="text-xs text-slate-500">
              Cette fenêtre se fermera automatiquement dès que les données seront visibles.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniTrendChart({
  months,
  annualExpected,
}: {
  months: BranchPaymentTrendMonth[];
  annualExpected: number;
}) {
  const width = 760;
  const height = 300;
  const pad = { top: 18, right: 18, bottom: 36, left: 76 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxY = Math.max(1, annualExpected, ...months.map((m) => Math.max(m.cumulative_paid, m.cumulative_expected)));
  const formatAxisKeur = (value: number) => `${(value / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k€`;

  const xFor = (idx: number) => pad.left + (months.length <= 1 ? 0 : (idx / (months.length - 1)) * innerW);
  const yFor = (v: number) => pad.top + innerH - (Math.max(0, v) / maxY) * innerH;

  const linePath = months
    .map((m, idx) => `${idx === 0 ? "M" : "L"} ${xFor(idx).toFixed(1)} ${yFor(m.cumulative_paid).toFixed(1)}`)
    .join(" ");
  const expectedCumulativePath = months
    .map((m, idx) => `${idx === 0 ? "M" : "L"} ${xFor(idx).toFixed(1)} ${yFor(m.cumulative_expected).toFixed(1)}`)
    .join(" ");

  const gridTicks = 4;
  const yTicks = Array.from({ length: gridTicks + 1 }, (_, i) => {
    const value = (maxY / gridTicks) * i;
    return { value, y: yFor(value) };
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
        <rect x={0} y={0} width={width} height={height} fill="white" />
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} y1={t.y} x2={width - pad.right} y2={t.y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.left - 10} y={t.y + 4} textAnchor="end" fontSize="11" fill="#64748b">
              {formatAxisKeur(t.value)}
            </text>
          </g>
        ))}
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="#94a3b8" strokeWidth="1" />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="#94a3b8" strokeWidth="1" />

        <path d={expectedCumulativePath} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="5 4" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2.5" />
        {months.map((m, idx) => (
          <g key={m.month}>
            <circle cx={xFor(idx)} cy={yFor(m.cumulative_paid)} r="3.5" fill="#2563eb" />
            <circle cx={xFor(idx)} cy={yFor(m.cumulative_expected)} r="2.5" fill="#059669" />
            <text x={xFor(idx)} y={height - 14} textAnchor="middle" fontSize="10" fill="#64748b">
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <div className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-blue-600" />
          <span>Versements cumulés (année)</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-emerald-600" />
          <span>Cumul attendu (estimé)</span>
        </div>
      </div>
    </div>
  );
}

function PrimesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBranchId = (() => {
    const n = Number(searchParams.get("id_branch") || 0);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const initialPartnerQuery = searchParams.get("partner_q") || "";
  const initialClientQuery = searchParams.get("client_q") || "";
  const initialContractStatus = searchParams.get("statut") || "";
  const initialPaymentStatus = searchParams.get("payment_status") || "";

  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branchStats, setBranchStats] = useState<PrimeBranchStat[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(initialBranchId);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>(initialPaymentStatus);
  const [partnerQueryFilter, setPartnerQueryFilter] = useState<string>(initialPartnerQuery);
  const [clientQueryFilter, setClientQueryFilter] = useState<string>(initialClientQuery);
  const [contractStatusFilter, setContractStatusFilter] = useState<string>(initialContractStatus);
  const [contractStatusOptions, setContractStatusOptions] = useState<string[]>([]);

  const [contracts, setContracts] = useState<PrimeContract[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PrimeDetailResponse | null>(null);
  const [branchTrendOpen, setBranchTrendOpen] = useState(false);
  const [branchTrendLoading, setBranchTrendLoading] = useState(false);
  const [branchTrendError, setBranchTrendError] = useState<string | null>(null);
  const [branchTrend, setBranchTrend] = useState<BranchPaymentTrendResponse | null>(null);
  const [branchTrendFromMonth, setBranchTrendFromMonth] = useState<string>("");
  const [branchTrendToMonth, setBranchTrendToMonth] = useState<string>("");
  const [branchTrendTableVisible, setBranchTrendTableVisible] = useState<boolean>(false);

  const maxPage = Math.max(1, Math.ceil(total / limit));
  const selectedBranch = useMemo(
    () => branchStats.find((branch) => Number(branch.id_branch || 0) === Number(selectedBranchId || 0)) || null,
    [branchStats, selectedBranchId]
  );
  const branchTrendMonthsFiltered = useMemo(() => {
    if (!branchTrend?.months?.length) return [];
    const from = branchTrendFromMonth || branchTrend.months[0]?.month || "";
    const to = branchTrendToMonth || branchTrend.months[branchTrend.months.length - 1]?.month || "";
    return branchTrend.months.filter((m) => m.month >= from && m.month <= to);
  }, [branchTrend, branchTrendFromMonth, branchTrendToMonth]);
  const branchTrendPeriodSummary = useMemo(() => {
    if (!branchTrend?.months?.length) return null;
    const first = branchTrend.months[0];
    const last = branchTrend.months[branchTrend.months.length - 1];
    const expected = Math.max(0, Number(last.cumulative_expected || 0));
    const paid = Math.max(0, Number(last.cumulative_paid || 0));
    const paidCapped = Math.min(paid, expected);
    const remaining = Math.max(expected - paidCapped, 0);
    const paidPct = expected > 0 ? (paidCapped / expected) * 100 : 0;
    const remainingPct = expected > 0 ? (remaining / expected) * 100 : 0;
    return {
      expected,
      paid,
      paidCapped,
      remaining,
      paidPct,
      remainingPct,
      from: first?.month || "",
      to: last.month,
    };
  }, [branchTrend]);
  const globalPrimesGauge = useMemo(() => {
    if (!branchStats.length) return null;
    const totalPaid = branchStats.reduce((sum, b) => sum + Math.max(0, Number(b.total_paid || 0)), 0);
    const totalExpected = branchStats.reduce((sum, b) => sum + Math.max(0, Number(b.total_expected || 0)), 0);
    const paidCapped = Math.min(totalPaid, totalExpected);
    const remaining = Math.max(totalExpected - paidCapped, 0);
    const paidPct = totalExpected > 0 ? (paidCapped / totalExpected) * 100 : 0;
    const remainingPct = totalExpected > 0 ? Math.max(100 - paidPct, 0) : 0;
    return {
      totalPaid,
      totalExpected,
      paidCapped,
      remaining,
      paidPct,
      remainingPct,
    };
  }, [branchStats]);
  const showLoadingOverlay =
    (loadingStats && !selectedBranchId && branchStats.length === 0) ||
    (loadingList && !!selectedBranchId && contracts.length === 0);
  const loadingOverlayMessage = !selectedBranchId
    ? "Chargement de la synthèse des primes par branche…"
    : "Chargement de la liste des contrats et des montants de primes…";

  const loadPageBootstrap = useCallback(async () => {
    setLoadingStats(true);
    setLoadingList(!!selectedBranchId);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (selectedBranchId) params.set("id_branch", String(selectedBranchId));
      if (partnerQueryFilter) params.set("partner_q", partnerQueryFilter);
      if (clientQueryFilter) params.set("client_q", clientQueryFilter);
      if (contractStatusFilter) params.set("statut", contractStatusFilter);
      if (paymentStatusFilter) params.set("payment_status", paymentStatusFilter);

      const payload = await apiRequest<PrimePageBootstrapResponse>(`/api/primes/page-bootstrap?${params.toString()}`);
      const stats = payload?.stats;
      const list = payload?.list;

      setBranchStats(Array.isArray(stats?.branches) ? stats.branches : []);
      setContracts(Array.isArray(list?.data) ? list.data : []);
      setTotal(Number(list?.pagination?.total || 0));
      setContractStatusOptions(Array.isArray(list?.filters?.statuts) ? list.filters?.statuts : []);
    } catch (err: unknown) {
      setBranchStats([]);
      setContracts([]);
      setTotal(0);
      setContractStatusOptions([]);
      setError(getErrorMessage(err, "Erreur de chargement des primes."));
    } finally {
      setLoadingStats(false);
      setLoadingList(false);
    }
  }, [clientQueryFilter, contractStatusFilter, limit, page, partnerQueryFilter, paymentStatusFilter, selectedBranchId]);

  const loadContractDetail = useCallback(async (contractId: number) => {
    setLoadingDetail(true);
    try {
      const payload = await apiRequest<PrimeDetailResponse>(`/api/primes/${contractId}`);
      setDetail(payload);
    } catch (err: unknown) {
      setDetail(null);
      setError(getErrorMessage(err, "Erreur de chargement du détail prime."));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadPageBootstrap().catch((err: unknown) => setError(getErrorMessage(err, "Erreur de chargement des primes.")));
  }, [loadPageBootstrap]);

  useEffect(() => {
    if (!detailOpen || !selectedContractId) return;
    loadContractDetail(selectedContractId).catch((err: unknown) =>
      setError(getErrorMessage(err, "Erreur de chargement du détail prime."))
    );
  }, [detailOpen, loadContractDetail, selectedContractId]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedBranchId) params.set("id_branch", String(selectedBranchId));
    if (partnerQueryFilter) params.set("partner_q", partnerQueryFilter);
    if (clientQueryFilter) params.set("client_q", clientQueryFilter);
    if (contractStatusFilter) params.set("statut", contractStatusFilter);
    if (paymentStatusFilter) params.set("payment_status", paymentStatusFilter);
    const suffix = params.toString();
    router.replace(suffix ? `/primes?${suffix}` : "/primes");
  }, [clientQueryFilter, contractStatusFilter, partnerQueryFilter, paymentStatusFilter, router, selectedBranchId]);

  function selectBranch(branchId: number) {
    setSelectedBranchId(branchId);
    setPage(1);
    setPaymentStatusFilter("");
    setPartnerQueryFilter("");
    setClientQueryFilter("");
    setContractStatusFilter("");
  }

  function goBackToBranches() {
    setSelectedBranchId(null);
    setPage(1);
    setPaymentStatusFilter("");
    setPartnerQueryFilter("");
    setClientQueryFilter("");
    setContractStatusFilter("");
    setContracts([]);
    setTotal(0);
    setContractStatusOptions([]);
  }

  function openContractDetail(contractId: number) {
    setSelectedContractId(contractId);
    setDetailOpen(true);
  }

  async function openBranchTrend(branch: PrimeBranchStat) {
    const id = Number(branch.id_branch || 0);
    if (!id) return;
    setBranchTrendOpen(true);
    setBranchTrendLoading(true);
    setBranchTrendError(null);
    setBranchTrend(null);
    try {
      const year = new Date().getUTCFullYear();
      const res = await apiRequest<BranchPaymentTrendResponse>(`/api/primes/stats/branch-payment-trend?id_branch=${id}&year=${year}`);
      setBranchTrend(res);
      setBranchTrendFromMonth(res.months[0]?.month || "");
      setBranchTrendToMonth(res.months[res.months.length - 1]?.month || "");
    } catch (err: unknown) {
      setBranchTrendError(getErrorMessage(err, "Erreur de chargement du graphique de versements."));
    } finally {
      setBranchTrendLoading(false);
    }
  }

  async function openGlobalTrend() {
    setBranchTrendOpen(true);
    setBranchTrendLoading(true);
    setBranchTrendError(null);
    setBranchTrend(null);
    try {
      const year = new Date().getUTCFullYear();
      const res = await apiRequest<BranchPaymentTrendResponse>(`/api/primes/stats/global-payment-trend?year=${year}`);
      setBranchTrend(res);
      setBranchTrendFromMonth(res.months[0]?.month || "");
      setBranchTrendToMonth(res.months[res.months.length - 1]?.month || "");
      setBranchTrendTableVisible(false);
    } catch (err: unknown) {
      setBranchTrendError(getErrorMessage(err, "Erreur de chargement du graphique global des versements."));
    } finally {
      setBranchTrendLoading(false);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-6">
        <LoadingOverlay visible={showLoadingOverlay} message={loadingOverlayMessage} />
        <div className="space-y-1">
          <PageTitle
            title="Primes"
            titleAddon={
              <button
                type="button"
                onClick={() => {
                  void openGlobalTrend();
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Afficher le graphique global des primes"
                title="Graphique global des primes"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 3v14h14" />
                  <path d="M5 13l3-3 3 2 4-5" />
                  <circle cx="5" cy="13" r="0.7" fill="currentColor" stroke="none" />
                  <circle cx="8" cy="10" r="0.7" fill="currentColor" stroke="none" />
                  <circle cx="11" cy="12" r="0.7" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="7" r="0.7" fill="currentColor" stroke="none" />
                </svg>
              </button>
            }
            description="Synthèse par branche puis liste des contrats, avec suivi des primes annuelles, trimestrielles et mensuelles."
          />
          {globalPrimesGauge ? (
            <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>Jauge globale (toutes branches) - montant versé / montant total attendu (année en cours)</span>
                <span className="font-medium text-slate-700">{formatMoney(globalPrimesGauge.totalExpected, "EUR")}</span>
              </div>
              <div className="h-4 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                <div className="flex h-full w-full">
                  <div className="h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, globalPrimesGauge.paidPct))}%` }} />
                  <div className="h-full bg-slate-300" style={{ width: `${Math.max(0, Math.min(100, globalPrimesGauge.remainingPct))}%` }} />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-xs text-white">
                  Versé: <span className="font-semibold">{formatMoney(globalPrimesGauge.paidCapped, "EUR")}</span> ({globalPrimesGauge.paidPct.toFixed(1)}%)
                </div>
                <div className="rounded-md border border-slate-300 bg-slate-300 px-3 py-2 text-xs text-slate-900">
                  Reste: <span className="font-semibold">{formatMoney(globalPrimesGauge.remaining, "EUR")}</span> ({globalPrimesGauge.remainingPct.toFixed(1)}%)
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        {!selectedBranchId ? (
          <section className="space-y-3 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-800">Synthèse des primes par branche</h2>
              <div className="text-xs text-slate-600">{loadingStats ? "Mise à jour..." : `${branchStats.length} branches`}</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {branchStats.length === 0 ? (
                <div className="sm:col-span-2 xl:col-span-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                  {loadingStats ? "Chargement des statistiques..." : "Aucune donnée disponible."}
                </div>
              ) : (
                branchStats.map((branch) => {
                  const clickable = Number(branch.id_branch || 0) > 0;
                  const totalExpected = Math.max(0, Number(branch.total_expected || 0));
                  const totalPaid = Math.max(0, Number(branch.total_paid || 0));
                  const paidPct = totalExpected > 0 ? Math.min((totalPaid / totalExpected) * 100, 100) : 0;
                  const remainingAmount = Math.max(totalExpected - Math.min(totalPaid, totalExpected), 0);
                  const remainingPct = totalExpected > 0 ? Math.max(100 - paidPct, 0) : 0;
                  return (
                    <div
                      key={`${branch.id_branch || "none"}-${branch.s2_code || ""}`}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : -1}
                      onClick={clickable ? () => selectBranch(Number(branch.id_branch)) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                selectBranch(Number(branch.id_branch));
                              }
                            }
                          : undefined
                      }
                      className={`rounded-md border p-3 text-left ${
                        clickable ? "cursor-pointer border-slate-200 bg-white transition hover:border-slate-300" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">
                          {branch.s2_code || "—"} - {branch.name || "Branche"}
                        </div>
                        {clickable ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void openBranchTrend(branch);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            aria-label={`Afficher le graphique de versements pour ${branch.s2_code || "la branche"}`}
                            title="Graphique des versements"
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M3 3v14h14" />
                              <path d="M5 13l3-3 3 2 4-5" />
                              <circle cx="5" cy="13" r="0.7" fill="currentColor" stroke="none" />
                              <circle cx="8" cy="10" r="0.7" fill="currentColor" stroke="none" />
                              <circle cx="11" cy="12" r="0.7" fill="currentColor" stroke="none" />
                              <circle cx="15" cy="7" r="0.7" fill="currentColor" stroke="none" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 text-xs text-slate-700">
                        Primes versées / contrats: <span className="font-semibold">{branch.contracts_up_to_date}</span> /{" "}
                        <span className="font-semibold">{branch.total_contracts}</span> ({branch.compliance_pct}%)
                      </div>
                      <div className="mt-1 text-xs text-slate-600">En retard: {branch.contracts_late}</div>
                      <div className="mt-1 text-xs text-slate-600">À configurer: {branch.contracts_to_configure}</div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-600">
                        <span>Montant versé:</span>
                        <span className="text-right tabular-nums">{formatMoney(branch.total_paid, "EUR")}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-600">
                        <span>Montant en retard:</span>
                        <span className="text-right tabular-nums">{formatMoney(branch.total_late, "EUR")}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-600">
                        <span>Montant total attendu:</span>
                        <span className="text-right tabular-nums">{formatMoney(branch.total_expected, "EUR")}</span>
                      </div>
                      <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                        <div className="text-[11px] text-slate-600">Jauge montant versé / montant total attendu</div>
                        <div className="h-3 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                          <div className="flex h-full w-full">
                            <div className="h-full bg-blue-600" style={{ width: `${paidPct}%` }} />
                            <div className="h-full bg-slate-300" style={{ width: `${remainingPct}%` }} />
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <div className="rounded-md border border-blue-600 bg-blue-600 px-2 py-1 text-[11px] text-white">
                            Versé: <span className="font-semibold">{formatMoney(totalPaid, "EUR")}</span> ({paidPct.toFixed(1)}%)
                          </div>
                          <div className="rounded-md border border-slate-300 bg-slate-300 px-2 py-1 text-[11px] text-slate-900">
                            Reste: <span className="font-semibold">{formatMoney(remainingAmount, "EUR")}</span> ({remainingPct.toFixed(1)}%)
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        ) : (
          <section className="-mx-2 space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm lg:-mx-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-800">Liste des contrats - primes</h2>
                <p className="text-xs text-slate-600">
                  Branche active: {selectedBranch?.s2_code || "—"} - {selectedBranch?.name || "Branche"}
                </p>
              </div>
              <button
                type="button"
                onClick={goBackToBranches}
                className="h-10 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800"
              >
                Retour aux branches
              </button>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-600">Partenaire</label>
                  <input
                    type="text"
                    value={partnerQueryFilter}
                    onChange={(e) => {
                      setPartnerQueryFilter(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Nom partenaire"
                    className="h-10 min-w-[170px] rounded-md border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-600">Client</label>
                  <input
                    type="text"
                    value={clientQueryFilter}
                    onChange={(e) => {
                      setClientQueryFilter(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Réf client"
                    className="h-10 min-w-[170px] rounded-md border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-600">Statut contrat</label>
                  <select
                    value={contractStatusFilter}
                    onChange={(e) => {
                      setContractStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="h-10 min-w-[150px] rounded-md border border-slate-300 px-3 text-sm"
                  >
                    <option value="">Tous</option>
                    {contractStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-600">Statut paiement</label>
                  <select
                    value={paymentStatusFilter}
                    onChange={(e) => {
                      setPaymentStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="h-10 min-w-[150px] rounded-md border border-slate-300 px-3 text-sm"
                  >
                    <option value="">Tous</option>
                    {PAYMENT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPartnerQueryFilter("");
                    setClientQueryFilter("");
                    setContractStatusFilter("");
                    setPaymentStatusFilter("");
                    setPage(1);
                  }}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Réinitialiser filtres
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1450px] text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left">Ligne</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left">Partenaire</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left">Client</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center">Statut contrat</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left">Périodicité</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Prime / échéance</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Attendu à date</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Versé à date</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Écart</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-4 text-center text-slate-500">
                        Chargement en cours...
                      </td>
                    </tr>
                  ) : contracts.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-4 text-center text-slate-500">
                        Aucun contrat pour les filtres en cours.
                      </td>
                    </tr>
                  ) : (
                    contracts.map((contract) => (
                      <tr
                        key={contract.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openContractDetail(contract.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openContractDetail(contract.id);
                          }
                        }}
                        className={`cursor-pointer border-t border-slate-100 align-top ${
                          selectedContractId === contract.id ? "bg-blue-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2">{contract.ligne_risque || `Ligne #${contract.programme_id}`}</td>
                        <td className="whitespace-nowrap px-3 py-2">{contract.partner_name || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2">{contract.client_ref || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-center">{contract.statut || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2">{contract.premium_frequency_label || "non configurée"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatMoney(contract.premium_amount, contract.premium_currency || contract.devise || "EUR")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatMoney(contract.expected_due_to_date, contract.premium_currency || contract.devise || "EUR")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatMoney(contract.total_paid, contract.premium_currency || contract.devise || "EUR")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatMoney(contract.outstanding_to_date, contract.premium_currency || contract.devise || "EUR")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center">
                          <span
                            className={`inline-flex items-center justify-center text-center rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(contract.payment_status)}`}
                          >
                            {contract.payment_status_label || "—"}
                          </span>
                        </td>
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
          </section>
        )}

        {detailOpen ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 p-4">
            <div className="flex min-h-full items-start justify-center py-2">
              <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {detail?.contract ? `Détail contrat #${detail.contract.id}` : "Détail contrat"}
                    </h3>
                    <p className="text-xs text-slate-600">
                      {detail?.contract
                        ? `${detail.contract.ligne_risque || `Ligne #${detail.contract.programme_id}`} • ${detail.contract.partner_name || "Partenaire"}`
                        : "Chargement du contrat..."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailOpen(false);
                      setDetail(null);
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Fermer
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {loadingDetail || !detail ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Chargement...
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-6">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Statut: <span className="font-semibold">{detail.contract.payment_status_label || "—"}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Périodicité: <span className="font-semibold">{detail.contract.premium_frequency_label || "non configurée"}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Prime / échéance:{" "}
                          <span className="font-semibold">
                            {formatMoney(
                              detail.contract.premium_amount,
                              detail.contract.premium_currency || detail.contract.devise || "EUR"
                            )}
                          </span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Attendu à date:{" "}
                          <span className="font-semibold">
                            {formatMoney(
                              detail.totals.expected_due_to_date,
                              detail.contract.premium_currency || detail.contract.devise || "EUR"
                            )}
                          </span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Versé à date:{" "}
                          <span className="font-semibold">
                            {formatMoney(
                              detail.totals.paid_to_date,
                              detail.contract.premium_currency || detail.contract.devise || "EUR"
                            )}
                          </span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Écart:{" "}
                          <span className="font-semibold">
                            {formatMoney(
                              detail.totals.outstanding_to_date,
                              detail.contract.premium_currency || detail.contract.devise || "EUR"
                            )}
                          </span>
                        </div>
                      </div>

                      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calendrier des échéances</h4>
                        <div className="text-xs text-slate-600">
                          Début: {formatDate(detail.contract.premium_start_date || detail.contract.date_debut)} • Fin: {" "}
                          {formatDate(detail.contract.premium_end_date || detail.contract.date_fin)} • Prochaine échéance: {" "}
                          {formatDate(detail.totals.next_due_date || null)}
                        </div>
                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-3 py-2 text-left">Échéance</th>
                                <th className="px-3 py-2 text-right">Attendu</th>
                                <th className="px-3 py-2 text-right">Payé</th>
                                <th className="px-3 py-2 text-right">Reste</th>
                                <th className="px-3 py-2 text-left">Statut</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.schedule.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                    Aucun échéancier calculable. Configuration de prime manquante sur ce contrat.
                                  </td>
                                </tr>
                              ) : (
                                detail.schedule.map((row) => (
                                  <tr key={row.due_date} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-xs text-slate-700">{formatDate(row.due_date)}</td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">
                                      {formatMoney(
                                        row.expected_amount,
                                        detail.contract.premium_currency || detail.contract.devise || "EUR"
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">
                                      {formatMoney(
                                        row.paid_amount,
                                        detail.contract.premium_currency || detail.contract.devise || "EUR"
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">
                                      {formatMoney(
                                        row.outstanding_amount,
                                        detail.contract.premium_currency || detail.contract.devise || "EUR"
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-700">{row.status_label}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>

                      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Versements enregistrés</h4>
                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-3 py-2 text-left">Date</th>
                                <th className="px-3 py-2 text-right">Montant</th>
                                <th className="px-3 py-2 text-left">Référence</th>
                                <th className="px-3 py-2 text-left">Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.payments.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                    Aucun versement enregistré.
                                  </td>
                                </tr>
                              ) : (
                                detail.payments.map((payment) => (
                                  <tr key={payment.id} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-xs text-slate-700">{formatDate(payment.paid_on)}</td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">
                                      {formatMoney(
                                        payment.amount,
                                        payment.currency || detail.contract.premium_currency || detail.contract.devise || "EUR"
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-700">{payment.reference || "—"}</td>
                                    <td className="px-3 py-2 text-xs text-slate-700">{payment.notes || "—"}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {branchTrendOpen ? (
          <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/35 p-4">
            <div className="flex min-h-full items-start justify-center py-4">
              <div className="w-full max-w-5xl rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Évolution des versements de primes</h3>
                    <p className="text-xs text-slate-600">
                      {branchTrend?.branch
                        ? `${branchTrend.branch.s2_code || "—"} - ${branchTrend.branch.name || "Branche"} • ${branchTrend.year}`
                        : "Chargement..."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBranchTrendOpen(false);
                      setBranchTrend(null);
                      setBranchTrendError(null);
                      setBranchTrendFromMonth("");
                      setBranchTrendToMonth("");
                      setBranchTrendTableVisible(false);
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Fermer
                  </button>
                </div>

                <div className="space-y-4 p-4">
                  {branchTrendLoading ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">Chargement du graphique...</div>
                  ) : branchTrendError ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{branchTrendError}</div>
                  ) : branchTrend ? (
                    <>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Année: <span className="font-semibold">{branchTrend.year}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Versé cumulé: <span className="font-semibold">{formatMoney(branchTrend.total_paid_year, "EUR")}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Annuel attendu: <span className="font-semibold">{formatMoney(branchTrend.total_annual_expected, "EUR")}</span>
                        </div>
                      </div>

                      <PeriodZoomControls
                        months={branchTrend.months}
                        fromMonth={branchTrendFromMonth}
                        toMonth={branchTrendToMonth}
                        onChangeFrom={(next) => {
                          setBranchTrendFromMonth(next);
                          if (branchTrendToMonth && next > branchTrendToMonth) setBranchTrendToMonth(next);
                        }}
                        onChangeTo={(next) => {
                          setBranchTrendToMonth(next);
                          if (branchTrendFromMonth && next < branchTrendFromMonth) setBranchTrendFromMonth(next);
                        }}
                        onReset={() => {
                          setBranchTrendFromMonth(branchTrend.months[0]?.month || "");
                          setBranchTrendToMonth(branchTrend.months[branchTrend.months.length - 1]?.month || "");
                        }}
                      />

                      <MiniTrendChart months={branchTrendMonthsFiltered} annualExpected={branchTrend.total_annual_expected} />
                      {branchTrendPeriodSummary ? (
                        <TwoSegmentGaugePanel
                          caption={`Jauge fin de période (${branchTrendPeriodSummary.from} -> ${branchTrendPeriodSummary.to}) - base 100% = cumul attendu`}
                          totalLabel={formatMoney(branchTrendPeriodSummary.expected, "EUR")}
                          leftPct={branchTrendPeriodSummary.paidPct}
                          rightPct={branchTrendPeriodSummary.remainingPct}
                          left={{
                            label: "Cumul versé factuel (fin période)",
                            amountLabel: formatMoney(branchTrendPeriodSummary.paidCapped, "EUR"),
                            pctLabel: `${branchTrendPeriodSummary.paidPct.toFixed(1)}%`,
                            barColorClass: "bg-blue-600",
                            cardClass: "border-blue-600 bg-blue-600",
                            textClass: "text-white",
                          }}
                          right={{
                            label: "Reste vs attendu (fin période)",
                            amountLabel: formatMoney(branchTrendPeriodSummary.remaining, "EUR"),
                            pctLabel: `${branchTrendPeriodSummary.remainingPct.toFixed(1)}%`,
                            barColorClass: "bg-emerald-500",
                            cardClass: "border-emerald-500 bg-emerald-500",
                            textClass: "text-white",
                          }}
                        />
                      ) : null}

                      <div className="space-y-2">
                        <ToggleTableHeader title="Tableau mensuel" visible={branchTrendTableVisible} onToggle={() => setBranchTrendTableVisible((v) => !v)} />
                        {branchTrendTableVisible ? (
                          <div className="rounded-md border border-slate-200 bg-white">
                            <table className="w-full table-fixed text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="w-[14%] px-3 py-2 text-left">Mois</th>
                                  <th className="w-[22%] px-3 py-2 text-right">Versé mois</th>
                                  <th className="w-[22%] px-3 py-2 text-right">Attendu mois (estimé)</th>
                                  <th className="w-[21%] px-3 py-2 text-right">Cumul versé</th>
                                  <th className="w-[21%] px-3 py-2 text-right">Cumul attendu (estimé)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {branchTrendMonthsFiltered.map((row) => (
                                  <tr key={row.month} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-xs text-slate-700">{row.month}</td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.paid_amount, "EUR")}</td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.expected_amount, "EUR")}</td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_paid, "EUR")}</td>
                                    <td className="px-3 py-2 text-right text-xs text-slate-700">{formatMoney(row.cumulative_expected, "EUR")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
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
      <PrimesPageContent />
    </Suspense>
  );
}
