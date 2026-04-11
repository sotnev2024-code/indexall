import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { User } from '../users/user.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { TrashModule } from '../trash/trash.module';
import { ProGuard } from '../auth/guards/pro.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Sheet, EquipmentRow, User]),
    TrashModule,
  ],
  providers: [ProjectsService, ProGuard],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
