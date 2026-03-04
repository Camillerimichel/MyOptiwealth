import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';
import { LinkProjectContactDto } from './dto/link-project-contact.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectContactDto } from './dto/update-project-contact.dto';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('projects')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projectsService.list(user.activeWorkspaceId);
  }

  @Post()
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.activeWorkspaceId, user.sub, dto);
  }

  @Patch(':projectId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(user.activeWorkspaceId, user.sub, projectId, dto);
  }

  @Get(':projectId/contacts')
  listProjectContacts(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.projectsService.listProjectContacts(user.activeWorkspaceId, projectId);
  }

  @Post(':projectId/contacts')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  addProjectContact(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: LinkProjectContactDto,
  ) {
    return this.projectsService.addProjectContact(user.activeWorkspaceId, user.sub, projectId, dto);
  }

  @Patch(':projectId/contacts/:contactId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  updateProjectContact(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateProjectContactDto,
  ) {
    return this.projectsService.updateProjectContact(user.activeWorkspaceId, user.sub, projectId, contactId, dto);
  }

  @Delete(':projectId/contacts/:contactId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  removeProjectContact(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.projectsService.removeProjectContact(user.activeWorkspaceId, user.sub, projectId, contactId);
  }
}
