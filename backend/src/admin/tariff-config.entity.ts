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

  /** Cover image path (multer-saved). Rendered as the tile background in
   *  the admin tile manager — admin uploads an image → tile shows it. */
  @Column({ nullable: true })
  image_path: string;

  /** Grid cell width: 1 or 2. Combined with height for 1×1, 1×2, 1×3, 1×4
   *  layouts. Defaults to 1×3 (tall vertical column) for new tariffs since
   *  the client wants tariffs displayed as vertical columns. */
  @Column({ default: 1 })
  width: number;

  /** Grid cell height: 1..4. */
  @Column({ default: 3 })
  height: number;

  /** Optional parent tariff id — when set, this tariff is a "mini sub-block"
   *  under a main tariff column (e.g. 60-day / annual variants attached to
   *  the Pro column). null for top-level tiles. */
  @Column({ nullable: true })
  parent_id: number;

  /** How many times a single user can activate this tariff.
   *  0 = unlimited. Useful for free/trial tariffs that should only be
   *  used once per account. Only enforced for free (price=0) tariffs
   *  via the activate-free endpoint. */
  @Column({ default: 0 })
  max_activations_per_user: number;

  @UpdateDateColumn()
  updated_at: Date;
}
