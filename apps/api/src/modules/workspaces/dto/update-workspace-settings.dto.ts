import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  @IsString()
  imapHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  imapPort?: number;

  @IsOptional()
  @IsString()
  imapUser?: string;

  @IsOptional()
  @IsString()
  imapPassword?: string;

  @IsOptional()
  @IsString()
  signatureProvider?: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';

  @IsOptional()
  @IsString()
  signatureApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  signatureApiKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectTypologies?: string[];
}
