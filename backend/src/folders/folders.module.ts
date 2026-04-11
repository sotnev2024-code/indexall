import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Folder } from './folder.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import { Project } from '../projects/project.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { User } from '../users/user.entity';
import { FoldersService } from './folders.service';
import { FoldersController } from './folders.controller';
import { ProGuard } from '../auth/guards/pro.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folder, Sheet, Template, Project, EquipmentRow, User]),
  ],
  providers: [FoldersService, ProGuard],
  controllers: [FoldersController],
  exports: [FoldersService],
})
export class FoldersModule {}
