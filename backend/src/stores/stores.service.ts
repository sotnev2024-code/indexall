import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, StoreOffer } from './store.entity';

@Injectable()
export class StoresService implements OnModuleInit {
  constructor(
    @InjectRepository(Store) private storeRepo: Repository<Store>,
    @InjectRepository(StoreOffer) private offerRepo: Repository<StoreOffer>,
  ) {}

  async onModuleInit() {
    await this.seedStores();
  }

  private async seedStores() {
    const count = await this.storeRepo.count();
    if (count === 0) {
      await this.storeRepo.save([
        { name: 'ETM', code: 'ETM', is_active: true },
        { name: 'EKF', code: 'EKF', is_active: true },
      ]);
    }
  }

  getStores() {
    return this.storeRepo.find({ where: { is_active: true }, order: { name: 'ASC' } });
  }

  async getOffersByArticle(article: string) {
    if (!article) return [];
    const offers = await this.offerRepo
      .createQueryBuilder('o')
      .innerJoin('stores', 's', 's.id = o.store_id AND s.is_active = true')
      .addSelect('s.name', 'store_name')
      .where('LOWER(o.article) = LOWER(:article)', { article })
      .orderBy('o.price', 'ASC')
      .getRawMany();
    return offers.map(o => ({
      store_id: o.o_store_id,
      store_name: o.store_name,
      article: o.o_article,
      name: o.o_name,
      price: o.o_price ? Number(o.o_price) : null,
      availability: o.o_availability,
    }));
  }

  async upsertOffer(data: Partial<StoreOffer>) {
    const existing = await this.offerRepo.findOne({ where: { store_id: data.store_id, article: data.article } });
    if (existing) {
      await this.offerRepo.update(existing.id, data);
      return this.offerRepo.findOne({ where: { id: existing.id } });
    }
    return this.offerRepo.save(data);
  }
}
