import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LinkGlobalEmailDto {
  @IsString()
  @IsNotEmpty()
  emailId!: string;

  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsString()
  @IsNotEmpty()
  externalMessageId!: string;

  @IsString()
  @IsNotEmpty()
  fromAddress!: string;

  @IsArray()
  @IsString({ each: true })
  toAddresses!: string[];

  @IsString()
  @IsNotEmpty()
  subject!: string;
}
