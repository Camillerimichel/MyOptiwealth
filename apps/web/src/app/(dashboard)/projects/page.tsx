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

type Project = {
  id: string;
  name: string;
  progressPercent: number;
  missionType?: string | null;
  contacts?: Array<{
    contact: {
      id: string;
      firstName: string;
      lastName: string;
      society?: { id: string; name: string } | null;
    };
  }>;
};
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
const CONTACT_LIST_COLLATOR = new Intl.Collator('fr', { sensitivity: 'base' });

const CONTACT_ROLE_LABELS: Record<'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL', string> = {
  DECIDEUR: 'Décideur',
  N_MINUS_1: 'N-1',
  OPERATIONNEL: 'Opérationnel',
};

function contactSortName(contact: Contact): string {
  return `${contact.lastName} ${contact.firstName}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function compareContactsByName(left: Contact, right: Contact): number {
  return CONTACT_LIST_COLLATOR.compare(contactSortName(left), contactSortName(right));
}

function normalizeSocietyName(value?: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function contactSocietyLink(name?: string | null): string {
  const key = normalizeSocietyName(name);
  return key ? `/crm/contacts?societyKey=${encodeURIComponent(key)}` : '/crm/contacts';
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectEmailStatsByProjectId, setProjectEmailStatsByProjectId] = useState<
    Record<string, { direct: number; task: number; workspace: number; total: number }>
  >({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [workspaceSocietyNameKeys, setWorkspaceSocietyNameKeys] = useState<string[]>([]);
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
  const [showSingleProjectPrompt, setShowSingleProjectPrompt] = useState(false);
  const [showFirstProjectPrompt, setShowFirstProjectPrompt] = useState(false);
  const [singleProjectCandidate, setSingleProjectCandidate] = useState<Project | null>(null);

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
      const [projectsData, societiesData, settings, contactsData, workspacesData, linkedEmailsData] = await Promise.all([
        apiClient.listProjects(token),
        apiClient.listSocieties(token),
        apiClient.getWorkspaceSettings(token),
        apiClient.listContactsAll(token),
        apiClient.listWorkspaces(token),
        apiClient.listLinkedEmails(token),
      ]);
      const workspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('mw_active_workspace_id')
          : null;
      const linkedEmailsForActiveWorkspace = workspaceId
        ? linkedEmailsData.filter((email) => email.workspace.id === workspaceId)
        : linkedEmailsData;
      setProjects(projectsData);
      setContacts(contactsData);
      const directEmailIdsByProjectId = new Map<string, Set<string>>();
      const taskEmailIdsByProjectId = new Map<string, Set<string>>();
      for (const email of linkedEmailsForActiveWorkspace) {
        if (email.project?.id) {
          if (!directEmailIdsByProjectId.has(email.project.id)) {
            directEmailIdsByProjectId.set(email.project.id, new Set<string>());
          }
          directEmailIdsByProjectId.get(email.project.id)?.add(email.id);
        }
        const taskProjectIds = new Set(
          email.tasks
            .map((link) => link.task.projectId)
            .filter(Boolean),
        );
        for (const projectId of taskProjectIds) {
          if (!taskEmailIdsByProjectId.has(projectId)) {
            taskEmailIdsByProjectId.set(projectId, new Set<string>());
          }
          taskEmailIdsByProjectId.get(projectId)?.add(email.id);
        }
      }
      let workspaceLevelValidatedCount = 0;
      for (const email of linkedEmailsForActiveWorkspace) {
        const metadata = email.metadata as { inboxValidated?: boolean; inboxIgnored?: boolean } | null | undefined;
        const hasProject = Boolean(email.project?.id);
        const hasTask = email.tasks.length > 0;
        if (!hasProject && !hasTask && Boolean(metadata?.inboxValidated) && !Boolean(metadata?.inboxIgnored)) {
          workspaceLevelValidatedCount += 1;
        }
      }

      const nextProjectEmailStats: Record<string, { direct: number; task: number; workspace: number; total: number }> = {};
      const shouldApplyWorkspaceLevelToSingleProject = projectsData.length === 1;
      for (const project of projectsData) {
        const directIds = directEmailIdsByProjectId.get(project.id) ?? new Set<string>();
        const taskIds = taskEmailIdsByProjectId.get(project.id) ?? new Set<string>();
        const totalIds = new Set<string>([...directIds, ...taskIds]);
        const workspaceCount = shouldApplyWorkspaceLevelToSingleProject ? workspaceLevelValidatedCount : 0;
        nextProjectEmailStats[project.id] = {
          direct: directIds.size,
          task: taskIds.size,
          workspace: workspaceCount,
          total: totalIds.size + workspaceCount,
        };
      }
      setProjectEmailStatsByProjectId(nextProjectEmailStats);
      setWorkspaceSocietyNameKeys(
        [...new Set(societiesData.map((society) => normalizeSocietyName(society.name)).filter(Boolean))],
      );
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
      if (projectsData.length === 1) {
        setSingleProjectCandidate(projectsData[0]);
        setShowSingleProjectPrompt(true);
        setShowFirstProjectPrompt(false);
      } else if (projectsData.length === 0) {
        setSingleProjectCandidate(null);
        setShowSingleProjectPrompt(false);
        setShowFirstProjectPrompt(true);
      } else {
        setSingleProjectCandidate(null);
        setShowSingleProjectPrompt(false);
        setShowFirstProjectPrompt(false);
      }
    } catch {
      setProjects([]);
      setProjectEmailStatsByProjectId({});
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
    await load();
  }

  const workspaceSocietyNameKeySet = new Set(workspaceSocietyNameKeys);
  const projectContactsToSelect = [...contacts]
    .filter((contact) => {
      if (!workspaceSocietyNameKeySet.size) return false;
      return workspaceSocietyNameKeySet.has(normalizeSocietyName(contact.society?.name));
    })
    .sort(compareContactsByName);

  async function onUpdateProjectContactRole(contactId: string, role: string): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingProjectId) return;
    await apiClient.updateProjectContact(token, editingProjectId, contactId, {
      projectRole: (role || undefined) as 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | undefined,
    });
    showToast('Rôle projet mis à jour.', 'success');
    await loadProjectContacts(editingProjectId);
    await load();
  }

  async function onRemoveProjectContact(contactId: string): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingProjectId) return;
    await apiClient.removeProjectContact(token, editingProjectId, contactId);
    showToast('Intervenant retiré du projet.', 'success');
    await loadProjectContacts(editingProjectId);
    await load();
  }

  async function onCreateFirstProject(): Promise<void> {
    const token = getAccessToken();
    if (!token || !name || !societyId || saving) return;
    try {
      setSaving(true);
      await apiClient.createProject(token, { name, societyId, missionType });
      showToast('Projet créé.', 'success');
      setName('');
      setShowFirstProjectPrompt(false);
      await load();
    } catch (createError) {
      showToast(createError instanceof Error ? createError.message : 'Enregistrement impossible.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-6" aria-labelledby="projects-page-title">
      <h1 id="projects-page-title" className="text-2xl font-semibold text-[var(--brand)]">Projects</h1>
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
      {loading ? <p className="text-sm text-[#5b5952]" role="status" aria-live="polite">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-4" aria-label="Créer ou modifier un projet">
          <input aria-label="Nom du projet" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom projet" className="rounded border border-[var(--line)] px-3 py-2" />
          <input
            value={defaultSocietyName || 'Aucune société par défaut sur ce workspace'}
            readOnly
            disabled
            className="rounded border border-[var(--line)] bg-[#f3f2ef] px-3 py-2 text-[#5b5952]"
          />
          <select aria-label="Typologie du projet" value={missionType} onChange={(e) => setMissionType(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
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
      {showSingleProjectPrompt && singleProjectCandidate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
            <h2 className="text-lg font-semibold text-[var(--brand)]">Projet unique détecté</h2>
            <p className="mt-2 text-sm text-[#4f4d45]">{singleProjectCandidate.name}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSingleProjectPrompt(false);
                  onEditProject(singleProjectCandidate);
                }}
                className="rounded border border-[var(--line)] px-3 py-2"
              >
                Voir
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSingleProjectPrompt(false);
                  setEditingProjectId(null);
                  setName('');
                }}
                className="rounded border border-[var(--line)] px-3 py-2"
              >
                Ajouter un projet
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSingleProjectPrompt(false);
                  onSetProjectContext(singleProjectCandidate);
                }}
                className="rounded bg-[var(--brand)] px-3 py-2 text-white"
              >
                Aller vers les tâches
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showFirstProjectPrompt ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
            <h2 className="text-lg font-semibold text-[var(--brand)]">Créer le premier projet</h2>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom projet"
                className="rounded border border-[var(--line)] px-3 py-2"
              />
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
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void onCreateFirstProject();
                }}
                disabled={!societyId || !name || saving}
                className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Valider
              </button>
              <button
                type="button"
                onClick={() => setShowFirstProjectPrompt(false)}
                className="rounded border border-[var(--line)] px-3 py-2"
              >
                Refuser
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
              {projectContactsToSelect.map((contact) => (
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
                {[...projectContacts].sort((left, right) =>
                  compareContactsByName(left.contact, right.contact),
                ).map((link) => (
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
                <th className="px-2 py-2">Contact projet</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const emailStats = projectEmailStatsByProjectId[project.id] ?? { direct: 0, task: 0, workspace: 0, total: 0 };
                return (
                  <tr
                    key={project.id}
                    className={project.id === activeProjectId ? 'border-b border-[var(--line)] bg-[#f7f3e8]' : 'border-b border-[var(--line)]'}
                  >
                    <td className="px-2 py-2">{project.name}</td>
                    <td className="px-2 py-2">{project.progressPercent}%</td>
                    <td className="px-2 py-2">{project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : '-'}</td>
                    <td className="px-2 py-2">
                      {project.contacts && project.contacts.length > 0 ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {project.contacts.map((link) => (
                            <Link
                              key={`${project.id}-${link.contact.id}`}
                              href={contactSocietyLink(link.contact.society?.name)}
                              className="text-[var(--brand)] underline-offset-2 hover:underline"
                            >
                              {link.contact.firstName} {link.contact.lastName}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href="/emails"
                        className={emailStats.total > 0
                          ? 'mr-3 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 underline underline-offset-2'
                          : 'mr-3 inline-flex rounded-full border border-[var(--line)] bg-[#f7f6f2] px-2 py-1 text-xs text-[#6a6861] underline underline-offset-2'}
                        title={`Projet: ${emailStats.direct} • Tâches: ${emailStats.task} • Workspace: ${emailStats.workspace}`}
                      >
                        Mails: {emailStats.total}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onSetProjectContext(project)}
                        className="text-[#4f4d45] underline-offset-2 hover:underline"
                      >
                        Sélectionner
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditProject(project)}
                        className="ml-3 text-[var(--brand)] underline-offset-2 hover:underline"
                      >
                        Modifier
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
