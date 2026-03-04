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
exports.DocumentStorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_s3_1 = require("@aws-sdk/client-s3");
const promises_1 = require("fs/promises");
const path_1 = require("path");
let DocumentStorageService = class DocumentStorageService {
    constructor(configService) {
        this.configService = configService;
        this.driver = this.configService.get('DOCUMENT_STORAGE_DRIVER', 'local');
        this.localBasePath = this.configService.get('DOCUMENT_LOCAL_BASE_PATH', '/var/www/myoptiwealth/storage/documents');
        if (this.driver === 's3') {
            const region = this.configService.get('S3_REGION', 'eu-west-1');
            const bucket = this.configService.get('S3_BUCKET');
            const endpoint = this.configService.get('S3_ENDPOINT');
            const accessKeyId = this.configService.get('S3_ACCESS_KEY_ID');
            const secretAccessKey = this.configService.get('S3_SECRET_ACCESS_KEY');
            if (bucket && accessKeyId && secretAccessKey) {
                this.s3Bucket = bucket;
                this.s3Client = new client_s3_1.S3Client({
                    region,
                    endpoint,
                    forcePathStyle: Boolean(endpoint),
                    credentials: {
                        accessKeyId,
                        secretAccessKey,
                    },
                });
            }
        }
    }
    async store(workspaceId, originalName, contentType, buffer) {
        const extension = (0, path_1.extname)(originalName) || '.bin';
        const key = `${workspaceId}/${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
        return this.storeByKey(key, contentType, buffer);
    }
    async storeByKey(key, contentType, buffer) {
        if (this.driver === 's3' && this.s3Client && this.s3Bucket) {
            await this.s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: this.s3Bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType || 'application/octet-stream',
            }));
            return { storagePath: `s3://${this.s3Bucket}/${key}` };
        }
        const fullPath = `${this.localBasePath}/${key}`;
        const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
        await (0, promises_1.mkdir)(dir, { recursive: true });
        await (0, promises_1.writeFile)(fullPath, buffer);
        return { storagePath: `file://${fullPath}` };
    }
};
exports.DocumentStorageService = DocumentStorageService;
exports.DocumentStorageService = DocumentStorageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], DocumentStorageService);
//# sourceMappingURL=storage.service.js.map