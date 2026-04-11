import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('etm_cache')
export class EtmCache {
  @PrimaryColumn() article: string;

  @Column({ nullable: true, type: 'numeric' })
  price: number | null;

  @Column({ nullable: true, type: 'varchar' })
  term: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
