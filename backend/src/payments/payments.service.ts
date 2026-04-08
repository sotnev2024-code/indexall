import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as crypto from 'crypto';
import { User, UserPlan } from '../users/user.entity';
import { TariffConfig } from '../admin/tariff-config.entity';

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

    const response = await this.yukassaRequest('POST', '/payments', {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: dto.returnUrl },
      description,
      metadata: {
        userId: String(dto.userId),
        planType: dto.planType,
      },
    });

    // Log full response for debugging
    this.logger.log(`YooKassa response: ${JSON.stringify(response)}`);

    // YooKassa returns { type: 'error', code, description } on failure
    if (response?.type === 'error') {
      const msg = response.description || response.code || 'YooKassa error';
      this.logger.error(`YooKassa error: ${msg}`);
      throw new Error(msg);
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

  async handleWebhook(event: any): Promise<void> {
    if (event?.event !== 'payment.succeeded') return;
    const payment: YukassaPayment = event.object;
    if (!payment?.metadata?.userId) return;

    const userId = Number(payment.metadata.userId);
    const planType = payment.metadata.planType as 'monthly' | 'annual';

    const expiresAt = new Date();
    if (planType === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    await this.usersRepo.update(userId, {
      plan: UserPlan.PRO,
      subscriptionExpiresAt: expiresAt,
    });

    this.logger.log(`Subscription activated for user ${userId}, plan: ${planType}, expires: ${expiresAt}`);
  }

  /** Poll YooKassa and activate if succeeded (fallback when webhook is delayed) */
  async confirmPayment(paymentId: string, userId: number): Promise<{ activated: boolean; plan: string }> {
    const payment = await this.getPayment(paymentId);
    if (payment.status !== 'succeeded') {
      return { activated: false, plan: 'pending' };
    }
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) return { activated: false, plan: 'unknown' };

    if (user.plan === UserPlan.PRO && user.subscriptionExpiresAt) {
      return { activated: true, plan: user.plan };
    }

    const planType = (payment.metadata?.planType as 'monthly' | 'annual') || 'monthly';
    const expiresAt = new Date();
    if (planType === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    await this.usersRepo.update(userId, {
      plan: UserPlan.PRO,
      subscriptionExpiresAt: expiresAt,
    });
    this.logger.log(`Subscription confirmed via polling for user ${userId}, plan: ${planType}`);
    return { activated: true, plan: 'pro' };
  }

  /** Endpoint for Telegram bot to create a payment link for a user by email */
  async createBotPayment(email: string, planType: 'monthly' | 'annual', returnUrl: string) {
    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user) throw new Error(`User not found: ${email}`);
    return this.createPayment({ userId: user.id, planType, returnUrl });
  }
}
