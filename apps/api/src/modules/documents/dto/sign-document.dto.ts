import { IsString, MinLength } from 'class-validator';

export class SignDocumentDto {
  @IsString()
  @MinLength(10)
  certificate!: string;
}
