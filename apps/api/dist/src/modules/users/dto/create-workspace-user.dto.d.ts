import { WorkspaceRole } from '@prisma/client';
export declare class CreateWorkspaceUserDto {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role: WorkspaceRole;
}
