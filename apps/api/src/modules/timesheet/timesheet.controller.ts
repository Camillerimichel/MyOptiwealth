import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
import { TimesheetService } from './timesheet.service';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('timesheet')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class TimesheetController {
  constructor(private readonly timesheetService: TimesheetService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.timesheetService.list(user.activeWorkspaceId);
  }

  @Get('totals')
  totals(@CurrentUser() user: AuthUser) {
    return this.timesheetService.totals(user.activeWorkspaceId);
  }

  @Post()
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTimeEntryDto) {
    return this.timesheetService.create(user.activeWorkspaceId, user.sub, dto);
  }
}
