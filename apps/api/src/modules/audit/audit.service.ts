import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    workspaceId: string,
    action: string,
    metadata: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        action,
        metadata: metadata as Prisma.InputJsonValue,
        userId,
      },
    });
  }

  listByWorkspace(workspaceId: string) {
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
