import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Теневой прогон: в режиме shadow пользователь получает результат LLM,
 *  а YOLO параллельно распознаёт ту же зону — здесь копится сравнение,
 *  по которому решаем, догнала ли модель Максима LLM. */
@Entity('recognition_shadow_runs')
export class RecognitionShadowRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  page_id: number;

  @Column({ type: 'jsonb', default: '{}' })
  zone: { x: number; y: number; w: number; h: number };

  @Column({ default: 0 })
  llm_count: number;

  @Column({ default: 0 })
  yolo_count: number;

  @Column({ default: 0 })
  llm_ms: number;

  @Column({ default: 0 })
  yolo_ms: number;

  /** что нашла YOLO: [{klass, confidence, bbox}] — для сравнения глазами */
  @Column({ type: 'jsonb', default: '[]' })
  yolo_elements: any[];

  /** ошибка YOLO-ветки, если была */
  @Column({ default: '' })
  yolo_error: string;

  @CreateDateColumn()
  createdAt: Date;
}
