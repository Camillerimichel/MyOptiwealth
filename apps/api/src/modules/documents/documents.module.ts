import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditModule } from '../audit/audit.module';
import { DocumentsController } from './documents.controller';
import { DocumentsWebhookController } from './documents-webhook.controller';
import { DocumentsService } from './documents.service';
import { SignatureService } from './signature.service';
import { DocumentStorageService } from './storage.service';

@Module({
  imports: [AuditModule],
  controllers: [DocumentsController, DocumentsWebhookController],
  providers: [DocumentsService, DocumentStorageService, SignatureService, EncryptionService],
})
export class DocumentsModule {}
