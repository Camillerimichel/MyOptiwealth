import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CalendarService } from './calendar.service';
import { CreateEventDto } from './dto/create-event.dto';

interface AuthUser {
  activeWorkspaceId: string;
}

@Controller('calendar')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('events')
  list(@CurrentUser() user: AuthUser) {
    return this.calendarService.list(user.activeWorkspaceId);
  }

  @Post('events')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.calendarService.create(user.activeWorkspaceId, dto);
  }

  @Get('exports/weekly.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  exportWeekly(@CurrentUser() user: AuthUser) {
    return this.calendarService.exportWeeklyIcs(user.activeWorkspaceId);
  }
}
