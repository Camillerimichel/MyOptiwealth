import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma.module';
import { EncryptionService } from '../../common/crypto/encryption.service';

@Module({
  imports: [ConfigModule, JwtModule.register({}), AuditModule, PrismaModule],
  providers: [AuthService, JwtStrategy, EncryptionService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
