import { PrismaService } from '../prisma.service';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
export declare class TimesheetService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(workspaceId: string, userId: string, dto: CreateTimeEntryDto): import(".prisma/client").Prisma.Prisma__TimeEntryClient<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        userId: string;
        updatedAt: Date;
        projectId: string;
        taskId: string | null;
        phaseId: string | null;
        minutesSpent: number;
        entryDate: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import(".prisma/client").Prisma.PrismaClientOptions>;
    list(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
        user: {
            id: string;
            email: string;
        };
        project: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        userId: string;
        updatedAt: Date;
        projectId: string;
        taskId: string | null;
        phaseId: string | null;
        minutesSpent: number;
        entryDate: Date;
    })[]>;
    totals(workspaceId: string): Promise<{
        totalMinutes: number;
        totalHours: number;
        collaboratorsCount: number;
        projectsCount: number;
    }>;
}
