import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus } from '@prisma/client';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SendSignatureRequestDto } from './dto/send-signature-request.dto';
import { SignatureWebhookDto } from './dto/signature-webhook.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
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

  list(workspaceId: string) {
    return this.prisma.document.findMany({
      where: { workspaceId },
      include: { project: true, society: true, contact: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(workspaceId: string, userId: string, dto: CreateDocumentDto) {
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

  async uploadAndCreate(
    workspaceId: string,
    userId: string,
    dto: UploadDocumentDto,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    if (!file) {
      throw new BadRequestException('Missing uploaded file');
    }

    const stored = await this.storageService.store(
      workspaceId,
      file.originalname,
      file.mimetype,
      file.buffer,
    );

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

    await this.auditService.log(
      workspaceId,
      'DOCUMENT_UPLOADED',
      { documentId: document.id, storagePath: document.storagePath },
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

  private decryptOrRaw(value: string): string {
    try {
      return this.encryptionService.decrypt(value);
    } catch {
      return value;
    }
  }
}
