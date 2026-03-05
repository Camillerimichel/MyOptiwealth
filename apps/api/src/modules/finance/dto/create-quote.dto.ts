import { Type } from 'class-transformer';
import { IsDate, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateQuoteDto {
  @IsString()
  projectId!: string;

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
}
