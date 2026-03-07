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
exports.EmailsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const node_crypto_1 = require("node:crypto");
const imapflow_1 = require("imapflow");
const mailparser_1 = require("mailparser");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const storage_service_1 = require("../documents/storage.service");
const prisma_service_1 = require("../prisma.service");
const EMAIL_SYNC_WINDOW_DAYS = 45;
let EmailsService = class EmailsService {
    constructor(prisma, encryptionService, documentStorageService) {
        this.prisma = prisma;
        this.encryptionService = encryptionService;
        this.documentStorageService = documentStorageService;
    }
    list(workspaceId) {
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
    async listUnassignedForUser(userId) {
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
        return deduped.filter((email) => !this.readMetadataBoolean(email.metadata, 'inboxIgnored'));
    }
    async listIgnoredForUser(userId) {
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
        return deduped.filter((email) => this.readMetadataBoolean(email.metadata, 'inboxIgnored'));
    }
    async listLinkCatalogForUser(userId) {
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
        const tasksByProjectId = new Map();
        for (const task of tasks) {
            const list = tasksByProjectId.get(task.projectId) ?? [];
            list.push({ id: task.id, description: task.description });
            tasksByProjectId.set(task.projectId, list);
        }
        const projectsByWorkspaceId = new Map();
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
    async getEmailContent(userId, emailId) {
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
            throw new common_1.BadRequestException('Email introuvable.');
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
            throw new common_1.BadRequestException('Accès refusé à cet email.');
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
        const parsed = await (0, mailparser_1.simpleParser)(source);
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
    async saveAttachmentsToDocuments(userId, emailId) {
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
            throw new common_1.BadRequestException('Email introuvable.');
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
            throw new common_1.BadRequestException('Accès refusé à cet email.');
        }
        if (membership.role === client_1.WorkspaceRole.VIEWER) {
            throw new common_1.BadRequestException('Droits insuffisants pour sauvegarder les pièces jointes.');
        }
        if (!email.projectId) {
            throw new common_1.BadRequestException('Email non rattaché à un projet.');
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
            throw new common_1.BadRequestException('Email non rattaché à une tâche.');
        }
        if (taskLink.task.projectId !== email.projectId) {
            throw new common_1.BadRequestException('Incohérence projet/tâche pour cet email.');
        }
        if (this.readMetadataBoolean(email.metadata, 'documentsSaved')) {
            return { saved: true, alreadySaved: true, importedCount: 0 };
        }
        const declaredAttachmentCount = this.readMetadataAttachments(email.metadata).length;
        const importedCount = await this.importAttachmentsAsDocuments(email.externalMessageId, email.workspaceId, email.projectId, taskLink.taskId, email.id);
        const existingSavedCount = await this.prisma.document.count({
            where: {
                workspaceId: email.workspaceId,
                projectId: email.projectId,
                storagePath: { contains: `/${email.id}/` },
            },
        });
        if (declaredAttachmentCount > 0 && importedCount === 0 && existingSavedCount === 0) {
            throw new common_1.BadRequestException('Impossible de récupérer les pièces jointes depuis IMAP.');
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
    upsertMetadata(workspaceId, dto) {
        return this.upsertMetadataInternal(workspaceId, dto);
    }
    upsertMetadataGlobal(userId, dto) {
        return this.upsertMetadataGlobalByEmailId(userId, dto);
    }
    async ignoreInboxEmail(userId, emailId) {
        const email = await this.prisma.emailMessage.findUnique({
            where: { id: emailId },
            select: {
                id: true,
                workspaceId: true,
                metadata: true,
            },
        });
        if (!email) {
            throw new common_1.BadRequestException('Email introuvable.');
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
            throw new common_1.BadRequestException('Accès refusé à cet email.');
        }
        if (membership.role === client_1.WorkspaceRole.VIEWER) {
            throw new common_1.BadRequestException('Droits insuffisants pour ignorer cet email.');
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
    async unignoreInboxEmail(userId, emailId) {
        const email = await this.prisma.emailMessage.findUnique({
            where: { id: emailId },
            select: {
                id: true,
                workspaceId: true,
                metadata: true,
            },
        });
        if (!email) {
            throw new common_1.BadRequestException('Email introuvable.');
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
            throw new common_1.BadRequestException('Acces refuse a cet email.');
        }
        if (membership.role === client_1.WorkspaceRole.VIEWER) {
            throw new common_1.BadRequestException('Droits insuffisants pour reafficher cet email.');
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
    async upsertMetadataGlobalByEmailId(userId, dto) {
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
        if (!sourceEmail) {
            const targetAlreadyExisting = await this.prisma.emailMessage.findUnique({
                where: {
                    workspaceId_externalMessageId: {
                        workspaceId: dto.workspaceId,
                        externalMessageId: dto.externalMessageId,
                    },
                },
                select: { id: true, fromAddress: true, toAddresses: true, subject: true, externalMessageId: true, workspaceId: true },
            });
            if (!targetAlreadyExisting) {
                throw new common_1.BadRequestException('Email introuvable.');
            }
            return this.prisma.$transaction(async (tx) => {
                const targetEmail = await tx.emailMessage.update({
                    where: { id: targetAlreadyExisting.id },
                    data: {
                        projectId: dto.projectId,
                        fromAddress: targetAlreadyExisting.fromAddress,
                        toAddresses: targetAlreadyExisting.toAddresses,
                        subject: targetAlreadyExisting.subject,
                    },
                });
                await tx.taskEmail.deleteMany({ where: { emailId: targetEmail.id } });
                await tx.taskEmail.create({
                    data: { taskId: dto.taskId, emailId: targetEmail.id },
                });
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
            throw new common_1.BadRequestException('Accès refusé à cet email.');
        }
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
            throw new common_1.BadRequestException('Workspace invalide pour cet utilisateur.');
        }
        if (targetMembership.role === client_1.WorkspaceRole.VIEWER) {
            throw new common_1.BadRequestException('Droits insuffisants pour affecter cet email.');
        }
        const project = await this.prisma.project.findFirst({
            where: { id: dto.projectId, workspaceId: dto.workspaceId },
            select: { id: true },
        });
        if (!project) {
            throw new common_1.BadRequestException('Projet invalide pour ce workspace.');
        }
        const task = await this.prisma.task.findFirst({
            where: { id: dto.taskId, workspaceId: dto.workspaceId },
            select: { id: true, projectId: true },
        });
        if (!task) {
            throw new common_1.BadRequestException('Tache invalide pour ce workspace.');
        }
        if (task.projectId !== dto.projectId) {
            throw new common_1.BadRequestException('La tache ne correspond pas au projet sélectionné.');
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
                    metadata: sourceEmail.metadata ?? {},
                    projectId: dto.projectId,
                },
                create: {
                    workspaceId: dto.workspaceId,
                    externalMessageId: sourceEmail.externalMessageId,
                    fromAddress: sourceEmail.fromAddress,
                    toAddresses: sourceEmail.toAddresses,
                    subject: sourceEmail.subject,
                    receivedAt: new Date(),
                    metadata: sourceEmail.metadata ?? {},
                    projectId: dto.projectId,
                },
            });
            await tx.taskEmail.deleteMany({
                where: { emailId: targetEmail.id },
            });
            await tx.taskEmail.create({
                data: {
                    taskId: dto.taskId,
                    emailId: targetEmail.id,
                },
            });
            if (sourceEmail.id !== targetEmail.id) {
                await tx.taskEmail.deleteMany({ where: { emailId: sourceEmail.id } });
                await tx.emailContact.deleteMany({ where: { emailId: sourceEmail.id } });
                await tx.emailMessage.delete({ where: { id: sourceEmail.id } });
            }
            return targetEmail;
        });
        void this.importAttachmentsAsDocuments(sourceEmail.externalMessageId, dto.workspaceId, dto.projectId, dto.taskId, linkedEmail.id).catch(() => undefined);
        return linkedEmail;
    }
    async upsertMetadataInternal(workspaceId, dto) {
        return this.upsertMetadataInternalForWorkspace(undefined, workspaceId, dto);
    }
    async upsertMetadataInternalForWorkspace(userId, workspaceId, dto) {
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
                throw new common_1.BadRequestException('Workspace invalide pour cet utilisateur.');
            }
            if (membership.role === client_1.WorkspaceRole.VIEWER) {
                throw new common_1.BadRequestException('Droits insuffisants pour affecter cet email.');
            }
        }
        let projectId;
        let taskId;
        if (dto.projectId) {
            const project = await this.prisma.project.findFirst({
                where: {
                    id: dto.projectId,
                    workspaceId,
                },
                select: { id: true },
            });
            if (!project) {
                throw new common_1.BadRequestException('Projet invalide pour ce workspace.');
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
                throw new common_1.BadRequestException('Tache invalide pour ce workspace.');
            }
            if (projectId && task.projectId !== projectId) {
                throw new common_1.BadRequestException('La tache ne correspond pas au projet sélectionné.');
            }
            taskId = task.id;
            projectId = task.projectId;
        }
        if (!projectId || !taskId) {
            throw new common_1.BadRequestException('La liaison email nécessite un projet et une tache.');
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
    async syncFromImap(workspaceId) {
        const settings = await this.prisma.platformSettings.findUnique({
            where: { singletonKey: 'GLOBAL' },
        });
        if (!settings?.imapHost || !settings.imapPort || !settings.imapUser || !settings.imapPasswordEncrypted) {
            return { synced: 0 };
        }
        const password = this.decryptOrRaw(settings.imapPasswordEncrypted);
        const client = new imapflow_1.ImapFlow({
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
        const fetched = [];
        for await (const message of client.fetch({ since: this.getWindowStartDate() }, {
            uid: true,
            envelope: true,
            internalDate: true,
            source: true,
        })) {
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
                .filter((address) => typeof address === 'string');
            const subject = envelope.subject ?? '(no subject)';
            if (this.isBounceOrSystemDeliveryMail(fromAddress, subject)) {
                continue;
            }
            const receivedAt = message.internalDate ?? new Date();
            let bodyText = subject;
            let preview = subject;
            let attachmentsMeta = [];
            if (message.source) {
                try {
                    const sourceBuffer = Buffer.isBuffer(message.source)
                        ? message.source
                        : Buffer.from(String(message.source));
                    const parsed = await (0, mailparser_1.simpleParser)(sourceBuffer);
                    bodyText = this.normalizeBodyText(parsed.text?.trim() || parsed.html?.toString() || subject);
                    preview = bodyText.slice(0, 280) || subject;
                    attachmentsMeta = parsed.attachments.map((attachment) => ({
                        filename: attachment.filename || 'piece-jointe.bin',
                        contentType: attachment.contentType || 'application/octet-stream',
                        size: attachment.size || attachment.content.length,
                    }));
                }
                catch {
                    bodyText = subject;
                    preview = subject;
                    attachmentsMeta = [];
                }
            }
            await this.prisma.emailMessage.upsert({
                where: {
                    workspaceId_externalMessageId: {
                        workspaceId,
                        externalMessageId: String(message.uid),
                    },
                },
                update: {
                    fromAddress,
                    toAddresses,
                    subject,
                    receivedAt,
                    metadata: {
                        source: 'imap-sync',
                        preview,
                        bodyText,
                        attachments: attachmentsMeta,
                    },
                },
                create: {
                    workspaceId,
                    externalMessageId: String(message.uid),
                    fromAddress,
                    toAddresses,
                    subject,
                    receivedAt,
                    metadata: {
                        source: 'imap-sync',
                        preview,
                        bodyText,
                        attachments: attachmentsMeta,
                    },
                },
            });
            synced += 1;
        }
        await client.logout();
        return { synced };
    }
    decryptOrRaw(value) {
        try {
            return this.encryptionService.decrypt(value);
        }
        catch {
            return value;
        }
    }
    getWindowStartDate() {
        const value = new Date();
        value.setUTCDate(value.getUTCDate() - EMAIL_SYNC_WINDOW_DAYS);
        return value;
    }
    isBounceOrSystemDeliveryMail(fromAddress, subject) {
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
    async getWorkspaceIdsForUser(userId) {
        const memberships = await this.prisma.userWorkspaceRole.findMany({
            where: { userId },
            select: { workspaceId: true },
        });
        return memberships.map((item) => item.workspaceId);
    }
    async fetchImapSourceByExternalMessageId(externalMessageId) {
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
        const client = new imapflow_1.ImapFlow({
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
        }
        catch {
            return null;
        }
        finally {
            await client.logout().catch(() => undefined);
        }
    }
    async importAttachmentsAsDocuments(externalMessageId, workspaceId, projectId, taskId, sourceEmailId) {
        const source = await this.fetchImapSourceByExternalMessageId(externalMessageId);
        if (!source) {
            return 0;
        }
        const parsed = await (0, mailparser_1.simpleParser)(source);
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
            const stored = await this.documentStorageService.storeByKey(storageKey, attachment.contentType || 'application/octet-stream', attachment.content);
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
                    title: `PJ email - ${originalName}`,
                    storagePath: stored.storagePath,
                },
            });
            imported += 1;
        }
        return imported;
    }
    normalizeBodyText(value) {
        const clean = value.replace(/\r\n/g, '\n').trim();
        return clean.length > 100000 ? clean.slice(0, 100000) : clean;
    }
    toStorageSegment(value) {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'item';
    }
    shortMessageKey(externalMessageId) {
        return `msg-${(0, node_crypto_1.createHash)('sha1').update(externalMessageId).digest('hex').slice(0, 10)}`;
    }
    readMetadataString(metadata, key) {
        if (!metadata || typeof metadata !== 'object')
            return null;
        const map = metadata;
        const value = map[key];
        return typeof value === 'string' && value.trim().length > 0 ? value : null;
    }
    readMetadataBoolean(metadata, key) {
        if (!metadata || typeof metadata !== 'object')
            return false;
        const map = metadata;
        return map[key] === true;
    }
    mergeMetadata(metadata, patch) {
        const base = metadata && typeof metadata === 'object'
            ? { ...metadata }
            : {};
        return {
            ...base,
            ...patch,
        };
    }
    readMetadataAttachments(metadata) {
        if (!metadata || typeof metadata !== 'object')
            return [];
        const map = metadata;
        const raw = map.attachments;
        if (!Array.isArray(raw))
            return [];
        return raw
            .map((item) => {
            if (!item || typeof item !== 'object')
                return null;
            const rec = item;
            const filename = typeof rec.filename === 'string' ? rec.filename : 'piece-jointe.bin';
            const contentType = typeof rec.contentType === 'string' ? rec.contentType : 'application/octet-stream';
            const size = typeof rec.size === 'number' ? rec.size : 0;
            return { filename, contentType, size };
        })
            .filter((item) => Boolean(item));
    }
    dedupeInboxEmails(emails) {
        const byExternalId = new Map();
        for (const email of emails) {
            const key = String(email.externalMessageId || '');
            const list = byExternalId.get(key) ?? [];
            list.push(email);
            byExternalId.set(key, list);
        }
        const deduped = [...byExternalId.values()].map((group) => {
            const ordered = [...group].sort((left, right) => {
                const leftIgnored = this.readMetadataBoolean(left.metadata, 'inboxIgnored') ? 1 : 0;
                const rightIgnored = this.readMetadataBoolean(right.metadata, 'inboxIgnored') ? 1 : 0;
                if (leftIgnored !== rightIgnored)
                    return rightIgnored - leftIgnored;
                const byUpdated = right.updatedAt.getTime() - left.updatedAt.getTime();
                if (byUpdated !== 0)
                    return byUpdated;
                return right.receivedAt.getTime() - left.receivedAt.getTime();
            });
            return ordered[0];
        });
        return deduped.sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime());
    }
};
exports.EmailsService = EmailsService;
exports.EmailsService = EmailsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        encryption_service_1.EncryptionService,
        storage_service_1.DocumentStorageService])
], EmailsService);
//# sourceMappingURL=emails.service.js.map