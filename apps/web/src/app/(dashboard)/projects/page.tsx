'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Project = { id: string; name: string; progressPercent: number; missionType?: string | null };
type Society = { id: string; name: string };
const DEFAULT_MISSION_TYPES = ['Strategie patrimoniale', 'Succession', 'Finance d entreprise'];
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [name, setName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [societyId, setSocietyId] = useState('');
  const [missionType, setMissionType] = useState<string>(DEFAULT_MISSION_TYPES[0]);
  const [missionTypes, setMissionTypes] = useState<string[]>(DEFAULT_MISSION_TYPES);
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
      const [projectsData, societiesData, settings] = await Promise.all([
        apiClient.listProjects(token),
        apiClient.listSocieties(token),
        apiClient.getWorkspaceSettings(token),
      ]);
      setProjects(projectsData);
      setSocieties(societiesData);
      const configuredMissionTypes =
        settings.projectTypologies && settings.projectTypologies.length > 0
          ? settings.projectTypologies
          : DEFAULT_MISSION_TYPES;
      setMissionTypes(configuredMissionTypes);
      setMissionType((current) => current || configuredMissionTypes[0] || DEFAULT_MISSION_TYPES[0]);
      setSocietyId((current) => current || societiesData[0]?.id || '');
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
    if (!token || !name) return;

    if (editingProjectId) {
      await apiClient.updateProject(token, editingProjectId, { name, missionType });
      showToast('Projet mis à jour.', 'success');
      setEditingProjectId(null);
    } else {
      if (!societyId) return;
      await apiClient.createProject(token, { name, societyId, missionType });
      showToast('Projet créé.', 'success');
    }

    setName('');
    await load();
  }

  function onEditProject(project: Project): void {
    setEditingProjectId(project.id);
    setName(project.name);
    setMissionType(project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : (missionTypes[0] ?? DEFAULT_MISSION_TYPES[0]));
  }

  function onCancelEdit(): void {
    setEditingProjectId(null);
    setName('');
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Projects</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom projet" className="rounded border border-[var(--line)] px-3 py-2" />
          <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="">Sélectionner société</option>
            {societies.map((society) => <option key={society.id} value={society.id}>{society.name}</option>)}
          </select>
          <select value={missionType} onChange={(e) => setMissionType(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
            {missionTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">
              {editingProjectId ? 'Mettre à jour projet' : 'Créer projet'}
            </button>
            {editingProjectId ? (
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-[var(--line)] px-3 py-2 text-[#4f4d45]"
              >
                Annuler
              </button>
            ) : null}
          </div>
        </form>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Nom</th>
                <th className="px-2 py-2">Progression</th>
                <th className="px-2 py-2">Typologie</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-[var(--line)]">
                  <td className="px-2 py-2">{project.name}</td>
                  <td className="px-2 py-2">{project.progressPercent}%</td>
                  <td className="px-2 py-2">{project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : '-'}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onEditProject(project)}
                      className="text-[var(--brand)] underline-offset-2 hover:underline"
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
