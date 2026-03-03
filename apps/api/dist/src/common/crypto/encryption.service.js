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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncryptionService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const ALGORITHM = 'aes-256-gcm';
let EncryptionService = class EncryptionService {
    constructor(configService) {
        this.configService = configService;
        const base64 = this.configService.getOrThrow('AES_SECRET_BASE64');
        this.key = Buffer.from(base64, 'base64');
        if (this.key.length !== 32) {
            throw new Error('AES key must be exactly 32 bytes');
        }
    }
    encrypt(plainText) {
        const iv = (0, crypto_1.randomBytes)(12);
        const cipher = (0, crypto_1.createCipheriv)(ALGORITHM, this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plainText, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    }
    decrypt(encryptedBase64) {
        const payload = Buffer.from(encryptedBase64, 'base64');
        const iv = payload.subarray(0, 12);
        const tag = payload.subarray(12, 28);
        const data = payload.subarray(28);
        const decipher = (0, crypto_1.createDecipheriv)(ALGORITHM, this.key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
    }
};
exports.EncryptionService = EncryptionService;
exports.EncryptionService = EncryptionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EncryptionService);
//# sourceMappingURL=encryption.service.js.map