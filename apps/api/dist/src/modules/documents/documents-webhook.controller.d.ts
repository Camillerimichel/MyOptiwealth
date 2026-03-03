import { ConfigService } from '@nestjs/config';
import { SignatureWebhookDto } from './dto/signature-webhook.dto';
import { DocumentsService } from './documents.service';
export declare class DocumentsWebhookController {
    private readonly documentsService;
    private readonly configService;
    constructor(documentsService: DocumentsService, configService: ConfigService);
    applyWebhook(dto: SignatureWebhookDto, token?: string, workspaceId?: string): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        signatureProvider: string | null;
        title: string;
        projectId: string | null;
        societyId: string | null;
        contactId: string | null;
        status: import(".prisma/client").$Enums.DocumentStatus;
        storagePath: string;
        signatureRequestId: string | null;
        version: number;
        signatureCertificate: string | null;
        signatureState: string | null;
    }>;
}
