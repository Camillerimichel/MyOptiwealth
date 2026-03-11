'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type UserRole = {
  user: { id: string; email: string; firstName?: string | null; lastName?: string | null; isActive: boolean };
  role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
  isDefault: boolean;
};

export default function SettingsUsersPage() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, { firstName: string; lastName: string; role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER'; isActive: boolean; password: string }>>({});
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'COLLABORATOR' | 'VIEWER'>('COLLABORATOR');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
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
      const usersData = await apiClient.listUsers(token);
      setUsers(usersData);
      setUserDrafts(
        Object.fromEntries(
          usersData.map((item) => [
            item.user.id,
            {
              firstName: item.user.firstName ?? '',
              lastName: item.user.lastName ?? '',
              role: item.role,
              isActive: item.user.isActive,
              password: '',
            },
          ]),
        ),
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

  function updateUserDraft(userId: string, field: 'firstName' | 'lastName' | 'role' | 'isActive' | 'password', value: string): void {
    setUserDrafts((current) => {
      const existing = current[userId] ?? { firstName: '', lastName: '', role: 'VIEWER' as const, isActive: true, password: '' };
      if (field === 'role') {
        return {
          ...current,
          [userId]: {
            ...existing,
            role: value as 'ADMIN' | 'COLLABORATOR' | 'VIEWER',
          },
        };
      }
      if (field === 'isActive') {
        return {
          ...current,
          [userId]: {
            ...existing,
            isActive: value === 'true',
          },
        };
      }
      return {
        ...current,
        [userId]: {
          ...existing,
          [field]: value,
        },
      };
    });
  }

  async function onSaveUser(userId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const draft = userDrafts[userId];
    if (!draft) return;

    await apiClient.updateUser(token, userId, {
      firstName: draft.firstName || null,
      lastName: draft.lastName || null,
      role: draft.role,
      isActive: draft.isActive,
    });
    showToast('Utilisateur mis à jour.', 'success');
    await load();
  }

  async function onResetPassword(userId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const draft = userDrafts[userId];
    if (!draft?.password || draft.password.length < 8) {
      showToast('Mot de passe minimum 8 caractères.', 'error');
      return;
    }
    await apiClient.resetUserPassword(token, userId, draft.password);
    setUserDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] ?? { firstName: '', lastName: '', role: 'VIEWER', isActive: true, password: '' }),
        password: '',
      },
    }));
    showToast('Mot de passe réinitialisé.', 'success');
  }

  async function onCreateUser(): Promise<void> {
    const token = getAccessToken();
    if (!token || !newEmail || !newPassword) return;

    await apiClient.createUser(token, {
      email: newEmail,
      password: newPassword,
      firstName: newFirstName || undefined,
      lastName: newLastName || undefined,
      role: newRole,
    });
    setNewEmail('');
    setNewPassword('');
    setNewFirstName('');
    setNewLastName('');
    setNewRole('COLLABORATOR');
    showToast('Utilisateur créé.', 'success');
    await load();
  }

  async function onSelectUser(userId: string): Promise<void> {
    setSelectedUserId(userId);
  }

  return (
    <section className="grid gap-4">
      <p className="text-sm text-[#5b5952]">Utilisateurs d&apos;Optiwealth pour ce workspace.</p>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h2 className="font-semibold">Users</h2>
        <div className="mt-3 grid gap-2 rounded border border-[var(--line)] p-3">
          <p className="text-sm font-medium">Créer un utilisateur</p>
          <div className="grid gap-2 lg:grid-cols-5">
            <input
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              placeholder="Prénom"
              className="rounded border border-[var(--line)] px-2 py-2"
            />
            <input
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              placeholder="Nom"
              className="rounded border border-[var(--line)] px-2 py-2"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email"
              className="rounded border border-[var(--line)] px-2 py-2"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mot de passe"
              className="rounded border border-[var(--line)] px-2 py-2"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'COLLABORATOR' | 'VIEWER')}
              className="rounded border border-[var(--line)] px-2 py-2"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="COLLABORATOR">COLLABORATOR</option>
              <option value="VIEWER">VIEWER</option>
            </select>
          </div>
          <div>
            <button
              onClick={() => {
                void onCreateUser();
              }}
              className="rounded bg-[var(--brand)] px-3 py-2 text-white"
            >
              Créer
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm">
          {users.map((item) => {
            const draft = userDrafts[item.user.id] ?? {
              firstName: item.user.firstName ?? '',
              lastName: item.user.lastName ?? '',
              role: item.role,
              isActive: item.user.isActive,
              password: '',
            };
            const selected = selectedUserId === item.user.id;
            return (
              <div key={item.user.id} className="grid gap-2 rounded border border-[var(--line)] p-2">
                <button
                  type="button"
                  onClick={() => {
                    void onSelectUser(item.user.id);
                  }}
                  className="text-left"
                >
                  <p className="text-xs text-[#5b5952]">{item.user.email}</p>
                  <p className="text-sm font-medium text-[var(--fg)]">
                    {[item.user.firstName, item.user.lastName].filter(Boolean).join(' ') || 'Sans nom'} ({item.role})
                  </p>
                  <p className={`text-xs ${item.user.isActive ? 'text-emerald-700' : 'text-red-700'}`}>
                    {item.user.isActive ? 'Actif' : 'Non actif'}
                  </p>
                </button>

                {selected ? (
                  <div className="grid gap-2 rounded border border-[var(--line)] bg-[#f8f4ea] p-2">
                    <div className="grid gap-2 lg:grid-cols-5">
                      <input
                        value={draft.firstName}
                        onChange={(e) => updateUserDraft(item.user.id, 'firstName', e.target.value)}
                        placeholder="Prénom"
                        className="rounded border border-[var(--line)] px-2 py-2"
                      />
                      <input
                        value={draft.lastName}
                        onChange={(e) => updateUserDraft(item.user.id, 'lastName', e.target.value)}
                        placeholder="Nom"
                        className="rounded border border-[var(--line)] px-2 py-2"
                      />
                      <select
                        value={draft.role}
                        onChange={(e) => updateUserDraft(item.user.id, 'role', e.target.value)}
                        className="rounded border border-[var(--line)] px-2 py-2"
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="COLLABORATOR">COLLABORATOR</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                      <select
                        value={String(draft.isActive)}
                        onChange={(e) => updateUserDraft(item.user.id, 'isActive', e.target.value)}
                        className="rounded border border-[var(--line)] px-2 py-2"
                      >
                        <option value="true">Actif</option>
                        <option value="false">Non actif</option>
                      </select>
                      <button
                        onClick={() => {
                          void onSaveUser(item.user.id);
                        }}
                        className="rounded bg-[var(--brand)] px-3 py-2 text-white"
                      >
                        Enregistrer
                      </button>
                    </div>
                    <div className="grid gap-2 lg:grid-cols-4">
                      <input
                        type="password"
                        value={draft.password}
                        onChange={(e) => updateUserDraft(item.user.id, 'password', e.target.value)}
                        placeholder="Nouveau mot de passe (8+ caractères)"
                        className="rounded border border-[var(--line)] px-2 py-2 lg:col-span-3"
                      />
                      <button
                        onClick={() => {
                          void onResetPassword(item.user.id);
                        }}
                        className="rounded border border-[var(--line)] bg-white px-3 py-2"
                      >
                        Réinitialiser MDP
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
