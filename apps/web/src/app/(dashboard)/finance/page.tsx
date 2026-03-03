'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Kpis = { billedRevenue: number; collectedRevenue: number; estimatedMargin: number };
type FinanceDoc = { id: string; reference: string; type: string; amount: string; status: string };
type Project = { id: string; name: string; progressPercent: number };

export default function FinancePage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [docs, setDocs] = useState<FinanceDoc[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<'QUOTE' | 'INVOICE'>('QUOTE');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('0');
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
      const [kpisData, docsData, projectsData] = await Promise.all([
        apiClient.financeKpis(token),
        apiClient.listFinanceDocuments(token),
        apiClient.listProjects(token),
      ]);
      setKpis(kpisData);
      setDocs(docsData);
      setProjects(projectsData);
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
    if (!token || !projectId || !reference) return;
    await apiClient.createFinanceDocument(token, {
      projectId,
      type,
      reference,
      amount,
      status: 'draft',
    });
    setReference('');
    showToast('Document financier créé.', 'success');
    await load();
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Finance</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">CA facturé: {kpis?.billedRevenue ?? 0} €</article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">CA encaissé: {kpis?.collectedRevenue ?? 0} €</article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">Marge estimée: {kpis?.estimatedMargin ?? 0} €</article>
      </div>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-5">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="">Projet</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as 'QUOTE' | 'INVOICE')} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="QUOTE">DEVIS</option>
            <option value="INVOICE">FACTURE</option>
          </select>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Référence" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Montant" className="rounded border border-[var(--line)] px-3 py-2" />
          <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">Créer</button>
        </form>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {docs.map((doc) => <li key={doc.id}>{doc.type} | {doc.reference} | {doc.amount} | {doc.status}</li>)}
        </ul>
      </article>
    </section>
  );
}
