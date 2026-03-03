import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SendSignatureRequestDto } from './dto/send-signature-request.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentsService } from './documents.service';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

interface UploadedBinaryFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Controller('documents')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.documentsService.list(user.activeWorkspaceId);
  }

  @Post()
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    return this.documentsService.create(user.activeWorkspaceId, user.sub, dto);
  }

  @Post('upload')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedBinaryFile,
  ) {
    return this.documentsService.uploadAndCreate(user.activeWorkspaceId, user.sub, dto, file);
  }

  @Post(':id/send-signature')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  sendSignature(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendSignatureRequestDto,
  ) {
    return this.documentsService.sendForSignature(user.activeWorkspaceId, user.sub, id, dto);
  }

  @Patch(':id/sign')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  sign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SignDocumentDto,
  ) {
    return this.documentsService.markSigned(user.activeWorkspaceId, user.sub, id, body.certificate);
  }
}
