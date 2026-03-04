import { EncryptionService } from '../../common/crypto/encryption.service';
import { DocumentStorageService } from '../documents/storage.service';
import { PrismaService } from '../prisma.service';
import { LinkGlobalEmailDto } from './dto/link-global-email.dto';
import { LinkEmailDto } from './dto/link-email.dto';
export declare class EmailsService {
    private readonly prisma;
    private readonly encryptionService;
    private readonly documentStorageService;
    constructor(prisma: PrismaService, encryptionService: EncryptionService, documentStorageService: DocumentStorageService);
    list(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
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
        } | null;
        tasks: {
            taskId: string;
        }[];
    } & {
        id: string;
        metadata: import("@prisma/client/runtime/library").JsonValue;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        projectId: string | null;
        externalMessageId: string;
        fromAddress: string;
        toAddresses: string[];
        subject: string;
        receivedAt: Date;
    })[]>;
    listUnassignedForUser(userId: string): Promise<({
        workspace: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        metadata: import("@prisma/client/runtime/library").JsonValue;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        projectId: string | null;
        externalMessageId: string;
        fromAddress: string;
        toAddresses: string[];
        subject: string;
        receivedAt: Date;
    })[]>;
    listLinkCatalogForUser(userId: string): Promise<{
        id: string;
        name: string;
        projects: {
            id: string;
            name: string;
            tasks: Array<{
                id: string;
                description: string;
            }>;
        }[];
    }[]>;
    getEmailContent(userId: string, emailId: string): Promise<{
        subject: string;
        fromAddress: string;
        toAddresses: string[];
        receivedAt: Date;
        text: string;
        attachments: {
            filename: string;
            contentType: string;
            size: number;
        }[];
    }>;
    upsertMetadata(workspaceId: string, dto: LinkEmailDto): Promise<{
        id: string;
        metadata: import("@prisma/client/runtime/library").JsonValue;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        projectId: string | null;
        externalMessageId: string;
        fromAddress: string;
        toAddresses: string[];
        subject: string;
        receivedAt: Date;
    }>;
    upsertMetadataGlobal(userId: string, dto: LinkGlobalEmailDto): Promise<{
        id: string;
        metadata: import("@prisma/client/runtime/library").JsonValue;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        projectId: string | null;
        externalMessageId: string;
        fromAddress: string;
        toAddresses: string[];
        subject: string;
        receivedAt: Date;
    }>;
    private upsertMetadataGlobalByEmailId;
    private upsertMetadataInternal;
    private upsertMetadataInternalForWorkspace;
    syncFromImap(workspaceId: string): Promise<{
        synced: number;
    }>;
    private decryptOrRaw;
    private getWindowStartDate;
    private isBounceOrSystemDeliveryMail;
    private getWorkspaceIdsForUser;
    private fetchImapSourceByExternalMessageId;
    private importAttachmentsAsDocuments;
    private normalizeBodyText;
    private readMetadataString;
    private readMetadataAttachments;
}
