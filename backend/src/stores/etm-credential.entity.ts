import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('etm_credentials')
export class EtmCredential {
  @PrimaryColumn() user_id: number;
  @Column() login: string;
  @Column() password_enc: string;
  @Column({ nullable: true, type: 'varchar' }) session_key: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) session_expires_at: Date | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
