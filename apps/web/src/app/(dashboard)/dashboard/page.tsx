'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  setActiveProjectContext,
} from '@/lib/active-task';
import { WorkspaceDashboardOverviewPayload } from '@/types/api';

function euro(value: number): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted.replace(/\u202f|\u00a0/g, ' ')} €`;
}

function progressColor(percent: number): string {
  if (percent >= 75) return '#16a34a';
  if (percent >= 40) return '#d97706';
  return '#dc2626';
}

function priorityLabel(priority: number): string {
  if (priority === 3) return 'Urgent';
  if (priority === 2) return 'Important';
  return 'Normal';
}

const WORKSPACE_NAME_COLLATOR = new Intl.Collator('fr', { sensitivity: 'base' });

export default function DashboardPage() {
  const [data, setData] = useState<WorkspaceDashboardOverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const token = useMemo(
    () => (typeof window === 'undefined' ? null : localStorage.getItem('mw_access_token')),
    [],
  );

  const refreshActiveContext = useCallback((payload?: WorkspaceDashboardOverviewPayload | null): void => {
    if (typeof window === 'undefined') return;
    const source = payload ?? data;
    const workspaceId = window.localStorage.getItem('mw_active_workspace_id');
    const workspaceName = source?.workspaces.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
    setActiveWorkspaceName(workspaceName);
    setActiveProjectTitle(getActiveProjectContext()?.projectTitle ?? null);
  }, [data]);

  useEffect(() => {
    if (!token) return;
    void apiClient
      .dashboardWorkspacesOverview(token)
      .then((payload) => {
        setData(payload);
        refreshActiveContext(payload);
      })
      .catch(() => setError('Impossible de charger le dashboard.'));
  }, [token, refreshActiveContext]);

  useEffect(() => {
    const onWorkspaceChanged = (): void => {
      refreshActiveContext();
    };
    const onProjectChanged = (): void => {
      refreshActiveContext();
    };
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    window.addEventListener('mw_active_project_changed', onProjectChanged);
    return () => {
      window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
      window.removeEventListener('mw_active_project_changed', onProjectChanged);
    };
  }, [refreshActiveContext]);

  const openDashboardPage = useCallback(async (
    workspaceId: string,
    path: '/timesheet' | '/finance',
    project?: { id: string; name: string; missionType?: string | null },
  ): Promise<void> => {
    const currentToken = typeof window !== 'undefined' ? localStorage.getItem('mw_access_token') : null;
    if (!currentToken) return;
    const switched = await apiClient.switchWorkspace(currentToken, workspaceId);
    localStorage.setItem('mw_access_token', switched.accessToken);
    localStorage.setItem('mw_active_workspace_id', switched.activeWorkspaceId);
    if (project) {
      setActiveProjectContext({
        projectId: project.id,
        projectTitle: project.name,
        projectTypology: project.missionType ?? null,
        workspaceId: switched.activeWorkspaceId,
      });
    } else {
      clearActiveProjectContext();
    }
    clearActiveTaskContext();
    window.dispatchEvent(new Event('mw_workspace_changed'));
    window.location.href = path;
  }, []);

  if (!token) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Aucun token détecté.</p>;
  }
  if (error) {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-[#5b5952]">Chargement du dashboard...</p>;
  }

  return (
    <section className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[var(--brand)]">Tableau de bord</h1>
        <a
          href="https://myoptiwealth.fr/settings/workspace?create=1"
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-[var(--line)] text-lg font-semibold text-[var(--brand)] hover:bg-[#f8f5eb]"
          title="Créer un workspace"
          aria-label="Créer un workspace"
        >
          +
        </a>
      </div>

      <article className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-panel">
        <h2 className="mb-2 text-base font-semibold text-[var(--brand)]">Niveau actif</h2>
        <p className="text-sm text-[#4f4d45]">
          Workspace: <span className="font-semibold">{activeWorkspaceName ?? 'Aucun'}</span>
        </p>
        <p className="text-sm text-[#4f4d45]">
          Projet: <span className="font-semibold">{activeProjectTitle ?? 'Aucun (niveau workspace)'}</span>
        </p>
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <h2 className="mb-3 text-base font-semibold text-[var(--brand)]">Synthèse Finance</h2>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded border border-[var(--line)] bg-[#f9f7f2] px-3 py-2">
              <span className="text-[#5b5952]">CA facturé</span>
              <span className="font-semibold">{euro(data.summary.billedRevenue)}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-[var(--line)] bg-[#f9f7f2] px-3 py-2">
              <span className="text-[#5b5952]">CA encaissé</span>
              <span className="font-semibold">{euro(data.summary.collectedRevenue)}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-[var(--line)] bg-[#f9f7f2] px-3 py-2">
              <span className="text-[#5b5952]">Restant à percevoir</span>
              <span className="font-semibold">{euro(data.summary.remainingRevenue)}</span>
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <h2 className="mb-3 text-base font-semibold text-[var(--brand)]">
            Alertes :{' '}
            {data.upcomingTasks.length === 0 ? 'Aucune' : data.upcomingTasks.length} tâche{data.upcomingTasks.length > 1 ? 's' : ''}{' '}
            à venir
          </h2>
          {data.upcomingTasks.length === 0 ? (
            <p className="text-sm text-[#5b5952]">Aucune tâche à venir.</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-[var(--line)]">
              <table className="min-w-full table-fixed border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[#f9f7f2] text-left text-[#6a6861]">
                    <th className="w-28 px-2 py-2">Échéance</th>
                    <th className="px-2 py-2">Tâche</th>
                    <th className="w-32 px-2 py-2">Workspace</th>
                    <th className="w-28 px-2 py-2">Priorité</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingTasks.map((task) => (
                    <tr key={task.id} className="border-b border-[var(--line)]">
                      <td className="px-2 py-2">{task.dueDate ? task.dueDate.slice(0, 10) : '-'}</td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={task.description}>
                          {task.description}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={task.workspace.name}>
                          {task.workspace.name}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-semibold">{priorityLabel(task.priority)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      {[...data.workspaces]
        .sort((left, right) => WORKSPACE_NAME_COLLATOR.compare(left.workspace.name, right.workspace.name))
        .map((item) => {
        const segments = [
          { label: 'À faire', value: item.taskStats.todo, color: '#d1d5db' },
          { label: 'En cours', value: item.taskStats.inProgress, color: '#22c55e' },
          { label: 'En attente', value: item.taskStats.waiting, color: '#f59e0b' },
          { label: 'Fait', value: item.taskStats.done, color: '#111827' },
        ];
        const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);
        const normalizedTaskTotal = segmentTotal > 0 ? segmentTotal : 1;
        const workspaceProgressPercent = Math.max(0, Math.min(100, Math.round(item.progressPercent)));
        const billedRevenue = item.finance.billedRevenue;
        const collectedRevenue = item.finance.collectedRevenue;
        const financeProgressPercent = billedRevenue > 0
          ? Math.round((collectedRevenue / billedRevenue) * 100)
          : 0;

        return (
          <article key={item.workspace.id} className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--brand)]">{item.workspace.name}</h2>
              <p className="text-sm text-[#5b5952]">{item.projectCount} projets • {item.taskStats.total} tâches</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-lg border border-[var(--line)] bg-[#f9f7f2] p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-[#6a6861]">Avancement</p>
                <div className="h-3 overflow-hidden rounded-full bg-[#e8e5dd]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${workspaceProgressPercent}%`,
                      backgroundColor: progressColor(workspaceProgressPercent),
                    }}
                  />
                </div>
                <p className="mt-2 text-right text-xl font-semibold text-[#2f2b23]">{workspaceProgressPercent}%</p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => { void openDashboardPage(item.workspace.id, '/timesheet'); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void openDashboardPage(item.workspace.id, '/timesheet');
                  }
                }}
                className="cursor-pointer rounded-lg border border-[var(--line)] bg-[#f9f7f2] p-4 text-left transition hover:bg-[#f2eee4]"
              >
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-[#6a6861]">Graphique des tâches</p>
                <div className="mb-2 flex h-5 overflow-hidden rounded">
                  {segments.map((segment) => (
                    <div
                      key={segment.label}
                      style={{ width: `${(segment.value / normalizedTaskTotal) * 100}%`, backgroundColor: segment.color }}
                      title={`${segment.label}: ${segment.value}`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#4f4d45]">
                  {segments.map((segment) => (
                    <div key={`legend-${segment.label}`} className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: segment.color }} />
                        {segment.label}
                      </span>
                      <span className="font-semibold">{segment.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => { void openDashboardPage(item.workspace.id, '/finance'); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void openDashboardPage(item.workspace.id, '/finance');
                  }
                }}
                className="cursor-pointer rounded-lg border border-[var(--line)] bg-[#f9f7f2] p-4 text-left transition hover:bg-[#f2eee4]"
              >
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-[#6a6861]">Finances</p>
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-[#5b5952]">
                    <span>Taux d&apos;encaissement</span>
                    <span className="font-semibold text-[#2f2b23]">{Math.max(0, Math.min(100, financeProgressPercent))}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#e8e5dd]">
                    <div
                      className="h-full rounded-full bg-[#0f766e]"
                      style={{ width: `${Math.max(0, Math.min(100, financeProgressPercent))}%` }}
                    />
                  </div>
                </div>
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    <tr className="border-b border-[var(--line)]">
                      <th className="px-2 py-2 text-left font-medium text-[#5b5952]">CA facturé</th>
                      <td className="px-2 py-2 text-right font-semibold">{euro(item.finance.billedRevenue)}</td>
                    </tr>
                    <tr className="border-b border-[var(--line)]">
                      <th className="px-2 py-2 text-left font-medium text-[#5b5952]">CA encaissé</th>
                      <td className="px-2 py-2 text-right font-semibold">{euro(item.finance.collectedRevenue)}</td>
                    </tr>
                    <tr>
                      <th className="px-2 py-2 text-left font-medium text-[#5b5952]">Restant à percevoir</th>
                      <td className="px-2 py-2 text-right font-semibold">{euro(item.finance.remainingRevenue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {item.projects.length > 1 ? (
              <div className="mt-4 rounded-lg border border-[var(--line)] bg-[#f9f7f2] p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-[#6a6861]">Niveau projet</p>
                <ul className="grid gap-2 text-sm">
                  {item.projects.map((project) => (
                    <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--line)] bg-white px-2 py-2">
                      <span className="font-medium text-[#2f2b23]">{project.name}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { void openDashboardPage(item.workspace.id, '/timesheet', project); }}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                        >
                          Timesheet projet
                        </button>
                        <button
                          type="button"
                          onClick={() => { void openDashboardPage(item.workspace.id, '/finance', project); }}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                        >
                          Finance projet
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
