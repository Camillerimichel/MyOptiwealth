import { Injectable } from '@nestjs/common';
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
}
