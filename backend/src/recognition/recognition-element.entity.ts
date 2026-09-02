import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RecognitionPage } from './recognition-page.entity';

/** Размеченный элемент на странице схемы: рамка + класс + параметры.
 *  Координаты рамки нормализованы к размеру страницы (0..1) — независимы
 *  от разрешения рендера, готовы к экспорту в формат YOLO/Label. */
@Entity('recognition_elements')
export class RecognitionElement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  page_id: number;

  @ManyToOne(() => RecognitionPage, (p) => p.elements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'page_id' })
  page: RecognitionPage;

  /** mcb | mccb | rcbo | rcd | contactor | relay | meter | busbar | panel | cable | load | other */
  @Column({ default: 'other' })
  klass: string;

  /** Позиционное обозначение на схеме (QF1, КДУ-ДП3…) */
  @Column({ default: '' })
  designation: string;

  /** Параметры элемента: {'Тип':'ВА47-29','Полюса':'1P',...} */
  @Column({ type: 'jsonb', default: '{}' })
  fields: Record<string, string>;

  /** Рамка в долях страницы: {x, y, w, h}, 0..1 */
  @Column({ type: 'jsonb', default: '{}' })
  bbox: { x: number; y: number; w: number; h: number };

  /** Уверенность модели 0..1 */
  @Column({ type: 'float', default: 0 })
  confidence: number;

  /** Текст, найденный OCR вокруг элемента (ТЗ Максима 27.08, пункт 1):
   *  куски строк с координатами в долях страницы. Отсюда общий алгоритм
   *  будет доставать обозначение, номинал и характеристику. */
  @Column({ type: 'jsonb', default: '[]' })
  texts: Array<{ text: string; conf: number; x: number; y: number; w: number; h: number }>;

  /** auto — гипотеза ИИ; confirmed — подтверждён; corrected — исправлен вручную */
  @Column({ default: 'auto' })
  status: string;

  /** Элемент выгружен в связанный лист спецификации (для обратной синхронизации) */
  @Column({ default: false })
  in_sheet: boolean;

  /** Разметка проверена экспертом (импорт из Label Studio Максима).
   *  Такие рамки не понижаются автоматикой и приоритетны для датасета. */
  @Column({ default: false })
  verified: boolean;

  /** Товар каталога, привязанный к элементу («Добавить из базы»).
   *  Если задан — в лист уходит товарная строка, цены ЭТМ тянутся штатно. */
  @Column({ default: '' })
  product_name: string;

  @Column({ default: '' })
  brand: string;

  @Column({ default: '' })
  article: string;

  @Column({ default: '' })
  etm_code: string;

  @Column({ default: '' })
  price: string;

  /** Пользовательский цвет рамки (пусто — цвет класса) */
  @Column({ default: '' })
  color: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
