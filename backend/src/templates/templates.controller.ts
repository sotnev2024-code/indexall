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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Template } from './template.entity';

@ApiTags('templates')
@Controller('templates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Создать новый шаблон' })
  create(@Body() createDto: Partial<Template>) {
    return this.templatesService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получить все шаблоны (scope=common — только общие без владельца)' })
  findAll(@Query('scope') scope?: string) {
    return this.templatesService.findAll(scope);
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
