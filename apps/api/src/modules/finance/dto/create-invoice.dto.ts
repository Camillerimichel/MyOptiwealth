import { Type } from 'class-transformer';
import { IsDate, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateInvoiceDto {
  @IsString()
  quoteId!: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issuedAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @IsOptional()
  @IsIn(['PENDING', 'PAID'])
  status?: 'PENDING' | 'PAID';

  @IsOptional()
  @IsString()
  accountingRef?: string;
}
