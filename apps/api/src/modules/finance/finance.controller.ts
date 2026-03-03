import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CreateFinanceDocumentDto } from './dto/create-finance-document.dto';
import { FinanceService } from './finance.service';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('finance')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('documents')
  list(@CurrentUser() user: AuthUser) {
    return this.financeService.listByWorkspace(user.activeWorkspaceId);
  }

  @Post('documents')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFinanceDocumentDto) {
    return this.financeService.createDocument(user.activeWorkspaceId, user.sub, dto);
  }

  @Get('kpis')
  kpis(@CurrentUser() user: AuthUser) {
    return this.financeService.kpis(user.activeWorkspaceId);
  }
}
