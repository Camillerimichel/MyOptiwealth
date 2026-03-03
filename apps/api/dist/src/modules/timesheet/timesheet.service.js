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
exports.TimesheetService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
let TimesheetService = class TimesheetService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(workspaceId, userId, dto) {
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
    list(workspaceId) {
        return this.prisma.timeEntry.findMany({
            where: { workspaceId },
            include: {
                user: { select: { id: true, email: true } },
                project: { select: { id: true, name: true } },
            },
            orderBy: { entryDate: 'desc' },
        });
    }
    async totals(workspaceId) {
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
};
exports.TimesheetService = TimesheetService;
exports.TimesheetService = TimesheetService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TimesheetService);
//# sourceMappingURL=timesheet.service.js.map