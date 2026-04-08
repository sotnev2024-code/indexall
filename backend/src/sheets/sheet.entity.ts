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

@Entity('sheets')
export class Sheet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ default: 0 })
  sort_order: number;

  @Column()
  projectId: number;

  @ManyToOne(() => Project, (project) => project.sheets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @OneToMany(() => EquipmentRow, (row) => row.sheet, { cascade: true })
  rows: EquipmentRow[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
