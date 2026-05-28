import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

export type ActivityAction =
  | 'login'
  | 'login_google'
  | 'login_yandex'
  | 'login_mailru'
  | 'logout'
  | 'register'
  | 'register_google'
  | 'register_yandex'
  | 'register_mailru'
  | 'create_project'
  | 'delete_project'
  | 'create_sheet'
  | 'delete_sheet'
  | 'export'
  | 'add_equipment'
  | 'add_from_catalog'
  | 'add_from_pricelist'
  | 'open_catalog'
  | 'open_section'
  | 'leave_section'
  | 'rename_project'
  | 'rename_sheet'
  | 'save_sheet'
  | 'delete_row'
  | 'insert_row'
  | 'activate_tariff'
  | 'click_tariff'
  | 'other';

@Entity('user_activity_logs')
@Index(['userId', 'createdAt'])
export class UserActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true, type: 'int' })
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
