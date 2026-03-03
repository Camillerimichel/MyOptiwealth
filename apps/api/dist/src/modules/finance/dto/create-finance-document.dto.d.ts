import { FinancialDocumentType } from '@prisma/client';
export declare class CreateFinanceDocumentDto {
    projectId: string;
    type: FinancialDocumentType;
    reference: string;
    amount: string;
    status: string;
    dueDate?: Date;
}
