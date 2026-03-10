import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { LinkGlobalEmailDto } from './dto/link-global-email.dto';
import { LinkEmailDto } from './dto/link-email.dto';
import { EmailsService } from './emails.service';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('emails')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.emailsService.list(user.activeWorkspaceId);
  }

  @Get('linked')
  listLinked(@CurrentUser() user: AuthUser) {
    return this.emailsService.listLinkedForUser(user.sub);
  }

  @Get('inbox/unassigned')
  listUnassigned(@CurrentUser() user: AuthUser) {
    return this.emailsService.listUnassignedForUser(user.sub);
  }

  @Get('inbox/ignored')
  listIgnored(@CurrentUser() user: AuthUser) {
    return this.emailsService.listIgnoredForUser(user.sub);
  }

  @Get('inbox/catalog')
  listCatalog(@CurrentUser() user: AuthUser) {
    return this.emailsService.listLinkCatalogForUser(user.sub);
  }

  @Get(':emailId/content')
  getContent(@CurrentUser() user: AuthUser, @Param('emailId') emailId: string) {
    return this.emailsService.getEmailContent(user.sub, emailId);
  }

  @Post(':emailId/attachments/save')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  saveAttachments(@CurrentUser() user: AuthUser, @Param('emailId') emailId: string) {
    return this.emailsService.saveAttachmentsToDocuments(user.sub, emailId);
  }

  @Post('link')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  linkEmail(@CurrentUser() user: AuthUser, @Body() dto: LinkEmailDto) {
    return this.emailsService.upsertMetadata(user.activeWorkspaceId, dto);
  }

  @Post('inbox/link')
  linkEmailFromInbox(@CurrentUser() user: AuthUser, @Body() dto: LinkGlobalEmailDto) {
    return this.emailsService.upsertMetadataGlobal(user.sub, dto);
  }

  @Post('inbox/:emailId/ignore')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  ignoreInboxEmail(@CurrentUser() user: AuthUser, @Param('emailId') emailId: string) {
    return this.emailsService.ignoreInboxEmail(user.sub, emailId);
  }

  @Post('inbox/:emailId/unignore')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  unignoreInboxEmail(@CurrentUser() user: AuthUser, @Param('emailId') emailId: string) {
    return this.emailsService.unignoreInboxEmail(user.sub, emailId);
  }

  @Post('sync')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  sync(@CurrentUser() user: AuthUser) {
    return this.emailsService.syncFromImap(user.activeWorkspaceId);
  }
}
