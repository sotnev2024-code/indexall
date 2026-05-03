import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('tariff_configs')
export class TariffConfig {
  @PrimaryGeneratedColumn()
  id: number;

  /** Stable internal identifier, also used as `metadata.planKey` in YooKassa
   *  payments. Must match a UserPlan enum value when the plan grants Pro
   *  access ('pro'), otherwise can be any latin/digit/underscore string
   *  (e.g. 'pro_year', 'pro_quarterly', 'team_basic'). */
  @Column({ unique: true })
  plan_key: string;

  @Column()
  name: string;

  /** Price in RUB for the full duration of the plan. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  /** Legacy: separate annual price. Kept for back-compat with the old
   *  «one Pro plan with monthly + annual» model. New tariffs leave this
   *  null and use price + duration_* fields instead. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price_annual: number;

  /** Subscription duration: number of `duration_unit`s the tariff buys.
   *  E.g. duration_value=30, duration_unit='day' → 30 days; 12 + 'month'
   *  → 1 year. Defaults to 30 days for new tariffs. */
  @Column({ default: 30 })
  duration_value: number;

  /** 'day' or 'month'. Stored as varchar to keep TypeORM migrations
   *  trivial; validated in admin endpoints. */
  @Column({ default: 'day' })
  duration_unit: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ default: 0 })
  sort_order: number;

  @UpdateDateColumn()
  updated_at: Date;
}
