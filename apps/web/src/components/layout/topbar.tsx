'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type WorkspaceMembership = { workspace: { id: string; name: string } };
type SearchContact = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  society?: { id: string; name: string } | null;
};
type SearchProject = {
  id: string;
  name: string;
  missionType?: string | null;
  society?: { id: string; name: string } | null;
};
type SearchTask = {
  id: string;
  description: string;
  privateComment?: string | null;
  project?: { id: string; name: string } | null;
};
type SearchEmail = {
  id: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  workspaceName?: string;
  projectName?: string;
  taskLabels?: string[];
  metadata?: { preview?: string } | null;
};
type SearchWorkspaceNote = {
  id: string;
  content: string;
  createdAt: string;
  authorLabel: string;
  workspaceName: string;
};

const RESULTS_PER_PAGE = 5;

function normalizeSearchValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function matchesText(value: unknown, query: string): boolean {
  if (!query) return false;
  return normalizeSearchValue(value).includes(query);
}

export function Topbar() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<Array<WorkspaceMembership>>([]);
  const workspaceCollator = useMemo(
    () => new Intl.Collator('fr', { sensitivity: 'base' }),
    [],
  );

  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((left, right) =>
        workspaceCollator.compare(
          left.workspace.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase(),
          right.workspace.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase(),
        ),
      ),
    [workspaces, workspaceCollator],
  );

  const currentWorkspaceName = useMemo(() => {
    const active = sortedWorkspaces.find((item) => item.workspace.id === workspaceId);
    return active?.workspace.name ?? 'Aucun workspace';
  }, [sortedWorkspaces, workspaceId]);

  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggingOutRef = useRef(false);

  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchContacts, setSearchContacts] = useState<SearchContact[]>([]);
  const [searchWorkspaceList, setSearchWorkspaceList] = useState<Array<{ id: string; name: string }>>([]);
  const [searchProjects, setSearchProjects] = useState<SearchProject[]>([]);
  const [searchTasks, setSearchTasks] = useState<SearchTask[]>([]);
  const [searchEmails, setSearchEmails] = useState<SearchEmail[]>([]);
  const [searchNotes, setSearchNotes] = useState<SearchWorkspaceNote[]>([]);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pageByCategory, setPageByCategory] = useState({
    contacts: 1,
    workspaces: 1,
    projects: 1,
    tasks: 1,
    emails: 1,
    notes: 1,
  });
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const performLogout = useCallback(async (reason: 'manual' | 'inactive') => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    const token = getAccessToken();
    if (token) {
      try {
        await apiClient.logout(token);
      } catch {
        // Best effort logout: continue client-side logout even if API fails.
      }
    }
    clearAccessToken();
    showToast(reason === 'inactive' ? 'Déconnexion automatique après inactivité.' : 'Déconnexion réussie.', 'success');
    router.push('/login');
  }, [router]);

  const loadWorkspaceNotes = useCallback(async (): Promise<void> => {
    const token = getAccessToken();
    if (!token) {
      setNoteError('Session introuvable. Reconnectez-vous.');
      return;
    }
    try {
      setNoteLoading(true);
      setNoteError(null);
      const notesData = await apiClient.listWorkspaceNotes(token);
      setSearchNotes(notesData.map((note) => ({
        id: note.id,
        content: String(note.content ?? ''),
        createdAt: String(note.createdAt ?? ''),
        authorLabel: [note.author?.firstName, note.author?.lastName].filter(Boolean).join(' ').trim()
          || note.author?.email
          || 'Auteur inconnu',
        workspaceName: currentWorkspaceName,
      })));
    } catch {
      setNoteError('Impossible de charger les notes.');
    } finally {
      setNoteLoading(false);
    }
  }, [currentWorkspaceName]);

  const loadSearchData = useCallback(async (): Promise<void> => {
    const token = getAccessToken();
    if (!token) {
      setSearchError('Session introuvable. Reconnectez-vous.');
      return;
    }

    try {
      setSearchLoading(true);
      setSearchError(null);
      const [contactsData, workspacesData, projectsData, tasksData, emailsData, notesData] = await Promise.all([
        apiClient.listContactsAll(token),
        apiClient.listWorkspaces(token),
        apiClient.listProjects(token),
        apiClient.listKanban(token),
        apiClient.listLinkedEmails(token),
        apiClient.listWorkspaceNotesAll(token),
      ]);

      setSearchContacts(contactsData);
      setSearchWorkspaceList(workspacesData.map((item) => item.workspace));
      setSearchProjects(projectsData);
      setSearchTasks(tasksData.map((task) => ({
        id: task.id,
        description: String(task.description ?? ''),
        privateComment: task.privateComment,
        project: task.project,
      })));
      setSearchEmails(emailsData.map((email) => ({
        id: email.id,
        subject: String(email.subject ?? ''),
        fromAddress: String(email.fromAddress ?? ''),
        toAddresses: Array.isArray(email.toAddresses) ? email.toAddresses : [],
        workspaceName: email.workspace?.name ?? '',
        projectName: email.project?.name ?? '',
        taskLabels: Array.isArray(email.tasks) ? email.tasks.map((item) => String(item.task.description ?? '')) : [],
        metadata: email.metadata,
      })));
      setSearchNotes(notesData.map((note) => ({
        id: note.id,
        content: String(note.content ?? ''),
        createdAt: String(note.createdAt ?? ''),
        authorLabel: [note.author?.firstName, note.author?.lastName].filter(Boolean).join(' ').trim()
          || note.author?.email
          || 'Auteur inconnu',
        workspaceName: note.workspace?.name ?? 'Workspace inconnu',
      })));
    } catch {
      setSearchError('Impossible de charger les données de recherche.');
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const resolveWorkspaceId = (memberships: Array<{ workspace: { id: string; name: string }; isDefault?: boolean }>): string => {
      const savedWorkspaceId = localStorage.getItem('mw_active_workspace_id');
      if (savedWorkspaceId && memberships.some((item) => item.workspace.id === savedWorkspaceId)) {
        return savedWorkspaceId;
      }
      const fallback = memberships.find((item) => item.isDefault) ?? memberships[0];
      return fallback?.workspace.id ?? '';
    };
    const token = getAccessToken();
    if (token) {
      void apiClient.listWorkspaces(token).then((memberships) => {
        if (!active) return;
        setWorkspaces(memberships);
        setWorkspaceId(resolveWorkspaceId(memberships));
      });
    }
    const onWorkspaceChanged = (): void => {
      if (!active) return;
      const changedToken = getAccessToken();
      if (!changedToken) return;
      void apiClient.listWorkspaces(changedToken).then((memberships) => {
        if (!active) return;
        setWorkspaces(memberships);
        setWorkspaceId(resolveWorkspaceId(memberships));
      });
    };
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    return () => {
      active = false;
      window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
    };
  }, []);

  useEffect(() => {
    const resetInactivityTimer = (): void => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      inactivityTimeoutRef.current = setTimeout(() => {
        void performLogout('inactive');
      }, 60 * 60 * 1000);
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer();

    return () => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      events.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
    };
  }, [performLogout]);

  useEffect(() => {
    if (!searchModalOpen) return;
    searchInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSearchModalOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [searchModalOpen]);

  const normalizedSearchQuery = useMemo(() => normalizeSearchValue(searchQuery), [searchQuery]);

  const filteredContacts = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return searchContacts.filter((contact) => {
      const label = `${contact.firstName} ${contact.lastName} ${contact.email ?? ''} ${contact.phone ?? ''} ${contact.society?.name ?? ''}`;
      return matchesText(label, normalizedSearchQuery);
    });
  }, [searchContacts, normalizedSearchQuery]);

  const filteredWorkspaces = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return searchWorkspaceList.filter((workspace) => matchesText(workspace.name, normalizedSearchQuery));
  }, [searchWorkspaceList, normalizedSearchQuery]);

  const filteredProjects = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return searchProjects.filter((project) => {
      const label = `${project.name} ${project.missionType ?? ''} ${project.society?.name ?? ''}`;
      return matchesText(label, normalizedSearchQuery);
    });
  }, [searchProjects, normalizedSearchQuery]);

  const filteredTasks = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return searchTasks.filter((task) => {
      const label = `${task.description} ${task.privateComment ?? ''} ${task.project?.name ?? ''}`;
      return matchesText(label, normalizedSearchQuery);
    });
  }, [searchTasks, normalizedSearchQuery]);

  const filteredEmails = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return searchEmails.filter((email) => {
      const label = `${email.subject} ${email.fromAddress} ${email.toAddresses.join(' ')} ${email.metadata?.preview ?? ''} ${email.workspaceName ?? ''} ${email.projectName ?? ''} ${(email.taskLabels ?? []).join(' ')}`;
      return matchesText(label, normalizedSearchQuery);
    });
  }, [searchEmails, normalizedSearchQuery]);

  const filteredNotes = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return searchNotes.filter((note) => {
      const label = `${note.content} ${note.authorLabel} ${note.workspaceName} ${new Date(note.createdAt).toLocaleString('fr-FR')}`;
      return matchesText(label, normalizedSearchQuery);
    });
  }, [searchNotes, normalizedSearchQuery]);

  const contactsTotalPages = Math.max(1, Math.ceil(filteredContacts.length / RESULTS_PER_PAGE));
  const workspacesTotalPages = Math.max(1, Math.ceil(filteredWorkspaces.length / RESULTS_PER_PAGE));
  const projectsTotalPages = Math.max(1, Math.ceil(filteredProjects.length / RESULTS_PER_PAGE));
  const tasksTotalPages = Math.max(1, Math.ceil(filteredTasks.length / RESULTS_PER_PAGE));
  const emailsTotalPages = Math.max(1, Math.ceil(filteredEmails.length / RESULTS_PER_PAGE));
  const notesTotalPages = Math.max(1, Math.ceil(filteredNotes.length / RESULTS_PER_PAGE));

  const contactsPage = Math.min(pageByCategory.contacts, contactsTotalPages);
  const workspacesPage = Math.min(pageByCategory.workspaces, workspacesTotalPages);
  const projectsPage = Math.min(pageByCategory.projects, projectsTotalPages);
  const tasksPage = Math.min(pageByCategory.tasks, tasksTotalPages);
  const emailsPage = Math.min(pageByCategory.emails, emailsTotalPages);
  const notesPage = Math.min(pageByCategory.notes, notesTotalPages);

  const pagedContacts = filteredContacts.slice((contactsPage - 1) * RESULTS_PER_PAGE, contactsPage * RESULTS_PER_PAGE);
  const pagedWorkspaces = filteredWorkspaces.slice((workspacesPage - 1) * RESULTS_PER_PAGE, workspacesPage * RESULTS_PER_PAGE);
  const pagedProjects = filteredProjects.slice((projectsPage - 1) * RESULTS_PER_PAGE, projectsPage * RESULTS_PER_PAGE);
  const pagedTasks = filteredTasks.slice((tasksPage - 1) * RESULTS_PER_PAGE, tasksPage * RESULTS_PER_PAGE);
  const pagedEmails = filteredEmails.slice((emailsPage - 1) * RESULTS_PER_PAGE, emailsPage * RESULTS_PER_PAGE);
  const pagedNotes = filteredNotes.slice((notesPage - 1) * RESULTS_PER_PAGE, notesPage * RESULTS_PER_PAGE);

  const setCategoryPage = useCallback((
    category: 'contacts' | 'workspaces' | 'projects' | 'tasks' | 'emails' | 'notes',
    nextPage: number,
  ): void => {
    setPageByCategory((prev) => ({
      ...prev,
      [category]: Math.max(1, nextPage),
    }));
  }, []);

  useEffect(() => {
    setPageByCategory({
      contacts: 1,
      workspaces: 1,
      projects: 1,
      tasks: 1,
      emails: 1,
      notes: 1,
    });
  }, [normalizedSearchQuery]);

  async function onSwitch(nextWorkspaceId: string): Promise<void> {
    setWorkspaceId(nextWorkspaceId);
    const token = getAccessToken();
    if (!token) return;
    const switched = await apiClient.switchWorkspace(token, nextWorkspaceId);
    localStorage.setItem('mw_access_token', switched.accessToken);
    localStorage.setItem('mw_active_workspace_id', switched.activeWorkspaceId);
    window.dispatchEvent(new Event('mw_workspace_changed'));
    showToast('Workspace actif changé.', 'success');
    window.location.assign('/projects');
  }

  async function openSearchModal(): Promise<void> {
    setSearchModalOpen(true);
    await loadSearchData();
  }

  async function openNoteModal(): Promise<void> {
    setNoteModalOpen(true);
    await loadWorkspaceNotes();
  }

  function closeSearchModal(): void {
    setSearchModalOpen(false);
    setSearchQuery('');
    setPageByCategory({
      contacts: 1,
      workspaces: 1,
      projects: 1,
      tasks: 1,
      emails: 1,
      notes: 1,
    });
  }

  function closeNoteModal(): void {
    setNoteModalOpen(false);
    setNoteDraft('');
    setNoteError(null);
  }

  async function onAppendNote(): Promise<void> {
    const token = getAccessToken();
    const content = noteDraft.trim();
    if (!token || !content || noteSaving) return;
    try {
      setNoteSaving(true);
      await apiClient.appendWorkspaceNote(token, content);
      setNoteDraft('');
      showToast('Note ajoutée.', 'success');
      await loadWorkspaceNotes();
    } catch (appendError) {
      setNoteError(appendError instanceof Error ? appendError.message : 'Ajout impossible.');
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
        <div className="min-w-[260px]">
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-[#6f6d66]">Workspace actif</p>
          <details className="group relative">
            <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm shadow-sm hover:bg-[#f8f5eb]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--brand)]" />
                <span className="max-w-[160px] truncate font-semibold text-[#2f2b23]">{currentWorkspaceName}</span>
              </div>
              <span className="text-[#6f6d66] group-open:rotate-180">▾</span>
            </summary>
            <ul className="absolute right-0 z-20 mt-2 min-w-[260px] rounded-lg border border-[var(--line)] bg-white p-2 shadow-lg">
              {sortedWorkspaces.map((item) => (
                <li key={item.workspace.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void onSwitch(item.workspace.id);
                    }}
                    className={`w-full rounded px-3 py-2 text-left text-sm ${
                      item.workspace.id === workspaceId
                        ? 'bg-[var(--brand)] text-white'
                        : 'text-[#2f2b23] hover:bg-[#f8f5eb]'
                    }`}
                  >
                    <div className="truncate">{item.workspace.name}</div>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-[#4f4d45]">Premium Consulting Operating System</p>
          <button
            type="button"
            onClick={() => {
              void openSearchModal();
            }}
            className="rounded border border-[var(--line)] px-3 py-2 text-sm hover:bg-[#f8f5eb]"
          >
            Recherche
          </button>
          <button
            type="button"
            onClick={() => {
              void openNoteModal();
            }}
            className="rounded border border-[var(--line)] px-3 py-2 text-sm hover:bg-[#f8f5eb]"
          >
            Note
          </button>
          <button
            type="button"
            onClick={() => {
              void performLogout('manual');
            }}
            className="rounded border border-[var(--line)] px-3 py-2 text-sm"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {searchModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
          <div className="mx-auto mt-6 flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="global-search-title" className="text-xl font-semibold text-[var(--brand)]">Recherche globale</h2>
              <button
                type="button"
                onClick={closeSearchModal}
                className="rounded border border-[var(--line)] px-3 py-2 text-sm hover:bg-[#f8f5eb]"
              >
                Fermer
              </button>
            </div>

            <div className="mb-4">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Rechercher dans contacts, workspaces, projets, tâches, mails..."
                className="w-full rounded-lg border border-[var(--line)] px-4 py-3 text-sm outline-none focus:border-[var(--brand)]"
              />
            </div>

            {searchLoading ? <p className="mb-3 text-sm text-[#5b5952]">Chargement des données...</p> : null}
            {searchError ? <p className="mb-3 text-sm text-red-700">{searchError}</p> : null}
            {!searchLoading && !searchError && !normalizedSearchQuery ? (
              <p className="mb-3 text-sm text-[#5b5952]">Commencez à taper pour rechercher.</p>
            ) : null}

            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-lg border border-[var(--line)] bg-[#faf8f2] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--brand)]">Contacts ({filteredContacts.length})</h3>
                {filteredContacts.length === 0 ? (
                  <p className="text-xs text-[#6a6861]">Aucun résultat</p>
                ) : (
                  <>
                  <ul className="grid gap-1">
                    {pagedContacts.map((contact) => (
                      <li key={contact.id}>
                        <Link
                          href={`/crm/contacts?contactId=${encodeURIComponent(contact.id)}`}
                          onClick={closeSearchModal}
                          className="text-sm text-[#2f2b23] underline-offset-2 hover:underline"
                        >
                          {[contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Contact sans nom'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#6a6861]">
                    <span>Page {contactsPage}/{contactsTotalPages}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={contactsPage <= 1}
                        onClick={() => setCategoryPage('contacts', contactsPage - 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Précédente
                      </button>
                      <button
                        type="button"
                        disabled={contactsPage >= contactsTotalPages}
                        onClick={() => setCategoryPage('contacts', contactsPage + 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Suivante
                      </button>
                    </div>
                  </div>
                  </>
                )}
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[#faf8f2] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--brand)]">Workspaces ({filteredWorkspaces.length})</h3>
                {filteredWorkspaces.length === 0 ? (
                  <p className="text-xs text-[#6a6861]">Aucun résultat</p>
                ) : (
                  <>
                  <ul className="grid gap-1">
                    {pagedWorkspaces.map((workspace) => (
                      <li key={workspace.id}>
                        <Link
                          href={`/settings/workspace?workspaceId=${encodeURIComponent(workspace.id)}`}
                          onClick={closeSearchModal}
                          className="text-sm text-[#2f2b23] underline-offset-2 hover:underline"
                        >
                          {workspace.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#6a6861]">
                    <span>Page {workspacesPage}/{workspacesTotalPages}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={workspacesPage <= 1}
                        onClick={() => setCategoryPage('workspaces', workspacesPage - 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Précédente
                      </button>
                      <button
                        type="button"
                        disabled={workspacesPage >= workspacesTotalPages}
                        onClick={() => setCategoryPage('workspaces', workspacesPage + 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Suivante
                      </button>
                    </div>
                  </div>
                  </>
                )}
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[#faf8f2] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--brand)]">Projets ({filteredProjects.length})</h3>
                {filteredProjects.length === 0 ? (
                  <p className="text-xs text-[#6a6861]">Aucun résultat</p>
                ) : (
                  <>
                  <ul className="grid gap-1">
                    {pagedProjects.map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/projects?projectId=${encodeURIComponent(project.id)}`}
                          onClick={closeSearchModal}
                          className="text-sm text-[#2f2b23] underline-offset-2 hover:underline"
                        >
                          {project.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#6a6861]">
                    <span>Page {projectsPage}/{projectsTotalPages}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={projectsPage <= 1}
                        onClick={() => setCategoryPage('projects', projectsPage - 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Précédente
                      </button>
                      <button
                        type="button"
                        disabled={projectsPage >= projectsTotalPages}
                        onClick={() => setCategoryPage('projects', projectsPage + 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Suivante
                      </button>
                    </div>
                  </div>
                  </>
                )}
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[#faf8f2] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--brand)]">Tâches ({filteredTasks.length})</h3>
                {filteredTasks.length === 0 ? (
                  <p className="text-xs text-[#6a6861]">Aucun résultat</p>
                ) : (
                  <>
                  <ul className="grid gap-1">
                    {pagedTasks.map((task) => (
                      <li key={task.id}>
                        <Link
                          href={`/tasks?taskId=${encodeURIComponent(task.id)}`}
                          onClick={closeSearchModal}
                          className="text-sm text-[#2f2b23] underline-offset-2 hover:underline"
                        >
                          {task.description}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#6a6861]">
                    <span>Page {tasksPage}/{tasksTotalPages}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={tasksPage <= 1}
                        onClick={() => setCategoryPage('tasks', tasksPage - 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Précédente
                      </button>
                      <button
                        type="button"
                        disabled={tasksPage >= tasksTotalPages}
                        onClick={() => setCategoryPage('tasks', tasksPage + 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Suivante
                      </button>
                    </div>
                  </div>
                  </>
                )}
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[#faf8f2] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--brand)]">Mails ({filteredEmails.length})</h3>
                {filteredEmails.length === 0 ? (
                  <p className="text-xs text-[#6a6861]">Aucun résultat</p>
                ) : (
                  <>
                  <ul className="grid gap-1">
                    {pagedEmails.map((email) => (
                      <li key={email.id}>
                        <Link
                          href={`/boite-mail`}
                          onClick={closeSearchModal}
                          className="text-sm text-[#2f2b23] underline-offset-2 hover:underline"
                        >
                          {email.subject || '(Sans objet)'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#6a6861]">
                    <span>Page {emailsPage}/{emailsTotalPages}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={emailsPage <= 1}
                        onClick={() => setCategoryPage('emails', emailsPage - 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Précédente
                      </button>
                      <button
                        type="button"
                        disabled={emailsPage >= emailsTotalPages}
                        onClick={() => setCategoryPage('emails', emailsPage + 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Suivante
                      </button>
                    </div>
                  </div>
                  </>
                )}
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[#faf8f2] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--brand)]">Notes ({filteredNotes.length})</h3>
                {filteredNotes.length === 0 ? (
                  <p className="text-xs text-[#6a6861]">Aucun résultat</p>
                ) : (
                  <>
                  <ul className="grid gap-1">
                    {pagedNotes.map((note) => (
                      <li key={note.id}>
                        <Link
                          href="/dashboard"
                          onClick={(event) => {
                            event.preventDefault();
                            closeSearchModal();
                            void openNoteModal();
                          }}
                          className="text-sm text-[#2f2b23] underline-offset-2 hover:underline"
                        >
                          {note.content.slice(0, 120)} ({note.workspaceName})
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#6a6861]">
                    <span>Page {notesPage}/{notesTotalPages}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={notesPage <= 1}
                        onClick={() => setCategoryPage('notes', notesPage - 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Précédente
                      </button>
                      <button
                        type="button"
                        disabled={notesPage >= notesTotalPages}
                        onClick={() => setCategoryPage('notes', notesPage + 1)}
                        className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
                      >
                        Suivante
                      </button>
                    </div>
                  </div>
                  </>
                )}
              </section>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {noteModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="workspace-notes-title">
          <div className="mx-auto mt-6 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="workspace-notes-title" className="text-xl font-semibold text-[var(--brand)]">Notes du workspace</h2>
              <button
                type="button"
                onClick={closeNoteModal}
                className="rounded border border-[var(--line)] px-3 py-2 text-sm hover:bg-[#f8f5eb]"
              >
                Fermer
              </button>
            </div>

            <p className="mb-3 text-xs text-[#5b5952]">
              Journal incrémentiel: chaque ajout est conservé, horodaté et signé.
            </p>
            <div className="mb-4 grid gap-2">
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Ajouter une note..."
                className="min-h-[110px] rounded border border-[var(--line)] px-3 py-2 text-sm"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    void onAppendNote();
                  }}
                  disabled={!noteDraft.trim() || noteSaving}
                  className="rounded bg-[var(--brand)] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ajouter la note
                </button>
              </div>
            </div>

            {noteLoading ? <p className="mb-2 text-sm text-[#5b5952]">Chargement des notes...</p> : null}
            {noteError ? <p className="mb-2 text-sm text-red-700">{noteError}</p> : null}

            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="grid gap-2">
                {searchNotes.length === 0 ? (
                  <p className="text-sm text-[#5b5952]">Aucune note pour ce workspace.</p>
                ) : (
                  searchNotes.map((note) => (
                    <div key={note.id} className="rounded border border-[var(--line)] bg-[#faf9f6] p-3">
                      <p className="mb-2 text-xs text-[#5b5952]">
                        {new Date(note.createdAt).toLocaleString('fr-FR')} • {note.authorLabel}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-[#2f2b23]">{note.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
