import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
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
import type { Response } from 'express';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SendSignatureRequestDto } from './dto/send-signature-request.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
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

  @Patch(':id')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documentsService.update(user.activeWorkspaceId, user.sub, id, dto);
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

  @Get(':id/view')
  view(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.documentsService.getDocumentBinary(user.activeWorkspaceId, id).then((file) => {
      response.setHeader('Content-Type', file.contentType);
      response.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
      return new StreamableFile(file.buffer);
    });
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

  @Patch(':id/archive')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.documentsService.markArchived(user.activeWorkspaceId, user.sub, id);
  }

  @Delete(':id')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.documentsService.deleteDocument(user.activeWorkspaceId, user.sub, id);
  }
}
