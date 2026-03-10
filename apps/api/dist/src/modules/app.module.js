"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const workspace_interceptor_1 = require("../common/interceptors/workspace.interceptor");
const request_telemetry_interceptor_1 = require("../common/interceptors/request-telemetry.interceptor");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const auth_module_1 = require("./auth/auth.module");
const audit_module_1 = require("./audit/audit.module");
const calendar_module_1 = require("./calendar/calendar.module");
const crm_module_1 = require("./crm/crm.module");
const dashboard_module_1 = require("./dashboard/dashboard.module");
const documents_module_1 = require("./documents/documents.module");
const emails_module_1 = require("./emails/emails.module");
const finance_module_1 = require("./finance/finance.module");
const health_controller_1 = require("./health.controller");
const prisma_module_1 = require("./prisma.module");
const projects_module_1 = require("./projects/projects.module");
const tasks_module_1 = require("./tasks/tasks.module");
const timesheet_module_1 = require("./timesheet/timesheet.module");
const users_module_1 = require("./users/users.module");
const workspaces_module_1 = require("./workspaces/workspaces.module");
const observability_module_1 = require("./observability/observability.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                expandVariables: true,
            }),
            observability_module_1.ObservabilityModule,
            throttler_1.ThrottlerModule.forRoot({
                throttlers: [
                    {
                        ttl: 60_000,
                        limit: 600,
                    },
                ],
            }),
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            audit_module_1.AuditModule,
            users_module_1.UsersModule,
            workspaces_module_1.WorkspacesModule,
            crm_module_1.CrmModule,
            projects_module_1.ProjectsModule,
            tasks_module_1.TasksModule,
            calendar_module_1.CalendarModule,
            emails_module_1.EmailsModule,
            documents_module_1.DocumentsModule,
            finance_module_1.FinanceModule,
            timesheet_module_1.TimesheetModule,
            dashboard_module_1.DashboardModule,
        ],
        controllers: [health_controller_1.HealthController],
        providers: [
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: workspace_interceptor_1.WorkspaceInterceptor,
            },
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: request_telemetry_interceptor_1.RequestTelemetryInterceptor,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map