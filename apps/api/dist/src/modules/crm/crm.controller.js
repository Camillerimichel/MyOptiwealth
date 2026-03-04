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
exports.CrmController = void 0;
const common_1 = require("@nestjs/common");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const workspace_roles_decorator_1 = require("../../common/decorators/workspace-roles.decorator");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const workspace_role_guard_1 = require("../../common/guards/workspace-role.guard");
const client_1 = require("@prisma/client");
const create_contact_dto_1 = require("./dto/create-contact.dto");
const create_society_dto_1 = require("./dto/create-society.dto");
const crm_service_1 = require("./crm.service");
const update_contact_dto_1 = require("./dto/update-contact.dto");
const update_society_dto_1 = require("./dto/update-society.dto");
let CrmController = class CrmController {
    constructor(crmService) {
        this.crmService = crmService;
    }
    listSocieties(user) {
        return this.crmService.listSocieties(user.activeWorkspaceId);
    }
    listSocietiesAll(user) {
        return this.crmService.listSocietiesAll(user.sub);
    }
    createSociety(user, dto) {
        return this.crmService.createSociety(user.activeWorkspaceId, dto);
    }
    updateSociety(user, societyId, dto) {
        return this.crmService.updateSociety(user.activeWorkspaceId, societyId, dto);
    }
    listContacts(user) {
        return this.crmService.listContacts(user.activeWorkspaceId);
    }
    listContactsAll(user) {
        return this.crmService.listContactsAll(user.sub);
    }
    createContact(user, dto) {
        return this.crmService.createContact(user.activeWorkspaceId, dto);
    }
    updateContact(user, contactId, dto) {
        return this.crmService.updateContact(user.activeWorkspaceId, contactId, dto);
    }
};
exports.CrmController = CrmController;
__decorate([
    (0, common_1.Get)('societies'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "listSocieties", null);
__decorate([
    (0, common_1.Get)('societies/all'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "listSocietiesAll", null);
__decorate([
    (0, common_1.Post)('societies'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_society_dto_1.CreateSocietyDto]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "createSociety", null);
__decorate([
    (0, common_1.Patch)('societies/:societyId'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('societyId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_society_dto_1.UpdateSocietyDto]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "updateSociety", null);
__decorate([
    (0, common_1.Get)('contacts'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "listContacts", null);
__decorate([
    (0, common_1.Get)('contacts/all'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "listContactsAll", null);
__decorate([
    (0, common_1.Post)('contacts'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_contact_dto_1.CreateContactDto]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "createContact", null);
__decorate([
    (0, common_1.Patch)('contacts/:contactId'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('contactId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_contact_dto_1.UpdateContactDto]),
    __metadata("design:returntype", void 0)
], CrmController.prototype, "updateContact", null);
exports.CrmController = CrmController = __decorate([
    (0, common_1.Controller)('crm'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, workspace_role_guard_1.WorkspaceRoleGuard),
    __metadata("design:paramtypes", [crm_service_1.CrmService])
], CrmController);
//# sourceMappingURL=crm.controller.js.map