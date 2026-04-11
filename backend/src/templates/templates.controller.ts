import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../auth/guards/pro.guard';
import { Template } from './template.entity';

@ApiTags('templates')
@Controller('templates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @UseGuards(ProGuard)
  @ApiOperation({ summary: 'Создать новый шаблон (PRO only)' })
  create(@Request() req, @Body() createDto: Partial<Template>) {
    return this.templatesService.create({ ...createDto, userId: req.user.userId });
  }

  @Get()
  @ApiOperation({ summary: 'Получить все шаблоны (scope=common — только общие без владельца)' })
  findAll(@Request() req, @Query('scope') scope?: string) {
    return this.templatesService.findAll(scope, req.user?.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить шаблон по ID' })
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить шаблон' })
  update(@Param('id') id: string, @Body() updateDto: Partial<Template>) {
    return this.templatesService.update(+id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить шаблон' })
  remove(@Param('id') id: string) {
    return this.templatesService.remove(+id);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Переключить избранное' })
  toggleFavorite(@Param('id') id: string) {
    return this.templatesService.toggleFavorite(+id);
  }

  /** Admin only: get all templates from all users */
  @Get('admin/all')
  @ApiOperation({ summary: 'Все шаблоны всех пользователей (только для admin)' })
  getAllForAdmin() {
    return this.templatesService.findAllForAdmin();
  }

  /** Admin only: mark template as common */
  @Post(':id/make-common')
  @ApiOperation({ summary: 'Сделать шаблон общим (только для admin)' })
  makeCommon(@Param('id') id: string) {
    return this.templatesService.makeCommon(+id);
  }

  /** Admin only: remove from common */
  @Post(':id/unmake-common')
  @ApiOperation({ summary: 'Убрать из общих (только для admin)' })
  unmakeCommon(@Param('id') id: string, @Request() req) {
    return this.templatesService.unmakeCommon(+id, req.user.userId);
  }

  @Post(':id/files')
  @ApiOperation({ summary: 'Добавить файл к шаблону' })
  addFile(@Param('id') id: string) {
    return this.templatesService.addFile(+id);
  }

  @Delete(':id/files')
  @ApiOperation({ summary: 'Удалить файл из шаблона' })
  removeFile(@Param('id') id: string) {
    return this.templatesService.removeFile(+id);
  }
}
