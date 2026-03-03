import { AuditService } from './audit.service';
interface AuthUser {
    activeWorkspaceId: string;
}
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    findAll(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        action: string;
        metadata: import("@prisma/client/runtime/library").JsonValue;
        createdAt: Date;
        workspaceId: string;
        userId: string | null;
    }[]>;
}
export {};
