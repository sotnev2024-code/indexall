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
import { Folder } from '../folders/folder.entity';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Template } from '../templates/template.entity';
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
    @InjectRepository(Folder) private foldersRepo: Repository<Folder>,
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(EquipmentRow) private rowsRepo: Repository<EquipmentRow>,
    @InjectRepository(Template) private templatesRepo: Repository<Template>,
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

  /** Register: create user, auto-verify, activate welcome tariff, create demo project, return JWT */
  async register(registerDto: RegisterDto): Promise<any> {
    this.logger.log(`register: start email=${registerDto.email}`);
    const existing = await this.usersService.findByEmail(registerDto.email).catch(() => null);
    if (existing) {
      throw new BadRequestException('Пользователь с таким email уже существует');
    }

    const user = await this.usersService.create(registerDto);
    this.logger.log(`register: user created id=${user.id}`);

    // Auto-verify email (no confirmation step)
    await this.usersRepo.update(user.id, { emailVerified: true });

    // Auto-activate the welcome tariff (same logic as confirmEmail)
    const freeTariff = await this.getRegistrationTariff();
    let activatedTariffName = '';
    let activatedTariffDays = 0;
    if (freeTariff && !user.trialUsed && user.plan !== UserPlan.ADMIN) {
      const now = new Date();
      const expiresAt = new Date(now);
      if (freeTariff.duration_unit === 'month') {
        expiresAt.setMonth(expiresAt.getMonth() + Number(freeTariff.duration_value));
        activatedTariffDays = Number(freeTariff.duration_value) * 30;
      } else {
        expiresAt.setDate(expiresAt.getDate() + Number(freeTariff.duration_value));
        activatedTariffDays = Number(freeTariff.duration_value);
      }
      activatedTariffName = freeTariff.name;
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
    }

    const updated = await this.usersRepo.findOne({ where: { id: user.id } });
    const { password: _, ...safe } = updated;
    const jwt = await this.login(safe);

    // Create demo project from default template
    this.logger.log(`register: about to call createDemoProject for user ${user.id}`);
    const demoSheetId = await this.createDemoProject(user.id);
    this.logger.log(`register: createDemoProject returned demoSheetId=${demoSheetId}`);

    return { ...jwt, demoSheetId, activatedTariffName, activatedTariffDays };
  }

  /** Creates "Проект для ознакомления" folder + sheet filled from the default template */
  async createDemoProject(userId: number): Promise<number | null> {
    this.logger.log(`createDemoProject: starting for user ${userId}`);
    try {
      this.logger.log(`createDemoProject: looking for default template`);
      const template = await this.templatesRepo.findOne({ where: { is_default: true } as any });
      this.logger.log(`createDemoProject: template=${template ? template.id : 'none'}`);

      this.logger.log(`createDemoProject: saving folder`);
      const folder = await this.foldersRepo.save({
        name: 'Проект для ознакомления',
        owner_id: userId,
        type: 'projects',
        parent_id: null,
        sort_order: 0,
      });
      this.logger.log(`createDemoProject: folder saved id=${folder.id}`);

      this.logger.log(`createDemoProject: saving sheet`);
      const sheet = await this.sheetsRepo.save({
        name: 'Спецификация для ознакомления',
        folder_id: folder.id,
        owner_id: userId,
        sort_order: 0,
      });
      this.logger.log(`createDemoProject: sheet saved id=${sheet.id}`);

      let templateRows: any[] = [];
      if (template?.meta) {
        try { const p = JSON.parse(template.meta); if (Array.isArray(p)) templateRows = p; } catch {}
      }

      const rowsToSave = templateRows.length > 0
        ? templateRows.map((r: any, i: number) => ({
            sheetId: sheet.id,
            sort_order: i,
            name: r.name || '',
            brand: r.brand || '',
            article: r.article || '',
            qty: r.qty != null ? String(r.qty) : '1',
            unit: r.unit || 'шт',
            price: r.price != null ? String(r.price) : '0',
            store: r.store || '',
            coef: r.coef != null ? String(r.coef) : '1',
            total: r.total != null ? String(r.total) : '0',
          }))
        : Array.from({ length: 25 }, (_, i) => ({
            sheetId: sheet.id, sort_order: i,
            name: '', brand: '', article: '',
            qty: '0', unit: 'шт', price: '0', store: '', coef: '1', total: '0',
          }));

      this.logger.log(`createDemoProject: saving ${rowsToSave.length} rows`);
      await this.rowsRepo.save(rowsToSave);
      this.logger.log(`createDemoProject: done, sheetId=${sheet.id}`);
      return sheet.id;
    } catch (err) {
      this.logger.error(`createDemoProject FAILED for user ${userId}: ${err.message}`, err.stack);
      return null;
    }
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
