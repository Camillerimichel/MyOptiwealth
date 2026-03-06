import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WORKSPACE_SOURCE = 'Captive / Neat';
const WORKSPACE_TARGETS = ['Captive +Simple', 'Captive / Neat -> Visa'];
const SOURCE_PROJECT_NAMES = ['Création captive Malt - NEAT', 'Création captive Malte – NEAT', 'Création captive Malte - NEAT'];

const TARGET_PROJECTS_BY_WORKSPACE: Record<string, string[]> = {
  'Captive +Simple': [
    'Création captive Malte – +Simple',
    'Création captive Malte – +Simple (CAPTIVE_SIMPLE)',
  ],
  'Captive / Neat -> Visa': [
    'Création captive Malte – NEAT Visa',
    'Création captive Malte – NEAT Visa (CAPTIVE_NEAT_VISA)',
  ],
};

async function main() {
  const sourceWorkspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_SOURCE },
  });
  if (!sourceWorkspace) {
    throw new Error(`Workspace source introuvable: ${WORKSPACE_SOURCE}`);
  }

  const sourceProjects = await prisma.project.findMany({
    where: {
      workspaceId: sourceWorkspace.id,
      name: { in: SOURCE_PROJECT_NAMES },
    },
  });

  const sourceProject =
    sourceProjects.find((project) => project.name === 'Création captive Malt - NEAT') ??
    sourceProjects.find((project) => project.name === 'Création captive Malte – NEAT') ??
    sourceProjects.find((project) => project.name === 'Création captive Malte - NEAT');

  if (!sourceProject) {
    throw new Error(`Projet source introuvable dans ${WORKSPACE_SOURCE}: ${SOURCE_PROJECT_NAMES.join(', ')}`);
  }

  const sourceEntries = await prisma.timeEntry.findMany({
    where: { projectId: sourceProject.id },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const sourceTasks = await prisma.task.findMany({
    where: { projectId: sourceProject.id },
    orderBy: { orderNumber: 'asc' },
    select: {
      id: true,
      description: true,
      orderNumber: true,
      startsAfterTaskId: true,
      planningStartDate: true,
      plannedDurationDays: true,
      planningEndDate: true,
      overrunDays: true,
      progressPercent: true,
      fte: true,
    },
  });

  const sourceByDescription = new Map<string, string>(sourceTasks.map((task) => [task.description, task.id]));
  const sourceTaskById = new Map(sourceTasks.map((task) => [task.id, task.description]));

  const targetWorkspaces = await prisma.workspace.findMany({
    where: { name: { in: WORKSPACE_TARGETS } },
  });

  for (const targetWorkspace of targetWorkspaces) {
    const candidateProjectNames = TARGET_PROJECTS_BY_WORKSPACE[targetWorkspace.name];
    if (!candidateProjectNames?.length) {
      continue;
    }

    const targetProject = await prisma.project.findFirst({
      where: {
        workspaceId: targetWorkspace.id,
        name: { in: candidateProjectNames },
      },
    });

    if (!targetProject) {
      console.log(`[SKIP] Projet cible introuvable dans ${targetWorkspace.name}`);
      continue;
    }

    const targetTasks = await prisma.task.findMany({
      where: { projectId: targetProject.id },
      orderBy: { orderNumber: 'asc' },
      select: {
        id: true,
        description: true,
        orderNumber: true,
      },
    });

    const targetByDescription = new Map<string, string>(targetTasks.map((task) => [task.description, task.id]));
    const targetByOrder = new Map<number, string>(targetTasks.map((task) => [task.orderNumber, task.id]));

    const taskIdMapping = new Map<string, string>();
    for (const sourceTask of sourceTasks) {
      const mappedTargetTaskId =
        targetByDescription.get(sourceTask.description) ?? targetByOrder.get(sourceTask.orderNumber);

      if (mappedTargetTaskId) {
        taskIdMapping.set(sourceTask.id, mappedTargetTaskId);
      }
    }

    let updatedTasks = 0;
    for (const sourceTask of sourceTasks) {
      const targetTaskId = taskIdMapping.get(sourceTask.id);
      if (!targetTaskId) {
        continue;
      }

      const mappedStartsAfterTaskId = sourceTask.startsAfterTaskId
        ? taskIdMapping.get(sourceTask.startsAfterTaskId) ?? null
        : null;

      await prisma.task.update({
        where: { id: targetTaskId },
        data: {
          startsAfterTaskId: mappedStartsAfterTaskId,
          planningStartDate: sourceTask.planningStartDate,
          plannedDurationDays: sourceTask.plannedDurationDays,
          planningEndDate: sourceTask.planningEndDate,
          overrunDays: sourceTask.overrunDays,
          progressPercent: sourceTask.progressPercent,
          fte: sourceTask.fte,
        },
      });
      updatedTasks += 1;
    }

    console.log(`[OK] Plan du timesheet copié sur ${targetWorkspace.name} / ${targetProject.name} (${updatedTasks} tâches mises à jour)`);

    const existingEntries = await prisma.timeEntry.findMany({
      where: { projectId: targetProject.id },
      select: {
        userId: true,
        taskId: true,
        entryDate: true,
        minutesSpent: true,
      },
    });

    const seen = new Set(
      existingEntries.map((entry) => `${entry.userId}|${entry.taskId ?? ''}|${entry.entryDate.toISOString()}|${entry.minutesSpent}`),
    );

    const toCreate: Array<{
      workspaceId: string;
      projectId: string;
      userId: string;
      taskId?: string | null;
      minutesSpent: number;
      entryDate: Date;
    }> = [];

    for (const sourceEntry of sourceEntries) {
      const sourceTaskDescription = sourceEntry.taskId ? sourceTaskById.get(sourceEntry.taskId) : null;
      const mappedTaskId = sourceTaskDescription ? targetByDescription.get(sourceTaskDescription) : null;
      const entryKey = `${sourceEntry.userId}|${mappedTaskId ?? ''}|${sourceEntry.entryDate.toISOString()}|${sourceEntry.minutesSpent}`;

      if (seen.has(entryKey)) {
        continue;
      }

      toCreate.push({
        workspaceId: targetWorkspace.id,
        projectId: targetProject.id,
        userId: sourceEntry.userId,
        minutesSpent: sourceEntry.minutesSpent,
        entryDate: sourceEntry.entryDate,
        taskId: mappedTaskId,
      });
    }

    if (toCreate.length > 0) {
      await prisma.timeEntry.createMany({ data: toCreate });
      console.log(`[OK] Cloné ${toCreate.length} entrée(s) vers ${targetWorkspace.name} / ${targetProject.name}`);
    } else {
      console.log(`[SKIP] Aucune entrée à cloner pour ${targetWorkspace.name} / ${targetProject.name}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
