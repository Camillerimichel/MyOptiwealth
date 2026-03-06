'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

export function Topbar() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<Array<{ workspace: { id: string; name: string } }>>([]);
  const workspaceCollator = useMemo(
    () => new Intl.Collator('fr', { sensitivity: 'base' }),
    [],
  );

  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((left, right) =>
        workspaceCollator.compare(
          left.workspace.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase(),
          right.workspace.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase(),
        ),
      ),
    [workspaces, workspaceCollator],
  );

  const currentWorkspaceName = useMemo(() => {
    const active = sortedWorkspaces.find((item) => item.workspace.id === workspaceId);
    return active?.workspace.name ?? 'Aucun workspace';
  }, [sortedWorkspaces, workspaceId]);

  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggingOutRef = useRef(false);

  const performLogout = useCallback(async (reason: 'manual' | 'inactive') => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    const token = getAccessToken();
    if (token) {
      try {
        await apiClient.logout(token);
      } catch {
        // Best effort logout: continue client-side logout even if API fails.
      }
    }
    clearAccessToken();
    showToast(reason === 'inactive' ? 'Déconnexion automatique après inactivité.' : 'Déconnexion réussie.', 'success');
    router.push('/login');
  }, [router]);

  useEffect(() => {
    let active = true;
    const resolveWorkspaceId = (memberships: Array<{ workspace: { id: string; name: string }; isDefault?: boolean }>): string => {
      const savedWorkspaceId = localStorage.getItem('mw_active_workspace_id');
      if (savedWorkspaceId && memberships.some((item) => item.workspace.id === savedWorkspaceId)) {
        return savedWorkspaceId;
      }
      const fallback = memberships.find((item) => item.isDefault) ?? memberships[0];
      return fallback?.workspace.id ?? '';
    };
    const token = getAccessToken();
    if (token) {
      void apiClient.listWorkspaces(token).then((memberships) => {
        if (!active) return;
        setWorkspaces(memberships);
        setWorkspaceId(resolveWorkspaceId(memberships));
      });
    }
    const onWorkspaceChanged = (): void => {
      if (!active) return;
      const changedToken = getAccessToken();
      if (!changedToken) return;
      void apiClient.listWorkspaces(changedToken).then((memberships) => {
        if (!active) return;
        setWorkspaces(memberships);
        setWorkspaceId(resolveWorkspaceId(memberships));
      });
    };
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    return () => {
      active = false;
      window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
    };
  }, []);

  useEffect(() => {
    const resetInactivityTimer = (): void => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      inactivityTimeoutRef.current = setTimeout(() => {
        void performLogout('inactive');
      }, 60 * 60 * 1000);
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer();

    return () => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      events.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
    };
  }, [performLogout]);

  async function onSwitch(nextWorkspaceId: string): Promise<void> {
    setWorkspaceId(nextWorkspaceId);
    const token = getAccessToken();
    if (!token) return;
    const switched = await apiClient.switchWorkspace(token, nextWorkspaceId);
    localStorage.setItem('mw_access_token', switched.accessToken);
    localStorage.setItem('mw_active_workspace_id', switched.activeWorkspaceId);
    window.dispatchEvent(new Event('mw_workspace_changed'));
    showToast('Workspace actif changé.', 'success');
    window.location.reload();
  }

  return (
    <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
      <div className="min-w-[260px]">
        <p className="mb-1 text-xs uppercase tracking-[0.2em] text-[#6f6d66]">Workspace actif</p>
        <details className="group relative">
          <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm shadow-sm hover:bg-[#f8f5eb]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--brand)]" />
              <span className="max-w-[160px] truncate font-semibold text-[#2f2b23]">{currentWorkspaceName}</span>
            </div>
            <span className="text-[#6f6d66] group-open:rotate-180">▾</span>
          </summary>
          <ul className="absolute right-0 z-20 mt-2 min-w-[260px] rounded-lg border border-[var(--line)] bg-white p-2 shadow-lg">
            {sortedWorkspaces.map((item) => (
              <li key={item.workspace.id}>
                <button
                  type="button"
                  onClick={() => {
                    void onSwitch(item.workspace.id);
                  }}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${
                    item.workspace.id === workspaceId
                      ? 'bg-[var(--brand)] text-white'
                      : 'text-[#2f2b23] hover:bg-[#f8f5eb]'
                  }`}
                >
                  <div className="truncate">{item.workspace.name}</div>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium text-[#4f4d45]">Premium Consulting Operating System</p>
        <button
          type="button"
          onClick={() => {
            void performLogout('manual');
          }}
          className="rounded border border-[var(--line)] px-3 py-2 text-sm"
        >
          Déconnexion
        </button>
      </div>
    </header>
  );
}
