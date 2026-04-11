import { Controller, Get, Post, Delete, Query, Body, Req, Request, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
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
    return {
      configured: this.etmService.isConfigured(),
      usingProxy: !!process.env.ETM_HTTPS_PROXY?.trim(),
    };
  }

  @Post('etm/prices')
  async getEtmPrices(@Body('articles') articles: string[], @Req() req: any) {
    if (!Array.isArray(articles) || articles.length === 0) {
      throw new HttpException('articles must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    // Use per-user credentials if configured, fall back to global
    const userId = req.user?.userId;
    return this.etmService.getPricesForUser(articles, userId);
  }

  /**
   * Returns price + delivery term for each article.
   * Uses 7-day cache, batches prices (50 per request), respects ETM rate limit.
   * Response: { [article]: { price: number | null, term: string } }
   */
  @Post('etm/prices-with-terms')
  async getEtmPricesWithTerms(
    @Body('articles') articles: string[],
    @Body('skipCache') skipCache: boolean,
    @Req() req: any,
  ) {
    if (!Array.isArray(articles) || articles.length === 0) {
      throw new HttpException('articles must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('Auth required', HttpStatus.UNAUTHORIZED);
    return this.etmService.getPricesAndTermsForUser(articles, userId, { skipCache: !!skipCache });
  }

  // ── ETM per-user credentials ──────────────────────────────────
  @Get('etm/credentials')
  async getEtmCredentials(@Req() req: any) {
    return this.etmService.getCredentials(req.user.userId);
  }

  @Post('etm/credentials')
  async saveEtmCredentials(
    @Req() req: any,
    @Body('login') login: string,
    @Body('password') password: string,
  ) {
    await this.etmService.saveCredentials(req.user.userId, login, password);
    // Test auth immediately
    const credentials = await this.etmService.getCredentials(req.user.userId);
    return { ok: true, ...credentials };
  }

  @Delete('etm/credentials')
  async removeEtmCredentials(@Req() req: any) {
    await this.etmService.removeCredentials(req.user.userId);
    return { ok: true };
  }
}
