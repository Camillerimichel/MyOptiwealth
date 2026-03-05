'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
  setActiveProjectContext,
} from '@/lib/active-task';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Project = { id: string; name: string; progressPercent: number; missionType?: string | null };
type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  role?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
  society?: { id: string; name: string } | null;
};
type ProjectContact = {
  projectId: string;
  contactId: string;
  projectRole?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
  contact: Contact;
};
const DEFAULT_MISSION_TYPES = ['Strategie patrimoniale', 'Succession', 'Finance d entreprise'];
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};
const CONTACT_ROLE_LABELS: Record<'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL', string> = {
  DECIDEUR: 'Décideur',
  N_MINUS_1: 'N-1',
  OPERATIONNEL: 'Opérationnel',
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projectContacts, setProjectContacts] = useState<ProjectContact[]>([]);
  const [projectContactIdToAdd, setProjectContactIdToAdd] = useState('');
  const [projectContactRoleToAdd, setProjectContactRoleToAdd] = useState<'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | ''>('');
  const [name, setName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [societyId, setSocietyId] = useState('');
  const [defaultSocietyName, setDefaultSocietyName] = useState('');
  const [missionType, setMissionType] = useState<string>(DEFAULT_MISSION_TYPES[0]);
  const [missionTypes, setMissionTypes] = useState<string[]>(DEFAULT_MISSION_TYPES);
  const [saving, setSaving] = useState(false);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
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
      const [projectsData, societiesData, settings, contactsData, workspacesData] = await Promise.all([
        apiClient.listProjects(token),
        apiClient.listSocieties(token),
        apiClient.getWorkspaceSettings(token),
        apiClient.listContacts(token),
        apiClient.listWorkspaces(token),
      ]);
      setProjects(projectsData);
      setContacts(contactsData);
      const workspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('mw_active_workspace_id')
          : null;
      const workspaceName = workspacesData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      setActiveWorkspaceName(workspaceName);
      const workspaceDefaultSociety = [...societiesData]
        .sort((a, b) => {
          const left = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
          const right = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
          return left - right;
        })[0];
      const workspaceAssociatedSocietyId =
        (settings.associatedSocietyId && societiesData.some((society) => society.id === settings.associatedSocietyId))
          ? settings.associatedSocietyId
          : undefined;
      const workspaceDefaultSocietyId = workspaceAssociatedSocietyId ?? workspaceDefaultSociety?.id ?? '';
      const workspaceDefaultSocietyName =
        societiesData.find((society) => society.id === workspaceDefaultSocietyId)?.name ?? '';
      const configuredMissionTypes =
        settings.projectTypologies && settings.projectTypologies.length > 0
          ? settings.projectTypologies
          : DEFAULT_MISSION_TYPES;
      setMissionTypes(configuredMissionTypes);
      setMissionType((current) => current || configuredMissionTypes[0] || DEFAULT_MISSION_TYPES[0]);
      setSocietyId(workspaceDefaultSocietyId);
      setDefaultSocietyName(workspaceDefaultSocietyName);

      const activeProject = getActiveProjectContext();
      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId);
        setActiveProjectId(activeProject.projectId);
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
            ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
      } else {
        setActiveProjectId(null);
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
      }
      const activeTask = getActiveTaskContext();
      if (activeTask && projectsData.some((project) => project.id === activeTask.projectId)) {
        setActiveTaskLabel(activeTask.taskDescription);
      } else {
        setActiveTaskLabel(null);
      }
    } catch {
      setProjects([]);
      setDefaultSocietyName('');
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
    const onProjectChanged = (): void => {
      void load();
    };
    const onTaskChanged = (): void => {
      void load();
    };
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    window.addEventListener('mw_active_project_changed', onProjectChanged);
    window.addEventListener('mw_active_task_changed', onTaskChanged);
    return () => {
      window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
      window.removeEventListener('mw_active_project_changed', onProjectChanged);
      window.removeEventListener('mw_active_task_changed', onTaskChanged);
    };
  }, [load]);

  function onSetProjectContext(project: Project): void {
    const workspaceId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('mw_active_workspace_id') ?? undefined
        : undefined;
    setActiveProjectContext({
      projectId: project.id,
      projectTitle: project.name,
      projectTypology: project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : null,
      workspaceId,
    });
    clearActiveTaskContext();
    setActiveProjectId(project.id);
    setActiveProjectTitle(project.name);
    setActiveProjectTypology(project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : null);
    setActiveTaskLabel(null);
    showToast('Contexte projet activé.', 'success');
    router.push('/tasks');
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !name || saving) return;

    try {
      setSaving(true);
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
    } catch (createError) {
      showToast(createError instanceof Error ? createError.message : 'Enregistrement impossible.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function onEditProject(project: Project): void {
    setEditingProjectId(project.id);
    setName(project.name);
    setMissionType(project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : (missionTypes[0] ?? DEFAULT_MISSION_TYPES[0]));
    void loadProjectContacts(project.id);
  }

  function onCancelEdit(): void {
    setEditingProjectId(null);
    setName('');
    setProjectContacts([]);
    setProjectContactIdToAdd('');
    setProjectContactRoleToAdd('');
  }

  async function loadProjectContacts(projectId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const data = await apiClient.listProjectContacts(token, projectId);
    setProjectContacts(data);
    setProjectContactIdToAdd((current) => current || data[0]?.contactId || '');
  }

  async function onAddProjectContact(): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingProjectId || !projectContactIdToAdd) return;
    await apiClient.addProjectContact(token, editingProjectId, {
      contactId: projectContactIdToAdd,
      projectRole: projectContactRoleToAdd || undefined,
    });
    showToast('Intervenant ajouté au projet.', 'success');
    setProjectContactIdToAdd('');
    setProjectContactRoleToAdd('');
    await loadProjectContacts(editingProjectId);
  }

  async function onUpdateProjectContactRole(contactId: string, role: string): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingProjectId) return;
    await apiClient.updateProjectContact(token, editingProjectId, contactId, {
      projectRole: (role || undefined) as 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | undefined,
    });
    showToast('Rôle projet mis à jour.', 'success');
    await loadProjectContacts(editingProjectId);
  }

  async function onRemoveProjectContact(contactId: string): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingProjectId) return;
    await apiClient.removeProjectContact(token, editingProjectId, contactId);
    showToast('Intervenant retiré du projet.', 'success');
    await loadProjectContacts(editingProjectId);
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Projects</h1>
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
              setActiveProjectId(null);
              setActiveProjectTitle(null);
              setActiveProjectTypology(null);
              setActiveTaskLabel(null);
            }}
            className="ml-2 text-sm font-semibold underline underline-offset-2"
          >
            Retirer
          </button>
        ) : null}
      </div>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom projet" className="rounded border border-[var(--line)] px-3 py-2" />
          <input
            value={defaultSocietyName || 'Aucune société par défaut sur ce workspace'}
            readOnly
            disabled
            className="rounded border border-[var(--line)] bg-[#f3f2ef] px-3 py-2 text-[#5b5952]"
          />
          <select value={missionType} onChange={(e) => setMissionType(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
            {missionTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button disabled={!societyId || saving} className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">
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
        {!societyId ? (
          <p className="mt-3 text-sm text-[#5b5952]">
            Aucune société par défaut définie sur ce workspace.{' '}
            <Link href="/crm/societies" className="font-semibold text-[var(--brand)] underline-offset-2 hover:underline">
              Créer une société
            </Link>{' '}
            puis revenir pour créer un projet.
          </p>
        ) : null}
      </article>
      {editingProjectId ? (
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <h2 className="font-semibold text-[var(--brand)]">Intervenants du projet</h2>
          <div className="mt-3 grid gap-2 lg:grid-cols-4">
            <select
              value={projectContactIdToAdd}
              onChange={(e) => setProjectContactIdToAdd(e.target.value)}
              className="rounded border border-[var(--line)] px-3 py-2"
            >
              <option value="">Choisir un contact existant</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}
                  {contact.society?.name ? ` (${contact.society.name})` : ''}
                </option>
              ))}
            </select>
            <select
              value={projectContactRoleToAdd}
              onChange={(e) => setProjectContactRoleToAdd(e.target.value as 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | '')}
              className="rounded border border-[var(--line)] px-3 py-2"
            >
              <option value="">Rôle projet (optionnel)</option>
              <option value="DECIDEUR">Décideur</option>
              <option value="N_MINUS_1">N-1</option>
              <option value="OPERATIONNEL">Opérationnel</option>
            </select>
            <div className="lg:col-span-2">
              <button
                type="button"
                onClick={() => {
                  void onAddProjectContact();
                }}
                className="rounded bg-[var(--brand)] px-3 py-2 text-white"
              >
                Ajouter au projet
              </button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                  <th className="px-2 py-2">Nom</th>
                  <th className="px-2 py-2">Société</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Rôle contact</th>
                  <th className="px-2 py-2">Rôle projet</th>
                  <th className="px-2 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {projectContacts.map((link) => (
                  <tr key={link.contactId} className="border-b border-[var(--line)]">
                    <td className="px-2 py-2">{link.contact.firstName} {link.contact.lastName}</td>
                    <td className="px-2 py-2">{link.contact.society?.name ?? '-'}</td>
                    <td className="px-2 py-2">{link.contact.email ?? '-'}</td>
                    <td className="px-2 py-2">{link.contact.role ? CONTACT_ROLE_LABELS[link.contact.role] : '-'}</td>
                    <td className="px-2 py-2">
                      <select
                        value={link.projectRole ?? ''}
                        onChange={(e) => {
                          void onUpdateProjectContactRole(link.contactId, e.target.value);
                        }}
                        className="rounded border border-[var(--line)] px-2 py-1"
                      >
                        <option value="">-</option>
                        <option value="DECIDEUR">Décideur</option>
                        <option value="N_MINUS_1">N-1</option>
                        <option value="OPERATIONNEL">Opérationnel</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          void onRemoveProjectContact(link.contactId);
                        }}
                        className="text-red-700 underline-offset-2 hover:underline"
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
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
                <tr
                  key={project.id}
                  className={project.id === activeProjectId ? 'border-b border-[var(--line)] bg-[#f7f3e8]' : 'border-b border-[var(--line)]'}
                >
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
                    <button
                      type="button"
                      onClick={() => onSetProjectContext(project)}
                      className="ml-3 text-[#4f4d45] underline-offset-2 hover:underline"
                    >
                      Contexte
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
