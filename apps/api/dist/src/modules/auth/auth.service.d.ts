import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyTwoFactorDto } from './dto/verify-2fa.dto';
export interface TokenPayload {
    sub: string;
    email: string;
    activeWorkspaceId: string;
    isPlatformAdmin: boolean;
}
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    private readonly configService;
    private readonly encryptionService;
    private readonly auditService;
    constructor(prisma: PrismaService, jwtService: JwtService, configService: ConfigService, encryptionService: EncryptionService, auditService: AuditService);
    private signTokens;
    private persistRefreshToken;
    register(dto: RegisterDto): Promise<{
        user: {
            id: string;
            email: string;
            twoFactorEnabled: boolean;
        };
        workspace: {
            id: string;
            name: string;
        };
        tokens: TokenPair;
        twoFactorProvisioning: {
            secret: string;
            otpauth: string;
        };
    }>;
    login(dto: LoginDto): Promise<{
        user: {
            id: string;
            email: string;
            isPlatformAdmin: boolean;
        };
        activeWorkspaceId: string;
        tokens: TokenPair;
    }>;
    refresh(refreshToken: string): Promise<TokenPair>;
    issueWorkspaceSwitchTokens(userId: string, email: string, isPlatformAdmin: boolean, workspaceId: string): Promise<TokenPair>;
    verifyTwoFactor(userId: string, dto: VerifyTwoFactorDto): Promise<{
        verified: boolean;
    }>;
    logout(userId: string, workspaceId: string): Promise<{
        success: true;
    }>;
}
