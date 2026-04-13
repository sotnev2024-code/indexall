import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Folder } from '../folders/folder.entity';

@Entity('sheets')
export class Sheet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ default: 0 })
  sort_order: number;

  /** Legacy: still set for sheets migrated from projects */
  @Column({ nullable: true })
  projectId: number | null;

  @ManyToOne(() => Project, (project) => project.sheets, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'projectId' })
  project: Project | null;

  /** New: folder the sheet belongs to */
  @Column({ nullable: true })
  folder_id: number | null;

  @ManyToOne(() => Folder, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'folder_id' })
  folder: Folder | null;

  /** Owner user id (denormalized for fast ownership checks without joining) */
  @Column({ nullable: true })
  owner_id: number | null;

  /** User-defined custom columns: [{key: 'col_1', label: 'Примечание'}, ...] */
  @Column({ type: 'jsonb', default: '[]' })
  custom_columns: { key: string; label: string }[];

  @OneToMany(() => EquipmentRow, (row) => row.sheet, { cascade: true })
  rows: EquipmentRow[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
