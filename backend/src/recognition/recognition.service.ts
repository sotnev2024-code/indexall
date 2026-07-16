import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RecognitionDocument } from './recognition-document.entity';
import { RecognitionPage } from './recognition-page.entity';
import { RecognitionElement } from './recognition-element.entity';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Folder } from '../folders/folder.entity';
import { AppSetting } from '../admin/app-setting.entity';
import {
  ClassConfig,
  DEFAULT_LS_CONFIG,
  LEGACY_ALIASES,
  mergeWithSystem,
  parseLsConfig,
  RecognitionClass,
} from './recognition-classes';

const execFileAsync = promisify(execFile);

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** multer/busboy декодирует имя загруженного файла как latin1 — кириллица
 *  приходит «кракозябрами» (Ð¡Ð½Ð¸Ð¼Ð¾Ðº…). Возвращаем UTF-8. Декодируем
 *  только строки, целиком состоящие из latin1-символов, чтобы не испортить
 *  уже корректные имена. */
function fixFileName(name: string): string {
  if (!name) return name;
  let hasHigh = false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c > 0xff) return name; // уже нормальный юникод — не трогаем
    if (c > 0x7f) hasHigh = true; // есть latin1-байты — похоже на кракозябры
  }
  if (!hasHigh) return name; // чистый ASCII
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  // если после декодирования появились символы-заменители — оставляем как было
  return decoded.indexOf(String.fromCharCode(0xfffd)) >= 0 ? name : decoded;
}
/** Максимум страниц PDF на документ (защита диска и очереди рендера) */
const MAX_PAGES = 60;
/** dpi рендера страниц: баланс читаемости мелких надписей и размера файла */
const RENDER_DPI = 200;
/** Длинная сторона кропа, отправляемого в модель */
const DETECT_MAX_EDGE = 2200;

/** Ключ настройки с XML-конфигом Label Studio (см. recognition-classes.ts) */
const LS_CONFIG_KEY = 'recognition_ls_config';

type Bbox = { x: number; y: number; w: number; h: number };

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);
  /** Рендер строго по одной странице за раз — на VPS 2 CPU/4 ГБ параллельный
   *  poppler легко душит основное приложение. */
  private renderChain: Promise<void> = Promise.resolve();
  private classConfigCache: { cfg: ClassConfig; at: number } | null = null;

  constructor(
    @InjectRepository(RecognitionDocument) private docsRepo: Repository<RecognitionDocument>,
    @InjectRepository(RecognitionPage) private pagesRepo: Repository<RecognitionPage>,
    @InjectRepository(RecognitionElement) private elementsRepo: Repository<RecognitionElement>,
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(EquipmentRow) private rowsRepo: Repository<EquipmentRow>,
    @InjectRepository(Folder) private foldersRepo: Repository<Folder>,
    @InjectRepository(AppSetting) private settingsRepo: Repository<AppSetting>,
  ) {}

  isConfigured(): boolean {
    return !!(process.env.RECOGNITION_API_URL?.trim() && process.env.RECOGNITION_API_KEY?.trim());
  }

  // ── Классы (таксономия из конфига Label Studio) ───────────────

  /** Актуальная таксономия: XML из настройки (Максим обновляет его по мере
   *  появления нового оборудования) + системные классы ИНДЕКСАЛЛ. Кэш 60 c. */
  async getClassConfig(): Promise<ClassConfig> {
    if (this.classConfigCache && Date.now() - this.classConfigCache.at < 60_000) {
      return this.classConfigCache.cfg;
    }
    let xml = DEFAULT_LS_CONFIG;
    try {
      const row = await this.settingsRepo.findOne({ where: { key: LS_CONFIG_KEY } });
      if (row?.value?.trim()) xml = row.value;
    } catch { /* используем дефолт */ }
    let parsed = parseLsConfig(xml);
    if (!parsed.classes.length) parsed = parseLsConfig(DEFAULT_LS_CONFIG);
    const cfg = mergeWithSystem(parsed);
    this.classConfigCache = { cfg, at: Date.now() };
    return cfg;
  }

  /** Сохранить новый XML-конфиг Label Studio (вставляется в интерфейсе). */
  async saveLsConfig(xml: string) {
    const parsed = parseLsConfig(String(xml || ''));
    if (parsed.classes.length < 3) {
      throw new BadRequestException('Не похоже на конфиг Label Studio: не нашёл метки <Label …>');
    }
    await this.settingsRepo.save({ key: LS_CONFIG_KEY, value: String(xml) });
    this.classConfigCache = null;
    return this.getClassConfig();
  }

  /** Приводит код класса к актуальному: legacy-алиасы старой версии модуля
   *  (rcd → rccb…) и неизвестные значения → 'other'. */
  private resolveKlass(klass: any, cfg: ClassConfig): string {
    const k = String(klass || '').trim();
    if (!k) return 'other';
    if (cfg.classes.some((c) => c.code === k)) return k;
    const alias = LEGACY_ALIASES[k];
    if (alias && cfg.classes.some((c) => c.code === alias)) return alias;
    return 'other';
  }

  // ── Документы ─────────────────────────────────────────────────

  async createDocument(userId: number, file: Express.Multer.File) {
    const isPdf = /pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname);
    const isImage = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
    if (!isPdf && !isImage) {
      try { fs.unlinkSync(file.path); } catch {}
      throw new BadRequestException('Поддерживаются PDF, PNG и JPG');
    }

    let pageCount = 1;
    if (isPdf) {
      try {
        const { stdout } = await execFileAsync('pdfinfo', [file.path], { timeout: 30_000 });
        const m = stdout.match(/^Pages:\s+(\d+)/m);
        pageCount = m ? parseInt(m[1], 10) : 1;
      } catch (e) {
        try { fs.unlinkSync(file.path); } catch {}
        throw new BadRequestException('Не удалось прочитать PDF (файл повреждён?)');
      }
      if (pageCount > MAX_PAGES) {
        try { fs.unlinkSync(file.path); } catch {}
        throw new BadRequestException(`В файле ${pageCount} страниц — максимум ${MAX_PAGES}. Разбейте PDF на части.`);
      }
    }

    const doc = await this.docsRepo.save({
      owner_id: userId,
      filename: fixFileName(file.originalname),
      source_file: file.filename,
      page_count: pageCount,
      status: 'rendering',
    });

    const pages = await this.pagesRepo.save(
      Array.from({ length: pageCount }, (_, i) => ({
        document_id: doc.id,
        page_index: i + 1,
      })),
    );

    // Рендер в фоне: страница за страницей, документ доступен сразу,
    // фронт опрашивает готовность.
    this.enqueueRender(doc, file.path, isPdf, pages.map((p) => p.id));

    return this.getDocument(doc.id, userId);
  }

  private enqueueRender(doc: RecognitionDocument, srcPath: string, isPdf: boolean, pageIds: number[]) {
    this.renderChain = this.renderChain
      .then(() => this.renderDocument(doc, srcPath, isPdf, pageIds))
      .catch(async (e) => {
        this.logger.error(`Рендер документа ${doc.id} упал: ${e?.message || e}`);
        await this.docsRepo.update(doc.id, { status: 'error', error_message: 'Не удалось подготовить страницы' });
      });
  }

  private async renderDocument(doc: RecognitionDocument, srcPath: string, isPdf: boolean, pageIds: number[]) {
    // sharp подключаем лениво: до пересборки Docker-образа модуль может
    // отсутствовать — тогда падаем с понятной ошибкой, не роняя приложение.
    const sharp = require('sharp');
    for (let i = 0; i < pageIds.length; i++) {
      const pageNo = i + 1;
      const outName = `recog-${doc.id}-p${pageNo}.jpg`;
      const outPath = join(UPLOAD_DIR, outName);

      if (isPdf) {
        // pdftoppm добавляет к префиксу номер страницы с плавающим паддингом —
        // рендерим во временную папку и забираем единственный файл.
        const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'recog-'));
        try {
          await execFileAsync(
            'pdftoppm',
            ['-jpeg', '-jpegopt', 'quality=82', '-r', String(RENDER_DPI),
             '-f', String(pageNo), '-l', String(pageNo), srcPath, join(tmpDir, 'p')],
            { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
          );
          const made = fs.readdirSync(tmpDir).find((f) => f.endsWith('.jpg'));
          if (!made) throw new Error(`pdftoppm не создал страницу ${pageNo}`);
          fs.copyFileSync(join(tmpDir, made), outPath);
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        // Единственная картинка: нормализуем в JPEG (и выравниваем EXIF-поворот)
        await sharp(srcPath).rotate().jpeg({ quality: 88 }).toFile(outPath);
      }

      const meta = await sharp(outPath).metadata();
      await this.pagesRepo.update(pageIds[i], {
        image_file: outName,
        width: meta.width || 0,
        height: meta.height || 0,
      });
    }
    await this.docsRepo.update(doc.id, { status: 'ready' });
  }

  async listDocuments(userId: number) {
    const docs = await this.docsRepo.find({
      where: { owner_id: userId },
      order: { id: 'DESC' },
    });
    return docs;
  }

  async getDocument(id: number, userId: number) {
    const doc = await this.checkDocOwner(id, userId);
    const pages = await this.pagesRepo.find({
      where: { document_id: id },
      order: { page_index: 'ASC' },
    });
    const elements = pages.length
      ? await this.elementsRepo.find({
          where: { page_id: In(pages.map((p) => p.id)) },
          order: { id: 'ASC' },
        })
      : [];
    return {
      ...doc,
      pages: pages.map((p) => ({
        ...p,
        image_url: p.image_file ? `/api/uploads/${p.image_file}` : null,
      })),
      elements,
    };
  }

  async removeDocument(id: number, userId: number) {
    const doc = await this.checkDocOwner(id, userId);
    const pages = await this.pagesRepo.find({ where: { document_id: id } });
    for (const p of pages) {
      if (p.image_file) { try { fs.unlinkSync(join(UPLOAD_DIR, p.image_file)); } catch {} }
    }
    if (doc.source_file) { try { fs.unlinkSync(join(UPLOAD_DIR, doc.source_file)); } catch {} }
    await this.docsRepo.delete(id);
    return { success: true };
  }

  async updatePage(
    pageId: number,
    userId: number,
    patch: { hidden?: boolean; confirmed?: boolean; schema_type?: string },
  ) {
    const page = await this.checkPageOwner(pageId, userId);
    const safe: any = {};
    if (typeof patch.hidden === 'boolean') safe.hidden = patch.hidden;
    if (typeof patch.confirmed === 'boolean') safe.confirmed = patch.confirmed;
    if (patch.schema_type) {
      const cfg = await this.getClassConfig();
      if (cfg.schemaTypes.some((t) => t.value === patch.schema_type)) {
        safe.schema_type = patch.schema_type;
      }
    }
    await this.pagesRepo.update(page.id, safe);
    return this.pagesRepo.findOne({ where: { id: page.id } });
  }

  // ── Распознавание зоны ────────────────────────────────────────

  async detectZone(pageId: number, userId: number, zone: Bbox) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Распознавание не настроено: задайте RECOGNITION_API_URL и RECOGNITION_API_KEY на сервере',
      );
    }
    const page = await this.checkPageOwner(pageId, userId);
    if (!page.image_file || !page.width || !page.height) {
      throw new BadRequestException('Страница ещё готовится — подождите пару секунд');
    }
    const z = this.clampZone(zone);
    if (z.w < 0.02 || z.h < 0.02) throw new BadRequestException('Зона слишком маленькая — выделите область побольше');

    // Кроп зоны из рендера страницы
    const sharp = require('sharp');
    const left = Math.round(z.x * page.width);
    const top = Math.round(z.y * page.height);
    const width = Math.min(Math.round(z.w * page.width), page.width - left);
    const height = Math.min(Math.round(z.h * page.height), page.height - top);
    let pipeline = sharp(join(UPLOAD_DIR, page.image_file)).extract({ left, top, width, height });
    if (Math.max(width, height) > DETECT_MAX_EDGE) {
      pipeline = pipeline.resize({
        width: width >= height ? DETECT_MAX_EDGE : undefined,
        height: height > width ? DETECT_MAX_EDGE : undefined,
      });
    }
    const buf: Buffer = await pipeline.jpeg({ quality: 85 }).toBuffer();

    const cfg = await this.getClassConfig();
    const found = await this.callVisionModel(buf, cfg);

    // bbox кропа → bbox страницы
    const toSave = found.map((el) => ({
      page_id: page.id,
      klass: this.resolveKlass(el.klass, cfg),
      designation: String(el.designation || '').slice(0, 60),
      fields: this.sanitizeFields(el.fields),
      bbox: {
        x: z.x + Math.max(0, Math.min(1, el.bbox[0])) * z.w,
        y: z.y + Math.max(0, Math.min(1, el.bbox[1])) * z.h,
        w: Math.max(0.001, Math.min(1, el.bbox[2])) * z.w,
        h: Math.max(0.001, Math.min(1, el.bbox[3])) * z.h,
      },
      confidence: Math.max(0, Math.min(1, Number(el.confidence) || 0)),
      status: 'auto',
    }));
    const saved = toSave.length ? await this.elementsRepo.save(toSave) : [];
    return { elements: saved };
  }

  /** Вызов Gemini через агрегатор (см. RECOGNITION_API_URL). stream:false —
   *  просим единый JSON; на случай принудительного SSE парсим и поток.
   *  Список классов в промпте строится из актуальной таксономии — LLM
   *  размечает в тех же кодах, в которых копится датасет для YOLO. */
  private async callVisionModel(imageJpeg: Buffer, cfg: ClassConfig): Promise<Array<{
    klass: string; designation?: string; fields?: Record<string, string>;
    bbox: [number, number, number, number]; confidence?: number;
  }>> {
    const base = (process.env.RECOGNITION_API_URL || '').trim().replace(/\/+$/, '');
    const model = (process.env.RECOGNITION_MODEL || 'gemini-3-5-flash').trim();
    const url = `${base}/gemini/v1/models/${model}:streamGenerateContent`;

    const lsClasses = cfg.classes.filter((c) => !c.system)
      .map((c) => `${c.code} (${c.nameRu})`).join(', ');
    const prompt = [
      'Ты — инженер-электрик. На изображении фрагмент электрической схемы из российского проекта (однолинейная, принципиальная или монтажная; раздел ИОС/ЭОМ).',
      'Найди ВСЕ элементы электрооборудования и верни СТРОГО JSON без пояснений и без markdown:',
      '{"elements":[{"klass":"...","designation":"...","fields":{...},"bbox":[x,y,w,h],"confidence":0.95}]}',
      '',
      `klass — ровно один код из списка: ${lsClasses}.`,
      'Дополнительные служебные классы: cable (кабельная линия: марка/сечение/длина), load (электроприёмник: светильник, клапан, вентилятор, розеточная сеть), panel (щит/распредпункт целиком: ЩО/ЩС/ПР/ППЗ/ВРУ), busbar (шина), other (не удалось определить).',
      'designation — позиционное обозначение (QF1, QF27, КДУ-ДП3, Гр.1...), если видно.',
      'fields — параметры, которые видны на схеме, русскими ключами:',
      '  для аппаратов защиты: "Тип" (ВА47-29...), "Полюса" (1P/2P/3P/1P+N), "Хар-ка" (B/C/D), "Номинал, А", "Утечка, мА" (для УЗО/дифавтоматов);',
      '  для контакторов/реле: "Тип", "Номинал, А", "Катушка, В";',
      '  для cable: "Марка" (ВВГнг(А)-LS...), "Жилы×сечение" (3×2,5), "Длина, м";',
      '  для load: "Наименование", "Помещение", "Мощность, кВт";',
      '  для прочих: "Тип" и видимые характеристики.',
      'bbox — рамка элемента В ДОЛЯХ ЭТОГО ИЗОБРАЖЕНИЯ: [x левого края, y верхнего края, ширина, высота], каждое 0..1. Рамка должна плотно обводить графический символ элемента вместе с его подписью.',
      'confidence — твоя уверенность 0..1.',
      'Каждый аппарат, каждую кабельную линию и каждый приёмник размечай ОТДЕЛЬНЫМ элементом. Если параметр не виден — не выдумывай, пропусти ключ.',
      'Если на фрагменте нет электрооборудования — верни {"elements":[]}.',
    ].join('\n');

    const body = {
      stream: false,
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageJpeg.toString('base64') } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.1 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    let raw: string;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RECOGNITION_API_KEY?.trim()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      raw = await res.text();
      if (!res.ok) {
        this.logger.warn(`Vision API ${res.status}: ${raw.slice(0, 300)}`);
        throw new ServiceUnavailableException(`Сервис распознавания ответил ошибкой (${res.status})`);
      }
    } catch (e: any) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.logger.warn(`Vision API недоступен: ${e?.message || e}`);
      throw new ServiceUnavailableException('Сервис распознавания недоступен, попробуйте ещё раз');
    } finally {
      clearTimeout(timer);
    }

    const text = this.extractTextFromProviderResponse(raw);
    const parsed = this.extractJson(text);
    const list = Array.isArray(parsed) ? parsed : parsed?.elements;
    if (!Array.isArray(list)) {
      this.logger.warn(`Модель вернула неожиданный формат: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException('Модель вернула неожиданный ответ — попробуйте зону поменьше');
    }
    return list.filter((el: any) => Array.isArray(el?.bbox) && el.bbox.length === 4);
  }

  /** Достаёт текст модели и из единого JSON-ответа, и из SSE-потока чанков. */
  private extractTextFromProviderResponse(raw: string): string {
    const collect = (obj: any): string =>
      (obj?.candidates || [])
        .flatMap((c: any) => c?.content?.parts || [])
        .map((p: any) => p?.text || '')
        .join('');
    const t = raw.trim();
    // Единый объект или массив чанков
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const j = JSON.parse(t);
        return Array.isArray(j) ? j.map(collect).join('') : collect(j);
      } catch { /* попробуем как SSE */ }
    }
    // SSE: строки "data: {...}"
    let out = '';
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(\{.*\})\s*$/);
      if (m) { try { out += collect(JSON.parse(m[1])); } catch {} }
    }
    return out || t;
  }

  private extractJson(text: string): any {
    let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = t.search(/[{[]/);
    if (start > 0) t = t.slice(start);
    try { return JSON.parse(t); } catch {}
    // Обрезанный хвост: пробуем до последней закрывающей скобки
    const lastBrace = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (lastBrace > 0) { try { return JSON.parse(t.slice(0, lastBrace + 1)); } catch {} }
    return null;
  }

  private sanitizeFields(fields: any): Record<string, string> {
    const out: Record<string, string> = {};
    if (fields && typeof fields === 'object') {
      for (const [k, v] of Object.entries(fields)) {
        if (v == null) continue;
        out[String(k).slice(0, 40)] = String(v).slice(0, 200);
      }
    }
    return out;
  }

  // ── Элементы ──────────────────────────────────────────────────

  async createElement(pageId: number, userId: number, data: Partial<RecognitionElement>) {
    const page = await this.checkPageOwner(pageId, userId);
    const cfg = await this.getClassConfig();
    const el = await this.elementsRepo.save({
      page_id: page.id,
      klass: this.resolveKlass(data.klass, cfg),
      designation: String(data.designation || '').slice(0, 60),
      fields: this.sanitizeFields(data.fields),
      bbox: this.clampZone(data.bbox as Bbox),
      confidence: 1,
      status: 'corrected', // ручная разметка — сразу «правда» для датасета
      color: String(data.color || '').slice(0, 20),
    });
    return el;
  }

  async updateElement(id: number, userId: number, patch: any) {
    const el = await this.checkElementOwner(id, userId);
    const safe: any = {};
    if (patch.klass) {
      const cfg = await this.getClassConfig();
      const resolved = this.resolveKlass(patch.klass, cfg);
      if (resolved !== 'other' || patch.klass === 'other') safe.klass = resolved;
    }
    if (patch.designation != null) safe.designation = String(patch.designation).slice(0, 60);
    if (patch.fields) safe.fields = this.sanitizeFields(patch.fields);
    if (patch.bbox) safe.bbox = this.clampZone(patch.bbox);
    if (patch.color != null) safe.color = String(patch.color).slice(0, 20);
    if (patch.status && ['auto', 'confirmed', 'corrected'].includes(patch.status)) safe.status = patch.status;
    await this.elementsRepo.update(el.id, safe);
    return this.elementsRepo.findOne({ where: { id: el.id } });
  }

  async removeElement(id: number, userId: number) {
    const el = await this.checkElementOwner(id, userId);
    await this.elementsRepo.delete(el.id);
    return { success: true };
  }

  // ── Создание/синхронизация листа спецификации ─────────────────

  /** Собирает лист ИНДЕКСАЛЛ из подтверждённых элементов документа.
   *  Первый вызов создаёт лист (папка «Распознавание»), повторные —
   *  обновляют его же: строки распознавания (помечены custom._recog)
   *  пересобираются, строки, добавленные пользователем руками, не трогаем. */
  async createSheetFromDocument(docId: number, userId: number) {
    const doc = await this.checkDocOwner(docId, userId);
    const pages = await this.pagesRepo.find({ where: { document_id: docId, hidden: false } });
    if (!pages.length) throw new BadRequestException('В документе нет видимых страниц');
    const allElements = await this.elementsRepo.find({ where: { page_id: In(pages.map((p) => p.id)) } });
    const usable = allElements.filter(
      (e) => (e.status === 'confirmed' || e.status === 'corrected') && e.klass !== 'load' && e.klass !== 'other',
    );
    if (!usable.length) {
      throw new BadRequestException('Нет подтверждённых элементов — подтвердите рамки на схеме (кнопка «Подтвердить»)');
    }

    // Группировка одинаковых позиций (+ id рамок, из которых строка собрана)
    const cfg = await this.getClassConfig();
    type Acc = { name: string; qty: number; unit: string; ids: number[] };
    const acc = new Map<string, Acc>();
    for (const el of usable) {
      const f = el.fields || {};
      if (el.klass === 'cable') {
        const name = `Кабель ${f['Марка'] || ''} ${f['Жилы×сечение'] || ''}`.replace(/\s+/g, ' ').trim();
        const len = parseFloat(String(f['Длина, м'] || '').replace(',', '.'));
        const cur = acc.get(name) || { name, qty: 0, unit: 'м', ids: [] };
        if (len > 0) cur.qty += len;
        cur.ids.push(el.id);
        acc.set(name, cur);
      } else {
        const name = this.deviceRowName(el.klass, f, cfg);
        const cur = acc.get(name) || { name, qty: 0, unit: 'шт', ids: [] };
        cur.qty += 1;
        cur.ids.push(el.id);
        acc.set(name, cur);
      }
    }

    // Существующий связанный лист (если не удалён)
    let sheet = doc.sheet_id
      ? await this.sheetsRepo.findOne({ where: { id: doc.sheet_id, owner_id: userId } })
      : null;
    let created = false;

    if (!sheet) {
      // Папка «Распознавание» в меню проектов (создаём при первом использовании)
      let folder = await this.foldersRepo.findOne({
        where: { owner_id: userId, type: 'projects', name: 'Распознавание', parent_id: IsNull() },
      });
      if (!folder) {
        folder = await this.foldersRepo.save({
          name: 'Распознавание', owner_id: userId, type: 'projects', parent_id: null,
        });
      }
      const baseName = doc.filename.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'Схема';
      sheet = await this.sheetsRepo.save({
        folder_id: folder.id,
        owner_id: userId,
        name: `Распознавание — ${baseName}`,
      });
      await this.docsRepo.update(doc.id, { sheet_id: sheet.id });
      created = true;
    }

    // Upsert строк распознавания; пользовательские строки не трогаем
    const existing = await this.rowsRepo.find({ where: { sheetId: sheet.id }, order: { sort_order: 'ASC', id: 'ASC' } });
    const ours = existing.filter((r) => r.custom && (r.custom as any)._recog);
    const oursByName = new Map(ours.map((r) => [r.name, r]));
    let nextOrder = existing.length ? Math.max(...existing.map((r) => r.sort_order)) + 1 : 0;

    for (const g of acc.values()) {
      const qty = String(Math.round(g.qty * 100) / 100);
      const recogMark = JSON.stringify(g.ids);
      const row = oursByName.get(g.name);
      if (row) {
        await this.rowsRepo.update(row.id, {
          qty,
          unit: g.unit,
          custom: { ...(row.custom || {}), _recog: recogMark },
        });
        oursByName.delete(g.name);
      } else {
        await this.rowsRepo.save({
          sheetId: sheet.id,
          sort_order: nextOrder++,
          name: g.name,
          brand: '',
          article: '',
          qty,
          unit: g.unit,
          price: '0',
          store: '',
          coef: '1',
          total: '0',
          custom: { _recog: recogMark },
        });
      }
    }
    // Строки распознавания, которым больше не соответствует ни один элемент
    for (const stale of oursByName.values()) {
      await this.rowsRepo.delete(stale.id);
    }

    // Пометка элементов, попавших в лист (для обратной синхронизации)
    const inSheetIds = new Set(usable.map((e) => e.id));
    await this.elementsRepo.update({ id: In(allElements.map((e) => e.id)) }, { in_sheet: false });
    if (inSheetIds.size) {
      await this.elementsRepo.update({ id: In([...inSheetIds]) }, { in_sheet: true });
    }

    return { sheetId: sheet.id, rowCount: acc.size, updated: !created };
  }

  /** Обратная синхронизация (вызывается из SheetsService после сохранения
   *  строк): пользователь удалил распознанную строку из листа → у рамок,
   *  из которых она была собрана, снимается подтверждение (status='auto').
   *  Разметку не удаляем физически — это ценность для датасета. */
  async onSheetRowsSaved(sheetId: number, rows: { custom?: Record<string, string> }[]) {
    try {
      const docs = await this.docsRepo.find({ where: { sheet_id: sheetId } });
      if (!docs.length) return;
      const presentIds = new Set<number>();
      for (const r of rows || []) {
        const mark = r?.custom?.['_recog'];
        if (!mark) continue;
        try { (JSON.parse(String(mark)) as number[]).forEach((id) => presentIds.add(Number(id))); } catch {}
      }
      for (const doc of docs) {
        const pages = await this.pagesRepo.find({ where: { document_id: doc.id } });
        if (!pages.length) continue;
        const linked = await this.elementsRepo.find({
          where: { page_id: In(pages.map((p) => p.id)), in_sheet: true },
        });
        const removed = linked.filter((e) => !presentIds.has(e.id));
        if (removed.length) {
          await this.elementsRepo.update(
            { id: In(removed.map((e) => e.id)) },
            { in_sheet: false, status: 'auto' },
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`Обратная синхронизация листа ${sheetId} не удалась: ${e?.message || e}`);
    }
  }

  /** Лист удалён целиком — отвязываем документы (разметку не трогаем). */
  async onSheetRemoved(sheetId: number) {
    try {
      await this.docsRepo.update({ sheet_id: sheetId }, { sheet_id: null });
    } catch { /* некритично */ }
  }

  private deviceRowName(klass: string, f: Record<string, string>, cfg: ClassConfig): string {
    const t = f['Тип'] || '';
    const p = f['Полюса'] || '';
    const ch = f['Хар-ка'] || '';
    const a = f['Номинал, А'] || '';
    const leak = f['Утечка, мА'] || '';
    let name: string;
    switch (klass) {
      case 'mcb': name = `Автоматический выключатель ${t} ${p}${ch ? `, хар. ${ch}` : ''}${a ? `, ${a} А` : ''}`; break;
      case 'mccb': name = `Автоматический выключатель ${t} ${p}${a ? `, ${a} А` : ''}`; break;
      case 'acb': name = `Воздушный автоматический выключатель ${t}${a ? `, ${a} А` : ''}`; break;
      case 'rcbo': name = `Дифавтомат ${t} ${p}${ch || a ? `, ${ch}${a}` : ''}${leak ? `, ${leak} мА` : ''}`; break;
      case 'rccb':
      case 'rcd': name = `УЗО ${t} ${p}${a ? `, ${a} А` : ''}${leak ? `, ${leak} мА` : ''}`; break;
      case 'contactor': name = `Контактор ${t}${a ? `, ${a} А` : ''}${f['Катушка, В'] ? `, катушка ${f['Катушка, В']} В` : ''}`; break;
      case 'busbar': name = `Шина ${t}`; break;
      case 'panel': name = `Щит ${t || f['Наименование'] || ''}`; break;
      default: {
        // Прочие классы конфига (реле, клеммы, кнопки, УЗИП…): русское имя + параметры
        const cls = cfg.classes.find((c) => c.code === klass);
        const base = cls?.nameRu || 'Оборудование';
        const capital = base.charAt(0).toUpperCase() + base.slice(1);
        name = `${capital} ${t}${p ? ` ${p}` : ''}${a ? `, ${a} А` : ''}${leak ? `, ${leak} мА` : ''}`;
      }
    }
    return name.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  }

  // ── Датасет (выгрузка в Label Studio) ─────────────────────────

  /** Статистика разметки: сколько рамок по классам и статусам. */
  async datasetStats() {
    const cfg = await this.getClassConfig();
    const rows = await this.elementsRepo
      .createQueryBuilder('e')
      .select('e.klass', 'klass')
      .addSelect('e.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('e.klass')
      .addGroupBy('e.status')
      .getRawMany();
    const docs = await this.docsRepo.count();
    const pages = await this.pagesRepo.count({ where: { hidden: false } });
    const byClass: Record<string, { total: number; confirmed: number }> = {};
    for (const r of rows) {
      const k = r.klass || 'other';
      byClass[k] = byClass[k] || { total: 0, confirmed: 0 };
      byClass[k].total += Number(r.cnt);
      if (r.status === 'confirmed' || r.status === 'corrected') byClass[k].confirmed += Number(r.cnt);
    }
    return {
      documents: docs,
      pages,
      byClass,
      classes: cfg.classes,
      schemaTypes: cfg.schemaTypes,
    };
  }

  /** Выгрузка подтверждённой разметки в формате задач Label Studio.
   *  Картинки — абсолютными URL на этот сервер (LS подтянет их сам).
   *  Системные классы (cable/load/panel/busbar/other) в датасет не входят. */
  async exportDataset(from?: string, to?: string) {
    const cfg = await this.getClassConfig();
    const lsByCode = new Map(cfg.classes.filter((c) => !c.system && c.lsValue).map((c) => [c.code, c.lsValue]));
    // legacy-коды тоже маппим на актуальные метки
    for (const [oldCode, newCode] of Object.entries(LEGACY_ALIASES)) {
      const v = lsByCode.get(newCode);
      if (v) lsByCode.set(oldCode, v);
    }

    const qb = this.elementsRepo
      .createQueryBuilder('e')
      .where('e.status IN (:...st)', { st: ['confirmed', 'corrected'] });
    if (from) qb.andWhere('e.updatedAt >= :from', { from: new Date(from) });
    if (to) qb.andWhere('e.updatedAt <= :to', { to: new Date(to + 'T23:59:59') });
    const elements = await qb.getMany();
    const exportable = elements.filter((e) => lsByCode.has(e.klass));

    const pageIds = [...new Set(exportable.map((e) => e.page_id))];
    const pages = pageIds.length
      ? await this.pagesRepo.find({ where: { id: In(pageIds), hidden: false } })
      : [];
    const pageById = new Map(pages.filter((p) => p.image_file && p.width).map((p) => [p.id, p]));

    const origin = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const tasks: any[] = [];
    for (const p of pageById.values()) {
      const els = exportable.filter((e) => e.page_id === p.id);
      if (!els.length) continue;
      tasks.push({
        data: { image: `${origin}/api/uploads/${p.image_file}` },
        annotations: [{
          result: [
            {
              type: 'choices',
              from_name: 'schema_type',
              to_name: 'image',
              value: { choices: [p.schema_type || 'single_line'] },
            },
            ...els.map((e) => ({
              id: `el-${e.id}`,
              type: 'rectanglelabels',
              from_name: 'label',
              to_name: 'image',
              original_width: p.width,
              original_height: p.height,
              image_rotation: 0,
              value: {
                x: e.bbox.x * 100,
                y: e.bbox.y * 100,
                width: e.bbox.w * 100,
                height: e.bbox.h * 100,
                rotation: 0,
                rectanglelabels: [lsByCode.get(e.klass)],
              },
            })),
          ],
        }],
      });
    }
    return {
      exported_pages: tasks.length,
      exported_elements: exportable.filter((e) => pageById.has(e.page_id)).length,
      skipped_system_elements: elements.length - exportable.length,
      tasks,
    };
  }

  // ── Владение ──────────────────────────────────────────────────

  private clampZone(z: Bbox): Bbox {
    const x = Math.max(0, Math.min(1, Number(z?.x) || 0));
    const y = Math.max(0, Math.min(1, Number(z?.y) || 0));
    return {
      x, y,
      w: Math.max(0.001, Math.min(1 - x, Number(z?.w) || 0)),
      h: Math.max(0.001, Math.min(1 - y, Number(z?.h) || 0)),
    };
  }

  private async checkDocOwner(id: number, userId: number) {
    const doc = await this.docsRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Документ не найден');
    if (doc.owner_id !== userId) throw new ForbiddenException('Нет доступа');
    return doc;
  }

  private async checkPageOwner(pageId: number, userId: number) {
    const page = await this.pagesRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    await this.checkDocOwner(page.document_id, userId);
    return page;
  }

  private async checkElementOwner(id: number, userId: number) {
    const el = await this.elementsRepo.findOne({ where: { id } });
    if (!el) throw new NotFoundException('Элемент не найден');
    await this.checkPageOwner(el.page_id, userId);
    return el;
  }
}
