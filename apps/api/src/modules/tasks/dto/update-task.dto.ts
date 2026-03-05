import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  projectPhaseId?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  privateComment?: string | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedEndDate?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  actualEndDate?: Date | null;

  @IsOptional()
  @IsString()
  startsAfterTaskId?: string | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  planningStartDate?: Date | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  plannedDurationDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  overrunDays?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  planningEndDate?: Date | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  fte?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderNumber?: number;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date | null;

  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsString()
  companyOwnerContactId?: string | null;

  @IsOptional()
  @IsBoolean()
  visibleToClient?: boolean;
}
