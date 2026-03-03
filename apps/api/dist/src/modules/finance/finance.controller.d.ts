import { CreateFinanceDocumentDto } from './dto/create-finance-document.dto';
import { FinanceService } from './finance.service';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class FinanceController {
    private readonly financeService;
    constructor(financeService: FinanceService);
    list(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<({
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
        projectId: string;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: string;
        dueDate: Date | null;
    })[]>;
    create(user: AuthUser, dto: CreateFinanceDocumentDto): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        projectId: string;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        status: string;
        dueDate: Date | null;
    }>;
    kpis(user: AuthUser): Promise<{
        billedRevenue: number;
        collectedRevenue: number;
        estimatedMargin: number;
    }>;
}
export {};
