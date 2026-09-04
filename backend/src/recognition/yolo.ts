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
 *
 * ВАЖНО, замер 04.09 на отложенной выборке датасета (7 листов, 183 рамки
 * разметки, модель best-v1): нарезка НЕ помогает текущим моделям, а вредит —
 * recall 11,5% против 50,8% и precision 4,9% против 73,2%. Рамок она находит
 * втрое больше (428 против 127), но почти все мимо разметки. Считать находки
 * без сверки с разметкой бесполезно: на титульном листе PDF, где аппаратов
 * нет вообще, нарезка «находит» три штуки. Не включайте нарезку, пока
 * активная модель не переобучена на тайлах.
 */
const TILES_ENABLED = /^(1|true|on|yes)$/i.test((process.env.RECOGNITION_YOLO_TILES || '').trim());
/**
 * Потолок числа тайлов: больше — точнее на крупных зонах, но дольше на CPU.
 * Раньше при превышении нарезка молча отключалась и модель получала лист
 * целиком (не тот масштаб → «ничего не находится»). Теперь вместо отказа
 * зона слегка уменьшается, чтобы уложиться в потолок.
 */
const MAX_TILES = parseInt(process.env.RECOGNITION_YOLO_MAX_TILES || '36', 10) || 36;
const TILE_OVERLAP = 0.2;
/**
 * Второй проход детектора со сдвигом сетки тайлов на половину тайла
 * (ТЗ Максима 27.08). Стоит вдвое дороже по времени, поэтому выключаемо:
 *   RECOGNITION_YOLO_HALF_SHIFT=0
 */
const HALF_SHIFT_PASS = !/^(0|false|off|no)$/i.test((process.env.RECOGNITION_YOLO_HALF_SHIFT || '').trim());
/** Чем добиваем картинку до входа модели. Схемы — чёрным по белому, поэтому
 *  поле белое: серая заливка для модели инородна, а Максим просил именно
 *  «дорисовать белые области с сохранением пропорций» (19.08). */
const PAD_COLOR = { r: 255, g: 255, b: 255 };
/**
 * Порог уверенности детектора. При 0,25 на плотных листах приходит много
 * ложных рамок на подписях: замер на схеме Максима — 24 рамки против 15 при
 * пороге 0,55, тогда как настоящих аппаратов там около 15. Значение по
 * умолчанию не меняем (это его решение — что важнее, полнота или чистота),
 * но даём ручку: RECOGNITION_YOLO_CONF=0.45
 */
const CONF_THRESHOLD = Math.min(0.95, Math.max(0.05,
  parseFloat(process.env.RECOGNITION_YOLO_CONF || '') || 0.25));
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 300;

type Cached = { path: string; session: any; input: number; names: string[] | null };
/** Сессии по пути к модели: в поочерёдном режиме за один запрос работают
 *  сразу две модели (детектор и классификатор), одиночный кэш их выбивал бы
 *  друг у друга и пересоздавал сессию на каждой области. */
const sessions = new Map<string, Cached>();
const MAX_SESSIONS = 3;

/** Сбрасывает закэшированные сессии (при смене активной версии модели). */
export function resetYoloSession() {
  sessions.clear();
}

/** Размер входа модели (imgsz экспорта). Нужен, чтобы показывать модели
 *  область в масштабе 1:1 — как на тайлах, на которых её обучали. */
export async function modelInputSize(modelPath: string): Promise<number> {
  return (await getSession(modelPath)).input;
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
 * Значение поля из metadata_props ONNX. Ultralytics складывает туда imgsz,
 * task, names и прочее подряд; читаем без protobuf-парсера — как и имена
 * классов ниже. Ключ может встретиться и в описании модели, поэтому
 * перебираем несколько вхождений, пока значение не разберётся.
 */
function readModelMetaField(
  modelPath: string, key: string, parse: (chunk: string) => string | null, span = 64,
): string | null {
  try {
    const buf = fs.readFileSync(modelPath);
    let from = 0;
    for (let i = 0; i < 8; i++) {
      const idx = buf.indexOf(key, from);
      if (idx < 0) break;
      from = idx + key.length;
      const value = parse(buf.slice(idx, idx + span).toString('latin1'));
      if (value) return value;
    }
  } catch { /* метаданных нет — вызывающий использует запасной путь */ }
  return null;
}

/**
 * Размер входа из метаданных экспорта (imgsz). Читать его ОБЯЗАТЕЛЬНО: в
 * onnxruntime-node 1.19 (версия из package-lock) свойства inputMetadata ещё
 * нет, оно появилось в 1.20. Раньше размер молча оставался запасным 640, а
 * все модели проекта экспортированы с imgsz=1280 — session.run падал с
 * «Got invalid dimensions … Got: 640 Expected: 1280» на каждом запросе, и
 * распознавание не находило ничего вообще.
 */
export function readModelImgsz(modelPath: string): number | null {
  const raw = readModelMetaField(modelPath, 'imgsz', (chunk) => {
    const m = chunk.match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
    return m ? m[1] : null;
  });
  const side = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(side) && side >= 64 ? side : null;
}

/** Тип задачи из метаданных экспорта: detect / classify / segment / … */
export function readModelTask(modelPath: string): string | null {
  return readModelMetaField(modelPath, 'task', (chunk) => {
    const m = chunk.match(/(detect|classify|segment|pose|obb)/);
    return m ? m[1] : null;
  }, 32);
}

/**
 * Последняя страховка, если imgsz в метаданных нет: пробуем прогнать пустой
 * тензор — onnxruntime в тексте ошибки сам называет ожидаемый размер
 * («Got: 640 Expected: 1280»).
 */
async function probeInputSize(ort: any, session: any, first: number): Promise<number | null> {
  try {
    const t = new ort.Tensor('float32', new Float32Array(3 * first * first), [1, 3, first, first]);
    await session.run({ [session.inputNames[0]]: t });
    return first;
  } catch (e: any) {
    const m = String(e?.message || '').match(/Expected:\s*(\d+)/);
    const side = m ? parseInt(m[1], 10) : NaN;
    return Number.isFinite(side) && side >= 64 ? side : null;
  }
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

async function getSession(modelPath: string): Promise<Cached> {
  const hit = sessions.get(modelPath);
  if (hit) return hit;
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, {
    // На VPS не съедаем все ядра — сайт должен дышать
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  });
  // Размер входа берём у самой модели: иначе рассинхрон с imgsz экспорта.
  // Порядок источников — от дешёвого к дорогому; inputMetadata оставляем
  // первым на будущее (появится после обновления onnxruntime-node до 1.20+),
  // но полагаться на него нельзя — в 1.19 его просто нет.
  let input = 0;
  try {
    const dims = session.inputMetadata?.[0]?.shape || session.inputMetadata?.[0]?.dims;
    const side = Array.isArray(dims) ? dims[dims.length - 1] : null;
    if (typeof side === 'number' && side >= 64) input = side;
  } catch { /* динамический вход — идём дальше по списку источников */ }
  if (!input) input = readModelImgsz(modelPath) || 0;
  if (!input) input = (await probeInputSize(ort, session, FALLBACK_INPUT)) || 0;
  if (!input) input = FALLBACK_INPUT;

  const entry: Cached = { path: modelPath, session, input, names: readModelClassNames(modelPath) };
  // держим на VPS не больше трёх моделей в памяти
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }
  sessions.set(modelPath, entry);
  return entry;
}

/**
 * Что за модель лежит в файле: детектор (выход [1, N, …]) или классификатор
 * по кропу (выход [1, C] — вероятности классов). Максим 19.08 прислал вторую:
 * «эта нейросеть работает по кропу, детектор должен давать ей область, а она
 * может только определять класс». Тип определяем по форме выхода, чтобы
 * загрузка новой модели не требовала переключателей.
 */
export type ModelKind = 'detect' | 'classify';

export async function modelKind(modelPath: string): Promise<ModelKind> {
  const { session } = await getSession(modelPath);
  // Метаданные экспорта — основной источник: outputMetadata в
  // onnxruntime-node 1.19 отсутствует, и проверка по форме выхода молча
  // считала классификатор детектором.
  const task = readModelTask(modelPath);
  if (task === 'classify') return 'classify';
  if (task) return 'detect';
  try {
    const md = session.outputMetadata?.[0];
    const dims = md?.shape || md?.dims;
    if (Array.isArray(dims) && dims.length === 2) return 'classify';
  } catch { /* метаданных нет — считаем детектором, ошибка вылезет при прогоне */ }
  return 'detect';
}

/**
 * Нормализация входа классификатора. Обучение на torchvision/timm почти всегда
 * идёт со средним и разбросом ImageNet; если Максим обучал без нормализации,
 * переключается переменной RECOGNITION_CLS_NORM=01.
 */
const CLS_NORM = (process.env.RECOGNITION_CLS_NORM || 'imagenet').trim().toLowerCase();
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

/**
 * Классификация вырезанного элемента: картинка → вероятности классов.
 * Возвращает несколько лучших вариантов, отсортированных по убыванию.
 */
export async function classifyImage(
  imageJpeg: Buffer, modelPath: string, topK = 3,
): Promise<{ classId: number; conf: number; className?: string }[]> {
  const ort = require('onnxruntime-node');
  const sharp = require('sharp');
  const { session, input: S, names } = await getSession(modelPath);

  // кроп растягиваем во вход: классификатор обучали именно так — на
  // вырезанных элементах, приведённых к одному размеру
  const raw: Buffer = await sharp(imageJpeg)
    .resize(S, S, { fit: 'fill' })
    .removeAlpha().raw().toBuffer();

  const px = S * S;
  const data = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) {
      const v = raw[i * 3 + c] / 255;
      data[c * px + i] = CLS_NORM === '01' ? v : (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  const tensor = new ort.Tensor('float32', data, [1, 3, S, S]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const out = outputs[session.outputNames[0]];
  const logits: any = out.data;
  const C = Number(out.dims[out.dims.length - 1]) || logits.length;

  // softmax: модель отдаёт логиты, а нам нужна уверенность для порогов и UI
  let max = -Infinity;
  for (let i = 0; i < C; i++) max = Math.max(max, Number(logits[i]));
  let sum = 0;
  const probs = new Array(C);
  for (let i = 0; i < C; i++) { probs[i] = Math.exp(Number(logits[i]) - max); sum += probs[i]; }

  return probs
    .map((p: number, i: number) => ({ classId: i, conf: sum > 0 ? p / sum : 0, className: names?.[i] }))
    .sort((a, b) => b.conf - a.conf)
    .slice(0, Math.max(1, topK));
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
export async function yoloDetect(
  imageJpeg: Buffer, modelPath: string, opts?: { tiles?: boolean },
): Promise<YoloBox[]> {
  const ort = require('onnxruntime-node');
  const sharp = require('sharp');
  const { session, input: S, names } = await getSession(modelPath);
  // нарезка задаётся моделью (флаг «обучена на тайлах»),
  // env-флаг остаётся общим значением по умолчанию
  const tilesWanted = opts?.tiles ?? TILES_ENABLED;

  const meta = await sharp(imageJpeg).metadata();
  let srcW = meta.width || 1;
  let srcH = meta.height || 1;
  let work = imageJpeg;

  // сколько тайлов нужно, чтобы держать масштаб 1:1
  const step = Math.round(S * (1 - TILE_OVERLAP));
  const grid = (w: number, h: number) => ({
    cols: Math.max(1, Math.ceil((w - S) / step) + 1),
    rows: Math.max(1, Math.ceil((h - S) / step) + 1),
  });
  let { cols, rows } = grid(srcW, srcH);
  const tiled = tilesWanted && (cols > 1 || rows > 1);

  if (tiled && cols * rows > MAX_TILES) {
    // зона слишком большая для потолка тайлов: не отказываемся от нарезки
    // (это меняло бы масштаб объектов), а немного уменьшаем саму зону
    const k = Math.sqrt(MAX_TILES / (cols * rows));
    srcW = Math.max(S, Math.round(srcW * k));
    srcH = Math.max(S, Math.round(srcH * k));
    work = await sharp(imageJpeg).resize(srcW, srcH, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();
    ({ cols, rows } = grid(srcW, srcH));
  }

  const found: YoloBox[] = [];

  if (!tiled) {
    // ── одна картинка: letterbox во вход модели (как в ultralytics) ──
    // Модель, обученная на тайлах, ждёт аппараты в том же размере, что при
    // обучении, поэтому зону мельче входа не растягиваем, а добиваем полем —
    // как выглядит тайл на краю листа. Замер на схемах Максима (сетка 16 зон
    // 700×300 по листу PDF) показал одинаковый счёт с растяжением и без:
    // 19 рамок, так что жалобы «на PDF не срабатывает» это НЕ объясняет —
    // там зоны действительно попадали на титульный блок и таблицы. Правку
    // оставляем как более верную по масштабу, но лечит она не это.
    const scale = tilesWanted
      ? Math.min(1, S / srcW, S / srcH)
      : Math.min(S / srcW, S / srcH);
    const newW = Math.max(1, Math.round(srcW * scale));
    const newH = Math.max(1, Math.round(srcH * scale));
    const padX = Math.floor((S - newW) / 2);
    const padY = Math.floor((S - newH) / 2);
    const raw: Buffer = await sharp(work)
      .resize(newW, newH)
      .extend({ top: padY, bottom: S - newH - padY, left: padX, right: S - newW - padX,
        background: PAD_COLOR })
      .removeAlpha().raw().toBuffer();

    for (const d of await runTile(ort, session, raw, S, names)) {
      pushBox(found, names, d.cls, d.conf,
        (d.x1 - padX) / scale, (d.y1 - padY) / scale,
        (d.x2 - padX) / scale, (d.y2 - padY) / scale, srcW, srcH);
    }
  } else {
    // ── тайлы: масштаб сохраняется, мелкие элементы не теряются ──
    //
    // Проход второй — со смещением сетки на половину тайла (ТЗ Максима 27.08):
    // элемент, попавший на стык тайлов, в первом проходе виден только
    // наполовину и часто теряется; во втором он оказывается в середине.
    // Дубли снимает NMS ниже — остаётся рамка с наибольшей уверенностью.
    const runGrid = async (offX: number, offY: number) => {
      for (let top0 = offY; top0 < srcH; top0 += step) {
        for (let left0 = offX; left0 < srcW; left0 += step) {
          // край листа: прижимаем тайл к границе, чтобы не резать пополам
          const left = Math.min(Math.max(0, left0), Math.max(0, srcW - Math.min(S, srcW)));
          const top = Math.min(Math.max(0, top0), Math.max(0, srcH - Math.min(S, srcH)));
          const w = Math.min(S, srcW - left);
          const h = Math.min(S, srcH - top);
          if (w < 8 || h < 8) continue;
          const raw: Buffer = await sharp(work)
            .extract({ left, top, width: w, height: h })
            .extend({ top: 0, left: 0, bottom: S - h, right: S - w,
              background: PAD_COLOR })
            .removeAlpha().raw().toBuffer();

          for (const d of await runTile(ort, session, raw, S, names)) {
            pushBox(found, names, d.cls, d.conf,
              d.x1 + left, d.y1 + top, d.x2 + left, d.y2 + top, srcW, srcH);
          }
        }
      }
    };

    await runGrid(0, 0);
    // второй проход нужен, только если сетка вообще больше одного тайла
    if (HALF_SHIFT_PASS && (cols > 1 || rows > 1)) {
      const half = Math.round(S / 2);
      if (srcW > half || srcH > half) await runGrid(half, half);
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
