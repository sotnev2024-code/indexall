import { Controller, Get, Query, Res, Param, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { OAuthService, OAuthProvider } from './oauth.service';
import { ConfigService } from '@nestjs/config';
import { ActivityLogService } from '../admin/activity-log.service';

const VALID_PROVIDERS: OAuthProvider[] = ['google', 'yandex', 'mailru'];

@ApiTags('oauth')
@Controller('auth/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly configService: ConfigService,
    private readonly activityLog: ActivityLogService,
    private readonly jwtService: JwtService,
  ) {}

  /** Redirect user to provider's OAuth consent screen */
  @Get(':provider')
  @ApiOperation({ summary: 'Начать OAuth авторизацию' })
  redirect(@Param('provider') provider: string, @Res() res: Response) {
    if (!VALID_PROVIDERS.includes(provider as OAuthProvider)) {
      return res.status(400).json({ message: `Unknown provider: ${provider}` });
    }
    try {
      const url = this.oauthService.getAuthorizationUrl(provider as OAuthProvider);
      return res.redirect(url);
    } catch (err: any) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/auth/login?error=oauth_not_configured`);
    }
  }

  /** OAuth callback — exchange code, create/find user, redirect frontend with JWT */
  @Get(':provider/callback')
  @ApiOperation({ summary: 'OAuth callback' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('error') oauthError: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    if (oauthError) {
      return res.redirect(`${frontendUrl}/auth/login?error=${encodeURIComponent(oauthError)}`);
    }

    if (!VALID_PROVIDERS.includes(provider as OAuthProvider) || !code) {
      return res.redirect(`${frontendUrl}/auth/login?error=invalid_callback`);
    }

    try {
      const result = await this.oauthService.handleCallback(provider as OAuthProvider, code);

      // Decode userId from the freshly-issued JWT so we can log it properly
      try {
        const payload: any = this.jwtService.decode(result.accessToken);
        if (payload?.userId) {
          this.activityLog.log(
            payload.userId,
            (result.isNew ? `register_${provider}` : `login_${provider}`) as any,
            result.isNew ? 'новый пользователь' : 'повторный вход',
          );
        }
      } catch {}

      const params = new URLSearchParams({
        token: result.accessToken,
        provider,
        ...(result.isNew ? { isNew: '1' } : {}),
        ...(result.demoSheetId ? { demoSheetId: String(result.demoSheetId) } : {}),
        ...(result.trialActivated ? {
          trialActivated: '1',
          trialName: result.trialName,
          trialDays: String(result.trialDays),
        } : {}),
      });

      return res.redirect(`${frontendUrl}/auth/oauth/callback?${params.toString()}`);
    } catch (err: any) {
      this.logger.error(`OAuth callback error [${provider}]: ${err.message}`, err.stack);
      return res.redirect(`${frontendUrl}/auth/login?error=${encodeURIComponent(err.message || 'oauth_error')}`);
    }
  }
}
