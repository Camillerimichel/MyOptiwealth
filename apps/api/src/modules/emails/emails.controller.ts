import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { LinkEmailDto } from './dto/link-email.dto';
import { EmailsService } from './emails.service';

interface AuthUser {
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

  @Post('link')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  linkEmail(@CurrentUser() user: AuthUser, @Body() dto: LinkEmailDto) {
    return this.emailsService.upsertMetadata(user.activeWorkspaceId, dto);
  }

  @Post('sync')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  sync(@CurrentUser() user: AuthUser) {
    return this.emailsService.syncFromImap(user.activeWorkspaceId);
  }
}
