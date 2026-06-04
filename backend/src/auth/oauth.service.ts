import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User, UserPlan } from '../users/user.entity';
import { TariffConfig } from '../admin/tariff-config.entity';
import { TariffOperation } from '../admin/tariff-operation.entity';
import { AppSetting } from '../admin/app-setting.entity';
import { AuthService } from './auth.service';
import { randomUUID } from 'crypto';

export type OAuthProvider = 'google' | 'yandex' | 'mailru';

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
}

interface OAuthUserInfo {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    private authService: AuthService,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(TariffConfig) private tariffConfigRepo: Repository<TariffConfig>,
    @InjectRepository(TariffOperation) private tariffOpsRepo: Repository<TariffOperation>,
    @InjectRepository(AppSetting) private settingsRepo: Repository<AppSetting>,
  ) {}

  private getCallbackUrl(provider: OAuthProvider): string {
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:4000';
    return `${appUrl}/api/auth/oauth/${provider}/callback`;
  }

  private getProviderConfig(provider: OAuthProvider): ProviderConfig | null {
    const cfgMap: Record<OAuthProvider, ProviderConfig> = {
      google: {
        clientId: this.configService.get<string>('GOOGLE_CLIENT_ID') || '',
        clientSecret: this.configService.get<string>('GOOGLE_CLIENT_SECRET') || '',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
        scope: 'openid email profile',
      },
      yandex: {
        clientId: this.configService.get<string>('YANDEX_CLIENT_ID') || '',
        clientSecret: this.configService.get<string>('YANDEX_CLIENT_SECRET') || '',
        authUrl: 'https://oauth.yandex.ru/authorize',
        tokenUrl: 'https://oauth.yandex.ru/token',
        userInfoUrl: 'https://login.yandex.ru/info?format=json',
        scope: 'login:email login:info',
      },
      mailru: {
        clientId: this.configService.get<string>('MAILRU_CLIENT_ID') || '',
        clientSecret: this.configService.get<string>('MAILRU_CLIENT_SECRET') || '',
        authUrl: 'https://oauth.mail.ru/login',
        tokenUrl: 'https://oauth.mail.ru/token',
        userInfoUrl: 'https://oauth.mail.ru/userinfo',
        scope: 'userinfo',
      },
    };
    return cfgMap[provider] || null;
  }

  /** Returns the provider authorization URL to redirect the user to */
  getAuthorizationUrl(provider: OAuthProvider, state?: string): string {
    const cfg = this.getProviderConfig(provider);
    if (!cfg || !cfg.clientId) {
      throw new BadRequestException(`OAuth provider ${provider} is not configured`);
    }
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.getCallbackUrl(provider),
      response_type: 'code',
      scope: cfg.scope,
      ...(state ? { state } : {}),
    });
    return `${cfg.authUrl}?${params.toString()}`;
  }

  /** Exchange code → access token */
  private async exchangeCode(provider: OAuthProvider, code: string): Promise<string> {
    const cfg = this.getProviderConfig(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: this.getCallbackUrl(provider),
    });

    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`[${provider}] token exchange failed: ${text}`);
      throw new BadRequestException(`OAuth token exchange failed for ${provider}`);
    }
    const json: any = await res.json();
    return json.access_token as string;
  }

  /** Fetch user info from provider using access token */
  private async fetchUserInfo(provider: OAuthProvider, accessToken: string): Promise<OAuthUserInfo> {
    const cfg = this.getProviderConfig(provider);
    const res = await fetch(cfg.userInfoUrl, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`[${provider}] userinfo failed: ${text}`);
      throw new BadRequestException(`Failed to fetch user info from ${provider}`);
    }
    const data: any = await res.json();

    if (provider === 'google') {
      return { id: data.sub, email: data.email, name: data.name || data.email };
    }
    if (provider === 'yandex') {
      return { id: String(data.id), email: data.default_email || data.emails?.[0], name: data.real_name || data.display_name || data.login };
    }
    if (provider === 'mailru') {
      return { id: data.id, email: data.email, name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.email };
    }
    throw new BadRequestException(`Unknown provider: ${provider}`);
  }

  /**
   * Main OAuth handler: exchange code, get user info, find-or-create user, generate JWT.
   * Returns { accessToken, isNew, trialActivated, trialName, trialDays }
   */
  async handleCallback(provider: OAuthProvider, code: string): Promise<{
    accessToken: string;
    isNew: boolean;
    trialActivated: boolean;
    trialName: string;
    trialDays: number;
    demoSheetId: number | null;
  }> {
    const accessToken = await this.exchangeCode(provider, code);
    const info = await this.fetchUserInfo(provider, accessToken);

    if (!info.email) {
      throw new BadRequestException(`Could not get email from ${provider}. Check app permissions.`);
    }

    // Try to find by oauthId+provider first, then by email
    let user = await this.usersRepo.findOne({ where: { oauthId: info.id, oauthProvider: provider } });
    if (!user) {
      user = await this.usersRepo.findOne({ where: { email: info.email } });
    }

    let isNew = false;
    let trialActivated = false;
    let trialName = '';
    let trialDays = 0;
    let demoSheetId: number | null = null;

    if (!user) {
      // Create new user — no email verification needed for OAuth
      isNew = true;
      const newUser = this.usersRepo.create({
        email: info.email,
        name: info.name || info.email.split('@')[0],
        password: randomUUID(), // random unusable password
        emailVerified: true,
        oauthProvider: provider,
        oauthId: info.id,
        plan: UserPlan.FREE,
      });
      user = await this.usersRepo.save(newUser);

      // Auto-activate free tariff (same as email registration)
      const result = await this.autoActivateFreeTariff(user);
      trialActivated = result.trialActivated;
      trialName = result.trialName;
      trialDays = result.trialDays;

      // Create demo project from default template (same as email registration)
      this.logger.log(`OAuth: creating demo project for new user ${user.id}`);
      demoSheetId = await this.authService.createDemoProject(user.id);
      this.logger.log(`OAuth: demo project created, demoSheetId=${demoSheetId}`);
    } else {
      // Link OAuth provider to existing account if not yet linked
      if (!user.oauthProvider) {
        await this.usersRepo.update(user.id, { oauthProvider: provider, oauthId: info.id });
      }
      await this.usersRepo.update(user.id, { lastSeen: new Date() });
    }

    const fresh = await this.usersRepo.findOne({ where: { id: user.id } });
    const jwt = this.jwtService.sign({ userId: fresh.id, email: fresh.email, plan: fresh.plan });

    return { accessToken: jwt, isNew, trialActivated, trialName, trialDays, demoSheetId };
  }

  private async autoActivateFreeTariff(user: User): Promise<{ trialActivated: boolean; trialName: string; trialDays: number }> {
    if (user.trialUsed || user.plan === UserPlan.ADMIN) {
      return { trialActivated: false, trialName: '', trialDays: 0 };
    }

    const freeTariff = await this.getRegistrationTariff();
    if (!freeTariff) return { trialActivated: false, trialName: '', trialDays: 0 };

    const expiresAt = new Date();
    if (freeTariff.duration_unit === 'month') {
      expiresAt.setMonth(expiresAt.getMonth() + Number(freeTariff.duration_value));
    } else {
      expiresAt.setDate(expiresAt.getDate() + Number(freeTariff.duration_value));
    }

    await this.usersRepo.update(user.id, { plan: UserPlan.PRO, trialUsed: true, subscriptionExpiresAt: expiresAt });
    try {
      await this.tariffOpsRepo.save({
        userId: user.id,
        operator: 'auto',
        plan: freeTariff.plan_key,
        amount: 0,
        status: 'active',
        expiresAt,
        comment: `Авто-активация при OAuth-регистрации (${freeTariff.name})`,
        payment_id: `auto_${randomUUID()}`,
      });
    } catch {}

    const days = freeTariff.duration_unit === 'month'
      ? Number(freeTariff.duration_value) * 30
      : Number(freeTariff.duration_value);

    return { trialActivated: true, trialName: freeTariff.name, trialDays: days };
  }

  private async getRegistrationTariff(): Promise<TariffConfig | null> {
    const all = await this.tariffConfigRepo.find({ where: { is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } });
    if (all.length === 0) return null;
    const setting = await this.settingsRepo.findOne({ where: { key: 'registration_tariff' } });
    if (setting?.value) {
      const byKey = all.find(t => t.plan_key === setting.value);
      if (byKey) return byKey;
    }
    return all.find(t => Number(t.price) === 0) || null;
  }
}
