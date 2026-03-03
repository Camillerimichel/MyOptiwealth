import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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

@Controller('auth')
@SkipThrottle()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private refreshCookieName(): string {
    return this.configService.get<string>('REFRESH_COOKIE_NAME', 'mw_refresh_token');
  }

  private isCookieSecure(): boolean {
    return this.configService.get<string>('COOKIE_SECURE', 'false') === 'true';
  }

  @Post('register')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const payload = await this.authService.register(dto);
    const accessOnlyTokens = { accessToken: payload.tokens.accessToken };
    response.cookie(this.refreshCookieName(), payload.tokens.refreshToken, {
      httpOnly: true,
      secure: this.isCookieSecure(),
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return {
      ...payload,
      tokens: accessOnlyTokens,
    };
  }

  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const payload = await this.authService.login(dto);
    const accessOnlyTokens = { accessToken: payload.tokens.accessToken };
    response.cookie(this.refreshCookieName(), payload.tokens.refreshToken, {
      httpOnly: true,
      secure: this.isCookieSecure(),
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return {
      ...payload,
      tokens: accessOnlyTokens,
    };
  }

  @Post('refresh')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieToken = request.cookies?.[this.refreshCookieName()] as string | undefined;
    const refreshToken = dto.refreshToken ?? cookieToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const tokens = await this.authService.refresh(refreshToken);
    response.cookie(this.refreshCookieName(), tokens.refreshToken, {
      httpOnly: true,
      secure: this.isCookieSecure(),
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { accessToken: tokens.accessToken };
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  verifyTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: VerifyTwoFactorDto) {
    return this.authService.verifyTwoFactor(user.sub, dto);
  }

  @Post('logout')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.clearCookie(this.refreshCookieName(), {
      path: '/api/auth',
    });
    return this.authService.logout(user.sub, user.activeWorkspaceId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
