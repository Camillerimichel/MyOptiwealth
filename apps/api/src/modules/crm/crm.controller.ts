import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateSocietyDto } from './dto/create-society.dto';
import { CrmService } from './crm.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateSocietyDto } from './dto/update-society.dto';

interface AuthUser {
  sub: string;
  activeWorkspaceId: string;
}

@Controller('crm')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('societies')
  listSocieties(@CurrentUser() user: AuthUser) {
    return this.crmService.listSocieties(user.activeWorkspaceId);
  }

  @Get('societies/all')
  listSocietiesAll(@CurrentUser() user: AuthUser) {
    return this.crmService.listSocietiesAll(user.sub);
  }

  @Post('societies')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  createSociety(@CurrentUser() user: AuthUser, @Body() dto: CreateSocietyDto) {
    return this.crmService.createSociety(user.activeWorkspaceId, dto);
  }

  @Patch('societies/:societyId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  updateSociety(
    @CurrentUser() user: AuthUser,
    @Param('societyId') societyId: string,
    @Body() dto: UpdateSocietyDto,
  ) {
    return this.crmService.updateSociety(user.activeWorkspaceId, societyId, dto);
  }

  @Get('contacts')
  listContacts(@CurrentUser() user: AuthUser) {
    return this.crmService.listContacts(user.activeWorkspaceId);
  }

  @Get('contacts/all')
  listContactsAll(@CurrentUser() user: AuthUser) {
    return this.crmService.listContactsAll(user.sub);
  }

  @Post('contacts')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  createContact(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.crmService.createContact(user.activeWorkspaceId, dto);
  }

  @Patch('contacts/:contactId')
  @WorkspaceRoles(WorkspaceRole.ADMIN, WorkspaceRole.COLLABORATOR)
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.crmService.updateContact(user.activeWorkspaceId, contactId, dto);
  }
}
