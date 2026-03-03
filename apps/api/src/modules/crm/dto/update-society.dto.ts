import { IsOptional, IsString } from 'class-validator';

export class UpdateSocietyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  legalForm?: string | null;

  @IsOptional()
  @IsString()
  siren?: string | null;

  @IsOptional()
  @IsString()
  siret?: string | null;

  @IsOptional()
  @IsString()
  addressLine1?: string | null;

  @IsOptional()
  @IsString()
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  city?: string | null;

  @IsOptional()
  @IsString()
  country?: string | null;
}
