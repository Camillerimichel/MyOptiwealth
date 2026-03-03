import { IsIn, IsOptional, IsString } from 'class-validator';

const MISSION_TYPES = [
  'WEALTH_STRATEGY',
  'SUCCESSION',
  'CORPORATE_FINANCE',
] as const;

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(MISSION_TYPES)
  missionType?: (typeof MISSION_TYPES)[number];
}
