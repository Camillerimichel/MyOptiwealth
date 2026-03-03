import { WorkspaceRole } from '@prisma/client';
export declare class UpdateWorkspaceUserDto {
    firstName?: string | null;
    lastName?: string | null;
    role?: WorkspaceRole;
}
