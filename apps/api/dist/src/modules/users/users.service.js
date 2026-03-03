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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcrypt");
const otplib_1 = require("otplib");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
let UsersService = class UsersService {
    constructor(prisma, auditService, configService, encryptionService) {
        this.prisma = prisma;
        this.auditService = auditService;
        this.configService = configService;
        this.encryptionService = encryptionService;
    }
    listWorkspaceUsers(workspaceId) {
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
    async updateWorkspaceUser(workspaceId, actorUserId, targetUserId, dto) {
        const membership = await this.prisma.userWorkspaceRole.findUnique({
            where: {
                userId_workspaceId: {
                    userId: targetUserId,
                    workspaceId,
                },
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('Utilisateur introuvable dans ce workspace');
        }
        if (targetUserId === actorUserId && dto.role && dto.role !== membership.role) {
            throw new common_1.ForbiddenException('Tu ne peux pas modifier ton propre role');
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
        await this.auditService.log(workspaceId, 'WORKSPACE_USER_UPDATED', {
            targetUserId,
            role: dto.role ?? membership.role,
            firstNameUpdated: dto.firstName !== undefined,
            lastNameUpdated: dto.lastName !== undefined,
        }, actorUserId);
        return {
            user: updatedUserRole.user,
            role: updatedUserRole.role,
            isDefault: updatedUserRole.isDefault,
        };
    }
    async createWorkspaceUser(workspaceId, actorUserId, dto) {
        const rounds = Number(this.configService.get('BCRYPT_SALT_ROUNDS', '12'));
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
                throw new common_1.BadRequestException('Cet utilisateur existe deja dans ce workspace');
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
            await this.auditService.log(workspaceId, 'WORKSPACE_USER_CREATED', { targetUserId: existing.id, role: dto.role, reusedExistingUser: true }, actorUserId);
            return { user: membership.user, role: membership.role, isDefault: membership.isDefault };
        }
        const passwordHash = await bcrypt.hash(dto.password, rounds);
        const totpSecret = otplib_1.authenticator.generateSecret();
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
        await this.auditService.log(workspaceId, 'WORKSPACE_USER_CREATED', { targetUserId: membership.user.id, role: dto.role, reusedExistingUser: false }, actorUserId);
        return {
            user: membership.user,
            role: membership.role,
            isDefault: membership.isDefault,
            twoFactorProvisioning: {
                secret: totpSecret,
                otpauth: otplib_1.authenticator.keyuri(membership.user.email, 'MyOptiwealth', totpSecret),
            },
        };
    }
    async getUserTwoFactorProvisioning(workspaceId, targetUserId) {
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
            throw new common_1.NotFoundException('Utilisateur introuvable dans ce workspace');
        }
        let secret = membership.user.twoFactorSecret
            ? this.encryptionService.decrypt(membership.user.twoFactorSecret)
            : null;
        if (!secret) {
            secret = otplib_1.authenticator.generateSecret();
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
            otpauth: otplib_1.authenticator.keyuri(membership.user.email, 'MyOptiwealth', secret),
        };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        config_1.ConfigService,
        encryption_service_1.EncryptionService])
], UsersService);
//# sourceMappingURL=users.service.js.map