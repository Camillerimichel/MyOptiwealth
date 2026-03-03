interface SignatureRequestInput {
    provider: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';
    documentTitle: string;
    signerEmail: string;
    signerName: string;
    apiKey?: string;
    baseUrl?: string;
}
interface SignatureRequestOutput {
    externalRequestId: string;
    state: 'sent' | 'error';
}
export declare class SignatureService {
    sendSignatureRequest(input: SignatureRequestInput): Promise<SignatureRequestOutput>;
    private sendViaYousign;
    private sendViaDocuSign;
    private mockRequest;
    private extractId;
}
export {};
