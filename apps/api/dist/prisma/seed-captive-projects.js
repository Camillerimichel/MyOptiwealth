"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const BASE_TASKS = [
    {
        phaseCode: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE,
        description: 'Validation du besoin commercial et recensement des cas d’usage',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE,
        description: 'Collecte du dossier de cadrage (contrats, états financiers, organigramme)',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE,
        description: 'Analyse préliminaire de l’opportunité et mapping des parties prenantes',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT,
        description: 'Rédiger la lettre d’opportunité',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT,
        description: 'Consolider la proposition commerciale et le modèle de facturation',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT,
        description: 'Finaliser et faire signer la lettre de mission',
        priority: 1,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
        description: 'Définir le périmètre opérationnel de la captive (produits, clients, sinistres)',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
        description: 'Étudier la structure juridique et fiscale de la société captive',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
        description: 'Évaluer les impacts réglementaires (assurance / solvabilité / conformité)',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
        description: 'Élaborer le business plan de démarrage et le plan d’affaires opérationnel',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS,
        description: 'Rédiger la présentation comité de décision',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS,
        description: 'Présenter et arbitrer les scénarios retenus',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS,
        description: 'Intégrer les ajustements et finaliser le dossier',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE,
        description: 'Création de la captive à Malte (constitution, licences, gouvernance initiale)',
        priority: 1,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE,
        description: 'Recrutement et onboarding des équipes opérationnelles',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE,
        description: 'Déployer l’environnement opérationnel (procédures, outils, reporting)',
        priority: 3,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.CLOTURE_SUIVI,
        description: 'Démarrage opérationnel et transfert de connaissances',
        priority: 2,
    },
    {
        phaseCode: client_1.ProjectPhaseCode.CLOTURE_SUIVI,
        description: 'Facturation de clôture et cadrage du suivi post-mise en œuvre',
        priority: 2,
    },
];
const CAPTIVE_VARIANTS = {
    CAPTIVE_SIMPLE: [
        {
            phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
            description: 'Simplifier la charte opérationnelle (pack de process standardisé)',
            priority: 3,
        },
        {
            phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE,
            description: 'Mettre en place un dispositif opérationnel allégé pour le go-live',
            priority: 2,
        },
    ],
    CAPTIVE_NEAT: [
        {
            phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
            description: 'Définir la gouvernance NEAT avec comités de risques et d’audit',
            priority: 2,
        },
        {
            phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE,
            description: 'Déployer les contrôles internes et le cadre de risque NEAT',
            priority: 2,
        },
        {
            phaseCode: client_1.ProjectPhaseCode.CLOTURE_SUIVI,
            description: 'Mettre en place le dispositif de reporting consolidé NEAT',
            priority: 2,
        },
    ],
    CAPTIVE_NEAT_VISA: [
        {
            phaseCode: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION,
            description: 'Intégrer les exigences spécifiques du dispositif Visa dans le schéma de captivisation',
            priority: 2,
        },
        {
            phaseCode: client_1.ProjectPhaseCode.MISE_EN_OEUVRE,
            description: 'Paramétrer le workflow opérationnel spécifique Visa',
            priority: 2,
        },
    ],
};
const PROJECTS = [
    {
        workspaceName: 'Captive / Neat',
        societyName: 'NEAT',
        projectName: 'Création captive Malte – NEAT',
        missionType: 'CAPTIVE_NEAT',
        estimatedFees: '42000',
        estimatedMargin: '18800',
        taskTemplate: [...BASE_TASKS, ...CAPTIVE_VARIANTS.CAPTIVE_NEAT],
    },
    {
        workspaceName: 'Captive / Neat -> Visa',
        societyName: 'NEAT',
        projectName: 'Création captive Malte – NEAT Visa',
        missionType: 'CAPTIVE_NEAT_VISA',
        estimatedFees: '36000',
        estimatedMargin: '15000',
        taskTemplate: [...BASE_TASKS, ...CAPTIVE_VARIANTS.CAPTIVE_NEAT_VISA],
    },
    {
        workspaceName: 'Captive +Simple',
        societyName: '+Simple',
        projectName: 'Création captive Malte – +Simple',
        missionType: 'CAPTIVE_SIMPLE',
        estimatedFees: '30000',
        estimatedMargin: '13200',
        taskTemplate: [...BASE_TASKS, ...CAPTIVE_VARIANTS.CAPTIVE_SIMPLE],
    },
];
const PHASES = [
    { code: client_1.ProjectPhaseCode.QUALIFICATION_CADRAGE, title: 'Qualification & Cadrage', position: 1 },
    { code: client_1.ProjectPhaseCode.FORMALISATION_ENGAGEMENT, title: 'Formalisation & Engagement', position: 2 },
    { code: client_1.ProjectPhaseCode.ANALYSE_STRUCTURATION, title: 'Analyse & Structuration', position: 3 },
    { code: client_1.ProjectPhaseCode.PRESENTATION_AJUSTEMENTS, title: 'Présentation & Ajustements', position: 4 },
    { code: client_1.ProjectPhaseCode.MISE_EN_OEUVRE, title: 'Mise en œuvre', position: 5 },
    { code: client_1.ProjectPhaseCode.CLOTURE_SUIVI, title: 'Clôture & Suivi', position: 6 },
];
async function seedProject(plan) {
    const workspace = await prisma.workspace.findFirst({ where: { name: plan.workspaceName } });
    if (!workspace) {
        throw new Error(`Workspace introuvable: ${plan.workspaceName}`);
    }
    const society = await prisma.society.findFirst({
        where: {
            workspaceId: workspace.id,
            name: plan.societyName,
        },
    });
    if (!society) {
        throw new Error(`Société introuvable dans ${plan.workspaceName}: ${plan.societyName}`);
    }
    const existingProject = await prisma.project.findFirst({
        where: {
            workspaceId: workspace.id,
            name: plan.projectName,
        },
    });
    if (existingProject) {
        console.log(`[SKIP] Projet déjà existant: ${plan.workspaceName} / ${plan.projectName}`);
        return;
    }
    const project = await prisma.project.create({
        data: {
            workspaceId: workspace.id,
            societyId: society.id,
            name: plan.projectName,
            missionType: plan.missionType,
            estimatedFees: plan.estimatedFees,
            estimatedMargin: plan.estimatedMargin,
            phases: {
                create: PHASES.map((phase) => ({
                    workspaceId: workspace.id,
                    code: phase.code,
                    title: phase.title,
                    position: phase.position,
                })),
            },
        },
        include: {
            phases: true,
        },
    });
    const phaseByCode = new Map(project.phases.map((phase) => [phase.code, phase.id]));
    const existingTaskNames = new Set((await prisma.task.findMany({
        where: { projectId: project.id },
        select: { description: true },
    })).map((task) => task.description));
    let orderNumber = 1;
    const tasksData = plan.taskTemplate
        .filter((task) => !existingTaskNames.has(task.description))
        .map((task) => {
        const projectPhaseId = phaseByCode.get(task.phaseCode);
        if (!projectPhaseId) {
            return null;
        }
        return {
            workspaceId: workspace.id,
            projectId: project.id,
            projectPhaseId,
            description: task.description,
            priority: task.priority,
            visibleToClient: false,
            status: client_1.TaskStatus.TODO,
            orderNumber: orderNumber++,
        };
    })
        .filter((task) => task !== null);
    if (tasksData.length > 0) {
        await prisma.task.createMany({ data: tasksData });
    }
    const createdTasks = tasksData.length;
    console.log(`[OK] Projet créé: ${plan.workspaceName} / ${plan.projectName} (${createdTasks} tâches)`);
}
async function main() {
    for (const plan of PROJECTS) {
        await seedProject(plan);
    }
}
main()
    .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed-captive-projects.js.map