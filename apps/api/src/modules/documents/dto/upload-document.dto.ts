import { IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  societyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;
}
