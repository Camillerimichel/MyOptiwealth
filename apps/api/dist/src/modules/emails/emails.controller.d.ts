import { LinkGlobalEmailDto } from './dto/link-global-email.dto';
import { LinkEmailDto } from './dto/link-email.dto';
import { EmailsService } from './emails.service';
interface AuthUser {
    sub: string;
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
            progressPercent: number;
            societyId: string;
            missionType: string | null;
            currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
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
    listLinked(user: AuthUser): Promise<({
        workspace: {
            id: string;
            name: string;
        };
        project: {
            id: string;
            name: string;
        } | null;
        tasks: {
            task: {
                id: string;
                description: string;
                projectId: string;
            };
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
    listUnassigned(user: AuthUser): Promise<({
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
    listIgnored(user: AuthUser): Promise<({
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
    listCatalog(user: AuthUser): Promise<{
        id: string;
        name: string;
        projects: {
            id: string;
            name: string;
            tasks: {
                id: string;
                description: string;
            }[];
        }[];
    }[]>;
    getContent(user: AuthUser, emailId: string): Promise<{
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
    saveAttachments(user: AuthUser, emailId: string): Promise<{
        saved: boolean;
        alreadySaved: boolean;
        importedCount: number;
    }>;
    linkEmail(user: AuthUser, dto: LinkEmailDto): Promise<{
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
    linkEmailFromInbox(user: AuthUser, dto: LinkGlobalEmailDto): Promise<{
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
    ignoreInboxEmail(user: AuthUser, emailId: string): Promise<{
        ignored: boolean;
    }>;
    unignoreInboxEmail(user: AuthUser, emailId: string): Promise<{
        restored: boolean;
    }>;
    sync(user: AuthUser): Promise<{
        synced: number;
    }>;
}
export {};
