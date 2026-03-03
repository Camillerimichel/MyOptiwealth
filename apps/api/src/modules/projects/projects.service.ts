import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectPhaseCode, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const PHASES: Array<{ code: ProjectPhaseCode; title: string; position: number }> = [
  { code: ProjectPhaseCode.QUALIFICATION_CADRAGE, title: 'Qualification & Cadrage', position: 1 },
  { code: ProjectPhaseCode.FORMALISATION_ENGAGEMENT, title: 'Formalisation & Engagement', position: 2 },
  { code: ProjectPhaseCode.ANALYSE_STRUCTURATION, title: 'Analyse & Structuration', position: 3 },
  { code: ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, title: 'Présentation & Ajustements', position: 4 },
  { code: ProjectPhaseCode.MISE_EN_OEUVRE, title: 'Mise en œuvre', position: 5 },
  { code: ProjectPhaseCode.CLOTURE_SUIVI, title: 'Clôture & Suivi', position: 6 },
];

interface TemplateTask {
  phaseCode: ProjectPhaseCode;
  description: string;
  priority: number;
}

const BASE_TEMPLATE_TASKS: TemplateTask[] = [
  { phaseCode: ProjectPhaseCode.QUALIFICATION_CADRAGE, description: 'Collecte des informations client et objectifs', priority: 3 },
  { phaseCode: ProjectPhaseCode.QUALIFICATION_CADRAGE, description: 'Validation du périmètre de mission', priority: 2 },
  { phaseCode: ProjectPhaseCode.FORMALISATION_ENGAGEMENT, description: 'Préparer la lettre de mission', priority: 3 },
  { phaseCode: ProjectPhaseCode.FORMALISATION_ENGAGEMENT, description: 'Valider la proposition d honoraires', priority: 2 },
  { phaseCode: ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Réaliser les analyses patrimoniales et fiscales', priority: 3 },
  { phaseCode: ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Documenter les scenarii de structuration', priority: 2 },
  { phaseCode: ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, description: 'Préparer la presentation client', priority: 2 },
  { phaseCode: ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, description: 'Intégrer les ajustements validés', priority: 2 },
  { phaseCode: ProjectPhaseCode.MISE_EN_OEUVRE, description: 'Lancer les actions opérationnelles', priority: 3 },
  { phaseCode: ProjectPhaseCode.MISE_EN_OEUVRE, description: 'Coordonner les parties prenantes externes', priority: 2 },
  { phaseCode: ProjectPhaseCode.CLOTURE_SUIVI, description: 'Clôturer le dossier et archiver les livrables', priority: 1 },
  { phaseCode: ProjectPhaseCode.CLOTURE_SUIVI, description: 'Planifier le suivi post-mission', priority: 1 },
];

const VARIANT_TEMPLATE_TASKS: Record<string, TemplateTask[]> = {
  WEALTH_STRATEGY: [
    { phaseCode: ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Arbitrage allocation actifs et passifs', priority: 3 },
  ],
  SUCCESSION: [
    { phaseCode: ProjectPhaseCode.ANALYSE_STRUCTURATION, description: 'Analyse des impacts successoraux multi-scenarios', priority: 3 },
  ],
  CORPORATE_FINANCE: [
    { phaseCode: ProjectPhaseCode.MISE_EN_OEUVRE, description: 'Coordination avec experts comptables et avocats', priority: 2 },
  ],
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(workspaceId: string, userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        workspaceId,
        name: dto.name,
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
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (tasksData.length > 0) {
      await this.prisma.task.createMany({
        data: tasksData,
      });
    }

    await this.auditService.log(workspaceId, 'PROJECT_CREATED', { projectId: project.id, name: project.name }, userId);

    return project;
  }

  async update(workspaceId: string, userId: string, projectId: string, dto: UpdateProjectDto) {
    const result = await this.prisma.project.updateMany({
      where: { id: projectId, workspaceId },
      data: {
        name: dto.name,
        missionType: dto.missionType,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Projet introuvable dans ce workspace');
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

  async list(workspaceId: string) {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      include: {
        society: true,
        phases: { orderBy: { position: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalTasksByProject = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: { workspaceId },
      _count: { _all: true },
    });

    const doneTasksByProject = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: { workspaceId, status: TaskStatus.DONE },
      _count: { _all: true },
    });

    const totalByProjectId = new Map(totalTasksByProject.map((row) => [row.projectId, row._count._all]));
    const doneByProjectId = new Map(doneTasksByProject.map((row) => [row.projectId, row._count._all]));

    return projects.map((project) => {
      const total = totalByProjectId.get(project.id) ?? 0;
      const done = doneByProjectId.get(project.id) ?? 0;
      const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        ...project,
        progressPercent,
      };
    });
  }
}
