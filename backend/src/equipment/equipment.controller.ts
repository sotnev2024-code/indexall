import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EquipmentService } from './equipment.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EquipmentRow } from './equipment-row.entity';

@ApiTags('equipment')
@Controller('equipment')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  @ApiOperation({ summary: 'Создать новую позицию оборудования' })
  create(@Body() createDto: Partial<EquipmentRow>) {
    return this.equipmentService.create(createDto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Массовое создание позиций' })
  bulkCreate(@Body() rows: Partial<EquipmentRow>[]) {
    return this.equipmentService.bulkCreate(rows);
  }

  @Get()
  @ApiOperation({ summary: 'Получить все позиции листа' })
  findAll(@Param('sheetId') sheetId?: string) {
    return this.equipmentService.findAll(
      sheetId ? parseInt(sheetId, 10) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить позицию по ID' })
  findOne(@Param('id') id: string) {
    return this.equipmentService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить позицию' })
  update(@Param('id') id: string, @Body() updateDto: Partial<EquipmentRow>) {
    return this.equipmentService.update(+id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить позицию' })
  remove(@Param('id') id: string) {
    return this.equipmentService.remove(+id);
  }
}
