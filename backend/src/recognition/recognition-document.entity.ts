import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { RecognitionPage } from './recognition-page.entity';

/** Загруженный пользователем документ со схемами (PDF или изображение).
 *  Страницы рендерятся в JPEG и хранятся в uploads. */
@Entity('recognition_documents')
export class RecognitionDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  owner_id: number;

  /** Оригинальное имя файла, как загрузил пользователь */
  @Column()
  filename: string;

  /** Имя сохранённого исходника в uploads (для повторного рендера/отладки) */
  @Column({ default: '' })
  source_file: string;

  @Column({ default: 0 })
  page_count: number;

  /** 'rendering' — страницы ещё готовятся; 'ready'; 'error' */
  @Column({ default: 'rendering' })
  status: string;

  /** Лист ИНДЕКСАЛЛ, собранный из этого документа (для синхронизации) */
  @Column({ nullable: true })
  sheet_id: number | null;

  @Column({ default: '' })
  error_message: string;

  @OneToMany(() => RecognitionPage, (p) => p.document)
  pages: RecognitionPage[];

  @CreateDateColumn()
  createdAt: Date;
}
