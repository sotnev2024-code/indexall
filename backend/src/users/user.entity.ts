import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Project } from '../projects/project.entity';

export enum UserPlan {
  FREE = 'free',
  TRIAL = 'trial',
  BASE = 'base',
  PRO = 'pro',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SLEEP = 'sleep',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: UserPlan,
    default: UserPlan.FREE,
  })
  plan: UserPlan;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ nullable: true, type: 'varchar' })
  emailVerificationToken: string;

  @Column({ nullable: true, type: 'timestamptz' })
  emailVerificationExpires: Date;

  @Column({ default: false })
  trialUsed: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  subscriptionExpiresAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastSeen: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Project, (project) => project.user)
  projects: Project[];
}
