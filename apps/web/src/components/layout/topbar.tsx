'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

export function Topbar() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<Array<{ workspace: { id: string; name: string } }>>([]);

  useEffect(() => {
    let active = true;
    const token = getAccessToken();
    if (!token) return () => { active = false; };

    void apiClient.listWorkspaces(token).then((memberships) => {
      if (!active) return;
      setWorkspaces(memberships);
      const current = memberships.find((item) => item.isDefault) ?? memberships[0];
      setWorkspaceId(current?.workspace.id ?? '');
    });

    return () => {
      active = false;
    };
  }, []);

  async function onSwitch(nextWorkspaceId: string): Promise<void> {
    setWorkspaceId(nextWorkspaceId);
    const token = getAccessToken();
    if (!token) return;
    const switched = await apiClient.switchWorkspace(token, nextWorkspaceId);
    localStorage.setItem('mw_access_token', switched.accessToken);
    showToast('Workspace actif changé.', 'success');
    window.location.reload();
  }

  return (
    <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#6f6d66]">Workspace</p>
        <select
          value={workspaceId}
          onChange={(event) => {
            void onSwitch(event.target.value);
          }}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-1 text-sm"
        >
          {workspaces.map((item) => (
            <option key={item.workspace.id} value={item.workspace.id}>
              {item.workspace.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm font-medium text-[#4f4d45]">Premium Consulting Operating System</p>
    </header>
  );
}
