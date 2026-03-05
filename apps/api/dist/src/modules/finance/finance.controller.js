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
exports.FinanceController = void 0;
const common_1 = require("@nestjs/common");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const workspace_roles_decorator_1 = require("../../common/decorators/workspace-roles.decorator");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const workspace_role_guard_1 = require("../../common/guards/workspace-role.guard");
const client_1 = require("@prisma/client");
const create_invoice_dto_1 = require("./dto/create-invoice.dto");
const create_quote_dto_1 = require("./dto/create-quote.dto");
const update_finance_document_dto_1 = require("./dto/update-finance-document.dto");
const finance_service_1 = require("./finance.service");
let FinanceController = class FinanceController {
    constructor(financeService) {
        this.financeService = financeService;
    }
    list(user) {
        return this.financeService.listByWorkspace(user.activeWorkspaceId);
    }
    overview(user, projectId) {
        return this.financeService.overview(user.activeWorkspaceId, projectId);
    }
    createQuote(user, dto) {
        return this.financeService.createQuote(user.activeWorkspaceId, user.sub, dto);
    }
    createInvoice(user, dto) {
        return this.financeService.createInvoice(user.activeWorkspaceId, user.sub, dto);
    }
    updateDocument(user, documentId, dto) {
        return this.financeService.updateDocument(user.activeWorkspaceId, user.sub, documentId, dto);
    }
    kpis(user, projectId) {
        return this.financeService.kpis(user.activeWorkspaceId, projectId);
    }
};
exports.FinanceController = FinanceController;
__decorate([
    (0, common_1.Get)('documents'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('overview'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "overview", null);
__decorate([
    (0, common_1.Post)('quotes'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_quote_dto_1.CreateQuoteDto]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "createQuote", null);
__decorate([
    (0, common_1.Post)('invoices'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_invoice_dto_1.CreateInvoiceDto]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "createInvoice", null);
__decorate([
    (0, common_1.Patch)('documents/:documentId'),
    (0, workspace_roles_decorator_1.WorkspaceRoles)(client_1.WorkspaceRole.ADMIN, client_1.WorkspaceRole.COLLABORATOR),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('documentId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_finance_document_dto_1.UpdateFinanceDocumentDto]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "updateDocument", null);
__decorate([
    (0, common_1.Get)('kpis'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "kpis", null);
exports.FinanceController = FinanceController = __decorate([
    (0, common_1.Controller)('finance'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, workspace_role_guard_1.WorkspaceRoleGuard),
    __metadata("design:paramtypes", [finance_service_1.FinanceService])
], FinanceController);
//# sourceMappingURL=finance.controller.js.map