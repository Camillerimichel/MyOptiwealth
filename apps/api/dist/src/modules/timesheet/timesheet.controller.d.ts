import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
import { TimesheetService } from './timesheet.service';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class TimesheetController {
    private readonly timesheetService;
    constructor(timesheetService: TimesheetService);
    list(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<({
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
    totals(user: AuthUser): Promise<{
        totalMinutes: number;
        totalHours: number;
        collaboratorsCount: number;
        projectsCount: number;
    }>;
    create(user: AuthUser, dto: CreateTimeEntryDto): import(".prisma/client").Prisma.Prisma__TimeEntryClient<{
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
}
export {};
