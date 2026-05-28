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
import { SheetsService } from './sheets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../auth/guards/pro.guard';
import { ActivityLogService } from '../admin/activity-log.service';

@ApiTags('sheets')
@Controller('sheets')
@UseGuards(JwtAuthGuard, ProGuard)
@ApiBearerAuth()
export class SheetsController {
  constructor(
    private readonly service: SheetsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Post('project/:projectId')
  @ApiOperation({ summary: 'Создать лист в проекте' })
  async create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body('name') name: string,
    @Request() req,
  ) {
    const result = await this.service.createSheet(projectId, req.user.userId, name);
    this.activityLog.log(req.user.userId, 'create_sheet', `name: ${name}, project id: ${projectId}`);
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить лист с строками' })
  getOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.getSheetWithRowsOwned(id, req.user.userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Обновить лист' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Request() req,
  ) {
    return this.service.updateSheet(id, req.user.userId, body);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Дублировать лист' })
  duplicate(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.duplicateSheet(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить лист' })
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    const result = await this.service.removeSheet(id, req.user.userId);
    this.activityLog.log(req.user.userId, 'delete_sheet', `sheet id: ${id}`);
    return result;
  }

  @Put(':id/rows')
  @ApiOperation({ summary: 'Сохранить строки листа' })
  saveRows(
    @Param('id', ParseIntPipe) id: number,
    @Body('rows') rows: any[],
    @Request() req,
  ) {
    return this.service.saveRows(id, req.user.userId, rows);
  }
}
