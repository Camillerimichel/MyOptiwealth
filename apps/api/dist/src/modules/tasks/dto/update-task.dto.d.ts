import { TaskStatus } from '@prisma/client';
export declare class UpdateTaskDto {
    projectId?: string;
    projectPhaseId?: string | null;
    description?: string;
    privateComment?: string | null;
    priority?: number;
    orderNumber?: number;
    status?: TaskStatus;
    dueDate?: Date | null;
    assigneeId?: string | null;
    companyOwnerContactId?: string | null;
    visibleToClient?: boolean;
}
