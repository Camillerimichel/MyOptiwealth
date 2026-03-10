import { DashboardService } from './dashboard.service';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class DashboardController {
    private readonly dashboardService;
    constructor(dashboardService: DashboardService);
    homepage(user: AuthUser): Promise<{
        tasksToday: ({
            project: {
                id: string;
                workspaceId: string;
                progressPercent: number;
                createdAt: Date;
                updatedAt: Date;
                name: string;
                societyId: string;
                missionType: string | null;
                currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
                estimatedFees: import("@prisma/client/runtime/library").Decimal;
                invoicedAmount: import("@prisma/client/runtime/library").Decimal;
                collectedAmount: import("@prisma/client/runtime/library").Decimal;
                estimatedMargin: import("@prisma/client/runtime/library").Decimal;
            };
        } & {
            id: string;
            workspaceId: string;
            projectId: string;
            projectPhaseId: string | null;
            startsAfterTaskId: string | null;
            description: string;
            privateComment: string | null;
            startDate: Date | null;
            expectedEndDate: Date | null;
            actualEndDate: Date | null;
            planningStartDate: Date | null;
            plannedDurationDays: number | null;
            overrunDays: number;
            planningEndDate: Date | null;
            progressPercent: number;
            fte: number;
            orderNumber: number;
            priority: number;
            status: import(".prisma/client").$Enums.TaskStatus;
            dueDate: Date | null;
            assigneeId: string | null;
            companyOwnerContactId: string | null;
            visibleToClient: boolean;
            createdAt: Date;
            updatedAt: Date;
        })[];
        globalKpis: {
            billedRevenue: number;
            collectedRevenue: number;
            pendingRevenue: number;
            estimatedMargin: number;
        };
        calendarPreview: {
            id: string;
            workspaceId: string;
            projectId: string | null;
            description: string | null;
            createdAt: Date;
            updatedAt: Date;
            taskId: string | null;
            title: string;
            eventType: import(".prisma/client").$Enums.CalendarEventType;
            startAt: Date;
            endAt: Date;
            visioLink: string | null;
            alertMinutes: number | null;
        }[];
    }>;
    workspacesOverview(user: AuthUser): Promise<{
        summary: {
            billedRevenue: number;
            collectedRevenue: number;
            remainingRevenue: number;
        };
        upcomingTasks: {
            id: string;
            description: string;
            dueDate: Date | null;
            priority: number;
            status: import(".prisma/client").$Enums.TaskStatus;
            workspace: {
                id: string;
                name: string;
            };
            project: {
                id: string;
                name: string;
            };
        }[];
        workspaces: {
            workspace: {
                id: string;
                name: string;
            };
            projects: {
                id: string;
                name: string;
                missionType: string | null;
            }[];
            projectCount: number;
            progressPercent: number;
            taskStats: {
                todo: number;
                inProgress: number;
                waiting: number;
                done: number;
                total: number;
            };
            finance: {
                billedRevenue: number;
                collectedRevenue: number;
                remainingRevenue: number;
            };
        }[];
    }>;
}
export {};
