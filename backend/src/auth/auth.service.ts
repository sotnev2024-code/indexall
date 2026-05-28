import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto, AuthPayload, JwtToken } from '../shared/types';
import { User, UserPlan } from '../users/user.entity';
import { EmailService } from './email.service';
import { TariffConfig } from '../admin/tariff-config.entity';
import { TariffOperation } from '../admin/tariff-operation.entity';
import { AppSetting } from '../admin/app-setting.entity';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(TariffConfig) private tariffConfigRepo: Repository<TariffConfig>,
    @InjectRepository(TariffOperation) private tariffOpsRepo: Repository<TariffOperation>,
    @InjectRepository(AppSetting) private settingsRepo: Repository<AppSetting>,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) return null;

    if (!user.emailVerified) {
      throw new UnauthorizedException({ unverified: true, email: user.email });
    }

    await this.usersService.updateLastSeen(user.id);
    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any): Promise<JwtToken> {
    const payload: AuthPayload = {
      userId: user.id,
      email: user.email,
      plan: user.plan,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: 30 * 24 * 60 * 60,
    };
  }

  /** Register: create user, send confirmation email, do NOT return JWT yet */
  async register(registerDto: RegisterDto): Promise<any> {
    const existing = await this.usersService.findByEmail(registerDto.email).catch(() => null);
    if (existing) {
      throw new BadRequestException('Пользователь с таким email уже существует');
    }

    const user = await this.usersService.create(registerDto);

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);

    await this.usersRepo.update(user.id, {
      emailVerificationToken: token,
      emailVerificationExpires: expires,
      emailVerified: false,
    });

    // Send confirmation email — required for account activation
    try {
      await this.emailService.sendConfirmation(registerDto.email, token);
    } catch (emailErr) {
      this.logger.error(`SMTP error during registration for ${registerDto.email}: ${emailErr.message}`);
    }

    // Do NOT verify immediately — user must click the email link
    return { message: 'Письмо с подтверждением отправлено на ' + registerDto.email };
  }

  /** Confirm email by token → auto-activate free welcome tariff → return JWT */
  async confirmEmail(token: string): Promise<JwtToken & { trialActivated?: boolean; trialName?: string; trialDays?: number }> {
    const user = await this.usersRepo.findOne({ where: { emailVerificationToken: token } });

    if (!user) {
      throw new BadRequestException('Недействительная ссылка подтверждения');
    }
    if (user.emailVerificationExpires && new Date() > user.emailVerificationExpires) {
      throw new BadRequestException('Ссылка подтверждения истекла. Запросите новое письмо');
    }

    await this.usersRepo.update(user.id, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });

    // Auto-activate the first active free (price=0) tariff for new users
    let trialActivated = false;
    let trialName = '';
    let trialDays = 0;

    if (!user.trialUsed && user.plan !== UserPlan.ADMIN) {
      const freeTariff = await this.getRegistrationTariff();

      if (freeTariff) {
        const now = new Date();
        const expiresAt = new Date(now);
        if (freeTariff.duration_unit === 'month') {
          expiresAt.setMonth(expiresAt.getMonth() + Number(freeTariff.duration_value));
        } else {
          expiresAt.setDate(expiresAt.getDate() + Number(freeTariff.duration_value));
        }

        await this.usersRepo.update(user.id, {
          plan: UserPlan.PRO,
          trialUsed: true,
          subscriptionExpiresAt: expiresAt,
        });

        try {
          await this.tariffOpsRepo.save({
            userId: user.id,
            operator: 'auto',
            plan: freeTariff.plan_key,
            amount: 0,
            status: 'active',
            expiresAt,
            comment: `Автоматическая активация при регистрации: ${freeTariff.name}`,
            payment_id: `auto_${randomUUID()}`,
          });
        } catch {}

        trialActivated = true;
        trialName = freeTariff.name;
        trialDays = freeTariff.duration_unit === 'month'
          ? Number(freeTariff.duration_value) * 30
          : Number(freeTariff.duration_value);

        this.logger.log(`Auto-activated free tariff '${freeTariff.name}' for new user ${user.id}`);
      }
    }

    const updated = await this.usersRepo.findOne({ where: { id: user.id } });
    const { password, ...safe } = updated;
    const jwt = await this.login(safe);
    return { ...jwt, trialActivated, trialName, trialDays };
  }

  /** Resend confirmation email */
  async resendConfirmation(email: string): Promise<{ message: string }> {
    const user = await this.usersRepo.findOne({ where: { email } });

    if (!user) {
      // Don't reveal whether email exists
      return { message: 'Если email зарегистрирован, письмо будет отправлено' };
    }
    if (user.emailVerified) {
      throw new BadRequestException('Email уже подтверждён');
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);

    await this.usersRepo.update(user.id, {
      emailVerificationToken: token,
      emailVerificationExpires: expires,
    });

    try {
      await this.emailService.sendConfirmation(email, token);
    } catch (emailErr) {
      this.logger.error(`SMTP error during resend for ${email}: ${emailErr.message}`);
      throw new BadRequestException('Не удалось отправить письмо. Проверьте конфигурацию SMTP');
    }

    return { message: 'Письмо с подтверждением отправлено повторно' };
  }

  /** Returns the tariff to auto-activate on registration.
   *  Admin can configure `registration_tariff` setting with a plan_key.
   *  Falls back to the first active tariff with price = 0. */
  async getRegistrationTariff(): Promise<TariffConfig | null> {
    const all = await this.tariffConfigRepo.find({ where: { is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } });
    if (all.length === 0) return null;

    const setting = await this.settingsRepo.findOne({ where: { key: 'registration_tariff' } });
    if (setting?.value) {
      const byKey = all.find(t => t.plan_key === setting.value);
      if (byKey) return byKey;
    }
    // Fallback: first free tariff
    return all.find(t => Number(t.price) === 0) || null;
  }
}
