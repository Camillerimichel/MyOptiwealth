import { DashboardPayload } from '@/types/api';
import { showToast } from '@/lib/toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:7000/api';

interface AuthTokens {
  accessToken: string;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function normalizeApiMessage(
  status: number,
  serverMessage?: string,
): string {
  if (serverMessage) {
    return serverMessage;
  }

  if (status === 401) {
    return 'Session expirée. Reconnecte-toi.';
  }
  if (status === 403) {
    return 'Accès refusé sur cette action.';
  }
  if (status >= 500) {
    return 'Erreur serveur. Réessaie dans quelques instants.';
  }

  return `Erreur API (${status}).`;
}

async function request<T>(
  path: string,
  options?: {
    method?: HttpMethod;
    token?: string;
    body?: unknown;
    isText?: boolean;
    skipAuthRefresh?: boolean;
  },
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options?.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  if (
    response.status === 401 &&
    options?.token &&
    !options.skipAuthRefresh &&
    typeof window !== 'undefined'
  ) {
    const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (refreshResponse.ok) {
      const refreshed = (await refreshResponse.json()) as AuthTokens;
      localStorage.setItem('mw_access_token', refreshed.accessToken);
      return request<T>(path, {
        ...options,
        token: refreshed.accessToken,
        skipAuthRefresh: true,
      });
    }
  }

  if (!response.ok) {
    let serverMessage: string | undefined;
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      if (typeof payload.message === 'string') {
        serverMessage = payload.message;
      } else if (Array.isArray(payload.message)) {
        serverMessage = payload.message.join(', ');
      }
    } else {
      const text = await response.text();
      serverMessage = text || undefined;
    }

    const message = normalizeApiMessage(response.status, serverMessage);
    showToast(message, 'error');

    if (typeof window !== 'undefined' && response.status === 401) {
      localStorage.removeItem('mw_access_token');
    }

    throw new ApiError(message, response.status);
  }

  if (options?.isText) {
    return (await response.text()) as T;
  }

  return (await response.json()) as T;
}

async function uploadWithAuth<T>(
  path: string,
  token: string,
  formData: FormData,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = normalizeApiMessage(response.status);
    showToast(message, 'error');
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  register(email: string, password: string, workspaceName: string) {
    return request<{ tokens: AuthTokens; twoFactorProvisioning: { otpauth: string } }>('/auth/register', {
      method: 'POST',
      body: { email, password, workspaceName },
    });
  },

  login(email: string, password: string, totpCode: string) {
    return request<{ tokens: AuthTokens; activeWorkspaceId: string }>('/auth/login', {
      method: 'POST',
      body: { email, password, totpCode },
    });
  },

  dashboard(token: string) {
    return request<DashboardPayload>('/dashboard/homepage', { token });
  },

  listSocieties(token: string) {
    return request<
      Array<{
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
      }>
    >('/crm/societies', { token });
  },

  createSociety(
    token: string,
    payload: {
      name: string;
      legalForm?: string;
      siren?: string;
      siret?: string;
      addressLine1?: string;
      addressLine2?: string;
      postalCode?: string;
      city?: string;
      country?: string;
    },
  ) {
    return request('/crm/societies', { method: 'POST', token, body: payload });
  },

  updateSociety(
    token: string,
    societyId: string,
    payload: {
      name?: string;
      legalForm?: string | null;
      siren?: string | null;
      siret?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      postalCode?: string | null;
      city?: string | null;
      country?: string | null;
    },
  ) {
    return request(`/crm/societies/${societyId}`, { method: 'PATCH', token, body: payload });
  },

  listContacts(token: string) {
    return request<
      Array<{
        id: string;
        firstName: string;
        lastName: string;
        email?: string | null;
        phone?: string | null;
        role?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
        society?: { id: string; name: string } | null;
      }>
    >('/crm/contacts', {
      token,
    });
  },

  createContact(
    token: string,
    payload: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      role?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL';
      societyId?: string;
    },
  ) {
    return request('/crm/contacts', { method: 'POST', token, body: payload });
  },

  updateContact(
    token: string,
    contactId: string,
    payload: {
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
      role?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
      societyId?: string | null;
    },
  ) {
    return request(`/crm/contacts/${contactId}`, { method: 'PATCH', token, body: payload });
  },

  listProjects(token: string) {
    return request<Array<{ id: string; name: string; progressPercent: number; missionType?: string | null }>>('/projects', { token });
  },

  createProject(
    token: string,
    payload: {
      name: string;
      societyId: string;
      estimatedFees?: string;
      missionType?: string;
    },
  ) {
    return request('/projects', { method: 'POST', token, body: payload });
  },

  updateProject(
    token: string,
    projectId: string,
    payload: {
      name?: string;
      missionType?: string;
    },
  ) {
    return request(`/projects/${projectId}`, { method: 'PATCH', token, body: payload });
  },

  listKanban(token: string) {
    return request<
      Array<{
        id: string;
        description: string;
        privateComment?: string | null;
        startDate?: string | null;
        expectedEndDate?: string | null;
        actualEndDate?: string | null;
        status: string;
        priority: number;
        orderNumber: number;
        assignee?: { id: string; email: string } | null;
        companyOwnerContact?: { id: string; firstName: string; lastName: string; society?: { name: string } | null } | null;
      }>
    >('/tasks/kanban', { token });
  },

  createTask(
    token: string,
    payload: {
      projectId: string;
      description: string;
      privateComment?: string;
      startDate?: string;
      expectedEndDate?: string;
      actualEndDate?: string;
      priority: number;
      orderNumber?: number;
      status?: string;
      dueDate?: string;
      assigneeId?: string;
      companyOwnerContactId?: string;
      visibleToClient: boolean;
    },
  ) {
    return request('/tasks', { method: 'POST', token, body: payload });
  },

  updateTask(
    token: string,
    taskId: string,
    payload: {
      projectId?: string;
      projectPhaseId?: string | null;
      description?: string;
      privateComment?: string | null;
      startDate?: string | null;
      expectedEndDate?: string | null;
      actualEndDate?: string | null;
      priority?: number;
      orderNumber?: number;
      status?: string;
      dueDate?: string | null;
      assigneeId?: string | null;
      companyOwnerContactId?: string | null;
      visibleToClient?: boolean;
    },
  ) {
    return request(`/tasks/${taskId}`, { method: 'PATCH', token, body: payload });
  },

  deleteTask(token: string, taskId: string) {
    return request<{ success: boolean }>(`/tasks/${taskId}`, { method: 'DELETE', token });
  },

  listEvents(token: string) {
    return request<Array<{ id: string; title: string; eventType: string; startAt: string; endAt: string }>>('/calendar/events', {
      token,
    });
  },

  listCalendarFeed(token: string) {
    return request<{
      activeWorkspaceId: string;
      items: Array<{
        id: string;
        title: string;
        start: string;
        end: string;
        allDay: boolean;
        source: 'EVENT' | 'TASK' | 'TIMESHEET' | string;
        workspaceId: string;
        workspaceName: string;
      }>;
    }>('/calendar/feed', { token });
  },

  createEvent(
    token: string,
    payload: {
      title: string;
      eventType: string;
      startAt: string;
      endAt: string;
      description?: string;
      visioLink?: string;
    },
  ) {
    return request('/calendar/events', { method: 'POST', token, body: payload });
  },

  exportWeeklyIcs(token: string) {
    return request<string>('/calendar/exports/weekly.ics', { token, isText: true });
  },

  listEmails(token: string) {
    return request<Array<{ id: string; subject: string; fromAddress: string; receivedAt: string }>>('/emails', { token });
  },

  linkEmail(
    token: string,
    payload: {
      externalMessageId: string;
      fromAddress: string;
      toAddresses: string[];
      subject: string;
      projectId?: string;
    },
  ) {
    return request('/emails/link', { method: 'POST', token, body: payload });
  },

  syncEmails(token: string) {
    return request<{ synced: number }>('/emails/sync', { method: 'POST', token });
  },

  listDocuments(token: string) {
    return request<Array<{ id: string; title: string; status: string; storagePath: string }>>('/documents', { token });
  },

  createDocument(
    token: string,
    payload: { title: string; storagePath: string; projectId?: string; societyId?: string; contactId?: string },
  ) {
    return request('/documents', { method: 'POST', token, body: payload });
  },

  uploadDocument(
    token: string,
    payload: {
      file: File;
      title: string;
      projectId?: string;
      societyId?: string;
      contactId?: string;
    },
  ) {
    const form = new FormData();
    form.append('file', payload.file);
    form.append('title', payload.title);
    if (payload.projectId) form.append('projectId', payload.projectId);
    if (payload.societyId) form.append('societyId', payload.societyId);
    if (payload.contactId) form.append('contactId', payload.contactId);
    return uploadWithAuth('/documents/upload', token, form);
  },

  sendForSignature(
    token: string,
    id: string,
    payload: { signerEmail: string; signerName: string; provider?: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK' },
  ) {
    return request(`/documents/${id}/send-signature`, { method: 'POST', token, body: payload });
  },

  signDocument(token: string, id: string, certificate: string) {
    return request(`/documents/${id}/sign`, { method: 'PATCH', token, body: { certificate } });
  },

  financeKpis(token: string) {
    return request<{ billedRevenue: number; collectedRevenue: number; estimatedMargin: number }>('/finance/kpis', { token });
  },

  listFinanceDocuments(token: string) {
    return request<Array<{ id: string; reference: string; type: string; amount: string; status: string }>>('/finance/documents', {
      token,
    });
  },

  createFinanceDocument(
    token: string,
    payload: { projectId: string; type: 'QUOTE' | 'INVOICE'; reference: string; amount: string; status: string; dueDate?: string },
  ) {
    return request('/finance/documents', { method: 'POST', token, body: payload });
  },

  listTimesheet(token: string) {
    return request<Array<{ id: string; minutesSpent: number; entryDate: string; project: { name: string } }>>('/timesheet', { token });
  },

  timesheetTotals(token: string) {
    return request<{ totalMinutes: number; totalHours: number; collaboratorsCount: number; projectsCount: number }>('/timesheet/totals', {
      token,
    });
  },

  createTimeEntry(
    token: string,
    payload: { projectId: string; minutesSpent: number; entryDate: string; phaseId?: string; taskId?: string },
  ) {
    return request('/timesheet', { method: 'POST', token, body: payload });
  },

  listWorkspaces(token: string) {
    return request<Array<{ workspace: { id: string; name: string }; role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER'; isDefault: boolean }>>('/workspaces', { token });
  },

  createWorkspace(token: string, payload: { name: string }) {
    return request<{ id: string; name: string }>('/workspaces', { method: 'POST', token, body: payload });
  },

  switchWorkspace(token: string, workspaceId: string) {
    return request<{ activeWorkspaceId: string; accessToken: string }>(`/workspaces/${workspaceId}/switch`, {
      method: 'POST',
      token,
    });
  },

  getWorkspaceSettings(token: string) {
    return request<{
      imapHost?: string | null;
      imapPort?: number | null;
      imapUser?: string | null;
      projectTypologies?: string[] | null;
      signatureProvider?: string | null;
      signatureApiBaseUrl?: string | null;
    }>('/workspaces/settings/current', { token });
  },

  updateWorkspaceSettings(
    token: string,
    payload: {
      imapHost?: string;
      imapPort?: number;
      imapUser?: string;
      imapPassword?: string;
      projectTypologies?: string[];
      signatureProvider?: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';
      signatureApiBaseUrl?: string;
      signatureApiKey?: string;
    },
  ) {
    return request('/workspaces/settings/current', { method: 'POST', token, body: payload });
  },

  listUsers(token: string) {
    return request<Array<{ user: { id: string; email: string; firstName?: string | null; lastName?: string | null }; role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER'; isDefault: boolean }>>('/users', { token });
  },

  updateUser(
    token: string,
    userId: string,
    payload: {
      firstName?: string | null;
      lastName?: string | null;
      role?: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
    },
  ) {
    return request(`/users/${userId}`, { method: 'PATCH', token, body: payload });
  },

  createUser(
    token: string,
    payload: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
    },
  ) {
    return request<{
      user: { id: string; email: string; firstName?: string | null; lastName?: string | null };
      role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
      isDefault: boolean;
      twoFactorProvisioning?: { secret: string; otpauth: string };
    }>('/users', { method: 'POST', token, body: payload });
  },

  getUserTwoFactorProvisioning(token: string, userId: string) {
    return request<{
      userId: string;
      email: string;
      twoFactorEnabled: boolean;
      secret: string;
      otpauth: string;
    }>(`/users/${userId}/2fa-provisioning`, { token });
  },

  listAudit(token: string, page = 1, pageSize = 25) {
    return request<{
      items: Array<{
        id: string;
        action: string;
        createdAt: string;
        user?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/audit?page=${page}&pageSize=${pageSize}`, { token });
  },
};
