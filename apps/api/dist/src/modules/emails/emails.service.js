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
const imapflow_1 = require("imapflow");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const prisma_service_1 = require("../prisma.service");
let EmailsService = class EmailsService {
    constructor(prisma, encryptionService) {
        this.prisma = prisma;
        this.encryptionService = encryptionService;
    }
    list(workspaceId) {
        return this.prisma.emailMessage.findMany({
            where: { workspaceId },
            include: { project: true },
            orderBy: { receivedAt: 'desc' },
        });
    }
    upsertMetadata(workspaceId, dto) {
        return this.prisma.emailMessage.upsert({
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
                projectId: dto.projectId,
            },
            create: {
                workspaceId,
                externalMessageId: dto.externalMessageId,
                fromAddress: dto.fromAddress,
                toAddresses: dto.toAddresses,
                subject: dto.subject,
                receivedAt: new Date(),
                metadata: {},
                projectId: dto.projectId,
            },
        });
    }
    async syncFromImap(workspaceId) {
        const settings = await this.prisma.workspaceSettings.findUnique({
            where: { workspaceId },
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
        for await (const message of client.fetch('1:*', {
            uid: true,
            envelope: true,
            internalDate: true,
        })) {
            fetched.push(message);
        }
        const latest = fetched.slice(-20);
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
            const receivedAt = message.internalDate ?? new Date();
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
};
exports.EmailsService = EmailsService;
exports.EmailsService = EmailsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        encryption_service_1.EncryptionService])
], EmailsService);
//# sourceMappingURL=emails.service.js.map