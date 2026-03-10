import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { DocumentStorageService } from '../documents/storage.service';
import { PrismaService } from '../prisma.service';
import { LinkGlobalEmailDto } from './dto/link-global-email.dto';
import { LinkEmailDto } from './dto/link-email.dto';

const EMAIL_SYNC_WINDOW_DAYS = 45;

@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly documentStorageService: DocumentStorageService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.emailMessage.findMany({
      where: {
        workspaceId,
        receivedAt: { gte: this.getWindowStartDate() },
      },
      include: {
        project: true,
        tasks: {
          select: { taskId: true },
        },
      },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async listLinkedForUser(userId: string) {
    const workspaceIds = await this.getWorkspaceIdsForUser(userId);
    if (workspaceIds.length === 0) {
      return [];
    }

    return this.prisma.emailMessage.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        OR: [
          { metadata: { path: ['inboxValidated'], equals: true } },
          { projectId: { not: null } },
          { tasks: { some: {} } },
        ],
        receivedAt: { gte: this.getWindowStartDate() },
      },
      include: {
        workspace: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        tasks: {
          select: {
            task: {
              select: {
                id: true,
                description: true,
                projectId: true,
              },
            },
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async listUnassignedForUser(userId: string) {
    const workspaceIds = await this.getWorkspaceIdsForUser(userId);
    if (workspaceIds.length === 0) {
      return [];
    }
    const emails = await this.prisma.emailMessage.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        projectId: null,
        tasks: { none: {} },
        receivedAt: { gte: this.getWindowStartDate() },
      },
      include: {
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
    const deduped = this.dedupeInboxEmails(emails);
    return deduped.filter((email) => {
      if (this.readMetadataBoolean(email.metadata, 'inboxValidated')) return false;
      return !this.readMetadataBoolean(email.metadata, 'inboxIgnored');
    });
  }

  async listIgnoredForUser(userId: string) {
    const workspaceIds = await this.getWorkspaceIdsForUser(userId);
    if (workspaceIds.length === 0) {
      return [];
    }
    const emails = await this.prisma.emailMessage.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        projectId: null,
        tasks: { none: {} },
        receivedAt: { gte: this.getWindowStartDate() },
      },
      include: {
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
    const deduped = this.dedupeInboxEmails(emails);
    return deduped.filter((email) => {
      if (this.readMetadataBoolean(email.metadata, 'inboxValidated')) return false;
      return this.readMetadataBoolean(email.metadata, 'inboxIgnored');
    });
  }

  async listLinkCatalogForUser(userId: string) {
    const workspaceIds = await this.getWorkspaceIdsForUser(userId);
    if (workspaceIds.length === 0) {
      return [];
    }

    const [workspaces, projects, tasks] = await Promise.all([
      this.prisma.workspace.findMany({
        where: { id: { in: workspaceIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.project.findMany({
        where: { workspaceId: { in: workspaceIds } },
        select: { id: true, name: true, workspaceId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { workspaceId: { in: workspaceIds } },
        select: { id: true, description: true, projectId: true },
        orderBy: [{ projectId: 'asc' }, { orderNumber: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const tasksByProjectId = new Map<string, Array<{ id: string; description: string }>>();
    for (const task of tasks) {
      const list = tasksByProjectId.get(task.projectId) ?? [];
      list.push({ id: task.id, description: task.description });
      tasksByProjectId.set(task.projectId, list);
    }

    const projectsByWorkspaceId = new Map<string, Array<{ id: string; name: string; tasks: Array<{ id: string; description: string }> }>>();
    for (const project of projects) {
      const list = projectsByWorkspaceId.get(project.workspaceId) ?? [];
      list.push({
        id: project.id,
        name: project.name,
        tasks: tasksByProjectId.get(project.id) ?? [],
      });
      projectsByWorkspaceId.set(project.workspaceId, list);
    }

    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      projects: projectsByWorkspaceId.get(workspace.id) ?? [],
    }));
  }

  async getEmailContent(userId: string, emailId: string) {
    const email = await this.prisma.emailMessage.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        workspaceId: true,
        externalMessageId: true,
        subject: true,
        fromAddress: true,
        toAddresses: true,
        receivedAt: true,
        metadata: true,
      },
    });
    if (!email) {
      throw new BadRequestException('Email introuvable.');
    }

    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: email.workspaceId,
        },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException('Accès refusé à cet email.');
    }

    const metadataBodyText = this.readMetadataString(email.metadata, 'bodyText');
    const metadataAttachments = this.readMetadataAttachments(email.metadata);
    if (metadataBodyText) {
      return {
        subject: email.subject,
        fromAddress: email.fromAddress,
        toAddresses: email.toAddresses,
        receivedAt: email.receivedAt,
        text: metadataBodyText,
        attachments: metadataAttachments,
      };
    }

    const source = await this.fetchImapSourceByExternalMessageId(email.externalMessageId);
    if (!source) {
      return {
        subject: email.subject,
        fromAddress: email.fromAddress,
        toAddresses: email.toAddresses,
        receivedAt: email.receivedAt,
        text: email.subject,
        attachments: [],
      };
    }

    const parsed = await simpleParser(source);
    return {
      subject: email.subject,
      fromAddress: email.fromAddress,
      toAddresses: email.toAddresses,
      receivedAt: email.receivedAt,
      text: this.normalizeBodyText(parsed.text?.trim() || parsed.html?.toString() || email.subject),
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename || 'piece-jointe.bin',
        contentType: attachment.contentType || 'application/octet-stream',
        size: attachment.size || attachment.content.length,
      })),
    };
  }

  async saveAttachmentsToDocuments(userId: string, emailId: string) {
    const email = await this.prisma.emailMessage.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        externalMessageId: true,
        metadata: true,
      },
    });
    if (!email) {
      throw new BadRequestException('Email introuvable.');
    }

    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: email.workspaceId,
        },
      },
      select: { role: true },
    });
    if (!membership) {
      throw new BadRequestException('Accès refusé à cet email.');
    }
    if (membership.role === WorkspaceRole.VIEWER) {
      throw new BadRequestException('Droits insuffisants pour sauvegarder les pièces jointes.');
    }

    if (!email.projectId) {
      throw new BadRequestException('Email non rattaché à un projet.');
    }

    const taskLink = await this.prisma.taskEmail.findFirst({
      where: { emailId: email.id },
      select: {
        taskId: true,
        task: {
          select: { projectId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!taskLink) {
      throw new BadRequestException('Email non rattaché à une tâche.');
    }
    if (taskLink.task.projectId !== email.projectId) {
      throw new BadRequestException('Incohérence projet/tâche pour cet email.');
    }

    if (this.readMetadataBoolean(email.metadata, 'documentsSaved')) {
      return { saved: true, alreadySaved: true, importedCount: 0 };
    }

    const declaredAttachmentCount = this.readMetadataAttachments(email.metadata).length;
    const importedCount = await this.importAttachmentsAsDocuments(
      email.externalMessageId,
      email.workspaceId,
      email.projectId,
      taskLink.taskId,
      email.id,
    );

    const existingSavedCount = await this.prisma.document.count({
      where: {
        workspaceId: email.workspaceId,
        projectId: email.projectId,
        storagePath: { contains: `/${email.id}/` },
      },
    });

    if (declaredAttachmentCount > 0 && importedCount === 0 && existingSavedCount === 0) {
      throw new BadRequestException('Impossible de récupérer les pièces jointes depuis IMAP.');
    }

    const metadata = this.mergeMetadata(email.metadata, {
      documentsSaved: true,
      documentsSavedAt: new Date().toISOString(),
      documentsSavedCount: importedCount + existingSavedCount,
    });

    await this.prisma.emailMessage.update({
      where: { id: email.id },
      data: { metadata },
    });

    return { saved: true, alreadySaved: false, importedCount };
  }

  upsertMetadata(workspaceId: string, dto: LinkEmailDto) {
    return this.upsertMetadataInternal(workspaceId, dto);
  }

  upsertMetadataGlobal(userId: string, dto: LinkGlobalEmailDto) {
    return this.upsertMetadataGlobalByEmailId(userId, dto);
  }

  async ignoreInboxEmail(userId: string, emailId: string) {
    const email = await this.prisma.emailMessage.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        workspaceId: true,
        metadata: true,
      },
    });
    if (!email) {
      throw new BadRequestException('Email introuvable.');
    }

    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: email.workspaceId,
        },
      },
      select: { role: true },
    });
    if (!membership) {
      throw new BadRequestException('Accès refusé à cet email.');
    }
    if (membership.role === WorkspaceRole.VIEWER) {
      throw new BadRequestException('Droits insuffisants pour ignorer cet email.');
    }
    const metadata = this.mergeMetadata(email.metadata, {
      inboxIgnored: true,
      inboxIgnoredAt: new Date().toISOString(),
      inboxIgnoredBy: userId,
    });

    await this.prisma.emailMessage.update({
      where: { id: email.id },
      data: { metadata },
    });

    return { ignored: true };
  }

  async unignoreInboxEmail(userId: string, emailId: string) {
    const email = await this.prisma.emailMessage.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        workspaceId: true,
        metadata: true,
      },
    });
    if (!email) {
      throw new BadRequestException('Email introuvable.');
    }

    const membership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: email.workspaceId,
        },
      },
      select: { role: true },
    });
    if (!membership) {
      throw new BadRequestException('Acces refuse a cet email.');
    }
    if (membership.role === WorkspaceRole.VIEWER) {
      throw new BadRequestException('Droits insuffisants pour reafficher cet email.');
    }

    const metadata = this.mergeMetadata(email.metadata, {
      inboxIgnored: false,
      inboxIgnoredAt: null,
      inboxIgnoredBy: null,
      inboxRestoredAt: new Date().toISOString(),
      inboxRestoredBy: userId,
    });

    await this.prisma.emailMessage.update({
      where: { id: email.id },
      data: { metadata },
    });

    return { restored: true };
  }

  private async upsertMetadataGlobalByEmailId(
    userId: string,
    dto: LinkGlobalEmailDto,
  ) {
    const workspaceIds = await this.getWorkspaceIdsForUser(userId);
    const directSourceEmail = await this.prisma.emailMessage.findUnique({
      where: { id: dto.emailId },
      select: { id: true, workspaceId: true, externalMessageId: true, fromAddress: true, toAddresses: true, subject: true, metadata: true },
    });
    const sourceEmail = directSourceEmail
      ?? await this.prisma.emailMessage.findFirst({
        where: {
          workspaceId: { in: workspaceIds },
          externalMessageId: dto.externalMessageId,
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, workspaceId: true, externalMessageId: true, fromAddress: true, toAddresses: true, subject: true, metadata: true },
      });

    const targetMembership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: dto.workspaceId,
        },
      },
      select: { role: true },
    });
    if (!targetMembership) {
      throw new BadRequestException('Workspace invalide pour cet utilisateur.');
    }
    if (targetMembership.role === WorkspaceRole.VIEWER) {
      throw new BadRequestException('Droits insuffisants pour affecter cet email.');
    }

    const selection = await this.resolveTargetLinkSelection(dto.workspaceId, dto.projectId, dto.taskId);
    const validationLevel = selection.taskId ? 'task' : (selection.projectId ? 'project' : 'workspace');
    const validationPatch = {
      inboxValidated: true,
      inboxValidationLevel: validationLevel,
      inboxValidatedAt: new Date().toISOString(),
      inboxValidatedBy: userId,
      inboxIgnored: false,
      inboxIgnoredAt: null,
      inboxIgnoredBy: null,
    };

    if (!sourceEmail) {
      const targetAlreadyExisting = await this.prisma.emailMessage.findUnique({
        where: {
          workspaceId_externalMessageId: {
            workspaceId: dto.workspaceId,
            externalMessageId: dto.externalMessageId,
          },
        },
        select: { id: true, fromAddress: true, toAddresses: true, subject: true, externalMessageId: true, workspaceId: true, metadata: true },
      });
      if (!targetAlreadyExisting) {
        throw new BadRequestException('Email introuvable.');
      }
      return this.prisma.$transaction(async (tx) => {
        const targetEmail = await tx.emailMessage.update({
          where: { id: targetAlreadyExisting.id },
          data: {
            projectId: selection.projectId,
            fromAddress: targetAlreadyExisting.fromAddress,
            toAddresses: targetAlreadyExisting.toAddresses,
            subject: targetAlreadyExisting.subject,
            metadata: this.mergeMetadata(targetAlreadyExisting.metadata, validationPatch),
          },
        });
        await tx.taskEmail.deleteMany({ where: { emailId: targetEmail.id } });
        if (selection.taskId) {
          await tx.taskEmail.create({
            data: { taskId: selection.taskId, emailId: targetEmail.id },
          });
        }
        return targetEmail;
      });
    }

    const sourceMembership = await this.prisma.userWorkspaceRole.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: sourceEmail.workspaceId,
        },
      },
      select: { id: true },
    });
    if (!sourceMembership) {
      throw new BadRequestException('Accès refusé à cet email.');
    }

    const linkedEmail = await this.prisma.$transaction(async (tx) => {
      const targetEmail = await tx.emailMessage.upsert({
        where: {
          workspaceId_externalMessageId: {
            workspaceId: dto.workspaceId,
            externalMessageId: sourceEmail.externalMessageId,
          },
        },
        update: {
          fromAddress: sourceEmail.fromAddress,
          toAddresses: sourceEmail.toAddresses,
          subject: sourceEmail.subject,
          metadata: this.mergeMetadata(sourceEmail.metadata, validationPatch),
          projectId: selection.projectId,
        },
        create: {
          workspaceId: dto.workspaceId,
          externalMessageId: sourceEmail.externalMessageId,
          fromAddress: sourceEmail.fromAddress,
          toAddresses: sourceEmail.toAddresses,
          subject: sourceEmail.subject,
          receivedAt: new Date(),
          metadata: this.mergeMetadata(sourceEmail.metadata, validationPatch),
          projectId: selection.projectId,
        },
      });

      await tx.taskEmail.deleteMany({
        where: { emailId: targetEmail.id },
      });

      if (selection.taskId) {
        await tx.taskEmail.create({
          data: {
            taskId: selection.taskId,
            emailId: targetEmail.id,
          },
        });
      }

      if (sourceEmail.id !== targetEmail.id) {
        await tx.taskEmail.deleteMany({ where: { emailId: sourceEmail.id } });
        await tx.emailContact.deleteMany({ where: { emailId: sourceEmail.id } });
        await tx.emailMessage.delete({ where: { id: sourceEmail.id } });
      }

      return targetEmail;
    });
    if (selection.projectId && selection.taskId) {
      void this.importAttachmentsAsDocuments(
        sourceEmail.externalMessageId,
        dto.workspaceId,
        selection.projectId,
        selection.taskId,
        linkedEmail.id,
      ).catch(() => undefined);
    }
    return linkedEmail;
  }

  private async resolveTargetLinkSelection(
    workspaceId: string,
    requestedProjectId?: string,
    requestedTaskId?: string,
  ): Promise<{ projectId: string | null; taskId: string | null }> {
    let projectId: string | null = null;
    let taskId: string | null = null;

    if (requestedProjectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: requestedProjectId, workspaceId },
        select: { id: true },
      });
      if (!project) {
        throw new BadRequestException('Projet invalide pour ce workspace.');
      }
      projectId = project.id;
    }

    if (requestedTaskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: requestedTaskId, workspaceId },
        select: { id: true, projectId: true },
      });
      if (!task) {
        throw new BadRequestException('Tache invalide pour ce workspace.');
      }
      if (projectId && task.projectId !== projectId) {
        throw new BadRequestException('La tache ne correspond pas au projet sélectionné.');
      }
      taskId = task.id;
      projectId = task.projectId;
    }

    return { projectId, taskId };
  }

  private async upsertMetadataInternal(workspaceId: string, dto: LinkEmailDto) {
    return this.upsertMetadataInternalForWorkspace(undefined, workspaceId, dto);
  }

  private async upsertMetadataInternalForWorkspace(
    userId: string | undefined,
    workspaceId: string,
    dto: {
      externalMessageId: string;
      fromAddress: string;
      toAddresses: string[];
      subject: string;
      projectId?: string;
      taskId?: string;
    },
  ) {
    if (userId) {
      const membership = await this.prisma.userWorkspaceRole.findUnique({
        where: {
          userId_workspaceId: {
            userId,
            workspaceId,
          },
        },
        select: { id: true, role: true },
      });
      if (!membership) {
        throw new BadRequestException('Workspace invalide pour cet utilisateur.');
      }
      if (membership.role === WorkspaceRole.VIEWER) {
        throw new BadRequestException('Droits insuffisants pour affecter cet email.');
      }
    }

    let projectId: string | undefined;
    let taskId: string | undefined;
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: {
          id: dto.projectId,
          workspaceId,
        },
        select: { id: true },
      });
      if (!project) {
        throw new BadRequestException('Projet invalide pour ce workspace.');
      }
      projectId = project.id;
    }
    if (dto.taskId) {
      const task = await this.prisma.task.findFirst({
        where: {
          id: dto.taskId,
          workspaceId,
        },
        select: { id: true, projectId: true },
      });
      if (!task) {
        throw new BadRequestException('Tache invalide pour ce workspace.');
      }
      if (projectId && task.projectId !== projectId) {
        throw new BadRequestException('La tache ne correspond pas au projet sélectionné.');
      }
      taskId = task.id;
      projectId = task.projectId;
    }

    if (!projectId || !taskId) {
      throw new BadRequestException('La liaison email nécessite un projet et une tache.');
    }

    return this.prisma.$transaction(async (tx) => {
      const email = await tx.emailMessage.upsert({
        where: {
          workspaceId_externalMessageId: {
            workspaceId,
            externalMessageId: dto.externalMessageId,
          },
        },
        update: {
          fromAddress: dto.fromAddress,
          toAddresses: dto.toAddresses,
          subject: dto.subject,
          projectId,
        },
        create: {
          workspaceId,
          externalMessageId: dto.externalMessageId,
          fromAddress: dto.fromAddress,
          toAddresses: dto.toAddresses,
          subject: dto.subject,
          receivedAt: new Date(),
          metadata: {},
          projectId,
        },
      });

      await tx.taskEmail.deleteMany({
        where: { emailId: email.id },
      });

      await tx.taskEmail.create({
        data: {
          taskId,
          emailId: email.id,
        },
      });

      return email;
    });
  }

  async syncFromImap(workspaceId: string): Promise<{ synced: number }> {
    const settings = await this.prisma.platformSettings.findUnique({
      where: { singletonKey: 'GLOBAL' },
    });

    if (!settings?.imapHost || !settings.imapPort || !settings.imapUser || !settings.imapPasswordEncrypted) {
      return { synced: 0 };
    }

    const password = this.decryptOrRaw(settings.imapPasswordEncrypted);
    const client = new ImapFlow({
      host: settings.imapHost,
      port: settings.imapPort,
      secure: settings.imapPort === 993,
      auth: {
        user: settings.imapUser,
        pass: password,
      },
    });

    await client.connect();
    await client.mailboxOpen('INBOX');

    const fetched: FetchMessageObject[] = [];
    for await (const message of client.fetch(
      { since: this.getWindowStartDate() },
      {
      uid: true,
      envelope: true,
      internalDate: true,
      source: true,
      },
    )) {
      fetched.push(message);
    }

    const latest = fetched.slice(-200);
    let synced = 0;

    for (const message of latest) {
      const envelope = message.envelope;
      if (!envelope) {
        continue;
      }

      const fromAddress = envelope.from?.[0]?.address ?? 'unknown@unknown.local';
      const toAddresses = (envelope.to ?? [])
        .map((recipient) => recipient.address)
        .filter((address): address is string => typeof address === 'string');
      const subject = envelope.subject ?? '(no subject)';
      if (this.isBounceOrSystemDeliveryMail(fromAddress, subject)) {
        continue;
      }
      const receivedAt = message.internalDate ?? new Date();
      let bodyText = subject;
      let preview = subject;
      let attachmentsMeta: Array<{ filename: string; contentType: string; size: number }> = [];
      if (message.source) {
        try {
          const sourceBuffer = Buffer.isBuffer(message.source)
            ? message.source
            : Buffer.from(String(message.source));
          const parsed = await simpleParser(sourceBuffer);
          bodyText = this.normalizeBodyText(parsed.text?.trim() || parsed.html?.toString() || subject);
          preview = bodyText.slice(0, 280) || subject;
          attachmentsMeta = parsed.attachments.map((attachment) => ({
            filename: attachment.filename || 'piece-jointe.bin',
            contentType: attachment.contentType || 'application/octet-stream',
            size: attachment.size || attachment.content.length,
          }));
        } catch {
          bodyText = subject;
          preview = subject;
          attachmentsMeta = [];
        }
      }

      const externalMessageId = String(message.uid);
      const metadataPatch = {
        source: 'imap-sync',
        preview,
        bodyText,
        attachments: attachmentsMeta,
      };

      const existing = await this.prisma.emailMessage.findUnique({
        where: {
          workspaceId_externalMessageId: {
            workspaceId,
            externalMessageId,
          },
        },
        select: {
          id: true,
          metadata: true,
        },
      });

      if (existing) {
        await this.prisma.emailMessage.update({
          where: { id: existing.id },
          data: {
            fromAddress,
            toAddresses,
            subject,
            receivedAt,
            metadata: this.mergeMetadata(existing.metadata, metadataPatch),
          },
        });
      } else {
        await this.prisma.emailMessage.create({
          data: {
            workspaceId,
            externalMessageId,
            fromAddress,
            toAddresses,
            subject,
            receivedAt,
            metadata: metadataPatch,
          },
        });
      }
      synced += 1;
    }

    await client.logout();
    return { synced };
  }

  private decryptOrRaw(value: string): string {
    try {
      return this.encryptionService.decrypt(value);
    } catch {
      return value;
    }
  }

  private getWindowStartDate(): Date {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() - EMAIL_SYNC_WINDOW_DAYS);
    return value;
  }

  private isBounceOrSystemDeliveryMail(fromAddress: string, subject: string): boolean {
    const from = fromAddress.trim().toLowerCase();
    const normalizedSubject = subject.trim().toLowerCase();

    const bounceSenders = [
      'mailer-daemon',
      'postmaster',
      'mail delivery subsystem',
    ];
    if (bounceSenders.some((token) => from.includes(token))) {
      return true;
    }

    const bounceSubjects = [
      'undelivered mail returned to sender',
      'delivery status notification (failure)',
      'mail delivery failed',
      'failure notice',
      'returned mail',
      'message not delivered',
      'échec de remise',
      'echec de remise',
    ];
    return bounceSubjects.some((token) => normalizedSubject.includes(token));
  }

  private async getWorkspaceIdsForUser(userId: string): Promise<string[]> {
    const memberships = await this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    return memberships.map((item) => item.workspaceId);
  }

  private async fetchImapSourceByExternalMessageId(externalMessageId: string): Promise<Buffer | null> {
    const settings = await this.prisma.platformSettings.findUnique({
      where: { singletonKey: 'GLOBAL' },
    });
    if (!settings?.imapHost || !settings.imapPort || !settings.imapUser || !settings.imapPasswordEncrypted) {
      return null;
    }

    const uid = Number(externalMessageId);
    if (!Number.isInteger(uid) || uid <= 0) {
      return null;
    }

    const password = this.decryptOrRaw(settings.imapPasswordEncrypted);
    const client = new ImapFlow({
      host: settings.imapHost,
      port: settings.imapPort,
      secure: settings.imapPort === 993,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: {
        user: settings.imapUser,
        pass: password,
      },
      logger: false,
    });
    client.on('error', () => undefined);

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      for await (const message of client.fetch({ uid }, { uid: true, source: true })) {
        if (message.source) {
          return Buffer.isBuffer(message.source)
            ? message.source
            : Buffer.from(String(message.source));
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private async importAttachmentsAsDocuments(
    externalMessageId: string,
    workspaceId: string,
    projectId: string,
    taskId: string,
    sourceEmailId: string,
  ): Promise<number> {
    const source = await this.fetchImapSourceByExternalMessageId(externalMessageId);
    if (!source) {
      return 0;
    }

    const parsed = await simpleParser(source);
    if (!parsed.attachments || parsed.attachments.length === 0) {
      return 0;
    }

    const [workspace, project, task] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
      this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      this.prisma.task.findUnique({ where: { id: taskId }, select: { description: true } }),
    ]);
    const workspaceLabel = this.toStorageSegment(workspace?.name ?? workspaceId);
    const projectLabel = this.toStorageSegment(project?.name ?? projectId);
    const taskLabel = this.toStorageSegment(task?.description ?? taskId);

    let imported = 0;
    let index = 0;
    for (const attachment of parsed.attachments) {
      index += 1;
      const originalName = attachment.filename || `attachment-${index}.bin`;
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storageKey = `emails/${workspaceLabel}/${projectLabel}/${taskLabel}/${this.shortMessageKey(externalMessageId)}/${index}-${safeName}`;
      const stored = await this.documentStorageService.storeByKey(
        storageKey,
        attachment.contentType || 'application/octet-stream',
        attachment.content,
      );

      const existing = await this.prisma.document.findFirst({
        where: {
          workspaceId,
          storagePath: stored.storagePath,
        },
        select: { id: true },
      });
      if (existing) {
        continue;
      }

      await this.prisma.document.create({
        data: {
          workspaceId,
          projectId,
          taskId,
          title: originalName,
          storagePath: stored.storagePath,
        },
      });
      imported += 1;
    }
    return imported;
  }

  private normalizeBodyText(value: string): string {
    const clean = value.replace(/\r\n/g, '\n').trim();
    return clean.length > 100000 ? clean.slice(0, 100000) : clean;
  }

  private toStorageSegment(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item';
  }

  private shortMessageKey(externalMessageId: string): string {
    return `msg-${createHash('sha1').update(externalMessageId).digest('hex').slice(0, 10)}`;
  }

  private readMetadataString(metadata: unknown, key: string): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const map = metadata as Record<string, unknown>;
    const value = map[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private readMetadataBoolean(metadata: unknown, key: string): boolean {
    if (!metadata || typeof metadata !== 'object') return false;
    const map = metadata as Record<string, unknown>;
    return map[key] === true;
  }

  private mergeMetadata(metadata: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
    const base = metadata && typeof metadata === 'object'
      ? { ...(metadata as Record<string, unknown>) }
      : {};
    return {
      ...base,
      ...patch,
    } as Prisma.InputJsonObject;
  }

  private readMetadataAttachments(metadata: unknown): Array<{ filename: string; contentType: string; size: number }> {
    if (!metadata || typeof metadata !== 'object') return [];
    const map = metadata as Record<string, unknown>;
    const raw = map.attachments;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const rec = item as Record<string, unknown>;
        const filename = typeof rec.filename === 'string' ? rec.filename : 'piece-jointe.bin';
        const contentType = typeof rec.contentType === 'string' ? rec.contentType : 'application/octet-stream';
        const size = typeof rec.size === 'number' ? rec.size : 0;
        return { filename, contentType, size };
      })
      .filter((item): item is { filename: string; contentType: string; size: number } => Boolean(item));
  }

  private dedupeInboxEmails<T extends { externalMessageId: string; metadata: unknown; receivedAt: Date; updatedAt: Date }>(emails: T[]): T[] {
    const byExternalId = new Map<string, T[]>();
    for (const email of emails) {
      const key = String(email.externalMessageId || '');
      const list = byExternalId.get(key) ?? [];
      list.push(email);
      byExternalId.set(key, list);
    }

    const deduped = [...byExternalId.values()].map((group) => {
      const ordered = [...group].sort((left, right) => {
        const leftValidated = this.readMetadataBoolean(left.metadata, 'inboxValidated') ? 1 : 0;
        const rightValidated = this.readMetadataBoolean(right.metadata, 'inboxValidated') ? 1 : 0;
        if (leftValidated !== rightValidated) return rightValidated - leftValidated;

        const leftIgnored = this.readMetadataBoolean(left.metadata, 'inboxIgnored') ? 1 : 0;
        const rightIgnored = this.readMetadataBoolean(right.metadata, 'inboxIgnored') ? 1 : 0;
        if (leftIgnored !== rightIgnored) return rightIgnored - leftIgnored;
        const byUpdated = right.updatedAt.getTime() - left.updatedAt.getTime();
        if (byUpdated !== 0) return byUpdated;
        return right.receivedAt.getTime() - left.receivedAt.getTime();
      });
      return ordered[0];
    });

    return deduped.sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime());
  }
}
