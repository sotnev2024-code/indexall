import { Controller, Post, Body, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { SheetsService } from '../sheets/sheets.service';
import { FoldersService } from '../folders/folders.service';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
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

    if (body.folderId) {
      // Folder-based export
      const folder = await this.foldersService.getFolderWithSheets(body.folderId, userId);
      projectName = folder.name || projectName;
      sheets = folder.sheets || [];
      if (body.sheetId) {
        sheets = sheets.filter((s: any) => s.id === body.sheetId);
      }
    } else if (body.sheetId && !body.projectId) {
      // Single sheet export (no project context)
      const sheet = await this.sheetsService.getSheetWithRowsOwned(body.sheetId, userId);
      projectName = sheet.name || projectName;
      sheets = [sheet];
    } else if (body.projectId) {
      // Legacy project-based export
      const project = await this.projectsService.findOne(body.projectId, userId);
      projectName = project.name || projectName;
      sheets = project.sheets || [];
      if (body.sheetId) {
        sheets = sheets.filter((s: any) => s.id === body.sheetId);
      }
    }

    const buffer = this.exportService.exportToXlsx({ projectName, sheets });
    const filename = encodeURIComponent(`${projectName}.xlsx`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buffer);
  }
}
