import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EquipmentRow } from './equipment-row.entity';
import { EquipmentService } from './equipment.service';
import { EquipmentController } from './equipment.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EquipmentRow])],
  providers: [EquipmentService],
  controllers: [EquipmentController],
  exports: [EquipmentService],
})
export class EquipmentModule {}
