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
exports.DocumentsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
const signature_service_1 = require("./signature.service");
const storage_service_1 = require("./storage.service");
let DocumentsService = class DocumentsService {
    constructor(prisma, auditService, storageService, signatureService, encryptionService, configService) {
        this.prisma = prisma;
        this.auditService = auditService;
        this.storageService = storageService;
        this.signatureService = signatureService;
        this.encryptionService = encryptionService;
        this.configService = configService;
    }
    async list(workspaceId) {
        const documents = await this.prisma.document.findMany({
            where: { workspaceId },
            include: { project: true, task: true, society: true, contact: true },
            orderBy: { createdAt: 'desc' },
        });
        const withFlags = await Promise.all(documents.map(async (document) => ({
            ...document,
            canView: await this.canViewStoragePath(document.storagePath),
        })));
        return withFlags;
    }
    async resolveTaskScope(workspaceId, projectId, taskId) {
        const normalizedProjectId = projectId?.trim() || undefined;
        const normalizedTaskId = taskId?.trim() || undefined;
        if (!normalizedTaskId) {
            return { projectId: normalizedProjectId, taskId: undefined };
        }
        const task = await this.prisma.task.findFirst({
            where: {
                id: normalizedTaskId,
                workspaceId,
            },
            select: {
                id: true,
                projectId: true,
            },
        });
        if (!task) {
            throw new common_1.BadRequestException('Task introuvable dans ce workspace');
        }
        if (normalizedProjectId && normalizedProjectId !== task.projectId) {
            throw new common_1.BadRequestException('Task et projet incohérents');
        }
        return {
            projectId: task.projectId,
            taskId: task.id,
        };
    }
    async create(workspaceId, userId, dto) {
        const scope = await this.resolveTaskScope(workspaceId, dto.projectId, dto.taskId);
        return this.prisma.document.create({
            data: {
                workspaceId,
                title: dto.title,
                storagePath: dto.storagePath,
                projectId: scope.projectId,
                taskId: scope.taskId,
                societyId: dto.societyId,
                contactId: dto.contactId,
            },
        });
    }
    async uploadAndCreate(workspaceId, userId, dto, file) {
        if (!file) {
            throw new common_1.BadRequestException('Missing uploaded file');
        }
        const scope = await this.resolveTaskScope(workspaceId, dto.projectId, dto.taskId);
        const stored = await this.storageService.store(workspaceId, file.originalname, file.mimetype, file.buffer);
        const document = await this.prisma.document.create({
            data: {
                workspaceId,
                title: dto.title?.trim() ? dto.title.trim() : file.originalname,
                storagePath: stored.storagePath,
                projectId: scope.projectId,
                taskId: scope.taskId,
                societyId: dto.societyId,
                contactId: dto.contactId,
            },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_UPLOADED', { documentId: document.id, storagePath: document.storagePath }, userId);
        return document;
    }
    async update(workspaceId, userId, id, dto) {
        const nextTitle = dto.title?.trim();
        if (!nextTitle) {
            throw new common_1.BadRequestException('Titre requis');
        }
        const updated = await this.prisma.document.updateMany({
            where: { id, workspaceId },
            data: { title: nextTitle },
        });
        if (updated.count === 0) {
            throw new common_1.NotFoundException('Document not found in workspace');
        }
        const document = await this.prisma.document.findUniqueOrThrow({
            where: { id },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_UPDATED', { documentId: id, fields: ['title'] }, userId);
        return document;
    }
    async sendForSignature(workspaceId, userId, documentId, dto) {
        const document = await this.prisma.document.findFirst({
            where: { id: documentId, workspaceId },
        });
        if (!document) {
            throw new common_1.NotFoundException('Document not found in workspace');
        }
        const settings = await this.prisma.workspaceSettings.findUnique({
            where: { workspaceId },
        });
        const provider = (dto.provider ?? settings?.signatureProvider ?? 'MOCK');
        const defaultProviderUrl = provider === 'YOUSIGN'
            ? this.configService.get('YOUSIGN_API_BASE_URL')
            : this.configService.get('DOCUSIGN_API_BASE_URL');
        const resolvedBaseUrl = settings?.signatureApiBaseUrl ?? defaultProviderUrl;
        if (provider !== 'MOCK' && (!settings?.signatureApiKeyEncrypted || !resolvedBaseUrl)) {
            throw new common_1.BadRequestException('Missing signature provider configuration in workspace settings');
        }
        const apiKey = settings?.signatureApiKeyEncrypted
            ? this.decryptOrRaw(settings.signatureApiKeyEncrypted)
            : undefined;
        const baseUrl = resolvedBaseUrl ?? undefined;
        const signature = await this.signatureService.sendSignatureRequest({
            provider,
            documentTitle: document.title,
            signerEmail: dto.signerEmail,
            signerName: dto.signerName,
            apiKey,
            baseUrl,
        });
        const updated = await this.prisma.document.update({
            where: { id: document.id },
            data: {
                status: client_1.DocumentStatus.SENT,
                signatureProvider: provider,
                signatureRequestId: signature.externalRequestId,
                signatureState: signature.state,
            },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_SIGNATURE_EVENT', {
            documentId: document.id,
            signatureRequestId: signature.externalRequestId,
            provider,
            status: signature.state,
        }, userId);
        return updated;
    }
    async applySignatureWebhook(workspaceId, dto) {
        const document = await this.prisma.document.findFirst({
            where: {
                workspaceId,
                signatureRequestId: dto.signatureRequestId,
            },
        });
        if (!document) {
            throw new common_1.NotFoundException('Signature request not found');
        }
        const nextStatus = dto.status === 'signed' ? client_1.DocumentStatus.SIGNED : document.status;
        const updated = await this.prisma.document.update({
            where: { id: document.id },
            data: {
                status: nextStatus,
                signatureState: dto.status,
                signatureCertificate: dto.certificate ?? document.signatureCertificate,
            },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_SIGNATURE_EVENT', {
            documentId: document.id,
            signatureRequestId: dto.signatureRequestId,
            status: dto.status,
        }, undefined);
        return updated;
    }
    async markSigned(workspaceId, userId, id, certificate) {
        const updated = await this.prisma.document.updateMany({
            where: { id, workspaceId },
            data: {
                status: client_1.DocumentStatus.SIGNED,
                signatureState: 'signed',
                signatureCertificate: certificate,
            },
        });
        if (updated.count === 0) {
            throw new common_1.NotFoundException('Document not found in workspace');
        }
        const document = await this.prisma.document.findUniqueOrThrow({
            where: { id },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_SIGNATURE_EVENT', { documentId: id, status: 'signed' }, userId);
        return document;
    }
    async markArchived(workspaceId, userId, id) {
        const updated = await this.prisma.document.updateMany({
            where: { id, workspaceId },
            data: { status: client_1.DocumentStatus.ARCHIVED },
        });
        if (updated.count === 0) {
            throw new common_1.NotFoundException('Document not found in workspace');
        }
        const document = await this.prisma.document.findUniqueOrThrow({
            where: { id },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_ARCHIVED', { documentId: id, status: 'archived' }, userId);
        return document;
    }
    async deleteDocument(workspaceId, userId, id) {
        const deleted = await this.prisma.document.deleteMany({
            where: { id, workspaceId },
        });
        if (deleted.count === 0) {
            throw new common_1.NotFoundException('Document not found in workspace');
        }
        await this.auditService.log(workspaceId, 'DOCUMENT_DELETED', { documentId: id }, userId);
        return { success: true };
    }
    async getDocumentBinary(workspaceId, id) {
        const document = await this.prisma.document.findFirst({
            where: { id, workspaceId },
            select: { id: true, storagePath: true, title: true },
        });
        if (!document) {
            throw new common_1.NotFoundException('Document not found in workspace');
        }
        const localPath = this.resolveLocalPath(document.storagePath);
        if (!localPath) {
            throw new common_1.BadRequestException('Visualisation non disponible pour ce type de stockage.');
        }
        let buffer;
        try {
            buffer = await (0, promises_1.readFile)(localPath);
        }
        catch {
            throw new common_1.BadRequestException('Fichier document introuvable sur le stockage.');
        }
        const filename = this.extractOriginalFileName(document.storagePath)
            || (document.title && document.title.trim())
            || (0, path_1.basename)(localPath)
            || 'document.bin';
        const contentType = this.detectContentType(localPath);
        return { buffer, filename, contentType };
    }
    decryptOrRaw(value) {
        try {
            return this.encryptionService.decrypt(value);
        }
        catch {
            return value;
        }
    }
    detectContentType(pathValue) {
        const extension = (0, path_1.extname)(pathValue).toLowerCase();
        if (extension === '.pdf')
            return 'application/pdf';
        if (extension === '.png')
            return 'image/png';
        if (extension === '.jpg' || extension === '.jpeg')
            return 'image/jpeg';
        if (extension === '.doc')
            return 'application/msword';
        if (extension === '.docx')
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (extension === '.xls')
            return 'application/vnd.ms-excel';
        if (extension === '.xlsx')
            return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        if (extension === '.txt')
            return 'text/plain';
        return 'application/octet-stream';
    }
    extractOriginalFileName(storagePath) {
        const normalized = storagePath.replace(/\\/g, '/');
        const leaf = normalized.split('/').pop() ?? '';
        if (!leaf)
            return null;
        const markerIndex = leaf.indexOf('__');
        if (markerIndex < 0)
            return null;
        const candidate = leaf.slice(markerIndex + 2).trim();
        return candidate || null;
    }
    resolveLocalPath(storagePath) {
        if (storagePath.startsWith('file://')) {
            return storagePath.replace('file://', '');
        }
        if (storagePath.startsWith('http://') || storagePath.startsWith('https://') || storagePath.startsWith('s3://')) {
            return null;
        }
        const localBasePath = this.configService.get('DOCUMENT_LOCAL_BASE_PATH', '/var/www/myoptiwealth/storage/documents');
        const normalized = storagePath.replace(/^\/+/, '');
        return `${localBasePath}/${normalized}`;
    }
    async canViewStoragePath(storagePath) {
        const localPath = this.resolveLocalPath(storagePath);
        if (!localPath)
            return false;
        try {
            await (0, promises_1.access)(localPath);
            return true;
        }
        catch {
            return false;
        }
    }
};
exports.DocumentsService = DocumentsService;
exports.DocumentsService = DocumentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        storage_service_1.DocumentStorageService,
        signature_service_1.SignatureService,
        encryption_service_1.EncryptionService,
        config_1.ConfigService])
], DocumentsService);
//# sourceMappingURL=documents.service.js.map