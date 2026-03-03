import { IsBase64, IsInt, IsString, Min } from 'class-validator';

export class EnvValidation {
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL!: string;

  @IsString()
  JWT_REFRESH_TTL!: string;

  @IsInt()
  @Min(10)
  BCRYPT_SALT_ROUNDS!: number;

  @IsBase64()
  AES_SECRET_BASE64!: string;
}
