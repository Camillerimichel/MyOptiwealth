'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
} from '@/lib/active-task';
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
  metadata?: { preview?: string } | null;
  project?: { id: string; name: string } | null;
  tasks: Array<{ taskId: string }>;
};

type Project = { id: string; name: string; missionType?: string | null };
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
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [openedPreviewEmailId, setOpenedPreviewEmailId] = useState<string | null>(null);
  const [emailContentById, setEmailContentById] = useState<Record<string, EmailContent>>({});
  const [loadingContentEmailId, setLoadingContentEmailId] = useState<string | null>(null);
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
      const [emailsData, projectsData] = await Promise.all([
        apiClient.listEmails(token),
        apiClient.listProjects(token),
      ]);

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
        const emailInProject = email.project?.id === activeProject.projectId;
        const emailInTask = email.tasks.some((link) => link.taskId === activeTask.taskId);
        return emailInProject && emailInTask;
      });

      setEmails(filtered);
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
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Emails</h1>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        {activeTaskLabel ? ` | Tâche: ${activeTaskLabel}` : ''}
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
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => {
                const previewText = (email.metadata?.preview || email.subject || '').trim();
                const isPreviewOpen = openedPreviewEmailId === email.id;
                const fullContent = emailContentById[email.id];
                const fullText = fullContent?.text || previewText;
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
