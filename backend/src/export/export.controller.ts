import { Controller, Post, Body, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('xlsx')
  async exportXlsx(@Body() body: { projectId: number; sheetId?: number }, @Req() req: any, @Res() res: Response) {
    const project = await this.projectsService.findOne(body.projectId, req.user.userId);

    let sheets = project.sheets;
    if (body.sheetId) {
      sheets = sheets.filter((s: any) => s.id === body.sheetId);
    }

    const buffer = this.exportService.exportToXlsx({ projectName: project.name, sheets });
    const filename = encodeURIComponent(`${project.name}${body.sheetId ? '_лист' : ''}.xlsx`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buffer);
  }
}
