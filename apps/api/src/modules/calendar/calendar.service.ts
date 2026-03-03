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
}
