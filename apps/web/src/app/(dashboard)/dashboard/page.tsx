'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { DashboardPayload } from '@/types/api';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = useMemo(
    () => (typeof window === 'undefined' ? null : localStorage.getItem('mw_access_token')),
    [],
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    void apiClient
      .dashboard(token)
      .then((payload) => setData(payload))
      .catch(() => setError('Impossible de charger le dashboard.'));
  }, [token]);

  if (!token) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Aucun token détecté.</p>;
  }

  if (error) {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-[#5b5952]">Chargement du dashboard...</p>;
  }

  return (
    <section className="grid gap-4">
      <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h1 className="text-xl font-semibold text-[var(--brand)]">Tâches du jour</h1>
        <p className="mt-2 text-sm text-[#5b5952]">{data.tasksToday.length} tâches prioritaires.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <h2 className="text-sm uppercase text-[#66645f]">CA facturé</h2>
          <p className="mt-1 text-2xl font-semibold">{data.globalKpis.billedRevenue.toLocaleString()} €</p>
        </article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <h2 className="text-sm uppercase text-[#66645f]">CA encaissé</h2>
          <p className="mt-1 text-2xl font-semibold">{data.globalKpis.collectedRevenue.toLocaleString()} €</p>
        </article>
        <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
          <h2 className="text-sm uppercase text-[#66645f]">Marge estimée</h2>
          <p className="mt-1 text-2xl font-semibold">{data.globalKpis.estimatedMargin.toLocaleString()} €</p>
        </article>
      </div>
    </section>
  );
}
