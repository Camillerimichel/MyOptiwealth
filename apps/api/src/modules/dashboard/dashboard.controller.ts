import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('homepage')
  homepage(@CurrentUser() user: AuthUser) {
    return this.dashboardService.homepage(user.activeWorkspaceId);
  }

  @Get('workspaces-overview')
  workspacesOverview(@CurrentUser() user: AuthUser) {
    return this.dashboardService.workspacesOverview(user.sub);
  }
}
