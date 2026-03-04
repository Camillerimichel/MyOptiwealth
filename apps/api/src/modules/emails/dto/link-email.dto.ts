import { IsArray, IsOptional, IsString } from 'class-validator';

export class LinkEmailDto {
  @IsString()
  externalMessageId!: string;

  @IsString()
  fromAddress!: string;

  @IsArray()
  @IsString({ each: true })
  toAddresses!: string[];

  @IsString()
  subject!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;
}
