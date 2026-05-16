import {
  Controller, Post, Get, Body, Param, Request,
  UseGuards, Headers, HttpCode, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { TariffConfig } from '../admin/tariff-config.entity';
import { AppSetting } from '../admin/app-setting.entity';
import { YookassaWebhookGuard } from './yookassa-webhook.guard';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @InjectRepository(TariffConfig) private tariffConfigRepo: Repository<TariffConfig>,
    @InjectRepository(AppSetting) private settingsRepo: Repository<AppSetting>,
  ) {}

  /** Public endpoint — returns tariff plan configs for the pricing page */
  @Get('plans')
  getPlans() {
    return this.tariffConfigRepo.find({ where: { is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } });
  }

  /** Public flags read by the pricing/paywall UI to decide between the
   *  legacy text card and the new image-tile grid. Only the safe subset is
   *  exposed — never dump the whole settings table here. */
  @Get('settings')
  async getPublicSettings() {
    const tilesRow = await this.settingsRepo.findOne({ where: { key: 'pricing_tiles_enabled' } });
    return {
      pricingTilesEnabled: tilesRow?.value === 'true',
    };
  }

  /** Create a payment — called from the pricing page.
   *  `planType` accepts a tariff_configs.plan_key; also still maps the
   *  legacy 'monthly' / 'annual' values to 'pro' / 'pro_year'. */
  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createPayment(
    @Request() req,
    @Body() body: { planType: string; returnUrl?: string },
  ) {
    const returnUrl = body.returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing?success=1`;
    try {
      return await this.paymentsService.createPayment({
        userId: req.user.userId,
        planType: body.planType,
        returnUrl,
      });
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Ошибка создания платежа в YooKassa');
    }
  }

  /** Admin: 1₽ test payment to verify the full integration pipeline.
   *  Goes through createPayment normally → виджет ЮKassa → webhook → e-mail
   *  receipt. Marked with metadata.adminTest=1 so it does NOT extend the
   *  admin's subscription. */
  @Post('admin/test')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async adminTestPayment(@Request() req, @Body() body: { returnUrl?: string }) {
    const returnUrl = body?.returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin?tab=tariffs&payment_test=1`;
    try {
      return await this.paymentsService.createAdminTestPayment(req.user.userId, returnUrl);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Ошибка тестового платежа');
    }
  }

  /**
   * Returns activation counts per plan_key for the current user.
   * Frontend uses this to hide tiles the user has already maxed out.
   * { planKey: count, ... }
   */
  @Get('my-activations')
  @UseGuards(JwtAuthGuard)
  async myActivations(@Request() req) {
    const ops = await this.paymentsService.getUserActivationCounts(req.user.userId);
    return ops;
  }

  /**
   * Activate a free (price = 0) tariff without going through YooKassa.
   * Returns the updated user so the frontend can refresh the auth store.
   */
  @Post('activate-free')
  @UseGuards(JwtAuthGuard)
  async activateFree(
    @Request() req,
    @Body() body: { planKey: string },
  ) {
    if (!body?.planKey) throw new BadRequestException('planKey обязателен');
    try {
      const result = await this.paymentsService.activateFree(req.user.userId, body.planKey);
      return { activated: true, expiresAt: result.expiresAt };
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Ошибка активации тарифа');
    }
  }

  /** Check payment status */
  @Get('status/:id')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Param('id') id: string) {
    return this.paymentsService.getPayment(id);
  }

  /** Poll payment + activate if succeeded (fallback for delayed webhooks) */
  @Post('confirm/:id')
  @UseGuards(JwtAuthGuard)
  async confirmPayment(@Param('id') id: string, @Request() req) {
    return this.paymentsService.confirmPayment(id, req.user.userId);
  }

  /** YuKassa webhook — receives payment events.
   *  Guarded by the IP allow-list of YooKassa's outgoing notification servers
   *  (plus loopback for on-box `curl` tests). Without this guard, anyone on
   *  the internet could POST a fake `payment.succeeded` and grant themselves
   *  a free Pro subscription. */
  @Post('webhook')
  @HttpCode(200)
  @UseGuards(YookassaWebhookGuard)
  async webhook(@Body() body: any) {
    await this.paymentsService.handleWebhook(body);
    return { ok: true };
  }

  /** Bot integration — creates payment link by user email (secured by bot secret) */
  @Post('bot/create')
  async botCreate(
    @Headers('x-bot-secret') secret: string,
    @Body() body: { email: string; planType: 'monthly' | 'annual'; returnUrl?: string },
  ) {
    const expectedSecret = process.env.BOT_SECRET || '';
    if (!expectedSecret || secret !== expectedSecret) {
      return { error: 'Unauthorized' };
    }
    const returnUrl = body.returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing?success=1`;
    return this.paymentsService.createBotPayment(body.email, body.planType, returnUrl);
  }
}
