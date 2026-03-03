import { IsOptional, IsString } from 'class-validator';

export class SignatureWebhookDto {
  @IsString()
  signatureRequestId!: string;

  @IsString()
  status!: 'sent' | 'opened' | 'signed' | 'declined' | 'error';

  @IsOptional()
  @IsString()
  certificate?: string;
}
