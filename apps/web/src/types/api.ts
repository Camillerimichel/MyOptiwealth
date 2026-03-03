export interface DashboardPayload {
  tasksToday: Array<{ id: string; description: string; priority: number }>;
  globalKpis: {
    billedRevenue: number;
    collectedRevenue: number;
    estimatedMargin: number;
  };
  calendarPreview: Array<{ id: string; title: string; startAt: string }>;
}
