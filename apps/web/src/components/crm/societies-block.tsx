'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Society = {
  id: string;
  name: string;
  legalForm?: string | null;
  siren?: string | null;
  siret?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
};

function societyKeyFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function SocietiesBlock() {
  const router = useRouter();
  const [societies, setSocieties] = useState<Society[]>([]);
  const [societyName, setSocietyName] = useState('');
  const [legalForm, setLegalForm] = useState('');
  const [siren, setSiren] = useState('');
  const [siret, setSiret] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [editingSocietyId, setEditingSocietyId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
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
      const data = await apiClient.listSocietiesAll(token);
      setSocieties(data);
    } catch {
      setError('Chargement des societes impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreateSociety(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !societyName.trim()) return;

    if (editingSocietyId) {
      await apiClient.updateSociety(token, editingSocietyId, {
        name: societyName.trim(),
        legalForm: legalForm.trim() || null,
        siren: siren.trim() || null,
        siret: siret.trim() || null,
        addressLine1: addressLine1.trim() || null,
        addressLine2: addressLine2.trim() || null,
        postalCode: postalCode.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
      });
      showToast('Societe mise a jour.', 'success');
    } else {
      await apiClient.createSociety(token, {
        name: societyName.trim(),
        legalForm: legalForm.trim() || undefined,
        siren: siren.trim() || undefined,
        siret: siret.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
      });
      showToast('Societe creee.', 'success');
    }

    setEditingSocietyId(null);
    setIsFormOpen(false);
    setSocietyName('');
    setLegalForm('');
    setSiren('');
    setSiret('');
    setAddressLine1('');
    setAddressLine2('');
    setPostalCode('');
    setCity('');
    setCountry('');
    await load();
  }

  function onEditSociety(society: Society): void {
    setIsFormOpen(true);
    setEditingSocietyId(society.id);
    setSocietyName(society.name);
    setLegalForm(society.legalForm ?? '');
    setSiren(society.siren ?? '');
    setSiret(society.siret ?? '');
    setAddressLine1(society.addressLine1 ?? '');
    setAddressLine2(society.addressLine2 ?? '');
    setPostalCode(society.postalCode ?? '');
    setCity(society.city ?? '');
    setCountry(society.country ?? '');
  }

  function onCancelEdit(): void {
    setIsFormOpen(false);
    setEditingSocietyId(null);
    setSocietyName('');
    setLegalForm('');
    setSiren('');
    setSiret('');
    setAddressLine1('');
    setAddressLine2('');
    setPostalCode('');
    setCity('');
    setCountry('');
  }

  function onStartCreate(): void {
    setIsFormOpen(true);
    setEditingSocietyId(null);
    setSocietyName('');
    setLegalForm('');
    setSiren('');
    setSiret('');
    setAddressLine1('');
    setAddressLine2('');
    setPostalCode('');
    setCity('');
    setCountry('');
  }

  const dedupedSocieties = societies.reduce<Society[]>((acc, society) => {
    const key = societyKeyFromName(society.name);
    const exists = acc.some((item) => societyKeyFromName(item.name) === key);
    if (!exists) acc.push(society);
    return acc;
  }, []);

  return (
    <article id="societes" className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Bloc Societes</h2>
        <button
          type="button"
          onClick={onStartCreate}
          className="h-8 w-8 rounded bg-[var(--brand)] text-lg leading-none text-white"
          aria-label="Ajouter une societe"
          title="Ajouter une societe"
        >
          +
        </button>
      </div>
      {loading ? <p className="mt-2 text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      {isFormOpen ? (
        <form onSubmit={onCreateSociety} className="mt-4 grid gap-2">
          <input
            value={societyName}
            onChange={(event) => setSocietyName(event.target.value)}
            placeholder="Nom de la societe"
            className="rounded border border-[var(--line)] px-3 py-2"
          />
          <input
            value={legalForm}
            onChange={(event) => setLegalForm(event.target.value)}
            placeholder="Forme juridique"
            className="rounded border border-[var(--line)] px-3 py-2"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={siren}
              onChange={(event) => setSiren(event.target.value)}
              placeholder="SIREN"
              className="rounded border border-[var(--line)] px-3 py-2"
            />
            <input
              value={siret}
              onChange={(event) => setSiret(event.target.value)}
              placeholder="SIRET"
              className="rounded border border-[var(--line)] px-3 py-2"
            />
          </div>
          <input
            value={addressLine1}
            onChange={(event) => setAddressLine1(event.target.value)}
            placeholder="Adresse ligne 1"
            className="rounded border border-[var(--line)] px-3 py-2"
          />
          <input
            value={addressLine2}
            onChange={(event) => setAddressLine2(event.target.value)}
            placeholder="Adresse ligne 2"
            className="rounded border border-[var(--line)] px-3 py-2"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              placeholder="Code postal"
              className="rounded border border-[var(--line)] px-3 py-2"
            />
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Ville"
              className="rounded border border-[var(--line)] px-3 py-2"
            />
            <input
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              placeholder="Pays"
              className="rounded border border-[var(--line)] px-3 py-2"
            />
          </div>
          <div className="flex gap-2">
            <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">
              {editingSocietyId ? 'Mettre a jour' : 'Ajouter'}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded border border-[var(--line)] px-3 py-2 text-[#4f4d45]"
            >
              Annuler
            </button>
          </div>
        </form>
      ) : null}

      <ul className="mt-4 grid gap-2 text-sm">
        {dedupedSocieties.map((society) => (
          <li key={society.id} className="rounded border border-[var(--line)] bg-[#fbfaf7] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => router.push(`/crm/contacts?societyKey=${encodeURIComponent(societyKeyFromName(society.name))}`)}
                className="font-medium text-[var(--brand)] underline-offset-2 hover:underline"
                title="Voir les contacts de cette societe"
              >
                {society.name}
              </button>
              <button
                type="button"
                onClick={() => onEditSociety(society)}
                className="rounded border border-[var(--line)] px-2 py-1 text-xs"
              >
                Voir/Modifier
              </button>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
