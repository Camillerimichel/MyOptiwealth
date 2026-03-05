import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateFinanceDocumentDto } from './dto/update-finance-document.dto';
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

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.financeService.overview(user.activeWorkspaceId, projectId);
  }

  @Post('quotes')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  createQuote(@CurrentUser() user: AuthUser, @Body() dto: CreateQuoteDto) {
    return this.financeService.createQuote(user.activeWorkspaceId, user.sub, dto);
  }

  @Post('invoices')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  createInvoice(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.financeService.createInvoice(user.activeWorkspaceId, user.sub, dto);
  }

  @Patch('documents/:documentId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateFinanceDocumentDto,
  ) {
    return this.financeService.updateDocument(user.activeWorkspaceId, user.sub, documentId, dto);
  }

  @Get('kpis')
  kpis(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.financeService.kpis(user.activeWorkspaceId, projectId);
  }
}
