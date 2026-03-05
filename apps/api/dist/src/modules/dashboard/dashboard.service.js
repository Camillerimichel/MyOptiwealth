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
                    dueDate: { not: null },
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
                orderBy: { dueDate: 'asc' },
                take: 10,
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
        const summary = financeKpisList.reduce((acc, item) => ({
            billedRevenue: acc.billedRevenue + (item.billedRevenue ?? 0),
            collectedRevenue: acc.collectedRevenue + (item.collectedRevenue ?? 0),
            remainingRevenue: acc.remainingRevenue + (item.pendingRevenue ?? Math.max(0, (item.billedRevenue ?? 0) - (item.collectedRevenue ?? 0))),
        }), { billedRevenue: 0, collectedRevenue: 0, remainingRevenue: 0 });
        return {
            summary,
            upcomingTasks: upcomingTasks.map((task) => ({
                id: task.id,
                description: task.description,
                dueDate: task.dueDate,
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