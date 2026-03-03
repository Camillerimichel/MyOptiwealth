'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

const DEFAULT_PROJECT_TYPOLOGIES = ['Strategie patrimoniale', 'Succession', 'Finance d entreprise'];

export default function SettingsParametersPage() {
  const [projectTypologies, setProjectTypologies] = useState<string[]>(DEFAULT_PROJECT_TYPOLOGIES);
  const [newTypology, setNewTypology] = useState('');
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
      const settings = await apiClient.getWorkspaceSettings(token);
      setProjectTypologies(
        settings.projectTypologies && settings.projectTypologies.length > 0
          ? settings.projectTypologies
          : DEFAULT_PROJECT_TYPOLOGIES,
      );
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function addTypology(): void {
    const value = newTypology.trim();
    if (!value) return;
    if (projectTypologies.includes(value)) {
      setNewTypology('');
      return;
    }
    setProjectTypologies((current) => [...current, value]);
    setNewTypology('');
  }

  function updateTypology(index: number, value: string): void {
    setProjectTypologies((current) => current.map((item, idx) => (idx === index ? value : item)));
  }

  function removeTypology(index: number): void {
    setProjectTypologies((current) => current.filter((_, idx) => idx !== index));
  }

  async function onSave(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.updateWorkspaceSettings(token, {
      projectTypologies,
    });
    showToast('Parametres enregistres.', 'success');
    await load();
  }

  return (
    <section className="grid gap-4">
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h2 className="font-semibold">Parametres</h2>
        <p className="mt-1 text-sm text-[#5b5952]">Typologies de projet (modifiable, suppression possible).</p>

        <div className="mt-3 grid gap-2">
          {projectTypologies.map((item, index) => (
            <div key={`${item}-${index}`} className="grid gap-2 lg:grid-cols-[1fr_auto]">
              <input
                value={item}
                onChange={(e) => updateTypology(index, e.target.value)}
                className="rounded border border-[var(--line)] px-3 py-2"
              />
              <button
                type="button"
                onClick={() => removeTypology(index)}
                className="rounded border border-red-300 px-3 py-2 text-red-700"
              >
                Supprimer
              </button>
            </div>
          ))}

          <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
            <input
              value={newTypology}
              onChange={(e) => setNewTypology(e.target.value)}
              placeholder="Nouvelle typologie"
              className="rounded border border-[var(--line)] px-3 py-2"
            />
            <button
              type="button"
              onClick={addTypology}
              className="rounded bg-[var(--brand)] px-3 py-2 text-white"
            >
              Ajouter
            </button>
          </div>
        </div>

        <button onClick={() => void onSave()} className="mt-3 rounded bg-[var(--brand)] px-3 py-2 text-white">
          Enregistrer parametres
        </button>
      </article>
    </section>
  );
}
