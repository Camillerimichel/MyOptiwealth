import { WorkspaceRole } from '@prisma/client';
import { CreateWorkspaceUserDto } from './dto/create-workspace-user.dto';
import { UpdateWorkspaceUserDto } from './dto/update-workspace-user.dto';
import { UsersService } from './users.service';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    list(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<({
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
    create(user: AuthUser, dto: CreateWorkspaceUserDto): Promise<{
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
    update(user: AuthUser, userId: string, dto: UpdateWorkspaceUserDto): Promise<{
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
    getTwoFactorProvisioning(user: AuthUser, userId: string): Promise<{
        userId: string;
        email: string;
        twoFactorEnabled: boolean;
        secret: string;
        otpauth: string;
    }>;
}
export {};
