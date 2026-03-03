import { IsNumberString, IsOptional, IsString } from 'class-validator';

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
  missionType?: string;
}
