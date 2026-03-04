'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type EmailMessage = {
  id: string;
  externalMessageId: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  receivedAt: string;
  metadata?: { preview?: string; attachments?: Array<{ filename?: string }> } | null;
  workspace: { id: string; name: string };
};

type CatalogWorkspace = {
  id: string;
  name: string;
  projects: Array<{
    id: string;
    name: string;
    tasks: Array<{ id: string; description: string }>;
  }>;
};

type LinkSelection = { workspaceId: string; projectId: string; taskId: string };
type EmailContent = {
  text: string;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
};
const EMAIL_CONTENT_TIMEOUT_MS = 6000;

export default function MailboxPage() {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [catalog, setCatalog] = useState<CatalogWorkspace[]>([]);
  const [linkSelectionByEmail, setLinkSelectionByEmail] = useState<Record<string, LinkSelection>>({});
  const [openedPreviewEmailId, setOpenedPreviewEmailId] = useState<string | null>(null);
  const [emailContentById, setEmailContentById] = useState<Record<string, EmailContent>>({});
  const [loadingContentEmailId, setLoadingContentEmailId] = useState<string | null>(null);
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
      const [emailsData, catalogData] = await Promise.all([
        apiClient.listUnassignedInboxEmails(token),
        apiClient.listInboxCatalog(token),
      ]);
      setEmails(emailsData);
      setCatalog(catalogData);
      setLinkSelectionByEmail((prev) => {
        const next: Record<string, LinkSelection> = {};
        for (const email of emailsData) {
          next[email.id] = prev[email.id] ?? { workspaceId: '', projectId: '', taskId: '' };
        }
        return next;
      });
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
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    return () => window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
  }, [load]);

  function onWorkspaceSelection(emailId: string, workspaceId: string): void {
    setLinkSelectionByEmail((prev) => ({
      ...prev,
      [emailId]: {
        workspaceId,
        projectId: '',
        taskId: '',
      },
    }));
  }

  function onProjectSelection(emailId: string, projectId: string): void {
    setLinkSelectionByEmail((prev) => {
      const current = prev[emailId] ?? { workspaceId: '', projectId: '', taskId: '' };
      return {
        ...prev,
        [emailId]: {
          workspaceId: current.workspaceId,
          projectId,
          taskId: '',
        },
      };
    });
  }

  function onTaskSelection(emailId: string, taskId: string): void {
    setLinkSelectionByEmail((prev) => {
      const current = prev[emailId];
      if (!current) return prev;
      return {
        ...prev,
        [emailId]: {
          ...current,
          taskId,
        },
      };
    });
  }

  async function onLinkEmail(email: EmailMessage): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const selection = linkSelectionByEmail[email.id];
    if (!selection?.workspaceId || !selection?.projectId || !selection?.taskId) {
      showToast('Sélectionne workspace, projet et tâche.', 'error');
      return;
    }
    try {
      await apiClient.linkInboxEmail(token, {
        emailId: email.id,
        workspaceId: selection.workspaceId,
        externalMessageId: email.externalMessageId,
        fromAddress: email.fromAddress,
        toAddresses: email.toAddresses,
        subject: email.subject,
        projectId: selection.projectId,
        taskId: selection.taskId,
      });
      await load();
      showToast('Email affecté.', 'success');
    } catch {
      // Toast d'erreur déjà géré par api-client
    }
  }

  async function onSync(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const result = await apiClient.syncEmails(token);
    showToast(`Synchronisation IMAP terminée (${result.synced} emails).`, 'success');
    await load();
  }

  async function onTogglePreview(email: EmailMessage): Promise<void> {
    if (openedPreviewEmailId === email.id) {
      setOpenedPreviewEmailId(null);
      return;
    }

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

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Boite mail</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <button onClick={onSync} className="rounded border border-[var(--line)] px-3 py-2 text-sm">
          Synchroniser IMAP
        </button>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">De</th>
                <th className="px-2 py-2">A</th>
                <th className="px-2 py-2">Objet</th>
                <th className="px-2 py-2">Aperçu</th>
                <th className="px-2 py-2">Workspace</th>
                <th className="px-2 py-2">Projet</th>
                <th className="px-2 py-2">Tâche</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => {
                const selection = linkSelectionByEmail[email.id] ?? { workspaceId: '', projectId: '', taskId: '' };
                const workspaceOption = catalog.find((workspace) => workspace.id === selection.workspaceId);
                const projectOptions = workspaceOption?.projects ?? [];
                const projectOption = projectOptions.find((project) => project.id === selection.projectId);
                const taskOptions = projectOption?.tasks ?? [];
                const previewText = (email.metadata?.preview || email.subject || '').trim();
                const isPreviewOpen = openedPreviewEmailId === email.id;
                const fullContent = emailContentById[email.id];
                const fullText = fullContent?.text || previewText;
                const attachmentCount = Array.isArray(email.metadata?.attachments) ? email.metadata.attachments.length : 0;

                return (
                  <tr key={email.id} className="border-b border-[var(--line)] align-top">
                    <td className="px-2 py-2 whitespace-nowrap">{new Date(email.receivedAt).toLocaleString('fr-FR')}</td>
                    <td className="px-2 py-2">{email.fromAddress}</td>
                    <td className="px-2 py-2">{email.toAddresses.join(', ') || '-'}</td>
                    <td className="px-2 py-2 font-medium">
                      <div>{email.subject}</div>
                      {attachmentCount > 0 ? (
                        <div className="mt-1 inline-flex rounded border border-[var(--line)] bg-[#f3f2ef] px-2 py-0.5 text-xs font-semibold text-[#3f3c33]">
                          PJ: {attachmentCount}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-md px-2 py-2 text-[#4f4d45]">
                      <div>
                        <div>{previewText.slice(0, 140)}</div>
                        <button
                          type="button"
                          onClick={() => {
                            void onTogglePreview(email);
                          }}
                          className="mt-1 text-xs text-[var(--brand)] underline underline-offset-2"
                        >
                          {isPreviewOpen ? 'Masquer' : 'Voir'}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={selection.workspaceId}
                        onChange={(e) => onWorkspaceSelection(email.id, e.target.value)}
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                      >
                        <option value="">Workspace</option>
                        {catalog.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={selection.projectId}
                        onChange={(e) => onProjectSelection(email.id, e.target.value)}
                        disabled={!selection.workspaceId}
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                      >
                        <option value="">Projet</option>
                        {projectOptions.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={selection.taskId}
                        onChange={(e) => onTaskSelection(email.id, e.target.value)}
                        disabled={!selection.workspaceId || !selection.projectId}
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                      >
                        <option value="">Tâche</option>
                        {taskOptions.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.description}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          void onLinkEmail(email);
                        }}
                        disabled={!selection.workspaceId || !selection.projectId || !selection.taskId}
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Affecter
                      </button>
                    </td>
                  </tr>
                );
              })}
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
