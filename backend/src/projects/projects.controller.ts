import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../auth/guards/pro.guard';
import { ActivityLogService } from '../admin/activity-log.service';

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard, ProGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить все проекты пользователя' })
  getAll(@Request() req) {
    return this.service.findAll(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить проект по ID' })
  getOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.findOne(id, req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Создать новый проект' })
  async create(@Body('name') name: string, @Request() req) {
    const result = await this.service.create(req.user.userId, name);
    this.activityLog.log(req.user.userId, 'create_project', `name: ${name}`);
    return result;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Обновить проект' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Request() req,
  ) {
    return this.service.update(id, req.user.userId, body);
  }

  @Put('reorder')
  @ApiOperation({ summary: 'Сохранить порядок проектов' })
  reorderProjects(@Body('ids') ids: number[], @Request() req) {
    return this.service.reorderProjects(req.user.userId, ids);
  }

  @Put(':id/reorder-sheets')
  @ApiOperation({ summary: 'Сохранить порядок листов в проекте' })
  reorderSheets(
    @Param('id', ParseIntPipe) id: number,
    @Body('ids') ids: number[],
    @Request() req,
  ) {
    return this.service.reorderSheets(id, req.user.userId, ids);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Дублировать проект' })
  duplicate(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.duplicate(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить проект' })
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    const result = await this.service.remove(id, req.user.userId);
    this.activityLog.log(req.user.userId, 'delete_project', `id: ${id}`);
    return result;
  }
}
