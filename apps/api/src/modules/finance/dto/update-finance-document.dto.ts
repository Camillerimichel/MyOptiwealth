import { Type } from 'class-transformer';
import { IsDate, IsNumberString, IsOptional, IsString } from 'class-validator';

export class UpdateFinanceDocumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issuedAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date | null;

  @IsOptional()
  @IsString()
  accountingRef?: string | null;
}
