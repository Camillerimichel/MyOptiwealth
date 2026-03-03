import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateFinanceDocumentDto } from './dto/create-finance-document.dto';

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createDocument(workspaceId: string, userId: string, dto: CreateFinanceDocumentDto) {
    const doc = await this.prisma.financeDocument.create({
      data: {
        workspaceId,
        projectId: dto.projectId,
        type: dto.type,
        reference: dto.reference,
        amount: dto.amount,
        dueDate: dto.dueDate,
        status: dto.status,
      },
    });

    await this.auditService.log(
      workspaceId,
      'FINANCIAL_CHANGE',
      { financeDocumentId: doc.id, type: dto.type, amount: dto.amount },
      userId,
    );

    return doc;
  }

  listByWorkspace(workspaceId: string) {
    return this.prisma.financeDocument.findMany({
      where: { workspaceId },
      include: { project: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async kpis(workspaceId: string) {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: {
        invoicedAmount: true,
        collectedAmount: true,
        estimatedMargin: true,
      },
    });

    const totals = projects.reduce(
      (acc, project) => ({
        invoiced: acc.invoiced + Number(project.invoicedAmount),
        collected: acc.collected + Number(project.collectedAmount),
        margin: acc.margin + Number(project.estimatedMargin),
      }),
      { invoiced: 0, collected: 0, margin: 0 },
    );

    return {
      billedRevenue: totals.invoiced,
      collectedRevenue: totals.collected,
      estimatedMargin: totals.margin,
    };
  }
}
