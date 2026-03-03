import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyTwoFactorDto } from './dto/verify-2fa.dto';
import { Request, Response } from 'express';
interface AuthUser {
    sub: string;
    email: string;
    activeWorkspaceId: string;
    isPlatformAdmin: boolean;
}
export declare class AuthController {
    private readonly authService;
    private readonly configService;
    constructor(authService: AuthService, configService: ConfigService);
    private refreshCookieName;
    private isCookieSecure;
    register(dto: RegisterDto, response: Response): Promise<{
        tokens: {
            accessToken: string;
        };
        user: {
            id: string;
            email: string;
            twoFactorEnabled: boolean;
        };
        workspace: {
            id: string;
            name: string;
        };
        twoFactorProvisioning: {
            secret: string;
            otpauth: string;
        };
    }>;
    login(dto: LoginDto, response: Response): Promise<{
        tokens: {
            accessToken: string;
        };
        user: {
            id: string;
            email: string;
            isPlatformAdmin: boolean;
        };
        activeWorkspaceId: string;
    }>;
    refresh(dto: RefreshDto, request: Request, response: Response): Promise<{
        accessToken: string;
    }>;
    verifyTwoFactor(user: AuthUser, dto: VerifyTwoFactorDto): Promise<{
        verified: boolean;
    }>;
    logout(user: AuthUser, response: Response): Promise<{
        success: true;
    }>;
    me(user: AuthUser): AuthUser;
}
export {};
