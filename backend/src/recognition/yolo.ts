/**
 * Инференс YOLO (ONNX) на CPU сервера — модель Zeus.
 *
 * Модель обучает Максим у себя (ultralytics), экспортирует в .onnx и
 * загружает через панель модуля. Здесь: препроцессинг (letterbox/тайлы),
 * прогон через onnxruntime-node и постпроцессинг.
 *
 * Поддерживаются оба формата выхода ultralytics:
 *   • классический YOLOv8/v11:  [1, 4+nc, N] или [1, N, 4+nc]
 *     — 4 координаты (cx, cy, w, h) + вероятности классов;
 *   • end-to-end (YOLO26, экспорт с NMS): [1, N, 6]
 *     — x1, y1, x2, y2, confidence, class_id (NMS уже внутри модели).
 * Формат определяется по форме выхода, переключателей не требуется.
 *
 * onnxruntime-node подключается лениво: до пересборки Docker-образа пакет
 * может отсутствовать — тогда кидаем понятную ошибку, не роняя приложение.
 */
import * as fs from 'fs';

export interface YoloBox {
  /** номер класса, как его выдала модель (порядок из её classes.txt) */
  classId: number;
  /** имя класса из метаданных модели, если есть */
  className?: string;
  conf: number;
  /** рамка в долях исходного изображения (0..1), от левого верхнего угла */
  bbox: { x: number; y: number; w: number; h: number };
}

/** Запасной размер входа, если модель не сообщает свой (yolo export imgsz=…) */
const FALLBACK_INPUT = parseInt(process.env.RECOGNITION_YOLO_SIZE || '640', 10) || 640;
/**
 * Тайловый инференс — ТОЛЬКО для модели, обученной на тайлах.
 *
 * Тайлы режут зону в масштабе 1:1, тогда как letterbox вписывает её целиком
 * во вход модели. Для модели, обученной на целых листах, это меняет масштаб
 * объектов в разы: аппарат, который при обучении занимал десятки пикселей,
 * приходит на вход огромным — и не находится вообще. Поэтому по умолчанию
 * выключено; включать вместе с переходом на тайловую модель:
 *   RECOGNITION_YOLO_TILES=1
 */
const TILES_ENABLED = /^(1|true|on|yes)$/i.test((process.env.RECOGNITION_YOLO_TILES || '').trim());
/** Больше тайлов — точнее на крупных зонах, но дольше на CPU сервера */
const MAX_TILES = parseInt(process.env.RECOGNITION_YOLO_MAX_TILES || '12', 10) || 12;
const TILE_OVERLAP = 0.2;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 300;

let cached: { path: string; session: any; input: number; names: string[] | null } | null = null;

/** Сбрасывает закэшированную сессию (при смене активной версии модели). */
export function resetYoloSession() {
  cached = null;
}

/** Действующие настройки инференса — показываются в самопроверке модуля. */
export function yoloSettings() {
  return {
    tiles: TILES_ENABLED,
    max_tiles: MAX_TILES,
    fallback_input: FALLBACK_INPUT,
    conf_threshold: CONF_THRESHOLD,
  };
}

/**
 * Имена классов из метаданных ONNX. Ultralytics пишет их строкой вида
 * "{0: 'circuit_breaker', 1: 'rcbo', …}" — вытаскиваем без protobuf-парсера,
 * чтобы не тянуть зависимость ради одного поля.
 */
export function readModelClassNames(modelPath: string): string[] | null {
  try {
    const buf = fs.readFileSync(modelPath);
    let from = 0;
    for (let i = 0; i < 8; i++) {
      const idx = buf.indexOf('names', from);
      if (idx < 0) break;
      from = idx + 5;
      const chunk = buf.slice(idx, idx + 32768).toString('utf8');
      const m = chunk.match(/\{\s*0\s*:\s*['"][\s\S]{0,20000}?\}/);
      if (!m) continue;
      const names: string[] = [];
      const re = /(\d+)\s*:\s*['"]([^'"]*)['"]/g;
      let p: RegExpExecArray | null;
      while ((p = re.exec(m[0]))) names[parseInt(p[1], 10)] = p[2];
      if (names.length) return names;
    }
  } catch { /* метаданных нет — не критично, классы можно задать вручную */ }
  return null;
}

async function getSession(modelPath: string) {
  if (cached && cached.path === modelPath) return cached;
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, {
    // На VPS не съедаем все ядра — сайт должен дышать
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  });
  // размер входа берём у самой модели: иначе рассинхрон с imgsz экспорта
  let input = FALLBACK_INPUT;
  try {
    const dims = session.inputMetadata?.[0]?.shape || session.inputMetadata?.[0]?.dims;
    const side = Array.isArray(dims) ? dims[dims.length - 1] : null;
    if (typeof side === 'number' && side >= 64) input = side;
  } catch { /* динамический вход — остаётся запасной размер */ }
  cached = { path: modelPath, session, input, names: readModelClassNames(modelPath) };
  return cached;
}

/** Один прогон подготовленного квадрата inputSize×inputSize. */
async function runTile(
  ort: any, session: any, raw: Buffer, inputSize: number,
  names: string[] | null,
): Promise<{ x1: number; y1: number; x2: number; y2: number; conf: number; cls: number }[]> {
  const px = inputSize * inputSize;
  const input = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    input[i] = raw[i * 3] / 255;
    input[px + i] = raw[i * 3 + 1] / 255;
    input[2 * px + i] = raw[i * 3 + 2] / 255;
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const out = outputs[session.outputNames[0]];
  const dims: number[] = out.dims;
  const data: any = out.data;
  if (dims.length !== 3) throw new Error(`Неожиданная форма выхода модели: [${dims.join(',')}]`);

  const res: { x1: number; y1: number; x2: number; y2: number; conf: number; cls: number }[] = [];

  // ── end-to-end (YOLO26 / экспорт с NMS): [1, N, 6] = x1,y1,x2,y2,conf,cls ──
  const endToEnd = dims[2] === 6 && dims[1] > 6;
  if (endToEnd) {
    const N = dims[1];
    for (let n = 0; n < N; n++) {
      const o = n * 6;
      const conf = Number(data[o + 4]);
      if (!(conf >= CONF_THRESHOLD)) continue;
      res.push({
        x1: Number(data[o]), y1: Number(data[o + 1]),
        x2: Number(data[o + 2]), y2: Number(data[o + 3]),
        conf, cls: Math.round(Number(data[o + 5])),
      });
    }
    return res;
  }

  // ── классический YOLOv8/v11: 4 координаты (cx,cy,w,h) + вероятности ──
  const channelsFirst = dims[1] < dims[2]; // например [1, 39, 8400]
  const C = channelsFirst ? dims[1] : dims[2];
  const N = channelsFirst ? dims[2] : dims[1];
  const nc = C - 4;
  if (nc < 1) throw new Error(`Модель без классов (каналов: ${C})`);
  const at = channelsFirst
    ? (c: number, n: number) => Number(data[c * N + n])
    : (c: number, n: number) => Number(data[n * C + c]);

  for (let n = 0; n < N; n++) {
    let best = 0, bestClass = -1;
    for (let c = 0; c < nc; c++) {
      const s = at(4 + c, n);
      if (s > best) { best = s; bestClass = c; }
    }
    if (best < CONF_THRESHOLD || bestClass < 0) continue;
    const cx = at(0, n), cy = at(1, n), w = at(2, n), h = at(3, n);
    res.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, conf: best, cls: bestClass });
  }
  return res;
}

/**
 * Прогон изображения (JPEG-буфер) через модель.
 * Крупные зоны режем на тайлы размером со вход модели с перекрытием —
 * иначе мелкие аппараты «схлопываются» при сжатии всей зоны до 640/1280.
 */
export async function yoloDetect(imageJpeg: Buffer, modelPath: string): Promise<YoloBox[]> {
  const ort = require('onnxruntime-node');
  const sharp = require('sharp');
  const { session, input: S, names } = await getSession(modelPath);

  const meta = await sharp(imageJpeg).metadata();
  const srcW = meta.width || 1;
  const srcH = meta.height || 1;

  // сколько тайлов нужно, чтобы держать масштаб 1:1
  const step = Math.round(S * (1 - TILE_OVERLAP));
  let cols = Math.max(1, Math.ceil((srcW - S) / step) + 1);
  let rows = Math.max(1, Math.ceil((srcH - S) / step) + 1);
  const tiled = TILES_ENABLED && (cols > 1 || rows > 1) && cols * rows <= MAX_TILES;

  const found: YoloBox[] = [];

  if (!tiled) {
    // ── одна картинка: letterbox во вход модели (как в ultralytics) ──
    const scale = Math.min(S / srcW, S / srcH);
    const newW = Math.max(1, Math.round(srcW * scale));
    const newH = Math.max(1, Math.round(srcH * scale));
    const padX = Math.floor((S - newW) / 2);
    const padY = Math.floor((S - newH) / 2);
    const raw: Buffer = await sharp(imageJpeg)
      .resize(newW, newH)
      .extend({ top: padY, bottom: S - newH - padY, left: padX, right: S - newW - padX,
        background: { r: 114, g: 114, b: 114 } })
      .removeAlpha().raw().toBuffer();

    for (const d of await runTile(ort, session, raw, S, names)) {
      pushBox(found, names, d.cls, d.conf,
        (d.x1 - padX) / scale, (d.y1 - padY) / scale,
        (d.x2 - padX) / scale, (d.y2 - padY) / scale, srcW, srcH);
    }
  } else {
    // ── тайлы: масштаб сохраняется, мелкие элементы не теряются ──
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const left = Math.min(Math.max(0, c * step), Math.max(0, srcW - Math.min(S, srcW)));
        const top = Math.min(Math.max(0, r * step), Math.max(0, srcH - Math.min(S, srcH)));
        const w = Math.min(S, srcW - left);
        const h = Math.min(S, srcH - top);
        if (w < 8 || h < 8) continue;
        const raw: Buffer = await sharp(imageJpeg)
          .extract({ left, top, width: w, height: h })
          .extend({ top: 0, left: 0, bottom: S - h, right: S - w,
            background: { r: 114, g: 114, b: 114 } })
          .removeAlpha().raw().toBuffer();

        for (const d of await runTile(ort, session, raw, S, names)) {
          pushBox(found, names, d.cls, d.conf,
            d.x1 + left, d.y1 + top, d.x2 + left, d.y2 + top, srcW, srcH);
        }
      }
    }
  }

  // NMS нужен всегда: даже у end-to-end моделей тайлы дают дубли на стыках
  return nms(found).slice(0, MAX_DETECTIONS);
}

function pushBox(
  out: YoloBox[], names: string[] | null, cls: number, conf: number,
  x1: number, y1: number, x2: number, y2: number, srcW: number, srcH: number,
) {
  const bx = Math.max(0, Math.min(1, x1 / srcW));
  const by = Math.max(0, Math.min(1, y1 / srcH));
  const bw = Math.max(0.001, Math.min(1 - bx, (x2 - x1) / srcW));
  const bh = Math.max(0.001, Math.min(1 - by, (y2 - y1) / srcH));
  out.push({
    classId: cls,
    className: names?.[cls],
    conf: Math.max(0, Math.min(1, conf)),
    bbox: { x: bx, y: by, w: bw, h: bh },
  });
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
