import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, EncryptionService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
