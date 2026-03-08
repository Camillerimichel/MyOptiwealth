'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { setActiveProjectContext, setActiveTaskContext } from '@/lib/active-task';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type LinkedEmail = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  metadata?: {
    preview?: string;
    attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
  } | null;
  workspace: { id: string; name: string };
  project: { id: string; name: string } | null;
  tasks: Array<{
    task: {
      id: string;
      description: string;
      projectId: string;
    };
  }>;
};

type EmailContent = {
  text: string;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
};

type SortKey = 'date' | 'from' | 'workspace' | 'project' | 'task';
type SortDirection = 'asc' | 'desc';

const EMAIL_CONTENT_TIMEOUT_MS = 6000;

function normalizeSearchValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export default function MailboxPage() {
  const router = useRouter();
  const [emails, setEmails] = useState<LinkedEmail[]>([]);
  const [openedPreviewEmailId, setOpenedPreviewEmailId] = useState<string | null>(null);
  const [emailContentById, setEmailContentById] = useState<Record<string, EmailContent>>({});
  const [loadingContentEmailId, setLoadingContentEmailId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
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
      const data = await apiClient.listLinkedEmails(token);
      setEmails(data);
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function taskLabels(email: LinkedEmail): string {
    return email.tasks.map((item) => item.task.description).join(' • ');
  }

  function onToggleSort(nextKey: SortKey): void {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'date' ? 'desc' : 'asc');
  }

  const visibleEmails = useMemo(() => {
    const q = normalizeSearchValue(searchQuery);
    const filtered = !q
      ? emails
      : emails.filter((email) => {
        const haystack = [
          email.subject,
          email.fromAddress,
          email.workspace.name,
          email.project?.name ?? '',
          new Date(email.receivedAt).toLocaleDateString('fr-FR'),
          new Date(email.receivedAt).toLocaleString('fr-FR'),
          taskLabels(email),
        ]
          .map((value) => normalizeSearchValue(value))
          .join(' ');
        return haystack.includes(q);
      });

    const sorted = [...filtered].sort((left, right) => {
      if (sortKey === 'date') {
        const diff = new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime();
        return sortDirection === 'asc' ? diff : -diff;
      }
      const leftValue =
        sortKey === 'from'
          ? left.fromAddress
          : sortKey === 'workspace'
            ? left.workspace.name
            : sortKey === 'project'
              ? (left.project?.name ?? '')
              : taskLabels(left);
      const rightValue =
        sortKey === 'from'
          ? right.fromAddress
          : sortKey === 'workspace'
            ? right.workspace.name
            : sortKey === 'project'
              ? (right.project?.name ?? '')
              : taskLabels(right);
      const compared = leftValue.localeCompare(rightValue, 'fr', { sensitivity: 'base' });
      return sortDirection === 'asc' ? compared : -compared;
    });

    return sorted;
  }, [emails, searchQuery, sortDirection, sortKey]);

  async function onSync(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const result = await apiClient.syncEmails(token);
    showToast(`Synchronisation IMAP terminée (${result.synced} emails).`, 'success');
    await load();
  }

  async function ensureWorkspaceActive(workspaceId: string): Promise<boolean> {
    const token = getAccessToken();
    if (!token) return false;
    const currentWorkspaceId =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('mw_active_workspace_id')
        : null;
    if (currentWorkspaceId === workspaceId) {
      return true;
    }
    try {
      const switched = await apiClient.switchWorkspace(token, workspaceId);
      localStorage.setItem('mw_access_token', switched.accessToken);
      localStorage.setItem('mw_active_workspace_id', switched.activeWorkspaceId);
      window.dispatchEvent(new Event('mw_workspace_changed'));
      return true;
    } catch {
      return false;
    }
  }

  async function onOpenWorkspace(workspaceId: string): Promise<void> {
    const switched = await ensureWorkspaceActive(workspaceId);
    if (!switched) return;
    router.push('/projects');
  }

  async function onOpenProject(email: LinkedEmail): Promise<void> {
    if (!email.project) return;
    const switched = await ensureWorkspaceActive(email.workspace.id);
    if (!switched) return;
    setActiveProjectContext({
      projectId: email.project.id,
      projectTitle: email.project.name,
      projectTypology: null,
      workspaceId: email.workspace.id,
    });
    router.push('/projects');
  }

  async function onOpenTask(email: LinkedEmail, taskId: string, taskDescription: string, projectId: string): Promise<void> {
    const switched = await ensureWorkspaceActive(email.workspace.id);
    if (!switched) return;
    if (email.project) {
      setActiveProjectContext({
        projectId: email.project.id,
        projectTitle: email.project.name,
        projectTypology: null,
        workspaceId: email.workspace.id,
      });
    }
    setActiveTaskContext({
      taskId,
      projectId,
      taskDescription,
      workspaceId: email.workspace.id,
    });
    router.push('/tasks');
  }

  async function onOpenPreview(email: LinkedEmail): Promise<void> {
    setOpenedPreviewEmailId(email.id);
    if (emailContentById[email.id]) {
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    try {
      setLoadingContentEmailId(email.id);
      const content = await Promise.race([
        apiClient.getEmailContent(token, email.id),
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), EMAIL_CONTENT_TIMEOUT_MS);
        }),
      ]);
      if (!content) {
        setEmailContentById((prev) => ({
          ...prev,
          [email.id]: {
            text: email.metadata?.preview || email.subject,
            attachments: [],
          },
        }));
        return;
      }
      setEmailContentById((prev) => ({
        ...prev,
        [email.id]: {
          text: content.text || email.subject,
          attachments: content.attachments || [],
        },
      }));
    } catch {
      setEmailContentById((prev) => ({
        ...prev,
        [email.id]: {
          text: email.subject,
          attachments: [],
        },
      }));
    } finally {
      setLoadingContentEmailId(null);
    }
  }

  function sortLabel(key: SortKey, label: string): string {
    if (sortKey !== key) return label;
    return `${label} ${sortDirection === 'asc' ? '↑' : '↓'}`;
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Boite mail</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[300px] flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5b5952]">
              Recherche multi-champs
            </label>
            <input
              type="text"
              value={searchDraft}
              onChange={(event) => {
                setSearchDraft(event.target.value);
                setSearchQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSearchQuery(searchDraft);
                }
              }}
              placeholder="Date, de, objet, workspace, projet, tâche"
              className="w-full rounded border border-[var(--line)] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => setSearchQuery(searchDraft)}
            className="rounded border border-[var(--line)] px-3 py-2 text-sm"
          >
            Rechercher
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchDraft('');
              setSearchQuery('');
            }}
            className="rounded border border-[var(--line)] px-3 py-2 text-sm"
          >
            Effacer
          </button>
          <button
            type="button"
            onClick={() => {
              void onSync();
            }}
            className="ml-auto rounded border border-[var(--line)] px-3 py-2 text-sm"
          >
            Synchroniser IMAP
          </button>
        </div>
      </article>

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="mb-2 text-xs text-[#5b5952]">{visibleEmails.length} mail(s) lié(s)</div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onToggleSort('date')} className="font-semibold">
                    {sortLabel('date', 'Date')}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onToggleSort('from')} className="font-semibold">
                    {sortLabel('from', 'De')}
                  </button>
                </th>
                <th className="px-2 py-2">Objet</th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onToggleSort('workspace')} className="font-semibold">
                    {sortLabel('workspace', 'Workspace')}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onToggleSort('project')} className="font-semibold">
                    {sortLabel('project', 'Projet')}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => onToggleSort('task')} className="font-semibold">
                    {sortLabel('task', 'Tâche')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleEmails.map((email) => (
                <tr key={email.id} className="border-b border-[var(--line)] align-top">
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(email.receivedAt).toLocaleString('fr-FR')}</td>
                  <td className="px-2 py-2">{email.fromAddress}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        void onOpenPreview(email);
                      }}
                      className="text-left font-medium text-[var(--brand)] underline underline-offset-2"
                    >
                      {email.subject}
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <a
                      href="/projects"
                      onClick={(event) => {
                        event.preventDefault();
                        void onOpenWorkspace(email.workspace.id);
                      }}
                      className="text-[var(--brand)] underline underline-offset-2"
                    >
                      {email.workspace.name}
                    </a>
                  </td>
                  <td className="px-2 py-2">
                    {email.project ? (
                      <a
                        href="/projects"
                        onClick={(event) => {
                          event.preventDefault();
                          void onOpenProject(email);
                        }}
                        className="text-[var(--brand)] underline underline-offset-2"
                      >
                        {email.project.name}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {email.tasks.length === 0 ? (
                      '—'
                    ) : (
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        {email.tasks.map((item) => (
                          <a
                            key={`${email.id}-${item.task.id}`}
                            href="/tasks"
                            onClick={(event) => {
                              event.preventDefault();
                              void onOpenTask(email, item.task.id, item.task.description, item.task.projectId);
                            }}
                            className="text-[var(--brand)] underline underline-offset-2"
                          >
                            {item.task.description}
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visibleEmails.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-[#5b5952]">
                    Aucun mail lié trouvé.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {openedPreviewEmailId ? (() => {
        const email = emails.find((item) => item.id === openedPreviewEmailId);
        if (!email) return null;
        const previewText = (email.metadata?.preview || email.subject || '').trim();
        const fullContent = emailContentById[email.id];
        const fullText = fullContent?.text || previewText;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-[min(920px,96vw)] rounded-xl border border-[var(--line)] bg-white p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-base font-semibold text-[var(--brand)]">Contenu du mail</p>
                <button
                  type="button"
                  onClick={() => setOpenedPreviewEmailId(null)}
                  className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                >
                  Fermer
                </button>
              </div>
              <p className="mb-2 text-sm font-medium">{email.subject}</p>
              <p className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--line)] bg-[#faf9f6] p-3 text-sm text-[#2f2b23]">
                {loadingContentEmailId === email.id ? 'Chargement...' : fullText}
              </p>
              {fullContent?.attachments?.length ? (
                <div className="mt-3 border-t border-[var(--line)] pt-2">
                  <p className="mb-1 text-xs font-semibold text-[#5b5952]">Pièces jointes</p>
                  <ul className="list-disc pl-4 text-xs text-[#2f2b23]">
                    {fullContent.attachments.map((attachment) => (
                      <li key={`${email.id}-${attachment.filename}-${attachment.size}`}>
                        {attachment.filename} ({attachment.contentType}, {attachment.size} o)
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        );
      })() : null}
    </section>
  );
}
