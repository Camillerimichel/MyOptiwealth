import { Equals, IsString } from 'class-validator';

export class DeleteWorkspaceDto {
  @IsString()
  @Equals('SUPPRESSION')
  confirmation!: string;
}

