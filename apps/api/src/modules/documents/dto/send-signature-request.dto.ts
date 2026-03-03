import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendSignatureRequestDto {
  @IsEmail()
  signerEmail!: string;

  @IsString()
  signerName!: string;

  @IsOptional()
  @IsString()
  provider?: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';
}
