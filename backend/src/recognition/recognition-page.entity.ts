import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { RecognitionDocument } from './recognition-document.entity';
import { RecognitionElement } from './recognition-element.entity';

/** Одна страница документа (одна схема). Картинка лежит в uploads. */
@Entity('recognition_pages')
export class RecognitionPage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  document_id: number;

  @ManyToOne(() => RecognitionDocument, (d) => d.pages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: RecognitionDocument;

  /** Номер страницы в исходном PDF, с 1 */
  @Column()
  page_index: number;

  /** Название схемы (пусто — «Схема N»). Переименование переименовывает
   *  и связанный лист спецификации. */
  @Column({ default: '' })
  title: string;

  /** Лист спецификации ИНДЕКСАЛЛ, собранный из ЭТОЙ схемы */
  @Column({ nullable: true })
  sheet_id: number | null;

  /** Имя JPEG-файла в uploads ('' — ещё рендерится) */
  @Column({ default: '' })
  image_file: string;

  @Column({ default: 0 })
  width: number;

  @Column({ default: 0 })
  height: number;

  /** Тип схемы на листе: single_line | schematic | wiring (конфиг Label Studio) */
  @Column({ default: 'single_line' })
  schema_type: string;

  /** «Удалённая» пользователем страница: скрыта из интерфейса, PDF не трогаем */
  @Column({ default: false })
  hidden: boolean;

  /** Пользователь пометил страницу как полностью проверенную */
  @Column({ default: false })
  confirmed: boolean;

  @OneToMany(() => RecognitionElement, (e) => e.page)
  elements: RecognitionElement[];
}
