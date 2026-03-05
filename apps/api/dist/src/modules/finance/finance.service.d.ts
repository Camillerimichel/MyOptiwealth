import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateFinanceDocumentDto } from './dto/update-finance-document.dto';
export declare class FinanceService {
    private readonly prisma;
    private readonly auditService;
    constructor(prisma: PrismaService, auditService: AuditService);
    createQuote(workspaceId: string, userId: string, dto: CreateQuoteDto): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        projectId: string;
        status: string;
        dueDate: Date | null;
        quoteId: string | null;
        amount: import("@prisma/client/runtime/library").Decimal;
        issuedAt: Date;
        accountingRef: string | null;
        paidAt: Date | null;
        invoiceIndex: number | null;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
    }>;
    createInvoice(workspaceId: string, userId: string, dto: CreateInvoiceDto): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        projectId: string;
        status: string;
        dueDate: Date | null;
        quoteId: string | null;
        amount: import("@prisma/client/runtime/library").Decimal;
        issuedAt: Date;
        accountingRef: string | null;
        paidAt: Date | null;
        invoiceIndex: number | null;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
    }>;
    updateDocument(workspaceId: string, userId: string, documentId: string, dto: UpdateFinanceDocumentDto): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        projectId: string;
        status: string;
        dueDate: Date | null;
        quoteId: string | null;
        amount: import("@prisma/client/runtime/library").Decimal;
        issuedAt: Date;
        accountingRef: string | null;
        paidAt: Date | null;
        invoiceIndex: number | null;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
    }>;
    listByWorkspace(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
        project: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            name: string;
            updatedAt: Date;
            progressPercent: number;
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
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        projectId: string;
        status: string;
        dueDate: Date | null;
        quoteId: string | null;
        amount: import("@prisma/client/runtime/library").Decimal;
        issuedAt: Date;
        accountingRef: string | null;
        paidAt: Date | null;
        invoiceIndex: number | null;
        type: import(".prisma/client").$Enums.FinancialDocumentType;
        reference: string;
    })[]>;
    overview(workspaceId: string, projectId?: string): Promise<{
        quote: {
            id: string;
            projectId: string;
            projectName: string;
            name: string;
            reference: string;
            accountingRef: string | null;
            amount: number;
            status: string;
            issuedAt: Date;
            dueDate: Date | null;
        };
        totals: {
            paidInvoicesTotal: number;
            pendingInvoicesTotal: number;
        };
        invoices: {
            id: string;
            name: string;
            reference: string;
            accountingRef: string | null;
            amount: number;
            status: string;
            invoiceIndex: number | null;
            issuedAt: Date;
            dueDate: Date | null;
            paidAt: Date | null;
        }[];
    }[]>;
    kpis(workspaceId: string, projectId?: string): Promise<{
        billedRevenue: number;
        collectedRevenue: number;
        pendingRevenue: number;
        estimatedMargin: number;
    }>;
    private nextQuoteIndex;
    private buildQuoteReference;
    private toReferenceToken;
    private normalizeStatusForDocumentType;
}
