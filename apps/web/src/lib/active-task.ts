export type ActiveProjectContext = {
  projectId: string;
  projectTitle: string;
  projectTypology?: string | null;
  workspaceId?: string;
  updatedAt: string;
};

export type ActiveTaskContext = {
  taskId: string;
  projectId: string;
  taskDescription: string;
  workspaceId?: string;
  updatedAt: string;
};

const PROJECT_STORAGE_KEY = 'mw_active_project_context';
const TASK_STORAGE_KEY = 'mw_active_task_context';

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getActiveProjectContext(): ActiveProjectContext | null {
  if (typeof window === 'undefined') return null;
  const parsed = parseJson<ActiveProjectContext>(window.localStorage.getItem(PROJECT_STORAGE_KEY));
  if (!parsed?.projectId) return null;
  return parsed;
}

export function setActiveProjectContext(payload: Omit<ActiveProjectContext, 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  const value: ActiveProjectContext = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(value));

  const activeTask = getActiveTaskContext();
  if (activeTask && activeTask.projectId !== value.projectId) {
    clearActiveTaskContext(false);
  }

  window.dispatchEvent(new Event('mw_active_project_changed'));
}

export function clearActiveProjectContext(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  clearActiveTaskContext(false);
  window.dispatchEvent(new Event('mw_active_project_changed'));
}

export function getActiveTaskContext(): ActiveTaskContext | null {
  if (typeof window === 'undefined') return null;
  const parsed = parseJson<ActiveTaskContext>(window.localStorage.getItem(TASK_STORAGE_KEY));
  if (!parsed?.taskId || !parsed?.projectId) return null;
  return parsed;
}

export function setActiveTaskContext(payload: Omit<ActiveTaskContext, 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  const value: ActiveTaskContext = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event('mw_active_task_changed'));
}

export function clearActiveTaskContext(emitEvent = true): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TASK_STORAGE_KEY);
  if (emitEvent) {
    window.dispatchEvent(new Event('mw_active_task_changed'));
  }
}

