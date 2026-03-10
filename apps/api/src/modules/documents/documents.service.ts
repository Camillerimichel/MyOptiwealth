import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus } from '@prisma/client';
import { access, readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SendSignatureRequestDto } from './dto/send-signature-request.dto';
import { SignatureWebhookDto } from './dto/signature-webhook.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { SignatureService } from './signature.service';
import { DocumentStorageService } from './storage.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly storageService: DocumentStorageService,
    private readonly signatureService: SignatureService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async list(workspaceId: string) {
    const documents = await this.prisma.document.findMany({
      where: { workspaceId },
      include: { project: true, task: true, society: true, contact: true },
      orderBy: { createdAt: 'desc' },
    });
    const withFlags = await Promise.all(
      documents.map(async (document) => ({
        ...document,
        canView: await this.canViewStoragePath(document.storagePath),
      })),
    );
    return withFlags;
  }

  private async resolveTaskScope(
    workspaceId: string,
    projectId?: string,
    taskId?: string,
  ): Promise<{ projectId?: string; taskId?: string }> {
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
      throw new BadRequestException('Task introuvable dans ce workspace');
    }
    if (normalizedProjectId && normalizedProjectId !== task.projectId) {
      throw new BadRequestException('Task et projet incohérents');
    }

    return {
      projectId: task.projectId,
      taskId: task.id,
    };
  }

  async create(workspaceId: string, userId: string, dto: CreateDocumentDto) {
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

  async uploadAndCreate(
    workspaceId: string,
    userId: string,
    dto: UploadDocumentDto,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    if (!file) {
      throw new BadRequestException('Missing uploaded file');
    }

    const scope = await this.resolveTaskScope(workspaceId, dto.projectId, dto.taskId);

    const stored = await this.storageService.store(
      workspaceId,
      file.originalname,
      file.mimetype,
      file.buffer,
    );

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

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_UPLOADED',
      { documentId: document.id, storagePath: document.storagePath },
      userId,
    );

    return document;
  }

  async update(workspaceId: string, userId: string, id: string, dto: UpdateDocumentDto) {
    const nextTitle = dto.title?.trim();
    if (!nextTitle) {
      throw new BadRequestException('Titre requis');
    }

    const updated = await this.prisma.document.updateMany({
      where: { id, workspaceId },
      data: { title: nextTitle },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Document not found in workspace');
    }

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id },
    });

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_UPDATED',
      { documentId: id, fields: ['title'] },
      userId,
    );

    return document;
  }

  async sendForSignature(
    workspaceId: string,
    userId: string,
    documentId: string,
    dto: SendSignatureRequestDto,
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, workspaceId },
    });

    if (!document) {
      throw new NotFoundException('Document not found in workspace');
    }

    const settings = await this.prisma.workspaceSettings.findUnique({
      where: { workspaceId },
    });

    const provider =
      (dto.provider ?? settings?.signatureProvider ?? 'MOCK') as
        | 'YOUSIGN'
        | 'DOCUSIGN'
        | 'MOCK';

    const defaultProviderUrl =
      provider === 'YOUSIGN'
        ? this.configService.get<string>('YOUSIGN_API_BASE_URL')
        : this.configService.get<string>('DOCUSIGN_API_BASE_URL');
    const resolvedBaseUrl = settings?.signatureApiBaseUrl ?? defaultProviderUrl;

    if (provider !== 'MOCK' && (!settings?.signatureApiKeyEncrypted || !resolvedBaseUrl)) {
      throw new BadRequestException('Missing signature provider configuration in workspace settings');
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
        status: DocumentStatus.SENT,
        signatureProvider: provider,
        signatureRequestId: signature.externalRequestId,
        signatureState: signature.state,
      },
    });

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_SIGNATURE_EVENT',
      {
        documentId: document.id,
        signatureRequestId: signature.externalRequestId,
        provider,
        status: signature.state,
      },
      userId,
    );

    return updated;
  }

  async applySignatureWebhook(workspaceId: string, dto: SignatureWebhookDto) {
    const document = await this.prisma.document.findFirst({
      where: {
        workspaceId,
        signatureRequestId: dto.signatureRequestId,
      },
    });

    if (!document) {
      throw new NotFoundException('Signature request not found');
    }

    const nextStatus = dto.status === 'signed' ? DocumentStatus.SIGNED : document.status;

    const updated = await this.prisma.document.update({
      where: { id: document.id },
      data: {
        status: nextStatus,
        signatureState: dto.status,
        signatureCertificate: dto.certificate ?? document.signatureCertificate,
      },
    });

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_SIGNATURE_EVENT',
      {
        documentId: document.id,
        signatureRequestId: dto.signatureRequestId,
        status: dto.status,
      },
      undefined,
    );

    return updated;
  }

  async markSigned(workspaceId: string, userId: string, id: string, certificate: string) {
    const updated = await this.prisma.document.updateMany({
      where: { id, workspaceId },
      data: {
        status: DocumentStatus.SIGNED,
        signatureState: 'signed',
        signatureCertificate: certificate,
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Document not found in workspace');
    }

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id },
    });

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_SIGNATURE_EVENT',
      { documentId: id, status: 'signed' },
      userId,
    );

    return document;
  }

  async markArchived(workspaceId: string, userId: string, id: string) {
    const updated = await this.prisma.document.updateMany({
      where: { id, workspaceId },
      data: { status: DocumentStatus.ARCHIVED },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Document not found in workspace');
    }

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id },
    });

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_ARCHIVED',
      { documentId: id, status: 'archived' },
      userId,
    );

    return document;
  }

  async deleteDocument(workspaceId: string, userId: string, id: string) {
    const deleted = await this.prisma.document.deleteMany({
      where: { id, workspaceId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Document not found in workspace');
    }

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_DELETED',
      { documentId: id },
      userId,
    );

    return { success: true };
  }

  async getDocumentBinary(workspaceId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, workspaceId },
      select: { id: true, storagePath: true, title: true },
    });
    if (!document) {
      throw new NotFoundException('Document not found in workspace');
    }

    const localPath = this.resolveLocalPath(document.storagePath);
    if (!localPath) {
      throw new BadRequestException('Visualisation non disponible pour ce type de stockage.');
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(localPath);
    } catch {
      throw new BadRequestException('Fichier document introuvable sur le stockage.');
    }
    const filename = this.extractOriginalFileName(document.storagePath)
      || (document.title && document.title.trim())
      || basename(localPath)
      || 'document.bin';
    const contentType = this.detectContentType(localPath);

    return { buffer, filename, contentType };
  }

  private decryptOrRaw(value: string): string {
    try {
      return this.encryptionService.decrypt(value);
    } catch {
      return value;
    }
  }

  private detectContentType(pathValue: string): string {
    const extension = extname(pathValue).toLowerCase();
    if (extension === '.pdf') return 'application/pdf';
    if (extension === '.png') return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.doc') return 'application/msword';
    if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (extension === '.xls') return 'application/vnd.ms-excel';
    if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (extension === '.txt') return 'text/plain';
    return 'application/octet-stream';
  }

  private extractOriginalFileName(storagePath: string): string | null {
    const normalized = storagePath.replace(/\\/g, '/');
    const leaf = normalized.split('/').pop() ?? '';
    if (!leaf) return null;
    const markerIndex = leaf.indexOf('__');
    if (markerIndex < 0) return null;
    const candidate = leaf.slice(markerIndex + 2).trim();
    return candidate || null;
  }

  private resolveLocalPath(storagePath: string): string | null {
    if (storagePath.startsWith('file://')) {
      return storagePath.replace('file://', '');
    }

    if (storagePath.startsWith('http://') || storagePath.startsWith('https://') || storagePath.startsWith('s3://')) {
      return null;
    }

    const localBasePath = this.configService.get<string>(
      'DOCUMENT_LOCAL_BASE_PATH',
      '/var/www/myoptiwealth/storage/documents',
    );
    const normalized = storagePath.replace(/^\/+/, '');
    return `${localBasePath}/${normalized}`;
  }

  private async canViewStoragePath(storagePath: string): Promise<boolean> {
    const localPath = this.resolveLocalPath(storagePath);
    if (!localPath) return false;
    try {
      await access(localPath);
      return true;
    } catch {
      return false;
    }
  }
}
