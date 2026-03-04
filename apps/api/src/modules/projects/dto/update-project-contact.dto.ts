import { ContactRole } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class UpdateProjectContactDto {
  @IsOptional()
  @IsEnum(ContactRole)
  projectRole?: ContactRole;
}
