import { IsOptional, IsString } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  title!: string;

  @IsString()
  storagePath!: string;

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
