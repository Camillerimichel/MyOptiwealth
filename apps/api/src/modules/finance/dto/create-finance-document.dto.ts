import { Type } from 'class-transformer';
import { FinancialDocumentType } from '@prisma/client';
import { IsDate, IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateFinanceDocumentDto {
  @IsString()
  projectId!: string;

  @IsEnum(FinancialDocumentType)
  type!: FinancialDocumentType;

  @IsString()
  reference!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;
}
