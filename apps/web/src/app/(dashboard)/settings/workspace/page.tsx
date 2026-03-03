'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type WorkspaceMembership = {
  workspace: { id: string; name: string };
  role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
  isDefault: boolean;
};

export default function WorkspaceSettingsPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState<number>(993);
  const [imapUser, setImapUser] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [signatureProvider, setSignatureProvider] = useState<'MOCK' | 'YOUSIGN' | 'DOCUSIGN'>('MOCK');
  const [signatureApiBaseUrl, setSignatureApiBaseUrl] = useState('');
  const [signatureApiKey, setSignatureApiKey] = useState('');

  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);

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
      const [workspacesData, settings] = await Promise.all([
        apiClient.listWorkspaces(token),
        apiClient.getWorkspaceSettings(token),
      ]);
      setWorkspaces(workspacesData);
      setImapHost(settings.imapHost ?? '');
      setImapPort(settings.imapPort ?? 993);
      setImapUser(settings.imapUser ?? '');
      if (settings.signatureProvider === 'YOUSIGN' || settings.signatureProvider === 'DOCUSIGN' || settings.signatureProvider === 'MOCK') {
        setSignatureProvider(settings.signatureProvider);
      }
      setSignatureApiBaseUrl(settings.signatureApiBaseUrl ?? '');
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSwitch(workspaceId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const switched = await apiClient.switchWorkspace(token, workspaceId);
    localStorage.setItem('mw_access_token', switched.accessToken);
    showToast('Workspace actif changé.', 'success');
    await load();
  }

  async function onCreateWorkspace(): Promise<void> {
    const token = getAccessToken();
    if (!token || !newWorkspaceName.trim()) return;
    await apiClient.createWorkspace(token, { name: newWorkspaceName.trim() });
    setNewWorkspaceName('');
    setShowCreateWorkspace(false);
    showToast('Workspace créé.', 'success');
    await load();
  }

  async function onSaveSettings(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    await apiClient.updateWorkspaceSettings(token, {
      imapHost: imapHost || undefined,
      imapPort,
      imapUser: imapUser || undefined,
      imapPassword: imapPassword || undefined,
      signatureProvider,
      signatureApiBaseUrl: signatureApiBaseUrl || undefined,
      signatureApiKey: signatureApiKey || undefined,
    });
    setImapPassword('');
    setSignatureApiKey('');
    showToast('Paramètres workspace enregistrés.', 'success');
    await load();
  }

  return (
    <>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Workspaces</h2>
          <button
            onClick={() => setShowCreateWorkspace((prev) => !prev)}
            className="h-8 w-8 rounded bg-[var(--brand)] text-lg leading-none text-white"
            title="Créer un workspace"
            aria-label="Créer un workspace"
          >
            +
          </button>
        </div>

        {showCreateWorkspace ? (
          <div className="mt-3 grid gap-2">
            <input
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="Nom du workspace"
              className="rounded border border-[var(--line)] px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button onClick={onCreateWorkspace} className="rounded bg-[var(--brand)] px-3 py-2 text-xs text-white">
                Créer
              </button>
              <button
                onClick={() => {
                  setShowCreateWorkspace(false);
                  setNewWorkspaceName('');
                }}
                className="rounded border border-[var(--line)] px-3 py-2 text-xs"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : null}

        <ul className="mt-3 grid gap-2 text-sm">
          {workspaces.map((item) => (
            <li key={item.workspace.id} className="flex items-center justify-between gap-2 rounded border border-[var(--line)] px-3 py-2">
              <span>
                {item.workspace.name} ({item.role}){item.isDefault ? ' - Defaut' : ''}
              </span>
              <button onClick={() => void onSwitch(item.workspace.id)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">
                Switch
              </button>
            </li>
          ))}
        </ul>
      </article>

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h2 className="font-semibold">Workspace settings (IMAP / Signature)</h2>
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="IMAP host" className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} placeholder="IMAP port" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="IMAP user" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} placeholder="IMAP password (optional update)" type="password" className="rounded border border-[var(--line)] px-3 py-2" />
          <select value={signatureProvider} onChange={(e) => setSignatureProvider(e.target.value as 'MOCK' | 'YOUSIGN' | 'DOCUSIGN')} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="MOCK">MOCK</option>
            <option value="YOUSIGN">YOUSIGN</option>
            <option value="DOCUSIGN">DOCUSIGN</option>
          </select>
          <input value={signatureApiBaseUrl} onChange={(e) => setSignatureApiBaseUrl(e.target.value)} placeholder="Signature API base URL" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={signatureApiKey} onChange={(e) => setSignatureApiKey(e.target.value)} placeholder="Signature API key (optional update)" type="password" className="rounded border border-[var(--line)] px-3 py-2" />
        </div>
        <button onClick={() => void onSaveSettings()} className="mt-3 rounded bg-[var(--brand)] px-3 py-2 text-white">
          Enregistrer settings
        </button>
      </article>

    </>
  );
}
