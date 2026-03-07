'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
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
  const PAGE_SIZE = 25;
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [ignoredEmails, setIgnoredEmails] = useState<EmailMessage[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'ignored'>('pending');
  const [pendingPage, setPendingPage] = useState(1);
  const [ignoredPage, setIgnoredPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogWorkspace[]>([]);
  const [linkSelectionByEmail, setLinkSelectionByEmail] = useState<Record<string, LinkSelection>>({});
  const [openedPreviewEmailId, setOpenedPreviewEmailId] = useState<string | null>(null);
  const [assignEmailId, setAssignEmailId] = useState<string | null>(null);
  const [assignStatus, setAssignStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [ignoringByEmailId, setIgnoringByEmailId] = useState<Record<string, boolean>>({});
  const [restoringByEmailId, setRestoringByEmailId] = useState<Record<string, boolean>>({});
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
      const [emailsData, ignoredEmailsData, catalogData] = await Promise.all([
        apiClient.listUnassignedInboxEmails(token),
        apiClient.listIgnoredInboxEmails(token),
        apiClient.listInboxCatalog(token),
      ]);
      setEmails(emailsData);
      setIgnoredEmails(ignoredEmailsData);
      setPendingPage(1);
      setIgnoredPage(1);
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

  function openAssignModal(email: EmailMessage): void {
    const existing = linkSelectionByEmail[email.id] ?? { workspaceId: '', projectId: '', taskId: '' };
    setLinkSelectionByEmail((prev) => ({
      ...prev,
      [email.id]: existing,
    }));
    setAssignEmailId(email.id);
    setAssignStatus('idle');
    setAssignMessage(null);
  }

  function closeAssignModal(): void {
    if (assignStatus === 'submitting') return;
    setAssignEmailId(null);
    setAssignStatus('idle');
    setAssignMessage(null);
  }

  async function onLinkEmailFromModal(): Promise<void> {
    if (!assignEmailId) return;
    const email = emails.find((item) => item.id === assignEmailId);
    if (!email) {
      setAssignStatus('error');
      setAssignMessage('Email introuvable dans la liste.');
      return;
    }

    const token = getAccessToken();
    if (!token) return;
    const selection = linkSelectionByEmail[email.id];
    if (!selection?.workspaceId || !selection?.projectId || !selection?.taskId) {
      setAssignStatus('error');
      setAssignMessage('Sélectionne workspace, projet et tâche.');
      return;
    }

    setAssignStatus('submitting');
    setAssignMessage('Affectation en cours...');

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
      setAssignStatus('success');
      setAssignMessage('Email affecté avec succès.');
      showToast('Email affecté.', 'success');
    } catch (error) {
      setAssignStatus('error');
      setAssignMessage(error instanceof ApiError ? error.message : 'Erreur pendant l’affectation.');
    }
  }

  async function onSync(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const result = await apiClient.syncEmails(token);
    showToast(`Synchronisation IMAP terminée (${result.synced} emails).`, 'success');
    await load();
  }

  async function onIgnore(email: EmailMessage): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setIgnoringByEmailId((prev) => ({ ...prev, [email.id]: true }));
    try {
      await apiClient.ignoreInboxEmail(token, email.id);
      showToast('Email marque "Ne pas affecter".', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Erreur pendant le masquage.', 'error');
    } finally {
      setIgnoringByEmailId((prev) => ({ ...prev, [email.id]: false }));
    }
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

  async function onUnignore(email: EmailMessage): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setRestoringByEmailId((prev) => ({ ...prev, [email.id]: true }));
    try {
      await apiClient.unignoreInboxEmail(token, email.id);
      showToast('Email reaffiche dans la boite mail.', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Erreur pendant la reactivation.', 'error');
    } finally {
      setRestoringByEmailId((prev) => ({ ...prev, [email.id]: false }));
    }
  }

  const pendingTotalPages = Math.max(1, Math.ceil(emails.length / PAGE_SIZE));
  const ignoredTotalPages = Math.max(1, Math.ceil(ignoredEmails.length / PAGE_SIZE));
  const pendingCurrentPage = Math.min(pendingPage, pendingTotalPages);
  const ignoredCurrentPage = Math.min(ignoredPage, ignoredTotalPages);
  const pagedPendingEmails = emails.slice((pendingCurrentPage - 1) * PAGE_SIZE, pendingCurrentPage * PAGE_SIZE);
  const pagedIgnoredEmails = ignoredEmails.slice((ignoredCurrentPage - 1) * PAGE_SIZE, ignoredCurrentPage * PAGE_SIZE);

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Boite mail</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`rounded px-3 py-2 text-sm ${activeTab === 'pending' ? 'bg-[var(--brand)] text-white' : 'border border-[var(--line)]'}`}
          >
            Mails en attente ({emails.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ignored')}
            className={`rounded px-3 py-2 text-sm ${activeTab === 'ignored' ? 'bg-[var(--brand)] text-white' : 'border border-[var(--line)]'}`}
          >
            Mails ignores ({ignoredEmails.length})
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
        <div className="overflow-x-auto">
          {activeTab === 'pending' ? (
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">De</th>
                <th className="px-2 py-2">Objet</th>
                <th className="px-2 py-2">Aperçu</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedPendingEmails.map((email) => {
                const previewText = (email.metadata?.preview || email.subject || '').trim();
                const isPreviewOpen = openedPreviewEmailId === email.id;
                const attachmentCount = Array.isArray(email.metadata?.attachments) ? email.metadata.attachments.length : 0;

                return (
                  <tr key={email.id} className="border-b border-[var(--line)] align-top">
                    <td className="px-2 py-2 whitespace-nowrap">{new Date(email.receivedAt).toLocaleString('fr-FR')}</td>
                    <td className="px-2 py-2">{email.fromAddress}</td>
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
                      <button
                        type="button"
                        onClick={() => {
                          void onIgnore(email);
                        }}
                        disabled={Boolean(ignoringByEmailId[email.id])}
                        className="mr-2 rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ignoringByEmailId[email.id] ? 'Masquage...' : 'Ne pas affecter'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          openAssignModal(email);
                        }}
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                      >
                        Affecter
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          ) : (
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">De</th>
                <th className="px-2 py-2">Objet</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedIgnoredEmails.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-2 text-[#5b5952]">Aucun mail ignore.</td>
                </tr>
              ) : null}
              {pagedIgnoredEmails.map((email) => (
                <tr key={email.id} className="border-b border-[var(--line)] align-top">
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(email.receivedAt).toLocaleString('fr-FR')}</td>
                  <td className="px-2 py-2">{email.fromAddress}</td>
                  <td className="px-2 py-2 font-medium">{email.subject}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => { void onUnignore(email); }}
                      disabled={Boolean(restoringByEmailId[email.id])}
                      className="mr-2 rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {restoringByEmailId[email.id] ? 'Reactivation...' : 'Reafficher'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onTogglePreview(email);
                      }}
                      className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                    >
                      Voir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-[#5b5952]">
          {activeTab === 'pending' ? (
            <>
              <span>Page {pendingCurrentPage}/{pendingTotalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
                  disabled={pendingCurrentPage <= 1}
                  className="rounded border border-[var(--line)] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Precedent
                </button>
                <button
                  type="button"
                  onClick={() => setPendingPage((p) => Math.min(pendingTotalPages, p + 1))}
                  disabled={pendingCurrentPage >= pendingTotalPages}
                  className="rounded border border-[var(--line)] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Suivant
                </button>
              </div>
            </>
          ) : (
            <>
              <span>Page {ignoredCurrentPage}/{ignoredTotalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIgnoredPage((p) => Math.max(1, p - 1))}
                  disabled={ignoredCurrentPage <= 1}
                  className="rounded border border-[var(--line)] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Precedent
                </button>
                <button
                  type="button"
                  onClick={() => setIgnoredPage((p) => Math.min(ignoredTotalPages, p + 1))}
                  disabled={ignoredCurrentPage >= ignoredTotalPages}
                  className="rounded border border-[var(--line)] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Suivant
                </button>
              </div>
            </>
          )}
        </div>
      </article>
      {openedPreviewEmailId ? (() => {
        const email = emails.find((item) => item.id === openedPreviewEmailId)
          ?? ignoredEmails.find((item) => item.id === openedPreviewEmailId);
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
      {assignEmailId ? (() => {
        const email = emails.find((item) => item.id === assignEmailId);
        if (!email) return null;
        const selection = linkSelectionByEmail[email.id] ?? { workspaceId: '', projectId: '', taskId: '' };
        const workspaceOption = catalog.find((workspace) => workspace.id === selection.workspaceId);
        const projectOptions = workspaceOption?.projects ?? [];
        const projectOption = projectOptions.find((project) => project.id === selection.projectId);
        const taskOptions = projectOption?.tasks ?? [];
        const canSubmit = Boolean(selection.workspaceId && selection.projectId && selection.taskId) && assignStatus !== 'submitting';

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
            <div className="w-[min(760px,96vw)] rounded-xl border border-[var(--line)] bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-base font-semibold text-[var(--brand)]">Affecter un email</p>
                <button
                  type="button"
                  onClick={closeAssignModal}
                  disabled={assignStatus === 'submitting'}
                  className="rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Fermer
                </button>
              </div>

              <div className="mb-4 rounded border border-[var(--line)] bg-[#faf9f6] p-3 text-sm">
                <p className="font-medium">{email.subject}</p>
                <p className="mt-1 text-xs text-[#5b5952]">De: {email.fromAddress}</p>
                <p className="mt-1 text-xs text-[#5b5952]">A: {email.toAddresses.join(', ') || '-'}</p>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <select
                  value={selection.workspaceId}
                  onChange={(e) => onWorkspaceSelection(email.id, e.target.value)}
                  disabled={assignStatus === 'submitting'}
                  className="rounded border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <option value="">Workspace</option>
                  {catalog.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selection.projectId}
                  onChange={(e) => onProjectSelection(email.id, e.target.value)}
                  disabled={!selection.workspaceId || assignStatus === 'submitting'}
                  className="rounded border border-[var(--line)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Projet</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selection.taskId}
                  onChange={(e) => onTaskSelection(email.id, e.target.value)}
                  disabled={!selection.workspaceId || !selection.projectId || assignStatus === 'submitting'}
                  className="rounded border border-[var(--line)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Tâche</option>
                  {taskOptions.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="min-h-5 text-sm">
                  {assignMessage ? (
                    <span
                      className={
                        assignStatus === 'error'
                          ? 'text-red-700'
                          : assignStatus === 'success'
                            ? 'text-green-700'
                            : 'text-[#5b5952]'
                      }
                    >
                      {assignMessage}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onLinkEmailFromModal();
                  }}
                  disabled={!canSubmit}
                  className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {assignStatus === 'submitting' ? 'Affectation...' : 'Affecter'}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </section>
  );
}
