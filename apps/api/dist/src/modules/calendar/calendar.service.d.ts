import { PrismaService } from '../prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
export declare class CalendarService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(workspaceId: string, dto: CreateEventDto): import(".prisma/client").Prisma.Prisma__CalendarEventClient<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        title: string;
        description: string | null;
        eventType: import(".prisma/client").$Enums.CalendarEventType;
        startAt: Date;
        endAt: Date;
        projectId: string | null;
        taskId: string | null;
        visioLink: string | null;
        alertMinutes: number | null;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import(".prisma/client").Prisma.PrismaClientOptions>;
    list(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        updatedAt: Date;
        title: string;
        description: string | null;
        eventType: import(".prisma/client").$Enums.CalendarEventType;
        startAt: Date;
        endAt: Date;
        projectId: string | null;
        taskId: string | null;
        visioLink: string | null;
        alertMinutes: number | null;
    }[]>;
    unifiedFeed(userId: string, activeWorkspaceId: string): Promise<{
        activeWorkspaceId: string;
        items: {
            id: string;
            title: string;
            start: string;
            end: string;
            allDay: boolean;
            source: string;
            workspaceId: string;
            workspaceName: string;
        }[];
    }>;
    exportWeeklyIcs(workspaceId: string): Promise<string>;
    private toUtc;
    private toDateOnly;
    private addOneDay;
}
