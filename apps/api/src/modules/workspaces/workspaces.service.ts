import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';

const DEFAULT_PROJECT_TYPOLOGIES = [
  'Strategie patrimoniale',
  'Succession',
  'Finance d entreprise',
];

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encryptionService: EncryptionService,
  ) {}

  listForUser(userId: string) {
    return this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      include: {
        workspace: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createByPlatformAdmin(userId: string, _isPlatformAdmin: boolean, dto: CreateWorkspaceDto) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        settings: { create: {} },
        members: {
          create: {
            userId,
            role: WorkspaceRole.ADMIN,
            isDefault: false,
          },
        },
      },
    });

    await this.auditService.log(workspace.id, 'WORKSPACE_CREATED', { name: dto.name }, userId);

    return workspace;
  }

  async switchWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Workspace access denied');
    }

    await this.prisma.userWorkspaceRole.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    await this.prisma.userWorkspaceRole.update({
      where: { userId_workspaceId: { userId, workspaceId } },
      data: { isDefault: true },
    });

    await this.auditService.log(workspaceId, 'WORKSPACE_SWITCH', {}, userId);

    return { activeWorkspaceId: workspaceId };
  }

  async getSettings(workspaceId: string) {
    const settings = await this.prisma.workspaceSettings.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        workspaceId: true,
        imapHost: true,
        imapPort: true,
        imapUser: true,
        projectTypologies: true,
        signatureProvider: true,
        signatureApiBaseUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!settings) {
      return {
        projectTypologies: DEFAULT_PROJECT_TYPOLOGIES,
      };
    }

    const typologies = Array.isArray(settings.projectTypologies)
      ? settings.projectTypologies.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : DEFAULT_PROJECT_TYPOLOGIES;

    return {
      ...settings,
      projectTypologies: typologies.length > 0 ? typologies : DEFAULT_PROJECT_TYPOLOGIES,
    };
  }

  async updateSettings(workspaceId: string, userId: string, dto: UpdateWorkspaceSettingsDto) {
    const imapPasswordEncrypted = dto.imapPassword
      ? this.encryptionService.encrypt(dto.imapPassword)
      : undefined;
    const signatureApiKeyEncrypted = dto.signatureApiKey
      ? this.encryptionService.encrypt(dto.signatureApiKey)
      : undefined;
    const projectTypologies = dto.projectTypologies
      ? Array.from(
          new Set(
            dto.projectTypologies
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          ),
        )
      : undefined;
    const normalizedProjectTypologies = projectTypologies
      ? (projectTypologies.length > 0 ? projectTypologies : DEFAULT_PROJECT_TYPOLOGIES)
      : undefined;

    const settings = await this.prisma.workspaceSettings.upsert({
      where: { workspaceId },
      update: {
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        imapUser: dto.imapUser,
        ...(imapPasswordEncrypted ? { imapPasswordEncrypted } : {}),
        ...(normalizedProjectTypologies ? { projectTypologies: normalizedProjectTypologies } : {}),
        signatureProvider: dto.signatureProvider,
        signatureApiBaseUrl: dto.signatureApiBaseUrl,
        ...(signatureApiKeyEncrypted ? { signatureApiKeyEncrypted } : {}),
      },
      create: {
        workspaceId,
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        imapUser: dto.imapUser,
        imapPasswordEncrypted,
        projectTypologies: normalizedProjectTypologies ?? DEFAULT_PROJECT_TYPOLOGIES,
        signatureProvider: dto.signatureProvider,
        signatureApiBaseUrl: dto.signatureApiBaseUrl,
        signatureApiKeyEncrypted,
      },
      select: {
        id: true,
        workspaceId: true,
        imapHost: true,
        imapPort: true,
        imapUser: true,
        projectTypologies: true,
        signatureProvider: true,
        signatureApiBaseUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.log(
      workspaceId,
      'WORKSPACE_SETTINGS_UPDATED',
      {
        updatedFields: Object.keys(dto),
      },
      userId,
    );

    return settings;
  }
}
