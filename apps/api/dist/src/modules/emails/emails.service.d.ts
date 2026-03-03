import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../prisma.service';
import { LinkEmailDto } from './dto/link-email.dto';
export declare class EmailsService {
    private readonly prisma;
    private readonly encryptionService;
    constructor(prisma: PrismaService, encryptionService: EncryptionService);
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
    upsertMetadata(workspaceId: string, dto: LinkEmailDto): import(".prisma/client").Prisma.Prisma__EmailMessageClient<{
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
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import(".prisma/client").Prisma.PrismaClientOptions>;
    syncFromImap(workspaceId: string): Promise<{
        synced: number;
    }>;
    private decryptOrRaw;
}
