'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type UserRole = {
  user: { id: string; email: string; firstName?: string | null; lastName?: string | null };
  role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
  isDefault: boolean;
};

export default function SettingsUsersPage() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, { firstName: string; lastName: string; role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER' }>>({});
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'COLLABORATOR' | 'VIEWER'>('COLLABORATOR');
  const [provisioning, setProvisioning] = useState<{ email: string; secret: string; otpauth: string } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selected2fa, setSelected2fa] = useState<{ email: string; twoFactorEnabled: boolean; secret: string; otpauth: string } | null>(null);
  const [selected2faLoading, setSelected2faLoading] = useState(false);
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

  function updateUserDraft(userId: string, field: 'firstName' | 'lastName' | 'role', value: string): void {
    setUserDrafts((current) => {
      const existing = current[userId] ?? { firstName: '', lastName: '', role: 'VIEWER' as const };
      if (field === 'role') {
        return {
          ...current,
          [userId]: {
            ...existing,
            role: value as 'ADMIN' | 'COLLABORATOR' | 'VIEWER',
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
    });
    showToast('Utilisateur mis à jour.', 'success');
    await load();
  }

  async function onCreateUser(): Promise<void> {
    const token = getAccessToken();
    if (!token || !newEmail || !newPassword) return;

    const created = await apiClient.createUser(token, {
      email: newEmail,
      password: newPassword,
      firstName: newFirstName || undefined,
      lastName: newLastName || undefined,
      role: newRole,
    });

    setProvisioning(
      created.twoFactorProvisioning
        ? { email: created.user.email, secret: created.twoFactorProvisioning.secret, otpauth: created.twoFactorProvisioning.otpauth }
        : null,
    );
    setNewEmail('');
    setNewPassword('');
    setNewFirstName('');
    setNewLastName('');
    setNewRole('COLLABORATOR');
    showToast('Utilisateur créé.', 'success');
    await load();
  }

  async function onSelectUser(userId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setSelectedUserId(userId);
    setSelected2fa(null);
    setSelected2faLoading(true);
    try {
      const twoFactor = await apiClient.getUserTwoFactorProvisioning(token, userId);
      setSelected2fa({
        email: twoFactor.email,
        twoFactorEnabled: twoFactor.twoFactorEnabled,
        secret: twoFactor.secret,
        otpauth: twoFactor.otpauth,
      });
    } finally {
      setSelected2faLoading(false);
    }
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
          {provisioning ? (
            <div className="rounded border border-[var(--line)] bg-[#f8f4ea] p-2 text-xs text-[#4f4d45]">
              <p className="font-medium">2FA initial pour {provisioning.email}</p>
              <p>Secret: {provisioning.secret}</p>
              <p className="break-all">URI: {provisioning.otpauth}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm">
          {users.map((item) => {
            const draft = userDrafts[item.user.id] ?? {
              firstName: item.user.firstName ?? '',
              lastName: item.user.lastName ?? '',
              role: item.role,
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
                </button>

                {selected ? (
                  <div className="grid gap-2 rounded border border-[var(--line)] bg-[#f8f4ea] p-2">
                    <div className="grid gap-2 lg:grid-cols-4">
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
                      <button
                        onClick={() => {
                          void onSaveUser(item.user.id);
                        }}
                        className="rounded bg-[var(--brand)] px-3 py-2 text-white"
                      >
                        Enregistrer
                      </button>
                    </div>

                    {selected2faLoading ? <p className="text-xs text-[#5b5952]">Chargement 2FA...</p> : null}
                    {selected2fa ? (
                      <div className="rounded border border-[var(--line)] bg-white p-2 text-xs text-[#4f4d45]">
                        <p className="font-medium">Données 2FA</p>
                        <p>Email: {selected2fa.email}</p>
                        <p>2FA activé: {selected2fa.twoFactorEnabled ? 'Oui' : 'Non'}</p>
                        <p>Secret: {selected2fa.secret}</p>
                        <p className="break-all">URI: {selected2fa.otpauth}</p>
                      </div>
                    ) : null}
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
