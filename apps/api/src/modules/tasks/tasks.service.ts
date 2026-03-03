import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(workspaceId: string, userId: string, dto: CreateTaskDto) {
    const task = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const targetStatus = dto.status ?? TaskStatus.TODO;
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

  async update(workspaceId: string, userId: string, taskId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.task.findFirst({
        where: { id: taskId, workspaceId },
      });

      if (!current) {
        throw new NotFoundException('Task introuvable dans ce workspace');
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

  async remove(workspaceId: string, userId: string, taskId: string) {
    const deleted = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.task.findFirst({
        where: { id: taskId, workspaceId },
      });

      if (!current) {
        throw new NotFoundException('Task introuvable dans ce workspace');
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

  listKanban(workspaceId: string) {
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
}
