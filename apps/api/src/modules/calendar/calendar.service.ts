import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  create(workspaceId: string, dto: CreateEventDto) {
    return this.prisma.calendarEvent.create({ data: { workspaceId, ...dto } });
  }

  list(workspaceId: string) {
    return this.prisma.calendarEvent.findMany({
      where: { workspaceId },
      orderBy: { startAt: 'asc' },
    });
  }

  async unifiedFeed(userId: string, activeWorkspaceId: string) {
    const memberships = await this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (memberships.length === 0) {
      return { activeWorkspaceId, items: [] };
    }

    const workspaceById = new Map(memberships.map((membership) => [membership.workspace.id, membership.workspace.name]));
    const workspaceIds = memberships.map((membership) => membership.workspace.id);

    const [events, tasks, timeEntries] = await this.prisma.$transaction([
      this.prisma.calendarEvent.findMany({
        where: { workspaceId: { in: workspaceIds } },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.task.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          OR: [
            { dueDate: { not: null } },
            { startDate: { not: null } },
            { expectedEndDate: { not: null } },
            { actualEndDate: { not: null } },
          ],
        },
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.timeEntry.findMany({
        where: { workspaceId: { in: workspaceIds } },
        include: {
          project: { select: { id: true, name: true } },
          user: { select: { id: true, email: true } },
        },
      }),
    ]);

    const taskEvents = tasks.flatMap((task) => {
      const result: Array<{
        id: string;
        title: string;
        start: string;
        end: string;
        allDay: boolean;
        source: string;
        workspaceId: string;
        workspaceName: string;
      }> = [];

      const workspaceName = workspaceById.get(task.workspaceId) ?? 'Workspace';
      const taskLabel = task.description.length > 80 ? `${task.description.slice(0, 80)}...` : task.description;
      const projectLabel = task.project?.name ? ` (${task.project.name})` : '';

      if (task.startDate) {
        const day = this.toDateOnly(task.startDate);
        result.push({
          id: `${task.id}-start`,
          title: `Tache debut${projectLabel} - ${taskLabel}`,
          start: day,
          end: this.addOneDay(day),
          allDay: true,
          source: 'TASK',
          workspaceId: task.workspaceId,
          workspaceName,
        });
      }
      if (task.dueDate) {
        const day = this.toDateOnly(task.dueDate);
        result.push({
          id: `${task.id}-due`,
          title: `Tache echeance${projectLabel} - ${taskLabel}`,
          start: day,
          end: this.addOneDay(day),
          allDay: true,
          source: 'TASK',
          workspaceId: task.workspaceId,
          workspaceName,
        });
      }
      if (task.expectedEndDate) {
        const day = this.toDateOnly(task.expectedEndDate);
        result.push({
          id: `${task.id}-expected`,
          title: `Tache fin attendue${projectLabel} - ${taskLabel}`,
          start: day,
          end: this.addOneDay(day),
          allDay: true,
          source: 'TASK',
          workspaceId: task.workspaceId,
          workspaceName,
        });
      }
      if (task.actualEndDate) {
        const day = this.toDateOnly(task.actualEndDate);
        result.push({
          id: `${task.id}-actual`,
          title: `Tache fin reelle${projectLabel} - ${taskLabel}`,
          start: day,
          end: this.addOneDay(day),
          allDay: true,
          source: 'TASK',
          workspaceId: task.workspaceId,
          workspaceName,
        });
      }
      return result;
    });

    const timesheetEvents = timeEntries.map((entry) => {
      const workspaceName = workspaceById.get(entry.workspaceId) ?? 'Workspace';
      const date = this.toDateOnly(entry.entryDate);
      return {
        id: `time-${entry.id}`,
        title: `Timesheet (${entry.minutesSpent} min) - ${entry.project.name}`,
        start: date,
        end: this.addOneDay(date),
        allDay: true,
        source: 'TIMESHEET',
        workspaceId: entry.workspaceId,
        workspaceName,
      };
    });

    const calendarEvents = events.map((event) => ({
      id: `event-${event.id}`,
      title: event.title,
      start: event.startAt.toISOString(),
      end: event.endAt.toISOString(),
      allDay: false,
      source: 'EVENT',
      workspaceId: event.workspaceId,
      workspaceName: workspaceById.get(event.workspaceId) ?? 'Workspace',
    }));

    const items = [...calendarEvents, ...taskEvents, ...timesheetEvents].sort((a, b) => a.start.localeCompare(b.start));

    return {
      activeWorkspaceId,
      items,
    };
  }

  // Lightweight ICS output to support event/task/project/week exports.
  async exportWeeklyIcs(workspaceId: string): Promise<string> {
    const events = await this.prisma.calendarEvent.findMany({
      where: { workspaceId },
      orderBy: { startAt: 'asc' },
      take: 200,
    });

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MyOptiwealth//Calendar//FR',
      ...events.flatMap((event) => [
        'BEGIN:VEVENT',
        `UID:${event.id}@myoptiwealth`,
        `DTSTAMP:${this.toUtc(event.createdAt)}`,
        `DTSTART:${this.toUtc(event.startAt)}`,
        `DTEND:${this.toUtc(event.endAt)}`,
        `SUMMARY:${event.title}`,
        event.description ? `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}` : 'DESCRIPTION:',
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ];

    return `${lines.join('\r\n')}\r\n`;
  }

  private toUtc(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  private toDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private addOneDay(dateOnly: string): string {
    const value = new Date(`${dateOnly}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }
}
