import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { AuditService } from './audit.service';

interface AuthUser {
  activeWorkspaceId: string;
}

@Controller('audit')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @WorkspaceRoles(WorkspaceRole.ADMIN)
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parsedPage = Number(page);
    const parsedPageSize = Number(pageSize);
    return this.auditService.listByWorkspace(
      user.activeWorkspaceId,
      Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
      Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 25,
    );
  }
}
