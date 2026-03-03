import { CalendarEventType } from '@prisma/client';
export declare class CreateEventDto {
    title: string;
    description?: string;
    eventType: CalendarEventType;
    startAt: Date;
    endAt: Date;
    projectId?: string;
    taskId?: string;
    visioLink?: string;
    alertMinutes?: number;
}
