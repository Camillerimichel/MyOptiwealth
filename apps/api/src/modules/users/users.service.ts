import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  listWorkspaceUsers(workspaceId: string) {
    return this.prisma.userWorkspaceRole.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            isPlatformAdmin: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
