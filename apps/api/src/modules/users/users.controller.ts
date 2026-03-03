import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { CreateWorkspaceUserDto } from './dto/create-workspace-user.dto';
import { UpdateWorkspaceUserDto } from './dto/update-workspace-user.dto';
import { UsersService } from './users.service';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  list(@CurrentUser() user: AuthUser) {
    return this.usersService.listWorkspaceUsers(user.activeWorkspaceId);
  }

  @Post()
  @WorkspaceRoles(WorkspaceRole.ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceUserDto) {
    return this.usersService.createWorkspaceUser(user.activeWorkspaceId, user.sub, dto);
  }

  @Patch(':userId')
  @WorkspaceRoles(WorkspaceRole.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateWorkspaceUserDto,
  ) {
    return this.usersService.updateWorkspaceUser(user.activeWorkspaceId, user.sub, userId, dto);
  }

  @Get(':userId/2fa-provisioning')
  @WorkspaceRoles(WorkspaceRole.ADMIN)
  getTwoFactorProvisioning(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.usersService.getUserTwoFactorProvisioning(user.activeWorkspaceId, userId);
  }
}
