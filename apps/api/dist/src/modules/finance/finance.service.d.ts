import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateFinanceDocumentDto } from './dto/create-finance-document.dto';
export declare class FinanceService {
    private readonly prisma;
    private readonly auditService;
    constructor(prisma: PrismaService, auditService: AuditService);
    createDocument(workspaceId: string, userId: string, dto: CreateFinanceDocumentDto): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        projectId: string;
        status: string;
        dueDate: Date | null;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
        amount: import("@prisma/client/runtime/library").Decimal;
    }>;
    listByWorkspace(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
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
        status: string;
        dueDate: Date | null;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
        amount: import("@prisma/client/runtime/library").Decimal;
    })[]>;
    kpis(workspaceId: string): Promise<{
        billedRevenue: number;
        collectedRevenue: number;
        estimatedMargin: number;
    }>;
}
