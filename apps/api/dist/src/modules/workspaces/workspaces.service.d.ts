import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
export declare class WorkspacesService {
    private readonly prisma;
    private readonly auditService;
    private readonly encryptionService;
    constructor(prisma: PrismaService, auditService: AuditService, encryptionService: EncryptionService);
    listForUser(userId: string): import(".prisma/client").Prisma.PrismaPromise<({
        workspace: {
            id: string;
            createdAt: Date;
            name: string;
            updatedAt: Date;
        };
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        userId: string;
        updatedAt: Date;
        role: import(".prisma/client").$Enums.WorkspaceRole;
        isDefault: boolean;
    })[]>;
    createByPlatformAdmin(userId: string, _isPlatformAdmin: boolean, dto: CreateWorkspaceDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        updatedAt: Date;
    }>;
    switchWorkspace(userId: string, workspaceId: string): Promise<{
        activeWorkspaceId: string;
    }>;
    getSettings(workspaceId: string): Promise<{
        projectTypologies: string[];
    } | {
        projectTypologies: string[];
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        imapHost: string | null;
        imapPort: number | null;
        imapUser: string | null;
        signatureProvider: string | null;
        signatureApiBaseUrl: string | null;
    }>;
    updateSettings(workspaceId: string, userId: string, dto: UpdateWorkspaceSettingsDto): Promise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        imapHost: string | null;
        imapPort: number | null;
        imapUser: string | null;
        projectTypologies: import("@prisma/client/runtime/library").JsonValue;
        signatureProvider: string | null;
        signatureApiBaseUrl: string | null;
    }>;
}
