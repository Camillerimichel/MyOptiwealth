import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma.service';
export declare class DashboardService {
    private readonly prisma;
    private readonly financeService;
    constructor(prisma: PrismaService, financeService: FinanceService);
    homepage(workspaceId: string): Promise<{
        tasksToday: ({
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
        } & {
            id: string;
            createdAt: Date;
            workspaceId: string;
            updatedAt: Date;
            description: string;
            projectId: string;
            status: import(".prisma/client").$Enums.TaskStatus;
            dueDate: Date | null;
            projectPhaseId: string | null;
            privateComment: string | null;
            orderNumber: number;
            priority: number;
            assigneeId: string | null;
            companyOwnerContactId: string | null;
            visibleToClient: boolean;
        })[];
        globalKpis: {
            billedRevenue: number;
            collectedRevenue: number;
            estimatedMargin: number;
        };
        calendarPreview: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            updatedAt: Date;
            title: string;
            description: string | null;
            eventType: import(".prisma/client").$Enums.CalendarEventType;
            startAt: Date;
            endAt: Date;
            projectId: string | null;
            taskId: string | null;
            visioLink: string | null;
            alertMinutes: number | null;
        }[];
    }>;
}
