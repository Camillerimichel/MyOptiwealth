import { ContactRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class LinkProjectContactDto {
  @IsString()
  contactId!: string;

  @IsOptional()
  @IsEnum(ContactRole)
  projectRole?: ContactRole;
}
