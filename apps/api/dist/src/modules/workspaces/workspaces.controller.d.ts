import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { DeleteWorkspaceDto } from './dto/delete-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
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
    list(user: AuthUser): Promise<({
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
    updateWorkspace(user: AuthUser, workspaceId: string, dto: UpdateWorkspaceDto): Promise<{
        workspace: {
            id: string;
            name: string;
        } | null;
        associatedSocietyId: string | null;
    }>;
    deleteWorkspace(user: AuthUser, workspaceId: string, dto: DeleteWorkspaceDto): Promise<{
        deleted: boolean;
        workspaceId: string;
    }>;
    switch(user: AuthUser, workspaceId: string, response: Response): Promise<{
        accessToken: string;
        activeWorkspaceId: string;
    }>;
    settings(user: AuthUser): Promise<{
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
    updateSettings(user: AuthUser, dto: UpdateWorkspaceSettingsDto): Promise<{
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
export {};
