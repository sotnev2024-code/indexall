import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FoldersService } from './folders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../auth/guards/pro.guard';

@ApiTags('folders')
@Controller('folders')
@UseGuards(JwtAuthGuard, ProGuard)
@ApiBearerAuth()
export class FoldersController {
  constructor(private readonly service: FoldersService) {}

  /** GET /folders?type=projects — full tree for current user */
  @Get()
  @ApiOperation({ summary: 'Получить дерево папок' })
  getTree(@Query('type') type = 'projects', @Request() req) {
    return this.service.getTree(req.user.userId, type);
  }

  /** GET /folders/:id — folder with sheets (for spec page tabs) */
  @Get(':id')
  @ApiOperation({ summary: 'Получить папку с листами' })
  getOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.getFolderWithSheets(id, req.user.userId);
  }

  /** POST /folders */
  @Post()
  @ApiOperation({ summary: 'Создать папку' })
  create(
    @Body('name') name: string,
    @Body('parent_id') parent_id: number | null,
    @Body('type') type = 'projects',
    @Request() req,
  ) {
    return this.service.createFolder(req.user.userId, name, parent_id ?? null, type);
  }

  /** PUT /folders/:id — rename */
  @Put(':id')
  @ApiOperation({ summary: 'Переименовать папку' })
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @Request() req,
  ) {
    return this.service.renameFolder(id, req.user.userId, name);
  }

  /** PUT /folders/:id/move — move to new parent */
  @Put(':id/move')
  @ApiOperation({ summary: 'Переместить папку' })
  move(
    @Param('id', ParseIntPipe) id: number,
    @Body('parent_id') parent_id: number | null,
    @Request() req,
  ) {
    return this.service.moveFolder(id, req.user.userId, parent_id ?? null);
  }

  /** DELETE /folders/:id */
  @Delete(':id')
  @ApiOperation({ summary: 'Удалить папку' })
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.deleteFolder(id, req.user.userId);
  }

  /** POST /folders/:id/sheets — create sheet inside folder */
  @Post(':id/sheets')
  @ApiOperation({ summary: 'Создать лист в папке' })
  createSheet(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @Request() req,
  ) {
    return this.service.createSheet(id, req.user.userId, name);
  }

  /** PUT /folders/:id/sheets/reorder */
  @Put(':id/sheets/reorder')
  @ApiOperation({ summary: 'Изменить порядок листов в папке' })
  reorderSheets(
    @Param('id', ParseIntPipe) id: number,
    @Body('ids') ids: number[],
    @Request() req,
  ) {
    return this.service.reorderSheets(id, req.user.userId, ids);
  }

  /** PUT /folders/sheets/:id/move — move sheet to folder */
  @Put('sheets/:id/move')
  @ApiOperation({ summary: 'Переместить лист в другую папку' })
  moveSheet(
    @Param('id', ParseIntPipe) id: number,
    @Body('folder_id') folder_id: number,
    @Request() req,
  ) {
    return this.service.moveSheet(id, req.user.userId, folder_id);
  }

  /** PUT /folders/templates/:id/move — move template to folder */
  @Put('templates/:id/move')
  @ApiOperation({ summary: 'Переместить шаблон в папку' })
  moveTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body('folder_id') folder_id: number | null,
    @Request() req,
  ) {
    return this.service.moveTemplate(id, req.user.userId, folder_id ?? null);
  }

  /** PUT /folders/reorder */
  @Put('reorder/batch')
  @ApiOperation({ summary: 'Изменить порядок папок' })
  reorder(@Body('ids') ids: number[], @Request() req) {
    return this.service.reorderFolders(req.user.userId, ids);
  }

  // ── Save as template ────────────────────────────────────────

  /** POST /folders/:id/save-as-template — save project folder as template folder */
  @Post(':id/save-as-template')
  @UseGuards(ProGuard)
  @ApiOperation({ summary: 'Сохранить папку как шаблон (PRO only)' })
  saveFolderAsTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @Body('template_folder_id') templateFolderId: number | null,
    @Request() req,
  ) {
    return this.service.saveFolderAsTemplate(id, req.user.userId, name, templateFolderId ?? null);
  }

  /** POST /folders/sheets/:id/save-as-template — save sheet as template */
  @Post('sheets/:id/save-as-template')
  @UseGuards(ProGuard)
  @ApiOperation({ summary: 'Сохранить лист как шаблон (PRO only)' })
  saveSheetAsTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @Body('template_folder_id') templateFolderId: number | null,
    @Request() req,
  ) {
    return this.service.saveSheetAsTemplate(id, req.user.userId, name, templateFolderId ?? null);
  }

  // ── Load template ────────────────────────────────────────────

  /** POST /folders/load-template-folder — load template folder into projects */
  @Post('load-template-folder')
  @UseGuards(ProGuard)
  @ApiOperation({ summary: 'Загрузить шаблонную папку в проект (PRO only)' })
  loadTemplateFolder(
    @Body('template_folder_id') templateFolderId: number,
    @Body('mode') mode: 'new' | 'into',
    @Body('target_folder_id') targetFolderId: number | null,
    @Request() req,
  ) {
    return this.service.loadTemplateFolderIntoProject(
      templateFolderId, req.user.userId, mode, targetFolderId ?? null,
    );
  }

  /** POST /folders/load-template-sheet — load single template as sheet */
  @Post('load-template-sheet')
  @UseGuards(ProGuard)
  @ApiOperation({ summary: 'Загрузить шаблон-лист в проект (PRO only)' })
  loadTemplateSheet(
    @Body('template_id') templateId: number,
    @Body('mode') mode: 'new' | 'into',
    @Body('target_folder_id') targetFolderId: number | null,
    @Request() req,
  ) {
    return this.service.loadTemplateAsSheet(
      templateId, req.user.userId, mode, targetFolderId ?? null,
    );
  }
}
