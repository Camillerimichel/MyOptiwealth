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
exports.DocumentsWebhookController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const signature_webhook_dto_1 = require("./dto/signature-webhook.dto");
const documents_service_1 = require("./documents.service");
let DocumentsWebhookController = class DocumentsWebhookController {
    constructor(documentsService, configService) {
        this.documentsService = documentsService;
        this.configService = configService;
    }
    applyWebhook(dto, token, workspaceId) {
        const expected = this.configService.get('SIGNATURE_WEBHOOK_TOKEN', 'dev_webhook_token');
        if (!token || token !== expected) {
            throw new common_1.UnauthorizedException('Invalid webhook token');
        }
        if (!workspaceId) {
            throw new common_1.UnauthorizedException('Missing workspace id header');
        }
        return this.documentsService.applySignatureWebhook(workspaceId, dto);
    }
};
exports.DocumentsWebhookController = DocumentsWebhookController;
__decorate([
    (0, common_1.Post)('webhook'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('x-signature-webhook-token')),
    __param(2, (0, common_1.Headers)('x-workspace-id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [signature_webhook_dto_1.SignatureWebhookDto, String, String]),
    __metadata("design:returntype", void 0)
], DocumentsWebhookController.prototype, "applyWebhook", null);
exports.DocumentsWebhookController = DocumentsWebhookController = __decorate([
    (0, common_1.Controller)('documents/signature'),
    __metadata("design:paramtypes", [documents_service_1.DocumentsService,
        config_1.ConfigService])
], DocumentsWebhookController);
//# sourceMappingURL=documents-webhook.controller.js.map