'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
} from '@/lib/active-task';
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
  metadata?: {
    preview?: string;
    attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
    documentsSaved?: boolean;
  } | null;
  project?: { id: string; name: string } | null;
  tasks: Array<{ taskId: string }>;
};

type Project = { id: string; name: string; missionType?: string | null };
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

const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

export default function EmailsPage() {
  const router = useRouter();
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [catalog, setCatalog] = useState<CatalogWorkspace[]>([]);
  const [linkSelectionByEmail, setLinkSelectionByEmail] = useState<Record<string, LinkSelection>>({});
  const [openedPreviewEmailId, setOpenedPreviewEmailId] = useState<string | null>(null);
  const [reassignEmailId, setReassignEmailId] = useState<string | null>(null);
  const [reassignStatus, setReassignStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [reassignMessage, setReassignMessage] = useState<string | null>(null);
  const [savingAttachmentsByEmailId, setSavingAttachmentsByEmailId] = useState<Record<string, boolean>>({});
  const [ignoringByEmailId, setIgnoringByEmailId] = useState<Record<string, boolean>>({});
  const [emailContentById, setEmailContentById] = useState<Record<string, EmailContent>>({});
  const [loadingContentEmailId, setLoadingContentEmailId] = useState<string | null>(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
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
      const [emailsData, projectsData, catalogData, workspacesData] = await Promise.all([
        apiClient.listEmails(token),
        apiClient.listProjects(token),
        apiClient.listInboxCatalog(token),
        apiClient.listWorkspaces(token),
      ]);
      const workspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('mw_active_workspace_id')
          : null;
      const workspaceName = workspacesData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      setActiveWorkspaceName(workspaceName);

      const activeProject = getActiveProjectContext();
      const activeTask = getActiveTaskContext();

      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId) as Project | undefined;
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
            ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
      } else {
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
      }

      setActiveTaskLabel(activeTask?.taskDescription ?? null);

      const filtered = emailsData.filter((email) => {
        if (!activeProject?.projectId || !activeTask?.taskId) {
          return false;
        }
        const ignored = Boolean((email.metadata as { inboxIgnored?: boolean } | null | undefined)?.inboxIgnored);
        if (ignored) {
          return false;
        }
        const emailInProject = email.project?.id === activeProject.projectId;
        const emailInTask = email.tasks.some((link) => link.taskId === activeTask.taskId);
        return emailInProject && emailInTask;
      });

      setEmails(filtered);
      setCatalog(catalogData);
      setLinkSelectionByEmail((prev) => {
        const next: Record<string, LinkSelection> = {};
        for (const email of filtered) {
          const existing = prev[email.id];
          if (existing) {
            next[email.id] = existing;
            continue;
          }
          const workspaceForProject = catalogData.find((workspace) =>
            workspace.projects.some((project) => project.id === email.project?.id),
          );
          next[email.id] = {
            workspaceId: workspaceForProject?.id ?? '',
            projectId: email.project?.id ?? '',
            taskId: email.tasks[0]?.taskId ?? '',
          };
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

  async function onSync(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const result = await apiClient.syncEmails(token);
    showToast(`Synchronisation IMAP terminée (${result.synced} emails).`, 'success');
    await load();
  }

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

  function openReassignModal(email: EmailMessage): void {
    const existing = linkSelectionByEmail[email.id] ?? { workspaceId: '', projectId: '', taskId: '' };
    setLinkSelectionByEmail((prev) => ({
      ...prev,
      [email.id]: existing,
    }));
    setReassignEmailId(email.id);
    setReassignStatus('idle');
    setReassignMessage(null);
  }

  function closeReassignModal(): void {
    if (reassignStatus === 'submitting') return;
    setReassignEmailId(null);
    setReassignStatus('idle');
    setReassignMessage(null);
  }

  async function onReassignFromModal(): Promise<void> {
    if (!reassignEmailId) return;
    const email = emails.find((item) => item.id === reassignEmailId);
    if (!email) {
      setReassignStatus('error');
      setReassignMessage('Email introuvable dans la liste.');
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    const selection = linkSelectionByEmail[email.id];
    if (!selection?.workspaceId || !selection?.projectId || !selection?.taskId) {
      setReassignStatus('error');
      setReassignMessage('Sélectionne workspace, projet et tâche.');
      return;
    }

    setReassignStatus('submitting');
    setReassignMessage('Réaffectation en cours...');

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
      setReassignStatus('success');
      setReassignMessage('Email réaffecté avec succès.');
      showToast('Email réaffecté.', 'success');
    } catch (error) {
      setReassignStatus('error');
      setReassignMessage(error instanceof ApiError ? error.message : 'Erreur pendant la réaffectation.');
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

  async function onSaveAttachments(email: EmailMessage): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const attachmentCount = Array.isArray(email.metadata?.attachments) ? email.metadata.attachments.length : 0;
    if (attachmentCount === 0) return;
    if (email.metadata?.documentsSaved) return;

    setSavingAttachmentsByEmailId((prev) => ({ ...prev, [email.id]: true }));
    try {
      const result = await apiClient.saveEmailAttachments(token, email.id);
      showToast(
        result.alreadySaved
          ? 'Documents déjà sauvegardés.'
          : `Pièces jointes sauvegardées (${result.importedCount}).`,
        'success',
      );
      await load();
      router.push('/documents');
    } catch {
      // erreur déjà notifiée par apiClient
    } finally {
      setSavingAttachmentsByEmailId((prev) => ({ ...prev, [email.id]: false }));
    }
  }

  async function onIgnore(email: EmailMessage): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setIgnoringByEmailId((prev) => ({ ...prev, [email.id]: true }));
    try {
      await apiClient.ignoreInboxEmail(token, email.id);
      showToast('Email déplacé vers les ignorés.', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Erreur pendant le déplacement.', 'error');
    } finally {
      setIgnoringByEmailId((prev) => ({ ...prev, [email.id]: false }));
    }
  }

  const attachmentProcessRunning = Object.values(savingAttachmentsByEmailId).some(Boolean);

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Emails</h1>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        <p>Workspace: {activeWorkspaceName ?? 'Aucun'}</p>
        <p className="pl-6">
          Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        </p>
        <p className="pl-12">Tâche: {activeTaskLabel ?? 'Aucune'}</p>
        {(activeProjectTitle || activeTaskLabel) ? (
          <button
            type="button"
            onClick={() => {
              clearActiveProjectContext();
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
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => {
                const previewText = (email.metadata?.preview || email.subject || '').trim();
                const isPreviewOpen = openedPreviewEmailId === email.id;
                const attachmentCount = Array.isArray(email.metadata?.attachments) ? email.metadata.attachments.length : 0;
                const documentsSaved = Boolean(email.metadata?.documentsSaved);
                const savingAttachments = Boolean(savingAttachmentsByEmailId[email.id]);
                const ignoring = Boolean(ignoringByEmailId[email.id]);
                return (
                  <tr key={email.id} className="border-b border-[var(--line)] align-top">
                    <td className="px-2 py-2 whitespace-nowrap">{new Date(email.receivedAt).toLocaleString('fr-FR')}</td>
                    <td className="px-2 py-2">{email.fromAddress}</td>
                    <td className="px-2 py-2">{email.toAddresses.join(', ') || '-'}</td>
                    <td className="px-2 py-2 font-medium">{email.subject}</td>
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
                      {attachmentCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            void onSaveAttachments(email);
                          }}
                          disabled={documentsSaved || savingAttachments}
                          className="mr-2 rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {documentsSaved ? 'Documents sauvegardés' : savingAttachments ? 'Sauvegarde...' : 'Pièces jointes'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openReassignModal(email)}
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                      >
                        Réaffectation
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onIgnore(email);
                        }}
                        disabled={ignoring}
                        className="ml-2 rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ignoring ? 'Déplacement...' : 'Ignorer'}
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
      {reassignEmailId ? (() => {
        const email = emails.find((item) => item.id === reassignEmailId);
        if (!email) return null;
        const selection = linkSelectionByEmail[email.id] ?? { workspaceId: '', projectId: '', taskId: '' };
        const workspaceOption = catalog.find((workspace) => workspace.id === selection.workspaceId);
        const projectOptions = workspaceOption?.projects ?? [];
        const projectOption = projectOptions.find((project) => project.id === selection.projectId);
        const taskOptions = projectOption?.tasks ?? [];
        const canSubmit = Boolean(selection.workspaceId && selection.projectId && selection.taskId) && reassignStatus !== 'submitting';

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
            <div className="w-[min(760px,96vw)] rounded-xl border border-[var(--line)] bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-base font-semibold text-[var(--brand)]">Réaffectation</p>
                <button
                  type="button"
                  onClick={closeReassignModal}
                  disabled={reassignStatus === 'submitting'}
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
                  disabled={reassignStatus === 'submitting'}
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
                  disabled={!selection.workspaceId || reassignStatus === 'submitting'}
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
                  disabled={!selection.workspaceId || !selection.projectId || reassignStatus === 'submitting'}
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
                  {reassignMessage ? (
                    <span
                      className={
                        reassignStatus === 'error'
                          ? 'text-red-700'
                          : reassignStatus === 'success'
                            ? 'text-green-700'
                            : 'text-[#5b5952]'
                      }
                    >
                      {reassignMessage}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onReassignFromModal();
                  }}
                  disabled={!canSubmit}
                  className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reassignStatus === 'submitting' ? 'Réaffectation...' : 'Réaffecter'}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
      {attachmentProcessRunning ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
          <div className="w-[min(520px,92vw)] rounded-xl border border-[var(--line)] bg-white p-5 shadow-2xl">
            <p className="text-base font-semibold text-[var(--brand)]">Traitement des pièces jointes</p>
            <p className="mt-2 text-sm text-[#4f4d45]">
              Import en cours vers Documents. Merci de patienter jusqu à la fin du process.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
