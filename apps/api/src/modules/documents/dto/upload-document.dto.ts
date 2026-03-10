import { IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  societyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;
}
