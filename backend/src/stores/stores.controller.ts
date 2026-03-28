import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StoresService } from './stores.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private readonly service: StoresService) {}

  @Get()
  getStores() { return this.service.getStores(); }

  @Get('offers')
  getOffers(@Query('article') article: string) {
    return this.service.getOffersByArticle(article);
  }
}
