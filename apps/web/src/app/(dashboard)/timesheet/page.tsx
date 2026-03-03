'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type TimeEntry = { id: string; minutesSpent: number; entryDate: string; project: { name: string } };
type Totals = { totalMinutes: number; totalHours: number; collaboratorsCount: number; projectsCount: number };
type Project = { id: string; name: string; progressPercent: number };

export default function TimesheetPage() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [minutesSpent, setMinutesSpent] = useState(60);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
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
      setProjectId((current) => current || projectsData[0]?.id || '');
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !projectId) return;
    await apiClient.createTimeEntry(token, {
      projectId,
      minutesSpent,
      entryDate: new Date(entryDate).toISOString(),
    });
    showToast('Saisie temps ajoutée.', 'success');
    await load();
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Timesheet</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        Total: {totals?.totalHours ?? 0} h | Collaborateurs: {totals?.collaboratorsCount ?? 0} | Projets: {totals?.projectsCount ?? 0}
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-4">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="">Projet</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <input type="number" value={minutesSpent} onChange={(e) => setMinutesSpent(Number(e.target.value))} className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2" />
          <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">Ajouter</button>
        </form>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {entries.map((entry) => <li key={entry.id}>{entry.project.name} | {entry.minutesSpent} min | {new Date(entry.entryDate).toLocaleDateString()}</li>)}
        </ul>
      </article>
    </section>
  );
}
