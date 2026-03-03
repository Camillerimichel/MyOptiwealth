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
};
exports.CalendarService = CalendarService;
exports.CalendarService = CalendarService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CalendarService);
//# sourceMappingURL=calendar.service.js.map