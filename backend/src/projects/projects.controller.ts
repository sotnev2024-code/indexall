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

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

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
  create(@Body('name') name: string, @Request() req) {
    return this.service.create(req.user.userId, name);
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

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Дублировать проект' })
  duplicate(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.duplicate(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить проект' })
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.remove(id, req.user.userId);
  }
}
