'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type Society = { id: string; name: string };
type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  role?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
  society?: Society | null;
};

function societyKeyFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function ContactsBlock({
  selectedSocietyId,
  selectedSocietyKey,
}: {
  selectedSocietyId?: string;
  selectedSocietyKey?: string;
}) {
  const router = useRouter();
  const [societies, setSocieties] = useState<Society[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [societyId, setSocietyId] = useState('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeSocietyId = selectedSocietyId ?? '';
  const activeSocietyKey = selectedSocietyKey ?? '';

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
      const [societiesData, contactsData] = await Promise.all([
        apiClient.listSocietiesAll(token),
        apiClient.listContactsAll(token),
      ]);
      setSocieties(societiesData);
      setContacts(contactsData);
    } catch {
      setError('Chargement des contacts impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreateContact(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !firstName.trim() || !lastName.trim()) return;

    if (editingContactId) {
      await apiClient.updateContact(token, editingContactId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        role: (role || null) as 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null,
        societyId: societyId || null,
      });
      showToast('Contact mis a jour.', 'success');
    } else {
      await apiClient.createContact(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role: (role || undefined) as 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | undefined,
        societyId: societyId || undefined,
      });
      showToast('Contact cree.', 'success');
    }

    setEditingContactId(null);
    setIsFormOpen(false);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setRole('');
    setSocietyId('');
    await load();
  }

  function onEditContact(contact: Contact): void {
    setIsFormOpen(true);
    setEditingContactId(contact.id);
    setFirstName(contact.firstName);
    setLastName(contact.lastName);
    setEmail(contact.email ?? '');
    setPhone(contact.phone ?? '');
    setRole(contact.role ?? '');
    setSocietyId(contact.society?.id ?? '');
  }

  function onCancelEdit(): void {
    setIsFormOpen(false);
    setEditingContactId(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setRole('');
    setSocietyId('');
  }

  function onStartCreate(): void {
    setIsFormOpen(true);
    setEditingContactId(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setRole('');
    setSocietyId(activeSocietyId || '');
  }

  function formatRole(value?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null): string {
    if (value === 'DECIDEUR') return 'Decideur';
    if (value === 'N_MINUS_1') return 'N-1';
    if (value === 'OPERATIONNEL') return 'Operationnel';
    return '-';
  }

  const selectedSociety = activeSocietyId
    ? societies.find((society) => society.id === activeSocietyId) ?? null
    : (
      activeSocietyKey
        ? societies.find((society) => societyKeyFromName(society.name) === activeSocietyKey) ?? null
        : null
    );

  const filteredContacts = activeSocietyId
    ? contacts.filter((contact) => contact.society?.id === activeSocietyId)
    : (
      activeSocietyKey
        ? contacts.filter((contact) => {
          const name = contact.society?.name ?? '';
          return name.length > 0 && societyKeyFromName(name) === activeSocietyKey;
        })
        : contacts
    );
  const uniqueSocieties = societies.reduce<Society[]>((acc, society) => {
    const key = societyKeyFromName(society.name);
    const exists = acc.some((item) => societyKeyFromName(item.name) === key);
    if (!exists) acc.push(society);
    return acc;
  }, []);

  return (
    <article id="contacts" className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Bloc Contacts</h2>
        <button
          type="button"
          onClick={onStartCreate}
          className="h-8 w-8 rounded bg-[var(--brand)] text-lg leading-none text-white"
          aria-label="Ajouter un contact"
          title="Ajouter un contact"
        >
          +
        </button>
      </div>

      {loading ? <p className="mt-2 text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {selectedSociety ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded border border-[var(--line)] bg-[#f7f3e8] px-3 py-2 text-sm">
          <p>
            Filtre societe actif: <span className="font-semibold">{selectedSociety.name}</span>
          </p>
          <button
            type="button"
            onClick={() => router.push('/crm/contacts')}
            className="rounded border border-[var(--line)] px-2 py-1 text-xs"
          >
            Retirer filtre
          </button>
        </div>
      ) : null}

      {isFormOpen ? (
        <form onSubmit={onCreateContact} className="mt-4 grid gap-2">
          <p className="text-xs text-[#5b5952]">
            Rattachement a une societe: selectionne une societe dans la liste avant de creer le contact.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Nom"
              className="h-10 rounded border border-[var(--line)] px-3"
            />
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Prenom"
              className="h-10 rounded border border-[var(--line)] px-3"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              className="h-10 rounded border border-[var(--line)] px-3"
            />
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Telephone"
              className="h-10 rounded border border-[var(--line)] px-3"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="h-10 rounded border border-[var(--line)] bg-white px-3"
            >
              <option value="">Role non defini</option>
              <option value="DECIDEUR">Decideur</option>
              <option value="N_MINUS_1">N-1</option>
              <option value="OPERATIONNEL">Operationnel</option>
            </select>
            <select
              value={societyId}
              onChange={(event) => setSocietyId(event.target.value)}
              className="h-10 rounded border border-[var(--line)] bg-white px-3"
            >
              <option value="">Aucune societe</option>
              {uniqueSocieties.map((society) => (
                <option key={society.id} value={society.id}>
                  {society.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">
              {editingContactId ? 'Mettre a jour' : 'Ajouter'}
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

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
              <th className="px-2 py-2">Nom + Prenom</th>
              <th className="px-2 py-2">Adresse mail</th>
              <th className="px-2 py-2">Telephone</th>
              <th className="px-2 py-2">Societe</th>
              <th className="px-2 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {filteredContacts.map((contact) => (
              <tr key={contact.id} className="border-b border-[var(--line)] bg-[#fbfaf7]">
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => onEditContact(contact)}
                    className="font-semibold text-[var(--brand)] underline-offset-2 hover:underline"
                  >
                    {contact.lastName} {contact.firstName}
                  </button>
                </td>
                <td className="px-2 py-2">{contact.email || '-'}</td>
                <td className="px-2 py-2">{contact.phone || '-'}</td>
                <td className="px-2 py-2">{contact.society?.name || '-'}</td>
                <td className="px-2 py-2">{formatRole(contact.role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
