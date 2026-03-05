import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateFinanceDocumentDto } from './dto/update-finance-document.dto';
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
    overview(user: AuthUser, projectId?: string): Promise<{
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
    createQuote(user: AuthUser, dto: CreateQuoteDto): Promise<{
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
    createInvoice(user: AuthUser, dto: CreateInvoiceDto): Promise<{
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
    updateDocument(user: AuthUser, documentId: string, dto: UpdateFinanceDocumentDto): Promise<{
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
    kpis(user: AuthUser, projectId?: string): Promise<{
        billedRevenue: number;
        collectedRevenue: number;
        pendingRevenue: number;
        estimatedMargin: number;
    }>;
}
export {};
