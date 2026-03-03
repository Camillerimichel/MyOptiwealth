export declare class SignatureWebhookDto {
    signatureRequestId: string;
    status: 'sent' | 'opened' | 'signed' | 'declined' | 'error';
    certificate?: string;
}
