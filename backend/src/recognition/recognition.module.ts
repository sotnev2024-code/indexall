import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecognitionDocument } from './recognition-document.entity';
import { RecognitionPage } from './recognition-page.entity';
import { RecognitionElement } from './recognition-element.entity';
import { RecognitionService } from './recognition.service';
import { RecognitionController } from './recognition.controller';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Folder } from '../folders/folder.entity';
import { AppSetting } from '../admin/app-setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecognitionDocument,
      RecognitionPage,
      RecognitionElement,
      Sheet,
      EquipmentRow,
      Folder,
      AppSetting,
    ]),
  ],
  controllers: [RecognitionController],
  providers: [RecognitionService],
})
export class RecognitionModule {}
