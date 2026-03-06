import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';

const DEFAULT_PROJECT_TYPOLOGIES = [
  'Strategie patrimoniale',
  'Succession',
  'Finance d entreprise',
];

const workspaceNameCollator = new Intl.Collator('fr', { sensitivity: 'base' });

function normalizeForSort(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function compareWorkspaceByName(
  left: { workspace: { name: string } },
  right: { workspace: { name: string } },
): number {
  return workspaceNameCollator.compare(
    normalizeForSort(left.workspace.name),
    normalizeForSort(right.workspace.name),
  );
}

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
    }).then((memberships) => memberships.sort(compareWorkspaceByName));
  }

  private async getGlobalProjectTypologies(): Promise<string[]> {
    const recentSettings = await this.prisma.workspaceSettings.findMany({
      select: {
        projectTypologies: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 50,
    });

    const firstNonEmpty = recentSettings.find((setting) => {
      const values = setting.projectTypologies;
      return Array.isArray(values) && values.some((item) => typeof item === 'string' && item.trim().length > 0);
    });
    const values = Array.isArray(firstNonEmpty?.projectTypologies)
      ? firstNonEmpty.projectTypologies.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    return values.length > 0 ? values : DEFAULT_PROJECT_TYPOLOGIES;
  }

  private async requireAdminMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
      select: {
        role: true,
        isDefault: true,
      },
    });

    if (!membership || membership.role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException('Action réservée à un ADMIN du workspace');
    }

    return membership;
  }

  async createByPlatformAdmin(userId: string, _isPlatformAdmin: boolean, dto: CreateWorkspaceDto) {
    const memberships = await this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const allowedWorkspaceIds = memberships.map((item) => item.workspaceId);
    const sourceSociety = await this.prisma.society.findFirst({
      where: {
        id: dto.associatedSocietyId,
        workspaceId: { in: allowedWorkspaceIds },
      },
    });
    if (!sourceSociety) {
      throw new ForbiddenException('Societe associée invalide');
    }

    const workspace = await this.prisma.$transaction(async (tx) => {
      const createdWorkspace = await tx.workspace.create({
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

      const clonedSociety = await tx.society.create({
        data: {
          workspaceId: createdWorkspace.id,
          name: sourceSociety.name,
          legalForm: sourceSociety.legalForm,
          siren: sourceSociety.siren,
          siret: sourceSociety.siret,
          addressLine1: sourceSociety.addressLine1,
          addressLine2: sourceSociety.addressLine2,
          postalCode: sourceSociety.postalCode,
          city: sourceSociety.city,
          country: sourceSociety.country,
        },
      });
      await tx.workspaceSettings.update({
        where: { workspaceId: createdWorkspace.id },
        data: { associatedSocietyId: clonedSociety.id },
      });

      return createdWorkspace;
    });

    await this.auditService.log(
      workspace.id,
      'WORKSPACE_CREATED',
      { name: dto.name, associatedSocietyId: dto.associatedSocietyId },
      userId,
    );

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

  async updateWorkspace(userId: string, workspaceId: string, dto: UpdateWorkspaceDto) {
    await this.requireAdminMembership(userId, workspaceId);

    const name = dto.name?.trim();
    const associatedSocietyId = dto.associatedSocietyId?.trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      let nextAssociatedSocietyId: string | undefined;
      if (associatedSocietyId) {
        const sourceSociety = await tx.society.findUnique({
          where: { id: associatedSocietyId },
        });

        if (!sourceSociety) {
          throw new ForbiddenException('Societe associée invalide');
        }

        const sourceMembership = await tx.userWorkspaceRole.findUnique({
          where: {
            userId_workspaceId: {
              userId,
              workspaceId: sourceSociety.workspaceId,
            },
          },
          select: { id: true },
        });

        if (!sourceMembership) {
          throw new ForbiddenException('Societe associée invalide');
        }

        if (sourceSociety.workspaceId === workspaceId) {
          nextAssociatedSocietyId = sourceSociety.id;
        } else {
          const clonedSociety = await tx.society.create({
            data: {
              workspaceId,
              name: sourceSociety.name,
              legalForm: sourceSociety.legalForm,
              siren: sourceSociety.siren,
              siret: sourceSociety.siret,
              addressLine1: sourceSociety.addressLine1,
              addressLine2: sourceSociety.addressLine2,
              postalCode: sourceSociety.postalCode,
              city: sourceSociety.city,
              country: sourceSociety.country,
            },
            select: { id: true },
          });
          nextAssociatedSocietyId = clonedSociety.id;
        }
      }

      if (name) {
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { name },
        });
      }

      if (nextAssociatedSocietyId) {
        await tx.workspaceSettings.upsert({
          where: { workspaceId },
          update: { associatedSocietyId: nextAssociatedSocietyId },
          create: { workspaceId, associatedSocietyId: nextAssociatedSocietyId },
        });
      }

      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true },
      });
      const settings = await tx.workspaceSettings.findUnique({
        where: { workspaceId },
        select: { associatedSocietyId: true },
      });

      return {
        workspace,
        associatedSocietyId: settings?.associatedSocietyId ?? null,
      };
    });

    await this.auditService.log(
      workspaceId,
      'WORKSPACE_UPDATED',
      {
        updatedFields: Object.keys(dto),
      },
      userId,
    );

    return updated;
  }

  async deleteWorkspace(userId: string, workspaceId: string, confirmation: string) {
    if (confirmation !== 'SUPPRESSION') {
      throw new ForbiddenException('Confirmation invalide');
    }

    const membership = await this.requireAdminMembership(userId, workspaceId);
    if (membership.isDefault) {
      throw new ForbiddenException('Passe d abord sur un autre workspace avant suppression');
    }

    const membershipCount = await this.prisma.userWorkspaceRole.count({
      where: { userId },
    });
    if (membershipCount <= 1) {
      throw new ForbiddenException('Au moins un workspace doit rester actif');
    }

    await this.prisma.workspace.delete({
      where: { id: workspaceId },
    });

    return { deleted: true, workspaceId };
  }

  async getSettings(workspaceId: string) {
    const globalProjectTypologies = await this.getGlobalProjectTypologies();
    const platformSettings = await this.prisma.platformSettings.findUnique({
      where: { singletonKey: 'GLOBAL' },
      select: { imapHost: true, imapPort: true, imapUser: true },
    });
    const settings = await this.prisma.workspaceSettings.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        workspaceId: true,
        projectTypologies: true,
        associatedSocietyId: true,
        signatureProvider: true,
        signatureApiBaseUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });

    if (!settings) {
      return {
        workspaceName: workspace?.name ?? '',
        imapHost: platformSettings?.imapHost ?? null,
        imapPort: platformSettings?.imapPort ?? null,
        imapUser: platformSettings?.imapUser ?? null,
        projectTypologies: globalProjectTypologies,
      };
    }

    return {
      ...settings,
      imapHost: platformSettings?.imapHost ?? null,
      imapPort: platformSettings?.imapPort ?? null,
      imapUser: platformSettings?.imapUser ?? null,
      workspaceName: workspace?.name ?? '',
      projectTypologies: globalProjectTypologies,
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
    const associatedSocietyId = dto.associatedSocietyId?.trim()
      ? dto.associatedSocietyId.trim()
      : undefined;
    if (associatedSocietyId) {
      const society = await this.prisma.society.findFirst({
        where: {
          id: associatedSocietyId,
          workspaceId,
        },
        select: { id: true },
      });
      if (!society) {
        throw new ForbiddenException('Societe associée invalide pour ce workspace');
      }
    }
    const workspaceName = dto.workspaceName?.trim();
    if (workspaceName) {
      await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { name: workspaceName },
      });
    }

    if (dto.imapHost !== undefined || dto.imapPort !== undefined || dto.imapUser !== undefined || imapPasswordEncrypted) {
      const platformUpdateData: {
        imapHost?: string;
        imapPort?: number;
        imapUser?: string;
        imapPasswordEncrypted?: string;
      } = {};
      if (dto.imapHost !== undefined) {
        platformUpdateData.imapHost = dto.imapHost;
      }
      if (dto.imapPort !== undefined) {
        platformUpdateData.imapPort = dto.imapPort;
      }
      if (dto.imapUser !== undefined) {
        platformUpdateData.imapUser = dto.imapUser;
      }
      if (imapPasswordEncrypted) {
        platformUpdateData.imapPasswordEncrypted = imapPasswordEncrypted;
      }

      await this.prisma.platformSettings.upsert({
        where: { singletonKey: 'GLOBAL' },
        update: platformUpdateData,
        create: {
          singletonKey: 'GLOBAL',
          ...platformUpdateData,
        },
      });
    }

    const settings = await this.prisma.workspaceSettings.upsert({
      where: { workspaceId },
      update: {
        ...(normalizedProjectTypologies ? { projectTypologies: normalizedProjectTypologies } : {}),
        ...(associatedSocietyId ? { associatedSocietyId } : {}),
        signatureProvider: dto.signatureProvider,
        signatureApiBaseUrl: dto.signatureApiBaseUrl,
        ...(signatureApiKeyEncrypted ? { signatureApiKeyEncrypted } : {}),
      },
      create: {
        workspaceId,
        projectTypologies: normalizedProjectTypologies ?? DEFAULT_PROJECT_TYPOLOGIES,
        associatedSocietyId,
        signatureProvider: dto.signatureProvider,
        signatureApiBaseUrl: dto.signatureApiBaseUrl,
        signatureApiKeyEncrypted,
      },
      select: {
        id: true,
        workspaceId: true,
        projectTypologies: true,
        associatedSocietyId: true,
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

    if (normalizedProjectTypologies) {
      await this.prisma.workspaceSettings.updateMany({
        data: {
          projectTypologies: normalizedProjectTypologies,
        },
      });
    }

    const platformSettings = await this.prisma.platformSettings.findUnique({
      where: { singletonKey: 'GLOBAL' },
      select: { imapHost: true, imapPort: true, imapUser: true },
    });

    return {
      ...settings,
      imapHost: platformSettings?.imapHost ?? null,
      imapPort: platformSettings?.imapPort ?? null,
      imapUser: platformSettings?.imapUser ?? null,
    };
  }
}
