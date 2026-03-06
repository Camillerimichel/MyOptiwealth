import { Injectable } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
  ) {}

  async homepage(workspaceId: string) {
    const [todayTasks, financeKpis, upcomingEvents] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          workspaceId,
          dueDate: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lte: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
        include: { project: true },
        orderBy: { priority: 'desc' },
      }),
      this.financeService.kpis(workspaceId),
      this.prisma.calendarEvent.findMany({
        where: {
          workspaceId,
          startAt: { gte: new Date() },
        },
        take: 5,
        orderBy: { startAt: 'asc' },
      }),
    ]);

    return {
      tasksToday: todayTasks,
      globalKpis: financeKpis,
      calendarPreview: upcomingEvents,
    };
  }

  async workspacesOverview(userId: string) {
    const memberships = await this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      include: {
        workspace: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const workspaceIds = memberships.map((item) => item.workspaceId);
    if (workspaceIds.length === 0) {
      return {
        summary: {
          billedRevenue: 0,
          collectedRevenue: 0,
          remainingRevenue: 0,
        },
        upcomingTasks: [],
        workspaces: [],
      };
    }

    const [taskGroups, projectGroups, financeKpisList, upcomingTasks] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['workspaceId', 'status'],
        where: { workspaceId: { in: workspaceIds } },
        _count: { _all: true },
      }),
      this.prisma.project.groupBy({
        by: ['workspaceId'],
        where: { workspaceId: { in: workspaceIds } },
        _count: { _all: true },
      }),
      Promise.all(workspaceIds.map((workspaceId) => this.financeService.kpis(workspaceId))),
      this.prisma.task.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          OR: [
            { dueDate: { not: null } },
            { planningEndDate: { not: null } },
          ],
          status: { not: TaskStatus.DONE },
        },
        include: {
          workspace: {
            select: { id: true, name: true },
          },
          project: {
            select: { id: true, name: true },
          },
        },
        take: 200,
      }),
    ]);

    const taskByWorkspace = new Map<
      string,
      {
        todo: number;
        inProgress: number;
        waiting: number;
        done: number;
        total: number;
      }
    >();

    for (const workspaceId of workspaceIds) {
      taskByWorkspace.set(workspaceId, {
        todo: 0,
        inProgress: 0,
        waiting: 0,
        done: 0,
        total: 0,
      });
    }

    for (const group of taskGroups) {
      const entry = taskByWorkspace.get(group.workspaceId);
      if (!entry) continue;
      const count = group._count._all;
      if (group.status === TaskStatus.TODO) entry.todo += count;
      if (group.status === TaskStatus.IN_PROGRESS) entry.inProgress += count;
      if (group.status === TaskStatus.WAITING) entry.waiting += count;
      if (group.status === TaskStatus.DONE) entry.done += count;
      entry.total += count;
    }

    const projectCountByWorkspace = new Map<string, number>();
    for (const group of projectGroups) {
      projectCountByWorkspace.set(group.workspaceId, group._count._all);
    }

    const workspaces = memberships.map((membership, index) => {
      const taskStats = taskByWorkspace.get(membership.workspaceId) ?? {
        todo: 0,
        inProgress: 0,
        waiting: 0,
        done: 0,
        total: 0,
      };
      const progressPercent = taskStats.total > 0
        ? Math.round((taskStats.done / taskStats.total) * 100)
        : 0;
      const kpis = financeKpisList[index] ?? {
        billedRevenue: 0,
        collectedRevenue: 0,
        pendingRevenue: 0,
      };

      return {
        workspace: membership.workspace,
        projectCount: projectCountByWorkspace.get(membership.workspaceId) ?? 0,
        progressPercent,
        taskStats,
        finance: {
          billedRevenue: kpis.billedRevenue ?? 0,
          collectedRevenue: kpis.collectedRevenue ?? 0,
          remainingRevenue: kpis.pendingRevenue ?? Math.max(0, (kpis.billedRevenue ?? 0) - (kpis.collectedRevenue ?? 0)),
        },
      };
    });

    const summary = financeKpisList.reduce(
      (acc, item) => ({
        billedRevenue: acc.billedRevenue + (item.billedRevenue ?? 0),
        collectedRevenue: acc.collectedRevenue + (item.collectedRevenue ?? 0),
        remainingRevenue: acc.remainingRevenue + (item.pendingRevenue ?? Math.max(0, (item.billedRevenue ?? 0) - (item.collectedRevenue ?? 0))),
      }),
      { billedRevenue: 0, collectedRevenue: 0, remainingRevenue: 0 },
    );

    const sortedUpcomingTasks = [...upcomingTasks]
      .sort((a, b) => {
        const aDate = (a.dueDate ?? a.planningEndDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDate = (b.dueDate ?? b.planningEndDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      })
      .slice(0, 10);

    return {
      summary,
      upcomingTasks: sortedUpcomingTasks.map((task) => ({
        id: task.id,
        description: task.description,
        dueDate: task.dueDate ?? task.planningEndDate,
        priority: task.priority,
        status: task.status,
        workspace: task.workspace,
        project: task.project,
      })),
      workspaces,
    };
  }
}
