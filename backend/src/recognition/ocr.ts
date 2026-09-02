/**
 * Распознавание текста рядом с элементом схемы (ТЗ Максима 27.08, пункт 1).
 *
 * Движок — Tesseract, вызывается как обычная программа: он есть в образе
 * бэкенда, работает на процессоре и не требует отдельной машины. Максим
 * называл dots.ocr, но это модель на 1,7 млрд параметров: ей нужно 4–8 ГБ
 * и видеокарта, а на этом сервере 2 ядра и 3,9 ГБ на всё вместе с сайтом.
 * Поэтому движок вынесен за интерфейс: заменить Tesseract на dots.ocr позже
 * — это переписать только функцию runTesseract.
 *
 * Возвращаем не сплошную строку, а «куски» — строки текста с координатами,
 * как и просил Максим: из них общий алгоритм достанет обозначение, номинал
 * и характеристику, понимая, что слева, а что справа от аппарата.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Кусок текста: строка и её рамка в долях переданной картинки */
export interface OcrPiece {
  text: string;
  /** уверенность распознавания 0..1 */
  conf: number;
  x: number; y: number; w: number; h: number;
}

/** Языки распознавания: на схемах перемешаны кириллица и латиница */
const OCR_LANG = (process.env.RECOGNITION_OCR_LANG || 'rus+eng').trim();
/** Слова с уверенностью ниже порога — мусор от линий чертежа */
const OCR_MIN_CONF = Math.min(0.95, Math.max(0.05,
  parseFloat(process.env.RECOGNITION_OCR_MIN_CONF || '') || 0.45));
/** Подписи на чертеже мелкие; Tesseract уверенно читает буквы от ~20 px */
const OCR_UPSCALE_TO = parseInt(process.env.RECOGNITION_OCR_UPSCALE || '1400', 10) || 1400;

let available: boolean | null = null;

/** Есть ли Tesseract в образе. Проверяем один раз и запоминаем. */
export async function ocrAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await execFileAsync('tesseract', ['--version'], { timeout: 10_000 });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** Версия движка — показывается в самопроверке модуля */
export async function ocrVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('tesseract', ['--version'], { timeout: 10_000 });
    return String(stdout).split('\n')[0].trim();
  } catch {
    return null;
  }
}

/**
 * Распознаёт текст на картинке и отдаёт куски строк с координатами
 * в долях этой картинки (0..1).
 */
export async function ocrImage(imageJpeg: Buffer): Promise<OcrPiece[]> {
  if (!(await ocrAvailable())) return [];
  const sharp = require('sharp');

  // Мелкий текст Tesseract читает плохо, поэтому маленькую область
  // увеличиваем. Заодно переводим в оттенки серого и поднимаем контраст:
  // на чертеже линии и буквы одного цвета, нормализация их разделяет.
  const meta = await sharp(imageJpeg).metadata();
  const srcW = meta.width || 1, srcH = meta.height || 1;
  const scale = Math.min(3, Math.max(1, OCR_UPSCALE_TO / Math.max(srcW, srcH)));
  let pipe = sharp(imageJpeg).greyscale().normalise();
  if (scale > 1.01) {
    pipe = pipe.resize(Math.round(srcW * scale), Math.round(srcH * scale), { kernel: 'lanczos3' });
  }
  const prepared: Buffer = await pipe.png().toBuffer();

  const rows = await runTesseract(prepared);
  const outW = Math.round(srcW * scale), outH = Math.round(srcH * scale);
  return groupIntoLines(rows, outW, outH);
}

/** Слово из вывода Tesseract в координатах подготовленной картинки */
type Word = {
  block: number; par: number; line: number;
  left: number; top: number; width: number; height: number;
  conf: number; text: string;
};

/**
 * Прогон Tesseract. Формат tsv даёт координаты каждого слова, psm 11 —
 * «разреженный текст»: на схеме подписи разбросаны, а не идут абзацем.
 */
async function runTesseract(png: Buffer): Promise<Word[]> {
  const args = ['stdin', 'stdout', '-l', OCR_LANG, '--psm', '11', 'tsv'];
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    const child = execFile('tesseract', args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve({ stdout: String(stdout) })));
    child.stdin?.end(png);
  });

  const lines = stdout.split('\n');
  const head = (lines.shift() || '').split('\t');
  const idx = (name: string) => head.indexOf(name);
  const iLevel = idx('level'), iBlock = idx('block_num'), iPar = idx('par_num'), iLine = idx('line_num');
  const iLeft = idx('left'), iTop = idx('top'), iW = idx('width'), iH = idx('height');
  const iConf = idx('conf'), iText = idx('text');
  if (iText < 0) return [];

  const words: Word[] = [];
  for (const raw of lines) {
    const c = raw.split('\t');
    if (Number(c[iLevel]) !== 5) continue;          // 5 — уровень слова
    const text = String(c[iText] ?? '').trim();
    const conf = Number(c[iConf]);
    if (!text || !(conf >= OCR_MIN_CONF * 100)) continue;
    words.push({
      block: Number(c[iBlock]) || 0, par: Number(c[iPar]) || 0, line: Number(c[iLine]) || 0,
      left: Number(c[iLeft]) || 0, top: Number(c[iTop]) || 0,
      width: Number(c[iW]) || 0, height: Number(c[iH]) || 0,
      conf: conf / 100, text,
    });
  }
  return words;
}

/** Слова одной строки склеиваем в кусок текста с общей рамкой */
function groupIntoLines(words: Word[], W: number, H: number): OcrPiece[] {
  const byLine = new Map<string, Word[]>();
  for (const w of words) {
    const key = `${w.block}.${w.par}.${w.line}`;
    const list = byLine.get(key);
    if (list) list.push(w); else byLine.set(key, [w]);
  }
  const out: OcrPiece[] = [];
  for (const list of byLine.values()) {
    list.sort((a, b) => a.left - b.left);
    const left = Math.min(...list.map((w) => w.left));
    const top = Math.min(...list.map((w) => w.top));
    const right = Math.max(...list.map((w) => w.left + w.width));
    const bottom = Math.max(...list.map((w) => w.top + w.height));
    out.push({
      text: list.map((w) => w.text).join(' ').slice(0, 200),
      conf: list.reduce((s, w) => s + w.conf, 0) / list.length,
      x: left / W, y: top / H, w: (right - left) / W, h: (bottom - top) / H,
    });
  }
  // сверху вниз, слева направо — так удобнее читать и человеку, и правилам
  return out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
}
