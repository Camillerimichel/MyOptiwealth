import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'fs/promises';
import { basename, extname } from 'path';

interface StoredFile {
  storagePath: string;
}

@Injectable()
export class DocumentStorageService {
  private readonly driver: string;
  private readonly localBasePath: string;
  private readonly s3Bucket?: string;
  private readonly s3Client?: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.driver = this.configService.get<string>('DOCUMENT_STORAGE_DRIVER', 'local');
    this.localBasePath = this.configService.get<string>('DOCUMENT_LOCAL_BASE_PATH', '/var/www/myoptiwealth/storage/documents');

    if (this.driver === 's3') {
      const region = this.configService.get<string>('S3_REGION', 'eu-west-1');
      const bucket = this.configService.get<string>('S3_BUCKET');
      const endpoint = this.configService.get<string>('S3_ENDPOINT');
      const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY_ID');
      const secretAccessKey = this.configService.get<string>('S3_SECRET_ACCESS_KEY');

      if (bucket && accessKeyId && secretAccessKey) {
        this.s3Bucket = bucket;
        this.s3Client = new S3Client({
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

  async store(
    workspaceId: string,
    originalName: string,
    contentType: string,
    buffer: Buffer,
  ): Promise<StoredFile> {
    const safeOriginalName = this.sanitizeFileName(originalName);
    const key = `${workspaceId}/${Date.now()}-${Math.random().toString(36).slice(2)}__${safeOriginalName}`;
    return this.storeByKey(key, contentType, buffer);
  }

  private sanitizeFileName(filename: string): string {
    const raw = basename(filename || 'document.bin').trim();
    const cleaned = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!cleaned) return `document${extname(raw) || '.bin'}`;
    return cleaned;
  }

  async storeByKey(
    key: string,
    contentType: string,
    buffer: Buffer,
  ): Promise<StoredFile> {
    if (this.driver === 's3' && this.s3Client && this.s3Bucket) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType || 'application/octet-stream',
        }),
      );
      return { storagePath: `s3://${this.s3Bucket}/${key}` };
    }

    const fullPath = `${this.localBasePath}/${key}`;
    const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, buffer);
    return { storagePath: `file://${fullPath}` };
  }
}
