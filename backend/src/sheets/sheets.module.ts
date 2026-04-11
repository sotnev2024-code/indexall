import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sheet } from './sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Project } from '../projects/project.entity';
import { Folder } from '../folders/folder.entity';
import { User } from '../users/user.entity';
import { SheetsService } from './sheets.service';
import { SheetsController } from './sheets.controller';
import { TrashModule } from '../trash/trash.module';
import { ProGuard } from '../auth/guards/pro.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sheet, EquipmentRow, Project, Folder, User]),
    TrashModule,
  ],
  providers: [SheetsService, ProGuard],
  controllers: [SheetsController],
  exports: [SheetsService],
})
export class SheetsModule {}
