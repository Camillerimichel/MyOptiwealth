import { UsersService } from './users.service';
interface AuthUser {
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
}
export {};
