'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type DocumentItem = { id: string; title: string; status: string; storagePath: string };

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [title, setTitle] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [certificate, setCertificate] = useState('Certificate placeholder content');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [signerEmail, setSignerEmail] = useState('client@example.com');
  const [signerName, setSignerName] = useState('Client Demo');
  const [signatureProvider, setSignatureProvider] = useState<'MOCK' | 'YOUSIGN' | 'DOCUSIGN'>('MOCK');
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
      setDocuments(await apiClient.listDocuments(token));
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
    if (!token || !title || !storagePath) return;
    await apiClient.createDocument(token, { title, storagePath });
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
    await apiClient.uploadDocument(token, { file: selectedFile, title });
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

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Documents</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={storagePath} onChange={(e) => setStoragePath(e.target.value)} placeholder="Storage path" className="rounded border border-[var(--line)] px-3 py-2" />
          <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">Créer document</button>
        </form>
        <form onSubmit={onUpload} className="mt-3 grid gap-2 lg:grid-cols-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre pour upload" className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} className="rounded border border-[var(--line)] px-3 py-2" />
          <button className="rounded border border-[var(--line)] px-3 py-2">Uploader</button>
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
          {documents.map((item) => (
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
