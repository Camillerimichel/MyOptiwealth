import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { UsersService } from './users.service';

interface AuthUser {
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
}
