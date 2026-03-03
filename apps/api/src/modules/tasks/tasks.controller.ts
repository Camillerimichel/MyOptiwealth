import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CreateTaskDto } from './dto/create-task.dto';
import { TasksService } from './tasks.service';
import { UpdateTaskDto } from './dto/update-task.dto';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('tasks')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('kanban')
  listKanban(@CurrentUser() user: AuthUser) {
    return this.tasksService.listKanban(user.activeWorkspaceId);
  }

  @Post()
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(user.activeWorkspaceId, user.sub, dto);
  }

  @Patch(':taskId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  update(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(user.activeWorkspaceId, user.sub, taskId, dto);
  }

  @Delete(':taskId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  remove(@CurrentUser() user: AuthUser, @Param('taskId') taskId: string) {
    return this.tasksService.remove(user.activeWorkspaceId, user.sub, taskId);
  }
}
