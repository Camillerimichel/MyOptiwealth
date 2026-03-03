import { WorkspaceRole } from '@prisma/client';
export declare const WORKSPACE_ROLES_KEY = "workspaceRoles";
export declare const WorkspaceRoles: (...roles: WorkspaceRole[]) => import("@nestjs/common").CustomDecorator<string>;
