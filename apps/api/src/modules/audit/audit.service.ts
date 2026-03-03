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

  async listByWorkspace(workspaceId: string, page = 1, pageSize = 25) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where: { workspaceId } }),
      this.prisma.auditLog.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safePageSize,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };
  }
}
