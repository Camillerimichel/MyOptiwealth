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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const workspace_roles_decorator_1 = require("../../common/decorators/workspace-roles.decorator");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const workspace_role_guard_1 = require("../../common/guards/workspace-role.guard");
const create_workspace_user_dto_1 = require("./dto/create-workspace-user.dto");
const update_workspace_user_dto_1 = require("./dto/update-workspace-user.dto");
const users_service_1 = require("./users.service");
let UsersController = class UsersController {
    constructor(usersService) {
        this.usersService = usersService;
    }
    list(user) {
        return this.usersService.listWorkspaceUsers(user.activeWorkspaceId);
    }
    create(user, dto) {
        return this.usersService.createWorkspaceUser(user.activeWorkspaceId, user.sub, dto);
    }
    update(user, userId, dto) {
        return this.usersService.updateWorkspaceUser(user.activeWorkspaceId, user.sub, userId, dto);
    }
    getTwoFactorProvisioning(user, userId) {
        return this.usersService.getUserTwoFactorProvisioning(user.activeWorkspaceId, userId);
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)(),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_workspace_user_dto_1.CreateWorkspaceUserDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':userId'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('userId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_workspace_user_dto_1.UpdateWorkspaceUserDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Get)(':userId/2fa-provisioning'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getTwoFactorProvisioning", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, workspace_role_guard_1.WorkspaceRoleGuard),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], UsersController);
//# sourceMappingURL=users.controller.js.map