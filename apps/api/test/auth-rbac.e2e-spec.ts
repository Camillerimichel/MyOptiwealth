import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/modules/prisma.service';
import { AppModule } from '../src/modules/app.module';
import * as request from 'supertest';
import { authenticator } from 'otplib';

const cookieParser: () => (req: unknown, res: unknown, next: () => void) => void =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('cookie-parser');

jest.setTimeout(45_000);

describe('Auth + RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in with TOTP, refreshes via cookie, and enforces viewer RBAC', async () => {
    const suffix = Date.now().toString();

    const adminEmail = `admin.${suffix}@myoptiwealth.local`;
    const viewerEmail = `viewer.${suffix}@myoptiwealth.local`;
    const password = 'ChangeMe123!';

    const registerAdmin = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: adminEmail,
        password,
        workspaceName: `Workspace ${suffix}`,
      })
      .expect(201);

    expect(registerAdmin.body.tokens.accessToken).toBeDefined();
    expect(registerAdmin.body.tokens.refreshToken).toBeUndefined();

    const adminSecret = registerAdmin.body.twoFactorProvisioning.secret as string;
    const adminTotp = authenticator.generate(adminSecret);

    const loginAdmin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: adminEmail,
        password,
        totpCode: adminTotp,
      })
      .expect(201);

    const adminAccess = loginAdmin.body.tokens.accessToken as string;
    const setCookieHeader = loginAdmin.headers['set-cookie'];
    const setCookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : typeof setCookieHeader === 'string'
        ? [setCookieHeader]
        : [];
    const refreshCookie = setCookies.find((value: string) =>
      value.startsWith('mw_refresh_token='),
    );
    expect(refreshCookie).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie as string)
      .send({})
      .expect(201)
      .expect((response) => {
        expect(response.body.accessToken).toBeDefined();
        expect(response.body.refreshToken).toBeUndefined();
      });

    const createSociety = await request(app.getHttpServer())
      .post('/api/crm/societies')
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({ name: 'Societe Test RBAC' })
      .expect(201);

    expect(createSociety.body.id).toBeDefined();

    const registerViewer = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: viewerEmail,
        password,
        workspaceName: `Viewer Home ${suffix}`,
      })
      .expect(201);

    const viewerSecret = registerViewer.body.twoFactorProvisioning.secret as string;
    const viewerTotp = authenticator.generate(viewerSecret);

    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: viewerEmail } });

    const viewerHomeMembership = await prisma.userWorkspaceRole.findFirstOrThrow({
      where: { userId: viewer.id },
      orderBy: { createdAt: 'asc' },
    });

    await prisma.userWorkspaceRole.update({
      where: {
        userId_workspaceId: {
          userId: viewer.id,
          workspaceId: viewerHomeMembership.workspaceId,
        },
      },
      data: {
        role: 'VIEWER',
      },
    });

    const loginViewer = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: viewerEmail,
        password,
        totpCode: viewerTotp,
      })
      .expect(201);

    const viewerAccess = loginViewer.body.tokens.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/crm/societies')
      .set('Authorization', `Bearer ${viewerAccess}`)
      .send({ name: 'Forbidden Write' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/crm/societies')
      .set('Authorization', `Bearer ${viewerAccess}`)
      .expect(200);
  });
});
