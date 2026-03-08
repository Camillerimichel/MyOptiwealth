import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { DeleteWorkspaceDto } from './dto/delete-workspace.dto';
import { AddWorkspaceNoteDto } from './dto/add-workspace-note.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
import { WorkspacesService } from './workspaces.service';

interface AuthUser {
  sub: string;
  email: string;
  isPlatformAdmin: boolean;
  activeWorkspaceId: string;
}

@Controller('workspaces')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private refreshCookieName(): string {
    return this.configService.get<string>('REFRESH_COOKIE_NAME', 'mw_refresh_token');
  }

  private isCookieSecure(): boolean {
    return this.configService.get<string>('COOKIE_SECURE', 'false') === 'true';
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspacesService.listForUser(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.createByPlatformAdmin(user.sub, user.isPlatformAdmin, dto);
  }

  @Patch(':workspaceId')
  updateWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.updateWorkspace(user.sub, workspaceId, dto);
  }

  @Post(':workspaceId/delete')
  deleteWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: DeleteWorkspaceDto,
  ) {
    return this.workspacesService.deleteWorkspace(user.sub, workspaceId, dto.confirmation);
  }

  @Post(':workspaceId/switch')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR, WorkspaceRole.VIEWER)
  async switch(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const switched = await this.workspacesService.switchWorkspace(user.sub, workspaceId);
    const tokens = await this.authService.issueWorkspaceSwitchTokens(
      user.sub,
      user.email,
      user.isPlatformAdmin,
      workspaceId,
    );

    response.cookie(this.refreshCookieName(), tokens.refreshToken, {
      httpOnly: true,
      secure: this.isCookieSecure(),
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { ...switched, accessToken: tokens.accessToken };
  }

  @Get('settings/current')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR, WorkspaceRole.VIEWER)
  settings(@CurrentUser() user: AuthUser) {
    return this.workspacesService.getSettings(user.activeWorkspaceId);
  }

  @Post('settings/current')
  @WorkspaceRoles(WorkspaceRole.ADMIN)
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateWorkspaceSettingsDto) {
    return this.workspacesService.updateSettings(user.activeWorkspaceId, user.sub, dto);
  }

  @Get('notes/current')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR, WorkspaceRole.VIEWER)
  listNotes(@CurrentUser() user: AuthUser) {
    return this.workspacesService.listWorkspaceNotes(user.activeWorkspaceId);
  }

  @Get('notes/all')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR, WorkspaceRole.VIEWER)
  listNotesAll(@CurrentUser() user: AuthUser) {
    return this.workspacesService.listWorkspaceNotesAll(user.sub);
  }

  @Post('notes/current')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR, WorkspaceRole.VIEWER)
  addNote(@CurrentUser() user: AuthUser, @Body() dto: AddWorkspaceNoteDto) {
    return this.workspacesService.appendWorkspaceNote(user.activeWorkspaceId, user.sub, dto.content);
  }
}
