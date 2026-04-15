import { Controller, Get, Post, Delete, Query, Body, Req, Request, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { StoresService } from './stores.service';
import { EtmService } from './etm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../auth/guards/pro.guard';

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
  @UseGuards(ProGuard)
  async getEtmPrices(
    @Body('articles') articles: string[],
    @Body('items') items: { article?: string; etmCode?: string }[],
    @Req() req: any,
  ) {
    const userId = req.user?.userId;
    // Prefer items[] (with etmCode support); fall back to plain articles[] for backwards compat.
    if (Array.isArray(items) && items.length > 0) {
      return this.etmService.getPricesForItems(items, userId);
    }
    if (!Array.isArray(articles) || articles.length === 0) {
      throw new HttpException('articles or items must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    return this.etmService.getPricesForUser(articles, userId);
  }

  /**
   * Returns price + delivery term for each article.
   * Uses 7-day cache, batches prices (50 per request), respects ETM rate limit.
   * Response: { [article]: { price: number | null, term: string } }
   */
  @Post('etm/prices-with-terms')
  @UseGuards(ProGuard)
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

  /**
   * Returns delivery term for a single article. Used by progressive UI:
   * client sends one request per article and updates the row as each answer arrives.
   * Response: { term: string | null }
   */
  @Post('etm/term')
  @UseGuards(ProGuard)
  async getEtmTerm(
    @Body('article') article: string,
    @Body('etmCode') etmCode: string,
    @Req() req: any,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('Auth required', HttpStatus.UNAUTHORIZED);
    if ((!article || typeof article !== 'string') && (!etmCode || typeof etmCode !== 'string')) {
      throw new HttpException('article or etmCode required', HttpStatus.BAD_REQUEST);
    }
    const term = await this.etmService.getTermForItem({ article, etmCode }, userId);
    return { term };
  }

  // ── ETM per-user credentials ──────────────────────────────────
  @Get('etm/credentials')
  async getEtmCredentials(@Req() req: any) {
    return this.etmService.getCredentials(req.user.userId);
  }

  @Post('etm/credentials')
  @UseGuards(ProGuard)
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
