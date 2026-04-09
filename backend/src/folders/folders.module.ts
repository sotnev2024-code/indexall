import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Folder } from './folder.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import { Project } from '../projects/project.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { FoldersService } from './folders.service';
import { FoldersController } from './folders.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folder, Sheet, Template, Project, EquipmentRow]),
  ],
  providers: [FoldersService],
  controllers: [FoldersController],
  exports: [FoldersService],
})
export class FoldersModule {}
