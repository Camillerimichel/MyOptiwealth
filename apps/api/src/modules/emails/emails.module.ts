import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { DocumentsModule } from '../documents/documents.module';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';

@Module({
  imports: [DocumentsModule],
  controllers: [EmailsController],
  providers: [EmailsService, EncryptionService],
})
export class EmailsModule {}
