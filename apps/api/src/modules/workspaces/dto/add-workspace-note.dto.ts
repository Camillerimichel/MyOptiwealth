import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddWorkspaceNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}
