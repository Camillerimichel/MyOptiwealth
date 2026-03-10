'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
} from '@/lib/active-task';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type DocumentItem = {
  id: string;
  title: string;
  status: string;
  storagePath: string;
  canView?: boolean;
  createdAt: string;
  project?: { id: string; name: string } | null;
  task?: { id: string; description: string } | null;
};
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [certificate, setCertificate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [signerEmail, setSignerEmail] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signatureProvider, setSignatureProvider] = useState<'MOCK' | 'YOUSIGN' | 'DOCUSIGN'>('MOCK');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [showCreationPanel, setShowCreationPanel] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [editingDocumentTitle, setEditingDocumentTitle] = useState('');
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
      const [documentsData, projectsData, workspaceData] = await Promise.all([
        apiClient.listDocuments(token),
        apiClient.listProjects(token),
        apiClient.listWorkspaces(token),
      ]);
      const workspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('mw_active_workspace_id')
          : null;
      const workspaceName = workspaceData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      setActiveWorkspaceName(workspaceName);
      const activeProject = getActiveProjectContext();
      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId);
        setActiveProjectId(activeProject.projectId);
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
            ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
        const activeTask = getActiveTaskContext();
        setActiveTaskId(
          activeTask && activeTask.projectId === activeProject.projectId ? activeTask.taskId : null,
        );
        setActiveTaskLabel(
          activeTask && activeTask.projectId === activeProject.projectId ? activeTask.taskDescription : null,
        );
      } else {
        setActiveProjectId(null);
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
        setActiveTaskId(null);
        setActiveTaskLabel(null);
      }
      setDocuments(documentsData);
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
    const onTaskChanged = (): void => {
      void load();
    };
    const onProjectChanged = (): void => {
      void load();
    };
    window.addEventListener('mw_active_task_changed', onTaskChanged);
    window.addEventListener('mw_active_project_changed', onProjectChanged);
    return () => {
      window.removeEventListener('mw_active_task_changed', onTaskChanged);
      window.removeEventListener('mw_active_project_changed', onProjectChanged);
    };
  }, [load]);

  async function onSign(documentId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.signDocument(token, documentId, certificate);
    showToast('Document signé.', 'success');
    await load();
  }

  async function onCreateAndUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !selectedFile) return;
    await apiClient.uploadDocument(token, {
      file: selectedFile,
      title: uploadTitle.trim() || undefined,
      projectId: activeProjectId ?? undefined,
      taskId: activeTaskId ?? undefined,
    });
    setSelectedFile(null);
    setUploadTitle('');
    showToast('Document créé.', 'success');
    await load();
  }

  async function onSendForSignature(documentId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.sendForSignature(token, documentId, {
      signerEmail,
      signerName,
      provider: signatureProvider,
    });
    showToast('Demande de signature envoyée.', 'success');
    await load();
  }

  async function onDelete(documentId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.deleteDocument(token, documentId);
    showToast('Document supprimé.', 'success');
    await load();
  }

  function onStartEdit(document: DocumentItem): void {
    setEditingDocumentId(document.id);
    setEditingDocumentTitle(document.title);
  }

  async function onSaveDocumentTitle(): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingDocumentId || !editingDocumentTitle.trim()) return;
    await apiClient.updateDocument(token, editingDocumentId, { title: editingDocumentTitle.trim() });
    setEditingDocumentId(null);
    setEditingDocumentTitle('');
    showToast('Intitulé du document mis à jour.', 'success');
    await load();
  }

  async function onView(documentId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const blob = await apiClient.viewDocumentBlob(token, documentId);
    const blobUrl = window.URL.createObjectURL(blob);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 60000);
  }

  async function onDownload(documentId: string, documentTitle: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const blob = await apiClient.viewDocumentBlob(token, documentId);
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = documentTitle || 'document';
    link.click();
    window.setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 60000);
  }

  const filteredDocuments = activeTaskId
    ? documents.filter((item) => item.task?.id === activeTaskId)
    : activeProjectId
      ? documents.filter((item) => item.project?.id === activeProjectId)
      : documents;
  const canShowSignatureActions = signerEmail.trim().length > 0 && signerName.trim().length > 0;

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Documents</h1>
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
        <p className="text-sm text-[#5b5952]">Aucun contexte projet actif: affichage de tous les documents du workspace.</p>
      ) : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <p className="mb-3 text-base font-semibold text-[var(--brand)]">Document</p>
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowCreationPanel((current) => !current)}
            className="rounded border border-[var(--line)] px-3 py-2 text-sm"
          >
            {showCreationPanel ? 'Fermer' : 'Créer'}
          </button>
        </div>
        {showCreationPanel ? (
          <>
            <form onSubmit={onCreateAndUpload} className="grid gap-2 lg:grid-cols-3">
              <input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Titre du document (optionnel)"
                className="rounded border border-[var(--line)] px-3 py-2"
              />
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                }}
                className="rounded border border-[var(--line)] px-3 py-2"
              />
              <button
                disabled={!selectedFile}
                className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Valider
              </button>
            </form>
            {selectedFile ? (
              <p className="mt-2 text-xs text-[#5b5952]">Fichier sélectionné: {selectedFile.name}</p>
            ) : null}
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              <input
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="Email du signataire (ex: prenom.nom@societe.fr)"
                className="rounded border border-[var(--line)] px-3 py-2"
              />
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Nom du signataire (ex: Jean Dupont)"
                className="rounded border border-[var(--line)] px-3 py-2"
              />
              <select value={signatureProvider} onChange={(e) => setSignatureProvider(e.target.value as 'MOCK' | 'YOUSIGN' | 'DOCUSIGN')} className="rounded border border-[var(--line)] px-3 py-2">
                <option value="MOCK">MOCK</option>
                <option value="YOUSIGN">YOUSIGN</option>
                <option value="DOCUSIGN">DOCUSIGN</option>
              </select>
            </div>
            <textarea
              value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              placeholder="Certificat de signature (texte optionnel)."
              className="mt-3 w-full rounded border border-[var(--line)] px-3 py-2"
              rows={3}
            />
          </>
        ) : null}
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                <th className="px-2 py-2">Titre</th>
                <th className="px-2 py-2">Date dépôt</th>
                <th className="px-2 py-2">Storage path</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-[#5b5952]">Aucun document.</td>
                </tr>
              ) : null}
              {filteredDocuments.map((item) => (
                <tr key={item.id} className="border-b border-[var(--line)]">
                  <td className="px-2 py-2 font-medium">
                    {editingDocumentId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={editingDocumentTitle}
                          onChange={(e) => setEditingDocumentTitle(e.target.value)}
                          className="min-w-[220px] rounded border border-[var(--line)] px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => { void onSaveDocumentTitle(); }}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                        >
                          Enregistrer
                        </button>
                        <button
                          onClick={() => {
                            setEditingDocumentId(null);
                            setEditingDocumentTitle('');
                          }}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      item.title
                    )}
                  </td>
                  <td className="px-2 py-2">{new Date(item.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td className="max-w-[320px] px-2 py-2">
                    <div className="group">
                      <span className="block truncate">{item.storagePath}</span>
                      <span className="mt-1 hidden break-all text-xs text-[#5b5952] group-hover:block">
                        {item.storagePath}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="grid gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => { void onView(item.id); }}
                          disabled={!item.canView}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          title={item.canView ? 'Ouvrir le document' : 'Visualisation indisponible (fichier absent)'}
                        >
                          Ouvrir
                        </button>
                        <button
                          onClick={() => onStartEdit(item)}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                        >
                          Modifier
                        </button>
                        <button
                          onClick={() => { void onDownload(item.id, item.title); }}
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                        >
                          Télécharger
                        </button>
                        <button onClick={() => { void onDelete(item.id); }} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700">Supprimer</button>
                      </div>
                      {canShowSignatureActions ? (
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => { void onSendForSignature(item.id); }} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Envoyer signature</button>
                          <button onClick={() => { void onSign(item.id); }} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Signer</button>
                        </div>
                      ) : null}
                    </div>
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
