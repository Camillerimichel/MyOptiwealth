import { Body, Controller, Delete, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CalendarService } from './calendar.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

interface AuthUser {
  sub: string;
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

  @Get('feed')
  feed(@CurrentUser() user: AuthUser) {
    return this.calendarService.unifiedFeed(user.sub, user.activeWorkspaceId);
  }

  @Post('events')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.calendarService.create(user.activeWorkspaceId, dto);
  }

  @Patch('events/:eventId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  update(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string, @Body() dto: UpdateEventDto) {
    return this.calendarService.update(user.activeWorkspaceId, eventId, dto);
  }

  @Delete('events/:eventId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  remove(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    return this.calendarService.remove(user.activeWorkspaceId, eventId);
  }

  @Get('exports/weekly.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  exportWeekly(@CurrentUser() user: AuthUser) {
    return this.calendarService.exportWeeklyIcs(user.activeWorkspaceId);
  }
}
