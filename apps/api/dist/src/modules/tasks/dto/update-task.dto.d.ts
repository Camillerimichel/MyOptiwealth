import { TaskStatus } from '@prisma/client';
export declare class UpdateTaskDto {
    projectId?: string;
    projectPhaseId?: string | null;
    description?: string;
    privateComment?: string | null;
    startDate?: Date | null;
    expectedEndDate?: Date | null;
    actualEndDate?: Date | null;
    startsAfterTaskId?: string | null;
    planningStartDate?: Date | null;
    plannedDurationDays?: number | null;
    overrunDays?: number;
    planningEndDate?: Date | null;
    progressPercent?: number;
    fte?: number;
    priority?: number;
    orderNumber?: number;
    status?: TaskStatus;
    dueDate?: Date | null;
    assigneeId?: string | null;
    companyOwnerContactId?: string | null;
    visibleToClient?: boolean;
}
