"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const bcrypt = require("bcrypt");
const otplib_1 = require("otplib");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
let AuthService = class AuthService {
    constructor(prisma, jwtService, configService, encryptionService, auditService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.configService = configService;
        this.encryptionService = encryptionService;
        this.auditService = auditService;
    }
    async signTokens(payload) {
        const accessTtl = this.configService.getOrThrow('JWT_ACCESS_TTL');
        const refreshTtl = this.configService.getOrThrow('JWT_REFRESH_TTL');
        const accessToken = await this.jwtService.signAsync(payload, {
            secret: this.configService.getOrThrow('JWT_ACCESS_SECRET'),
            expiresIn: accessTtl,
        });
        const refreshToken = await this.jwtService.signAsync(payload, {
            secret: this.configService.getOrThrow('JWT_REFRESH_SECRET'),
            expiresIn: refreshTtl,
        });
        return { accessToken, refreshToken };
    }
    async persistRefreshToken(userId, refreshToken) {
        const rounds = Number(this.configService.get('BCRYPT_SALT_ROUNDS', '12'));
        const refreshTokenHash = await bcrypt.hash(refreshToken, rounds);
        await this.prisma.user.update({
            where: { id: userId },
            data: { refreshTokenHash },
        });
    }
    async register(dto) {
        const rounds = Number(this.configService.get('BCRYPT_SALT_ROUNDS', '12'));
        const passwordHash = await bcrypt.hash(dto.password, rounds);
        const created = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.user.findUnique({ where: { email: dto.email } });
            if (existing) {
                throw new common_1.BadRequestException('Email already registered');
            }
            const totpSecret = otplib_1.authenticator.generateSecret();
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
            await tx.userWorkspaceRole.create({
                data: {
                    userId: user.id,
                    workspaceId: workspace.id,
                    role: client_1.WorkspaceRole.ADMIN,
                    isDefault: true,
                },
            });
            return { user, workspace, totpSecret };
        });
        await this.auditService.log(created.workspace.id, 'USER_REGISTERED', { email: created.user.email }, created.user.id);
        const payload = {
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
                otpauth: otplib_1.authenticator.keyuri(created.user.email, 'MyOptiwealth', created.totpSecret),
            },
        };
    }
    async login(dto) {
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
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
        if (!validPassword) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        const encryptedSecret = user.twoFactorSecret;
        if (!encryptedSecret) {
            throw new common_1.UnauthorizedException('2FA not configured');
        }
        const secret = this.encryptionService.decrypt(encryptedSecret);
        const validTotp = otplib_1.authenticator.verify({ token: dto.totpCode, secret });
        if (!validTotp) {
            throw new common_1.UnauthorizedException('Invalid 2FA code');
        }
        if (!user.twoFactorEnabled) {
            await this.prisma.user.update({
                where: { id: user.id },
                data: { twoFactorEnabled: true },
            });
        }
        const membership = user.workspaceRoles[0];
        if (!membership) {
            throw new common_1.UnauthorizedException('No workspace membership found');
        }
        const payload = {
            sub: user.id,
            email: user.email,
            activeWorkspaceId: membership.workspaceId,
            isPlatformAdmin: user.isPlatformAdmin,
        };
        const tokens = await this.signTokens(payload);
        await this.persistRefreshToken(user.id, tokens.refreshToken);
        await this.auditService.log(membership.workspaceId, 'USER_LOGIN', { email: user.email }, user.id);
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
    async refresh(refreshToken) {
        const decoded = await this.jwtService.verifyAsync(refreshToken, {
            secret: this.configService.getOrThrow('JWT_REFRESH_SECRET'),
        });
        const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
        if (!user?.refreshTokenHash) {
            throw new common_1.UnauthorizedException('Refresh denied');
        }
        const validRefresh = await bcrypt.compare(refreshToken, user.refreshTokenHash);
        if (!validRefresh) {
            throw new common_1.UnauthorizedException('Refresh denied');
        }
        const payload = {
            sub: decoded.sub,
            email: decoded.email,
            activeWorkspaceId: decoded.activeWorkspaceId,
            isPlatformAdmin: decoded.isPlatformAdmin,
        };
        const tokens = await this.signTokens(payload);
        await this.persistRefreshToken(user.id, tokens.refreshToken);
        return tokens;
    }
    async issueWorkspaceSwitchTokens(userId, email, isPlatformAdmin, workspaceId) {
        const payload = {
            sub: userId,
            email,
            activeWorkspaceId: workspaceId,
            isPlatformAdmin,
        };
        const tokens = await this.signTokens(payload);
        await this.persistRefreshToken(userId, tokens.refreshToken);
        return tokens;
    }
    async verifyTwoFactor(userId, dto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user?.twoFactorSecret) {
            throw new common_1.UnauthorizedException('2FA secret not configured');
        }
        const secret = this.encryptionService.decrypt(user.twoFactorSecret);
        const isValid = otplib_1.authenticator.verify({ token: dto.code, secret });
        if (!isValid) {
            throw new common_1.UnauthorizedException('Invalid 2FA code');
        }
        await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: true },
        });
        return { verified: true };
    }
    async logout(userId, workspaceId) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { refreshTokenHash: null },
        });
        await this.auditService.log(workspaceId, 'USER_LOGOUT', {}, userId);
        return { success: true };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService,
        encryption_service_1.EncryptionService,
        audit_service_1.AuditService])
], AuthService);
//# sourceMappingURL=auth.service.js.map