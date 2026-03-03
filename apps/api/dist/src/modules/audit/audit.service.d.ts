import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
export declare class AuditService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    log(workspaceId: string, action: string, metadata: Record<string, unknown>, userId?: string): Promise<void>;
    listByWorkspace(workspaceId: string): Prisma.PrismaPromise<{
        id: string;
        action: string;
        metadata: Prisma.JsonValue;
        createdAt: Date;
        workspaceId: string;
        userId: string | null;
    }[]>;
}
