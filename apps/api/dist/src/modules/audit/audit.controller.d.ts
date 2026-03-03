import { AuditService } from './audit.service';
interface AuthUser {
    activeWorkspaceId: string;
}
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    findAll(user: AuthUser, page?: string, pageSize?: string): Promise<{
        items: ({
            user: {
                id: string;
                email: string;
                firstName: string | null;
                lastName: string | null;
            } | null;
        } & {
            id: string;
            action: string;
            metadata: import("@prisma/client/runtime/library").JsonValue;
            createdAt: Date;
            workspaceId: string;
            userId: string | null;
        })[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    }>;
}
export {};
