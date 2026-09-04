/**
 * Подстановка параметров элемента из текста рядом с ним (ТЗ Максима, пункт 2).
 *
 * Что здесь есть и чего нет. Есть механика: раздача кусков текста своим
 * аппаратам, нормализация кириллицы против латиницы и разбор подписей по
 * шаблонам. Правил, которые Максим обещал прислать («текст слева в
 * приоритете», определение класса устройства по номиналу и наличию кривой),
 * пока нет — когда придут, меняются только таблицы ниже, не механика.
 *
 * Значения сверяются со списками каталога: подставляем лишь то, что в базе
 * существует. Это его же правило «бывают только варианты, доступные в базе»
 * и заодно защита от мусора OCR — «кал 10» в номинал уже не превратится.
 *
 * Отключается целиком: RECOGNITION_AUTOFILL=0
 */

export interface TextPiece {
  text: string;
  conf: number;
  x: number; y: number; w: number; h: number;
}

export interface Bbox { x: number; y: number; w: number; h: number }

/** Значения каталога по названию поля: {'Серия': ['ВА 47-29', …], …} */
export type CatalogValues = Record<string, string[]>;

export const AUTOFILL_ENABLED =
  !/^(0|false|off|no)$/i.test((process.env.RECOGNITION_AUTOFILL || '').trim());

/**
 * Кириллица и латиница на чертежах неразличимы на глаз, а OCR выбирает
 * произвольно: «ВА 47-29» приходит то кириллицей, то латиницей. Приводим
 * похожие буквы к одному виду, иначе сверка с каталогом не срабатывает —
 * замер показал ровно этот промах на серии автоматов.
 */
const LOOKALIKE: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c',
  т: 't', у: 'y', х: 'x', ё: 'e',
};

export function norm(v: string): string {
  return String(v).toLowerCase()
    .split('').map((ch) => LOOKALIKE[ch] ?? ch).join('')
    .replace(/[^0-9a-zа-я+.,]/g, '')
    .replace(/,/g, '.');
}

/** Расстояние от куска текста до рамки элемента (в долях листа) */
function distance(b: Bbox, t: TextPiece): number {
  const dx = Math.max(b.x - (t.x + t.w), t.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (t.y + t.h), t.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
}

/**
 * Каждый кусок текста отдаём ближайшему аппарату.
 *
 * Без этого шага подпись шапки панели попадала во все рамки разом, и четыре
 * автомата получали одинаковые параметры — проверено на схеме Максима.
 */
export function assignTexts<T extends { bbox: Bbox; texts?: TextPiece[] }>(
  els: T[], pieces: TextPiece[],
): Map<T, TextPiece[]> {
  const own = new Map<T, TextPiece[]>();
  for (const el of els) own.set(el, []);
  for (const t of pieces) {
    let best: T | null = null;
    let bestD = Infinity;
    for (const el of els) {
      const d = distance(el.bbox, t);
      if (d < bestD) { bestD = d; best = el; }
    }
    if (best) own.get(best)!.push(t);
  }
  // текст слева и выше — первым: Максим просил считать левый приоритетным
  for (const list of own.values()) list.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  return own;
}

/** Ищем значение поля среди списка каталога по нормализованному вхождению */
function matchCatalog(texts: TextPiece[], values: string[], minLen = 3): string | null {
  const cand = values
    .map((v) => ({ v, n: norm(v) }))
    .filter((x) => x.n.length >= minLen)
    .sort((a, b) => b.n.length - a.n.length);      // длинное совпадение точнее
  for (const t of texts) {
    const nt = norm(t.text);
    if (!nt) continue;
    const hit = cand.find((c) => nt.includes(c.n));
    if (hit) return hit.v;
  }
  return null;
}

/** Значение каталога, ближайшее к числу с чертежа (250 А → «250») */
function matchNumber(num: number, values: string[]): string | null {
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const v of values) {
    const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) continue;
    const diff = Math.abs(n - num);
    if (diff < bestDiff) { bestDiff = diff; best = v; }
  }
  // «250» и «250.0» — одно, а «250» против «160» — уже другое
  return best !== null && bestDiff < 0.01 ? best : null;
}

/**
 * Разбор подписей одного аппарата. Возвращает только то, в чём уверены:
 * пустые и сомнительные поля не трогаем, чтобы человек не разбирал ошибки
 * подстановки вместо своей работы.
 */
export function parseFields(texts: TextPiece[], cat: CatalogValues): Record<string, string> {
  const out: Record<string, string> = {};
  const joined = texts.map((t) => t.text);

  // Обозначение: QF1, QF1.2, QS2, SF3 — с цифрой, иначе это шум OCR
  for (const t of joined) {
    const m = String(t).match(/\b(QF|QS|SF|SB|KM|KV|QW)\s?-?\s?(\d+(?:[.,]\d+)?)\b/i);
    if (m) { out['Обозначение'] = `${m[1].toUpperCase()}${m[2].replace(',', '.')}`; break; }
  }

  // Серия и производитель — прямой сверкой со списками базы
  const series = Object.keys(cat).find((k) => /сери/i.test(k));
  if (series) {
    const hit = matchCatalog(texts, cat[series] || [], 4);
    if (hit) out[series] = hit;
  }
  const brand = Object.keys(cat).find((k) => /производител/i.test(k));
  if (brand) {
    const hit = matchCatalog(texts, cat[brand] || [], 3);
    if (hit) out[brand] = hit;
  }

  // Полюса: «3P», «1P+N», «4Р» (кириллическая Р тоже встречается)
  const poles = Object.keys(cat).find((k) => /полюс/i.test(k));
  if (poles) {
    for (const t of joined) {
      const m = String(t).match(/\b([1-4])\s?[PРp]\s?(\+\s?N)?\b/);
      if (!m) continue;
      const want = m[2] ? `${m[1]}+N` : m[1];
      const hit = (cat[poles] || []).find((v) => norm(v) === norm(want));
      if (hit) { out[poles] = hit; break; }
    }
  }

  // Номинальный ток: «Iн=250 А», «In=32 A», «250 А». Значение обязано быть
  // в ряду каталога — так отсекаются «кал 10» и прочие ошибки распознавания.
  const amps = Object.keys(cat).find((k) => /номинальн.*ток/i.test(k));
  if (amps) {
    for (const t of joined) {
      const m = String(t).match(/(?:^|[^0-9a-zа-я])(\d{1,4}(?:[.,]\d)?)\s?[AА]\b/i);
      if (!m) continue;
      const hit = matchNumber(parseFloat(m[1].replace(',', '.')), cat[amps] || []);
      if (hit) { out[amps] = hit; break; }
    }
  }

  // Кривая отключения: «Тип "C"», «хар-ка B», «Хар. С»
  const curve = Object.keys(cat).find((k) => /крив/i.test(k));
  if (curve) {
    for (const t of joined) {
      const m = String(t).match(/(?:тип|хар[-.\s]?ка|хар\.?|char)\W{0,4}["'«]?\s?([ABCDKLZВСД])\b/i);
      if (!m) continue;
      const letter = norm(m[1]).toUpperCase();
      const hit = (cat[curve] || []).find((v) => norm(v).toUpperCase() === letter);
      if (hit) { out[curve] = hit; break; }
    }
  }

  return out;
}
