import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { ProjectsModule } from '../projects/projects.module';
@Module({
  imports: [ProjectsModule],
  providers: [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
