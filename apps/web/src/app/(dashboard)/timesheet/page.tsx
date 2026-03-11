'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearActiveProjectContext,
  clearActiveTaskContext,
  getActiveProjectContext,
  getActiveTaskContext,
} from '@/lib/active-task';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';

type Project = { id: string; name: string; progressPercent: number; missionType?: string | null };
type TaskWorkflowStatus = 'TODO' | 'IN_PROGRESS' | 'WAITING' | 'DONE';
type Task = {
  id: string;
  projectId: string;
  description: string;
  orderNumber: number;
  priority: number;
  planningStartDate?: string | null;
  plannedDurationDays?: number | null;
  overrunDays?: number;
  planningEndDate?: string | null;
  startsAfterTaskId?: string | null;
  progressPercent?: number;
  fte?: number;
  status: TaskWorkflowStatus;
};

type TaskPlanState = {
  startsAfterTaskId: string;
  startDate: string;
  durationDays: number;
  overrunDays: number;
  progressPercent: number;
  fte: number;
  status: TaskWorkflowStatus;
};

type SortKey = 'default' | 'start' | 'end' | 'progress';
type TimesheetView = 'saisie' | 'gantt';
type TaskDateLogAction = 'load' | 'sync' | 'save';
type TaskDateLogLevel = 'info' | 'warn' | 'error';
type TaskDateLogRow = {
  id: number;
  at: string;
  action: TaskDateLogAction;
  level: TaskDateLogLevel;
  taskId: string;
  taskName: string;
  source: 'saisie' | 'planning' | 'computed' | 'sync' | 'api';
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  message: string;
};

const LEGACY_MISSION_LABELS: Record<string, string> = {
  WEALTH_STRATEGY: 'Strategie patrimoniale',
  SUCCESSION: 'Succession',
  CORPORATE_FINANCE: 'Finance d entreprise',
};

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function parseDateFromInput(value: string): Date | null {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateForInput(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function addBusinessDays(start: Date, businessDays: number): Date {
  const result = new Date(start.getTime());
  if (businessDays <= 0) return result;
  let remaining = businessDays;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isWeekend(result)) {
      remaining -= 1;
    }
  }
  return result;
}

function businessDaysBetween(start: Date, end: Date): number {
  if (end < start) return 0;
  const cursor = new Date(start.getTime());
  let days = 0;
  while (cursor <= end) {
    if (!isWeekend(cursor)) {
      days += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function todayUtcDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcDayDiff(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((toUtc - fromUtc) / msPerDay);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isEndOfMonth(date: Date): boolean {
  return date.getUTCMonth() !== addUtcDays(date, 1).getUTCMonth();
}

export default function TimesheetPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [planByTaskId, setPlanByTaskId] = useState<Record<string, TaskPlanState>>({});

  const [projectId, setProjectId] = useState('');
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(null);
  const [activeProjectTypology, setActiveProjectTypology] = useState<string | null>(null);
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortByStartDateMode, setSortByStartDateMode] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<TimesheetView>('saisie');
  const [ganttDayWidth, setGanttDayWidth] = useState(10);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [lastSavedPlanByTaskId, setLastSavedPlanByTaskId] = useState<Record<string, TaskPlanState>>({});
  const [taskDateLogs, setTaskDateLogs] = useState<TaskDateLogRow[]>([]);

  const planByTaskIdRef = useRef<Record<string, TaskPlanState>>({});
  const computedRef = useRef<Map<string, { start: Date | null; end: Date | null; duration: number; overrun: number; effectiveDuration: number; progress: number; fte: number }>>(new Map());
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const pushTaskDateLogs = useCallback((entries: Array<Omit<TaskDateLogRow, 'id' | 'at'>>): void => {
    setTaskDateLogs((prev) => {
      const now = Date.now();
      const mapped = entries.map((entry, index) => ({
        id: Number(`${now}${index}`),
        at: new Date().toISOString(),
        ...entry,
      }));
      return [...mapped, ...prev].slice(0, 120);
    });
  }, []);

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
      const [projectsData, tasksData, workspacesData] = await Promise.all([
        apiClient.listProjects(token),
        apiClient.listKanban(token),
        apiClient.listWorkspaces(token),
      ]);

      const dbLoadLogs = tasksData
        .filter((task) => task.planningStartDate || task.planningEndDate || task.plannedDurationDays)
        .slice(0, 6)
        .map((task) => ({
          action: 'load' as const,
          level: 'info' as const,
          taskId: task.id,
          taskName: task.description,
          source: 'api' as const,
          startDate: toDateInputValue(task.planningStartDate ?? ''),
          endDate: toDateInputValue(task.planningEndDate ?? ''),
          durationDays: task.plannedDurationDays ?? 0,
          message: task.planningStartDate || task.planningEndDate
            ? 'Ligne date chargée depuis la base.'
            : 'Aucune date planifiée.',
        }));
      if (dbLoadLogs.length > 0) {
        pushTaskDateLogs(dbLoadLogs);
      }

      setProjects(projectsData);
      setTasks(tasksData.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        description: task.description,
        orderNumber: task.orderNumber,
        priority: task.priority,
        planningStartDate: task.planningStartDate,
        plannedDurationDays: task.plannedDurationDays,
        overrunDays: task.overrunDays,
        planningEndDate: task.planningEndDate,
        startsAfterTaskId: task.startsAfterTaskId,
        progressPercent: task.progressPercent,
        fte: task.fte,
        status: (task.status as TaskWorkflowStatus) ?? 'TODO',
      })));

      setPlanByTaskId((prev) => {
        const next: Record<string, TaskPlanState> = {};
        for (const task of tasksData) {
          next[task.id] = {
            startsAfterTaskId: task.startsAfterTaskId ?? '',
            startDate: task.planningStartDate ? toDateInputValue(task.planningStartDate) : (prev[task.id]?.startDate ?? ''),
            durationDays: task.plannedDurationDays ?? prev[task.id]?.durationDays ?? 5,
            overrunDays: task.overrunDays ?? prev[task.id]?.overrunDays ?? 0,
            progressPercent: task.progressPercent ?? prev[task.id]?.progressPercent ?? 0,
            fte: task.fte ?? prev[task.id]?.fte ?? 1,
            status: (task.status as TaskWorkflowStatus) ?? prev[task.id]?.status ?? 'TODO',
          };
        }
        setLastSavedPlanByTaskId(next);
        return next;
      });

      const workspaceId = typeof window !== 'undefined'
        ? window.localStorage.getItem('mw_active_workspace_id')
        : null;
      const workspaceName = workspacesData.find((item) => item.workspace.id === workspaceId)?.workspace.name ?? null;
      setActiveWorkspaceName(workspaceName);

      const activeProject = getActiveProjectContext();
      if (activeProject && projectsData.some((project) => project.id === activeProject.projectId)) {
        const selectedProject = projectsData.find((project) => project.id === activeProject.projectId);
        setProjectId(activeProject.projectId);
        setActiveProjectTitle(activeProject.projectTitle);
        setActiveProjectTypology(
          activeProject.projectTypology
          ?? (selectedProject?.missionType ? (LEGACY_MISSION_LABELS[selectedProject.missionType] ?? selectedProject.missionType) : null),
        );
        const activeTask = getActiveTaskContext();
        if (activeTask && activeTask.projectId === activeProject.projectId) {
          setActiveTaskLabel(activeTask.taskDescription);
        } else {
          setActiveTaskLabel(null);
        }
      } else {
        setProjectId('');
        setActiveProjectTitle(null);
        setActiveProjectTypology(null);
        setActiveTaskLabel(null);
      }
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
    const onWorkspaceChanged = (): void => {
      void load();
    };
    const onTaskChanged = (): void => {
      void load();
    };
    const onProjectChanged = (): void => {
      void load();
    };
    window.addEventListener('mw_workspace_changed', onWorkspaceChanged);
    window.addEventListener('mw_active_task_changed', onTaskChanged);
    window.addEventListener('mw_active_project_changed', onProjectChanged);
    return () => {
      window.removeEventListener('mw_workspace_changed', onWorkspaceChanged);
      window.removeEventListener('mw_active_task_changed', onTaskChanged);
      window.removeEventListener('mw_active_project_changed', onProjectChanged);
    };
  }, [load]);

  useEffect(() => {
    setSortByStartDateMode(false);
    setSortKey('default');
    setSortDirection('asc');
  }, [projectId]);

  const onToggleSort = useCallback((key: SortKey, preferredDirection: 'asc' | 'desc' = 'asc') => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection(preferredDirection);
      return;
    }
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  }, [sortKey]);

  const projectTasks = useMemo(
    () => tasks
      .filter((task) => task.projectId === projectId)
      .sort((a, b) => a.orderNumber - b.orderNumber),
    [tasks, projectId],
  );

  const getTaskPlan = useCallback((taskId: string): TaskPlanState => {
    const current = planByTaskId[taskId];
    return current ?? {
      startsAfterTaskId: '',
      startDate: '',
      durationDays: 5,
      overrunDays: 0,
      progressPercent: 0,
      fte: 1,
      status: 'TODO',
    };
  }, [planByTaskId]);

  const updateTaskPlan = useCallback((taskId: string, patch: Partial<TaskPlanState>): void => {
    setSortByStartDateMode(true);
    setPlanByTaskId((prev) => {
      const current = prev[taskId] ?? {
        startsAfterTaskId: '',
        startDate: '',
        durationDays: 5,
        overrunDays: 0,
        progressPercent: 0,
        fte: 1,
        status: 'TODO',
      };
      return {
        ...prev,
        [taskId]: {
          ...current,
          ...patch,
        },
      };
    });
  }, []);

  const today = todayUtcDate();

  const computed = useMemo(() => {
    const taskMap = new Map(projectTasks.map((task) => [task.id, task]));
    const memo = new Map<string, { start: Date | null; end: Date | null; duration: number; overrun: number; effectiveDuration: number; progress: number; fte: number }>();

    const computeOne = (taskId: string, stack: Set<string>): { start: Date | null; end: Date | null; duration: number; overrun: number; effectiveDuration: number; progress: number; fte: number } => {
      if (memo.has(taskId)) {
        return memo.get(taskId)!;
      }
      const task = taskMap.get(taskId);
      if (!task) {
        return { start: null, end: null, duration: 5, overrun: 0, effectiveDuration: 5, progress: 0, fte: 1 };
      }

      const cfg = getTaskPlan(taskId);
      const planningStart = parseDateFromInput(toDateInputValue(task.planningStartDate));
      const planningEnd = parseDateFromInput(toDateInputValue(task.planningEndDate));
      const hasPlanningRange = Boolean(planningStart && planningEnd && planningEnd >= planningStart);
      const cfgStart = parseDateFromInput(cfg.startDate);
      const baseDuration = Number(cfg.durationDays || task.plannedDurationDays || 5);
      const duration = Math.max(1, baseDuration);
      const overrun = Math.max(0, Number(cfg.overrunDays || 0));
      const derivedDurationFromPlanning = hasPlanningRange && planningStart && planningEnd
        ? businessDaysBetween(planningStart, planningEnd)
        : duration;
      const plannedDuration = Math.max(1, derivedDurationFromPlanning);
      const effectiveDuration = plannedDuration + overrun;
      const progress = Math.min(100, Math.max(0, Number(cfg.progressPercent || 0)));
      const fte = Math.max(0.1, Number(cfg.fte || 1));

      let proposedStartFromDependency: Date | null = null;
      if (cfg.startsAfterTaskId && cfg.startsAfterTaskId !== taskId && taskMap.has(cfg.startsAfterTaskId) && !stack.has(cfg.startsAfterTaskId)) {
        const nextStack = new Set(stack);
        nextStack.add(taskId);
        const predecessor = computeOne(cfg.startsAfterTaskId, nextStack);
        if (predecessor.end) {
          proposedStartFromDependency = addBusinessDays(predecessor.end, 1);
        }
      }

      const start = cfgStart ?? proposedStartFromDependency ?? planningStart ?? null;
      let effective = plannedDuration;
      let end: Date | null = null;
      if (start) {
        if (!cfg.startsAfterTaskId && !cfg.startDate && hasPlanningRange && planningStart) {
          end = planningEnd ? addBusinessDays(planningEnd, overrun) : null;
          effective = effectiveDuration;
        } else {
          end = addBusinessDays(start, effective - 1);
        }
      }
      const value = { start, end, duration: effective, overrun, effectiveDuration, progress, fte };
      memo.set(taskId, value);
      return value;
    };

    for (const task of projectTasks) {
      computeOne(task.id, new Set());
    }

    return memo;
  }, [projectTasks, getTaskPlan]);

  useEffect(() => {
    planByTaskIdRef.current = planByTaskId;
  }, [planByTaskId]);

  useEffect(() => {
    computedRef.current = computed;
  }, [computed]);

  const projectSummary = useMemo(() => {
    if (projectTasks.length === 0) {
      return {
        progressPercent: 0,
        plannedEndDate: null as Date | null,
        lateTasks: 0,
        lateDays: 0,
      };
    }

    let weightedDone = 0;
    let weightedTotal = 0;
    let plannedEndDate: Date | null = null;
    let lateTasks = 0;
    let lateDays = 0;

    for (const task of projectTasks) {
      const data = computed.get(task.id);
      if (!data) continue;
      const weight = data.effectiveDuration * data.fte;
      weightedTotal += weight;
      weightedDone += weight * (data.progress / 100);
      if (data.end && (!plannedEndDate || data.end > plannedEndDate)) {
        plannedEndDate = data.end;
      }

      if (data.start && data.end) {
        const elapsedDays = businessDaysBetween(data.start, today);
        const expectedProgress = Math.min(100, (elapsedDays / data.effectiveDuration) * 100);
        if (data.progress + 5 < expectedProgress) {
          lateTasks += 1;
        }
      }
      lateDays += data.overrun;
    }

    return {
      progressPercent: weightedTotal > 0 ? Math.round((weightedDone / weightedTotal) * 100) : 0,
      plannedEndDate,
      lateTasks,
      lateDays,
    };
  }, [projectTasks, computed, today]);

  const sortedProjectTasks = useMemo(() => {
    return [...projectTasks].sort((a, b) => {
      if (sortKey !== 'default') {
        const dir = sortDirection === 'asc' ? 1 : -1;
        const aData = computed.get(a.id);
        const bData = computed.get(b.id);

        if (sortKey === 'start') {
          const aValue = aData?.start?.getTime() ?? Number.POSITIVE_INFINITY;
          const bValue = bData?.start?.getTime() ?? Number.POSITIVE_INFINITY;
          if (aValue !== bValue) return (aValue - bValue) * dir;
        }

        if (sortKey === 'end') {
          const aValue = aData?.end?.getTime() ?? Number.POSITIVE_INFINITY;
          const bValue = bData?.end?.getTime() ?? Number.POSITIVE_INFINITY;
          if (aValue !== bValue) return (aValue - bValue) * dir;
        }

        if (sortKey === 'progress') {
          const aValue = aData?.progress ?? 0;
          const bValue = bData?.progress ?? 0;
          if (aValue !== bValue) return (aValue - bValue) * dir;
        }
      }

      if (!sortByStartDateMode && a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      const aStart = computed.get(a.id)?.start?.getTime() ?? Number.POSITIVE_INFINITY;
      const bStart = computed.get(b.id)?.start?.getTime() ?? Number.POSITIVE_INFINITY;
      if (aStart !== bStart) {
        return aStart - bStart;
      }
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.orderNumber - b.orderNumber;
    });
  }, [projectTasks, computed, sortByStartDateMode, sortKey, sortDirection]);

  const ganttItems = useMemo(() => {
    const items = sortedProjectTasks
      .map((task) => {
        const data = computed.get(task.id);
        const rawPlanningStart = parseDateFromInput(toDateInputValue(task.planningStartDate));
        const rawPlanningEnd = parseDateFromInput(toDateInputValue(task.planningEndDate));
        const planningHasRange = Boolean(rawPlanningStart && rawPlanningEnd && rawPlanningEnd >= rawPlanningStart);
        const rawDuration = Math.max(1, Number(task.plannedDurationDays || 5));
        const rawOverrun = Math.max(0, Number(task.overrunDays || 0));

        const cfg = getTaskPlan(task.id);
        const cfgDuration = Math.max(1, Number(cfg.durationDays || rawDuration));
        const cfgStart = parseDateFromInput(cfg.startDate);
        const plannedOverrunStart = planningHasRange ? rawPlanningStart : null;
        const plannedOverrunEnd = planningHasRange ? rawPlanningEnd : null;

        let start = data?.start ?? null;
        let end = data?.end ?? null;

        if (!start || !end) {
          if (cfg.startsAfterTaskId) {
            start = cfgStart ?? null;
          } else if (cfgStart) {
            start = cfgStart;
          } else if (plannedOverrunStart && plannedOverrunEnd) {
            start = plannedOverrunStart;
          } else if (cfgStart) {
            start = cfgStart;
          }

          if (start && !planningHasRange) {
            end = addBusinessDays(start, cfgDuration - 1 + rawOverrun);
          } else if (plannedOverrunStart && plannedOverrunEnd) {
            end = plannedOverrunEnd;
          }

          if (!end && start) {
            end = addBusinessDays(start, rawDuration - 1);
          }
        }

        if (start && end && plannedOverrunEnd && planningHasRange && end < plannedOverrunEnd) {
          end = plannedOverrunEnd;
        }

        if (!start || !end) return null;

        const progress = data?.progress ?? 0;
        const late = end < today && progress < 100;
        const started = progress > 0;
        return {
          id: task.id,
          description: task.description,
          start,
          end,
          progress,
          late,
          started,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (items.length === 0 && sortedProjectTasks.length > 0) {
      const fallbackDate = sortedProjectTasks.reduce((acc: Date | null, task) => {
        if (acc) {
          return acc;
        }
        return parseDateFromInput(toDateInputValue(task.planningStartDate)) ?? acc;
      }, null as Date | null);

      let cursor = fallbackDate ?? todayUtcDate();
      const fallbackItems = sortedProjectTasks.map((task) => {
        const cfg = getTaskPlan(task.id);
        const cfgStart = parseDateFromInput(cfg.startDate);
        const planningStart = parseDateFromInput(toDateInputValue(task.planningStartDate));
        const planningEnd = parseDateFromInput(toDateInputValue(task.planningEndDate));
        const hasPlanningRange = Boolean(planningStart && planningEnd && planningEnd >= planningStart);
        const start = planningStart ?? cfgStart ?? cursor;
        const duration = Math.max(1, Number(cfg.durationDays || task.plannedDurationDays || 5));
        const overrun = Math.max(0, Number(cfg.overrunDays || task.overrunDays || 0));
        const end = hasPlanningRange && planningEnd ? planningEnd : addBusinessDays(start, duration - 1 + overrun);
        cursor = addBusinessDays(end, 1);
        return {
          id: task.id,
          description: task.description,
          start,
          end,
          progress: Math.min(100, Math.max(0, Number(cfg.progressPercent || 0))),
          late: false,
          started: (cfg.progressPercent || 0) > 0,
        };
      });

      return {
        items: fallbackItems,
        minDate: fallbackItems[0].start,
        maxDate: fallbackItems[fallbackItems.length - 1].end,
      };
    }

    if (items.length === 0) {
      return {
        items,
        minDate: null as Date | null,
        maxDate: null as Date | null,
      };
    }

    let minDate = items[0].start;
    let maxDate = items[0].end;
    for (const item of items) {
      if (item.start < minDate) minDate = item.start;
      if (item.end > maxDate) maxDate = item.end;
    }

    return { items, minDate, maxDate };
  }, [sortedProjectTasks, computed, getTaskPlan, today]);

  const ganttTimeline = useMemo(() => {
    if (!ganttItems.minDate || !ganttItems.maxDate) return null;
    const start = addUtcDays(ganttItems.minDate, -2);
    const end = addUtcDays(ganttItems.maxDate, 2);
    const ticks: Date[] = [];
    for (let d = new Date(start.getTime()); d <= end; d = addUtcDays(d, 1)) {
      ticks.push(new Date(d.getTime()));
    }
    const totalDays = ticks.length;
    const width = totalDays * ganttDayWidth;
    const monthEndOffsets = ticks
      .map((d, i) => (isEndOfMonth(d) ? (i + 1) * ganttDayWidth : null))
      .filter((value): value is number => typeof value === 'number');
    const axisLabels = ticks
      .map((d, i) => ({ date: d, offset: i * ganttDayWidth }))
      .filter(({ date, offset }, idx) => (
        idx === 0
        || idx === ticks.length - 1
        || date.getUTCDay() === 1
        || date.getUTCDate() === 1
        || monthEndOffsets.includes(offset + ganttDayWidth)
      ));

    const todayOffsetRaw = utcDayDiff(start, today) * ganttDayWidth;
    const todayOffset = todayOffsetRaw >= 0 && todayOffsetRaw <= width ? todayOffsetRaw : null;

    return { start, end, ticks, totalDays, width, monthEndOffsets, axisLabels, todayOffset };
  }, [ganttItems.minDate, ganttItems.maxDate, ganttDayWidth, today]);

  useEffect(() => {
    if (view !== 'saisie' || !focusedTaskId) return;
    const timer = setTimeout(() => {
      const target = document.getElementById(`saisie-task-${focusedTaskId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [view, focusedTaskId]);

    const onSaveTaskPlan = useCallback(async (taskId: string): Promise<void> => {
    const token = getAccessToken();
    if (!token) return;

    const cfg = planByTaskIdRef.current[taskId];
    if (!cfg) return;

    const data = computedRef.current.get(taskId);
    const startDate = data?.start ? formatDateForInput(data.start) : '';
    const endDate = data?.end ? formatDateForInput(data.end) : '';

    if (!cfg.startsAfterTaskId && !startDate) {
      pushTaskDateLogs([{
        action: 'save',
        level: 'warn',
        taskId,
        taskName: projectTasks.find((task) => task.id === taskId)?.description ?? taskId,
        source: 'api',
        startDate,
        endDate,
        durationDays: Math.max(1, cfg.durationDays),
        message: "Impossible d'enregistrer: aucune date de départ saisie (sans dépendance).",
      }]);
      return;
    }

    try {
      pushTaskDateLogs([{
        action: 'save',
        level: 'info',
        taskId,
        taskName: projectTasks.find((task) => task.id === taskId)?.description ?? taskId,
        source: 'saisie',
        startDate,
        endDate,
        durationDays: cfg.durationDays,
        message: 'Tentative de sauvegarde des dates de tâche',
      }]);
      await apiClient.updateTask(token, taskId, {
        startsAfterTaskId: cfg.startsAfterTaskId || null,
        planningStartDate: startDate ? `${startDate}T00:00:00.000Z` : null,
        plannedDurationDays: Math.max(1, cfg.durationDays),
        overrunDays: Math.max(0, cfg.overrunDays),
        planningEndDate: endDate ? `${endDate}T00:00:00.000Z` : null,
        progressPercent: Math.min(100, Math.max(0, cfg.progressPercent)),
        fte: Math.max(0.1, cfg.fte),
        status: cfg.status,
      });
      setLastSavedPlanByTaskId((prev) => ({
        ...prev,
        [taskId]: {
          startsAfterTaskId: cfg.startsAfterTaskId,
          startDate: cfg.startDate,
          durationDays: Math.max(1, cfg.durationDays),
          overrunDays: Math.max(0, cfg.overrunDays),
          progressPercent: Math.min(100, Math.max(0, cfg.progressPercent)),
          fte: Math.max(0.1, cfg.fte),
          status: cfg.status,
        },
      }));
      pushTaskDateLogs([{
        action: 'save',
        level: 'info',
        taskId,
        taskName: projectTasks.find((task) => task.id === taskId)?.description ?? taskId,
        source: 'api',
        startDate,
        endDate,
        durationDays: cfg.durationDays,
        message: 'Enregistrement base OK',
      }]);
    } catch {
      pushTaskDateLogs([{
        action: 'save',
        level: 'error',
        taskId,
        taskName: projectTasks.find((task) => task.id === taskId)?.description ?? taskId,
        source: 'api',
        startDate,
        endDate,
        durationDays: cfg.durationDays,
        message: 'Erreur enregistrement base',
      }]);
    }
  }, []);

  useEffect(() => {
    for (const task of projectTasks) {
      const current = planByTaskId[task.id];
      const saved = lastSavedPlanByTaskId[task.id];
      if (!current || !saved) continue;

      const changed = (
        current.startsAfterTaskId !== saved.startsAfterTaskId
        || current.startDate !== saved.startDate
        || current.durationDays !== saved.durationDays
        || current.overrunDays !== saved.overrunDays
        || current.progressPercent !== saved.progressPercent
        || current.fte !== saved.fte
        || current.status !== saved.status
      );

      if (changed) {
        if (saveTimersRef.current[task.id]) {
          clearTimeout(saveTimersRef.current[task.id]);
        }
        saveTimersRef.current[task.id] = setTimeout(() => {
          void onSaveTaskPlan(task.id);
        }, 700);
      } else if (saveTimersRef.current[task.id]) {
        clearTimeout(saveTimersRef.current[task.id]);
        delete saveTimersRef.current[task.id];
      }
    }

    const validIds = new Set(projectTasks.map((task) => task.id));
    for (const taskId of Object.keys(saveTimersRef.current)) {
      if (!validIds.has(taskId)) {
        clearTimeout(saveTimersRef.current[taskId]);
        delete saveTimersRef.current[taskId];
      }
    }
  }, [projectTasks, planByTaskId, lastSavedPlanByTaskId, onSaveTaskPlan]);

  useEffect(() => {
    return () => {
      const timers = saveTimersRef.current;
      for (const timer of Object.values(timers)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const onSyncCalendarFromTasks = useCallback(() => {
    const nextPlansByTaskId = projectTasks.reduce((acc, task) => {
      const current = acc[task.id] ?? {
        startsAfterTaskId: task.startsAfterTaskId ?? '',
        startDate: task.planningStartDate ? toDateInputValue(task.planningStartDate) : '',
        durationDays: task.plannedDurationDays ?? 5,
        overrunDays: task.overrunDays ?? 0,
        progressPercent: task.progressPercent ?? 0,
        fte: task.fte ?? 1,
      };
      return {
        ...acc,
        [task.id]: current,
      };
    }, {} as Record<string, TaskPlanState>);

    setPlanByTaskId((prev) => {
      const next = { ...prev };
      let hasChange = false;

      for (const task of projectTasks) {
        const cfg = nextPlansByTaskId[task.id];
        if (!cfg) continue;

        const persistedStart = toDateInputValue(task.planningStartDate);
        const saisieStart = parseDateFromInput(cfg.startDate);
        const plannedStart = parseDateFromInput(persistedStart);
        const plannedEnd = parseDateFromInput(toDateInputValue(task.planningEndDate));

        const start = saisieStart ?? plannedStart;
        if (!start) {
          continue;
        }

        const hasPlannedRange = Boolean(plannedStart && plannedEnd && plannedEnd >= plannedStart);
        const saisieDuration = Math.max(1, Number(cfg.durationDays || 0));
        const sourceDuration = Math.max(1, task.plannedDurationDays || 5);
        const usePlannedRange = hasPlannedRange && Number(cfg.durationDays) === sourceDuration && cfg.startDate === persistedStart;
        const rangeDuration = hasPlannedRange ? Math.max(1, businessDaysBetween(start, plannedEnd ?? start)) : 0;
        const durationDays = usePlannedRange ? rangeDuration : (Number.isFinite(saisieDuration) ? saisieDuration : sourceDuration);

        const shouldUseStartFromPlanned = !cfg.startDate && toDateInputValue(task.planningStartDate);
        const targetStart = shouldUseStartFromPlanned ? toDateInputValue(task.planningStartDate) : cfg.startDate;

        const finalDuration = Math.max(1, Number(durationDays));
        const nextPlan = nextPlansByTaskId[task.id];

        const updated = {
          ...nextPlan,
          startDate: targetStart,
          durationDays: finalDuration,
        };

        pushTaskDateLogs([{
          action: 'sync',
          level: 'info',
          taskId: task.id,
          taskName: task.description,
          source: targetStart ? 'saisie' : 'planning',
          startDate: targetStart,
          durationDays: finalDuration,
          message: `Synchro calendrier: start=${targetStart || '-'}, durée=${finalDuration}j`,
        }]);

        const previous = prev[task.id];
        if (
          !previous
          || previous.startsAfterTaskId !== updated.startsAfterTaskId
          || previous.startDate !== updated.startDate
          || previous.durationDays !== updated.durationDays
        ) {
          hasChange = true;
        }
        next[task.id] = updated;
      }

      return hasChange ? next : prev;
    });
    setLastSavedPlanByTaskId((prev) => {
      const next = { ...prev };
      for (const task of projectTasks) {
        const cfg = nextPlansByTaskId[task.id];
        if (!cfg) continue;

        const persistedStart = toDateInputValue(task.planningStartDate);
        const saisieStart = parseDateFromInput(cfg.startDate);
        const plannedStart = parseDateFromInput(persistedStart);
        const plannedEnd = parseDateFromInput(toDateInputValue(task.planningEndDate));
        const start = saisieStart ?? plannedStart;
        if (!start) continue;

        const hasPlannedRange = Boolean(plannedStart && plannedEnd && plannedEnd >= plannedStart);
        const durationFromSaisie = Math.max(1, Number(cfg.durationDays || 0));
        const sourceDuration = Math.max(1, task.plannedDurationDays || 5);
        const usePlannedRange = hasPlannedRange && Number(cfg.durationDays) === sourceDuration && cfg.startDate === persistedStart;
        const rangeDuration = hasPlannedRange ? Math.max(1, businessDaysBetween(start, plannedEnd ?? start)) : 0;
        const durationDays = usePlannedRange ? rangeDuration : durationFromSaisie;

        const plan = nextPlansByTaskId[task.id];
        if (!plan) continue;
        next[task.id] = {
          ...plan,
          startDate: cfg.startDate ? cfg.startDate : formatDateForInput(start),
          durationDays,
        };
      }
      return next;
    });
  }, [projectTasks]);

  return (
    <section className="grid gap-6" aria-labelledby="timesheet-page-title">
      <h1 id="timesheet-page-title" className="text-2xl font-semibold text-[var(--brand)]">Timesheet</h1>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSyncCalendarFromTasks}
          aria-label="Mettre à jour le calendrier à partir des dates des tâches"
          className="rounded bg-[var(--brand)] px-3 py-2 font-semibold text-white"
        >
          Mise à jour du calendrier
        </button>
      </div>
      <div className="inline-flex w-fit overflow-hidden rounded-md border border-[var(--line)] bg-white">
        <button
          type="button"
          onClick={() => setView('saisie')}
          aria-label="Afficher la vue saisie"
          className={`px-4 py-2 text-sm font-semibold ${view === 'saisie' ? 'bg-[#f2eee4] text-[var(--brand)]' : 'text-[#5b5952]'}`}
        >
          Saisie
        </button>
        <button
          type="button"
          onClick={() => setView('gantt')}
          aria-label="Afficher la vue Gantt"
          className={`border-l border-[var(--line)] px-4 py-2 text-sm font-semibold ${view === 'gantt' ? 'bg-[#f2eee4] text-[var(--brand)]' : 'text-[#5b5952]'}`}
        >
          Gantt
        </button>
      </div>
      <div className="rounded-lg border-2 border-[var(--brand)] bg-[#efe7d4] px-4 py-3 text-base font-bold text-[#2f2b23]">
        <p>Workspace: {activeWorkspaceName ?? 'Aucun'}</p>
        <p className="pl-6">
          Projet: {activeProjectTitle ?? 'Aucun'}{activeProjectTypology ? ` (${activeProjectTypology})` : ''}
        </p>
        <p className="pl-12">Tâche: {activeTaskLabel ?? 'Aucune'}</p>
        {projectId ? (
          <button
            type="button"
            onClick={() => {
              clearActiveProjectContext();
              clearActiveTaskContext();
            }}
            className="ml-2 text-sm font-semibold underline underline-offset-2"
          >
            Retirer
          </button>
        ) : null}
      </div>
      {loading ? <p className="text-sm text-[#5b5952]" role="status" aria-live="polite">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="w-[360px]">
            <label htmlFor="timesheet-workspace" className="mb-1 block text-xs text-[#5b5952]">Workspace</label>
            <input id="timesheet-workspace" value={activeWorkspaceName ?? ''} disabled className="w-full rounded border border-[var(--line)] bg-[#f3f2ef] px-3 py-2" />
          </div>
          <div className="w-[360px]">
            <label htmlFor="timesheet-project" className="mb-1 block text-xs text-[#5b5952]">Projet</label>
            <select id="timesheet-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full rounded border border-[var(--line)] px-3 py-2">
              <option value="">Choisir un projet</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
        </div>
      </article>

      {projectId ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <article className="min-w-0 rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
              <p className="text-sm text-[#5b5952]">Avancement projet</p>
              <p className="text-right text-lg font-semibold">{projectSummary.progressPercent}%</p>
              <div className="mt-2 h-2 rounded bg-[#ece7da]">
                <div className="h-full rounded bg-[var(--brand)]" style={{ width: `${projectSummary.progressPercent}%` }} />
              </div>
            </article>
            <article className="min-w-0 rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
              <p className="text-sm text-[#5b5952]">Date fin prévisionnelle</p>
              <p className="text-right text-lg font-semibold">
                {projectSummary.plannedEndDate ? formatDateForInput(projectSummary.plannedEndDate) : '-'}
              </p>
            </article>
            <article className="min-w-0 rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
              <p className="text-sm text-[#5b5952]">Tâches en dépassement</p>
              <p className="text-right text-lg font-semibold">
                {projectSummary.lateTasks} tâche(s) - {projectSummary.lateDays} j
              </p>
            </article>
          </div>

          {view === 'saisie' ? (
            <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
              <div className="overflow-x-auto">
                <table className="min-w-[1500px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[#5b5952]">
                    <th className="px-2 py-2">Tâche</th>
                    <th className="px-2 py-2">Commence après</th>
                    <th className="px-2 py-2">
                      <button type="button" onClick={() => onToggleSort('start', 'asc')} className="font-semibold">
                        Date début {sortKey === 'start' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-2 py-2">Durée (j ouvrés)</th>
                    <th className="px-2 py-2">Dépassement (j ouvrés)</th>
                    <th className="px-2 py-2">
                      <button type="button" onClick={() => onToggleSort('end', 'asc')} className="font-semibold">
                        Date fin prévue {sortKey === 'end' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-2 py-2">
                      <button type="button" onClick={() => onToggleSort('progress', 'desc')} className="font-semibold">
                        Avancement % {sortKey === 'progress' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-2 py-2">ETP</th>
                    <th className="px-2 py-2">État</th>
                    <th className="px-2 py-2">Statut tâche</th>
                  </tr>
                </thead>
                <tbody>
                  {projectTasks.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-2 py-3 text-[#5b5952]">Aucune tâche sur ce projet.</td>
                    </tr>
                  ) : null}
                  {sortedProjectTasks.map((task) => {
                    const cfg = getTaskPlan(task.id);
                    const data = computed.get(task.id);
                    const computedStart = data?.start ? formatDateForInput(data.start) : '';
                    const computedEnd = data?.end ? formatDateForInput(data.end) : '';
                    const hasDependency = Boolean(cfg.startsAfterTaskId);

                    let taskState = 'OK';
                    if (data?.start && data?.end) {
                      const elapsedDays = businessDaysBetween(data.start, today);
                      const expectedProgress = Math.min(100, (elapsedDays / data.duration) * 100);
                      if (data.progress + 5 < expectedProgress) {
                        taskState = 'Depassement';
                      } else if (data.progress > expectedProgress + 20) {
                        taskState = 'Avance';
                      }
                    }

                    return (
                      <tr
                        id={`saisie-task-${task.id}`}
                        key={task.id}
                        className={`border-b border-[var(--line)] ${focusedTaskId === task.id ? 'bg-[#fff7e5]' : ''}`}
                      >
                        <td className="px-2 py-2 font-medium">{task.description}</td>
                        <td className="px-2 py-2">
                          <select
                            value={cfg.startsAfterTaskId}
                            onChange={(e) => updateTaskPlan(task.id, { startsAfterTaskId: e.target.value })}
                            className="rounded border border-[var(--line)] px-2 py-1"
                          >
                            <option value="">Aucune (independante)</option>
                            {sortedProjectTasks
                              .filter((candidate) => candidate.id !== task.id)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.description}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            value={cfg.startDate || (hasDependency ? computedStart : '')}
                            onChange={(e) => updateTaskPlan(task.id, { startDate: e.target.value })}
                            className="rounded border border-[var(--line)] px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={1}
                            value={cfg.durationDays}
                            onChange={(e) => updateTaskPlan(task.id, { durationDays: Math.max(1, Number(e.target.value) || 1) })}
                            className="w-24 rounded border border-[var(--line)] px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            value={cfg.overrunDays}
                            onChange={(e) => updateTaskPlan(task.id, { overrunDays: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-28 rounded border border-[var(--line)] px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">{computedEnd || '-'}</td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={cfg.progressPercent}
                            onChange={(e) => updateTaskPlan(task.id, { progressPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                            className="w-20 rounded border border-[var(--line)] px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0.1}
                            step={0.1}
                            value={cfg.fte}
                            onChange={(e) => updateTaskPlan(task.id, { fte: Math.max(0.1, Number(e.target.value) || 0.1) })}
                            className="w-20 rounded border border-[var(--line)] px-2 py-1"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <span className={taskState === 'Depassement' ? 'text-red-700' : taskState === 'Avance' ? 'text-green-700' : 'text-[#2f2b23]'}>
                            {taskState}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <select
                            value={cfg.status}
                            onChange={(e) => updateTaskPlan(task.id, { status: e.target.value as TaskWorkflowStatus })}
                            className="rounded border border-[var(--line)] px-2 py-1"
                          >
                            <option value="TODO">À faire</option>
                            <option value="IN_PROGRESS">En cours</option>
                            <option value="WAITING">En attente</option>
                            <option value="DONE">Fait</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
          ) : (
            <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#5b5952]">
                <div className="text-sm font-semibold text-[#2f2b23]">{activeWorkspaceName ?? 'Workspace'} - Tâches</div>
                <div className="flex flex-wrap items-center gap-4">
                  <span><span className="mr-1 inline-block h-3 w-3 rounded bg-[#d6d6d6]" />Non fait</span>
                  <span><span className="mr-1 inline-block h-3 w-3 rounded bg-[#22c55e]" />Avancement</span>
                  <span><span className="mr-1 inline-block h-3 w-3 rounded bg-[#ef4444]" />Retard</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs">Zoom</span>
                  <button
                    type="button"
                    onClick={() => setGanttDayWidth((prev) => Math.max(10, prev - 2))}
                    className="rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => setGanttDayWidth((prev) => Math.min(48, prev + 2))}
                    className="rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold"
                  >
                    +
                  </button>
                </div>
              </div>
              {!ganttItems.minDate || !ganttItems.maxDate || !ganttTimeline ? (
                <p className="text-sm text-[#5b5952]">Aucune tâche avec date de début/fin pour afficher le Gantt.</p>
              ) : (
                <div className="overflow-x-auto">
                  <div style={{ minWidth: `${Math.max(1200, 360 + ganttTimeline.width)}px` }}>
                    <div className="mb-2 grid grid-cols-[340px_1fr] items-end gap-3">
                      <div className="text-xs font-semibold text-[#5b5952]">Tâches</div>
                      <div className="relative h-8 border-b border-[var(--line)]">
                        {ganttTimeline.axisLabels.map((tick) => (
                          <span
                            key={`${tick.date.toISOString()}-${tick.offset}`}
                            className="absolute top-0 -translate-x-1/2 text-[10px] text-[#6a6861]"
                            style={{ left: `${tick.offset}px` }}
                          >
                            {tick.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                          </span>
                        ))}
                        {ganttTimeline.monthEndOffsets.map((offset) => (
                          <div
                            key={`month-end-${offset}`}
                            className="absolute bottom-0 top-0 w-[2px] bg-[#9aa3af]"
                            style={{ left: `${offset}px` }}
                          />
                        ))}
                        {typeof ganttTimeline.todayOffset === 'number' ? (
                          <div
                            className="absolute bottom-0 top-0 w-[2px] bg-[#2563eb]"
                            style={{ left: `${ganttTimeline.todayOffset}px` }}
                            title="Date courante"
                          />
                        ) : null}
                      </div>
                    </div>
                    {ganttItems.items.map((item) => {
                      const left = utcDayDiff(ganttTimeline.start, item.start) * ganttDayWidth;
                      const width = (utcDayDiff(item.start, item.end) + 1) * ganttDayWidth;
                      const progressWidth = Math.max(0, Math.min(100, item.progress));
                      const barColor = item.late ? '#ef4444' : item.started ? '#22c55e' : '#d6d6d6';
                      return (
                        <div key={item.id} className="grid grid-cols-[340px_1fr] items-center gap-3 border-b border-[var(--line)] py-2">
                          <a
                            href={`#saisie-task-${item.id}`}
                            onClick={() => {
                              setFocusedTaskId(item.id);
                              setView('saisie');
                            }}
                            className="truncate text-sm font-medium text-[#2f2b23] underline decoration-dotted underline-offset-2"
                            title={`Ouvrir dans Saisie: ${item.description}`}
                          >
                            {item.description}
                          </a>
                          <div
                            className="relative h-8 rounded border border-[#ececec]"
                            style={{
                              backgroundImage: `repeating-linear-gradient(to right, #f5f5f5 0px, #f5f5f5 ${ganttDayWidth}px, #ececec ${ganttDayWidth}px, #ececec ${ganttDayWidth * 2}px)`,
                            }}
                          >
                            {ganttTimeline.monthEndOffsets.map((offset) => (
                              <div
                                key={`${item.id}-month-end-${offset}`}
                                className="absolute bottom-0 top-0 w-[2px] bg-[#9aa3af]"
                                style={{ left: `${offset}px` }}
                              />
                            ))}
                            {typeof ganttTimeline.todayOffset === 'number' ? (
                              <div
                                className="absolute bottom-0 top-0 w-[2px] bg-[#2563eb]"
                                style={{ left: `${ganttTimeline.todayOffset}px` }}
                                title="Date courante"
                              />
                            ) : null}
                            <div
                              className="absolute top-1 h-6 rounded"
                              style={{ left: `${left}px`, width: `${Math.max(width, ganttDayWidth)}px`, backgroundColor: barColor }}
                              title={`${formatDateForInput(item.start)} -> ${formatDateForInput(item.end)} (${item.progress}%)`}
                            >
                              <div
                                className="h-full rounded bg-[#15803d]"
                                style={{ width: `${progressWidth}%`, opacity: item.late ? 0.65 : 0.85 }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          )}
        </>
      ) : (
        <p className="text-sm text-[#5b5952]">Sélectionne un workspace actif puis un projet pour planifier les tâches.</p>
      )}
    </section>
  );
}
