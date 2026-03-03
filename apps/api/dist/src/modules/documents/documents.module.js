"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsModule = void 0;
const common_1 = require("@nestjs/common");
const encryption_service_1 = require("../../common/crypto/encryption.service");
const audit_module_1 = require("../audit/audit.module");
const documents_controller_1 = require("./documents.controller");
const documents_webhook_controller_1 = require("./documents-webhook.controller");
const documents_service_1 = require("./documents.service");
const signature_service_1 = require("./signature.service");
const storage_service_1 = require("./storage.service");
let DocumentsModule = class DocumentsModule {
};
exports.DocumentsModule = DocumentsModule;
exports.DocumentsModule = DocumentsModule = __decorate([
    (0, common_1.Module)({
        imports: [audit_module_1.AuditModule],
        controllers: [documents_controller_1.DocumentsController, documents_webhook_controller_1.DocumentsWebhookController],
        providers: [documents_service_1.DocumentsService, storage_service_1.DocumentStorageService, signature_service_1.SignatureService, encryption_service_1.EncryptionService],
    })
], DocumentsModule);
//# sourceMappingURL=documents.module.js.map