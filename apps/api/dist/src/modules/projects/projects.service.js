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
exports.ProjectsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const audit_service_1 = require("../audit/audit.service");
const prisma_service_1 = require("../prisma.service");
const PHASES = [
    { code: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE, title: 'Qualification & Cadrage', position: 1 },
    { code: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT, title: 'Formalisation & Engagement', position: 2 },
    { code: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION, title: 'Analyse & Structuration', position: 3 },
    { code: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, title: 'Présentation & Ajustements', position: 4 },
    { code: client_1.ProjectPhaseCode.MISE_EN_OEUVRE, title: 'Mise en œuvre', position: 5 },
    { code: client_1.ProjectPhaseCode.CLOTURE_SUIVI, title: 'Clôture & Suivi', position: 6 },
];
const collator = new Intl.Collator('fr', { sensitivity: 'base' });
function normalizeForSort(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}
function compareProjectByName(a, b) {
    return collator.compare(normalizeForSort(a.name), normalizeForSort(b.name));
}
const BASE_TEMPLATE_TASKS = [
    { phaseCode: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE, description: 'Collecte des informations client et objectifs', priority: 3 },
    { phaseCode: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE, description: 'Validation du périmètre de mission', priority: 2 },
    { phaseCode: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT, description: 'Préparer la lettre de mission', priority: 3 },
    { phaseCode: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT, description: 'Valider la proposition d honoraires', priority: 2 },
    { phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Réaliser les analyses patrimoniales et fiscales', priority: 3 },
    { phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Documenter les scenarii de structuration', priority: 2 },
    { phaseCode: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, description: 'Préparer la presentation client', priority: 2 },
    { phaseCode: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, description: 'Intégrer les ajustements validés', priority: 2 },
    { phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE, description: 'Lancer les actions opérationnelles', priority: 3 },
    { phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE, description: 'Coordonner les parties prenantes externes', priority: 2 },
    { phaseCode: client_1.ProjectPhaseCode.CLOTURE_SUIVI, description: 'Clôturer le dossier et archiver les livrables', priority: 1 },
    { phaseCode: client_1.ProjectPhaseCode.CLOTURE_SUIVI, description: 'Planifier le suivi post-mission', priority: 1 },
];
const VARIANT_TEMPLATE_TASKS = {
    WEALTH_STRATEGY: [
        { phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Arbitrage allocation actifs et passifs', priority: 3 },
    ],
    SUCCESSION: [
        { phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Analyse des impacts successoraux multi-scenarios', priority: 3 },
    ],
    CORPORATE_FINANCE: [
        { phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE, description: 'Coordination avec experts comptables et avocats', priority: 2 },
    ],
};
let ProjectsService = class ProjectsService {
    constructor(prisma, auditService) {
        this.prisma = prisma;
        this.auditService = auditService;
    }
    async create(workspaceId, userId, dto) {
        const normalizedName = dto.name.trim();
        const society = await this.prisma.society.findFirst({
            where: {
                id: dto.societyId,
                workspaceId,
            },
            select: { id: true },
        });
        if (!society) {
            throw new common_1.NotFoundException('Societe introuvable dans ce workspace');
        }
        const existing = await this.prisma.project.findFirst({
            where: {
                workspaceId,
                societyId: dto.societyId,
                name: normalizedName,
            },
            select: { id: true },
        });
        if (existing) {
            throw new common_1.BadRequestException('Un projet avec ce nom existe déjà pour cette société.');
        }
        const project = await this.prisma.project.create({
            data: {
                workspaceId,
                name: normalizedName,
                societyId: dto.societyId,
                estimatedFees: dto.estimatedFees,
                missionType: dto.missionType,
                phases: {
                    create: PHASES.map((phase) => ({
                        workspaceId,
                        code: phase.code,
                        title: phase.title,
                        position: phase.position,
                    })),
                },
            },
            include: {
                phases: {
                    orderBy: { position: 'asc' },
                },
            },
        });
        const phaseByCode = new Map(project.phases.map((phase) => [phase.code, phase.id]));
        const variantTasks = dto.missionType ? (VARIANT_TEMPLATE_TASKS[dto.missionType] ?? []) : [];
        const templateTasks = [...BASE_TEMPLATE_TASKS, ...variantTasks];
        const tasksData = templateTasks
            .map((task) => {
            const phaseId = phaseByCode.get(task.phaseCode);
            if (!phaseId) {
                return null;
            }
            return {
                workspaceId,
                projectId: project.id,
                projectPhaseId: phaseId,
                description: task.description,
                priority: task.priority,
                visibleToClient: false,
            };
        })
            .filter((item) => item !== null);
        if (tasksData.length > 0) {
            await this.prisma.task.createMany({
                data: tasksData,
            });
        }
        await this.auditService.log(workspaceId, 'PROJECT_CREATED', { projectId: project.id, name: project.name }, userId);
        return project;
    }
    async update(workspaceId, userId, projectId, dto) {
        const normalizedName = dto.name?.trim();
        if (normalizedName) {
            const current = await this.prisma.project.findFirst({
                where: { id: projectId, workspaceId },
                select: { societyId: true },
            });
            if (!current) {
                throw new common_1.NotFoundException('Projet introuvable dans ce workspace');
            }
            const existing = await this.prisma.project.findFirst({
                where: {
                    workspaceId,
                    societyId: current.societyId,
                    name: normalizedName,
                    id: { not: projectId },
                },
                select: { id: true },
            });
            if (existing) {
                throw new common_1.BadRequestException('Un projet avec ce nom existe déjà pour cette société.');
            }
        }
        const result = await this.prisma.project.updateMany({
            where: { id: projectId, workspaceId },
            data: {
                name: normalizedName ?? dto.name,
                missionType: dto.missionType,
            },
        });
        if (result.count === 0) {
            throw new common_1.NotFoundException('Projet introuvable dans ce workspace');
        }
        await this.auditService.log(workspaceId, 'PROJECT_UPDATED', { projectId, updatedFields: Object.keys(dto) }, userId);
        return this.prisma.project.findUnique({
            where: { id: projectId },
            include: {
                society: true,
                phases: { orderBy: { position: 'asc' } },
            },
        });
    }
    async list(workspaceId) {
        const projects = await this.prisma.project.findMany({
            where: { workspaceId },
            include: {
                society: true,
                phases: { orderBy: { position: 'asc' } },
                contacts: {
                    include: {
                        contact: {
                            include: {
                                society: true,
                            },
                        },
                    },
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
            },
        });
        const totalTasksByProject = await this.prisma.task.groupBy({
            by: ['projectId'],
            where: { workspaceId },
            _count: { _all: true },
        });
        const doneTasksByProject = await this.prisma.task.groupBy({
            by: ['projectId'],
            where: { workspaceId, status: client_1.TaskStatus.DONE },
            _count: { _all: true },
        });
        const totalByProjectId = new Map(totalTasksByProject.map((row) => [row.projectId, row._count._all]));
        const doneByProjectId = new Map(doneTasksByProject.map((row) => [row.projectId, row._count._all]));
        return projects.sort(compareProjectByName).map((project) => {
            const total = totalByProjectId.get(project.id) ?? 0;
            const done = doneByProjectId.get(project.id) ?? 0;
            const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;
            return {
                ...project,
                progressPercent,
            };
        });
    }
    async listProjectContacts(workspaceId, projectId) {
        await this.getProjectOrThrow(workspaceId, projectId);
        return this.prisma.projectContact.findMany({
            where: { projectId },
            include: {
                contact: {
                    include: {
                        society: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async addProjectContact(workspaceId, userId, projectId, dto) {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, workspaceId },
            select: {
                id: true,
            },
        });
        if (!project) {
            throw new common_1.NotFoundException('Projet introuvable dans ce workspace');
        }
        const [workspaceSocieties, selectedContact] = await Promise.all([
            this.prisma.society.findMany({
                where: { workspaceId },
                select: { name: true },
            }),
            this.prisma.contact.findUnique({
                where: { id: dto.contactId },
                include: {
                    society: {
                        select: { name: true },
                    },
                },
            }),
        ]);
        if (!selectedContact) {
            throw new common_1.NotFoundException('Contact introuvable');
        }
        const workspaceSocietyNames = new Set(workspaceSocieties.map((society) => normalizeForSort(society.name)).filter(Boolean));
        const contactSocietyName = normalizeForSort(selectedContact.society?.name ?? '');
        if (!workspaceSocietyNames.has(contactSocietyName)) {
            throw new common_1.NotFoundException('Contact introuvable dans les sociétés du workspace');
        }
        const resolvedContactId = selectedContact.id;
        const result = await this.prisma.projectContact.upsert({
            where: { projectId_contactId: { projectId, contactId: resolvedContactId } },
            update: {
                projectRole: dto.projectRole,
            },
            create: {
                projectId,
                contactId: resolvedContactId,
                projectRole: dto.projectRole,
            },
            include: {
                contact: {
                    include: {
                        society: true,
                    },
                },
            },
        });
        await this.auditService.log(workspaceId, 'PROJECT_CONTACT_LINKED', { projectId, contactId: resolvedContactId }, userId);
        return result;
    }
    async updateProjectContact(workspaceId, userId, projectId, contactId, dto) {
        await this.getProjectOrThrow(workspaceId, projectId);
        const result = await this.prisma.projectContact.update({
            where: { projectId_contactId: { projectId, contactId } },
            data: {
                projectRole: dto.projectRole,
            },
            include: {
                contact: {
                    include: {
                        society: true,
                    },
                },
            },
        });
        await this.auditService.log(workspaceId, 'PROJECT_CONTACT_UPDATED', { projectId, contactId }, userId);
        return result;
    }
    async removeProjectContact(workspaceId, userId, projectId, contactId) {
        await this.getProjectOrThrow(workspaceId, projectId);
        await this.prisma.projectContact.delete({
            where: { projectId_contactId: { projectId, contactId } },
        });
        await this.auditService.log(workspaceId, 'PROJECT_CONTACT_UNLINKED', { projectId, contactId }, userId);
        return { success: true };
    }
    async getProjectOrThrow(workspaceId, projectId) {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, workspaceId },
            select: { id: true },
        });
        if (!project) {
            throw new common_1.NotFoundException('Projet introuvable dans ce workspace');
        }
        return project;
    }
    async getContactOrThrow(workspaceId, contactId) {
        const contact = await this.prisma.contact.findFirst({
            where: { id: contactId, workspaceId },
            select: { id: true },
        });
        if (!contact) {
            throw new common_1.NotFoundException('Contact introuvable dans ce workspace');
        }
        return contact;
    }
};
exports.ProjectsService = ProjectsService;
exports.ProjectsService = ProjectsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], ProjectsService);
//# sourceMappingURL=projects.service.js.map