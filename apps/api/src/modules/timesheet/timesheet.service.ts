import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';

@Injectable()
export class TimesheetService {
  constructor(private readonly prisma: PrismaService) {}

  create(workspaceId: string, userId: string, dto: CreateTimeEntryDto) {
    return this.prisma.timeEntry.create({
      data: {
        workspaceId,
        userId,
        projectId: dto.projectId,
        phaseId: dto.phaseId,
        taskId: dto.taskId,
        minutesSpent: dto.minutesSpent,
        entryDate: dto.entryDate,
      },
    });
  }

  list(workspaceId: string) {
    return this.prisma.timeEntry.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { entryDate: 'desc' },
    });
  }

  async totals(workspaceId: string) {
    const entries = await this.prisma.timeEntry.findMany({
      where: { workspaceId },
      select: {
        minutesSpent: true,
        userId: true,
        projectId: true,
      },
    });

    const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutesSpent, 0);
    return {
      totalMinutes,
      totalHours: Number((totalMinutes / 60).toFixed(2)),
      collaboratorsCount: new Set(entries.map((entry) => entry.userId)).size,
      projectsCount: new Set(entries.map((entry) => entry.projectId)).size,
    };
  }
}
