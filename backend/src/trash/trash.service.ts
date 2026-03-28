import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { TrashItem } from './trash-item.entity';

const EXPIRY_DAYS = 20;

@Injectable()
export class TrashService implements OnModuleInit {
  constructor(
    @InjectRepository(TrashItem) private trashRepo: Repository<TrashItem>,
  ) {}

  async addToTrash(data: { entity_type: string; entity_id: number; user_id: number; name: string; snapshot?: any }) {
    return this.trashRepo.save(data);
  }

  async getTrash(userId: number) {
    return this.trashRepo.find({ where: { user_id: userId }, order: { deleted_at: 'DESC' } });
  }

  async restore(id: number, userId: number) {
    const item = await this.trashRepo.findOne({ where: { id, user_id: userId } });
    if (!item) throw new NotFoundException('Элемент не найден');
    await this.trashRepo.delete(id);
    return { item, restored: true };
  }

  async permanentDelete(id: number, userId: number) {
    const item = await this.trashRepo.findOne({ where: { id, user_id: userId } });
    if (!item) throw new NotFoundException('Элемент не найден');
    await this.trashRepo.delete(id);
    return { success: true };
  }

  async onModuleInit() {
    await this.purgeExpired();
    setInterval(() => this.purgeExpired(), 24 * 60 * 60 * 1000);
  }

  async purgeExpired() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - EXPIRY_DAYS);
    const result = await this.trashRepo.delete({ deleted_at: LessThan(cutoff) });
    if ((result.affected ?? 0) > 0) {
      console.log(`🗑 Purged ${result.affected} expired trash items`);
    }
  }
}
