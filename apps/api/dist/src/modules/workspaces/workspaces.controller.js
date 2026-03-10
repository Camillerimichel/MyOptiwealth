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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspacesController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const workspace_roles_decorator_1 = require("../../common/decorators/workspace-roles.decorator");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const workspace_role_guard_1 = require("../../common/guards/workspace-role.guard");
const client_1 = require("@prisma/client");
const auth_service_1 = require("../auth/auth.service");
const create_workspace_dto_1 = require("./dto/create-workspace.dto");
const delete_workspace_dto_1 = require("./dto/delete-workspace.dto");
const add_workspace_note_dto_1 = require("./dto/add-workspace-note.dto");
const update_workspace_dto_1 = require("./dto/update-workspace.dto");
const update_workspace_settings_dto_1 = require("./dto/update-workspace-settings.dto");
const workspaces_service_1 = require("./workspaces.service");
let WorkspacesController = class WorkspacesController {
    constructor(workspacesService, authService, configService) {
        this.workspacesService = workspacesService;
        this.authService = authService;
        this.configService = configService;
    }
    refreshCookieName() {
        return this.configService.get('REFRESH_COOKIE_NAME', 'mw_refresh_token');
    }
    isCookieSecure() {
        return this.configService.get('COOKIE_SECURE', 'false') === 'true';
    }
    list(user) {
        return this.workspacesService.listForUser(user.sub);
    }
    create(user, dto) {
        return this.workspacesService.createByPlatformAdmin(user.sub, user.isPlatformAdmin, dto);
    }
    updateWorkspace(user, workspaceId, dto) {
        return this.workspacesService.updateWorkspace(user.sub, workspaceId, dto);
    }
    deleteWorkspace(user, workspaceId, dto) {
        return this.workspacesService.deleteWorkspace(user.sub, workspaceId, dto.confirmation);
    }
    async switch(user, workspaceId, response) {
        const switched = await this.workspacesService.switchWorkspace(user.sub, workspaceId);
        const tokens = await this.authService.issueWorkspaceSwitchTokens(user.sub, user.email, user.isPlatformAdmin, workspaceId);
        response.cookie(this.refreshCookieName(), tokens.refreshToken, {
            httpOnly: true,
            secure: this.isCookieSecure(),
            sameSite: 'lax',
            path: '/api/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        return { ...switched, accessToken: tokens.accessToken };
    }
    settings(user) {
        return this.workspacesService.getSettings(user.activeWorkspaceId);
    }
    updateSettings(user, dto) {
        return this.workspacesService.updateSettings(user.activeWorkspaceId, user.sub, dto);
    }
    listNotes(user) {
        return this.workspacesService.listWorkspaceNotes(user.activeWorkspaceId);
    }
    listNotesAll(user) {
        return this.workspacesService.listWorkspaceNotesAll(user.sub);
    }
    addNote(user, dto) {
        return this.workspacesService.appendWorkspaceNote(user.activeWorkspaceId, user.sub, dto.content);
    }
};
exports.WorkspacesController = WorkspacesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_workspace_dto_1.CreateWorkspaceDto]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':workspaceId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('workspaceId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_workspace_dto_1.UpdateWorkspaceDto]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "updateWorkspace", null);
__decorate([
    (0, common_1.Post)(':workspaceId/delete'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('workspaceId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, delete_workspace_dto_1.DeleteWorkspaceDto]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "deleteWorkspace", null);
__decorate([
    (0, common_1.Post)(':workspaceId/switch'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR, client_1.WorkspaceRole.VIEWER),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('workspaceId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], WorkspacesController.prototype, "switch", null);
__decorate([
    (0, common_1.Get)('settings/current'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR, client_1.WorkspaceRole.VIEWER),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "settings", null);
__decorate([
    (0, common_1.Post)('settings/current'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_workspace_settings_dto_1.UpdateWorkspaceSettingsDto]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "updateSettings", null);
__decorate([
    (0, common_1.Get)('notes/current'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR, client_1.WorkspaceRole.VIEWER),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "listNotes", null);
__decorate([
    (0, common_1.Get)('notes/all'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR, client_1.WorkspaceRole.VIEWER),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "listNotesAll", null);
__decorate([
    (0, common_1.Post)('notes/current'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR, client_1.WorkspaceRole.VIEWER),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, add_workspace_note_dto_1.AddWorkspaceNoteDto]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "addNote", null);
exports.WorkspacesController = WorkspacesController = __decorate([
    (0, common_1.Controller)('workspaces'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, workspace_role_guard_1.WorkspaceRoleGuard),
    __metadata("design:paramtypes", [workspaces_service_1.WorkspacesService,
        auth_service_1.AuthService,
        config_1.ConfigService])
], WorkspacesController);
//# sourceMappingURL=workspaces.controller.js.map