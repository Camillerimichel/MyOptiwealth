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
exports.TasksService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
let TasksService = class TasksService {
    constructor(prisma, auditService) {
        this.prisma = prisma;
        this.auditService = auditService;
    }
    async create(workspaceId, userId, dto) {
        const task = await this.prisma.$transaction(async (tx) => {
            const targetStatus = dto.status ?? client_1.TaskStatus.TODO;
            const currentCount = await tx.task.count({
                where: { workspaceId, status: targetStatus },
            });
            const requestedOrder = dto.orderNumber ?? currentCount + 1;
            const orderNumber = Math.min(Math.max(1, requestedOrder), currentCount + 1);
            await tx.task.updateMany({
                where: {
                    workspaceId,
                    status: targetStatus,
                    orderNumber: { gte: orderNumber },
                },
                data: {
                    orderNumber: { increment: 1 },
                },
            });
            return tx.task.create({
                data: {
                    workspaceId,
                    projectId: dto.projectId,
                    projectPhaseId: dto.projectPhaseId,
                    description: dto.description,
                    privateComment: dto.privateComment,
                    startDate: dto.startDate,
                    expectedEndDate: dto.expectedEndDate,
                    actualEndDate: dto.actualEndDate,
                    orderNumber,
                    priority: dto.priority,
                    status: targetStatus,
                    dueDate: dto.dueDate,
                    assigneeId: dto.assigneeId,
                    companyOwnerContactId: dto.companyOwnerContactId,
                    visibleToClient: dto.visibleToClient,
                    contacts: dto.contactIds
                        ? {
                            createMany: {
                                data: dto.contactIds.map((contactId) => ({ contactId })),
                                skipDuplicates: true,
                            },
                        }
                        : undefined,
                },
                include: {
                    phase: true,
                    assignee: {
                        select: { id: true, email: true },
                    },
                    companyOwnerContact: {
                        select: { id: true, firstName: true, lastName: true, society: { select: { name: true } } },
                    },
                },
            });
        });
        await this.auditService.log(workspaceId, 'TASK_CREATED', { taskId: task.id }, userId);
        return task;
    }
    async update(workspaceId, userId, taskId, dto) {
        const task = await this.prisma.$transaction(async (tx) => {
            const current = await tx.task.findFirst({
                where: { id: taskId, workspaceId },
            });
            if (!current) {
                throw new common_1.NotFoundException('Task introuvable dans ce workspace');
            }
            const targetStatus = dto.status ?? current.status;
            const requestedOrder = dto.orderNumber ?? current.orderNumber;
            const statusChanged = targetStatus !== current.status;
            const orderChanged = requestedOrder !== current.orderNumber;
            let finalOrder = current.orderNumber;
            if (statusChanged || orderChanged) {
                await tx.task.updateMany({
                    where: {
                        workspaceId,
                        status: current.status,
                        orderNumber: { gt: current.orderNumber },
                        id: { not: current.id },
                    },
                    data: {
                        orderNumber: { decrement: 1 },
                    },
                });
                const targetCount = await tx.task.count({
                    where: {
                        workspaceId,
                        status: targetStatus,
                        id: { not: current.id },
                    },
                });
                finalOrder = Math.min(Math.max(1, requestedOrder), targetCount + 1);
                await tx.task.updateMany({
                    where: {
                        workspaceId,
                        status: targetStatus,
                        orderNumber: { gte: finalOrder },
                        id: { not: current.id },
                    },
                    data: {
                        orderNumber: { increment: 1 },
                    },
                });
            }
            return tx.task.update({
                where: { id: taskId },
                data: {
                    projectId: dto.projectId,
                    projectPhaseId: dto.projectPhaseId,
                    description: dto.description,
                    privateComment: dto.privateComment,
                    startDate: dto.startDate,
                    expectedEndDate: dto.expectedEndDate,
                    actualEndDate: dto.actualEndDate,
                    priority: dto.priority,
                    status: dto.status,
                    orderNumber: finalOrder,
                    dueDate: dto.dueDate,
                    assigneeId: dto.assigneeId,
                    companyOwnerContactId: dto.companyOwnerContactId,
                    visibleToClient: dto.visibleToClient,
                },
                include: {
                    phase: true,
                    assignee: {
                        select: { id: true, email: true },
                    },
                    companyOwnerContact: {
                        select: { id: true, firstName: true, lastName: true, society: { select: { name: true } } },
                    },
                },
            });
        });
        await this.auditService.log(workspaceId, 'TASK_UPDATED', { taskId }, userId);
        return task;
    }
    async remove(workspaceId, userId, taskId) {
        const deleted = await this.prisma.$transaction(async (tx) => {
            const current = await tx.task.findFirst({
                where: { id: taskId, workspaceId },
            });
            if (!current) {
                throw new common_1.NotFoundException('Task introuvable dans ce workspace');
            }
            await tx.task.delete({
                where: { id: taskId },
            });
            await tx.task.updateMany({
                where: {
                    workspaceId,
                    status: current.status,
                    orderNumber: { gt: current.orderNumber },
                },
                data: {
                    orderNumber: { decrement: 1 },
                },
            });
            return current;
        });
        await this.auditService.log(workspaceId, 'TASK_DELETED', { taskId: deleted.id }, userId);
        return { success: true };
    }
    listKanban(workspaceId) {
        return this.prisma.task.findMany({
            where: { workspaceId },
            include: {
                project: true,
                phase: true,
                assignee: {
                    select: { id: true, email: true },
                },
                companyOwnerContact: {
                    select: { id: true, firstName: true, lastName: true, society: { select: { name: true } } },
                },
            },
            orderBy: [{ status: 'asc' }, { orderNumber: 'asc' }, { priority: 'desc' }, { dueDate: 'asc' }],
        });
    }
};
exports.TasksService = TasksService;
exports.TasksService = TasksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], TasksService);
//# sourceMappingURL=tasks.service.js.map