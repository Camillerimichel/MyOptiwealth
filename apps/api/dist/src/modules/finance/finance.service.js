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
const client_1 = require("@prisma/client");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
let FinanceService = class FinanceService {
    constructor(prisma, auditService) {
        this.prisma = prisma;
        this.auditService = auditService;
    }
    async createQuote(workspaceId, userId, dto) {
        const project = await this.prisma.project.findFirst({
            where: { id: dto.projectId, workspaceId },
            select: { id: true, name: true, missionType: true },
        });
        if (!project) {
            throw new common_1.BadRequestException('Projet invalide pour ce workspace.');
        }
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { name: true },
        });
        if (!workspace) {
            throw new common_1.NotFoundException('Workspace introuvable.');
        }
        const nextIndex = await this.nextQuoteIndex(workspaceId, project.id);
        const generatedReference = this.buildQuoteReference(workspace.name, project.name, nextIndex);
        const doc = await this.prisma.financeDocument.create({
            data: {
                workspaceId,
                projectId: project.id,
                type: client_1.FinancialDocumentType.QUOTE,
                name: this.buildQuoteDisplayName(project.name, project.missionType),
                reference: generatedReference,
                amount: dto.amount,
                issuedAt: dto.issuedAt ?? new Date(),
                dueDate: dto.dueDate,
                status: 'OPEN',
            },
        });
        await this.auditService.log(workspaceId, 'FINANCIAL_CHANGE', { financeDocumentId: doc.id, type: 'QUOTE', amount: dto.amount, reference: doc.reference }, userId);
        return doc;
    }
    async createInvoice(workspaceId, userId, dto) {
        const quote = await this.prisma.financeDocument.findFirst({
            where: {
                id: dto.quoteId,
                workspaceId,
                type: client_1.FinancialDocumentType.QUOTE,
            },
            include: { project: { select: { id: true, name: true } } },
        });
        if (!quote) {
            throw new common_1.BadRequestException('Devis introuvable dans ce workspace.');
        }
        const maxInvoice = await this.prisma.financeDocument.aggregate({
            where: { quoteId: quote.id, type: client_1.FinancialDocumentType.INVOICE },
            _max: { invoiceIndex: true },
        });
        const invoiceIndex = (maxInvoice._max.invoiceIndex ?? 0) + 1;
        const status = dto.status ?? 'PENDING';
        const doc = await this.prisma.financeDocument.create({
            data: {
                workspaceId,
                projectId: quote.projectId,
                quoteId: quote.id,
                invoiceIndex,
                type: client_1.FinancialDocumentType.INVOICE,
                name: `Facture ${invoiceIndex} - ${quote.project.name}`,
                reference: `${quote.reference}-F-${invoiceIndex}`,
                accountingRef: dto.accountingRef ?? null,
                amount: dto.amount,
                issuedAt: dto.issuedAt ?? new Date(),
                dueDate: dto.dueDate,
                status,
                paidAt: status === 'PAID' ? (dto.issuedAt ?? new Date()) : null,
            },
        });
        await this.auditService.log(workspaceId, 'FINANCIAL_CHANGE', { financeDocumentId: doc.id, type: 'INVOICE', amount: dto.amount, quoteId: quote.id, reference: doc.reference }, userId);
        return doc;
    }
    async updateDocument(workspaceId, userId, documentId, dto) {
        const existing = await this.prisma.financeDocument.findFirst({
            where: { id: documentId, workspaceId },
            select: {
                id: true,
                name: true,
                type: true,
                accountingRef: true,
                project: {
                    select: {
                        name: true,
                        missionType: true,
                    },
                },
            },
        });
        if (!existing) {
            throw new common_1.NotFoundException('Document financier introuvable.');
        }
        const normalizedStatus = this.normalizeStatusForDocumentType(existing.type, dto.status);
        const quoteSuffix = dto.accountingRef !== undefined
            ? (dto.accountingRef ?? undefined)
            : (dto.name !== undefined ? dto.name : undefined);
        const quoteTitle = existing.type === client_1.FinancialDocumentType.QUOTE && quoteSuffix !== undefined
            ? this.buildQuoteDisplayName(existing.project?.name ?? '', existing.project?.missionType ?? null, quoteSuffix ?? '')
            : undefined;
        const updated = await this.prisma.financeDocument.update({
            where: { id: documentId },
            data: {
                name: quoteTitle ?? (dto.name !== undefined ? dto.name : undefined),
                amount: dto.amount ?? undefined,
                issuedAt: dto.issuedAt ?? undefined,
                dueDate: dto.dueDate === null ? null : dto.dueDate ?? undefined,
                status: normalizedStatus ?? undefined,
                paidAt: dto.paidAt === null ? null : dto.paidAt ?? undefined,
                accountingRef: dto.accountingRef === null ? null : dto.accountingRef ?? undefined,
            },
        });
        await this.auditService.log(workspaceId, 'FINANCIAL_CHANGE', { financeDocumentId: updated.id, type: existing.type, status: updated.status, amount: updated.amount }, userId);
        return updated;
    }
    listByWorkspace(workspaceId) {
        return this.prisma.financeDocument.findMany({
            where: { workspaceId },
            include: { project: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    async overview(workspaceId, projectId) {
        const where = {
            workspaceId,
            type: client_1.FinancialDocumentType.QUOTE,
            ...(projectId ? { projectId } : {}),
        };
        const quotes = await this.prisma.financeDocument.findMany({
            where,
            include: {
                project: true,
                invoices: {
                    where: { type: client_1.FinancialDocumentType.INVOICE },
                    orderBy: [{ invoiceIndex: 'asc' }, { createdAt: 'asc' }],
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return quotes.map((quote) => {
            const paidInvoicesTotal = quote.invoices
                .filter((invoice) => invoice.status === 'PAID')
                .reduce((sum, invoice) => sum + Number(invoice.amount), 0);
            const pendingInvoicesTotal = quote.invoices
                .filter((invoice) => invoice.status !== 'PAID')
                .reduce((sum, invoice) => sum + Number(invoice.amount), 0);
            return {
                quote: {
                    id: quote.id,
                    projectId: quote.projectId,
                    projectName: quote.project.name,
                    name: quote.name,
                    reference: quote.reference,
                    accountingRef: quote.accountingRef,
                    amount: Number(quote.amount),
                    status: quote.status,
                    issuedAt: quote.issuedAt,
                    dueDate: quote.dueDate,
                },
                totals: {
                    paidInvoicesTotal,
                    pendingInvoicesTotal,
                },
                invoices: quote.invoices.map((invoice) => ({
                    id: invoice.id,
                    name: invoice.name,
                    reference: invoice.reference,
                    accountingRef: invoice.accountingRef,
                    amount: Number(invoice.amount),
                    status: invoice.status,
                    invoiceIndex: invoice.invoiceIndex,
                    issuedAt: invoice.issuedAt,
                    dueDate: invoice.dueDate,
                    paidAt: invoice.paidAt,
                })),
            };
        });
    }
    async kpis(workspaceId, projectId) {
        const [quotes, invoices] = await Promise.all([
            this.prisma.financeDocument.findMany({
                where: {
                    workspaceId,
                    type: client_1.FinancialDocumentType.QUOTE,
                    ...(projectId ? { projectId } : {}),
                },
                select: {
                    amount: true,
                    status: true,
                },
            }),
            this.prisma.financeDocument.findMany({
                where: {
                    workspaceId,
                    type: client_1.FinancialDocumentType.INVOICE,
                    ...(projectId ? { projectId } : {}),
                },
                select: {
                    amount: true,
                    status: true,
                },
            }),
        ]);
        const billedRevenue = quotes
            .filter((quote) => (quote.status || '').toUpperCase() !== 'CANCELLED')
            .reduce((sum, quote) => sum + Number(quote.amount), 0);
        const invoiceTotals = invoices.reduce((acc, invoice) => {
            const amount = Number(invoice.amount);
            const status = (invoice.status || '').toUpperCase();
            if (status === 'PAID') {
                acc.collected += amount;
                return acc;
            }
            return acc;
        }, { collected: 0 });
        const pendingRevenue = Math.max(0, billedRevenue - invoiceTotals.collected);
        return {
            billedRevenue,
            collectedRevenue: invoiceTotals.collected,
            pendingRevenue,
            estimatedMargin: 0,
        };
    }
    async nextQuoteIndex(workspaceId, projectId) {
        const count = await this.prisma.financeDocument.count({
            where: {
                workspaceId,
                projectId,
                type: client_1.FinancialDocumentType.QUOTE,
            },
        });
        return count + 1;
    }
    buildQuoteReference(workspaceName, projectName, index) {
        const workspaceToken = this.toReferenceToken(workspaceName);
        const projectToken = this.toReferenceToken(projectName);
        return `${workspaceToken}-${projectToken}-TEMPO-${index}`;
    }
    toReferenceToken(value) {
        const normalized = value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        return normalized || 'NA';
    }
    buildQuoteDisplayName(projectName, missionType, customSuffix) {
        const missionLabel = this.humanizeMissionType(missionType);
        const base = `${projectName || 'Projet'} (${missionLabel})`;
        const normalizedSuffix = this.stripQuotePrefix(customSuffix?.trim() ?? '', projectName, missionLabel, missionType ?? '');
        return normalizedSuffix ? `${base} - ${normalizedSuffix}` : base;
    }
    stripQuotePrefix(value, projectName, missionLabel, missionType) {
        const trimmed = value.trim();
        if (!trimmed)
            return '';
        const normalize = (text) => text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[\u2013]/g, '-')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const project = normalize(projectName || '');
        const mission = normalize(missionLabel || missionType || '');
        const projectWords = project ? project.split(' ') : [];
        const missionWords = mission ? mission.split(' ') : [];
        const isMetaToken = (token) => {
            const normalized = normalize(token);
            if (!normalized)
                return false;
            if (/^devis\b/.test(normalized))
                return true;
            if (normalized === project || normalized === mission)
                return true;
            const words = normalized.split(' ').filter((word) => word);
            if (!words.length)
                return false;
            const projectOverlap = words.filter((word) => projectWords.includes(word)).length;
            const missionOverlap = words.filter((word) => missionWords.includes(word)).length;
            const matchingCount = Math.max(projectOverlap, missionOverlap);
            if (matchingCount === 0)
                return false;
            return matchingCount >= Math.max(1, words.length - 1);
        };
        const parts = trimmed.split(/\s*[-–]\s*/).map((part) => part.trim()).filter(Boolean);
        if (!parts.length)
            return '';
        let cursor = 0;
        while (cursor < parts.length && isMetaToken(parts[cursor])) {
            cursor += 1;
        }
        if (cursor >= parts.length) {
            const trailingMatch = trimmed.match(/\([^)]*\)\s*$/);
            return trailingMatch ? trailingMatch[0].trim() : '';
        }
        const suffix = parts.slice(cursor).join(' - ');
        return suffix || '';
    }
    humanizeMissionType(missionType) {
        if (!missionType)
            return 'MISSION';
        return missionType;
    }
    normalizeStatusForDocumentType(type, rawStatus) {
        if (!rawStatus)
            return null;
        const normalized = rawStatus
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();
        if (type === client_1.FinancialDocumentType.QUOTE) {
            if (normalized === 'OPEN' || normalized === 'OUVERT')
                return 'OPEN';
            if (normalized === 'CANCELLED' || normalized === 'ANNULE' || normalized === 'ANNULEE')
                return 'CANCELLED';
            throw new common_1.BadRequestException('Pour un devis, le statut doit etre OPEN ou CANCELLED.');
        }
        if (normalized === 'PENDING' || normalized === 'EN ATTENTE' || normalized === 'EN_ATTENTE')
            return 'PENDING';
        if (normalized === 'PAID' || normalized === 'PAYE' || normalized === 'PAYEE')
            return 'PAID';
        if (normalized === 'CANCELLED' || normalized === 'ANNULE' || normalized === 'ANNULEE')
            return 'CANCELLED';
        throw new common_1.BadRequestException('Pour une facture, le statut doit etre PENDING, PAID ou CANCELLED.');
    }
};
exports.FinanceService = FinanceService;
exports.FinanceService = FinanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], FinanceService);
//# sourceMappingURL=finance.service.js.map