import { Controller, Post, Body, UseGuards, Req, Res, Logger, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { SheetsService } from '../sheets/sheets.service';
import { FoldersService } from '../folders/folders.service';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(
    private readonly exportService: ExportService,
    private readonly projectsService: ProjectsService,
    private readonly sheetsService: SheetsService,
    private readonly foldersService: FoldersService,
  ) {}

  @Post('xlsx')
  async exportXlsx(
    @Body() body: { projectId?: number; folderId?: number; sheetId?: number },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const userId = req.user.userId;
    let projectName = 'Спецификация';
    let sheets: any[] = [];

    try {
      if (body.folderId && !body.sheetId) {
        // Whole folder export — recursive, includes all subfolders
        const result = await this.foldersService.getSheetsForExport(body.folderId, userId);
        projectName = result.name;
        sheets = result.sheets;
      } else if (body.sheetId) {
        // Single sheet export
        const sheet = await this.sheetsService.getSheetWithRowsOwned(body.sheetId, userId);
        projectName = sheet.name || projectName;
        sheets = [sheet];
      } else if (body.projectId) {
        // Legacy project-based export
        const project = await this.projectsService.findOne(body.projectId, userId);
        projectName = project.name || projectName;
        sheets = project.sheets || [];
      }

      if (sheets.length === 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Нет листов для экспорта' });
      }

      const buffer = this.exportService.exportToXlsx({ projectName, sheets });
      const filename = encodeURIComponent(`${projectName}.xlsx`);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buffer);
    } catch (err: any) {
      this.logger.error(`Export failed: ${err?.message}`, err?.stack);
      if (!res.headersSent) {
        res.status(err?.status || HttpStatus.INTERNAL_SERVER_ERROR).json({
          message: err?.message || 'Ошибка экспорта',
        });
      }
    }
  }
}
