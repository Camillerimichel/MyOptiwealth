export declare class CreateInvoiceDto {
    quoteId: string;
    amount: string;
    issuedAt?: Date;
    dueDate?: Date;
    status?: 'PENDING' | 'PAID';
    accountingRef?: string;
}
