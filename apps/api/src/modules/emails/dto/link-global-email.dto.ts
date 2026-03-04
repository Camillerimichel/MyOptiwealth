import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class LinkGlobalEmailDto {
  @IsString()
  @IsNotEmpty()
  emailId!: string;

  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  taskId!: string;

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
