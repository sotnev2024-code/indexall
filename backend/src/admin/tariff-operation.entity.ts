import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('tariff_operations')
export class TariffOperation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true, eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  date: Date;

  @Column({ default: 'Admin' })
  operator: string;

  @Column({ default: 'Base' })
  plan: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount: number;

  @Column({ default: 'none-active' })
  status: string;

  @Column({ nullable: true, type: 'timestamptz' })
  expiresAt: Date;

  @Column({ nullable: true, type: 'text' })
  comment: string;
}
