import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Folder } from '../folders/folder.entity';

@Entity('templates')
export class Template {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'text', default: '' })
  meta: string;

  @Column({ default: 0 })
  files: number;

  @Column({ default: 0 })
  views_count: number;

  @Column({ default: 0 })
  used_count: number;

  @Column({ default: false })
  is_favorite: boolean;

  @Column({ default: true })
  is_active: boolean;

  @Column({ nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  folder_id: number | null;

  @ManyToOne(() => Folder, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'folder_id' })
  folder: Folder | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
