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

  @CreateDateColumn()
  createdAt: Date;
}
