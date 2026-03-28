import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { TrashModule } from '../trash/trash.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Sheet, EquipmentRow]),
    TrashModule,
  ],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
