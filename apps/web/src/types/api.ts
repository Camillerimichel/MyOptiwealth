export interface DashboardPayload {
  tasksToday: Array<{ id: string; description: string; priority: number }>;
  globalKpis: {
    billedRevenue: number;
    collectedRevenue: number;
    estimatedMargin: number;
  };
  calendarPreview: Array<{ id: string; title: string; startAt: string }>;
}

export interface WorkspaceDashboardOverviewItem {
  workspace: { id: string; name: string };
  projectCount: number;
  progressPercent: number;
  taskStats: {
    todo: number;
    inProgress: number;
    waiting: number;
    done: number;
    total: number;
  };
  finance: {
    billedRevenue: number;
    collectedRevenue: number;
    remainingRevenue: number;
  };
}

export interface WorkspaceDashboardOverviewPayload {
  summary: {
    billedRevenue: number;
    collectedRevenue: number;
    remainingRevenue: number;
  };
  upcomingTasks: Array<{
    id: string;
    description: string;
    dueDate: string | null;
    priority: number;
    status: string;
    workspace: { id: string; name: string };
    project: { id: string; name: string };
  }>;
  workspaces: WorkspaceDashboardOverviewItem[];
}
