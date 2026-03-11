'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type WorkspaceMembership = {
  workspace: { id: string; name: string };
  role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
  isDefault: boolean;
  associatedSocietyName: string | null;
};
type Society = { id: string; name: string };

function normalizeSocietyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function dedupeSocietiesByName(input: Society[]): Society[] {
  const seen = new Set<string>();
  const deduped: Society[] = [];
  for (const society of input) {
    const key = normalizeSocietyName(society.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(society);
  }
  return deduped;
}

export default function WorkspaceSettingsPage() {
  const [activeSubmenu, setActiveSubmenu] = useState<'workspaces' | 'imap'>('workspaces');
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [allSocieties, setAllSocieties] = useState<Society[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState<number>(993);
  const [imapUser, setImapUser] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [associatedSocietyId, setAssociatedSocietyId] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [signatureProvider, setSignatureProvider] = useState<'MOCK' | 'YOUSIGN' | 'DOCUSIGN'>('MOCK');
  const [signatureApiBaseUrl, setSignatureApiBaseUrl] = useState('');
  const [signatureApiKey, setSignatureApiKey] = useState('');

  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceAssociatedSocietyId, setNewWorkspaceAssociatedSocietyId] = useState('');
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('');
  const [editingAssociatedSocietyId, setEditingAssociatedSocietyId] = useState('');
  const [editingAssociatedSocietyName, setEditingAssociatedSocietyName] = useState<string | null>(null);

  const uniqueAllSocieties = useMemo(() => dedupeSocietiesByName(allSocieties), [allSocieties]);
  const uniqueSocieties = useMemo(() => dedupeSocietiesByName(societies), [societies]);

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
      const [workspacesData, settings, societiesData, allSocietiesData] = await Promise.all([
        apiClient.listWorkspaces(token),
        apiClient.getWorkspaceSettings(token),
        apiClient.listSocieties(token),
        apiClient.listSocietiesAll(token),
      ]);
      setWorkspaces(workspacesData);
      setSocieties(societiesData);
      setAllSocieties(allSocietiesData);
      setWorkspaceName(settings.workspaceName ?? '');
      setImapHost(settings.imapHost ?? '');
      setImapPort(settings.imapPort ?? 993);
      setImapUser(settings.imapUser ?? '');
      const dedupedSocietiesData = dedupeSocietiesByName(societiesData);
      const validAssociatedSocietyId =
        settings.associatedSocietyId && dedupedSocietiesData.some((society) => society.id === settings.associatedSocietyId)
          ? settings.associatedSocietyId
          : dedupedSocietiesData[0]?.id ?? '';
      setAssociatedSocietyId(validAssociatedSocietyId);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const createRequested = new URLSearchParams(window.location.search).get('create');
    if (createRequested === '1' || createRequested === 'true') {
      setActiveSubmenu('workspaces');
      setShowCreateWorkspace(true);
    }
  }, []);

  async function onSwitch(workspaceId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const switched = await apiClient.switchWorkspace(token, workspaceId);
    localStorage.setItem('mw_access_token', switched.accessToken);
    localStorage.setItem('mw_active_workspace_id', switched.activeWorkspaceId);
    window.dispatchEvent(new Event('mw_workspace_changed'));
    showToast('Workspace actif changé.', 'success');
    window.location.assign('/projects');
  }

  async function onCreateWorkspace(): Promise<void> {
    const token = getAccessToken();
    if (!token || !newWorkspaceName.trim() || !newWorkspaceAssociatedSocietyId) return;
    await apiClient.createWorkspace(token, {
      name: newWorkspaceName.trim(),
      associatedSocietyId: newWorkspaceAssociatedSocietyId,
    });
    setNewWorkspaceName('');
    setNewWorkspaceAssociatedSocietyId('');
    setShowCreateWorkspace(false);
    showToast('Workspace créé.', 'success');
    await load();
  }

  function onStartEdit(workspaceId: string, name: string, associatedSocietyName: string | null): void {
    setEditingWorkspaceId(workspaceId);
    setEditingWorkspaceName(name);
    setEditingAssociatedSocietyId('');
    setEditingAssociatedSocietyName(associatedSocietyName);
  }

  async function onSaveWorkspaceEdit(): Promise<void> {
    const token = getAccessToken();
    if (!token || !editingWorkspaceId || !editingWorkspaceName.trim()) return;
    try {
      await apiClient.updateWorkspace(token, editingWorkspaceId, {
        name: editingWorkspaceName.trim(),
        associatedSocietyId: editingAssociatedSocietyId || undefined,
      });
      showToast('Workspace modifié.', 'success');
      setEditingWorkspaceId(null);
      setEditingWorkspaceName('');
      setEditingAssociatedSocietyId('');
      setEditingAssociatedSocietyName(null);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Modification impossible.', 'error');
    }
  }

  async function onDeleteWorkspace(workspaceId: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const confirmation = window.prompt('Tape SUPPRESSION pour confirmer:');
    if (!confirmation) return;
    try {
      await apiClient.deleteWorkspace(token, workspaceId, confirmation);
      showToast('Workspace supprimé.', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Suppression impossible.', 'error');
    }
  }

  async function onSaveSettings(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const validAssociatedSocietyId =
        associatedSocietyId && uniqueSocieties.some((society) => society.id === associatedSocietyId)
          ? associatedSocietyId
          : undefined;
      await apiClient.updateWorkspaceSettings(token, {
        imapHost: imapHost.trim() || undefined,
        imapPort,
        imapUser: imapUser.trim() || undefined,
        workspaceName: workspaceName.trim() || undefined,
        associatedSocietyId: validAssociatedSocietyId,
        imapPassword: imapPassword || undefined,
        signatureProvider,
        signatureApiBaseUrl: signatureApiBaseUrl.trim() || undefined,
        signatureApiKey: signatureApiKey || undefined,
      });
      setImapPassword('');
      setSignatureApiKey('');
      showToast('Paramètres workspace enregistrés.', 'success');
      await load();
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.', 'error');
    }
  }

  return (
    <>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveSubmenu('workspaces')}
          className={`rounded px-3 py-2 text-sm ${activeSubmenu === 'workspaces' ? 'bg-[var(--brand)] text-white' : 'border border-[var(--line)]'}`}
        >
          Espaces de travail
        </button>
        <button
          type="button"
          onClick={() => setActiveSubmenu('imap')}
          className={`rounded px-3 py-2 text-sm ${activeSubmenu === 'imap' ? 'bg-[var(--brand)] text-white' : 'border border-[var(--line)]'}`}
        >
          IMAP
        </button>
      </div>

      {activeSubmenu === 'workspaces' ? (
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Espaces de travail</h2>
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
            <select
              value={newWorkspaceAssociatedSocietyId}
              onChange={(e) => setNewWorkspaceAssociatedSocietyId(e.target.value)}
              className="rounded border border-[var(--line)] px-3 py-2 text-sm"
            >
              <option value="">Société associée (liste)</option>
              {uniqueAllSocieties.map((society) => (
                <option key={society.id} value={society.id}>
                  {society.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={onCreateWorkspace}
                disabled={!newWorkspaceName.trim() || !newWorkspaceAssociatedSocietyId}
                className="rounded bg-[var(--brand)] px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Créer
              </button>
              <button
                onClick={() => {
                  setShowCreateWorkspace(false);
                  setNewWorkspaceName('');
                  setNewWorkspaceAssociatedSocietyId('');
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
            <li key={item.workspace.id} className="rounded border border-[var(--line)] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {item.workspace.name} ({item.role}){item.isDefault ? ' - Defaut' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => void onSwitch(item.workspace.id)} className="rounded border border-[var(--line)] px-2 py-1 text-xs">
                    Basculer
                  </button>
                  <button
                    onClick={() => onStartEdit(item.workspace.id, item.workspace.name, item.associatedSocietyName)}
                    className="rounded border border-[var(--line)] px-2 py-1 text-xs"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={() => void onDeleteWorkspace(item.workspace.id)}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
              {editingWorkspaceId === item.workspace.id ? (
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                  <input
                    value={editingWorkspaceName}
                    onChange={(e) => setEditingWorkspaceName(e.target.value)}
                    placeholder="Nom du workspace"
                    className="rounded border border-[var(--line)] px-3 py-2 text-sm"
                  />
                  <select
                    value={editingAssociatedSocietyId}
                    onChange={(e) => setEditingAssociatedSocietyId(e.target.value)}
                    className="rounded border border-[var(--line)] px-3 py-2 text-sm"
                  >
                    <option value="">
                      {editingAssociatedSocietyName
                        ? `Société associée actuelle : ${editingAssociatedSocietyName}`
                        : 'Aucune société associée'}
                    </option>
                    {uniqueAllSocieties.map((society) => (
                      <option key={society.id} value={society.id}>
                        {society.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void onSaveWorkspaceEdit()}
                      className="rounded bg-[var(--brand)] px-3 py-2 text-xs text-white"
                    >
                      Enregistrer
                    </button>
                    <button
                      onClick={() => {
                        setEditingWorkspaceId(null);
                        setEditingWorkspaceName('');
                        setEditingAssociatedSocietyId('');
                        setEditingAssociatedSocietyName(null);
                      }}
                      className="rounded border border-[var(--line)] px-3 py-2 text-xs"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </article>
      ) : null}

      {activeSubmenu === 'imap' ? (
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <h2 className="font-semibold">Parametrage IMAP (recuperation des mails)</h2>
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
      ) : null}

    </>
  );
}
