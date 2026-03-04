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

type TimeEntry = { id: string; minutesSpent: number; entryDate: string; taskId?: string | null; project: { id: string; name: string } };
type Totals = { totalMinutes: number; totalHours: number; collaboratorsCount: number; projectsCount: number };
type Project = { id: string; name: string; progressPercent: number; missionType?: string | null };
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

export default function TimesheetPage() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
  const [minutesSpent, setMinutesSpent] = useState(60);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
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
      const [entriesData, totalsData, projectsData] = await Promise.all([
        apiClient.listTimesheet(token),
        apiClient.timesheetTotals(token),
        apiClient.listProjects(token),
      ]);
      setEntries(entriesData);
      setTotals(totalsData);
      setProjects(projectsData);
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
        if (activeTask && activeTask.projectId === activeProject.projectId) {
          setActiveTaskId(activeTask.taskId);
          setActiveTaskLabel(activeTask.taskDescription);
        } else {
          setActiveTaskId(null);
          setActiveTaskLabel(null);
        }
      } else {
        setProjectId('');
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
        setActiveTaskId(null);
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
    const onTaskChanged = (): void => {
      void load();
    };
    const onProjectChanged = (): void => {
      void load();
    };
    window.addEventListener('mw_active_task_changed', onTaskChanged);
    window.addEventListener('mw_active_project_changed', onProjectChanged);
    return () => {
      window.removeEventListener('mw_active_task_changed', onTaskChanged);
      window.removeEventListener('mw_active_project_changed', onProjectChanged);
    };
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !projectId) return;
    await apiClient.createTimeEntry(token, {
      projectId,
      minutesSpent,
      entryDate: new Date(entryDate).toISOString(),
      taskId: activeTaskId ?? undefined,
    });
    showToast('Saisie temps ajoutée.', 'success');
    await load();
  }

  const filteredEntries = activeTaskId
    ? entries.filter((entry) => entry.taskId === activeTaskId)
    : (projectId ? entries.filter((entry) => entry.project.id === projectId) : []);

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Timesheet</h1>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        {activeTaskLabel ? ` | Tâche: ${activeTaskLabel}` : ''}
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
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        Total: {totals?.totalHours ?? 0} h | Collaborateurs: {totals?.collaboratorsCount ?? 0} | Projets: {totals?.projectsCount ?? 0}
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-4">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled className="rounded border border-[var(--line)] px-3 py-2">
            <option value="">Projet du contexte</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <input type="number" value={minutesSpent} onChange={(e) => setMinutesSpent(Number(e.target.value))} className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2" />
          <button disabled={!projectId} className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">Ajouter</button>
        </form>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {filteredEntries.map((entry) => <li key={entry.id}>{entry.project.name} | {entry.minutesSpent} min | {new Date(entry.entryDate).toLocaleDateString()}</li>)}
        </ul>
      </article>
    </section>
  );
}
