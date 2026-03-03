import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
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
