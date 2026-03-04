import { ConfigService } from '@nestjs/config';
interface StoredFile {
    storagePath: string;
}
export declare class DocumentStorageService {
    private readonly configService;
    private readonly driver;
    private readonly localBasePath;
    private readonly s3Bucket?;
    private readonly s3Client?;
    constructor(configService: ConfigService);
    store(workspaceId: string, originalName: string, contentType: string, buffer: Buffer): Promise<StoredFile>;
    storeByKey(key: string, contentType: string, buffer: Buffer): Promise<StoredFile>;
}
export {};
