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
    list(workspaceId) {
        return this.prisma.document.findMany({
            where: { workspaceId },
            include: { project: true, society: true, contact: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    create(workspaceId, userId, dto) {
        return this.prisma.document.create({
            data: {
                workspaceId,
                title: dto.title,
                storagePath: dto.storagePath,
                projectId: dto.projectId,
                societyId: dto.societyId,
                contactId: dto.contactId,
            },
        });
    }
    async uploadAndCreate(workspaceId, userId, dto, file) {
        if (!file) {
            throw new common_1.BadRequestException('Missing uploaded file');
        }
        const stored = await this.storageService.store(workspaceId, file.originalname, file.mimetype, file.buffer);
        const document = await this.prisma.document.create({
            data: {
                workspaceId,
                title: dto.title,
                storagePath: stored.storagePath,
                projectId: dto.projectId,
                societyId: dto.societyId,
                contactId: dto.contactId,
            },
        });
        await this.auditService.log(workspaceId, 'DOCUMENT_UPLOADED', { documentId: document.id, storagePath: document.storagePath }, userId);
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
    decryptOrRaw(value) {
        try {
            return this.encryptionService.decrypt(value);
        }
        catch {
            return value;
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