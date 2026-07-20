import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  OnModuleInit,
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
import { RecognitionModelVersion } from './recognition-model.entity';
import { RecognitionShadowRun } from './recognition-shadow.entity';
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
import { yoloDetect, resetYoloSession, YoloBox } from './yolo';

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
/** Режим распознавания: llm | shadow | cascade | yolo */
const MODE_KEY = 'recognition_mode';
export const RECOGNITION_MODES = ['llm', 'shadow', 'cascade', 'yolo'] as const;

type Bbox = { x: number; y: number; w: number; h: number };

@Injectable()
export class RecognitionService implements OnModuleInit {
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
    @InjectRepository(RecognitionModelVersion) private modelsRepo: Repository<RecognitionModelVersion>,
    @InjectRepository(RecognitionShadowRun) private shadowRepo: Repository<RecognitionShadowRun>,
  ) {}

  isConfigured(): boolean {
    return !!(process.env.RECOGNITION_API_URL?.trim() && process.env.RECOGNITION_API_KEY?.trim());
  }

  /** Очередь рендера живёт в памяти процесса — рестарт backend (деплой)
   *  обрывал её, и документ навсегда застревал в «Готовим листы…».
   *  При старте дорисовываем всё недорендеренное. */
  async onModuleInit() {
    try {
      const stuck = await this.docsRepo.find({ where: { status: 'rendering' } });
      for (const doc of stuck) {
        const pages = await this.pagesRepo.find({
          where: { document_id: doc.id },
          order: { page_index: 'ASC' },
        });
        const pending = pages.filter((p) => !p.image_file);
        if (!pending.length) {
          await this.docsRepo.update(doc.id, { status: 'ready' });
          continue;
        }
        const src = doc.source_file ? join(UPLOAD_DIR, doc.source_file) : '';
        if (!src || !fs.existsSync(src)) {
          await this.docsRepo.update(doc.id, {
            status: 'error',
            error_message: 'Исходный файл не найден — загрузите документ заново',
          });
          continue;
        }
        this.logger.log(`Возобновляю рендер документа ${doc.id} («${doc.filename}»): страниц ${pending.length}`);
        this.enqueueRender(
          doc,
          src,
          /\.pdf$/i.test(doc.source_file),
          pending.map((p) => ({ pageId: p.id, fileNo: p.page_index })),
        );
      }
    } catch (e: any) {
      this.logger.warn(`Восстановление рендера не удалось: ${e?.message || e}`);
    }
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
    this.enqueueRender(doc, file.path, isPdf, pages.map((p, i) => ({ pageId: p.id, fileNo: i + 1 })));

    return this.getDocument(doc.id, userId);
  }

  /** Дозагрузка листов в существующий документ (кнопка «+ Добавить лист»). */
  async addPagesToDocument(docId: number, userId: number, file: Express.Multer.File) {
    const doc = await this.checkDocOwner(docId, userId);
    const isPdf = /pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname);
    const isImage = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
    if (!isPdf && !isImage) {
      try { fs.unlinkSync(file.path); } catch {}
      throw new BadRequestException('Поддерживаются PDF, PNG и JPG');
    }

    let addCount = 1;
    if (isPdf) {
      try {
        const { stdout } = await execFileAsync('pdfinfo', [file.path], { timeout: 30_000 });
        const m = stdout.match(/^Pages:\s+(\d+)/m);
        addCount = m ? parseInt(m[1], 10) : 1;
      } catch {
        try { fs.unlinkSync(file.path); } catch {}
        throw new BadRequestException('Не удалось прочитать PDF (файл повреждён?)');
      }
    }
    const existingCount = await this.pagesRepo.count({ where: { document_id: doc.id } });
    if (existingCount + addCount > MAX_PAGES) {
      try { fs.unlinkSync(file.path); } catch {}
      throw new BadRequestException(`В документе уже ${existingCount} страниц — максимум ${MAX_PAGES}`);
    }
    const maxRow = await this.pagesRepo
      .createQueryBuilder('p')
      .select('COALESCE(MAX(p.page_index), 0)', 'max')
      .where('p.document_id = :id', { id: doc.id })
      .getRawOne();
    const startIndex = Number(maxRow?.max || 0) + 1;

    const pages = await this.pagesRepo.save(
      Array.from({ length: addCount }, (_, i) => ({
        document_id: doc.id,
        page_index: startIndex + i,
      })),
    );
    await this.docsRepo.update(doc.id, { page_count: existingCount + addCount, status: 'rendering' });
    this.enqueueRender(doc, file.path, isPdf, pages.map((p, i) => ({ pageId: p.id, fileNo: i + 1 })));
    return this.getDocument(doc.id, userId);
  }

  private enqueueRender(
    doc: RecognitionDocument,
    srcPath: string,
    isPdf: boolean,
    items: { pageId: number; fileNo: number }[],
  ) {
    this.renderChain = this.renderChain
      .then(() => this.renderPages(doc, srcPath, isPdf, items))
      .catch(async (e) => {
        this.logger.error(`Рендер документа ${doc.id} упал: ${e?.message || e}`);
        await this.docsRepo.update(doc.id, { status: 'error', error_message: 'Не удалось подготовить страницы' });
      });
  }

  private async renderPages(
    doc: RecognitionDocument,
    srcPath: string,
    isPdf: boolean,
    items: { pageId: number; fileNo: number }[],
  ) {
    // sharp подключаем лениво: до пересборки Docker-образа модуль может
    // отсутствовать — тогда падаем с понятной ошибкой, не роняя приложение.
    const sharp = require('sharp');
    for (const item of items) {
      // имя по id страницы — уникально и при дозагрузке листов
      const outName = `recog-${doc.id}-pg${item.pageId}.jpg`;
      const outPath = join(UPLOAD_DIR, outName);

      if (isPdf) {
        // pdftoppm добавляет к префиксу номер страницы с плавающим паддингом —
        // рендерим во временную папку и забираем единственный файл.
        const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'recog-'));
        try {
          await execFileAsync(
            'pdftoppm',
            ['-jpeg', '-jpegopt', 'quality=82', '-r', String(RENDER_DPI),
             '-f', String(item.fileNo), '-l', String(item.fileNo), srcPath, join(tmpDir, 'p')],
            { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
          );
          const made = fs.readdirSync(tmpDir).find((f) => f.endsWith('.jpg'));
          if (!made) throw new Error(`pdftoppm не создал страницу ${item.fileNo}`);
          fs.copyFileSync(join(tmpDir, made), outPath);
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        // Единственная картинка: нормализуем в JPEG (и выравниваем EXIF-поворот)
        await sharp(srcPath).rotate().jpeg({ quality: 88 }).toFile(outPath);
      }

      const meta = await sharp(outPath).metadata();
      await this.pagesRepo.update(item.pageId, {
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
    patch: { hidden?: boolean; confirmed?: boolean; schema_type?: string; title?: string },
  ) {
    const page = await this.checkPageOwner(pageId, userId);
    const safe: any = {};
    if (typeof patch.hidden === 'boolean') safe.hidden = patch.hidden;
    if (typeof patch.confirmed === 'boolean') safe.confirmed = patch.confirmed;
    if (patch.title != null) safe.title = String(patch.title).slice(0, 80).trim();
    if (patch.schema_type) {
      const cfg = await this.getClassConfig();
      if (cfg.schemaTypes.some((t) => t.value === patch.schema_type)) {
        safe.schema_type = patch.schema_type;
      }
    }
    await this.pagesRepo.update(page.id, safe);
    // Переименовали схему — лист спецификации принимает то же название
    if (safe.title !== undefined && page.sheet_id) {
      const name = safe.title || `Схема ${page.page_index}`;
      await this.sheetsRepo.update(page.sheet_id, { name });
    }
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
    const mode = await this.getMode();

    let found: Array<{
      klass: string; designation?: string; fields?: Record<string, string>;
      bbox: [number, number, number, number]; confidence?: number;
    }>;

    if (mode === 'yolo') {
      found = await this.runYolo(buf, cfg);
    } else if (mode === 'cascade') {
      found = await this.runCascade(buf, cfg);
    } else if (mode === 'shadow') {
      found = await this.runShadow(buf, cfg, page.id, z);
    } else {
      found = await this.callVisionModel(buf, cfg);
    }

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

  // ── Режимы распознавания ──────────────────────────────────────

  async getMode(): Promise<string> {
    try {
      const row = await this.settingsRepo.findOne({ where: { key: MODE_KEY } });
      const m = row?.value?.trim();
      return m && (RECOGNITION_MODES as readonly string[]).includes(m) ? m : 'llm';
    } catch { return 'llm'; }
  }

  async setMode(mode: string) {
    if (!(RECOGNITION_MODES as readonly string[]).includes(mode)) {
      throw new BadRequestException('Неизвестный режим распознавания');
    }
    if (mode !== 'llm') {
      const active = await this.modelsRepo.findOne({ where: { active: true } });
      if (!active) throw new BadRequestException('Сначала загрузите и активируйте модель YOLO');
    }
    await this.settingsRepo.save({ key: MODE_KEY, value: mode });
    return { mode };
  }

  private async activeModelPath(): Promise<string> {
    const active = await this.modelsRepo.findOne({ where: { active: true } });
    if (!active) throw new ServiceUnavailableException('Нет активной модели YOLO — загрузите её в панели «Модель»');
    return join(UPLOAD_DIR, active.filename);
  }

  /** YOLO: рамки + классы (category → код класса из конфига), без параметров. */
  private async runYolo(buf: Buffer, cfg: ClassConfig) {
    const modelPath = await this.activeModelPath();
    let boxes: YoloBox[];
    try {
      boxes = await yoloDetect(buf, modelPath);
    } catch (e: any) {
      this.logger.warn(`YOLO-инференс упал: ${e?.message || e}`);
      throw new ServiceUnavailableException('Модель YOLO не смогла обработать зону (см. логи сервера)');
    }
    const byCategory = new Map(cfg.classes.filter((c) => c.category != null).map((c) => [c.category, c.code]));
    return boxes.map((b) => ({
      klass: byCategory.get(b.classId) || 'other',
      designation: '',
      fields: {},
      bbox: [b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h] as [number, number, number, number],
      confidence: b.conf,
    }));
  }

  /** Каскад Максима: YOLO находит рамки и классы, LLM одним вызовом
   *  дочитывает обозначения и параметры по индексам рамок. */
  private async runCascade(buf: Buffer, cfg: ClassConfig) {
    const boxes = await this.runYolo(buf, cfg);
    if (!boxes.length) return boxes;
    if (!this.isConfigured()) return boxes; // LLM не настроен — отдаём хотя бы рамки

    const listing = boxes.map((b, i) =>
      `{"i":${i},"klass":"${b.klass}","bbox":[${b.bbox.map((v) => v.toFixed(4)).join(',')}]}`).join(',\n');
    const prompt = [
      'На изображении фрагмент электрической схемы российского проекта. Модель уже нашла элементы (рамки в долях изображения, [x,y,ширина,высота] от левого верхнего угла):',
      `[${listing}]`,
      '',
      'Для КАЖДОГО индекса i прочитай видимые НА СХЕМЕ подписи этого элемента и верни СТРОГО JSON без пояснений:',
      '{"params":[{"i":0,"designation":"QF1","fields":{"Тип":"ВА47-29","Полюса":"1P","Хар-ка":"C","Номинал, А":"16"}},…]}',
      'Ключи fields — русские, как в примере; для кабелей: "Марка", "Жилы×сечение", "Длина, м". Если подпись не видна — пропусти ключ; не выдумывай значения.',
    ].join('\n');

    try {
      const parsed = await this.callGeminiJson(buf, prompt);
      const params: any[] = Array.isArray(parsed?.params) ? parsed.params : [];
      for (const p of params) {
        const i = Number(p?.i);
        if (!Number.isInteger(i) || i < 0 || i >= boxes.length) continue;
        boxes[i].designation = String(p?.designation || '').slice(0, 60);
        boxes[i].fields = this.sanitizeFields(p?.fields);
      }
    } catch (e: any) {
      this.logger.warn(`Каскад: LLM не дочитала параметры (${e?.message || e}) — отдаём рамки без параметров`);
    }
    return boxes;
  }

  /** Теневой режим: пользователю — результат LLM; YOLO гоняется параллельно,
   *  итог пишется в recognition_shadow_runs для сравнения качества. */
  private async runShadow(buf: Buffer, cfg: ClassConfig, pageId: number, zone: Bbox) {
    const llmStart = Date.now();
    const llmPromise = this.callVisionModel(buf, cfg).then(
      (els) => ({ els, ms: Date.now() - llmStart, err: '' }),
    );
    const yoloStart = Date.now();
    const yoloPromise = this.runYolo(buf, cfg).then(
      (els) => ({ els, ms: Date.now() - yoloStart, err: '' }),
      (e: any) => ({ els: [] as any[], ms: Date.now() - yoloStart, err: String(e?.message || e).slice(0, 200) }),
    );
    const [llm, yolo] = await Promise.all([llmPromise, yoloPromise]);

    this.shadowRepo.save({
      page_id: pageId,
      zone,
      llm_count: llm.els.length,
      yolo_count: yolo.els.length,
      llm_ms: llm.ms,
      yolo_ms: yolo.ms,
      yolo_elements: yolo.els.map((e) => ({ klass: e.klass, confidence: e.confidence, bbox: e.bbox })),
      yolo_error: yolo.err,
    }).catch(() => { /* сравнение не должно ломать распознавание */ });

    return llm.els;
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

    const parsed = await this.callGeminiJson(imageJpeg, prompt);
    const list = Array.isArray(parsed) ? parsed : parsed?.elements;
    if (!Array.isArray(list)) {
      this.logger.warn(`Модель вернула неожиданный формат ответа`);
      throw new ServiceUnavailableException('Модель вернула неожиданный ответ — попробуйте зону поменьше');
    }
    return list.filter((el: any) => Array.isArray(el?.bbox) && el.bbox.length === 4);
  }

  /** Транспорт к Gemini: картинка + промпт → распарсенный JSON.
   *  Используется и основным LLM-распознаванием, и каскадом. */
  private async callGeminiJson(imageJpeg: Buffer, prompt: string): Promise<any> {
    const base = (process.env.RECOGNITION_API_URL || '').trim().replace(/\/+$/, '');
    const model = (process.env.RECOGNITION_MODEL || 'gemini-3-5-flash').trim();
    const url = `${base}/gemini/v1/models/${model}:streamGenerateContent`;

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
    return this.extractJson(text);
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
    // Товар каталога («Добавить из базы»): пустые строки очищают привязку
    for (const k of ['product_name', 'brand', 'article', 'etm_code', 'price'] as const) {
      if (patch[k] != null) safe[k] = String(patch[k]).slice(0, 300);
    }
    await this.elementsRepo.update(el.id, safe);
    return this.elementsRepo.findOne({ where: { id: el.id } });
  }

  async removeElement(id: number, userId: number) {
    const el = await this.checkElementOwner(id, userId);
    await this.elementsRepo.delete(el.id);
    return { success: true };
  }

  // ── Создание/синхронизация листа спецификации ─────────────────

  /** Собирает лист ИНДЕКСАЛЛ из подтверждённых элементов ОДНОЙ схемы.
   *  Первый вызов создаёт лист (папка «Распознавание») с названием схемы,
   *  повторные — обновляют его же: строки распознавания (custom._recog)
   *  пересобираются, строки, добавленные пользователем руками, не трогаем.
   *  Элемент с привязанным товаром каталога даёт товарную строку
   *  (name/brand/article/etm_code/price) — цены ЭТМ тянутся штатно. */
  async createSheetFromPage(pageId: number, userId: number) {
    const page = await this.checkPageOwner(pageId, userId);
    const doc = await this.docsRepo.findOne({ where: { id: page.document_id } });
    const allElements = await this.elementsRepo.find({ where: { page_id: page.id } });
    const usable = allElements.filter(
      (e) => (e.status === 'confirmed' || e.status === 'corrected') &&
        (e.product_name || (e.klass !== 'load' && e.klass !== 'other')),
    );
    if (!usable.length) {
      throw new BadRequestException('На этой схеме нет подтверждённых элементов — подтвердите рамки (кнопка «Подтвердить»)');
    }

    // Группировка одинаковых позиций (+ id рамок, из которых строка собрана)
    const cfg = await this.getClassConfig();
    type Acc = {
      name: string; brand: string; article: string; etm_code: string; price: string;
      qty: number; unit: string; ids: number[];
    };
    const acc = new Map<string, Acc>();
    for (const el of usable) {
      const f = el.fields || {};
      const lenRaw = parseFloat(String(f['Длина, м'] || '').replace(',', '.'));
      const isCable = el.klass === 'cable';
      let key: string;
      let base: Omit<Acc, 'qty' | 'ids'>;
      if (el.product_name) {
        key = `tovar:${el.article || el.product_name}`;
        base = {
          name: el.product_name, brand: el.brand || '', article: el.article || '',
          etm_code: el.etm_code || '', price: el.price || '0',
          unit: isCable ? 'м' : 'шт',
        };
      } else if (isCable) {
        const name = `Кабель ${f['Марка'] || ''} ${f['Жилы×сечение'] || ''}`.replace(/\s+/g, ' ').trim();
        key = name;
        base = { name, brand: '', article: '', etm_code: '', price: '0', unit: 'м' };
      } else {
        const name = this.deviceRowName(el.klass, f, cfg);
        key = name;
        base = { name, brand: '', article: '', etm_code: '', price: '0', unit: 'шт' };
      }
      const cur = acc.get(key) || { ...base, qty: 0, ids: [] };
      cur.qty += isCable ? (lenRaw > 0 ? lenRaw : 0) : 1;
      cur.ids.push(el.id);
      acc.set(key, cur);
    }

    // Существующий связанный лист (если не удалён)
    let sheet = page.sheet_id
      ? await this.sheetsRepo.findOne({ where: { id: page.sheet_id, owner_id: userId } })
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
      const docBase = (doc?.filename || 'Схема').replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
      const name = page.title || `${docBase} — Схема ${page.page_index}`;
      sheet = await this.sheetsRepo.save({
        folder_id: folder.id,
        owner_id: userId,
        name,
      });
      await this.pagesRepo.update(page.id, { sheet_id: sheet.id });
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
          brand: g.brand || row.brand,
          article: g.article || row.article,
          etm_code: g.etm_code || row.etm_code,
          ...(g.price !== '0' && (!row.price || row.price === '0') ? { price: g.price } : {}),
          custom: { ...(row.custom || {}), _recog: recogMark },
        });
        oursByName.delete(g.name);
      } else {
        await this.rowsRepo.save({
          sheetId: sheet.id,
          sort_order: nextOrder++,
          name: g.name,
          brand: g.brand,
          article: g.article,
          etm_code: g.etm_code,
          qty,
          unit: g.unit,
          price: g.price,
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
      const pages = await this.pagesRepo.find({ where: { sheet_id: sheetId } });
      if (!pages.length) return;
      const presentIds = new Set<number>();
      for (const r of rows || []) {
        const mark = r?.custom?.['_recog'];
        if (!mark) continue;
        try { (JSON.parse(String(mark)) as number[]).forEach((id) => presentIds.add(Number(id))); } catch {}
      }
      const linked = await this.elementsRepo.find({
        where: { page_id: In(pages.map((p) => p.id)), in_sheet: true },
      });
      // Проверенную экспертом разметку (verified) не понижаем — только отвязываем
      const removed = linked.filter((e) => !presentIds.has(e.id));
      const demote = removed.filter((e) => !e.verified);
      const detach = removed.filter((e) => e.verified);
      if (demote.length) {
        await this.elementsRepo.update(
          { id: In(demote.map((e) => e.id)) },
          { in_sheet: false, status: 'auto' },
        );
      }
      if (detach.length) {
        await this.elementsRepo.update(
          { id: In(detach.map((e) => e.id)) },
          { in_sheet: false },
        );
      }
    } catch (e: any) {
      this.logger.warn(`Обратная синхронизация листа ${sheetId} не удалась: ${e?.message || e}`);
    }
  }

  /** Лист удалён целиком — отвязываем схему (разметку не трогаем). */
  async onSheetRemoved(sheetId: number) {
    try {
      await this.pagesRepo.update({ sheet_id: sheetId }, { sheet_id: null });
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

  /** ZIP-архив, готовый и для Label Studio, и для обучения ultralytics:
   *  images/ + labels/ (YOLO txt по category) + classes.txt + data.yaml
   *  + labelstudio.json. */
  async exportDatasetZip(from?: string, to?: string): Promise<{ archive: any; filename: string }> {
    const cfg = await this.getClassConfig();
    const ls = await this.exportDataset(from, to);

    // category → строка names; code — латинский слаг, удобен ultralytics
    const catToClass = new Map<number, RecognitionClass>();
    for (const c of cfg.classes) {
      if (c.category != null && !catToClass.has(c.category)) catToClass.set(c.category, c);
    }
    const maxCat = Math.max(-1, ...catToClass.keys());
    const names: string[] = [];
    for (let i = 0; i <= maxCat; i++) names.push(catToClass.get(i)?.code || `unused_${i}`);

    const lsValueToCat = new Map<string, number>();
    for (const [cat, c] of catToClass) lsValueToCat.set(c.lsValue, cat);

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (e: any) => this.logger.warn(`zip: ${e?.message || e}`));

    for (const task of ls.tasks) {
      const imageUrl: string = task?.data?.image || '';
      const fileName = imageUrl.split('/').pop() || '';
      const imgPath = join(UPLOAD_DIR, fileName);
      if (!fileName || !fs.existsSync(imgPath)) continue;
      archive.file(imgPath, { name: `images/${fileName}` });

      const lines: string[] = [];
      for (const r of task.annotations?.[0]?.result || []) {
        if (r?.type !== 'rectanglelabels') continue;
        const label = r?.value?.rectanglelabels?.[0];
        const cat = lsValueToCat.get(label);
        if (cat == null) continue;
        // LS: проценты левого верхнего угла → YOLO: доли центра
        const x = Number(r.value.x) / 100;
        const y = Number(r.value.y) / 100;
        const w = Number(r.value.width) / 100;
        const h = Number(r.value.height) / 100;
        lines.push(`${cat} ${(x + w / 2).toFixed(6)} ${(y + h / 2).toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
      }
      const base = fileName.replace(/\.[a-z0-9]+$/i, '');
      archive.append(lines.join('\n') + (lines.length ? '\n' : ''), { name: `labels/${base}.txt` });
    }

    archive.append(names.join('\n') + '\n', { name: 'classes.txt' });
    const yaml = [
      '# INDEXALL — датасет распознавания схем (сгенерирован автоматически)',
      'path: .',
      'train: images',
      'val: images',
      `nc: ${names.length}`,
      'names:',
      ...names.map((n, i) => `  ${i}: ${n}`),
      '',
    ].join('\n');
    archive.append(yaml, { name: 'data.yaml' });
    archive.append(JSON.stringify(ls.tasks, null, 2), { name: 'labelstudio.json' });

    const stamp = new Date().toISOString().slice(0, 10);
    return { archive, filename: `indexall-dataset-${stamp}.zip` };
  }

  /** Импорт проверенной разметки из Label Studio (эталон от Максима).
   *  Страница ищется по имени файла в data.image; рамки матчатся с нашими
   *  по IoU ≥ 0.5 (сначала в том же классе, потом в любом). */
  async importLsAnnotations(userId: number, jsonText: string) {
    const cfg = await this.getClassConfig();
    const byLsValue = new Map(cfg.classes.filter((c) => c.lsValue).map((c) => [c.lsValue, c.code]));

    let tasks: any[];
    try {
      const parsed = JSON.parse(jsonText);
      tasks = Array.isArray(parsed) ? parsed : parsed?.tasks;
    } catch {
      throw new BadRequestException('Файл не читается как JSON');
    }
    if (!Array.isArray(tasks)) throw new BadRequestException('Не похоже на экспорт Label Studio (нет списка задач)');

    const stats = { pages: 0, pages_not_found: 0, updated: 0, created: 0, demoted: 0 };

    for (const task of tasks) {
      const imageUrl = String(task?.data?.image || '');
      const fileName = decodeURIComponent(imageUrl.split('/').pop() || '').replace(/\?.*$/, '');
      if (!fileName) { stats.pages_not_found++; continue; }
      const page = await this.pagesRepo.findOne({ where: { image_file: fileName } });
      if (!page) { stats.pages_not_found++; continue; }
      const doc = await this.docsRepo.findOne({ where: { id: page.document_id } });
      if (!doc || doc.owner_id !== userId) { stats.pages_not_found++; continue; }

      // Разметка из файла (annotations приоритетнее predictions)
      const results = (task?.annotations?.[0]?.result || []).filter((r: any) => r?.type === 'rectanglelabels');
      const incoming = results.map((r: any) => ({
        klass: byLsValue.get(r?.value?.rectanglelabels?.[0]) || 'other',
        bbox: {
          x: Math.max(0, Number(r.value.x) / 100),
          y: Math.max(0, Number(r.value.y) / 100),
          w: Math.max(0.001, Number(r.value.width) / 100),
          h: Math.max(0.001, Number(r.value.height) / 100),
        },
      })).filter((r: any) => r.bbox.w > 0 && r.bbox.h > 0);

      const existing = await this.elementsRepo.find({ where: { page_id: page.id } });
      const matchedExisting = new Set<number>();

      for (const inc of incoming) {
        // 1) лучший IoU среди того же класса, 2) среди любых
        let best: RecognitionElement | null = null;
        let bestIou = 0.5;
        for (const pass of [1, 2] as const) {
          for (const el of existing) {
            if (matchedExisting.has(el.id)) continue;
            if (pass === 1 && el.klass !== inc.klass) continue;
            const i = this.iouBbox(el.bbox, inc.bbox);
            if (i >= bestIou) { best = el; bestIou = i; }
          }
          if (best) break;
        }
        if (best) {
          matchedExisting.add(best.id);
          await this.elementsRepo.update(best.id, {
            klass: inc.klass,
            bbox: inc.bbox,
            status: 'corrected',
            verified: true,
            confidence: 1,
          });
          stats.updated++;
        } else {
          await this.elementsRepo.save({
            page_id: page.id,
            klass: inc.klass,
            designation: '',
            fields: {},
            bbox: inc.bbox,
            confidence: 1,
            status: 'corrected',
            verified: true,
          });
          stats.created++;
        }
      }

      // Наши подтверждённые, которых нет в проверенном файле — Максим их отверг
      for (const el of existing) {
        if (matchedExisting.has(el.id)) continue;
        if (el.status === 'confirmed' || el.status === 'corrected') {
          await this.elementsRepo.update(el.id, { status: 'auto', verified: false, in_sheet: false });
          stats.demoted++;
        }
      }
      stats.pages++;
    }
    return stats;
  }

  private iouBbox(a: Bbox, b: Bbox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  // ── Версии модели YOLO ────────────────────────────────────────

  async listModels() {
    const models = await this.modelsRepo.find({ order: { id: 'DESC' } });
    const shadowRuns = await this.shadowRepo.find({ order: { id: 'DESC' }, take: 20 });
    return {
      models,
      activeId: models.find((m) => m.active)?.id || null,
      mode: await this.getMode(),
      shadowRuns,
    };
  }

  async uploadModel(file: Express.Multer.File, note: string) {
    if (!/\.onnx$/i.test(file.originalname)) {
      try { fs.unlinkSync(file.path); } catch {}
      throw new BadRequestException('Нужен файл .onnx (экспорт ultralytics: model.export(format="onnx"))');
    }
    const version = await this.modelsRepo.save({
      filename: file.filename,
      orig_name: fixFileName(file.originalname),
      note: String(note || '').slice(0, 200),
      active: false,
    });
    return version;
  }

  async activateModel(id: number) {
    const model = await this.modelsRepo.findOne({ where: { id } });
    if (!model) throw new NotFoundException('Версия модели не найдена');
    if (!fs.existsSync(join(UPLOAD_DIR, model.filename))) {
      throw new BadRequestException('Файл модели отсутствует на диске — загрузите заново');
    }
    // update с пустым criteria TypeORM запрещает — через QueryBuilder
    await this.modelsRepo.createQueryBuilder().update().set({ active: false }).execute();
    await this.modelsRepo.update(id, { active: true });
    resetYoloSession();
    return this.listModels();
  }

  async deleteModel(id: number) {
    const model = await this.modelsRepo.findOne({ where: { id } });
    if (!model) throw new NotFoundException('Версия модели не найдена');
    if (model.active) throw new BadRequestException('Нельзя удалить активную версию — сначала активируйте другую');
    try { fs.unlinkSync(join(UPLOAD_DIR, model.filename)); } catch {}
    await this.modelsRepo.delete(id);
    return { success: true };
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
