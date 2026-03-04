import { CalendarService } from './calendar.service';
import { CreateEventDto } from './dto/create-event.dto';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class CalendarController {
    private readonly calendarService;
    constructor(calendarService: CalendarService);
    list(user: AuthUser): import(".prisma/client").Prisma.PrismaPromise<{
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
    feed(user: AuthUser): Promise<{
        activeWorkspaceId: string;
        items: {
            id: string;
            title: string;
            start: string;
            end: string;
            allDay: boolean;
            source: string;
            url: string;
            workspaceId: string;
            workspaceName: string;
        }[];
    }>;
    create(user: AuthUser, dto: CreateEventDto): import(".prisma/client").Prisma.Prisma__CalendarEventClient<{
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
    exportWeekly(user: AuthUser): Promise<string>;
}
export {};
