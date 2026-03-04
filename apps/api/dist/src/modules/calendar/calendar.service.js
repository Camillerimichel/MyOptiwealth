"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
let CalendarService = class CalendarService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(workspaceId, dto) {
        return this.prisma.calendarEvent.create({ data: { workspaceId, ...dto } });
    }
    list(workspaceId) {
        return this.prisma.calendarEvent.findMany({
            where: { workspaceId },
            orderBy: { startAt: 'asc' },
        });
    }
    async unifiedFeed(userId, activeWorkspaceId) {
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
            const result = [];
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
                    url: '/tasks',
                    workspaceId: task.workspaceId,
                    workspaceName,
                    taskStatus: task.status,
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
                    url: '/tasks',
                    workspaceId: task.workspaceId,
                    workspaceName,
                    taskStatus: task.status,
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
                    url: '/tasks',
                    workspaceId: task.workspaceId,
                    workspaceName,
                    taskStatus: task.status,
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
                    url: '/tasks',
                    workspaceId: task.workspaceId,
                    workspaceName,
                    taskStatus: task.status,
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
                url: '/timesheet',
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
            url: '/calendar',
            workspaceId: event.workspaceId,
            workspaceName: workspaceById.get(event.workspaceId) ?? 'Workspace',
        }));
        const items = [...calendarEvents, ...taskEvents, ...timesheetEvents].sort((a, b) => a.start.localeCompare(b.start));
        return {
            activeWorkspaceId,
            items,
        };
    }
    async exportWeeklyIcs(workspaceId) {
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
    toUtc(date) {
        return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }
    toDateOnly(date) {
        return date.toISOString().slice(0, 10);
    }
    addOneDay(dateOnly) {
        const value = new Date(`${dateOnly}T00:00:00.000Z`);
        value.setUTCDate(value.getUTCDate() + 1);
        return value.toISOString().slice(0, 10);
    }
};
exports.CalendarService = CalendarService;
exports.CalendarService = CalendarService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CalendarService);
//# sourceMappingURL=calendar.service.js.map