'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
  setActiveProjectContext,
  setActiveTaskContext,
} from '@/lib/active-task';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Task = {
  id: string;
  projectId: string;
  description: string;
  privateComment?: string | null;
  status: string;
  priority: number;
  orderNumber: number;
  project?: { id: string; name: string } | null;
  linkedEmails?: Array<{
    email: {
      id: string;
      subject: string;
      fromAddress: string;
      receivedAt: string;
    };
  }>;
  assignee?: { id: string; email: string } | null;
  companyOwnerContact?: { id: string; firstName: string; lastName: string; society?: { name: string } | null } | null;
};
type Project = { id: string; name: string; progressPercent: number; missionType?: string | null; societyId?: string };
type UserOption = { user: { id: string; email: string; firstName?: string | null; lastName?: string | null }; role: string };
type ContactOption = { id: string; firstName: string; lastName: string; society?: { id: string; name: string } | null };
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

function taskStatusLabel(status: string): string {
  switch (status) {
    case 'TODO':
      return 'À faire';
    case 'IN_PROGRESS':
      return 'En cours';
    case 'WAITING':
      return 'En attente';
    case 'DONE':
      return 'Fait';
    default:
      return status;
  }
}

function taskStatusBadgeClass(status: string): string {
  switch (status) {
    case 'DONE':
      return 'inline-flex rounded px-2 py-0.5 text-xs font-semibold text-white bg-black';
    case 'IN_PROGRESS':
      return 'inline-flex rounded px-2 py-0.5 text-xs font-semibold text-white bg-green-600';
    case 'WAITING':
      return 'inline-flex rounded px-2 py-0.5 text-xs font-semibold text-white bg-orange-500';
    default:
      return 'inline-flex rounded px-2 py-0.5 text-xs font-semibold bg-[#f3f2ef] text-[#3f3c33]';
  }
}

function userDisplayName(user: { email: string; firstName?: string | null; lastName?: string | null }): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.email;
}

function normalizeSocietyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [privateComment, setPrivateComment] = useState('');
  const [priority, setPriority] = useState(2);
  const [orderNumber, setOrderNumber] = useState(1);
  const [status, setStatus] = useState('TODO');
  const [assigneeId, setAssigneeId] = useState('');
  const [companyOwnerContactId, setCompanyOwnerContactId] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [projectFilterId, setProjectFilterId] = useState('');
  const [sortBy, setSortBy] = useState<'status' | 'rank' | 'priority' | 'description'>('rank');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [activeWorkspaceAssociatedSocietyId, setActiveWorkspaceAssociatedSocietyId] = useState<string | null>(null);
  const [activeWorkspaceAssociatedSocietyName, setActiveWorkspaceAssociatedSocietyName] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);
  const [showFirstTaskPrompt, setShowFirstTaskPrompt] = useState(false);
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
      const [tasksData, projectsData, usersData, contactsData, workspacesData] = await Promise.all([
        apiClient.listKanban(token),
        apiClient.listProjects(token),
        apiClient.listUsers(token),
        apiClient.listContacts(token),
        apiClient.listWorkspaces(token),
      ]);
      setTasks(tasksData);
      setProjects(projectsData);
      setUsers(usersData);
      setContacts(contactsData);
      const workspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('mw_active_workspace_id')
          : null;
      const workspaceName = workspacesData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      const activeWorkspace = workspacesData.find((item) => item.workspace.id === workspaceId);
      setActiveWorkspaceName(workspaceName);
      setActiveWorkspaceAssociatedSocietyId(activeWorkspace?.associatedSocietyId ?? null);
      setActiveWorkspaceAssociatedSocietyName(activeWorkspace?.associatedSocietyName ?? null);
      const activeProject = getActiveProjectContext();
      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId);
        setActiveProjectId(activeProject.projectId);
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
            ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
        setProjectId(activeProject.projectId);
        setProjectFilterId(activeProject.projectId);
        const hasTaskInProject = tasksData.some((task) => task.projectId === activeProject.projectId);
        setShowFirstTaskPrompt(!hasTaskInProject);
      } else {
        setActiveProjectId(null);
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
        setProjectFilterId('');
        setShowFirstTaskPrompt(false);
      }
      const activeTask = getActiveTaskContext();
      if (activeTask) {
        const exists = tasksData.some((task) => task.id === activeTask.taskId);
        if (exists && (!activeProject || activeTask.projectId === activeProject.projectId)) {
          setActiveTaskId(activeTask.taskId);
          setActiveTaskLabel(activeTask.taskDescription);
        } else {
          setActiveTaskId(null);
          setActiveTaskLabel(null);
          clearActiveTaskContext();
        }
      } else {
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

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    const targetProjectId = activeProjectId ?? projectId;
    if (!token || !description || !targetProjectId) return;
    if (editingTaskId) {
      await apiClient.updateTask(token, editingTaskId, {
        projectId: targetProjectId,
        description,
        privateComment: privateComment || null,
        priority,
        orderNumber,
        status,
        assigneeId: assigneeId || null,
        companyOwnerContactId: companyOwnerContactId || null,
      });
      showToast('Tâche mise à jour.', 'success');
    } else {
      await apiClient.createTask(token, {
        projectId: targetProjectId,
        description,
        privateComment: privateComment || undefined,
        priority,
        orderNumber,
        status: 'TODO',
        assigneeId: assigneeId || undefined,
        companyOwnerContactId: companyOwnerContactId || undefined,
        visibleToClient: false,
      });
      showToast('Tâche créée.', 'success');
    }

    setEditingTaskId(null);
    setDescription('');
    setPrivateComment('');
    setPriority(2);
    setOrderNumber(1);
    setStatus('TODO');
    setAssigneeId('');
    setCompanyOwnerContactId('');
    setShowTaskForm(false);
    await load();
  }

  function onEdit(task: Task): void {
    const workspaceId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('mw_active_workspace_id') ?? undefined
        : undefined;
    setShowTaskForm(true);
    setEditingTaskId(task.id);
    setProjectId(task.projectId);
    setDescription(task.description);
    setPrivateComment(task.privateComment ?? '');
    setPriority(task.priority);
    setOrderNumber(task.orderNumber);
    setStatus(task.status);
    setAssigneeId(task.assignee?.id ?? '');
    setCompanyOwnerContactId(task.companyOwnerContact?.id ?? '');
    setActiveTaskId(task.id);
    setActiveTaskLabel(task.description);
    setActiveTaskContext({
      taskId: task.id,
      projectId: task.projectId,
      taskDescription: task.description,
      workspaceId,
    });
  }

  function onSelectTask(task: Task, redirectToEmails = false): void {
    const workspaceId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('mw_active_workspace_id') ?? undefined
        : undefined;

    if (!activeProjectId || activeProjectId !== task.projectId) {
      const project = projects.find((item) => item.id === task.projectId);
      if (project) {
        setActiveProjectContext({
          projectId: project.id,
          projectTitle: project.name,
          projectTypology: project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : null,
          workspaceId,
        });
        setActiveProjectId(project.id);
        setActiveProjectTitle(project.name);
        setActiveProjectTypology(project.missionType ? (LEGACY_MISSION_LABELS[project.missionType] ?? project.missionType) : null);
      }
    }

    setActiveTaskId(task.id);
    setActiveTaskLabel(task.description);
    setActiveTaskContext({
      taskId: task.id,
      projectId: task.projectId,
      taskDescription: task.description,
      workspaceId,
    });
    showToast('Tâche active mise à jour.', 'success');
    if (redirectToEmails) {
      const hasLinkedEmails = Boolean(task.linkedEmails && task.linkedEmails.length > 0);
      if (hasLinkedEmails) {
        router.push('/emails');
      } else {
        showToast('Aucun email lié à cette tâche.', 'success');
      }
    }
  }

  async function onCreateFirstTask(): Promise<void> {
    const token = getAccessToken();
    const targetProjectId = activeProjectId ?? projectId;
    if (!token || !description || !targetProjectId) return;
    await apiClient.createTask(token, {
      projectId: targetProjectId,
      description,
      privateComment: privateComment || undefined,
      priority,
      orderNumber,
      status: status || 'TODO',
      assigneeId: assigneeId || undefined,
      companyOwnerContactId: companyOwnerContactId || undefined,
      visibleToClient: false,
    });
    showToast('Tâche créée.', 'success');
    setShowFirstTaskPrompt(false);
    setDescription('');
    setPrivateComment('');
    await load();
  }

  function onCancelEdit(): void {
    setEditingTaskId(null);
    setDescription('');
    setPrivateComment('');
    setPriority(2);
    setOrderNumber(1);
    setStatus('TODO');
    setAssigneeId('');
    setCompanyOwnerContactId('');
    setShowTaskForm(false);
  }

  function statusSortValue(taskStatus: string): number {
    switch (taskStatus) {
      case 'TODO':
        return 1;
      case 'IN_PROGRESS':
        return 2;
      case 'WAITING':
        return 3;
      case 'DONE':
        return 4;
      default:
        return 99;
    }
  }

  const sortedTasks = useMemo(() => {
    const effectiveProjectFilterId = activeProjectId ?? projectFilterId;
    const filtered = effectiveProjectFilterId
      ? tasks.filter((task) => task.project?.id === effectiveProjectFilterId || task.projectId === effectiveProjectFilterId)
      : [];
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'status') {
        const left = statusSortValue(a.status);
        const right = statusSortValue(b.status);
        if (left === right) return a.orderNumber - b.orderNumber;
        return sortDirection === 'asc' ? left - right : right - left;
      }
      if (sortBy === 'rank') {
        if (a.orderNumber === b.orderNumber) return a.priority - b.priority;
        return sortDirection === 'asc' ? a.orderNumber - b.orderNumber : b.orderNumber - a.orderNumber;
      }
      if (sortBy === 'priority') {
        if (a.priority === b.priority) return a.orderNumber - b.orderNumber;
        return sortDirection === 'asc' ? a.priority - b.priority : b.priority - a.priority;
      }
      if (sortBy === 'description') {
        const cmp = a.description.localeCompare(b.description, 'fr', { sensitivity: 'base' });
        if (cmp === 0) return a.orderNumber - b.orderNumber;
        return sortDirection === 'asc' ? cmp : -cmp;
      }
      return a.orderNumber - b.orderNumber;
    });
    return sorted;
  }, [tasks, activeProjectId, projectFilterId, sortBy, sortDirection]);

  const companyOwnerContactOptions = useMemo(() => {
    if (!activeWorkspaceAssociatedSocietyId && !activeWorkspaceAssociatedSocietyName) return contacts;
    const normalizedWorkspaceSocietyName = normalizeSocietyName(activeWorkspaceAssociatedSocietyName ?? '');
    return contacts.filter((contact) => {
      if (!contact.society) return false;
      if (activeWorkspaceAssociatedSocietyId && contact.society.id === activeWorkspaceAssociatedSocietyId) return true;
      if (normalizedWorkspaceSocietyName && normalizeSocietyName(contact.society.name) === normalizedWorkspaceSocietyName) return true;
      return false;
    });
  }, [contacts, activeWorkspaceAssociatedSocietyId, activeWorkspaceAssociatedSocietyName]);

  useEffect(() => {
    if (!companyOwnerContactId) return;
    const isStillAllowed = companyOwnerContactOptions.some((contact) => contact.id === companyOwnerContactId);
    if (!isStillAllowed) {
      setCompanyOwnerContactId('');
    }
  }, [companyOwnerContactId, companyOwnerContactOptions]);

  function onSort(column: 'status' | 'rank' | 'priority' | 'description'): void {
    if (sortBy === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(column);
    setSortDirection('asc');
  }

  function sortIndicator(column: 'status' | 'rank' | 'priority' | 'description'): string {
    if (sortBy !== column) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  async function onDeleteTask(taskId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.deleteTask(token, taskId);
    if (editingTaskId === taskId) {
      onCancelEdit();
    }
    if (activeTaskId === taskId) {
      setActiveTaskId(null);
      setActiveTaskLabel(null);
      clearActiveTaskContext();
    }
    showToast('Tâche supprimée.', 'success');
    await load();
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Tasks Kanban</h1>
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
              setActiveProjectId(null);
              setActiveProjectTitle(null);
              setActiveTaskId(null);
              setActiveTaskLabel(null);
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
        <p className="text-sm text-[#5b5952]">Sélectionne d abord un contexte projet dans Projects.</p>
      ) : null}
      {showFirstTaskPrompt && activeProjectId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
            <h2 className="text-lg font-semibold text-[var(--brand)]">Créer la première tâche</h2>
            <div className="mt-3 grid gap-4">
              <div className="grid gap-3 lg:grid-cols-12">
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={!!activeProjectId}
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-4"
                >
                  <option value="">Projet</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description"
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-8"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
                <input
                  type="number"
                  min={1}
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(Number(e.target.value) || 1)}
                  placeholder="Rang"
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-2"
                />
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-2"
                >
                  <option value={1}>Priorité 1</option>
                  <option value={2}>Priorité 2</option>
                  <option value={3}>Priorité 3</option>
                </select>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-2"
                >
                  <option value="TODO">À faire</option>
                  <option value="IN_PROGRESS">En cours</option>
                  <option value="WAITING">En attente</option>
                  <option value="DONE">Fait</option>
                </select>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-3"
                >
                  <option value="">Responsable interne</option>
                  {users.map((item) => (
                    <option key={item.user.id} value={item.user.id}>
                      {userDisplayName(item.user)}
                    </option>
                  ))}
                </select>
                <select
                  value={companyOwnerContactId}
                  onChange={(e) => setCompanyOwnerContactId(e.target.value)}
                  className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-3"
                >
                  <option value="">Responsable société</option>
                  {companyOwnerContactOptions.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName}{contact.society?.name ? ` (${contact.society.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={privateComment}
                onChange={(e) => setPrivateComment(e.target.value)}
                placeholder="Commentaire interne"
                rows={3}
                className="min-h-24 rounded border border-[var(--line)] px-3 py-2"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { void onCreateFirstTask(); }}
                  className="rounded bg-[var(--brand)] px-3 py-2 text-white"
                >
                  Valider
                </button>
                <button
                  type="button"
                  onClick={() => setShowFirstTaskPrompt(false)}
                  className="rounded border border-[var(--line)] px-3 py-2"
                >
                  Refuser
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showTaskForm || editingTaskId ? (
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-12">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!!activeProjectId}
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-4"
            >
              <option value="">Projet</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-8"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <input
              type="number"
              min={1}
              value={orderNumber}
              onChange={(e) => setOrderNumber(Number(e.target.value) || 1)}
              placeholder="Rang"
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-2"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-2"
            >
              <option value={1}>Priorité 1</option>
              <option value={2}>Priorité 2</option>
              <option value={3}>Priorité 3</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-2"
            >
              <option value="TODO">À faire</option>
              <option value="IN_PROGRESS">En cours</option>
              <option value="WAITING">En attente</option>
              <option value="DONE">Fait</option>
            </select>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-3"
            >
              <option value="">Responsable interne</option>
              {users.map((item) => (
                <option key={item.user.id} value={item.user.id}>
                  {userDisplayName(item.user)}
                </option>
              ))}
            </select>
            <select
              value={companyOwnerContactId}
              onChange={(e) => setCompanyOwnerContactId(e.target.value)}
              className="rounded border border-[var(--line)] px-3 py-2 lg:col-span-3"
            >
              <option value="">Responsable société</option>
              {companyOwnerContactOptions.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}{contact.society?.name ? ` (${contact.society.name})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 lg:grid-cols-12">
            <textarea
              value={privateComment}
              onChange={(e) => setPrivateComment(e.target.value)}
              placeholder="Commentaire interne (non affiché dans la liste)"
              rows={3}
              className="min-h-24 rounded border border-[var(--line)] px-3 py-2 lg:col-span-12"
            />
            <div className="flex gap-2 lg:col-span-12">
              <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">
                {editingTaskId ? 'Mettre à jour tâche' : 'Créer tâche'}
              </button>
              {editingTaskId ? (
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded border border-[var(--line)] px-3 py-2 text-[#4f4d45]"
                >
                  Annuler
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </article>
      ) : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#4f4d45]">Tâches triables (clic sur les colonnes)</p>
            <select
              value={activeProjectId ?? projectFilterId}
              onChange={(e) => setProjectFilterId(e.target.value)}
              disabled={!!activeProjectId}
              className="rounded border border-[var(--line)] px-2 py-1 text-xs"
            >
              <option value="">Tous les projets</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingTaskId(null);
                setDescription('');
                setPrivateComment('');
                setPriority(2);
                setOrderNumber(1);
                setStatus('TODO');
                setAssigneeId('');
                setCompanyOwnerContactId('');
                setShowTaskForm(true);
              }}
              disabled={!activeProjectId}
              className="rounded bg-[var(--brand)] px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Créer tâche
            </button>
            {showTaskForm || editingTaskId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingTaskId(null);
                  setShowTaskForm(false);
                }}
                className="rounded border border-[var(--line)] px-3 py-2 text-xs text-[#4f4d45]"
              >
                Masquer
              </button>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onSort('status')} className="font-semibold hover:underline">
                    Etat{sortIndicator('status')}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onSort('rank')} className="font-semibold hover:underline">
                    Rang{sortIndicator('rank')}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onSort('priority')} className="font-semibold hover:underline">
                    Priorité{sortIndicator('priority')}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onSort('description')} className="font-semibold hover:underline">
                    Description{sortIndicator('description')}
                  </button>
                </th>
                <th className="px-2 py-2">Projet</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => (
                <tr
                  key={task.id}
                  className={task.id === activeTaskId ? 'border-b border-[var(--line)] bg-[#f7f3e8]' : 'border-b border-[var(--line)]'}
                >
                  <td className="px-2 py-2">
                    <span className={taskStatusBadgeClass(task.status)}>
                      {taskStatusLabel(task.status)}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-medium">N{task.orderNumber}</td>
                  <td className="px-2 py-2">P{task.priority}</td>
                  <td
                    className="cursor-pointer px-2 py-2 hover:bg-[#f7f3e8]"
                    onClick={() => onSelectTask(task, true)}
                    title="Cliquer pour sélectionner cette tâche"
                  >
                    <div>{task.description}</div>
                    {task.linkedEmails && task.linkedEmails.length > 0 ? (
                      <div className="mt-1 text-xs text-[#4f4d45]">
                        Emails liés: {task.linkedEmails.length}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{task.project?.name ?? '-'}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSelectTask(task)}
                      className="mr-3 text-[#2f2b23] underline-offset-2 hover:underline"
                    >
                      Sélectionner
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(task)}
                      className="mr-3 text-[var(--brand)] underline-offset-2 hover:underline"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onDeleteTask(task.id);
                      }}
                      className="text-red-700 underline-offset-2 hover:underline"
                    >
                      Supprimer
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
