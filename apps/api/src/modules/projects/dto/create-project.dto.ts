import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

const MISSION_TYPES = [
  'WEALTH_STRATEGY',
  'SUCCESSION',
  'CORPORATE_FINANCE',
] as const;

export class CreateProjectDto {
  @IsString()
  name!: string;

  @IsString()
  societyId!: string;

  @IsOptional()
  @IsNumberString()
  estimatedFees?: string;

  @IsOptional()
  @IsString()
  @IsIn(MISSION_TYPES)
  missionType?: (typeof MISSION_TYPES)[number];
}
