import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { ProjectsModule } from '../projects/projects.module';
import { SheetsModule } from '../sheets/sheets.module';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [ProjectsModule, SheetsModule, FoldersModule],
  providers: [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
