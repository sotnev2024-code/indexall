import { Controller, Get, Post, Query, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { StoresService } from './stores.service';
import { EtmService } from './etm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(
    private readonly service: StoresService,
    private readonly etmService: EtmService,
  ) {}

  @Get()
  getStores() { return this.service.getStores(); }

  @Get('offers')
  getOffers(@Query('article') article: string) {
    return this.service.getOffersByArticle(article);
  }

  // ── ETM price lookup ──────────────────────────────────────────
  @Get('etm/status')
  getEtmStatus() {
    return { configured: this.etmService.isConfigured() };
  }

  @Post('etm/prices')
  async getEtmPrices(@Body('articles') articles: string[]) {
    if (!this.etmService.isConfigured()) {
      throw new HttpException(
        'ETM не настроен. Укажите ETM_LOGIN и ETM_PASSWORD в .env на сервере.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!Array.isArray(articles) || articles.length === 0) {
      throw new HttpException('articles must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    return this.etmService.getPrices(articles);
  }
}
