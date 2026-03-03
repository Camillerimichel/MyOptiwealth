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
exports.WorkspacesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
const DEFAULT_PROJECT_TYPOLOGIES = [
    'Strategie patrimoniale',
    'Succession',
    'Finance d entreprise',
];
let WorkspacesService = class WorkspacesService {
    constructor(prisma, auditService, encryptionService) {
        this.prisma = prisma;
        this.auditService = auditService;
        this.encryptionService = encryptionService;
    }
    listForUser(userId) {
        return this.prisma.userWorkspaceRole.findMany({
            where: { userId },
            include: {
                workspace: true,
            },
            orderBy: { createdAt: 'asc' },
        });
    }
    async createByPlatformAdmin(userId, _isPlatformAdmin, dto) {
        const workspace = await this.prisma.workspace.create({
            data: {
                name: dto.name,
                settings: { create: {} },
                members: {
                    create: {
                        userId,
                        role: client_1.WorkspaceRole.ADMIN,
                        isDefault: false,
                    },
                },
            },
        });
        await this.auditService.log(workspace.id, 'WORKSPACE_CREATED', { name: dto.name }, userId);
        return workspace;
    }
    async switchWorkspace(userId, workspaceId) {
        const membership = await this.prisma.userWorkspaceRole.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
        });
        if (!membership) {
            throw new common_1.ForbiddenException('Workspace access denied');
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
    async getSettings(workspaceId) {
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
            ? settings.projectTypologies.filter((item) => typeof item === 'string' && item.trim().length > 0)
            : DEFAULT_PROJECT_TYPOLOGIES;
        return {
            ...settings,
            projectTypologies: typologies.length > 0 ? typologies : DEFAULT_PROJECT_TYPOLOGIES,
        };
    }
    async updateSettings(workspaceId, userId, dto) {
        const imapPasswordEncrypted = dto.imapPassword
            ? this.encryptionService.encrypt(dto.imapPassword)
            : undefined;
        const signatureApiKeyEncrypted = dto.signatureApiKey
            ? this.encryptionService.encrypt(dto.signatureApiKey)
            : undefined;
        const projectTypologies = dto.projectTypologies
            ? Array.from(new Set(dto.projectTypologies
                .map((item) => item.trim())
                .filter((item) => item.length > 0)))
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
        await this.auditService.log(workspaceId, 'WORKSPACE_SETTINGS_UPDATED', {
            updatedFields: Object.keys(dto),
        }, userId);
        return settings;
    }
};
exports.WorkspacesService = WorkspacesService;
exports.WorkspacesService = WorkspacesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        encryption_service_1.EncryptionService])
], WorkspacesService);
//# sourceMappingURL=workspaces.service.js.map