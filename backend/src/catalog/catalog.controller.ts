import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Res,
  UseGuards, Req, ParseIntPipe, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { CatalogService } from './catalog.service';
import { BotDbService } from './bot-db.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

const uploadStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (_, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
});

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly service: CatalogService,
    private readonly botDb: BotDbService,
  ) {}

  /** Admin: force refresh the in-memory bot DB cache */
  @Post('bot-cache/refresh')
  @UseGuards(JwtAuthGuard, AdminGuard)
  refreshBotCache() {
    this.botDb.refresh();
    return { success: true, message: 'Bot DB cache refresh triggered' };
  }

  /**
   * GET /catalog/filter-options?slug=auto
   * Returns dynamic filter options derived from DISTINCT values in bot_database.db.
   * Options update automatically whenever the bot cache refreshes (hourly).
   */
  @Get('filter-options')
  getFilterOptions(@Query('slug') slug: string) {
    if (!slug) return [];
    return this.botDb.getFilterOptions(slug);
  }

  // ── Tiles (public) ────────────────────────────────────────
  @Get('tiles')
  getTiles() { return this.service.getTiles(); }

  @Get('tiles/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAllTiles() { return this.service.getAllTiles(); }

  @Post('tiles')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createTile(@Body() body: any) { return this.service.createTile(body); }

  @Put('tiles/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateTile(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.updateTile(id, body);
  }

  @Delete('tiles/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  deleteTile(@Param('id', ParseIntPipe) id: number) { return this.service.deleteTile(id); }

  @Post('tiles/:id/image')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  uploadTileImage(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadTileImage(id, file);
  }

  // ── Public / user endpoints ────────────────────────────────
  @Get('manufacturers')
  getManufacturers() { return this.service.getManufacturers(); }

  @Get('tree')
  getTree(@Query('manufacturerId') mId?: string) {
    return this.service.getTree(mId ? Number(mId) : undefined);
  }

  @Get('products')
  getProducts(@Query('categoryId') catId: string, @Query('attrs') attrsStr?: string) {
    let attrs: Record<string, string> | undefined;
    if (attrsStr) {
      try { attrs = JSON.parse(attrsStr); } catch {}
    }
    return this.service.getProducts(Number(catId), attrs);
  }

  @Get('products/filter')
  filterProducts(
    @Query('slug') slug: string,
    @Query('brands') brandsRaw?: string,
    @Query('filters') filtersRaw?: string,
  ) {
    const brands = brandsRaw ? brandsRaw.split(',').map(b => b.trim()).filter(Boolean) : undefined;
    let extraFilters: Record<string, string[]> | undefined;
    if (filtersRaw) {
      try { extraFilters = JSON.parse(filtersRaw); } catch {}
    }
    return this.service.getProductsByCategorySlug(slug, brands, extraFilters);
  }

  @Get('products/:id/analogs')
  @UseGuards(JwtAuthGuard)
  getAnalogs(@Param('id', ParseIntPipe) id: number) {
    return this.service.getAnalogs(id);
  }

  @Get('products/:id/accessories')
  @UseGuards(JwtAuthGuard)
  getAccessories(@Param('id', ParseIntPipe) id: number) {
    return this.service.getAccessories(id);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.service.searchProducts(q);
  }

  @Get('pricelists')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getPriceLists() { return this.service.getPriceLists(); }

  @Get('pricelists/:id/download')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async downloadPriceList(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { filePath, fileName } = await this.service.getPriceListFile(id);
    return res.download(filePath, fileName);
  }

  // ── Admin endpoints ───────────────────────────────────────
  @Post('manufacturers')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createManufacturer(@Body('name') name: string) {
    return this.service.createManufacturer(name);
  }

  @Put('manufacturers/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateManufacturer(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.updateManufacturer(id, body);
  }

  @Post('pricelists/upload')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  uploadPriceList(@UploadedFile() file: Express.Multer.File, @Body() body: any, @Req() req: any) {
    const mapping = {
      firstRow: Number(body.firstRow) || 2,
      g1: body.g1, g2: body.g2, g3: body.g3,
      g4: body.g4, g5: body.g5, g6: body.g6,
      nameCol: body.nameCol,
      artCol: body.artCol,
      priceCol: body.priceCol || undefined,
    };
    return this.service.uploadPriceList(file, mapping, req.user.userId);
  }

  @Post('pricelists/:id/replace')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  replacePriceList(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Req() req: any,
  ) {
    const mapping = { firstRow: Number(body.firstRow) || 2, g1: body.g1, g2: body.g2, g3: body.g3, g4: body.g4, g5: body.g5, g6: body.g6, nameCol: body.nameCol, artCol: body.artCol, priceCol: body.priceCol || undefined };
    return this.service.replacePriceList(id, file, mapping, req.user.userId);
  }

  @Patch('pricelists/:id/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  setPriceListStatus(@Param('id', ParseIntPipe) id: number, @Body('active') active: boolean) {
    return this.service.setPriceListStatus(id, active);
  }

  @Delete('pricelists/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  deletePriceList(@Param('id', ParseIntPipe) id: number) {
    return this.service.deletePriceList(id);
  }

  @Post('prices-by-articles')
  @ApiOperation({ summary: 'Get catalog prices by article array' })
  async getPricesByArticles(@Body('articles') articles: string[]) {
    if (!Array.isArray(articles) || articles.length === 0) return {};
    return this.service.getPricesByArticles(articles);
  }
}
