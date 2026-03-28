import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ unique: true }) code: string;
  @Column({ default: true }) is_active: boolean;
  @CreateDateColumn() created_at: Date;
}

@Entity('store_offers')
export class StoreOffer {
  @PrimaryGeneratedColumn() id: number;
  @Column() store_id: number;
  @Column({ nullable: true }) product_id: number;
  @Column({ nullable: true }) article: string;
  @Column({ nullable: true }) name: string;
  @Column({ nullable: true }) unit: string;
  @Column({ nullable: true, type: 'decimal', precision: 12, scale: 2 }) price: number;
  @Column({ nullable: true }) availability: string;
  @UpdateDateColumn() updated_at: Date;
}
