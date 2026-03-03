import { CreateTaskDto } from './dto/create-task.dto';
import { TasksService } from './tasks.service';
import { UpdateTaskDto } from './dto/update-task.dto';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class TasksController {
    private readonly tasksService;
    constructor(tasksService: TasksService);
    listKanban(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<({
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
            estimatedFees: import("@prisma/client/runtime/library").Decimal;
            invoicedAmount: import("@prisma/client/runtime/library").Decimal;
            collectedAmount: import("@prisma/client/runtime/library").Decimal;
            estimatedMargin: import("@prisma/client/runtime/library").Decimal;
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
    create(user: AuthUser, dto: CreateTaskDto): Promise<{
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
    update(user: AuthUser, taskId: string, dto: UpdateTaskDto): Promise<{
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
    remove(user: AuthUser, taskId: string): Promise<{
        success: boolean;
    }>;
}
export {};
