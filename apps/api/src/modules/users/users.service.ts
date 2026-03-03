import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateWorkspaceUserDto } from './dto/create-workspace-user.dto';
import { UpdateWorkspaceUserDto } from './dto/update-workspace-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
  ) {}

  listWorkspaceUsers(workspaceId: string) {
    return this.prisma.userWorkspaceRole.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            createdAt: true,
            updatedAt: true,
            isPlatformAdmin: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateWorkspaceUser(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    dto: UpdateWorkspaceUserDto,
  ) {
    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId: targetUserId,
          workspaceId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Utilisateur introuvable dans ce workspace');
    }

    if (targetUserId === actorUserId && dto.role && dto.role !== membership.role) {
      throw new ForbiddenException('Tu ne peux pas modifier ton propre role');
    }

    const updatedUserRole = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          firstName: dto.firstName === undefined ? undefined : dto.firstName || null,
          lastName: dto.lastName === undefined ? undefined : dto.lastName || null,
        },
      });

      return tx.userWorkspaceRole.update({
        where: { id: membership.id },
        data: {
          role: dto.role ?? membership.role,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              createdAt: true,
              updatedAt: true,
              isPlatformAdmin: true,
            },
          },
        },
      });
    });

    await this.auditService.log(
      workspaceId,
      'WORKSPACE_USER_UPDATED',
      {
        targetUserId,
        role: dto.role ?? membership.role,
        firstNameUpdated: dto.firstName !== undefined,
        lastNameUpdated: dto.lastName !== undefined,
      },
      actorUserId,
    );

    return {
      user: updatedUserRole.user,
      role: updatedUserRole.role as WorkspaceRole,
      isDefault: updatedUserRole.isDefault,
    };
  }

  async createWorkspaceUser(
    workspaceId: string,
    actorUserId: string,
    dto: CreateWorkspaceUserDto,
  ) {
    const rounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'));
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existing) {
      const existingMembership = await this.prisma.userWorkspaceRole.findUnique({
        where: {
          userId_workspaceId: {
            userId: existing.id,
            workspaceId,
          },
        },
      });
      if (existingMembership) {
        throw new BadRequestException('Cet utilisateur existe deja dans ce workspace');
      }

      const membership = await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: existing.id },
          data: {
            firstName: dto.firstName === undefined ? undefined : dto.firstName || null,
            lastName: dto.lastName === undefined ? undefined : dto.lastName || null,
          },
        });
        return tx.userWorkspaceRole.create({
          data: {
            userId: existing.id,
            workspaceId,
            role: dto.role,
            isDefault: false,
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                createdAt: true,
                updatedAt: true,
                isPlatformAdmin: true,
              },
            },
          },
        });
      });

      await this.auditService.log(
        workspaceId,
        'WORKSPACE_USER_CREATED',
        { targetUserId: existing.id, role: dto.role, reusedExistingUser: true },
        actorUserId,
      );

      return { user: membership.user, role: membership.role, isDefault: membership.isDefault };
    }

    const passwordHash = await bcrypt.hash(dto.password, rounds);
    const totpSecret = authenticator.generateSecret();
    const encryptedTotpSecret = this.encryptionService.encrypt(totpSecret);

    const membership = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          firstName: dto.firstName || null,
          lastName: dto.lastName || null,
          passwordHash,
          twoFactorSecret: encryptedTotpSecret,
          twoFactorEnabled: false,
        },
      });

      return tx.userWorkspaceRole.create({
        data: {
          role: dto.role,
          isDefault: false,
          workspaceId,
          userId: user.id,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              createdAt: true,
              updatedAt: true,
              isPlatformAdmin: true,
            },
          },
        },
      });
    });

    await this.auditService.log(
      workspaceId,
      'WORKSPACE_USER_CREATED',
      { targetUserId: membership.user.id, role: dto.role, reusedExistingUser: false },
      actorUserId,
    );

    return {
      user: membership.user,
      role: membership.role,
      isDefault: membership.isDefault,
      twoFactorProvisioning: {
        secret: totpSecret,
        otpauth: authenticator.keyuri(membership.user.email, 'MyOptiwealth', totpSecret),
      },
    };
  }

  async getUserTwoFactorProvisioning(workspaceId: string, targetUserId: string) {
    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId: targetUserId,
          workspaceId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            twoFactorSecret: true,
            twoFactorEnabled: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Utilisateur introuvable dans ce workspace');
    }

    let secret = membership.user.twoFactorSecret
      ? this.encryptionService.decrypt(membership.user.twoFactorSecret)
      : null;

    if (!secret) {
      secret = authenticator.generateSecret();
      const encrypted = this.encryptionService.encrypt(secret);
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { twoFactorSecret: encrypted, twoFactorEnabled: false },
      });
    }

    return {
      userId: membership.user.id,
      email: membership.user.email,
      twoFactorEnabled: membership.user.twoFactorEnabled,
      secret,
      otpauth: authenticator.keyuri(membership.user.email, 'MyOptiwealth', secret),
    };
  }
}
