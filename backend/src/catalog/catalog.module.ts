import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { Manufacturer, PriceList, CatalogCategory, CatalogProduct, ProductAnalog, ProductAccessory, CatalogTile } from './entities/catalog.entities';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { BotDbService } from './bot-db.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Manufacturer, PriceList, CatalogCategory, CatalogProduct, ProductAnalog, ProductAccessory, CatalogTile]),
    MulterModule.register({ dest: process.env.UPLOAD_DIR || './uploads' }),
  ],
  providers: [CatalogService, BotDbService],
  controllers: [CatalogController],
  exports: [CatalogService, BotDbService],
})
export class CatalogModule {}
