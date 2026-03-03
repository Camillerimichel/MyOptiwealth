import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateTimeEntryDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  phaseId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsInt()
  @Min(1)
  minutesSpent!: number;

  @Type(() => Date)
  @IsDate()
  entryDate!: Date;
}
