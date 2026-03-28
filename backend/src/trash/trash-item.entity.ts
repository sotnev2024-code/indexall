import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trash_items')
export class TrashItem {
  @PrimaryGeneratedColumn() id: number;
  @Column() entity_type: string; // 'project' | 'sheet'
  @Column() entity_id: number;
  @Column() user_id: number;
  @Column({ nullable: true }) name: string;
  @Column({ nullable: true, type: 'jsonb' }) snapshot: object;
  @CreateDateColumn() deleted_at: Date;
}
