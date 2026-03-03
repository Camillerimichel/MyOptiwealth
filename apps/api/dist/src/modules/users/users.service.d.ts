import { ConfigService } from '@nestjs/config';
import { WorkspaceRole } from '@prisma/client';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateWorkspaceUserDto } from './dto/create-workspace-user.dto';
import { UpdateWorkspaceUserDto } from './dto/update-workspace-user.dto';
export declare class UsersService {
    private readonly prisma;
    private readonly auditService;
    private readonly configService;
    private readonly encryptionService;
    constructor(prisma: PrismaService, auditService: AuditService, configService: ConfigService, encryptionService: EncryptionService);
    listWorkspaceUsers(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
        user: {
            id: string;
            createdAt: Date;
            email: string;
            firstName: string | null;
            lastName: string | null;
            isPlatformAdmin: boolean;
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
    updateWorkspaceUser(workspaceId: string, actorUserId: string, targetUserId: string, dto: UpdateWorkspaceUserDto): Promise<{
        user: {
            id: string;
            createdAt: Date;
            email: string;
            firstName: string | null;
            lastName: string | null;
            isPlatformAdmin: boolean;
            updatedAt: Date;
        };
        role: WorkspaceRole;
        isDefault: boolean;
    }>;
    createWorkspaceUser(workspaceId: string, actorUserId: string, dto: CreateWorkspaceUserDto): Promise<{
        user: {
            id: string;
            createdAt: Date;
            email: string;
            firstName: string | null;
            lastName: string | null;
            isPlatformAdmin: boolean;
            updatedAt: Date;
        };
        role: import(".prisma/client").$Enums.WorkspaceRole;
        isDefault: boolean;
        twoFactorProvisioning?: undefined;
    } | {
        user: {
            id: string;
            createdAt: Date;
            email: string;
            firstName: string | null;
            lastName: string | null;
            isPlatformAdmin: boolean;
            updatedAt: Date;
        };
        role: import(".prisma/client").$Enums.WorkspaceRole;
        isDefault: boolean;
        twoFactorProvisioning: {
            secret: string;
            otpauth: string;
        };
    }>;
    getUserTwoFactorProvisioning(workspaceId: string, targetUserId: string): Promise<{
        userId: string;
        email: string;
        twoFactorEnabled: boolean;
        secret: string;
        otpauth: string;
    }>;
}
