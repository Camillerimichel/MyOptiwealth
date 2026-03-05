'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
} from '@/lib/active-task';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Kpis = { billedRevenue: number; collectedRevenue: number; estimatedMargin: number };
type FinanceDoc = { id: string; reference: string; type: string; amount: string; status: string; project?: { id: string; name: string } | null };
type Project = { id: string; name: string; progressPercent: number; missionType?: string | null };
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

export default function FinancePage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [docs, setDocs] = useState<FinanceDoc[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
  const [type, setType] = useState<'QUOTE' | 'INVOICE'>('QUOTE');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('0');
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);
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
      const [kpisData, docsData, projectsData, workspacesData] = await Promise.all([
        apiClient.financeKpis(token),
        apiClient.listFinanceDocuments(token),
        apiClient.listProjects(token),
        apiClient.listWorkspaces(token),
      ]);
      setKpis(kpisData);
      setDocs(docsData);
      setProjects(projectsData);
      const workspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('mw_active_workspace_id')
          : null;
      const workspaceName = workspacesData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      setActiveWorkspaceName(workspaceName);
      const activeProject = getActiveProjectContext();
      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId);
        setProjectId(activeProject.projectId);
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
            ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
        const activeTask = getActiveTaskContext();
        setActiveTaskLabel(
          activeTask && activeTask.projectId === activeProject.projectId ? activeTask.taskDescription : null,
        );
      } else {
        setProjectId('');
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
        setActiveTaskLabel(null);
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

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !projectId || !reference) return;
    await apiClient.createFinanceDocument(token, {
      projectId,
      type,
      reference,
      amount,
      status: 'draft',
    });
    setReference('');
    showToast('Document financier créé.', 'success');
    await load();
  }

  const filteredDocs = projectId
    ? docs.filter((doc) => doc.project?.id === projectId)
    : [];

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Finance</h1>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        <p>Workspace: {activeWorkspaceName ?? 'Aucun'}</p>
        <p className="pl-6">
          Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        </p>
        <p className="pl-12">Tâche: {activeTaskLabel ?? 'Aucune'}</p>
        {projectId ? (
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
      {!projectId ? (
        <p className="text-sm text-[#5b5952]">Sélectionne d abord un contexte projet dans Projects.</p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">CA facturé: {kpis?.billedRevenue ?? 0} €</article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">CA encaissé: {kpis?.collectedRevenue ?? 0} €</article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">Marge estimée: {kpis?.estimatedMargin ?? 0} €</article>
      </div>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-5">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled className="rounded border border-[var(--line)] px-3 py-2">
            <option value="">Projet du contexte</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as 'QUOTE' | 'INVOICE')} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="QUOTE">DEVIS</option>
            <option value="INVOICE">FACTURE</option>
          </select>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Référence" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Montant" className="rounded border border-[var(--line)] px-3 py-2" />
          <button disabled={!projectId} className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">Créer</button>
        </form>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {filteredDocs.map((doc) => <li key={doc.id}>{doc.type} | {doc.reference} | {doc.amount} | {doc.status}</li>)}
        </ul>
      </article>
    </section>
  );
}
