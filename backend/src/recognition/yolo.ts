/**
 * Инференс YOLO (ONNX) на CPU сервера.
 *
 * Модель обучает Максим у себя (ultralytics), экспортирует в .onnx и
 * загружает через админ-панель модуля. Здесь — препроцессинг (letterbox
 * 640×640), прогон через onnxruntime-node и постпроцессинг (декод + NMS).
 *
 * onnxruntime-node подключается лениво: до пересборки Docker-образа пакет
 * может отсутствовать — тогда кидаем понятную ошибку, не роняя приложение.
 */

export interface YoloBox {
  /** индекс класса YOLO = атрибут category из конфига Label Studio */
  classId: number;
  conf: number;
  /** рамка в долях исходного изображения (0..1), от левого верхнего угла */
  bbox: { x: number; y: number; w: number; h: number };
}

/** Размер входа модели: должен совпадать с imgsz при экспорте в ONNX
 *  (yolo export … imgsz=640). Обучили/экспортировали на 1280 — задайте
 *  RECOGNITION_YOLO_SIZE=1280 в .env.production. */
const INPUT_SIZE = parseInt(process.env.RECOGNITION_YOLO_SIZE || '640', 10) || 640;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 300;

let cached: { path: string; session: any } | null = null;

/** Сбрасывает закэшированную сессию (при смене активной версии модели). */
export function resetYoloSession() {
  cached = null;
}

async function getSession(modelPath: string) {
  if (cached && cached.path === modelPath) return cached.session;
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, {
    // На VPS 2 CPU не съедаем все ядра — сайт должен дышать
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  });
  cached = { path: modelPath, session };
  return session;
}

/** Прогон изображения (JPEG-буфер) через модель. */
export async function yoloDetect(imageJpeg: Buffer, modelPath: string): Promise<YoloBox[]> {
  const ort = require('onnxruntime-node');
  const sharp = require('sharp');

  // ── letterbox: вписываем в 640×640 с серыми полями (как в ultralytics) ──
  const meta = await sharp(imageJpeg).metadata();
  const srcW = meta.width || 1;
  const srcH = meta.height || 1;
  const scale = Math.min(INPUT_SIZE / srcW, INPUT_SIZE / srcH);
  const newW = Math.max(1, Math.round(srcW * scale));
  const newH = Math.max(1, Math.round(srcH * scale));
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  const raw: Buffer = await sharp(imageJpeg)
    .resize(newW, newH)
    .extend({
      top: padY,
      bottom: INPUT_SIZE - newH - padY,
      left: padX,
      right: INPUT_SIZE - newW - padX,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  // HWC uint8 → CHW float32 /255
  const px = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    input[i] = raw[i * 3] / 255;
    input[px + i] = raw[i * 3 + 1] / 255;
    input[2 * px + i] = raw[i * 3 + 2] / 255;
  }

  const session = await getSession(modelPath);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outputs = await session.run({ [inputName]: tensor });
  const out = outputs[outputName];
  const dims: number[] = out.dims;
  const data: Float32Array = out.data;

  // ── декод: поддерживаем [1, 4+nc, N] (ultralytics v8/v11) и [1, N, 4+nc] ──
  if (dims.length !== 3) throw new Error(`Неожиданная форма выхода модели: [${dims.join(',')}]`);
  const channelsFirst = dims[1] < dims[2]; // например [1, 39, 8400]
  const C = channelsFirst ? dims[1] : dims[2];
  const N = channelsFirst ? dims[2] : dims[1];
  const nc = C - 4;
  if (nc < 1) throw new Error(`Модель без классов (каналов: ${C})`);
  const at = channelsFirst
    ? (c: number, n: number) => data[c * N + n]
    : (c: number, n: number) => data[n * C + c];

  const candidates: YoloBox[] = [];
  for (let n = 0; n < N; n++) {
    let best = 0;
    let bestClass = -1;
    for (let c = 0; c < nc; c++) {
      const s = at(4 + c, n);
      if (s > best) { best = s; bestClass = c; }
    }
    if (best < CONF_THRESHOLD || bestClass < 0) continue;
    const cx = at(0, n);
    const cy = at(1, n);
    const w = at(2, n);
    const h = at(3, n);
    // пиксели letterbox → пиксели исходника → доли
    const x1 = ((cx - w / 2) - padX) / scale;
    const y1 = ((cy - h / 2) - padY) / scale;
    const bw = w / scale;
    const bh = h / scale;
    const bx = Math.max(0, Math.min(1, x1 / srcW));
    const by = Math.max(0, Math.min(1, y1 / srcH));
    candidates.push({
      classId: bestClass,
      conf: best,
      bbox: {
        x: bx,
        y: by,
        w: Math.max(0.001, Math.min(1 - bx, bw / srcW)),
        h: Math.max(0.001, Math.min(1 - by, bh / srcH)),
      },
    });
  }

  return nms(candidates).slice(0, MAX_DETECTIONS);
}

function iou(a: YoloBox['bbox'], b: YoloBox['bbox']): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Class-aware non-maximum suppression. */
function nms(boxes: YoloBox[]): YoloBox[] {
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf);
  const keep: YoloBox[] = [];
  for (const box of sorted) {
    let ok = true;
    for (const k of keep) {
      if (k.classId === box.classId && iou(k.bbox, box.bbox) > IOU_THRESHOLD) { ok = false; break; }
    }
    if (ok) keep.push(box);
  }
  return keep;
}
