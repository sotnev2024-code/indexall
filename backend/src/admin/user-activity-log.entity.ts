import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

export type ActivityAction =
  | 'login'
  | 'logout'
  | 'register'
  | 'create_project'
  | 'delete_project'
  | 'create_sheet'
  | 'delete_sheet'
  | 'export'
  | 'add_equipment'
  | 'open_catalog'
  | 'activate_tariff'
  | 'other';

@Entity('user_activity_logs')
@Index(['userId', 'createdAt'])
export class UserActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true, eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 64 })
  action: ActivityAction;

  @Column({ type: 'text', nullable: true })
  details: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
