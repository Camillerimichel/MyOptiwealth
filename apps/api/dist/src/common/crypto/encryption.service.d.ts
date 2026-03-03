import { ConfigService } from '@nestjs/config';
export declare class EncryptionService {
    private readonly configService;
    private readonly key;
    constructor(configService: ConfigService);
    encrypt(plainText: string): string;
    decrypt(encryptedBase64: string): string;
}
