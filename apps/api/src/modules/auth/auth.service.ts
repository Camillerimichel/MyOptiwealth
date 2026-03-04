import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { StringValue } from 'ms';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyTwoFactorDto } from './dto/verify-2fa.dto';

export interface TokenPayload {
  sub: string;
  email: string;
  activeWorkspaceId: string;
  isPlatformAdmin: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {}

  private async signTokens(payload: TokenPayload): Promise<TokenPair> {
    const accessTtl = this.configService.getOrThrow<string>(
      'JWT_ACCESS_TTL',
    ) as StringValue;
    const refreshTtl = this.configService.getOrThrow<string>(
      'JWT_REFRESH_TTL',
    ) as StringValue;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtl,
    });

    return { accessToken, refreshToken };
  }

  private async persistRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const rounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'));
    const refreshTokenHash = await bcrypt.hash(refreshToken, rounds);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });
  }

  async register(dto: RegisterDto) {
    const rounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'));
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.user.findUnique({ where: { email: dto.email } });
      if (existing) {
        throw new BadRequestException('Email already registered');
      }

      const totpSecret = authenticator.generateSecret();
      const encryptedTotpSecret = this.encryptionService.encrypt(totpSecret);

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          twoFactorSecret: encryptedTotpSecret,
          twoFactorEnabled: false,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: dto.workspaceName,
          settings: {
            create: {},
          },
        },
      });

      const associatedSociety = await tx.society.create({
        data: {
          workspaceId: workspace.id,
          name: dto.workspaceName,
        },
      });
      await tx.workspaceSettings.update({
        where: { workspaceId: workspace.id },
        data: { associatedSocietyId: associatedSociety.id },
      });

      await tx.userWorkspaceRole.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          role: WorkspaceRole.ADMIN,
          isDefault: true,
        },
      });

      return { user, workspace, totpSecret };
    });

    await this.auditService.log(
      created.workspace.id,
      'USER_REGISTERED',
      { email: created.user.email },
      created.user.id,
    );

    const payload: TokenPayload = {
      sub: created.user.id,
      email: created.user.email,
      activeWorkspaceId: created.workspace.id,
      isPlatformAdmin: created.user.isPlatformAdmin,
    };

    const tokens = await this.signTokens(payload);
    await this.persistRefreshToken(created.user.id, tokens.refreshToken);

    return {
      user: {
        id: created.user.id,
        email: created.user.email,
        twoFactorEnabled: created.user.twoFactorEnabled,
      },
      workspace: {
        id: created.workspace.id,
        name: created.workspace.name,
      },
      tokens,
      twoFactorProvisioning: {
        secret: created.totpSecret,
        otpauth: authenticator.keyuri(created.user.email, 'MyOptiwealth', created.totpSecret),
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        workspaceRoles: {
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = user.workspaceRoles[0];
    if (!membership) {
      throw new UnauthorizedException('No workspace membership found');
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      activeWorkspaceId: membership.workspaceId,
      isPlatformAdmin: user.isPlatformAdmin,
    };

    const tokens = await this.signTokens(payload);
    await this.persistRefreshToken(user.id, tokens.refreshToken);

    await this.auditService.log(
      membership.workspaceId,
      'USER_LOGIN',
      { email: user.email },
      user.id,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeWorkspaceId: membership.workspaceId,
      tokens,
    };
  }

  async refresh(refreshToken: string) {
    const decoded = await this.jwtService.verifyAsync<TokenPayload & { iat?: number; exp?: number }>(refreshToken, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });

    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });

    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh denied');
    }

    const validRefresh = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!validRefresh) {
      throw new UnauthorizedException('Refresh denied');
    }

    const payload: TokenPayload = {
      sub: decoded.sub,
      email: decoded.email,
      activeWorkspaceId: decoded.activeWorkspaceId,
      isPlatformAdmin: decoded.isPlatformAdmin,
    };

    const tokens = await this.signTokens(payload);
    await this.persistRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async issueWorkspaceSwitchTokens(
    userId: string,
    email: string,
    isPlatformAdmin: boolean,
    workspaceId: string,
  ): Promise<TokenPair> {
    const payload: TokenPayload = {
      sub: userId,
      email,
      activeWorkspaceId: workspaceId,
      isPlatformAdmin,
    };

    const tokens = await this.signTokens(payload);
    await this.persistRefreshToken(userId, tokens.refreshToken);
    return tokens;
  }

  async verifyTwoFactor(userId: string, dto: VerifyTwoFactorDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) {
      throw new UnauthorizedException('2FA secret not configured');
    }

    const secret = this.encryptionService.decrypt(user.twoFactorSecret);
    const isValid = authenticator.verify({ token: dto.code, secret });

    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    return { verified: true };
  }

  async logout(userId: string, workspaceId: string): Promise<{ success: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    await this.auditService.log(workspaceId, 'USER_LOGOUT', {}, userId);

    return { success: true };
  }
}
