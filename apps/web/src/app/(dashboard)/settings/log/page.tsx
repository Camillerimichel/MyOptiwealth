'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';

type AuditRow = {
  id: string;
  action: string;
  createdAt: string;
  user?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null;
};

type AuditResponse = {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function formatUser(user?: AuditRow['user']): string {
  if (!user) return '-';
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.email;
}

function dayKey(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function SettingsLogPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
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
      const response = await apiClient.listAudit(token, page, 25);
      setData(response);
      setExpandedDays({});
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    (data?.items ?? []).forEach((item) => {
      const key = dayKey(item.createdAt);
      const existing = map.get(key) ?? [];
      existing.push(item);
      map.set(key, existing);
    });
    return Array.from(map.entries());
  }, [data]);

  function toggleDay(key: string): void {
    setExpandedDays((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <section className="grid gap-4">
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Audit log</h2>
          <p className="text-xs text-[#5b5952]">25 lignes par page</p>
        </div>

        <div className="grid gap-3">
          {grouped.map(([key, rows]) => {
            const opened = expandedDays[key] === true;
            return (
              <section key={key} className="rounded-lg border border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => toggleDay(key)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="font-medium capitalize">{dayLabel(key)}</span>
                  <span className="text-xs text-[#5b5952]">{rows.length} log(s) {opened ? '▾' : '▸'}</span>
                </button>

                {opened ? (
                  <div className="overflow-x-auto border-t border-[var(--line)]">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                          <th className="px-3 py-2">Date + heure</th>
                          <th className="px-3 py-2">Tâches</th>
                          <th className="px-3 py-2">User</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} className="border-b border-[var(--line)]">
                            <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString('fr-FR')}</td>
                            <td className="px-3 py-2">{row.action}</td>
                            <td className="px-3 py-2">{formatUser(row.user)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-[var(--line)] px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Précédent
          </button>
          <span>
            Page {data?.page ?? page} / {data?.totalPages ?? 1}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data?.totalPages ?? p, p + 1))}
            disabled={page >= (data?.totalPages ?? 1)}
            className="rounded border border-[var(--line)] px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Suivant
          </button>
        </div>
      </article>
    </section>
  );
}
