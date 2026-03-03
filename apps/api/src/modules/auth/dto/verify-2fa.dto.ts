import { IsString } from 'class-validator';

export class VerifyTwoFactorDto {
  @IsString()
  code!: string;
}
