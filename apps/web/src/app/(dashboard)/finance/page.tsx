'use client';

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
} from '@/lib/active-task';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Kpis = { billedRevenue: number; collectedRevenue: number; pendingRevenue: number; estimatedMargin: number };
type Project = { id: string; name: string; progressPercent: number; missionType?: string | null };
type FinanceOverviewItem = {
  quote: {
    id: string;
    projectId: string;
    projectName: string;
    name: string;
    reference: string;
    accountingRef?: string | null;
    amount: number;
    status: string;
    issuedAt: string;
    dueDate?: string | null;
  };
  totals: {
    paidInvoicesTotal: number;
    pendingInvoicesTotal: number;
  };
  invoices: Array<{
    id: string;
    name: string;
    reference: string;
    accountingRef?: string | null;
    amount: number;
    status: string;
    invoiceIndex?: number | null;
    issuedAt: string;
    dueDate?: string | null;
    paidAt?: string | null;
  }>;
};
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function euro(value: number): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted.replace(/\u202f|\u00a0/g, ' ')} €`;
}

function stripQuotePrefix(value: string, projectName: string, missionLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const normalize = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\u2013]/g, '-')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const project = normalize(projectName || '');
  const mission = normalize(missionLabel || '');
  const projectWords = project ? project.split(' ') : [];
  const missionWords = mission ? mission.split(' ') : [];

  const isMetaToken = (token: string): boolean => {
    const normalized = normalize(token);
    if (!normalized) return false;
    if (/^devis\b/.test(normalized)) return true;
    if (normalized === project || normalized === mission) return true;

    const words = normalized.split(' ').filter((word) => word);
    if (!words.length) return false;

    const projectOverlap = words.filter((word) => projectWords.includes(word)).length;
    const missionOverlap = words.filter((word) => missionWords.includes(word)).length;
    const matchingCount = Math.max(projectOverlap, missionOverlap);
    if (matchingCount === 0) return false;

    return matchingCount >= Math.max(1, words.length - 1);
  };

  const parts = trimmed.split(/\s*[-–]\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return '';

  let cursor = 0;
  while (cursor < parts.length && isMetaToken(parts[cursor])) {
    cursor += 1;
  }

  if (cursor >= parts.length) {
    const trailingMatch = trimmed.match(/\([^)]*\)\s*$/);
    return trailingMatch ? trailingMatch[0].trim() : '';
  }

  return parts.slice(cursor).join(' - ');
}

function buildQuoteDisplayName(
  projectName: string,
  missionType: string | null | undefined,
  accountingRef?: string | null,
  customName?: string,
): string {
  const missionLabel = missionType || 'MISSION';
  const base = `${projectName || 'Projet'} (${missionLabel})`;
  if (accountingRef !== undefined && accountingRef !== null) {
    const accountingSuffix = accountingRef.trim();
    return accountingSuffix ? `${base} - ${accountingSuffix}` : base;
  }
  const customSuffix = customName ? customName.trim() : '';
  return customSuffix ? `${base} - ${customSuffix}` : base;
}

function normalizeQuoteStatus(status?: string): 'OPEN' | 'CANCELLED' {
  const s = (status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  if (s === 'CANCELLED' || s === 'ANNULE' || s === 'ANNULEE') return 'CANCELLED';
  return 'OPEN';
}

function normalizeInvoiceStatus(status?: string): 'PENDING' | 'PAID' | 'CANCELLED' {
  const s = (status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  if (s === 'PAID' || s === 'PAYE' || s === 'PAYEE') return 'PAID';
  if (s === 'CANCELLED' || s === 'ANNULE' || s === 'ANNULEE') return 'CANCELLED';
  return 'PENDING';
}

export default function FinancePage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [overview, setOverview] = useState<FinanceOverviewItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);

  const [createProjectId, setCreateProjectId] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('0');
  const [quoteIssuedAt, setQuoteIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [quoteDueAt, setQuoteDueAt] = useState('');

  const [invoiceQuoteId, setInvoiceQuoteId] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('0');
  const [invoiceIssuedAt, setInvoiceIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceDueAt, setInvoiceDueAt] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState<'PENDING' | 'PAID'>('PENDING');
  const [invoiceAccountingRef, setInvoiceAccountingRef] = useState('');

  const [expandedQuoteIds, setExpandedQuoteIds] = useState<Record<string, boolean>>({});

  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocType, setEditingDocType] = useState<'QUOTE' | 'INVOICE'>('QUOTE');
  const [editingName, setEditingName] = useState('');
  const [editingAmount, setEditingAmount] = useState('0');
  const [editingIssuedAt, setEditingIssuedAt] = useState('');
  const [editingDueAt, setEditingDueAt] = useState('');
  const [editingStatus, setEditingStatus] = useState<'OPEN' | 'PENDING' | 'PAID' | 'CANCELLED'>('OPEN');
  const [editingAccountingRef, setEditingAccountingRef] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const token = getAccessToken();
    if (!token) {
      setError('Token manquant.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const activeProject = getActiveProjectContext();
      const projectFilter = activeProject?.projectId;

      const [kpisData, overviewData, projectsData, workspacesData] = await Promise.all([
        apiClient.financeKpis(token, projectFilter),
        apiClient.financeOverview(token, projectFilter),
        apiClient.listProjects(token),
        apiClient.listWorkspaces(token),
      ]);

      setKpis(kpisData);
      setOverview(overviewData);
      setProjects(projectsData);

      const workspaceId = typeof window !== 'undefined'
        ? window.localStorage.getItem('mw_active_workspace_id')
        : null;
      const workspaceName = workspacesData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      setActiveWorkspaceName(workspaceName);

      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId);
        setActiveProjectId(activeProject.projectId);
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
            ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
        setCreateProjectId(activeProject.projectId);
        const activeTask = getActiveTaskContext();
        setActiveTaskLabel(activeTask && activeTask.projectId === activeProject.projectId ? activeTask.taskDescription : null);
      } else {
        setActiveProjectId(null);
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
        setActiveTaskLabel(null);
        setCreateProjectId('');
      }
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onWorkspaceChanged = (): void => {
      void load();
    };
    const onTaskChanged = (): void => {
      void load();
    };
    const onProjectChanged = (): void => {
      void load();
    };
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    window.addEventListener('mw_active_task_changed', onTaskChanged);
    window.addEventListener('mw_active_project_changed', onProjectChanged);
    return () => {
      window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
      window.removeEventListener('mw_active_task_changed', onTaskChanged);
      window.removeEventListener('mw_active_project_changed', onProjectChanged);
    };
  }, [load]);

  const quoteOptions = useMemo(() => overview.map((item) => item.quote), [overview]);

  async function onCreateQuote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !createProjectId) return;

    await apiClient.createQuote(token, {
      projectId: createProjectId,
      amount: quoteAmount,
      issuedAt: quoteIssuedAt ? `${quoteIssuedAt}T00:00:00.000Z` : undefined,
      dueDate: quoteDueAt ? `${quoteDueAt}T00:00:00.000Z` : undefined,
    });
    showToast('Devis cree.', 'success');
    setQuoteAmount('0');
    setQuoteDueAt('');
    await load();
  }

  async function onCreateInvoice(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !invoiceQuoteId) return;

    await apiClient.createInvoice(token, {
      quoteId: invoiceQuoteId,
      amount: invoiceAmount,
      issuedAt: invoiceIssuedAt ? `${invoiceIssuedAt}T00:00:00.000Z` : undefined,
      dueDate: invoiceDueAt ? `${invoiceDueAt}T00:00:00.000Z` : undefined,
      status: invoiceStatus,
      accountingRef: invoiceAccountingRef || undefined,
    });
    showToast('Facture creee.', 'success');
    setInvoiceAmount('0');
    setInvoiceDueAt('');
    setInvoiceAccountingRef('');
    await load();
  }

  function onEditQuote(item: FinanceOverviewItem['quote']): void {
    setEditingDocId(item.id);
    setEditingDocType('QUOTE');
    setEditingName(item.name);
    setEditingAmount(String(item.amount));
    setEditingIssuedAt(toDateInputValue(item.issuedAt));
    setEditingDueAt(toDateInputValue(item.dueDate));
    setEditingStatus(normalizeQuoteStatus(item.status));
    setEditingAccountingRef(item.accountingRef ?? '');
  }

  function onEditInvoice(item: FinanceOverviewItem['invoices'][number]): void {
    setEditingDocId(item.id);
    setEditingDocType('INVOICE');
    setEditingName(item.name);
    setEditingAmount(String(item.amount));
    setEditingIssuedAt(toDateInputValue(item.issuedAt));
    setEditingDueAt(toDateInputValue(item.dueDate));
    setEditingStatus(normalizeInvoiceStatus(item.status));
    setEditingAccountingRef(item.accountingRef ?? '');
  }

  async function onSaveEdit(): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingDocId) return;

    await apiClient.updateFinanceDocument(token, editingDocId, {
      name: editingName,
      amount: editingAmount,
      issuedAt: editingIssuedAt ? `${editingIssuedAt}T00:00:00.000Z` : undefined,
      dueDate: editingDueAt ? `${editingDueAt}T00:00:00.000Z` : null,
      status: editingDocType === 'QUOTE'
        ? normalizeQuoteStatus(editingStatus)
        : normalizeInvoiceStatus(editingStatus),
      accountingRef: editingAccountingRef || null,
      paidAt: editingDocType === 'INVOICE' && normalizeInvoiceStatus(editingStatus) === 'PAID'
        ? `${editingIssuedAt || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
        : null,
    });
    showToast('Document financier mis a jour.', 'success');
    setEditingDocId(null);
    await load();
  }

  function toggleQuoteDetails(quoteId: string): void {
    setExpandedQuoteIds((prev) => ({ ...prev, [quoteId]: !prev[quoteId] }));
  }

  function getEditingQuoteNamePreview(): string {
    if (!editingDocId || editingDocType !== 'QUOTE') return '';
    const editingItem = overview.find((item) => item.quote.id === editingDocId);
    if (!editingItem) return editingName;

    const project = projects.find((candidate) => candidate.id === editingItem.quote.projectId);
    return buildQuoteDisplayName(
      editingItem.quote.projectName,
      project?.missionType,
      editingAccountingRef || null,
      editingName,
    );
  }

function getQuoteDisplayName(item: FinanceOverviewItem['quote']): string {
    const project = projects.find((candidate) => candidate.id === item.projectId);
    return buildQuoteDisplayName(item.projectName, project?.missionType, item.accountingRef);
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Finance</h1>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        <p>Workspace: {activeWorkspaceName ?? 'Aucun'}</p>
        <p className="pl-6">
          Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        </p>
        <p className="pl-12">Tâche: {activeTaskLabel ?? 'Aucune'}</p>
        {activeProjectId ? (
          <button
            type="button"
            onClick={() => {
              clearActiveProjectContext();
              clearActiveTaskContext();
            }}
            className="ml-2 text-sm font-semibold underline underline-offset-2"
          >
            Retirer
          </button>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {!activeProjectId ? (
        <p className="text-sm text-[#5b5952]">Aucun projet actif: affichage de tous les devis du workspace.</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <p className="text-sm text-[#5b5952]">CA facturé</p>
          <p className="text-right text-lg font-semibold">{euro(kpis?.billedRevenue ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <p className="text-sm text-[#5b5952]">CA encaissé</p>
          <p className="text-right text-lg font-semibold">{euro(kpis?.collectedRevenue ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <p className="text-sm text-[#5b5952]">CA en attente</p>
          <p className="text-right text-lg font-semibold">{euro(kpis?.pendingRevenue ?? 0)}</p>
        </article>
      </div>

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h2 className="font-semibold">Nouveau devis</h2>
        <form onSubmit={onCreateQuote} className="mt-3 grid gap-2 lg:grid-cols-7">
          <select
            value={createProjectId}
            onChange={(e) => setCreateProjectId(e.target.value)}
            disabled={Boolean(activeProjectId)}
            className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-3"
          >
            <option value="">Projet</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <input value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} placeholder="Montant devis" className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="date" value={quoteIssuedAt} onChange={(e) => setQuoteIssuedAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-3 py-2" />
          <input type="date" value={quoteDueAt} onChange={(e) => setQuoteDueAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-3 py-2" />
          <button disabled={!createProjectId} className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-1">Créer devis</button>
        </form>
      </article>

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h2 className="font-semibold">Nouvelle facture (liée à un devis)</h2>
        <form onSubmit={onCreateInvoice} className="mt-3 grid gap-2 lg:grid-cols-8">
          <select value={invoiceQuoteId} onChange={(e) => setInvoiceQuoteId(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-3">
            <option value="">Devis parent</option>
            {quoteOptions.map((quote) => (
              <option key={quote.id} value={quote.id}>{getQuoteDisplayName(quote)}</option>
            ))}
          </select>
          <input value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="Montant facture" className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="date" value={invoiceIssuedAt} onChange={(e) => setInvoiceIssuedAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-3 py-2" />
          <input type="date" value={invoiceDueAt} onChange={(e) => setInvoiceDueAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-3 py-2" />
          <select value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value as 'PENDING' | 'PAID')} className="rounded border border-[var(--line)] px-3 py-2"> 
            <option value="PENDING">En attente</option>
            <option value="PAID">Payee</option>
          </select>
          <input value={invoiceAccountingRef} onChange={(e) => setInvoiceAccountingRef(e.target.value)} placeholder="Ref comptable (optionnel)" className="rounded border border-[var(--line)] px-3 py-2" />
          <button disabled={!invoiceQuoteId} className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-8">Créer facture</button>
        </form>
      </article>

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Devis</th>
                <th className="px-2 py-2">Date devis</th>
                <th className="px-2 py-2 text-right">Montant devis</th>
                <th className="px-2 py-2 text-right">Total factures payées</th>
                <th className="px-2 py-2 text-right">Total en attente</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {overview.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-[#5b5952]">Aucun devis.</td>
                </tr>
              ) : null}
                  {overview.map((item) => (
                <Fragment key={item.quote.id}>
                    {(() => {
                      const pendingFromQuote = item.quote.amount - item.totals.paidInvoicesTotal;
                      return (
                    <tr key={item.quote.id} className="border-b border-[var(--line)] bg-[#f8f5ed]">
                      <td className="px-2 py-2">
                      <div className="font-semibold">{getQuoteDisplayName(item.quote)}</div>
                      <div className="text-xs text-[#5b5952]">Ref devis: {item.quote.reference}</div>
                      </td>
                    <td className="px-2 py-2">{new Date(item.quote.issuedAt).toLocaleDateString('fr-FR')}</td>
                    <td className="px-2 py-2 text-right">{euro(item.quote.amount)}</td>
                    <td className="px-2 py-2 text-right text-green-700">{euro(item.totals.paidInvoicesTotal)}</td>
                    <td className="px-2 py-2 text-right text-orange-700">{euro(pendingFromQuote)}</td>
                    <td className="px-2 py-2">
                      <button onClick={() => toggleQuoteDetails(item.quote.id)} className="mr-2 rounded border border-[var(--line)] px-2 py-1 text-xs">
                        {expandedQuoteIds[item.quote.id] ? 'Masquer factures' : 'Voir factures'}
                      </button>
                      <button onClick={() => onEditQuote(item.quote)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Modifier devis</button>
                    </td>
                  </tr>
                      );
                    })()}
                  {editingDocId === item.quote.id ? (
                    <tr className="border-b border-[var(--line)] bg-[#fffdf7]">
                      <td colSpan={6} className="px-2 py-2">
                        <div className="grid gap-2 lg:grid-cols-6">
                          <input value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder="Nom" className="rounded border border-[var(--line)] px-2 py-1" />
                          <input value={editingAmount} onChange={(e) => setEditingAmount(e.target.value)} placeholder="Montant" className="rounded border border-[var(--line)] px-2 py-1" />
                          <input type="date" value={editingIssuedAt} onChange={(e) => setEditingIssuedAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-2 py-1" />
                          <input type="date" value={editingDueAt} onChange={(e) => setEditingDueAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-2 py-1" />
                          <select value={editingStatus} onChange={(e) => setEditingStatus(e.target.value as 'OPEN' | 'PENDING' | 'PAID' | 'CANCELLED')} className="rounded border border-[var(--line)] px-2 py-1">
                            <option value="OPEN">Ouvert</option>
                            <option value="CANCELLED">Annule</option>
                          </select>
                          <input value={editingAccountingRef} onChange={(e) => setEditingAccountingRef(e.target.value)} placeholder="Ref comptable" className="rounded border border-[var(--line)] px-2 py-1" />
                        </div>
                        <div className="mt-2 rounded border border-dashed border-[var(--brand)] bg-[#fff8ea] px-3 py-2 text-xs text-[#4b463d]">
                          <strong>Nom final :</strong> {getEditingQuoteNamePreview()}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => { void onSaveEdit(); }} className="rounded bg-[var(--brand)] px-2 py-1 text-xs text-white">Enregistrer</button>
                          <button onClick={() => setEditingDocId(null)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Annuler</button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {expandedQuoteIds[item.quote.id]
                    ? item.invoices.map((invoice) => (
                      <Fragment key={invoice.id}>
                        <tr key={invoice.id} className="border-b border-[var(--line)] bg-white">
                          <td className="px-2 py-2 pl-6">
                            <div className="font-medium">{invoice.reference}</div>
                            <div className="text-xs text-[#5b5952]">{invoice.name}</div>
                          </td>
                          <td className="px-2 py-2">{new Date(invoice.issuedAt).toLocaleDateString('fr-FR')}</td>
                          <td className="px-2 py-2 text-right">{euro(invoice.amount)}</td>
                          <td className="px-2 py-2">{invoice.status === 'PAID' ? 'Payee' : '-'}</td>
                          <td className="px-2 py-2">{invoice.status !== 'PAID' ? 'En attente' : '-'}</td>
                          <td className="px-2 py-2">
                            <button onClick={() => onEditInvoice(invoice)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Modifier facture</button>
                          </td>
                        </tr>
                        {editingDocId === invoice.id ? (
                          <tr className="border-b border-[var(--line)] bg-[#fffdf7]">
                            <td colSpan={6} className="px-2 py-2 pl-6">
                              <div className="grid gap-2 lg:grid-cols-6">
                                <input value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder="Nom" className="rounded border border-[var(--line)] px-2 py-1" />
                                <input value={editingAmount} onChange={(e) => setEditingAmount(e.target.value)} placeholder="Montant" className="rounded border border-[var(--line)] px-2 py-1" />
                                <input type="date" value={editingIssuedAt} onChange={(e) => setEditingIssuedAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-2 py-1" />
                                <input type="date" value={editingDueAt} onChange={(e) => setEditingDueAt(e.target.value)} className="w-44 rounded border border-[var(--line)] px-2 py-1" />
                                <select value={editingStatus} onChange={(e) => setEditingStatus(e.target.value as 'OPEN' | 'PENDING' | 'PAID' | 'CANCELLED')} className="rounded border border-[var(--line)] px-2 py-1">
                                  <option value="PENDING">En attente</option>
                                  <option value="PAID">Payee</option>
                                  <option value="CANCELLED">Annulee</option>
                                </select>
                                <input value={editingAccountingRef} onChange={(e) => setEditingAccountingRef(e.target.value)} placeholder="Ref comptable" className="rounded border border-[var(--line)] px-2 py-1" />
                              </div>
                              <div className="mt-2 flex gap-2">
                                <button onClick={() => { void onSaveEdit(); }} className="rounded bg-[var(--brand)] px-2 py-1 text-xs text-white">Enregistrer</button>
                                <button onClick={() => setEditingDocId(null)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Annuler</button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))
                    : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
