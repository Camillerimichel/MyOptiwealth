import { CalendarEventType } from '@prisma/client';
export declare class UpdateEventDto {
    title?: string;
    description?: string;
    eventType?: CalendarEventType;
    startAt?: Date;
    endAt?: Date;
    projectId?: string;
    taskId?: string;
    visioLink?: string;
    alertMinutes?: number;
}
