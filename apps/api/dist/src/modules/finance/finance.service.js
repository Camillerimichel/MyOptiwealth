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
exports.FinanceService = void 0;
const common_1 = require("@nestjs/common");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
let FinanceService = class FinanceService {
    constructor(prisma, auditService) {
        this.prisma = prisma;
        this.auditService = auditService;
    }
    async createDocument(workspaceId, userId, dto) {
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
        await this.auditService.log(workspaceId, 'FINANCIAL_CHANGE', { financeDocumentId: doc.id, type: dto.type, amount: dto.amount }, userId);
        return doc;
    }
    listByWorkspace(workspaceId) {
        return this.prisma.financeDocument.findMany({
            where: { workspaceId },
            include: { project: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    async kpis(workspaceId) {
        const projects = await this.prisma.project.findMany({
            where: { workspaceId },
            select: {
                invoicedAmount: true,
                collectedAmount: true,
                estimatedMargin: true,
            },
        });
        const totals = projects.reduce((acc, project) => ({
            invoiced: acc.invoiced + Number(project.invoicedAmount),
            collected: acc.collected + Number(project.collectedAmount),
            margin: acc.margin + Number(project.estimatedMargin),
        }), { invoiced: 0, collected: 0, margin: 0 });
        return {
            billedRevenue: totals.invoiced,
            collectedRevenue: totals.collected,
            estimatedMargin: totals.margin,
        };
    }
};
exports.FinanceService = FinanceService;
exports.FinanceService = FinanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], FinanceService);
//# sourceMappingURL=finance.service.js.map