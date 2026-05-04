import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/** Tiny key/value store for misc admin-controlled flags that don't deserve
 *  a column on a domain table — e.g. "show pricing as image tiles". Kept
 *  generic on purpose so future flags can be added without migrations. */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string;

  @UpdateDateColumn()
  updated_at: Date;
}
