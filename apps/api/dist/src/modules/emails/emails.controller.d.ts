import { LinkEmailDto } from './dto/link-email.dto';
import { EmailsService } from './emails.service';
interface AuthUser {
    activeWorkspaceId: string;
}
export declare class EmailsController {
    private readonly emailsService;
    constructor(emailsService: EmailsService);
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
    linkEmail(user: AuthUser, dto: LinkEmailDto): import(".prisma/client").Prisma.Prisma__EmailMessageClient<{
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
    sync(user: AuthUser): Promise<{
        synced: number;
    }>;
}
export {};
