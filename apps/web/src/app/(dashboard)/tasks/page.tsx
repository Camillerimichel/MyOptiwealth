'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Task = {
  id: string;
  description: string;
  privateComment?: string | null;
  startDate?: string | null;
  expectedEndDate?: string | null;
  actualEndDate?: string | null;
  status: string;
  priority: number;
  orderNumber: number;
  assignee?: { id: string; email: string } | null;
  companyOwnerContact?: { id: string; firstName: string; lastName: string; society?: { name: string } | null } | null;
};
type Project = { id: string; name: string; progressPercent: number };
type UserOption = { user: { id: string; email: string; firstName?: string | null; lastName?: string | null }; role: string };
type ContactOption = { id: string; firstName: string; lastName: string; society?: { id: string; name: string } | null };

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function toApiDateValue(value: string): string | undefined {
  if (!value) return undefined;
  return `${value}T00:00:00.000Z`;
}

function userDisplayName(user: { email: string; firstName?: string | null; lastName?: string | null }): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.email;
}

export default function TasksPage() {
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
  const [startDate, setStartDate] = useState('');
  const [expectedEndDate, setExpectedEndDate] = useState('');
  const [actualEndDate, setActualEndDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [companyOwnerContactId, setCompanyOwnerContactId] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'rank' | 'priority'>('rank');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
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
      const [tasksData, projectsData, usersData, contactsData] = await Promise.all([
        apiClient.listKanban(token),
        apiClient.listProjects(token),
        apiClient.listUsers(token),
        apiClient.listContacts(token),
      ]);
      setTasks(tasksData);
      setProjects(projectsData);
      setUsers(usersData);
      setContacts(contactsData);
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
    if (!token || !description || !projectId) return;
    if (editingTaskId) {
      await apiClient.updateTask(token, editingTaskId, {
        projectId,
        description,
        privateComment: privateComment || null,
        startDate: toApiDateValue(startDate) ?? null,
        expectedEndDate: toApiDateValue(expectedEndDate) ?? null,
        actualEndDate: toApiDateValue(actualEndDate) ?? null,
        priority,
        orderNumber,
        status,
        assigneeId: assigneeId || null,
        companyOwnerContactId: companyOwnerContactId || null,
      });
      showToast('Tâche mise à jour.', 'success');
    } else {
      await apiClient.createTask(token, {
        projectId,
        description,
        privateComment: privateComment || undefined,
        startDate: toApiDateValue(startDate),
        expectedEndDate: toApiDateValue(expectedEndDate),
        actualEndDate: toApiDateValue(actualEndDate),
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
    setStartDate('');
    setExpectedEndDate('');
    setActualEndDate('');
    setAssigneeId('');
    setCompanyOwnerContactId('');
    await load();
  }

  function onEdit(task: Task): void {
    setEditingTaskId(task.id);
    setDescription(task.description);
    setPrivateComment(task.privateComment ?? '');
    setPriority(task.priority);
    setOrderNumber(task.orderNumber);
    setStatus(task.status);
    setStartDate(toDateInputValue(task.startDate));
    setExpectedEndDate(toDateInputValue(task.expectedEndDate));
    setActualEndDate(toDateInputValue(task.actualEndDate));
    setAssigneeId(task.assignee?.id ?? '');
    setCompanyOwnerContactId(task.companyOwnerContact?.id ?? '');
  }

  function onCancelEdit(): void {
    setEditingTaskId(null);
    setDescription('');
    setPrivateComment('');
    setPriority(2);
    setOrderNumber(1);
    setStatus('TODO');
    setStartDate('');
    setExpectedEndDate('');
    setActualEndDate('');
    setAssigneeId('');
    setCompanyOwnerContactId('');
  }

  const sortedTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const left = sortBy === 'rank' ? a.orderNumber : a.priority;
      const right = sortBy === 'rank' ? b.orderNumber : b.priority;
      if (left === right) return a.orderNumber - b.orderNumber;
      return sortDirection === 'asc' ? left - right : right - left;
    });
    return sorted;
  }, [tasks, sortBy, sortDirection]);

  async function onDeleteTask(taskId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.deleteTask(token, taskId);
    if (editingTaskId === taskId) {
      onCancelEdit();
    }
    showToast('Tâche supprimée.', 'success');
    await load();
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Tasks Kanban</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-12">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
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
              <option value="TODO">TODO</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="WAITING">WAITING</option>
              <option value="DONE">DONE</option>
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
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}{contact.society?.name ? ` (${contact.society.name})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <label className="grid gap-1 text-sm text-[#4f4d45] lg:col-span-4">
              Date de début
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded border border-[var(--line)] px-3 py-2"
                aria-label="Date de début"
              />
            </label>
            <label className="grid gap-1 text-sm text-[#4f4d45] lg:col-span-4">
              Date de fin attendue
              <input
                type="date"
                value={expectedEndDate}
                onChange={(e) => setExpectedEndDate(e.target.value)}
                className="rounded border border-[var(--line)] px-3 py-2"
                aria-label="Date de fin attendue"
              />
            </label>
            <label className="grid gap-1 text-sm text-[#4f4d45] lg:col-span-4">
              Date de fin réelle
              <input
                type="date"
                value={actualEndDate}
                onChange={(e) => setActualEndDate(e.target.value)}
                className="rounded border border-[var(--line)] px-3 py-2"
                aria-label="Date de fin réelle"
              />
            </label>
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
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <p className="font-medium text-[#4f4d45]">Tâches triables</p>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'rank' | 'priority')}
            className="rounded border border-[var(--line)] px-2 py-1"
          >
            <option value="rank">Trier par rang</option>
            <option value="priority">Trier par priorité</option>
          </select>
          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}
            className="rounded border border-[var(--line)] px-2 py-1"
          >
            <option value="asc">Ascendant</option>
            <option value="desc">Descendant</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Etat</th>
                <th className="px-2 py-2">Rang</th>
                <th className="px-2 py-2">Priorité</th>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2">Début</th>
                <th className="px-2 py-2">Fin attendue</th>
                <th className="px-2 py-2">Fin réelle</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => (
                <tr key={task.id} className="border-b border-[var(--line)]">
                  <td className="px-2 py-2">{task.status}</td>
                  <td className="px-2 py-2 font-medium">N{task.orderNumber}</td>
                  <td className="px-2 py-2">P{task.priority}</td>
                  <td className="px-2 py-2">{task.description}</td>
                  <td className="px-2 py-2">{toDateInputValue(task.startDate) || '-'}</td>
                  <td className="px-2 py-2">{toDateInputValue(task.expectedEndDate) || '-'}</td>
                  <td className="px-2 py-2">{toDateInputValue(task.actualEndDate) || '-'}</td>
                  <td className="px-2 py-2">
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
