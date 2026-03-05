import { Type } from 'class-transformer';
import {
  IsArray,
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

export class CreateTaskDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  projectPhaseId?: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  privateComment?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedEndDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  actualEndDate?: Date;

  @IsOptional()
  @IsString()
  startsAfterTaskId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  planningStartDate?: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  plannedDurationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  overrunDays?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  planningEndDate?: Date;

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

  @IsInt()
  @Min(1)
  @Max(3)
  priority!: number;

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
  dueDate?: Date;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  companyOwnerContactId?: string;

  @IsBoolean()
  visibleToClient!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactIds?: string[];
}
