import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
export declare class WorkspacesService {
    private readonly prisma;
    private readonly auditService;
    private readonly encryptionService;
    constructor(prisma: PrismaService, auditService: AuditService, encryptionService: EncryptionService);
    listForUser(userId: string): Promise<({
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
    private getGlobalProjectTypologies;
    private requireAdminMembership;
    createByPlatformAdmin(userId: string, _isPlatformAdmin: boolean, dto: CreateWorkspaceDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        updatedAt: Date;
    }>;
    switchWorkspace(userId: string, workspaceId: string): Promise<{
        activeWorkspaceId: string;
    }>;
    updateWorkspace(userId: string, workspaceId: string, dto: UpdateWorkspaceDto): Promise<{
        workspace: {
            id: string;
            name: string;
        } | null;
        associatedSocietyId: string | null;
    }>;
    deleteWorkspace(userId: string, workspaceId: string, confirmation: string): Promise<{
        deleted: boolean;
        workspaceId: string;
    }>;
    getSettings(workspaceId: string): Promise<{
        workspaceName: string;
        imapHost: string | null;
        imapPort: number | null;
        imapUser: string | null;
        projectTypologies: string[];
    } | {
        imapHost: string | null;
        imapPort: number | null;
        imapUser: string | null;
        workspaceName: string;
        projectTypologies: string[];
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        associatedSocietyId: string | null;
        signatureProvider: string | null;
        signatureApiBaseUrl: string | null;
    }>;
    updateSettings(workspaceId: string, userId: string, dto: UpdateWorkspaceSettingsDto): Promise<{
        imapHost: string | null;
        imapPort: number | null;
        imapUser: string | null;
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        associatedSocietyId: string | null;
        projectTypologies: import("@prisma/client/runtime/library").JsonValue;
        signatureProvider: string | null;
        signatureApiBaseUrl: string | null;
    }>;
}
