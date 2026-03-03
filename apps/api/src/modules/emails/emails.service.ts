import { Injectable } from '@nestjs/common';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../prisma.service';
import { LinkEmailDto } from './dto/link-email.dto';

@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.emailMessage.findMany({
      where: { workspaceId },
      include: { project: true },
      orderBy: { receivedAt: 'desc' },
    });
  }

  upsertMetadata(workspaceId: string, dto: LinkEmailDto) {
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

  async syncFromImap(workspaceId: string): Promise<{ synced: number }> {
    const settings = await this.prisma.workspaceSettings.findUnique({
      where: { workspaceId },
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
        .filter((address): address is string => typeof address === 'string');
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

  private decryptOrRaw(value: string): string {
    try {
      return this.encryptionService.decrypt(value);
    } catch {
      return value;
    }
  }
}
