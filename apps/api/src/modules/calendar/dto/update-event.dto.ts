import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CalendarEventType } from '@prisma/client';

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CalendarEventType)
  eventType?: CalendarEventType;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endAt?: Date;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  visioLink?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  alertMinutes?: number;
}
