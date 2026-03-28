import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EquipmentRow } from './equipment-row.entity';

@Injectable()
export class EquipmentService {
  constructor(
    @InjectRepository(EquipmentRow)
    private equipmentRepository: Repository<EquipmentRow>,
  ) {}

  async create(data: Partial<EquipmentRow>): Promise<EquipmentRow> {
    const row = this.equipmentRepository.create(data);
    return this.equipmentRepository.save(row);
  }

  async findAll(sheetId?: number): Promise<EquipmentRow[]> {
    const query = this.equipmentRepository.createQueryBuilder('row');
    if (sheetId) {
      query.where('row.sheetId = :sheetId', { sheetId });
    }
    return query.getMany();
  }

  async findOne(id: number): Promise<EquipmentRow> {
    const row = await this.equipmentRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Equipment row with ID ${id} not found`);
    }
    return row;
  }

  async update(id: number, updateData: Partial<EquipmentRow>): Promise<EquipmentRow> {
    const row = await this.findOne(id);
    Object.assign(row, updateData);
    return this.equipmentRepository.save(row);
  }

  async remove(id: number): Promise<void> {
    const row = await this.findOne(id);
    await this.equipmentRepository.remove(row);
  }

  async bulkCreate(rows: Partial<EquipmentRow>[]): Promise<EquipmentRow[]> {
    return this.equipmentRepository.save(rows);
  }

  async bulkUpdate(
    updates: Array<{ id: number; data: Partial<EquipmentRow> }>,
  ): Promise<EquipmentRow[]> {
    const results: EquipmentRow[] = [];
    for (const update of updates) {
      const row = await this.update(update.id, update.data);
      results.push(row);
    }
    return results;
  }
}
