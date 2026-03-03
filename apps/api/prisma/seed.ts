import { WorkspaceRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const demoEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@myoptiwealth.local';
  const demoPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const demoWorkspaceName = process.env.SEED_WORKSPACE_NAME ?? 'MyOptiwealth Demo Workspace';

  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? '12');
  const passwordHash = await bcrypt.hash(demoPassword, rounds);

  let workspace = await prisma.workspace.findFirst({
    where: { name: demoWorkspaceName },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: demoWorkspaceName,
      },
    });
  }

  await prisma.workspaceSettings.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: { workspaceId: workspace.id },
  });

  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {
      passwordHash,
    },
    create: {
      email: demoEmail,
      passwordHash,
      twoFactorEnabled: false,
      isPlatformAdmin: true,
    },
  });

  await prisma.userWorkspaceRole.upsert({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
    update: {
      role: WorkspaceRole.ADMIN,
      isDefault: true,
    },
    create: {
      userId: user.id,
      workspaceId: workspace.id,
      role: WorkspaceRole.ADMIN,
      isDefault: true,
    },
  });

  let society = await prisma.society.findFirst({
    where: {
      workspaceId: workspace.id,
      name: 'Client Démo',
    },
  });

  if (!society) {
    society = await prisma.society.create({
      data: {
        workspaceId: workspace.id,
        name: 'Client Démo',
        legalForm: 'SAS',
      },
    });
  }

  const existingProject = await prisma.project.findFirst({
    where: {
      workspaceId: workspace.id,
      name: 'Mission Optimisation Patrimoniale 2026',
    },
  });

  if (!existingProject) {
    await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        societyId: society.id,
        name: 'Mission Optimisation Patrimoniale 2026',
        progressPercent: 15,
        estimatedFees: '12000',
        estimatedMargin: '6200',
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: 'DB_SEEDED',
      metadata: {
        seededAt: new Date().toISOString(),
      },
    },
  });

  console.log('Seed complete:');
  console.log(`- Workspace: ${workspace.name}`);
  console.log(`- Admin email: ${demoEmail}`);
  console.log(`- Admin password: ${demoPassword}`);
  console.log('- 2FA: disabled for seed account (enable after first login flow)');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
