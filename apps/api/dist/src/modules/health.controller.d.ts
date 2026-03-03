import { PrismaService } from './prisma.service';
export declare class HealthController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    check(): {
        status: string;
        service: string;
        at: string;
    };
    live(): {
        status: string;
        uptimeSeconds: number;
    };
    ready(): Promise<{
        status: string;
        checks: {
            database: string;
        };
    }>;
    details(): Promise<{
        status: string;
        service: string;
        nodeVersion: string;
        uptimeSeconds: number;
        checks: {
            database: "error" | "ok";
        };
        at: string;
    }>;
}
