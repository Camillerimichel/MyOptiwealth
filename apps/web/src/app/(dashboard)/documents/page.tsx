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

type DocumentItem = { id: string; title: string; status: string; storagePath: string; project?: { id: string; name: string } | null };
const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [title, setTitle] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [certificate, setCertificate] = useState('Certificate placeholder content');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [signerEmail, setSignerEmail] = useState('client@example.com');
  const [signerName, setSignerName] = useState('Client Demo');
  const [signatureProvider, setSignatureProvider] = useState<'MOCK' | 'YOUSIGN' | 'DOCUSIGN'>('MOCK');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
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
      const [documentsData, projectsData] = await Promise.all([
        apiClient.listDocuments(token),
        apiClient.listProjects(token),
      ]);
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
        setActiveTaskLabel(
          activeTask && activeTask.projectId === activeProject.projectId ? activeTask.taskDescription : null,
        );
      } else {
        setActiveProjectId(null);
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
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

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !title || !storagePath) return;
    await apiClient.createDocument(token, {
      title,
      storagePath,
      projectId: activeProjectId ?? undefined,
    });
    setTitle('');
    setStoragePath('');
    showToast('Document créé.', 'success');
    await load();
  }

  async function onSign(documentId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.signDocument(token, documentId, certificate);
    showToast('Document signé.', 'success');
    await load();
  }

  async function onUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !selectedFile || !title) return;
    await apiClient.uploadDocument(token, {
      file: selectedFile,
      title,
      projectId: activeProjectId ?? undefined,
    });
    setSelectedFile(null);
    setTitle('');
    showToast('Document uploadé.', 'success');
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

  const filteredDocuments = activeProjectId
    ? documents.filter((item) => item.project?.id === activeProjectId)
    : documents;

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Documents</h1>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        {activeTaskLabel ? ` | Tâche: ${activeTaskLabel}` : ''}
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
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={storagePath} onChange={(e) => setStoragePath(e.target.value)} placeholder="Storage path" className="rounded border border-[var(--line)] px-3 py-2" />
          <button disabled={!activeProjectId} className="rounded bg-[var(--brand)] px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">Créer document</button>
        </form>
        <form onSubmit={onUpload} className="mt-3 grid gap-2 lg:grid-cols-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre pour upload" className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} className="rounded border border-[var(--line)] px-3 py-2" />
          <button disabled={!activeProjectId} className="rounded border border-[var(--line)] px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">Uploader</button>
        </form>
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          <input value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder="Signer email" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Signer name" className="rounded border border-[var(--line)] px-3 py-2" />
          <select value={signatureProvider} onChange={(e) => setSignatureProvider(e.target.value as 'MOCK' | 'YOUSIGN' | 'DOCUSIGN')} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="MOCK">MOCK</option>
            <option value="YOUSIGN">YOUSIGN</option>
            <option value="DOCUSIGN">DOCUSIGN</option>
          </select>
        </div>
        <textarea value={certificate} onChange={(e) => setCertificate(e.target.value)} className="mt-3 w-full rounded border border-[var(--line)] px-3 py-2" rows={3} />
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {filteredDocuments.length === 0 ? (
            <li className="text-[#5b5952]">Aucun document.</li>
          ) : null}
          {filteredDocuments.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span>{item.title} | {item.status}</span>
              <div className="flex gap-2">
                <button onClick={() => onSendForSignature(item.id)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Envoyer signature</button>
                <button onClick={() => onSign(item.id)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">Signer</button>
              </div>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
