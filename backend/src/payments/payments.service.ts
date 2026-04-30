import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as crypto from 'crypto';
import { User, UserPlan } from '../users/user.entity';
import { TariffConfig } from '../admin/tariff-config.entity';
import { TariffOperation } from '../admin/tariff-operation.entity';

export interface CreatePaymentDto {
  userId: number;
  planType: 'monthly' | 'annual';
  returnUrl: string;
}

export interface YukassaPayment {
  id: string;
  status: string;
  amount: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url: string };
  metadata?: Record<string, string>;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(TariffConfig) private tariffConfigRepo: Repository<TariffConfig>,
    @InjectRepository(TariffOperation) private tariffOpsRepo: Repository<TariffOperation>,
  ) {}

  private get shopId(): string {
    return this.configService.get('YUKASSA_SHOP_ID') || process.env.YUKASSA_SHOP_ID || '';
  }
  private get secretKey(): string {
    return this.configService.get('YUKASSA_SECRET_KEY') || process.env.YUKASSA_SECRET_KEY || '';
  }

  private yukassaRequest(method: string, path: string, body?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
      const idempotenceKey = crypto.randomUUID();
      const bodyStr = body ? JSON.stringify(body) : '';

      const options: https.RequestOptions = {
        hostname: 'api.yookassa.ru',
        port: 443,
        path: `/v3${path}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          'Idempotence-Key': idempotenceKey,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON from YuKassa')); }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async createPayment(dto: CreatePaymentDto): Promise<{ paymentId: string; confirmationUrl: string }> {
    const isAnnual = dto.planType === 'annual';

    const proConfig = await this.tariffConfigRepo.findOne({ where: { plan_key: 'pro', is_active: true } });
    const monthlyPrice = proConfig ? Number(proConfig.price) : 7990;
    const annualPrice  = proConfig?.price_annual ? Number(proConfig.price_annual) : 79900;

    const amount = isAnnual ? annualPrice : monthlyPrice;
    const description = isAnnual
      ? `INDEXALL — Pro тариф (12 месяцев)`
      : `INDEXALL — Pro тариф (1 месяц)`;

    // Pull the user's email so YooKassa knows where to send the fiscal receipt.
    // Required by 54-ФЗ once «Чеки от ЮKassa» is enabled in the cabinet.
    const user = await this.usersRepo.findOne({ where: { id: dto.userId } });
    if (!user?.email) {
      throw new Error('Cannot create payment: user has no email on file');
    }

    // VAT code per ЮKassa /receipts spec — must match the merchant's tax
    // regime configured in ЛК. Default 1 (без НДС, типично для ИП/самозанятых
    // на УСН). Override via env:
    //   1 — без НДС
    //   2 — НДС 0%
    //   3 — НДС 10%
    //   4 — НДС 20%
    //   5 — НДС расч. 10/110
    //   6 — НДС расч. 20/120
    const vatCode = Number(process.env.YOOKASSA_VAT_CODE) || 1;

    // Optional tax_system_code — required only if the merchant's account has
    // multiple tax systems registered. Set via env when ЮKassa demands it:
    //   1 — ОСН        2 — УСН доходы       3 — УСН доходы-расходы
    //   4 — ЕСН        5 — ПСН              6 — Самозанятый
    const taxSystemCode = Number(process.env.YOOKASSA_TAX_SYSTEM_CODE) || null;

    const receipt: any = {
      customer: { email: user.email },
      items: [
        {
          description,
          quantity: '1.00',
          amount: { value: amount.toFixed(2), currency: 'RUB' },
          vat_code: vatCode,
          payment_subject: 'service',
          payment_mode: 'full_payment',
        },
      ],
    };
    if (taxSystemCode) receipt.tax_system_code = taxSystemCode;

    const requestBody = {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: dto.returnUrl },
      description,
      metadata: {
        userId: String(dto.userId),
        planType: dto.planType,
      },
      receipt,
    };

    const response = await this.yukassaRequest('POST', '/payments', requestBody);

    // Log full response for debugging
    this.logger.log(`YooKassa response: ${JSON.stringify(response)}`);

    // YooKassa returns { type: 'error', code, description, parameter? } on failure.
    // `parameter` is the dotted-path of the bad field — invaluable for diagnosing
    // receipt validation issues.
    if (response?.type === 'error') {
      const msg = response.description || response.code || 'YooKassa error';
      const param = response.parameter ? ` (param: ${response.parameter})` : '';
      this.logger.error(
        `YooKassa error: ${msg}${param} | full=${JSON.stringify(response)} | request=${JSON.stringify(requestBody)}`,
      );
      throw new Error(`${msg}${param}`);
    }

    const payment = response as YukassaPayment;
    const confirmationUrl = payment.confirmation?.confirmation_url || '';

    if (!confirmationUrl) {
      this.logger.error(`YooKassa: no confirmation_url in response: ${JSON.stringify(response)}`);
      throw new Error('YooKassa не вернул ссылку для оплаты');
    }

    return { paymentId: payment.id, confirmationUrl };
  }

  async getPayment(paymentId: string): Promise<YukassaPayment> {
    return this.yukassaRequest('GET', `/payments/${paymentId}`);
  }

  /**
   * Apply a successful payment to the user's subscription. Idempotent:
   * the tariff_operations row carries the YooKassa payment.id with a
   * UNIQUE constraint, so retries / webhook+polling races can't extend
   * the subscription twice. Extension stacks on top of any remaining time
   * («продлить на год» when 6 месяцев осталось → +1 год от прежнего конца).
   */
  private async activateForPayment(payment: YukassaPayment, source: 'webhook' | 'polling'): Promise<boolean> {
    const userId = Number(payment.metadata?.userId);
    const planType = (payment.metadata?.planType as 'monthly' | 'annual') || 'monthly';
    if (!userId) {
      this.logger.warn(`activateForPayment: payment ${payment.id} has no userId in metadata`);
      return false;
    }

    // Idempotency check — if we already recorded this payment, do nothing.
    const existing = await this.tariffOpsRepo.findOne({ where: { payment_id: payment.id } });
    if (existing) {
      this.logger.log(`Payment ${payment.id} already processed (op id=${existing.id}); ${source} skipped`);
      return true;
    }

    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`activateForPayment: user ${userId} not found for payment ${payment.id}`);
      return false;
    }

    // Stack new period on top of existing remaining time (if any) so
    // «продлить на год» when 6 месяцев осталось = +1 год от прежнего конца.
    // If the subscription already expired (or never existed), start from now.
    const now = new Date();
    const currentExpires = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
    const baseDate = currentExpires && currentExpires > now ? new Date(currentExpires) : new Date(now);
    const expiresAt = new Date(baseDate);
    if (planType === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    await this.usersRepo.update(userId, {
      plan: UserPlan.PRO,
      subscriptionExpiresAt: expiresAt,
    });

    // Record the operation atomically — UNIQUE on payment_id ensures
    // concurrent webhook + polling races still produce only one row.
    try {
      await this.tariffOpsRepo.save({
        userId,
        operator: 'YooKassa',
        plan: 'Pro',
        amount: Number(payment.amount?.value || 0),
        status: 'active',
        expiresAt,
        comment: `Оплата ${planType === 'annual' ? 'на год' : 'на месяц'} (через ${source})`,
        payment_id: payment.id,
      });
    } catch (e: any) {
      // Most likely a duplicate-key violation due to a concurrent activation —
      // safe to ignore, the other writer has the same effect on the user row.
      this.logger.log(`activateForPayment: tariff_operation insert raced (${e?.code || e?.message}); user already updated`);
    }

    this.logger.log(
      `Subscription activated via ${source} for user ${userId}, plan: ${planType}, ` +
      `from ${currentExpires?.toISOString() || 'now'} → ${expiresAt.toISOString()}`,
    );
    return true;
  }

  async handleWebhook(event: any): Promise<void> {
    if (event?.event !== 'payment.succeeded') return;
    const payment: YukassaPayment = event.object;
    if (!payment?.metadata?.userId) return;
    await this.activateForPayment(payment, 'webhook');
  }

  /** Poll YooKassa and activate if succeeded (fallback when webhook is delayed) */
  async confirmPayment(paymentId: string, userId: number): Promise<{ activated: boolean; plan: string }> {
    const payment = await this.getPayment(paymentId);
    if (payment.status !== 'succeeded') {
      return { activated: false, plan: 'pending' };
    }
    // Owner check — without it any user who learned a paymentId (URL share,
    // log leak, screenshot) could activate their own subscription using
    // somebody else's successful payment.
    const paymentUserId = Number(payment.metadata?.userId);
    if (!paymentUserId || paymentUserId !== userId) {
      this.logger.warn(
        `confirmPayment denied: payment ${paymentId} belongs to user ${paymentUserId || '?'} but ` +
        `request came from user ${userId}`,
      );
      throw new ForbiddenException('Этот платёж принадлежит другому пользователю');
    }

    const ok = await this.activateForPayment(payment, 'polling');
    if (!ok) return { activated: false, plan: 'unknown' };
    return { activated: true, plan: 'pro' };
  }

  /** Endpoint for Telegram bot to create a payment link for a user by email */
  async createBotPayment(email: string, planType: 'monthly' | 'annual', returnUrl: string) {
    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user) throw new Error(`User not found: ${email}`);
    return this.createPayment({ userId: user.id, planType, returnUrl });
  }
}
