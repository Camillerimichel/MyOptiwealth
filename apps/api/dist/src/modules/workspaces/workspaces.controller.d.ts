import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
import { WorkspacesService } from './workspaces.service';
interface AuthUser {
    sub: string;
    email: string;
    isPlatformAdmin: boolean;
    activeWorkspaceId: string;
}
export declare class WorkspacesController {
    private readonly workspacesService;
    private readonly authService;
    private readonly configService;
    constructor(workspacesService: WorkspacesService, authService: AuthService, configService: ConfigService);
    private refreshCookieName;
    private isCookieSecure;
    list(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<({
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
    create(user: AuthUser, dto: CreateWorkspaceDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        updatedAt: Date;
    }>;
    switch(user: AuthUser, workspaceId: string, response: Response): Promise<{
        accessToken: string;
        activeWorkspaceId: string;
    }>;
    settings(user: AuthUser): Promise<{
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
    updateSettings(user: AuthUser, dto: UpdateWorkspaceSettingsDto): Promise<{
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
export {};
