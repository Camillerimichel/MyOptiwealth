import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkspaceInterceptor } from '../common/interceptors/workspace.interceptor';
import { RequestTelemetryInterceptor } from '../common/interceptors/request-telemetry.interceptor';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { CalendarModule } from './calendar/calendar.module';
import { CrmModule } from './crm/crm.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentsModule } from './documents/documents.module';
import { EmailsModule } from './emails/emails.module';
import { FinanceModule } from './finance/finance.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { TimesheetModule } from './timesheet/timesheet.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    ObservabilityModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 600,
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    UsersModule,
    WorkspacesModule,
    CrmModule,
    ProjectsModule,
    TasksModule,
    CalendarModule,
    EmailsModule,
    DocumentsModule,
    FinanceModule,
    TimesheetModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: WorkspaceInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestTelemetryInterceptor,
    },
  ],
})
export class AppModule {}
