import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { TariffOperation } from './tariff-operation.entity';
import { TariffConfig } from './tariff-config.entity';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import { PriceList, Manufacturer, CatalogProduct, CatalogTile, CatalogCategory } from '../catalog/entities/catalog.entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Project, Sheet, Template,
      PriceList, Manufacturer, CatalogProduct, CatalogTile, CatalogCategory,
      TariffOperation, TariffConfig,
    ]),
  ],
  controllers: [AdminController],
})
export class AdminModule {}
