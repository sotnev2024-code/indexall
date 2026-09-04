import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecognitionDocument } from './recognition-document.entity';
import { RecognitionPage } from './recognition-page.entity';
import { RecognitionElement } from './recognition-element.entity';
import { RecognitionModelVersion } from './recognition-model.entity';
import { RecognitionShadowRun } from './recognition-shadow.entity';
import { RecognitionService } from './recognition.service';
import { RecognitionController } from './recognition.controller';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Folder } from '../folders/folder.entity';
import { AppSetting } from '../admin/app-setting.entity';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecognitionDocument,
      RecognitionPage,
      RecognitionElement,
      RecognitionModelVersion,
      RecognitionShadowRun,
      Sheet,
      EquipmentRow,
      Folder,
      AppSetting,
    ]),
    // каталог нужен подстановке параметров: значения берём из базы,
    // чтобы не выдумывать варианты, которых в ней нет
    CatalogModule,
  ],
  controllers: [RecognitionController],
  providers: [RecognitionService],
  exports: [RecognitionService],
})
export class RecognitionModule {}
