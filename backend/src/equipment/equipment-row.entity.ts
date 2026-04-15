import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sheet } from '../sheets/sheet.entity';

@Entity('equipment_rows')
export class EquipmentRow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sheetId: number;

  @ManyToOne(() => Sheet, (sheet) => sheet.rows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sheetId' })
  sheet: Sheet;

  @Column()
  name: string;

  @Column({ default: '' })
  brand: string;

  @Column({ default: '' })
  article: string;

  /** ETM internal code (hidden field) — when set, ETM lookup uses type=etm with this code
   *  instead of type=mnf with article. Optional, falls back to article. */
  @Column({ default: '' })
  etm_code: string;

  @Column({ default: '0' })
  qty: string;

  @Column({ default: 'шт' })
  unit: string;

  @Column({ default: '0' })
  price: string;

  @Column({ default: '' })
  store: string;

  @Column({ default: '1' })
  coef: string;

  @Column({ default: '0' })
  total: string;

  @Column({ default: true })
  _autoPrice: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  custom: Record<string, string>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
