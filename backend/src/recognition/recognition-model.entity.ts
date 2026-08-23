import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Версия YOLO-модели (.onnx), загруженная через панель модуля.
 *  Активна ровно одна; предыдущие версии остаются для отката. */
@Entity('recognition_model_versions')
export class RecognitionModelVersion {
  @PrimaryGeneratedColumn()
  id: number;

  /** имя файла в uploads (model-<ts>.onnx) */
  @Column()
  filename: string;

  /** имя файла, как загрузили (для отображения) */
  @Column({ default: '' })
  orig_name: string;

  /** заметка: «v1 — 48 схем», mAP и т.п. */
  @Column({ default: '' })
  note: string;

  @Column({ default: false })
  active: boolean;

  /** Роль в конвейере (двухступенчатая схема Максима):
   *  single — одна модель делает всё (рамки + классы, прежнее поведение);
   *  detector — только находит элементы (класс игнорируется);
   *  classifier — определяет класс по вырезанной области детектора.
   *  Активной может быть по одной модели каждой роли. */
  @Column({ default: 'single' })
  role: string;

  /** Резать вход на тайлы размером со вход модели (Zeus 640, Vision 1280).
   *  Для моделей, обученных на целых листах, нарезку выключают. */
  @Column({ default: false })
  tiled: boolean;

  /** class_mapping.json от Максима: соответствие номера выхода модели имени
   *  класса. У классификатора по кропу имён в метаданных ONNX нет, поэтому
   *  без этого файла номера не с чем сопоставить. Хранится как есть. */
  @Column({ type: 'text', default: '' })
  class_map: string;

  @CreateDateColumn()
  createdAt: Date;
}
