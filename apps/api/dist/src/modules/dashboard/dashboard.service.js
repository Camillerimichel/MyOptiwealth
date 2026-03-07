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
exports.DashboardService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const finance_service_1 = require("../finance/finance.service");
const prisma_service_1 = require("../prisma.service");
function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
}
function toUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function businessDaysBetween(start, end) {
    if (end < start)
        return 0;
    const cursor = toUtcDay(start);
    const endUtc = toUtcDay(end);
    let days = 0;
    while (cursor <= endUtc) {
        if (!isWeekend(cursor)) {
            days += 1;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}
let DashboardService = class DashboardService {
    constructor(prisma, financeService) {
        this.prisma = prisma;
        this.financeService = financeService;
    }
    async homepage(workspaceId) {
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
    async workspacesOverview(userId) {
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
        const [taskGroups, projectGroups, financeKpisList, upcomingTasks, taskProgressRows] = await Promise.all([
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
                    status: { not: client_1.TaskStatus.DONE },
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
            this.prisma.task.findMany({
                where: { workspaceId: { in: workspaceIds } },
                select: {
                    workspaceId: true,
                    planningStartDate: true,
                    planningEndDate: true,
                    plannedDurationDays: true,
                    overrunDays: true,
                    progressPercent: true,
                    fte: true,
                },
            }),
        ]);
        const taskByWorkspace = new Map();
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
            if (!entry)
                continue;
            const count = group._count._all;
            if (group.status === client_1.TaskStatus.TODO)
                entry.todo += count;
            if (group.status === client_1.TaskStatus.IN_PROGRESS)
                entry.inProgress += count;
            if (group.status === client_1.TaskStatus.WAITING)
                entry.waiting += count;
            if (group.status === client_1.TaskStatus.DONE)
                entry.done += count;
            entry.total += count;
        }
        const progressByWorkspace = new Map();
        const weightedByWorkspace = new Map();
        for (const workspaceId of workspaceIds) {
            weightedByWorkspace.set(workspaceId, { weightedDone: 0, weightedTotal: 0 });
        }
        for (const task of taskProgressRows) {
            const entry = weightedByWorkspace.get(task.workspaceId);
            if (!entry)
                continue;
            const hasPlanningRange = Boolean(task.planningStartDate
                && task.planningEndDate
                && task.planningEndDate >= task.planningStartDate);
            const baseDuration = Math.max(1, Number(task.plannedDurationDays ?? 5));
            const plannedDuration = hasPlanningRange && task.planningStartDate && task.planningEndDate
                ? Math.max(1, businessDaysBetween(task.planningStartDate, task.planningEndDate))
                : baseDuration;
            const overrun = Math.max(0, Number(task.overrunDays ?? 0));
            const effectiveDuration = plannedDuration + overrun;
            const fte = Math.max(0.1, Number(task.fte ?? 1));
            const progress = Math.min(100, Math.max(0, Number(task.progressPercent ?? 0)));
            const weight = effectiveDuration * fte;
            entry.weightedTotal += weight;
            entry.weightedDone += weight * (progress / 100);
        }
        for (const workspaceId of workspaceIds) {
            const entry = weightedByWorkspace.get(workspaceId);
            const progressPercent = entry && entry.weightedTotal > 0
                ? Math.round((entry.weightedDone / entry.weightedTotal) * 100)
                : 0;
            progressByWorkspace.set(workspaceId, progressPercent);
        }
        const projectCountByWorkspace = new Map();
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
            const progressPercent = progressByWorkspace.get(membership.workspaceId) ?? 0;
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
        const summary = financeKpisList.reduce((acc, item) => ({
            billedRevenue: acc.billedRevenue + (item.billedRevenue ?? 0),
            collectedRevenue: acc.collectedRevenue + (item.collectedRevenue ?? 0),
            remainingRevenue: acc.remainingRevenue + (item.pendingRevenue ?? Math.max(0, (item.billedRevenue ?? 0) - (item.collectedRevenue ?? 0))),
        }), { billedRevenue: 0, collectedRevenue: 0, remainingRevenue: 0 });
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
};
exports.DashboardService = DashboardService;
exports.DashboardService = DashboardService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        finance_service_1.FinanceService])
], DashboardService);
//# sourceMappingURL=dashboard.service.js.map