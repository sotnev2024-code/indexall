import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('tariff_configs')
export class TariffConfig {
  @PrimaryGeneratedColumn()
  id: number;

  /** Matches UserPlan enum values: 'free' | 'trial' | 'base' | 'pro' */
  @Column({ unique: true })
  plan_key: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  is_active: boolean;

  @UpdateDateColumn()
  updated_at: Date;
}
