import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
export declare class TasksService {
    private readonly prisma;
    private readonly auditService;
    constructor(prisma: PrismaService, auditService: AuditService);
    create(workspaceId: string, userId: string, dto: CreateTaskDto): Promise<{
        phase: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            updatedAt: Date;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
            title: string;
            projectId: string;
            position: number;
        } | null;
        assignee: {
            id: string;
            email: string;
        } | null;
        companyOwnerContact: {
            society: {
                name: string;
            } | null;
            id: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        description: string;
        projectId: string;
        projectPhaseId: string | null;
        privateComment: string | null;
        startDate: Date | null;
        expectedEndDate: Date | null;
        actualEndDate: Date | null;
        orderNumber: number;
        priority: number;
        status: import(".prisma/client").$Enums.TaskStatus;
        dueDate: Date | null;
        assigneeId: string | null;
        companyOwnerContactId: string | null;
        visibleToClient: boolean;
    }>;
    update(workspaceId: string, userId: string, taskId: string, dto: UpdateTaskDto): Promise<{
        phase: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            updatedAt: Date;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
            title: string;
            projectId: string;
            position: number;
        } | null;
        assignee: {
            id: string;
            email: string;
        } | null;
        companyOwnerContact: {
            society: {
                name: string;
            } | null;
            id: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        description: string;
        projectId: string;
        projectPhaseId: string | null;
        privateComment: string | null;
        startDate: Date | null;
        expectedEndDate: Date | null;
        actualEndDate: Date | null;
        orderNumber: number;
        priority: number;
        status: import(".prisma/client").$Enums.TaskStatus;
        dueDate: Date | null;
        assigneeId: string | null;
        companyOwnerContactId: string | null;
        visibleToClient: boolean;
    }>;
    remove(workspaceId: string, userId: string, taskId: string): Promise<{
        success: boolean;
    }>;
    listKanban(workspaceId: string): Prisma.PrismaPromise<({
        project: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            name: string;
            updatedAt: Date;
            societyId: string;
            missionType: string | null;
            currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
            progressPercent: number;
            estimatedFees: Prisma.Decimal;
            invoicedAmount: Prisma.Decimal;
            collectedAmount: Prisma.Decimal;
            estimatedMargin: Prisma.Decimal;
        };
        phase: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            updatedAt: Date;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
            title: string;
            projectId: string;
            position: number;
        } | null;
        assignee: {
            id: string;
            email: string;
        } | null;
        companyOwnerContact: {
            society: {
                name: string;
            } | null;
            id: string;
            firstName: string;
            lastName: string;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        description: string;
        projectId: string;
        projectPhaseId: string | null;
        privateComment: string | null;
        startDate: Date | null;
        expectedEndDate: Date | null;
        actualEndDate: Date | null;
        orderNumber: number;
        priority: number;
        status: import(".prisma/client").$Enums.TaskStatus;
        dueDate: Date | null;
        assigneeId: string | null;
        companyOwnerContactId: string | null;
        visibleToClient: boolean;
    })[]>;
}
