import { TaskStatus } from '@prisma/client';
export declare class CreateTaskDto {
    projectId: string;
    projectPhaseId?: string;
    description: string;
    privateComment?: string;
    priority: number;
    orderNumber?: number;
    status?: TaskStatus;
    dueDate?: Date;
    assigneeId?: string;
    companyOwnerContactId?: string;
    visibleToClient: boolean;
    contactIds?: string[];
}
