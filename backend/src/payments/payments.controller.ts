import {
  Controller, Post, Get, Body, Param, Request,
  UseGuards, Headers, HttpCode, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TariffConfig } from '../admin/tariff-config.entity';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @InjectRepository(TariffConfig) private tariffConfigRepo: Repository<TariffConfig>,
  ) {}

  /** Public endpoint — returns tariff plan configs for the pricing page */
  @Get('plans')
  getPlans() {
    return this.tariffConfigRepo.find({ where: { is_active: true }, order: { id: 'ASC' } });
  }

  /** Create a payment — called from the pricing page */
  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createPayment(
    @Request() req,
    @Body() body: { planType: 'monthly' | 'annual'; returnUrl?: string },
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

  /** YuKassa webhook — receives payment events */
  @Post('webhook')
  @HttpCode(200)
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
