import { DashboardPayload, WorkspaceDashboardOverviewPayload } from '@/types/api';
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

async function fetchBlobWithAuth(path: string, token: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    let serverMessage: string | undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { message?: string | string[] };
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
    throw new ApiError(message, response.status);
  }

  return response.blob();
}

export const apiClient = {
  register(email: string, password: string, workspaceName: string) {
    return request<{ tokens: AuthTokens; workspace: { id: string; name: string }; twoFactorProvisioning: { otpauth: string } }>('/auth/register', {
      method: 'POST',
      body: { email, password, workspaceName },
    });
  },

  login(email: string, password: string) {
    return request<{ tokens: AuthTokens; activeWorkspaceId: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },

  logout(token: string) {
    return request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
      token,
    });
  },

  dashboard(token: string) {
    return request<DashboardPayload>('/dashboard/homepage', { token });
  },

  dashboardWorkspacesOverview(token: string) {
    return request<WorkspaceDashboardOverviewPayload>('/dashboard/workspaces-overview', { token });
  },

  listSocieties(token: string) {
    return request<
      Array<{
        id: string;
        name: string;
        createdAt?: string;
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

  listSocietiesAll(token: string) {
    return request<
      Array<{
        id: string;
        name: string;
        createdAt?: string;
        legalForm?: string | null;
        siren?: string | null;
        siret?: string | null;
        addressLine1?: string | null;
        addressLine2?: string | null;
        postalCode?: string | null;
        city?: string | null;
        country?: string | null;
      }>
    >('/crm/societies/all', { token });
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

  listContactsAll(token: string) {
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
    >('/crm/contacts/all', {
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
    return request<
      Array<{
        id: string;
        name: string;
        progressPercent: number;
        missionType?: string | null;
        societyId?: string;
        society?: { id: string; name: string } | null;
      }>
    >('/projects', { token });
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

  listProjectContacts(token: string, projectId: string) {
    return request<
      Array<{
        projectId: string;
        contactId: string;
        projectRole?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
        contact: {
          id: string;
          firstName: string;
          lastName: string;
          email?: string | null;
          phone?: string | null;
          role?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' | null;
          society?: { id: string; name: string } | null;
        };
      }>
    >(`/projects/${projectId}/contacts`, { token });
  },

  addProjectContact(
    token: string,
    projectId: string,
    payload: { contactId: string; projectRole?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' },
  ) {
    return request(`/projects/${projectId}/contacts`, { method: 'POST', token, body: payload });
  },

  updateProjectContact(
    token: string,
    projectId: string,
    contactId: string,
    payload: { projectRole?: 'DECIDEUR' | 'N_MINUS_1' | 'OPERATIONNEL' },
  ) {
    return request(`/projects/${projectId}/contacts/${contactId}`, { method: 'PATCH', token, body: payload });
  },

  removeProjectContact(token: string, projectId: string, contactId: string) {
    return request<{ success: boolean }>(`/projects/${projectId}/contacts/${contactId}`, { method: 'DELETE', token });
  },

  listKanban(token: string) {
    return request<
      Array<{
        id: string;
        projectId: string;
        description: string;
        privateComment?: string | null;
        startDate?: string | null;
        expectedEndDate?: string | null;
        actualEndDate?: string | null;
        startsAfterTaskId?: string | null;
        planningStartDate?: string | null;
        plannedDurationDays?: number | null;
        overrunDays?: number;
        planningEndDate?: string | null;
        progressPercent?: number;
        fte?: number;
        status: string;
        priority: number;
        orderNumber: number;
        project?: { id: string; name: string } | null;
        linkedEmails?: Array<{
          email: {
            id: string;
            subject: string;
            fromAddress: string;
            receivedAt: string;
          };
        }>;
        assignee?: { id: string; email: string } | null;
        companyOwnerContact?: { id: string; firstName: string; lastName: string; society?: { name: string } | null } | null;
        startsAfterTask?: { id: string; description: string } | null;
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
      startsAfterTaskId?: string | null;
      planningStartDate?: string | null;
      plannedDurationDays?: number | null;
      overrunDays?: number;
      planningEndDate?: string | null;
      progressPercent?: number;
      fte?: number;
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
        taskStatus?: string;
        url: string;
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

  updateEvent(
    token: string,
    eventId: string,
    payload: {
      title?: string;
      eventType?: string;
      startAt?: string;
      endAt?: string;
      description?: string;
      visioLink?: string;
    },
  ) {
    return request(`/calendar/events/${eventId}`, { method: 'PATCH', token, body: payload });
  },

  deleteEvent(token: string, eventId: string) {
    return request<{ success: boolean }>(`/calendar/events/${eventId}`, { method: 'DELETE', token });
  },

  exportWeeklyIcs(token: string) {
    return request<string>('/calendar/exports/weekly.ics', { token, isText: true });
  },

  listEmails(token: string) {
    return request<
      Array<{
        id: string;
        externalMessageId: string;
        subject: string;
        fromAddress: string;
        toAddresses: string[];
        receivedAt: string;
        metadata?: {
          preview?: string;
          attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
          documentsSaved?: boolean;
        } | null;
        project?: { id: string; name: string } | null;
        tasks: Array<{ taskId: string }>;
      }>
    >('/emails', { token });
  },

  listLinkedEmails(token: string) {
    return request<
      Array<{
        id: string;
        externalMessageId: string;
        subject: string;
        fromAddress: string;
        toAddresses: string[];
        receivedAt: string;
        metadata?: {
          preview?: string;
          attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
        } | null;
        workspace: { id: string; name: string };
        project: { id: string; name: string } | null;
        tasks: Array<{
          task: {
            id: string;
            description: string;
            projectId: string;
          };
        }>;
      }>
    >('/emails/linked', { token });
  },

  listUnassignedInboxEmails(token: string) {
    return request<
      Array<{
        id: string;
        externalMessageId: string;
        subject: string;
        fromAddress: string;
        toAddresses: string[];
        receivedAt: string;
        metadata?: { preview?: string } | null;
        workspace: { id: string; name: string };
      }>
    >('/emails/inbox/unassigned', { token });
  },

  listIgnoredInboxEmails(token: string) {
    return request<
      Array<{
        id: string;
        externalMessageId: string;
        subject: string;
        fromAddress: string;
        toAddresses: string[];
        receivedAt: string;
        metadata?: { preview?: string } | null;
        workspace: { id: string; name: string };
      }>
    >('/emails/inbox/ignored', { token });
  },

  getEmailContent(token: string, emailId: string) {
    return request<{
      subject: string;
      fromAddress: string;
      toAddresses: string[];
      receivedAt: string;
      text: string;
      attachments: Array<{
        filename: string;
        contentType: string;
        size: number;
      }>;
    }>(`/emails/${emailId}/content`, { token });
  },

  listInboxCatalog(
    token: string,
  ) {
    return request<
      Array<{
        id: string;
        name: string;
        projects: Array<{
          id: string;
          name: string;
          tasks: Array<{ id: string; description: string }>;
        }>;
      }>
    >('/emails/inbox/catalog', { token });
  },

  linkEmail(
    token: string,
    payload: {
      externalMessageId: string;
      fromAddress: string;
      toAddresses: string[];
      subject: string;
      projectId?: string;
      taskId?: string;
    },
  ) {
    return request('/emails/link', { method: 'POST', token, body: payload });
  },

  linkInboxEmail(
    token: string,
    payload: {
      emailId: string;
      workspaceId: string;
      projectId?: string;
      taskId?: string;
      externalMessageId: string;
      fromAddress: string;
      toAddresses: string[];
      subject: string;
    },
  ) {
    return request('/emails/inbox/link', { method: 'POST', token, body: payload });
  },

  ignoreInboxEmail(token: string, emailId: string) {
    return request<{ ignored: boolean }>(`/emails/inbox/${emailId}/ignore`, {
      method: 'POST',
      token,
    });
  },

  unignoreInboxEmail(token: string, emailId: string) {
    return request<{ restored: boolean }>(`/emails/inbox/${emailId}/unignore`, {
      method: 'POST',
      token,
    });
  },

  syncEmails(token: string) {
    return request<{ synced: number }>('/emails/sync', { method: 'POST', token });
  },

  saveEmailAttachments(token: string, emailId: string) {
    return request<{ saved: boolean; alreadySaved: boolean; importedCount: number }>(
      `/emails/${emailId}/attachments/save`,
      { method: 'POST', token },
    );
  },

  listDocuments(token: string) {
    return request<
      Array<{
        id: string;
        title: string;
        status: string;
        storagePath: string;
        canView?: boolean;
        createdAt: string;
        project?: { id: string; name: string } | null;
        task?: { id: string; description: string } | null;
      }>
    >('/documents', { token });
  },

  createDocument(
    token: string,
    payload: { title: string; storagePath: string; projectId?: string; taskId?: string; societyId?: string; contactId?: string },
  ) {
    return request('/documents', { method: 'POST', token, body: payload });
  },

  uploadDocument(
    token: string,
    payload: {
      file: File;
      title?: string;
      projectId?: string;
      taskId?: string;
      societyId?: string;
      contactId?: string;
    },
  ) {
    const form = new FormData();
    form.append('file', payload.file);
    if (payload.title) form.append('title', payload.title);
    if (payload.projectId) form.append('projectId', payload.projectId);
    if (payload.taskId) form.append('taskId', payload.taskId);
    if (payload.societyId) form.append('societyId', payload.societyId);
    if (payload.contactId) form.append('contactId', payload.contactId);
    return uploadWithAuth('/documents/upload', token, form);
  },

  updateDocument(
    token: string,
    id: string,
    payload: { title: string },
  ) {
    return request(`/documents/${id}`, { method: 'PATCH', token, body: payload });
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

  archiveDocument(token: string, id: string) {
    return request(`/documents/${id}/archive`, { method: 'PATCH', token });
  },

  deleteDocument(token: string, id: string) {
    return request<{ success: boolean }>(`/documents/${id}`, { method: 'DELETE', token });
  },

  viewDocumentBlob(token: string, id: string) {
    return fetchBlobWithAuth(`/documents/${id}/view`, token);
  },

  financeKpis(token: string, projectId?: string) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return request<{ billedRevenue: number; collectedRevenue: number; pendingRevenue: number; estimatedMargin: number }>(`/finance/kpis${query}`, { token });
  },

  listFinanceDocuments(token: string) {
    return request<
      Array<{
        id: string;
        reference: string;
        type: string;
        amount: string;
        status: string;
        project?: { id: string; name: string } | null;
      }>
    >('/finance/documents', {
      token,
    });
  },

  financeOverview(token: string, projectId?: string) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return request<
      Array<{
        quote: {
          id: string;
          projectId: string;
          projectName: string;
          name: string;
          reference: string;
          accountingRef?: string | null;
          amount: number;
          status: string;
          issuedAt: string;
          dueDate?: string | null;
        };
        totals: {
          paidInvoicesTotal: number;
          pendingInvoicesTotal: number;
        };
        invoices: Array<{
          id: string;
          name: string;
          reference: string;
          accountingRef?: string | null;
          amount: number;
          status: string;
          invoiceIndex?: number | null;
          issuedAt: string;
          dueDate?: string | null;
          paidAt?: string | null;
        }>;
      }>
    >(`/finance/overview${query}`, { token });
  },

  createQuote(
    token: string,
    payload: { projectId: string; amount: string; issuedAt?: string; dueDate?: string },
  ) {
    return request('/finance/quotes', { method: 'POST', token, body: payload });
  },

  createInvoice(
    token: string,
    payload: {
      quoteId: string;
      amount: string;
      issuedAt?: string;
      dueDate?: string;
      status?: 'PENDING' | 'PAID';
      accountingRef?: string;
    },
  ) {
    return request('/finance/invoices', { method: 'POST', token, body: payload });
  },

  updateFinanceDocument(
    token: string,
    documentId: string,
    payload: {
      name?: string;
      amount?: string;
      issuedAt?: string;
      dueDate?: string | null;
      status?: 'OPEN' | 'PENDING' | 'PAID' | 'CANCELLED';
      paidAt?: string | null;
      accountingRef?: string | null;
    },
  ) {
    return request(`/finance/documents/${documentId}`, { method: 'PATCH', token, body: payload });
  },

  listTimesheet(token: string) {
    return request<Array<{ id: string; minutesSpent: number; entryDate: string; taskId?: string | null; project: { id: string; name: string } }>>('/timesheet', { token });
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
    return request<
      Array<{
        workspace: { id: string; name: string };
        role: 'ADMIN' | 'COLLABORATOR' | 'VIEWER';
        isDefault: boolean;
        associatedSocietyId: string | null;
        associatedSocietyName: string | null;
      }>
    >('/workspaces', { token });
  },

  createWorkspace(token: string, payload: { name: string; associatedSocietyId: string }) {
    return request<{ id: string; name: string }>('/workspaces', { method: 'POST', token, body: payload });
  },

  switchWorkspace(token: string, workspaceId: string) {
    return request<{ activeWorkspaceId: string; accessToken: string }>(`/workspaces/${workspaceId}/switch`, {
      method: 'POST',
      token,
    });
  },

  updateWorkspace(
    token: string,
    workspaceId: string,
    payload: { name?: string; associatedSocietyId?: string },
  ) {
    return request<{ workspace: { id: string; name: string } | null; associatedSocietyId: string | null }>(
      `/workspaces/${workspaceId}`,
      {
        method: 'PATCH',
        token,
        body: payload,
      },
    );
  },

  deleteWorkspace(token: string, workspaceId: string, confirmation = 'SUPPRESSION') {
    return request<{ deleted: boolean; workspaceId: string }>(`/workspaces/${workspaceId}/delete`, {
      method: 'POST',
      token,
      body: { confirmation },
    });
  },

  getWorkspaceSettings(token: string) {
    return request<{
      associatedSocietyId?: string | null;
      workspaceName?: string | null;
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
      associatedSocietyId?: string;
      workspaceName?: string;
      signatureProvider?: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';
      signatureApiBaseUrl?: string;
      signatureApiKey?: string;
    },
    ) {
    return request('/workspaces/settings/current', { method: 'POST', token, body: payload });
  },

  listWorkspaceNotes(token: string) {
    return request<
      Array<{
        id: string;
        content: string;
        createdAt: string;
        author: {
          id: string;
          email: string;
          firstName?: string | null;
          lastName?: string | null;
        } | null;
      }>
    >('/workspaces/notes/current', { token });
  },

  listWorkspaceNotesAll(token: string) {
    return request<
      Array<{
        id: string;
        workspace: { id: string; name: string } | null;
        content: string;
        createdAt: string;
        author: {
          id: string;
          email: string;
          firstName?: string | null;
          lastName?: string | null;
        } | null;
      }>
    >('/workspaces/notes/all', { token });
  },

  appendWorkspaceNote(token: string, content: string) {
    return request<{ success: boolean }>('/workspaces/notes/current', {
      method: 'POST',
      token,
      body: { content },
    });
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
