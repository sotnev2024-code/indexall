'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import SectionOnboarding from '@/components/SectionOnboarding';
import {
  authApi, catalogApi, recognitionApi, storesApi,
  RecogClass, RecogClassConfig, RecogDocument, RecogElement, RecogPage,
} from '@/lib/api';

/* ── Классы оборудования ──
 * Таксономия динамическая: приходит с бэка из конфига Label Studio Максима
 * (обновляется без деплоя). DEFAULT_CFG — запасной минимум до загрузки. */
const DEFAULT_CFG: RecogClassConfig = {
  classes: [
    { code: 'mcb', lsValue: 'MCB — модульный автомат', nameRu: 'модульный автомат', category: 0, color: '#E74C3C' },
    { code: 'cable', lsValue: '', nameRu: 'Кабель / провод', category: null, color: '#1d4ed8', system: true },
    { code: 'load', lsValue: '', nameRu: 'Электроприёмник', category: null, color: '#be185d', system: true },
    { code: 'other', lsValue: '', nameRu: 'Прочее', category: null, color: '#64748b', system: true },
  ],
  schemaTypes: [
    { value: 'single_line', nameRu: 'Однолинейная схема' },
    { value: 'schematic', nameRu: 'Принципиальная схема' },
    { value: 'wiring', nameRu: 'Монтажная схема' },
  ],
};

const FUN_PHRASES = [
  'Нейросеть в шоке…',
  'Нейросеть усиленно работает…',
  'Ещё немного усилий…',
  'Ну почти получилось…',
  'Ща-ща…',
];

/** Допустимые значения параметров — редактирование выпадающим списком
 *  вместо свободного текста (просьба Максима). Ключи совпадают с полями,
 *  которые заполняют LLM и пикер каталога. */
const PARAM_OPTIONS: Record<string, string[]> = {
  'Полюса': ['1P', '1P+N', '2P', '3P', '3P+N', '4P'],
  'Хар-ка': ['B', 'C', 'D', 'K', 'Z'],
  'Номинал, А': ['0,5', '1', '1,6', '2', '3', '4', '5', '6', '8', '10', '13', '16', '20', '25', '32', '40',
    '50', '63', '80', '100', '125', '160', '200', '250', '315', '400', '500', '630'],
  'Утечка, мА': ['10', '30', '100', '300', '500'],
  'Тип расцепителя': ['AC', 'A', 'B', 'F', 'S'],
  'Откл. способность, кА': ['4,5', '6', '10', '15', '20', '25', '36', '50'],
  'Катушка, В': ['12', '24', '110', '230', '400'],
  'Марка': ['ВВГнг(А)-LS', 'ВВГнг(А)-FRLS', 'ВВГнг(А)-LSLTx', 'ПвПГнг(А)-FRHF', 'ПуГВ', 'ПуВ', 'КГтп-ХЛ'],
  'Жилы×сечение': ['2×1,5', '3×1,5', '3×2,5', '3×4', '3×6', '4×2,5', '4×4', '5×2,5', '5×4', '5×6',
    '5×10', '5×16', '5×25', '5×35', '5×50'],
};
/** Значение-переключатель на ручной ввод */
const CUSTOM_OPT = '__custom__';

/** Набор параметров, закреплённый за типом оборудования (замечание 6:
 *  «определяется тип и к нему сразу идёт набор параметров»). Список полей
 *  в инспекторе задаётся ТОЛЬКО этой таблицей — руками параметры не
 *  добавляются и не удаляются.
 *
 *  Ключи — коды классов из конфига Label Studio Максима (он их обновляет
 *  без деплоя), поэтому таблица переживает переименования: для класса,
 *  которого здесь нет, берётся DEFAULT_PARAM_SET. Старые коды (mcb/mccb/
 *  acb — до объединения в circuit_breaker) оставлены намеренно: в базе
 *  есть рамки, размеченные ещё ими. */
const PARAM_SETS: Record<string, string[]> = {
  // аппараты защиты
  circuit_breaker: ['Тип', 'Полюса', 'Хар-ка', 'Номинал, А', 'Откл. способность, кА'],
  mcb: ['Тип', 'Полюса', 'Хар-ка', 'Номинал, А', 'Откл. способность, кА'],
  mccb: ['Тип', 'Полюса', 'Номинал, А', 'Откл. способность, кА'],
  acb: ['Тип', 'Полюса', 'Номинал, А', 'Откл. способность, кА'],
  rcbo: ['Тип', 'Полюса', 'Хар-ка', 'Номинал, А', 'Утечка, мА', 'Тип расцепителя'],
  rccb: ['Тип', 'Полюса', 'Номинал, А', 'Утечка, мА', 'Тип расцепителя'],
  rcd: ['Тип', 'Полюса', 'Номинал, А', 'Утечка, мА', 'Тип расцепителя'],
  afdd: ['Тип', 'Полюса', 'Номинал, А'],
  spd: ['Тип', 'Класс защиты', 'Полюса'],
  fuse: ['Тип', 'Номинал, А'],
  fuse_link: ['Тип', 'Номинал, А'],
  fuse_switch_disconnector: ['Тип', 'Полюса', 'Номинал, А'],
  // коммутация
  disconnector: ['Тип', 'Полюса', 'Номинал, А'],
  lbs: ['Тип', 'Полюса', 'Номинал, А'],
  switch: ['Тип', 'Полюса'],
  contactor: ['Тип', 'Номинал, А', 'Катушка, В'],
  contactor_coil: ['Тип', 'Катушка, В'],
  contactor_contact: ['Тип'],
  relay: ['Тип', 'Катушка, В'],
  relay_contact: ['Тип'],
  ats: ['Тип', 'Номинал, А'],
  // измерение и учёт
  ct: ['Тип', 'Коэффициент трансформации'],
  electricity_meter: ['Тип', 'Номинал, А', 'Класс точности'],
  ammeter: ['Тип', 'Предел измерения'],
  voltmeter: ['Тип', 'Предел измерения'],
  multimeter: ['Тип', 'Предел измерения'],
  // управление и вспомогательное
  button: ['Тип', 'Цвет'],
  pushbutton_no_momentary: ['Тип', 'Цвет'],
  pushbutton_nc_momentary: ['Тип', 'Цвет'],
  pushbutton_no_latching: ['Тип', 'Цвет'],
  pushbutton_nc_latching: ['Тип', 'Цвет'],
  lamp: ['Тип', 'Цвет', 'Напряжение, В'],
  power_supply: ['Тип', 'Напряжение, В', 'Мощность, Вт'],
  controller: ['Тип'],
  resistor: ['Тип', 'Сопротивление, Ом'],
  terminal: ['Тип', 'Сечение, мм²'],
  fused_terminal: ['Тип', 'Сечение, мм²', 'Номинал, А'],
  motor_drive: ['Тип', 'Мощность, кВт', 'Номинал, А'],
  // системные классы (лист спецификации)
  cable: ['Марка', 'Жилы×сечение', 'Длина, м'],
  load: ['Наименование', 'Помещение', 'Мощность, кВт'],
  panel: ['Тип', 'Наименование', 'Исполнение IP'],
  busbar: ['Тип', 'Номинал, А'],
  other: ['Тип'],
};
/** Класса нет в таблице (Максим добавил новый в конфиг) — показываем базовый набор */
const DEFAULT_PARAM_SET = ['Тип'];

/** Поля инспектора для класса: закреплённый набор + уже заполненные
 *  параметры вне набора (пришли от ИИ или из карточки товара) — их не
 *  прячем, чтобы распознанное не пропадало, но и добавить руками нельзя. */
function paramKeysFor(klass: string, fields: Record<string, string>): string[] {
  const base = PARAM_SETS[klass] || DEFAULT_PARAM_SET;
  const extra = Object.keys(fields).filter((k) => !base.includes(k) && String(fields[k] ?? '').trim() !== '');
  return [...base, ...extra];
}

/** Нижний предел размера рамки — в ПИКСЕЛЯХ листа, а не в долях.
 *  Доля даёт тем более крупную рамку, чем больше лист: прежние 0,004
 *  на чертеже 6600 px — это 26 px, поэтому на больших листах рамка
 *  «упиралась» и оставалась визуально большой (замечания 2 и 3). */
const MIN_BOX_PX = 4;

/* Цвета рамок по состоянию (правка Максима 17.08): три цвета вместо цвета
   класса — на плотных схемах класс всё равно не считывался, а состояние
   видно сразу. Порог низкой уверенности он задал сам. */
const FRAME_AUTO = '#f5c800';      // распознано
const FRAME_CONFIRMED = '#1e7e34'; // подтверждено
const FRAME_LOW = '#8f9aa6';       // уверенность ниже порога
const LOW_CONF = 0.7;

/* 15 популярных цветов рамок (пункт 7) */
const SWATCHES = [
  '#E74C3C', '#D35400', '#F39C12', '#F1C40F', '#2ECC71',
  '#16A085', '#1ABC9C', '#3498DB', '#2E86C1', '#5B6EE1',
  '#9B59B6', '#E84393', '#BE185D', '#8D6E63', '#7F8C8D',
];

/* Мелкие SVG-иконки в стиле проекта (без эмодзи) */
const Icon = {
  check: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" /></svg>),
  cross: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
  pencil: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>),
  plus: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>),
  back: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="15 18 9 12 15 6" /></svg>),
  expand: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>),
  compress: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>),
  up: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="18 15 12 9 6 15" /></svg>),
  trash: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>),
  restore: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /></svg>),
};

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
const imgUrl = (p: RecogPage) => (p.image_url ? `${API_ORIGIN}${p.image_url}` : '');
const pageTitle = (p: RecogPage) => p.title || `Схема ${p.page_index}`;

type Zone = { x: number; y: number; w: number; h: number };
/** pan — перемещение; detect — обвести область для ИИ; manual — обвести элемент вручную */
type Mode = 'pan' | 'detect' | 'manual';
type PickedProduct = {
  product_name: string; brand: string; article: string; etm_code: string; price: string;
  /** параметры из атрибутов товара — заполняют поля инспектора */
  fields?: Record<string, string>;
  /** класс оборудования из базы (появится после доработок Максима) */
  product_class?: string;
};

/** ширина плавающего окна элемента с раскрытой колонкой каталога */
const INSP_W_CAT = 1130;

export default function RecognitionPage() {
  const router = useRouter();
  /* null — ещё грузится; [] — пусто */
  const [docs, setDocs] = useState<any[] | null>(null);
  const [docsError, setDocsError] = useState(false);
  /** отбор в списке документов: имён «image.png» накопились десятки */
  const [docQuery, setDocQuery] = useState('');
  /** показывать ли распознанный OCR текст синими рамками на схеме */
  const [showTexts, setShowTexts] = useState(true);
  const [clsCfg, setClsCfg] = useState<RecogClassConfig>(DEFAULT_CFG);
  /** класс схемы → категории каталога: по ним инспектор строит поля из базы */
  const [catalogMap, setCatalogMap] = useState<Record<string, string[]>>({});
  const [catalogTiles, setCatalogTiles] = useState<any[]>([]);
  const [doc, setDoc] = useState<RecogDocument | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('pan');
  const [detecting, setDetecting] = useState(false);
  const [phrase, setPhrase] = useState(FUN_PHRASES[0]);
  const [uploading, setUploading] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [specTab, setSpecTab] = useState<number | null>(null);
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [configured, setConfigured] = useState(true);
  /** активный режим распознавания (llm/shadow/cascade/yolo) — для бейджа в тулбаре */
  const [recogMode, setRecogMode] = useState('llm');
  const [pickerElId, setPickerElId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const workRef = useRef<HTMLDivElement>(null);

  /* пан/зум */
  const [view, setView] = useState({ x: 40, y: 40, z: 0.5 });
  const viewRef = useRef(view); viewRef.current = view;
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<any>(null);
  const [zoneDraft, setZoneDraft] = useState<Zone | null>(null);
  /* зеркало выделяемой зоны: обработчик отпускания может прийти из
     window-страховки, где значение из замыкания уже устарело */
  const zoneDraftRef = useRef<Zone | null>(null); zoneDraftRef.current = zoneDraft;
  const lastDownRef = useRef({ t: 0, x: 0, y: 0 });
  /** буфер копирования рамки (Ctrl+C → Ctrl+V) */
  const clipRef = useRef<RecogElement | null>(null);
  /** сколько раз вставляли из буфера — чтобы копии ложились ступенькой */
  const pasteNRef = useRef(0);
  /** отмена текущего распознавания по Esc */
  const detectAbortRef = useRef<AbortController | null>(null);

  const loadDocs = useCallback(() => {
    recognitionApi.list()
      .then(({ data: d }) => { setDocs(Array.isArray(d) ? d : []); setDocsError(false); })
      .catch((e) => {
        console.error('recognition: список документов не загрузился', e);
        setDocsError(true);
        const code = e?.response?.status;
        toast.error(code
          ? `Список документов не загрузился (ошибка ${code})`
          : 'Сервер не отвечает — список документов не загрузился');
      });
  }, []);

  const reloadDoc = useCallback(async (id: number) => {
    const { data } = await recognitionApi.getOne(id);
    setDoc(data);
    return data;
  }, []);

  /* ── загрузка данных (раздел пока только для администратора) ── */
  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.push('/auth/login');
      return;
    }
    authApi.me()
      .then(({ data }) => {
        // Обкатка: доступ всем администраторам (синхронно с AdminGuard на бэке)
        if (data?.plan !== 'admin') {
          router.replace('/projects');
          return;
        }
        loadDocs();
        recognitionApi.status().then(({ data: d }) => setConfigured(d.configured)).catch(() => {});
        recognitionApi.getClasses().then(({ data: d }) => { if (d?.classes?.length) setClsCfg(d); }).catch(() => {});
        recognitionApi.getCatalogMap().then(({ data: d }) => { if (d) setCatalogMap(d); }).catch(() => {});
        catalogApi.getTiles().then(({ data: d }) => setCatalogTiles(Array.isArray(d) ? d : (d?.tiles || []))).catch(() => {});
        recognitionApi.listModels().then(({ data: d }) => { if (d?.mode) setRecogMode(d.mode); }).catch(() => {});
        // Приоритет: ?doc=&page= (переход с листа спецификации), иначе —
        // восстановление после F5 из sessionStorage.
        // Читаем из location, а не через useSearchParams: тот в Next 14
        // требует Suspense и роняет страницу («client-side exception»).
        const sp = new URLSearchParams(window.location.search);
        const qDoc = Number(sp.get('doc'));
        const qPage = Number(sp.get('page'));
        if (qDoc) {
          reloadDoc(qDoc)
            .then(() => { if (qPage) setPageId(qPage); })
            .catch(() => toast.error('Схема не найдена'));
          return;
        }
        try {
          const saved = JSON.parse(localStorage.getItem('recogState') || 'null');
          if (saved?.docId) {
            reloadDoc(saved.docId)
              .then(() => { if (saved.pageId) setPageId(saved.pageId); })
              .catch(() => localStorage.removeItem('recogState'));
          }
        } catch { /* повреждённое состояние — игнорируем */ }
      })
      .catch(() => router.replace('/projects'));
  }, [router, loadDocs, reloadDoc]);

  /* Запоминаем открытый документ и лист, чтобы вернуться к ним после листа
     спецификации и после F5 (жалоба Максима 19.08: «как вернуться к проекту
     с распознанными схемами — непонятно»).
     ВАЖНО: пустое значение здесь НЕ стираем. Раньше стирали — и при загрузке
     страницы этот эффект успевал сработать с doc === null раньше, чем
     асинхронное восстановление читало сохранённое, так что возврат не работал
     никогда. Состояние очищается только кнопкой «Все документы».
     localStorage, а не sessionStorage: спецификацию открывают и в новой
     вкладке, там сеансовое хранилище пустое. */
  useEffect(() => {
    try {
      if (doc) localStorage.setItem('recogState', JSON.stringify({ docId: doc.id, pageId }));
    } catch { /* приватный режим и т.п. */ }
  }, [doc?.id, pageId]);

  /* динамическая таксономия: код класса → карточка */
  /** документы после отбора по строке поиска (имя или владелец) */
  const visibleDocs = useMemo(() => {
    const q = docQuery.trim().toLowerCase();
    const list = docs || [];
    if (!q) return list;
    return list.filter((d: any) =>
      String(d.filename || '').toLowerCase().includes(q));
  }, [docs, docQuery]);

  const classByCode = useMemo(
    () => new Map<string, RecogClass>(clsCfg.classes.map((c) => [c.code, c])),
    [clsCfg],
  );
  /** Цвет рамки на схеме (правка Максима 17.08): состояние, а не класс —
   *  жёлтая после распознавания, зелёная после подтверждения, серая при
   *  низкой уверенности. Свой цвет, выбранный вручную, приоритетнее. */
  const frameColor = useCallback((el: Pick<RecogElement, 'color' | 'status' | 'confidence'>) => {
    if (el.color) return el.color;
    if (el.status !== 'auto') return FRAME_CONFIRMED;
    if (el.confidence > 0 && el.confidence < LOW_CONF) return FRAME_LOW;
    return FRAME_AUTO;
  }, []);
  const className = useCallback((code: string) =>
    classByCode.get(code)?.nameRu || code, [classByCode]);

  /* опрос, пока страницы рендерятся */
  useEffect(() => {
    if (!doc || doc.status !== 'rendering') return;
    const t = setInterval(() => reloadDoc(doc.id).catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [doc?.id, doc?.status, reloadDoc]);

  /* смешные фразы во время распознавания */
  useEffect(() => {
    if (!detecting) return;
    let i = 0;
    setPhrase(FUN_PHRASES[0]);
    const t = setInterval(() => { i = (i + 1) % FUN_PHRASES.length; setPhrase(FUN_PHRASES[i]); }, 2600);
    return () => clearInterval(t);
  }, [detecting]);

  const visiblePages = useMemo(() => (doc?.pages || []).filter((p) => !p.hidden), [doc]);
  const hiddenPages = useMemo(() => (doc?.pages || []).filter((p) => p.hidden), [doc]);

  /* полноэкранный режим рабочей области (пункт 8) */
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else workRef.current?.requestFullscreen?.().catch(() => toast.error('Полноэкранный режим недоступен в этом браузере'));
  };

  const page = useMemo(() => visiblePages.find((p) => p.id === pageId) || visiblePages[0] || null, [visiblePages, pageId]);
  const pageElements = useMemo(() => (doc?.elements || []).filter((e) => page && e.page_id === page.id), [doc, page]);
  const selEl = useMemo(() => pageElements.find((e) => e.id === selId) || null, [pageElements, selId]);
  /** Уникальные куски текста OCR со всех рамок листа: один кусок привязан к
   *  нескольким соседним элементам, а рисовать его нужно один раз. */
  const ocrBoxes = useMemo(() => {
    const seen = new Set<string>();
    const out: NonNullable<RecogElement['texts']> = [];
    for (const el of pageElements) {
      for (const t of el.texts || []) {
        const key = `${t.text}|${t.x.toFixed(4)}|${t.y.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  }, [pageElements]);
  /* зеркало выбранной рамки для обработчика горячих клавиш */
  const selElRef = useRef<RecogElement | null>(null); selElRef.current = selEl;

  /* ── плавающий инспектор: позиция и перетаскивание за шапку ── */
  const INSP_W = 420;
  const [inspPos, setInspPos] = useState({ x: 24, y: 70 });
  const inspRef = useRef<HTMLDivElement>(null);
  const inspDrag = useRef<{ dx: number; dy: number } | null>(null);
  const inspPinned = useRef(false); // пользователь двигал окно — не переставляем
  const inspWideRef = useRef(false); // открыт ли каталог внутри окна

  /* Окно параметров при выборе рамки (правка Максима 17.08): всегда справа и
     по центру по высоте, если там помещается — раньше оно вставало у самой
     рамки и на нижних элементах уходило за край, видно было только часть.
     Высоту меряем после отрисовки: состав полей зависит от типа элемента. */
  useEffect(() => {
    if (!selEl || inspPinned.current) return;
    const wrap = workRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const box = inspRef.current;
    const w = box?.offsetWidth || INSP_W;
    const h = box?.offsetHeight || 0;
    // не помещается справа (узкий экран) — прижимаем к левому краю
    const x = wrap.width - w - 16 >= 12 ? wrap.width - w - 16 : 12;
    const y = h > 0
      ? Math.max(12, Math.min(Math.round((wrap.height - h) / 2), wrap.height - h - 12))
      : 12;
    setInspPos((p) => (p.x === x && p.y === y ? p : { x, y }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selEl?.id, selEl?.klass, pickerElId]);

  /* каталог живёт внутри окна элемента — при переходе на другую рамку закрываем */
  useEffect(() => { setPickerElId(null); }, [selEl?.id]);
  inspWideRef.current = pickerElId != null;

  /* окно с каталогом втрое шире обычного: подвигаем его, чтобы целиком
     помещалось в рабочую область, иначе колонка товаров уедет за край */
  useEffect(() => {
    if (pickerElId == null) return;
    const wrap = workRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const w = Math.min(INSP_W_CAT, wrap.width - 24);
    setInspPos((p) => ({ x: Math.max(12, Math.min(p.x, wrap.width - w - 12)), y: 12 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerElId]);

  const startInspDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // крестик не тащит
    const wrap = workRef.current?.getBoundingClientRect();
    if (!wrap) return;
    inspDrag.current = { dx: e.clientX - wrap.left - inspPos.x, dy: e.clientY - wrap.top - inspPos.y };
    inspPinned.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = inspDrag.current;
      const wrap = workRef.current?.getBoundingClientRect();
      if (!d || !wrap) return;
      // с раскрытым каталогом окно широкое — держим его целиком в области
      const wide = inspWideRef.current;
      const maxX = wide
        ? Math.max(0, wrap.width - Math.min(INSP_W_CAT, wrap.width - 24) - 12)
        : wrap.width - 80;
      setInspPos({
        x: Math.max(0, Math.min(maxX, e.clientX - wrap.left - d.dx)),
        y: Math.max(0, Math.min(wide ? 12 : wrap.height - 40, e.clientY - wrap.top - d.dy)),
      });
    };
    const up = () => { inspDrag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  /* Горячие клавиши: Esc — остановить распознавание / выйти из режима,
     Ctrl+C / Ctrl+V — копия рамки, Delete — удалить рамку.
     ВАЖНО: объявлять после page/selEl — иначе обращение к ним в списке
     зависимостей падает с «Cannot access before initialization». */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

      if (e.key === 'Escape') {
        if (detectAbortRef.current) {           // идёт распознавание — отменяем
          detectAbortRef.current.abort();
          detectAbortRef.current = null;
          return;
        }
        if (inspWideRef.current) {              // раскрыт каталог — сворачиваем его
          setPickerElId(null);
          return;
        }
        setMode((m) => {
          if (m !== 'pan') return 'pan';
          setSelId(null);
          return m;
        });
        return;
      }
      if (typing) return;

      const el = selElRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && el) {
        e.preventDefault();
        clipRef.current = el;
        pasteNRef.current = 0;                  // ступенька вставки — с начала
        toast.success('Рамка скопирована — Ctrl+V создаст копию');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipRef.current) {
        e.preventDefault();
        pasteNRef.current += 1;
        duplicateElement(clipRef.current, undefined, pasteNRef.current);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && el) {
        e.preventDefault();
        deleteElement(el);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page]);

  /* вписать страницу в окно (кнопка на проценте зума) */
  const fitPage = useCallback((p?: RecogPage | null) => {
    const pg = p || page;
    const vp = vpRef.current;
    if (!pg || !vp || !pg.width) return;
    const r = vp.getBoundingClientRect();
    const z = Math.min((r.width - 60) / pg.width, (r.height - 60) / pg.height, 1.5);
    setView({ x: (r.width - pg.width * z) / 2, y: (r.height - pg.height * z) / 2, z });
  }, [page]);

  /* лист открывается на 100% с левого верхнего угла (просьба Максима) */
  const openAt100 = useCallback(() => {
    setView({ x: 24, y: 24, z: 1 });
  }, []);

  useEffect(() => { openAt100(); /* eslint-disable-next-line */ }, [page?.id, page?.width, isFs]);

  /* ── загрузка файла ── */
  const uploadFile = useCallback(async (file: File) => {
    if (uploading) return;
    setUploading(true);
    try {
      const { data } = await recognitionApi.upload(file);
      setDoc(data);
      setPageId(null);
      setSelId(null);
      loadDocs();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось загрузить файл');
    } finally {
      setUploading(false);
    }
  }, [uploading, loadDocs]);

  /* дозагрузка листов в открытый документ (пункт 1) */
  const addPagesFile = useCallback(async (file: File) => {
    if (!doc || uploading) return;
    setAddOpen(false);
    setUploading(true);
    try {
      const { data } = await recognitionApi.addPages(doc.id, file);
      setDoc(data);
      toast.success('Листы добавляются — рендер идёт в фоне');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось добавить листы');
    } finally {
      setUploading(false);
    }
  }, [doc, uploading]);

  /* Ctrl+V вставка картинки — только когда явно добавляем лист/документ:
     на стартовом экране или в открытой модалке «Добавить лист». Внутри
     работы со схемой Ctrl+V копирует рамку, а не создаёт лист. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (doc && !addOpen) return;
      const f = Array.from(e.clipboardData?.files || [])[0];
      if (!f || !/^(image\/|application\/pdf)/.test(f.type)) return;
      if (doc) addPagesFile(f);
      else uploadFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadFile, addPagesFile, doc, addOpen]);

  /* ── пан/зум/зона ── */
  const toPagePoint = (clientX: number, clientY: number) => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  };

  /* «режим руки»: колесо — прокрутка (Shift — вбок), зум — только Ctrl+колесо.
     Слушатель вешаем вручную с passive:false — React ставит wheel пассивным,
     из-за чего preventDefault не работал и Ctrl+колесо зумило весь сайт. */
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = vp.getBoundingClientRect();
        const k = Math.exp(-e.deltaY * 0.0013);
        const z = Math.max(0.05, Math.min(4, v.z * k));
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setView({ x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z, z });
      } else if (e.shiftKey) {
        setView({ ...v, x: v.x - (e.deltaY || e.deltaX) });
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [doc]);

  /* Страховка: ловим отпускание кнопки и на уровне окна. Если браузер
     всё же перехватит жест (нативный drag, выход курсора за холст),
     выделение всё равно завершится и распознавание запустится. */
  useEffect(() => {
    const finish = () => { if (drag.current) onPointerUp(); };
    const cancelDrag = (e: Event) => e.preventDefault();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('dragstart', cancelDrag);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('dragstart', cancelDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, mode]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.recog-el, .recog-handle')) return;
    if (e.button !== 0) return;                       // только левая кнопка
    e.preventDefault();                               // гасим нативный drag картинки
    // захват на самом холсте (не на <img>): иначе при перетаскивании
    // изображения браузером терялось событие отпускания кнопки
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    /* двойное нажатие (второе — удержать и тянуть) = распознавание из режима перемещения */
    const now = Date.now();
    const isDouble = now - lastDownRef.current.t < 450 &&
      Math.hypot(e.clientX - lastDownRef.current.x, e.clientY - lastDownRef.current.y) < 25;
    lastDownRef.current = { t: now, x: e.clientX, y: e.clientY };

    if ((mode !== 'pan' || isDouble) && page?.image_url) {
      const p = toPagePoint(e.clientX, e.clientY);
      // в режиме pan двойное нажатие означает распознавание
      drag.current = { kind: 'zone', start: p, action: mode === 'manual' ? 'manual' : 'detect' };
      setZoneDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      drag.current = { kind: 'pan', start, view: { ...viewRef.current } };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView({ ...d.view, x: d.view.x + (e.clientX - d.start.x), y: d.view.y + (e.clientY - d.start.y) });
    } else if (d.kind === 'zone') {
      const p = toPagePoint(e.clientX, e.clientY);
      setZoneDraft({
        x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y),
      });
    } else if (d.kind === 'move' && selEl && page) {
      const p = toPagePoint(e.clientX, e.clientY);
      const nb = { ...d.bbox, x: d.bbox.x + (p.x - d.start.x) / page.width, y: d.bbox.y + (p.y - d.start.y) / page.height };
      patchElementLocal(selEl.id, { bbox: clampB(nb) });
    } else if (d.kind === 'resize' && selEl && page) {
      const p = toPagePoint(e.clientX, e.clientY);
      const dx = (p.x - d.start.x) / page.width, dy = (p.y - d.start.y) / page.height;
      const b = { ...d.bbox };
      if (d.h.includes('e')) b.w = d.bbox.w + dx;
      if (d.h.includes('s')) b.h = d.bbox.h + dy;
      if (d.h.includes('w')) { b.x = d.bbox.x + dx; b.w = d.bbox.w - dx; }
      if (d.h.includes('n')) { b.y = d.bbox.y + dy; b.h = d.bbox.h - dy; }
      const m = minBox();
      if (b.w > m.w && b.h > m.h) patchElementLocal(selEl.id, { bbox: clampB(b) });
    }
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const draft = zoneDraftRef.current;
    if (d.kind === 'zone' && draft && page) {
      const z: Zone = {
        x: draft.x / page.width, y: draft.y / page.height,
        w: draft.w / page.width, h: draft.h / page.height,
      };
      setZoneDraft(null);
      setMode('pan');
      // порог в пикселях листа: отсекает случайный клик, но позволяет
      // выделить одиночный элемент на большом чертеже
      if (z.w * page.width < 14 || z.h * page.height < 14) return;
      if (d.action === 'manual') await createManual(z);
      else await runDetect(z);
    } else if ((d.kind === 'move' || d.kind === 'resize') && selEl) {
      try { await recognitionApi.updateElement(selEl.id, { bbox: selEl.bbox }); } catch {}
    }
  };

  /** Минимум держим в пикселях листа: на крупном чертеже рамка должна
   *  уменьшаться так же мелко, как на маленьком. */
  const minBox = (): { w: number; h: number } => ({
    w: page?.width ? MIN_BOX_PX / page.width : 0.0005,
    h: page?.height ? MIN_BOX_PX / page.height : 0.0005,
  });

  const clampB = (b: Zone): Zone => {
    const m = minBox();
    return {
      x: Math.max(0, Math.min(0.999, b.x)),
      y: Math.max(0, Math.min(0.999, b.y)),
      w: Math.max(m.w, Math.min(1 - Math.max(0, b.x), b.w)),
      h: Math.max(m.h, Math.min(1 - Math.max(0, b.y), b.h)),
    };
  };

  const patchElementLocal = (id: number, patch: Partial<RecogElement>) => {
    setDoc((d) => d ? { ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : d);
  };
  const patchPageLocal = (id: number, patch: Partial<RecogPage>) => {
    setDoc((d) => d ? { ...d, pages: d.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : d);
  };

  /* ── действия ── */
  async function runDetect(zone: Zone) {
    if (!page) return;
    setDetecting(true);
    const ac = new AbortController();
    detectAbortRef.current = ac;
    try {
      const { data } = await recognitionApi.detect(page.id, zone, ac.signal);
      setDoc((d) => d ? { ...d, elements: [...d.elements, ...data.elements] } : d);
      if (data.elements.length === 0) {
        // сервер подсказывает, если аппараты нашлись рядом с выделением:
        // без этого пустой результат читается как «распознавание сломалось»
        toast((data as any).hint || 'В выбранной зоне ничего не нашлось — попробуйте другую область',
          { duration: (data as any).hint ? 7000 : 4000 });
      } else {
        // сколько повторных рамок отсеклось — иначе счёт «найдено» непонятен
        const d = (data as any).duplicates;
        toast.success(`Распознано элементов: ${data.elements.length}` + (d ? ` · повторных пропущено: ${d}` : ''));
      }
    } catch (e: any) {
      // отмена по Esc/кнопке — это не ошибка
      if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || ac.signal.aborted) {
        toast('Распознавание остановлено');
      } else {
        toast.error(e?.response?.data?.message || 'Распознавание не удалось, попробуйте ещё раз');
      }
    } finally {
      detectAbortRef.current = null;
      setDetecting(false);
    }
  }



  async function createManual(zone: Zone) {
    if (!page) return;
    try {
      const { data } = await recognitionApi.createElement(page.id, { klass: 'other', bbox: zone, fields: {} });
      setDoc((d) => d ? { ...d, elements: [...d.elements, data] } : d);
      setSelId(data.id); // сразу открываем в инспекторе
    } catch { toast.error('Не удалось добавить рамку'); }
  }

  /** Схема уже связана с листом → после правок тихо пересобираем его. */
  function silentSheetSync(el?: RecogElement | null) {
    const pg = el
      ? (doc?.pages || []).find((p) => p.id === el.page_id)
      : page;
    if (!pg?.sheet_id) return;
    recognitionApi.createSheetForPage(pg.id).catch(() => { /* напр. не осталось подтверждённых */ });
  }

  async function saveElement(el: RecogElement, patch: Partial<RecogElement>, status?: string) {
    try {
      const { data } = await recognitionApi.updateElement(el.id, { ...patch, ...(status ? { status } : {}) } as any);
      if (data) patchElementLocal(el.id, data as any);
      const pg = (doc?.pages || []).find((p) => p.id === el.page_id);
      if (status === 'confirmed') {
        toast.success(pg?.sheet_id ? 'Подтверждено — лист спецификации обновлён' : 'Подтверждено — попадёт в лист спецификации');
      }
      if (status === 'auto') toast('Подтверждение снято — рамка снова жёлтая');
      // снятие подтверждения тоже правит лист: элемент из него уходит
      if (status) silentSheetSync(el);
    } catch { toast.error('Не удалось сохранить'); }
  }

  /** Галочка на рамке — тот же «Подтвердить», что и в инспекторе.
   *  Повторное нажатие снимает подтверждение: иначе ошибочный клик нечем
   *  откатить, а рамка уже уехала в лист спецификации. */
  async function toggleConfirm(el: RecogElement) {
    const next = el.status === 'auto' ? 'confirmed' : 'auto';
    try {
      const { data } = await recognitionApi.updateElement(el.id, { status: next } as any);
      if (data) patchElementLocal(el.id, data as any);
      const pg = (doc?.pages || []).find((p) => p.id === el.page_id);
      toast.success(
        next === 'confirmed'
          ? (pg?.sheet_id ? 'Подтверждено — лист спецификации обновлён' : 'Подтверждено — попадёт в лист спецификации')
          : 'Подтверждение снято',
      );
      silentSheetSync(el);
    } catch { toast.error('Не удалось сохранить'); }
  }

  async function deleteElement(el: RecogElement) {
    try {
      await recognitionApi.removeElement(el.id);
      setDoc((d) => d ? { ...d, elements: d.elements.filter((e) => e.id !== el.id) } : d);
      setSelId(null);
      silentSheetSync(el);
    } catch { toast.error('Не удалось удалить'); }
  }

  /** Копия рамки со всеми параметрами — рядом, со сдвигом (Ctrl+V, «Дублировать»).
   *  Типовой сценарий Максима: один автомат размечен, остальные отличаются
   *  парой характеристик. */
  async function duplicateElement(src: RecogElement, patch?: Partial<RecogElement>, step = 1) {
    // Вставляем на ТЕКУЩИЙ лист: рамку могли скопировать на одной схеме,
    // а вставлять на другой — иначе копия уходила на исходный лист и
    // выглядела как «Ctrl+V ничего не сделал».
    const pg = page || (doc?.pages || []).find((p) => p.id === src.page_id);
    if (!pg) return;
    const base = { ...src, ...(patch || {}) } as RecogElement;
    // каждая следующая вставка ступенькой — иначе копии ложатся друг на друга
    const shift = 0.012 * step;
    const bbox = clampB({
      x: Math.min(base.bbox.x + shift, 1 - base.bbox.w),
      y: Math.min(base.bbox.y + shift, 1 - base.bbox.h),
      w: base.bbox.w, h: base.bbox.h,
    });
    try {
      const { data } = await recognitionApi.createElement(pg.id, {
        klass: base.klass,
        designation: base.designation,
        fields: { ...(base.fields || {}) },
        color: base.color,
        bbox,
        // копию ещё никто не проверял — она приходит неподтверждённой,
        // даже если оригинал был подтверждён
        status: 'auto',
        product_name: base.product_name, brand: base.brand, article: base.article,
        etm_code: base.etm_code, price: base.price,
      } as any);
      setDoc((d) => d ? { ...d, elements: [...d.elements, data] } : d);
      setSelId(data.id);
      toast.success('Копия создана — поправьте характеристики и подтвердите');
    } catch { toast.error('Не удалось скопировать рамку'); }
  }

  /** товар каталога выбран в пикере (пункт 9): привязка + автозаполнение параметров */
  async function applyProduct(elId: number, p: PickedProduct) {
    try {
      const el = (doc?.elements || []).find((e) => e.id === elId);
      // Параметры товара дополняют/перезаписывают поля рамки, но только те,
      // что входят в набор её типа: набор задаётся типом и руками не
      // правится, поэтому иначе в рамке осели бы атрибуты каталога, которые
      // пользователю уже нечем убрать.
      const allowed = new Set(PARAM_SETS[el?.klass || ''] || DEFAULT_PARAM_SET);
      const fromProduct: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.fields || {})) {
        if (allowed.has(k)) fromProduct[k] = v;
      }
      const merged = { ...(el?.fields || {}), ...fromProduct };
      const { product_class, fields, ...productCols } = p;
      const { data } = await recognitionApi.updateElement(elId, { ...productCols, fields: merged } as any);
      if (data) patchElementLocal(elId, data as any);
      setPickerElId(null);
      if (p.product_name) {
        // проверка совместимости классов — заработает, когда Максим добавит
        // классы оборудования в таблицы каталога
        if (product_class && el && product_class !== el.klass) {
          toast(`Внимание: класс товара (${product_class}) не совпадает с классом рамки (${el.klass})`, { duration: 6000 });
        } else {
          toast.success('Товар привязан — параметры заполнены');
        }
      }
      if (el && el.status !== 'auto') silentSheetSync(el);
    } catch { toast.error('Не удалось привязать товар'); }
  }

  /** удаление листа = перенос в корзину (восстановимо до удаления документа) */
  async function trashPage(p: RecogPage) {
    if (!confirm(`Удалить «${pageTitle(p)}» в корзину? Восстановить можно из корзины внизу списка.`)) return;
    await recognitionApi.updatePage(p.id, { hidden: true });
    patchPageLocal(p.id, { hidden: true });
    if (page?.id === p.id) setPageId(null);
  }

  async function restorePage(p: RecogPage) {
    await recognitionApi.updatePage(p.id, { hidden: false });
    patchPageLocal(p.id, { hidden: false });
  }

  async function restoreAllPages() {
    if (!doc) return;
    const trashed = doc.pages.filter((p) => p.hidden);
    for (const p of trashed) {
      try { await recognitionApi.updatePage(p.id, { hidden: false }); } catch {}
    }
    setDoc((d) => d ? { ...d, pages: d.pages.map((x) => ({ ...x, hidden: false })) } : d);
    toast.success(`Восстановлено листов: ${trashed.length}`);
  }

  /** переименование схемы (пункт 4): лист спецификации переименуется на бэке */
  async function renamePage(p: RecogPage) {
    const name = prompt('Название схемы:', pageTitle(p));
    if (name == null) return;
    try {
      const { data } = await recognitionApi.updatePage(p.id, { title: name.trim() });
      patchPageLocal(p.id, data as any);
      if (p.sheet_id) toast.success('Схема и её лист спецификации переименованы');
    } catch { toast.error('Не удалось переименовать'); }
  }

  /** зум кнопками — к центру видимой области */
  const zoomBy = (k: number) => {
    const vp = vpRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const v = viewRef.current;
    const z = Math.max(0.05, Math.min(4, v.z * k));
    const mx = r.width / 2, my = r.height / 2;
    setView({ x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z, z });
  };

  async function togglePageConfirmed(p: RecogPage) {
    const { data } = await recognitionApi.updatePage(p.id, { confirmed: !p.confirmed });
    patchPageLocal(p.id, data as any);
  }

  /* ── лист спецификации (по-схемно, пункты 2–3) ── */
  const buildSpecRows = useCallback((pgId: number | null) => {
    if (!doc || !pgId) return [];
    const els = doc.elements.filter((e) =>
      e.page_id === pgId && (e.status === 'confirmed' || e.status === 'corrected') &&
      (e.product_name || (e.klass !== 'load' && e.klass !== 'other')));
    const map = new Map<string, {
      name: string; brand: string; article: string; price: string;
      klass: string; qty: number; unit: string;
    }>();
    for (const el of els) {
      const f = el.fields || {};
      const isCable = el.klass === 'cable';
      const len = parseFloat(String(f['Длина, м'] || '').replace(',', '.')) || 0;
      let key: string, name: string, brand = '', article = '', price = '0';
      let unit = isCable ? 'м' : 'шт';
      if (el.product_name) {
        name = el.product_name; brand = el.brand || ''; article = el.article || '';
        price = el.price || '0';
        key = `t:${article || name}`;
      } else if (isCable) {
        name = `Кабель ${f['Марка'] || ''} ${f['Жилы×сечение'] || ''}`.replace(/\s+/g, ' ').trim();
        key = name;
      } else {
        const t = f['Тип'] || '', pl = f['Полюса'] || '', ch = f['Хар-ка'] || '', a = f['Номинал, А'] || '';
        const special: Record<string, string> = {
          mcb: 'Автоматический выключатель', mccb: 'Автоматический выключатель',
          acb: 'Воздушный автоматический выключатель',
          rcbo: 'Дифавтомат', rccb: 'УЗО', rcd: 'УЗО',
        };
        const base = special[el.klass] || (className(el.klass).charAt(0).toUpperCase() + className(el.klass).slice(1));
        name = `${base} ${t} ${pl}${ch ? `, хар. ${ch}` : ''}${a ? `, ${a} А` : ''}`
          .replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
        key = name;
      }
      const cur = map.get(key) || { name, brand, article, price, klass: el.klass, qty: 0, unit };
      cur.qty += isCable ? len : 1;
      map.set(key, cur);
    }
    return [...map.values()];
  }, [doc, className]);

  const specTabPage = useMemo(
    () => visiblePages.find((p) => p.id === specTab) || null,
    [visiblePages, specTab],
  );
  const specRows = useMemo(() => buildSpecRows(specTabPage?.id || null), [buildSpecRows, specTabPage]);
  const currentPageRows = useMemo(() => buildSpecRows(page?.id || null), [buildSpecRows, page]);

  async function createSheet(pg: RecogPage | null) {
    if (!pg) return;
    setCreatingSheet(true);
    try {
      const { data } = await recognitionApi.createSheetForPage(pg.id);
      patchPageLocal(pg.id, { sheet_id: data.sheetId });
      toast.success(data.updated
        ? `Лист «${pageTitle(pg)}» обновлён (${data.rowCount} позиций)`
        : `Лист «${pageTitle(pg)}» создан (${data.rowCount} позиций) — папка «Распознавание»`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось создать лист');
    } finally {
      setCreatingSheet(false);
    }
  }

  /* ══════════ рендер ══════════ */
  return (
    <div className="recog-root">
      <Header breadcrumb="Распознавание схем" />
      <SectionOnboarding section="recognition" />

      {!doc ? (
        /* ── экран выбора/загрузки документа (пункт 6: документы первыми) ── */
        <div className="recog-home">
          {!configured && (
            <div className="recog-warn">Распознавание пока не настроено администратором — загрузка и разметка работают, автораспознавание будет недоступно.</div>
          )}

          {/* Строка последних схем — первое, что видно на экране (просьба
              27.08). Полный список с поиском остаётся ниже: он нужен, когда
              документов уже сотня, а тут — продолжить вчерашнюю работу. */}
          {!!(docs && docs.length) && (
            <div className="recog-recent">
              <div className="recog-recent-title">Продолжить работу</div>
              <div className="recog-recent-row">
                {(docs || []).slice(0, 12).map((d: any) => (
                  <button key={d.id} className="recog-recent-card"
                    title={`${d.filename} · ${d.page_count} стр.`}
                    onClick={() => reloadDoc(d.id).then(() => { setPageId(null); setSelId(null); })}>
                    <span className="recog-recent-thumb">
                      {d.preview_url ? <img src={`${API_ORIGIN}${d.preview_url}`} alt="" loading="lazy" /> : <i>…</i>}
                    </span>
                    <span className="recog-recent-name">{d.filename}</span>
                    <span className="recog-recent-meta">
                      {d.page_count} стр.{d.elements_count ? ` · рамок ${d.elements_count}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="recog-doclist">
            <div className="recog-doclist-head">
              <span className="recog-doclist-title">
                Мои документы{docs?.length ? ` (${docs.length})` : ''}
              </span>
              {/* поиск: почти все схемы называются image.png, и без отбора
                  нужную в списке не найти (жалоба 26.08) */}
              {(docs?.length || 0) > 6 && (
                <input
                  className="recog-doc-search"
                  placeholder="Поиск по названию…"
                  value={docQuery}
                  onChange={(e) => setDocQuery(e.target.value)}
                />
              )}
            </div>
            {docsError && (
              <div className="recog-doclist-error">
                Список не загрузился (подробности в консоли браузера, F12).
                <button className="btn-outline" onClick={loadDocs}>Повторить</button>
              </div>
            )}
            {!docsError && docs === null && <div className="recog-doclist-note">Загрузка…</div>}
            {!docsError && docs !== null && docs.length === 0 && (
              <div className="recog-doclist-note">Документов пока нет — загрузите первый файл ниже.</div>
            )}
            {!docsError && docs !== null && docs.length > 0 && visibleDocs.length === 0 && (
              <div className="recog-doclist-note">По запросу «{docQuery}» ничего не нашлось</div>
            )}
            <div className="recog-doclist-scroll">
            {visibleDocs.map((d) => (
                <div key={d.id} className="recog-docitem" onClick={() => reloadDoc(d.id).then(() => { setPageId(null); setSelId(null); })}>
                  {/* миниатюра первого листа: имена у скриншотов одинаковые,
                      узнать схему можно только по картинке */}
                  <span className="recog-docthumb">
                    {d.preview_url
                      ? <img src={`${API_ORIGIN}${d.preview_url}`} alt="" loading="lazy" />
                      : <i>…</i>}
                  </span>
                  <span className="recog-docname">{d.filename}</span>
                  <span className="recog-docmeta">
                    {d.page_count} стр.
                    {d.elements_count ? ` · рамок: ${d.elements_count}` : ''}
                    {' · '}{new Date(d.createdAt).toLocaleDateString('ru-RU')}
                  </span>
                  <button
                    className="recog-docdel" title="Удалить документ"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm('Удалить документ со всей разметкой?')) return;
                      await recognitionApi.remove(d.id);
                      setDocs((list) => (list || []).filter((x) => x.id !== d.id));
                    }}
                  ><Icon.cross /></button>
                </div>
              ))}
            </div>
          </div>

          <div
            className="recog-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); }}
            onClick={() => document.getElementById('recog-file-input')?.click()}
          >
            <input
              id="recog-file-input" type="file" accept=".pdf,image/png,image/jpeg,image/webp" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); (e.target as HTMLInputElement).value = ''; }}
            />
            <div className="recog-drop-title">{uploading ? 'Загружаем…' : 'Перетащите PDF или изображение схемы'}</div>
            <div className="recog-drop-sub">или нажмите, чтобы выбрать файл · можно вставить через Ctrl+V · PDF до 200 МБ</div>
            <button className="btn-primary" disabled={uploading}>Загрузить файл</button>
          </div>

          <DatasetPanel cfg={clsCfg} onCfgSaved={setClsCfg} />
          <ModelPanel />
        </div>
      ) : (
        /* ── рабочее пространство документа ── */
        <div className="recog-work" ref={workRef}>
          {/* левая колонка: схемы */}
          <aside className="recog-pages">
            <div className="recog-pages-head">
              <button className="btn-outline recog-back" onClick={() => {
                // выход к списку — единственное место, где забываем документ
                try { localStorage.removeItem('recogState'); } catch {}
                setDoc(null); setSelId(null); setDocsOpen(false);
              }}>
                <Icon.back /> Все документы
              </button>
              {/* быстрый переход между своими документами, не выходя из схемы */}
              <div className="recog-docswitch">
                <button className="recog-docswitch-btn" onClick={() => { setDocsOpen((v) => !v); loadDocs(); }}
                  title="Мои документы — переключиться на другой">
                  <span className="recog-doc-title" title={doc.filename}>{doc.filename}</span>
                  <span className="recog-docswitch-caret">{docsOpen ? '▴' : '▾'}</span>
                </button>
                {docsOpen && (
                  <div className="recog-docswitch-list">
                    {(docs || []).length === 0 && <div className="recog-docswitch-empty">Других документов нет</div>}
                    {(docs || []).map((d) => (
                      <button key={d.id}
                        className={`recog-docswitch-item ${d.id === doc.id ? 'on' : ''}`}
                        onClick={() => {
                          setDocsOpen(false);
                          if (d.id === doc.id) return;
                          setSelId(null); setPageId(null);
                          reloadDoc(d.id).catch(() => toast.error('Не удалось открыть документ'));
                        }}>
                        <b>{d.filename}</b>
                        <span>
                          {d.page_count} стр. · {new Date(d.createdAt).toLocaleDateString('ru-RU')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="recog-pages-title">Листы ({visiblePages.length})</div>
            {visiblePages.length === 0 && doc.status !== 'rendering' && (
              <div className="recog-render-note">
                {hiddenPages.length ? 'Все листы в корзине' : 'Листов нет — добавьте схему'}
              </div>
            )}
            {visiblePages.map((p) => (
              <div key={p.id} className={`recog-pageitem ${page?.id === p.id ? 'on' : ''}`} onClick={() => { setPageId(p.id); setSelId(null); }}>
                <div className="recog-pagethumb">
                  {p.image_url
                    ? <img src={imgUrl(p)} alt={pageTitle(p)} loading="lazy" />
                    : <div className="recog-pagewait">…</div>}
                </div>
                <div className="recog-pageinfo">
                  <b title={pageTitle(p)}>{pageTitle(p)}</b>
                  <span>{(doc.elements || []).filter((e) => e.page_id === p.id).length} рамок</span>
                  {p.sheet_id ? <span className="recog-pageok">лист связан</span>
                    : p.confirmed ? <span className="recog-pageok">проверена</span> : null}
                </div>
                <div className="recog-pageacts">
                  <button title="Переименовать схему (лист спецификации переименуется тоже)"
                    onClick={(e) => { e.stopPropagation(); renamePage(p); }}><Icon.pencil /></button>
                  <button title={p.confirmed ? 'Снять отметку «проверена»' : 'Подтвердить лист (проверен целиком)'}
                    className={p.confirmed ? 'ok' : ''}
                    onClick={(e) => { e.stopPropagation(); togglePageConfirmed(p); }}><Icon.check /></button>
                  <button title="Удалить лист в корзину"
                    onClick={(e) => { e.stopPropagation(); trashPage(p); }}><Icon.trash /></button>
                </div>
                {/* переход к спецификации прямо из карточки листа (правка
                    Максима 18.08 — он сам предложил это место) */}
                {page?.id === p.id && (
                  <button className="btn-primary recog-page-spec"
                    title="Лист спецификации по этой схеме: подтверждённые рамки с параметрами"
                    onClick={(e) => { e.stopPropagation(); setSpecTab(p.id); setSpecOpen(true); }}>
                    Открыть спецификацию
                  </button>
                )}
              </div>
            ))}
            {doc.status === 'rendering' && <div className="recog-render-note">Готовим листы… {visiblePages.filter((p) => p.image_url).length}/{doc.page_count}</div>}

            {/* корзина листов: раскрывается, восстановление по одному */}
            {hiddenPages.length > 0 && (
              <div className="recog-trash">
                <button className="recog-trash-head" onClick={() => setTrashOpen((v) => !v)}
                  title="Удалённые листы. Окончательно удаляются вместе с документом">
                  <Icon.trash /> Корзина: {hiddenPages.length}
                  <span className="recog-trash-toggle">{trashOpen ? 'скрыть' : 'показать'}</span>
                </button>
                {trashOpen && (
                  <>
                    {hiddenPages.map((p) => (
                      <div key={p.id} className="recog-trash-item">
                        <span title={pageTitle(p)}>{pageTitle(p)}</span>
                        <button onClick={() => restorePage(p)} title="Восстановить лист"><Icon.restore /></button>
                      </div>
                    ))}
                    {hiddenPages.length > 1 && (
                      <button className="recog-trash-all" onClick={restoreAllPages}>Восстановить все</button>
                    )}
                  </>
                )}
              </div>
            )}
            <button className="recog-addpage" disabled={uploading} onClick={() => setAddOpen(true)}>
              <Icon.plus /> Добавить лист
            </button>
          </aside>

          {/* центр: канвас */}
          <div className="recog-canvas-wrap">
            <div className="recog-canvas-toolbar">
              <button className={mode === 'detect' ? 'btn-primary' : 'btn-outline'}
                disabled={!page?.image_url || detecting || !configured}
                title={configured ? 'Обведите область — ИИ найдёт в ней оборудование' : 'Распознавание не настроено (нет ключа API)'}
                onClick={() => setMode(mode === 'detect' ? 'pan' : 'detect')}>
                Распознать
              </button>
              <button className={mode === 'manual' ? 'btn-primary' : 'btn-outline'}
                disabled={!page?.image_url}
                title="Обведите элемент — откроется инспектор для ручного заполнения"
                onClick={() => setMode(mode === 'manual' ? 'pan' : 'manual')}>
                Выделить элемент
              </button>
              <span className="recog-toolhint">
                {mode === 'detect' ? 'Обведите область для распознавания'
                  : mode === 'manual' ? 'Обведите элемент — заполните класс и параметры в инспекторе'
                  : 'Колесо — прокрутка · Ctrl+колесо — масштаб · тянуть — перемещение · двойное нажатие + протянуть — распознать'}
              </span>
              <span className="recog-toolspacer" />
              {/* показ распознанного текста: на плотных листах его много,
                  поэтому даём выключатель (кусков текста — счётчик) */}
              {ocrBoxes.length > 0 && (
                <button
                  className={`btn-outline recog-txt-toggle ${showTexts ? 'on' : ''}`}
                  onClick={() => setShowTexts((v) => !v)}
                  title="Текст, распознанный вокруг элементов, синими рамками на схеме"
                >
                  Текст: {ocrBoxes.length}
                </button>
              )}
              {recogMode !== 'llm' && (
                <span className="recog-modebadge"
                  title="Режим распознавания меняется в панели «Модель Zeus и режим распознавания» на экране документов">
                  {recogMode === 'yolo' ? 'Только Zeus'
                    : recogMode === 'cascade' ? 'Каскад Zeus→LLM'
                    : recogMode === 'twostage' ? 'Поочерёдно: детектор → классификатор'
                    : 'Теневой режим'}
                </span>
              )}
            </div>

            <div
              ref={vpRef}
              className={`recog-viewport ${mode !== 'pan' ? 'crosshair' : ''}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {page ? (
                <div className="recog-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})` }}>
                  {page.image_url
                    ? <img className="recog-pageimg" src={imgUrl(page)} width={page.width} height={page.height} alt="" draggable={false} />
                    : <div className="recog-pageloading">Лист готовится…</div>}
                  {/* рамки. Слой масштабируется CSS-трансформом, поэтому толщину
                      границ/ярлыков/маркеров компенсируем на 1/zoom — иначе на
                      зуме 400% граница 2px превращается в жирные 8px и давит схему */}
                  {page.width > 0 && pageElements.map((el) => {
                    const c = frameColor(el);
                    const sel = el.id === selId;
                    const inv = 1 / view.z; // компенсация масштаба
                    const done = el.status !== 'auto'; // подтверждена/исправлена
                    // уголки вместо сплошного контура (правка Максима 21.08):
                    // длина — четверть меньшей стороны, но не меньше видимых 5 px
                    const elW = el.bbox.w * page.width, elH = el.bbox.h * page.height;
                    const brLen = Math.max(5 * inv, Math.min(elW, elH) * 0.26);
                    const brThick = Math.max(1, 2 * inv);
                    return (
                      <div
                        key={el.id}
                        className={`recog-el ${sel ? 'sel' : ''} ${el.status === 'auto' ? 'auto' : ''} ${done ? 'done' : ''}`}
                        style={{
                          left: el.bbox.x * page.width, top: el.bbox.y * page.height,
                          width: el.bbox.w * page.width, height: el.bbox.h * page.height,
                          // контура нет — только уголки и лёгкая заливка в цвет
                          // (правка Максима 21.08): сплошная рамка на плотных
                          // схемах сливалась с линиями самого чертежа
                          background: sel ? `${c}3a` : `${c}1c`,
                          borderRadius: 0,
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelId(el.id);
                          // рамка остаётся подвижной и после подтверждения
                          if (sel) {
                            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                            drag.current = { kind: 'move', start: toPagePoint(e.clientX, e.clientY), bbox: { ...el.bbox } };
                          }
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      >
                        {/* подписей на схеме нет (правка Максима 17.08): на
                            плотных однолинейках таблички наслаивались друг на
                            друга и закрывали сами аппараты. Класс и уверенность
                            видны в окне параметров. */}
                        {/* уголки по четырём углам (правка Максима 21.08).
                            Анимация выбранной рамки убрана — выделение и так
                            читается по усиленной заливке. */}
                        {['nw', 'ne', 'se', 'sw'].map((h) => (
                          <span key={h} className={`recog-el-bracket rb-${h}`}
                            style={{
                              width: brLen, height: brLen,
                              borderColor: c,
                              [h.includes('n') ? 'borderTopWidth' : 'borderBottomWidth']: brThick,
                              [h.includes('w') ? 'borderLeftWidth' : 'borderRightWidth']: brThick,
                              [h.includes('n') ? 'top' : 'bottom']: -brThick,
                              [h.includes('w') ? 'left' : 'right']: -brThick,
                            }} />
                        ))}
                        {/* Галочка статуса по центру нижнего края: серая —
                            рамка не подтверждена, зелёная — подтверждена.
                            Нажатие равнозначно кнопке «Подтвердить». */}
                        <span
                          className={`recog-el-check ${done ? 'on' : ''}`}
                          style={{
                            transform: `translateX(-50%) scale(${inv})`,
                            transformOrigin: 'center top',
                            // отступ компенсируем зумом, иначе на большом
                            // масштабе галочка налезает на саму рамку
                            bottom: -9 * inv,
                          }}
                          title={done ? 'Подтверждена — нажмите, чтобы снять' : 'Подтвердить рамку'}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); toggleConfirm(el); }}
                        >
                          <Icon.check />
                        </span>
                        {/* маркеров по нижнему краю нет: там галочка, и
                            центральный квадрат перехватывал нажатие на неё
                            (правка Максима 18.08). Тянуть низ можно за углы. */}
                        {sel && ['nw','n','ne','e','se','sw','w'].map((h) => {
                          // размер и смещение маркеров тоже компенсируем зумом,
                          // иначе на большом масштабе они «съезжают» с углов
                          const size = 10 * inv, off = -size / 2;
                          const pos: React.CSSProperties = { width: size, height: size, borderWidth: Math.max(1, 2 * inv) };
                          if (h.includes('n')) pos.top = off;
                          if (h.includes('s')) pos.bottom = off;
                          if (h.includes('w')) pos.left = off;
                          if (h.includes('e')) pos.right = off;
                          if (h === 'n' || h === 's') pos.left = `calc(50% - ${size / 2}px)`;
                          if (h === 'e' || h === 'w') pos.top = `calc(50% - ${size / 2}px)`;
                          return (
                          <span
                            key={h} className={`recog-handle rh-${h}`}
                            style={pos}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                              drag.current = { kind: 'resize', h, start: toPagePoint(e.clientX, e.clientY), bbox: { ...el.bbox } };
                            }}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                          />
                          );
                        })}
                      </div>
                    );
                  })}
                  {/* Распознанный OCR текст — синими рамками прямо на схеме
                      (просьба Максима 03.09). Один и тот же кусок текста
                      привязан к нескольким соседним элементам, поэтому рисуем
                      уникальные: иначе рамки лягут друг на друга и утолщатся. */}
                  {showTexts && page.width > 0 && ocrBoxes.map((t, i) => (
                    <div
                      key={`t${i}`}
                      className="recog-txt"
                      title={`${t.text} · уверенность ${Math.round(t.conf * 100)}%`}
                      style={{
                        left: t.x * page.width, top: t.y * page.height,
                        width: t.w * page.width, height: t.h * page.height,
                        borderWidth: Math.max(1, 1.2 / view.z),
                      }}
                    />
                  ))}
                  {/* зона выделения — жёлтая рамка, толщина не растёт с зумом */}
                  {zoneDraft && (
                    <div className="recog-zonedraft" style={{
                      left: zoneDraft.x, top: zoneDraft.y, width: zoneDraft.w, height: zoneDraft.h,
                      borderWidth: Math.max(1, 2 / view.z),
                    }} />
                  )}
                </div>
              ) : (
                /* листов нет — сразу активная зона добавления */
                <div
                  className="recog-nopage-drop"
                  onPointerDown={(e) => e.stopPropagation()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) addPagesFile(f); }}
                  onClick={() => setAddOpen(true)}
                >
                  <div className="recog-drop-title">{uploading ? 'Загружаем…' : 'Добавьте схему'}</div>
                  <div className="recog-drop-sub">перетащите PDF или изображение · нажмите, чтобы выбрать файл · Ctrl+V</div>
                  <button className="btn-primary" disabled={uploading}>Добавить лист</button>
                </div>
              )}

              {/* Плашка «Подтвердить все / Удалить» убрана (правка Максима
                  19.08): каждый элемент он всё равно проверяет вручную, а
                  всплывающее меню перекрывало схему сразу после распознавания.
                  Число найденных показывается уведомлением. */}

              {/* зум-виджет */}
              <div className="recog-zoomctl" onPointerDown={(e) => e.stopPropagation()}>
                <button onClick={() => zoomBy(0.8)} title="Отдалить" disabled={!page}>−</button>
                <button className="recog-zoomval" onClick={() => fitPage()} title="Вписать лист целиком" disabled={!page}>
                  {Math.round(view.z * 100)}%
                </button>
                <button onClick={() => zoomBy(1.25)} title="Приблизить" disabled={!page}>+</button>
                <button className="recog-zoomfit" onClick={toggleFullscreen}
                  title={isFs ? 'Выйти из полноэкранного режима' : 'На весь экран (листы слева, инспектор справа)'}>
                  {isFs ? <Icon.compress /> : <Icon.expand />}
                </button>
              </div>

              {/* прогресс распознавания */}
              {detecting && (
                <div className="recog-progress">
                  <div className="recog-progress-box">
                    <div className="recog-progress-bar"><i /></div>
                    <div className="recog-progress-phrase">{phrase}</div>
                    <button className="btn-outline recog-progress-stop"
                      onClick={() => { detectAbortRef.current?.abort(); detectAbortRef.current = null; }}>
                      Остановить (Esc)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* нижняя плашка листа спецификации (по текущей схеме) */}
            <div className="recog-specbar" role="button" tabIndex={0}
              onClick={() => { setSpecTab(page?.id || null); setSpecOpen(true); }}>
              <span className="recog-specbar-chev"><Icon.up /></span>
              <span className="recog-specbar-t">Лист спецификации{page ? ` — ${pageTitle(page)}` : ''}</span>
              <span className="recog-specbar-m">
                {currentPageRows.length} позиций
                {page?.sheet_id ? ' · связан с листом, обновляется сам' : ' · лист ещё не создан'}
              </span>
              <span className="recog-specbar-hint">нажмите, чтобы открыть</span>
            </div>
          </div>

          {/* инспектор — плавающее окно поверх схемы, перемещается за шапку.
              Каталог открывается второй колонкой в этом же окне: параметры
              рамки и выбор товара видны одновременно и переезжают вместе. */}
          {selEl && (
            <div ref={inspRef} className={`recog-float-insp${pickerElId != null ? ' with-catalog' : ''}`}
              style={{ left: inspPos.x, top: inspPos.y }}>
              {/* после подтверждения и удаления окно закрывается само
                  (правка Максима 21.08) — работа идёт рамка за рамкой */}
              <InspectorPanel
                key={`${selEl.id}-${selEl.product_name || ''}-${selEl.article || ''}`}
                el={selEl}
                cfg={clsCfg}
                catalogOpen={pickerElId != null}
                catalogCats={catalogMap[selEl.klass] || []}
                catalogTiles={catalogTiles}
                onPickProduct={(p) => applyProduct(selEl.id, p)}
                onHeadPointerDown={startInspDrag}
                onClose={() => { setPickerElId(null); setSelId(null); }}
                onSave={(patch, status) => {
                  saveElement(selEl, patch, status);
                  if (status === 'confirmed') { setPickerElId(null); setSelId(null); }
                }}
                onDelete={() => { setPickerElId(null); setSelId(null); deleteElement(selEl); }}
                onDuplicate={(patch) => duplicateElement(selEl, patch)}
                onPickCatalog={() => setPickerElId((v) => (v == null ? selEl.id : null))}
                onClearProduct={() => applyProduct(selEl.id, { product_name: '', brand: '', article: '', etm_code: '', price: '' })}
              />
              {pickerElId != null && (
                <CatalogPanel
                  onClose={() => setPickerElId(null)}
                  onPick={(p) => applyProduct(pickerElId, p)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* модалка листа спецификации (пункты 2–3: большая, вкладки по схемам) */}
      {specOpen && doc && (
        <div className="recog-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSpecOpen(false); }}>
          <div className="recog-modal recog-modal-big">
            <div className="recog-modal-head">
              <b>Лист спецификации</b>
              <div className="recog-spectabs">
                {visiblePages.map((p) => (
                  <button key={p.id}
                    className={`recog-spectab ${specTabPage?.id === p.id ? 'on' : ''}`}
                    onClick={() => setSpecTab(p.id)}>
                    {pageTitle(p)}
                    {p.sheet_id ? <i className="recog-spectab-dot" title="Лист создан" /> : null}
                  </button>
                ))}
              </div>
              <button className="recog-modal-x" onClick={() => setSpecOpen(false)}><Icon.cross /></button>
            </div>
            {specRows.length === 0 ? (
              <div className="recog-modal-empty">
                На схеме «{specTabPage ? pageTitle(specTabPage) : ''}» пока нет подтверждённых элементов.
                Подтвердите рамки (кнопка «Подтвердить» в инспекторе) — они появятся здесь.
              </div>
            ) : (
              <div className="spec-table-wrap recog-specwrap">
                <table className="spec-table">
                  <thead>
                    <tr>
                      <th className="col-num">№</th>
                      <th className="col-name">Наименование</th>
                      <th>Бренд</th>
                      <th>Артикул</th>
                      <th>Класс</th>
                      <th>Кол-во</th>
                      <th>Ед.</th>
                      <th>Цена</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specRows.map((r, i) => (
                      <tr key={`${r.name}-${i}`}>
                        <td className="col-num">{i + 1}</td>
                        <td className="col-name">{r.name}</td>
                        <td>{r.brand || '—'}</td>
                        <td>{r.article || '—'}</td>
                        <td><span className="recog-klasstag" style={{ color: classByCode.get(r.klass)?.color || '#64748b' }}>{r.klass}</span></td>
                        <td>{Math.round(r.qty * 100) / 100}</td>
                        <td>{r.unit}</td>
                        <td>{r.price && r.price !== '0' ? r.price : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="recog-modal-note">
              Электроприёмники в лист не переносятся. Привяжите к рамке товар из базы («Добавить из базы» в инспекторе) —
              в лист уйдут наименование, бренд и артикул, а цены ЭТМ подтянутся кнопкой «Цены и сроки».
            </div>
            <div className="recog-modal-foot">
              <button className="btn-outline" onClick={() => setSpecOpen(false)}>Закрыть</button>
              {specTabPage?.sheet_id && (
                <button className="btn-outline" onClick={() => router.push(`/spec/${specTabPage.sheet_id}`)}>
                  Открыть лист
                </button>
              )}
              <button className="btn-primary" disabled={!specRows.length || creatingSheet}
                onClick={() => createSheet(specTabPage)}>
                {creatingSheet ? 'Сохраняем…' : specTabPage?.sheet_id ? 'Обновить лист' : 'Создать лист в INDEXALL'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* добавление листа — то же меню, что при входе */}
      {addOpen && doc && (
        <div className="recog-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}>
          <div className="recog-modal recog-addmodal">
            <div className="recog-modal-head">
              <b>Добавить лист в «{doc.filename}»</b>
              <button className="recog-modal-x" onClick={() => setAddOpen(false)}><Icon.cross /></button>
            </div>
            <div
              className="recog-drop recog-drop-inmodal"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) { setAddOpen(false); addPagesFile(f); }
              }}
              onClick={() => document.getElementById('recog-addpage-input')?.click()}
            >
              <input id="recog-addpage-input" type="file" accept=".pdf,image/png,image/jpeg,image/webp" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setAddOpen(false); addPagesFile(f); }
                  (e.target as HTMLInputElement).value = '';
                }} />
              <div className="recog-drop-title">{uploading ? 'Загружаем…' : 'Перетащите PDF или изображение схемы'}</div>
              <div className="recog-drop-sub">или нажмите, чтобы выбрать файл · можно вставить через Ctrl+V · листы добавятся в конец</div>
              <button className="btn-primary" disabled={uploading}>Выбрать файл</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Инспектор ── */
/**
 * Подбор позиции из базы прямо в окне элемента (ТЗ Максима 04.09).
 *
 * Класс схемы указывает на одну или несколько категорий каталога: один и тот
 * же «автоматический выключатель» бывает модульным или в литом корпусе, и это
 * выбирает человек. Поля и списки значений берутся из самой категории —
 * у модульных атрибут зовётся «Кол-во полюсов», у литых «Количествово
 * полюсов», а значения у них разные. Отсюда правило Максима: «бывают только
 * варианты, доступные в базе».
 *
 * Итог сводится в «Название»: если подходит несколько позиций — выпадающий
 * список. Артикул в этом меню не показываем, он ему здесь не нужен.
 */
function CatalogParams({ el, categories, tiles, values, onValues, onPick, onClear }: {
  el: RecogElement;
  categories: string[];
  tiles: any[];
  /** условия подбора — хранятся в полях рамки, поэтому переживают закрытие */
  values: Record<string, string>;
  onValues: (next: Record<string, string>) => void;
  onPick: (p: PickedProduct) => void;
  onClear: () => void;
}) {
  const CAT_KEY = 'Категория базы';
  const cat = values[CAT_KEY] && categories.includes(values[CAT_KEY]) ? values[CAT_KEY] : (categories[0] || '');
  const [opts, setOpts] = useState<{ label: string; opts: string[] }[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<any>(null);
  const seeded = useRef('');

  /* набор полей берём у выбранной категории: у модульных и литых он разный */
  useEffect(() => {
    if (!cat) return;
    let alive = true;
    setOpts([]); setItems([]);
    catalogApi.getFilterOptions(cat)
      .then(({ data }) => { if (alive) setOpts(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setOpts([]); });
    return () => { alive = false; };
  }, [cat]);

  /* Первый заход по этой категории: подставляем то, что уже известно со
     схемы. Модель и OCR дают «3P» и «250 А», в каталоге это «3» и «250» —
     сверяем по цифрам и буквам, иначе совпадений почти не будет. Ранее
     выбранные условия не трогаем: они пришли в values из полей рамки. */
  useEffect(() => {
    if (!opts.length || seeded.current === cat) return;
    seeded.current = cat;
    const norm = (v: string) => String(v).toLowerCase().replace(/[^0-9a-zа-яё+]/gi, '');
    const known = Object.values(el.fields || {}).map(norm).filter(Boolean);
    const next: Record<string, string> = {};
    for (const f of opts) {
      if (values[f.label]) continue;                 // уже выбрано человеком
      const hit = (f.opts || []).find((o) => known.includes(norm(o)));
      if (hit) next[f.label] = hit;
    }
    if (Object.keys(next).length) onValues({ ...values, ...next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, cat]);

  /* каждый выбор сужает список позиций */
  useEffect(() => {
    if (!cat) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const labels = new Set(opts.map((o) => o.label));
        const filters: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(values)) {
          if (v && labels.has(k)) filters[k] = [v];   // в базу шлём только её же поля
        }
        const brands = filters['Производитель'] || [];
        const { data } = await catalogApi.filterProducts(cat, brands.length ? brands : undefined, filters);
        setItems(Array.isArray(data) ? data : []);
      } catch { setItems([]); }
      finally { setLoading(false); }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [cat, values, opts]);

  /** сменили категорию — условия прошлой не имеют смысла, чистим их */
  const changeCat = (next: string) => {
    const keep: Record<string, string> = { [CAT_KEY]: next };
    const labels = new Set(opts.map((o) => o.label));
    for (const [k, v] of Object.entries(values)) if (!labels.has(k) && k !== CAT_KEY) keep[k] = v;
    seeded.current = '';
    onValues(keep);
  };
  const setOne = (label: string, v: string) => {
    const next = { ...values, [CAT_KEY]: cat, [label]: v };
    if (!v) delete next[label];
    onValues(next);
  };

  /** Какие значения ещё встречаются среди отобранных позиций: по ним гасим
   *  варианты, ведущие в пустоту. Производитель лежит не в атрибутах, а
   *  отдельным полем, поэтому собираем его руками. */
  const facet = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    const add = (k: string, v: string) => { if (v) (m[k] = m[k] || new Set()).add(v); };
    for (const p of items) {
      let attrs: any = p?.attributes;
      if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch { attrs = null; } }
      if (attrs && typeof attrs === 'object') {
        for (const [k, v] of Object.entries(attrs)) add(k, sv(v));
      }
      add('Производитель', sv(p?.brand) || sv(p?.manufacturer) || sv(p?.manufacturer?.name));
    }
    return m;
  }, [items]);

  return (
    <div className="recog-basefit">
      <div className="recog-basefit-t">Подбор по базе</div>

      {categories.length > 1 && (
        <div className="recog-fieldrow">
          <label>Категория базы</label>
          <select value={cat} onChange={(e) => changeCat(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{catName(c)}</option>)}
          </select>
        </div>
      )}

      <div className="recog-fieldgrid">
        {opts.slice(0, 8).map((f) => {
          // Показываем только значения, которые есть у уже отобранных позиций,
          // иначе легко собрать набор условий, дающий ноль. Своё выбранное
          // значение оставляем всегда — иначе поле схлопнется само на себя.
          const avail = facet[f.label];
          const list = (avail && avail.size)
            ? (f.opts || []).filter((o) => avail.has(o) || o === values[f.label])
            : (f.opts || []);
          return (
            <div key={f.label} className="recog-fieldrow">
              <label title={f.label}>{f.label}</label>
              <select value={values[f.label] || ''}
                onChange={(e) => setOne(f.label, e.target.value)}>
                <option value="">— любое —</option>
                {list.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <label>Название{items.length ? ` — подходит ${items.length}` : ''}</label>
      <select
        value={chosen ? sv(chosen.name) : ''}
        onChange={(e) => {
          const p = items.find((x) => sv(x?.name) === e.target.value);
          if (!p) { onClear(); return; }
          const { fields, product_class } = productAttrs(p);
          onPick({
            product_name: sv(p?.name).slice(0, 300),
            brand: (sv(p?.brand) || sv(p?.manufacturer) || sv(p?.manufacturer?.name)).slice(0, 120),
            article: sv(p?.article).slice(0, 120),
            etm_code: (sv(p?.etm_code) || sv(p?.etmCode)).slice(0, 60),
            price: sv(p?.price) || '0',
            fields, product_class,
          });
        }}
      >
        <option value="">{loading ? 'Ищем в базе…' : items.length ? '— выберите позицию —' : 'Нет подходящих — снимите часть условий'}</option>
        {items.slice(0, 200).map((p, i) => (
          <option key={`${sv(p?.article)}-${i}`} value={sv(p?.name)}>{sv(p?.name)}</option>
        ))}
      </select>

      {el.product_name && (
        <div className="recog-basefit-picked">
          <span>{el.product_name}</span>
          <button className="btn-outline" onClick={onClear}>Убрать</button>
        </div>
      )}
    </div>
  );
}

function InspectorPanel({ el, cfg, catalogOpen, catalogCats, catalogTiles, onPickProduct, onHeadPointerDown, onClose, onSave, onDelete, onDuplicate, onPickCatalog, onClearProduct }: {
  el: RecogElement;
  cfg: RecogClassConfig;
  /** каталог раскрыт соседней колонкой в этом же окне */
  catalogOpen?: boolean;
  /** категории базы для класса этого элемента */
  catalogCats?: string[];
  /** плитки каталога — нужны только для названий категорий */
  catalogTiles?: any[];
  onPickProduct: (p: PickedProduct) => void;
  onHeadPointerDown?: (e: React.PointerEvent) => void;
  onClose: () => void;
  onSave: (patch: Partial<RecogElement>, status?: string) => void;
  onDelete: () => void;
  onDuplicate: (patch: Partial<RecogElement>) => void;
  onPickCatalog: () => void;
  onClearProduct: () => void;
}) {
  const [klass, setKlass] = useState(el.klass);
  const [designation, setDesignation] = useState(el.designation || '');
  const [fields, setFields] = useState<Record<string, string>>({ ...(el.fields || {}) });
  const [color, setColor] = useState(el.color || '');
  const [colorOpen, setColorOpen] = useState(false);
  /** цвет, которым рамка красится без ручного выбора — по состоянию */
  const stateColor = el.status !== 'auto' ? FRAME_CONFIRMED
    : el.confidence > 0 && el.confidence < LOW_CONF ? FRAME_LOW : FRAME_AUTO;
  /** параметры, переведённые на ручной ввод («Своё значение…») */
  const [manualKeys, setManualKeys] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [k, v] of Object.entries(el.fields || {})) {
      if (PARAM_OPTIONS[k] && v && !PARAM_OPTIONS[k].includes(v)) s.add(k);
    }
    return s;
  });

  const byCode = new Map<string, RecogClass>(cfg.classes.map((c) => [c.code, c]));
  /* Список параметров определяется типом элемента и меняется вместе с ним. */
  const paramKeys = paramKeysFor(klass, fields);
  const collect = (): Partial<RecogElement> => {
    // У классов из каталога набор полей задаёт сама база, и он свой у каждой
    // категории — фильтровать по зашитому списку нельзя, иначе выбранные
    // условия подбора стёрлись бы при подтверждении.
    if (catalogCats?.length) {
      const all: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        const s = String(v ?? '').trim();
        if (s) all[k] = s;
      }
      return { klass, designation, fields: all, color };
    }
    const out: Record<string, string> = {};
    for (const k of paramKeys) {
      const v = String(fields[k] ?? '').trim();
      if (v) out[k] = v;                     // пустые поля набора не храним
    }
    return { klass, designation, fields: out, color };
  };
  /** Условия подбора храним в самой рамке: закрыл окно, открыл снова — они
   *  на месте, и переживают перезагрузку страницы (просьба 05.09). */
  const saveFields = (next: Record<string, string>) => {
    setFields(next);
    onSave({ fields: next });
  };
  const warn = el.confidence > 0 && el.confidence < LOW_CONF && el.status === 'auto';
  /** рамка уже подтверждена или исправлена — кнопка меняет смысл на обратный */
  const done = el.status !== 'auto';

  const productBlock = el.product_name ? (
    <div className="recog-product">
      <div className="recog-product-t">Товар из базы</div>
      <div className="recog-product-name">{el.product_name}</div>
      <div className="recog-product-meta">
        {[el.brand, el.article && `арт. ${el.article}`, el.price && el.price !== '0' && `${el.price} ₽`]
          .filter(Boolean).join(' · ')}
      </div>
      <div className="recog-product-acts">
        <button className={`btn-outline${catalogOpen ? ' recog-frombase-on' : ''}`} onClick={onPickCatalog}>
          {catalogOpen ? 'Скрыть каталог' : 'Заменить'}
        </button>
        <button className="btn-outline" onClick={onClearProduct}>Убрать</button>
      </div>
    </div>
  ) : null;

  return (
    <div className="recog-insp">
      <div className="recog-insp-head" onPointerDown={onHeadPointerDown}
        style={onHeadPointerDown ? { cursor: 'move' } : undefined}
        title={onHeadPointerDown ? 'Перетащите окно за заголовок' : undefined}>
        <b>{designation || byCode.get(klass)?.nameRu || 'Элемент'}</b>
        <button onClick={onClose} title="Закрыть"><Icon.cross /></button>
      </div>
      <div className="recog-insp-status">
        <span className={`recog-pill st-${el.status}`}>
          {el.status === 'auto' ? 'ИИ' : el.status === 'confirmed' ? 'Подтверждён' : 'Исправлен'}
        </span>
        {el.confidence > 0 && (
          <span className={`recog-conf ${warn ? 'warn' : ''}`}>уверенность {Math.round(el.confidence * 100)}%{warn ? ' — проверьте' : ''}</span>
        )}
      </div>

      {/* «Подтвердить» наверху (правка Максима 18.08), рядом «Удалить» —
          ошибочные определения убираются в одно нажатие (правка 19.08).
          «Сохранить» убрана: она отличалась от «Подтвердить» только статусом.
          Блок липкий — остаётся на месте при прокрутке полей. */}
      <div className="recog-insp-btns recog-insp-btns-top">
        {/* У подтверждённой рамки кнопка зелёная и называется «Подтверждено»
            (правка Максима 29.08): нажатие снимает подтверждение — рамка на
            схеме снова становится жёлтой, кнопка — жёлтой «Подтвердить». */}
        <button
          className={done ? 'recog-insp-confirmed' : 'btn-primary'}
          title={done ? 'Снять подтверждение — рамка вернётся в жёлтые' : 'Подтвердить рамку'}
          onClick={() => onSave(collect(), done ? 'auto' : 'confirmed')}
        >
          {done ? 'Подтверждено' : 'Подтвердить'}
        </button>
        <button className="recog-insp-del" style={{ marginTop: 0 }} onClick={onDelete}
          title="Удалить рамку (клавиша Delete)">Удалить</button>
      </div>

      {/* Текст, найденный OCR вокруг элемента (ТЗ Максима, пункт 1). Пока
          показываем как есть: правил разбора ещё нет, но видно, что читается
          и с какой уверенностью — по этому и настраивать. */}
      {!!el.texts?.length && (
        <div className="recog-ocr">
          <div className="recog-ocr-t">Текст рядом ({el.texts.length})</div>
          <div className="recog-ocr-list">
            {el.texts.slice(0, 12).map((t, i) => (
              <span key={i} className="recog-ocr-piece" title={`уверенность ${Math.round(t.conf * 100)}%`}>
                {t.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {productBlock}
      {!el.product_name && (
        <button className={`btn-outline recog-frombase${catalogOpen ? ' recog-frombase-on' : ''}`}
          onClick={onPickCatalog}
          title="Каталог откроется рядом, в этом же окне: наименование, бренд и артикул подтянутся автоматически">
          {catalogOpen ? 'Скрыть каталог' : 'Добавить из базы'}
        </button>
      )}

      <label>Класс оборудования</label>
      <select value={klass} onChange={(e) => setKlass(e.target.value)}>
        {!byCode.has(klass) && <option value={klass}>{klass}</option>}
        <optgroup label="Классы датасета (Label Studio)">
          {cfg.classes.filter((c) => !c.system).map((c) =>
            <option key={c.code} value={c.code}>{c.code} — {c.nameRu}</option>)}
        </optgroup>
        <optgroup label="Служебные (для листа спецификации)">
          {cfg.classes.filter((c) => c.system).map((c) =>
            <option key={c.code} value={c.code}>{c.code} — {c.nameRu}</option>)}
        </optgroup>
      </select>

      <label>Обозначение (QF1, Гр.2…)</label>
      <input value={designation} onChange={(e) => setDesignation(e.target.value)} />

      {/* Класс с категорией в базе: параметры и название берутся из каталога,
          свой список значений здесь не нужен (ТЗ Максима 04.09) */}
      {!!catalogCats?.length && (
        <CatalogParams
          el={el}
          categories={catalogCats}
          tiles={catalogTiles || []}
          values={fields}
          onValues={saveFields}
          onPick={onPickProduct}
          onClear={onClearProduct}
        />
      )}

      {/* Параметры в две колонки (правка Максима 18.08): значения короткие —
          «3P», «250 А», — и полосы на всю ширину занимали место зря, из-за
          них окно не помещалось на экран целиком.
          Для классов из каталога этот блок не нужен — там поля из базы. */}
      {!catalogCats?.length && (
      <div className="recog-fieldgrid">
      {paramKeys.map((k) => {
        const v = fields[k] ?? '';
        const opts = PARAM_OPTIONS[k];
        // известный параметр → выпадающий список допустимых значений;
        // «Своё значение…» переключает поле на свободный ввод
        const asSelect = !!opts && !manualKeys.has(k);
        return (
          <div key={k} className="recog-fieldrow">
            <label>{k}</label>
            <div className="recog-fieldline">
              {asSelect ? (
                <select
                  value={opts.includes(v) ? v : (v ? CUSTOM_OPT : '')}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_OPT) {
                      setManualKeys((s) => new Set(s).add(k));
                      return;
                    }
                    setFields((f) => ({ ...f, [k]: e.target.value }));
                  }}
                >
                  <option value="">— не указано —</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  <option value={CUSTOM_OPT}>Своё значение…</option>
                </select>
              ) : (
                <input value={v} autoFocus={manualKeys.has(k)}
                  onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))} />
              )}
            </div>
          </div>
        );
      })}
      </div>
      )}

      {/* Цвет — под выпадающим меню (правка Максима 17.08): по умолчанию рамка
          красится по состоянию, палитра нужна редко и место занимала зря */}
      <button type="button" className="recog-colorbtn" onClick={() => setColorOpen((v) => !v)}
        title="Свой цвет рамки. По умолчанию цвет показывает состояние: жёлтая — распознана, зелёная — подтверждена, серая — низкая уверенность">
        <span className="recog-colordot" style={{ background: color || stateColor }} />
        <span>Цвет рамки{color ? '' : ' — по состоянию'}</span>
        <span className="recog-colorchev">{colorOpen ? '−' : '+'}</span>
      </button>
      {colorOpen && (
        <div className="recog-swatches">
          {SWATCHES.map((c) => (
            <button key={c}
              className={`recog-swatch ${color === c ? 'on' : ''}`}
              style={{ background: c }}
              title={c}
              // цвет применяем сразу, не дожидаясь «Подтвердить»: иначе
              // непонятно, что выбрал (правка 04.09)
              onClick={() => { setColor(c); onSave({ color: c }); }}
            />
          ))}
          <button className="recog-swatch recog-swatch-add" title="Выбрать свой цвет из палитры"
            onClick={() => document.getElementById('recog-custom-color')?.click()}>
            <Icon.plus />
          </button>
          <input id="recog-custom-color" type="color" hidden
            value={color || stateColor}
            onChange={(e) => { setColor(e.target.value); onSave({ color: e.target.value }); }} />
          {color && (
            <button className="btn-outline recog-swatch-reset" onClick={() => { setColor(''); onSave({ color: '' }); }}>
              Вернуть цвет состояния
            </button>
          )}
        </div>
      )}

      {/* «Подтвердить» и «Удалить» переехали наверх — здесь дублирование
          и сохранение правок без смены статуса */}
      <div className="recog-insp-btns">
        <button className="btn-outline" style={{ flex: 1 }} onClick={() => onDuplicate(collect())}
          title="Создать копию рамки рядом (Ctrl+C / Ctrl+V)">Дублировать</button>
      </div>
      <p className="recog-insp-hint">
        Рамку можно двигать и менять в любой момент, в том числе после подтверждения.
        Ctrl+C / Ctrl+V — копия, Delete — удалить.
      </p>
    </div>
  );
}

/* ── Пикер товара из каталога (пункт 9): поиск + категории с фильтрами ── */

/** каталог отдаёт разные формы данных (tile_products / botDb / прайс-листы) —
 *  рендерим только скаляры, чтобы неожиданный объект не уронил страницу */
const sv = (v: any): string => (v == null || typeof v === 'object' ? '' : String(v));
/** опции фильтра: поддерживаем {label, opts} и легаси-формы {label, options}/{name, values} */
const filterOpts = (f: any): string[] => {
  const raw = Array.isArray(f?.opts) ? f.opts
    : Array.isArray(f?.options) ? f.options
    : Array.isArray(f?.values) ? f.values : [];
  return raw.map(sv).filter(Boolean);
};
const filterLabel = (f: any): string => sv(f?.label) || sv(f?.name);

/** Атрибуты товара из Excel Максима → поля инспектора. Ключи в файлах могут
 *  называться по-разному — маппим по нормализованному имени, остальные
 *  атрибуты переносим как есть. */
const ATTR_MAP: Record<string, string> = {
  'номинальныйток': 'Номинал, А',
  'номинальныйтока': 'Номинал, А',
  'номинал': 'Номинал, А',
  'количествополюсов': 'Полюса',
  'числополюсов': 'Полюса',
  'полюса': 'Полюса',
  'криваяотключения': 'Хар-ка',
  'характеристика': 'Хар-ка',
  'харка': 'Хар-ка',
  'токутечки': 'Утечка, мА',
  'токутечкима': 'Утечка, мА',
  'серия': 'Тип',
  'типрасцепителя': 'Тип расцепителя',
  'отключающаяспособность': 'Откл. способность, кА',
  'отключающаяспособностька': 'Откл. способность, кА',
};
const normKey = (k: string) => k.toLowerCase().replace(/[^а-яёa-z]/g, '');

/** attributes товара (объект или JSON-строка) → {fields, product_class} */
function productAttrs(p: any): { fields: Record<string, string>; product_class: string } {
  let attrs: any = p?.attributes;
  if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch { attrs = null; } }
  const fields: Record<string, string> = {};
  let product_class = '';
  if (attrs && typeof attrs === 'object') {
    let extra = 0;
    for (const [k, v] of Object.entries(attrs)) {
      const val = sv(v);
      if (!val) continue;
      const nk = normKey(k);
      if (nk === 'производитель' || nk === 'бренд') continue; // уходит в brand
      if (nk === 'класс' || nk === 'классоборудования' || nk === 'equipmentclass') { product_class = val; continue; }
      const mapped = ATTR_MAP[nk];
      if (mapped) fields[mapped] = val;
      else if (extra < 8) { fields[String(k).slice(0, 40)] = val.slice(0, 120); extra++; }
    }
  }
  return { fields, product_class };
}

/** Характеристики товара парами [ключ, значение] — для карточки каталога */
function productSpecList(p: any): [string, string][] {
  const { fields } = productAttrs(p);
  return Object.entries(fields) as [string, string][];
}

function CatalogPanel({ onClose, onPick }: {
  onClose: () => void;
  onPick: (p: PickedProduct) => void;
}) {
  const [q, setQ] = useState('');
  const [tiles, setTiles] = useState<any[]>([]);
  const [slug, setSlug] = useState<string>('');
  const [filters, setFilters] = useState<{ label: string; opts: string[] }[]>([]);
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openFilters, setOpenFilters] = useState<Record<string, boolean>>({});
  /** раскрытая карточка товара (подробности как в подборе) */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** цены ЭТМ по ключу article||etmCode — подтягиваются для показанных товаров */
  const [etmData, setEtmData] = useState<Record<string, { price: number | null; term: string | null }>>({});
  const etmRef = useRef(etmData); etmRef.current = etmData;
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    catalogApi.getTiles()
      .then(({ data }) => setTiles(Array.isArray(data) ? data : (data?.tiles || [])))
      .catch(() => {});
  }, []);

  /* поиск по названию/артикулу */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { if (!slug) setItems([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await catalogApi.search(q.trim());
        setSlug('');
        setItems(Array.isArray(data) ? data : (data?.items || []));
      } catch { toast.error('Поиск не удался'); }
      finally { setLoading(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  /* выбор категории → фильтры + товары */
  async function openCategory(s: string) {
    setSlug(s);
    setQ('');
    setSel({});
    setLoading(true);
    try {
      const [{ data: f }, { data: prods }] = await Promise.all([
        catalogApi.getFilterOptions(s),
        catalogApi.filterProducts(s),
      ]);
      setFilters(Array.isArray(f) ? f : []);
      setItems(Array.isArray(prods) ? prods : []);
    } catch { toast.error('Не удалось загрузить категорию'); }
    finally { setLoading(false); }
  }

  async function applyFilters(next: Record<string, string[]>) {
    setSel(next);
    if (!slug) return;
    setLoading(true);
    try {
      const brands = next['Производитель'] || [];
      const { data } = await catalogApi.filterProducts(slug, brands.length ? brands : undefined, next);
      setItems(Array.isArray(data) ? data : []);
    } catch { toast.error('Не удалось применить фильтры'); }
    finally { setLoading(false); }
  }

  function toggleOpt(label: string, opt: string) {
    const cur = sel[label] || [];
    const next = { ...sel, [label]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
    if (!next[label].length) delete next[label];
    applyFilters(next);
  }

  /* цены ЭТМ для первых показанных товаров (как в каталоге — пачкой, с паузой) */
  useEffect(() => {
    const wanted = items.slice(0, 30)
      .map((p) => ({ article: sv(p?.article) || undefined, etmCode: (sv(p?.etm_code) || sv(p?.etmCode)) || undefined }))
      .filter((it) => it.article || it.etmCode);
    if (!wanted.length) return;
    const t = setTimeout(async () => {
      const have = etmRef.current;
      const need = wanted.filter((it) => have[(it.article || it.etmCode) as string] === undefined);
      if (!need.length) return;
      try {
        const { data } = await storesApi.getEtmPricesByItems(need);
        setEtmData((prev) => {
          const next = { ...prev };
          for (const [k, price] of Object.entries(data || {})) {
            next[k] = { price: price as number | null, term: next[k]?.term ?? null };
          }
          return next;
        });
      } catch { /* ЭТМ может быть недоступен — не мешаем работе */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [items]);

  function pick(p: any) {
    const { fields, product_class } = productAttrs(p);
    onPick({
      product_name: sv(p?.name).slice(0, 300),
      brand: (sv(p?.brand) || sv(p?.manufacturer) || sv(p?.manufacturer?.name)).slice(0, 120),
      article: sv(p?.article).slice(0, 120),
      etm_code: (sv(p?.etm_code) || sv(p?.etmCode)).slice(0, 60),
      price: sv(p?.price) || '0',
      fields,
      product_class,
    });
  }

  const catName = sv(tiles.find((t) => t.slug === slug)?.name) || slug;
  const searching = q.trim().length >= 2;
  /** экран категорий (плитки с картинками) — пока категория не выбрана и нет поиска */
  const showCats = !slug && !searching;

  const productList = (
    <div className="recog-catalog-items">
      {loading && <div className="recog-picker-note">Загрузка…</div>}
      {!loading && items.length === 0 && (
        <div className="recog-picker-note">
          {searching ? 'Ничего не нашлось — попробуйте другой запрос' : 'Нет товаров по выбранным фильтрам'}
        </div>
      )}
      {!loading && items.slice(0, 100).map((p, i) => {
        const id = `${sv(p?.id) || sv(p?.article)}-${i}`;
        const etmKey = sv(p?.article) || sv(p?.etm_code) || sv(p?.etmCode);
        const etm = etmKey ? etmData[etmKey] : undefined;
        const img = sv(p?.image_url);
        const site = sv(p?.external_url);
        const open = expandedId === id;
        const specs = productSpecList(p);
        return (
          <div key={id} className={`recog-prodcard ${open ? 'open' : ''}`}
            onClick={() => setExpandedId(open ? null : id)}>
            <div className="recog-prodcard-row">
              {img
                ? <img className={`recog-prodcard-img ${open ? 'big' : ''}`} src={img} alt="" loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                : <div className={`recog-prodcard-img recog-prodcard-noimg ${open ? 'big' : ''}`} />}
              <div className="recog-prodcard-body">
                <div className="recog-prodcard-name">{sv(p?.name) || '—'}</div>
                <div className="recog-prodcard-meta">
                  {[sv(p?.article) && `Артикул ${sv(p.article)}`,
                    sv(p?.brand) || sv(p?.manufacturer) || sv(p?.manufacturer?.name)]
                    .filter(Boolean).join(' · ')}
                </div>
                {/* свёрнутая карточка — 3 характеристики, раскрытая — все */}
                <div className="recog-prodcard-specs">
                  {(open ? specs : specs.slice(0, 3)).map(([k, v]) => (
                    <span key={k} className="recog-prodcard-spec">{k}: {v}</span>
                  ))}
                  {!open && specs.length > 3 && (
                    <span className="recog-prodcard-more">ещё {specs.length - 3} — подробнее</span>
                  )}
                </div>
              </div>
            </div>

            {open && (
              <div className="recog-prodcard-details" onClick={(e) => e.stopPropagation()}>
                <div className="recog-prodcard-prices">
                  {sv(p?.price) && <span>Цена каталога: <b>{sv(p.price)} ₽</b></span>}
                  {etm?.price
                    ? <span className="recog-prodcard-etm">Цена ЭТМ: {Number(etm.price).toLocaleString('ru-RU')} ₽{etm.term ? ` · срок ${etm.term}` : ''}</span>
                    : etmKey ? <span className="recog-prodcard-etmwait">Цена ЭТМ загружается…</span> : null}
                </div>
                {Array.isArray(p?.accessories) && p.accessories.length > 0 && (
                  <div className="recog-prodcard-acc">Аксессуаров в каталоге: {p.accessories.length}</div>
                )}
                <div className="recog-prodcard-foot">
                  {site && (
                    <a className="btn-outline recog-picker-pick" href={site} target="_blank" rel="noreferrer">
                      Открыть на сайте
                    </a>
                  )}
                  <span className="recog-prodcard-spacer" />
                  <button className="btn-primary recog-picker-pick" onClick={() => pick(p)}>Выбрать</button>
                </div>
              </div>
            )}

            {!open && (
              <div className="recog-prodcard-foot">
                {sv(p?.price) && <span className="recog-prodcard-price">{sv(p.price)} ₽</span>}
                {etm?.price ? (
                  <span className="recog-prodcard-etm">
                    ЭТМ: {Number(etm.price).toLocaleString('ru-RU')} ₽{etm.term ? ` · ${etm.term}` : ''}
                  </span>
                ) : null}
                <span className="recog-prodcard-spacer" />
                <button className="btn-primary recog-picker-pick"
                  onClick={(e) => { e.stopPropagation(); pick(p); }}>Выбрать</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <aside className="recog-catalog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="recog-catalog-head">
        <b>{showCats ? 'Добавить из базы' : searching ? 'Поиск по базе' : catName}</b>
        <button className="recog-modal-x" onClick={onClose} title="Свернуть каталог (Esc)"><Icon.cross /></button>
      </div>

      <div className="recog-catalog-bar">
        {!showCats && (
          <button className="recog-picker-backbtn"
            onClick={() => { setSlug(''); setQ(''); setFilters([]); setSel({}); setItems([]); }}>
            <Icon.back /> Категории
          </button>
        )}
        <input
          className="recog-catalog-search"
          placeholder="Поиск по названию или артикулу…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {showCats ? (
        /* экран выбора категории — плитки с картинками, как в каталоге */
        <div className="recog-catalog-tiles">
          {/* мозаика плиток 1:1 как в подборе по категориям: 4 колонки,
              размеры плиток из настроек, картинка заполняет плитку */}
          <div className="category-tiles-ref recog-tiles-grid">
            {tiles.filter((t) => t?.slug).map((t) => {
              const w = t.width ?? (t.is_large ? 2 : 1);
              const h = t.height ?? 1;
              return (
                <div key={t.slug} className="category-tile-ref"
                  style={{ gridColumn: `span ${w}`, gridRow: `span ${h}` }}
                  onClick={() => openCategory(t.slug)}>
                  {t.image_path
                    ? <img className="category-tile-img" alt={sv(t.name)} loading="lazy"
                        src={`${process.env.NEXT_PUBLIC_API_URL}/uploads/${String(t.image_path).split(/[\\/]/).pop()}`} />
                    : <div className="category-tile-icon" style={{ fontSize: 30 }}>{sv(t.icon) || '▦'}</div>}
                </div>
              );
            })}
          </div>
          {tiles.length === 0 && <div className="recog-picker-note">Категории не настроены — воспользуйтесь поиском</div>}
        </div>
      ) : (
        /* категория открыта: слева фильтры, справа оборудование */
        <div className="recog-catalog-body">
          {!searching && (
            <aside className="recog-catalog-filters">
              <div className="recog-catalog-crumbs">
                <span className="recog-catalog-t">Фильтры</span>
                {Object.keys(sel).length > 0 && (
                  <button className="recog-catalog-reset" onClick={() => applyFilters({})}>Сбросить все</button>
                )}
              </div>
              {filters.map((f, fi) => {
                const label = filterLabel(f);
                const opts = filterOpts(f);
                if (!label || !opts.length) return null;
                const open = openFilters[label] ?? fi < 3;
                return (
                  <div key={`${label}-${fi}`} className="recog-picker-filter">
                    <button className="recog-catalog-filter-h"
                      onClick={() => setOpenFilters((s) => ({ ...s, [label]: !open }))}>
                      {label}{sel[label]?.length ? ` (${sel[label].length})` : ''}
                      <span>{open ? '−' : '+'}</span>
                    </button>
                    {open && (
                      <div className="recog-picker-opts">
                        {opts.slice(0, 40).map((o) => (
                          <label key={o} className="recog-picker-opt">
                            <input type="checkbox"
                              checked={(sel[label] || []).includes(o)}
                              onChange={() => toggleOpt(label, o)} />
                            <span>{o}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {filters.length === 0 && <div className="recog-picker-note">Фильтров нет</div>}
            </aside>
          )}
          {productList}
        </div>
      )}

      <p className="recog-catalog-note">
        Выбранный товар привяжется к рамке: наименование, бренд, артикул и параметры уйдут в лист спецификации.
      </p>
    </aside>
  );
}

/* ── Датасет: статистика, выгрузка в Label Studio, конфиг классов ── */
function DatasetPanel({ cfg, onCfgSaved }: {
  cfg: RecogClassConfig;
  onCfgSaved: (c: RecogClassConfig) => void;
}) {
  const [stats, setStats] = useState<any>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [xml, setXml] = useState('');
  const [savingCfg, setSavingCfg] = useState(false);

  useEffect(() => {
    recognitionApi.datasetStats().then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  async function download() {
    setExporting(true);
    try {
      const { data } = await recognitionApi.exportDataset(from || undefined, to || undefined);
      if (!data.tasks?.length) {
        toast('Пока нечего выгружать — нет подтверждённых рамок за период');
        return;
      }
      const blob = new Blob([JSON.stringify(data.tasks, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `indexall-dataset-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Выгружено: ${data.exported_pages} страниц, ${data.exported_elements} рамок`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось выгрузить датасет');
    } finally {
      setExporting(false);
    }
  }

  async function downloadZip() {
    setExporting(true);
    try {
      const { data } = await recognitionApi.exportDatasetZip(from || undefined, to || undefined);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(data);
      a.download = `indexall-dataset-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('ZIP готов: images + labels (YOLO-формат) + data.yaml + labelstudio.json');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось собрать ZIP');
    } finally {
      setExporting(false);
    }
  }

  async function importFile(f: File) {
    try {
      const { data } = await recognitionApi.importDataset(f);
      toast.success(
        `Импорт: страниц ${data.pages}, обновлено ${data.updated}, создано ${data.created}, снято подтверждений ${data.demoted}` +
        (data.pages_not_found ? `, не найдено страниц: ${data.pages_not_found}` : ''),
        { duration: 7000 },
      );
      recognitionApi.datasetStats().then(({ data: d }) => setStats(d)).catch(() => {});
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Импорт не удался');
    }
  }

  async function saveCfg() {
    setSavingCfg(true);
    try {
      const { data } = await recognitionApi.saveLsConfig(xml);
      onCfgSaved(data);
      setXml('');
      setCfgOpen(false);
      toast.success(`Конфиг сохранён: ${data.classes.filter((c) => !c.system).length} классов`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить конфиг');
    } finally {
      setSavingCfg(false);
    }
  }

  const confirmedTotal = stats
    ? Object.values(stats.byClass || {}).reduce((s: number, v: any) => s + (v.confirmed || 0), 0)
    : 0;

  return (
    <div className="recog-dataset">
      <div className="recog-dataset-head">
        <b>Датасет для обучения Zeus</b>
        <span className="recog-dataset-sub">
          {stats ? `${stats.documents} докум. · ${stats.pages} страниц · подтверждено рамок: ${confirmedTotal}` : 'Загрузка…'}
        </span>
      </div>

      {stats && confirmedTotal > 0 && (() => {
        // в датасет идут только классы текущего конфига Label Studio;
        // служебные и коды старой разметки показываем отдельно
        const inDataset = new Set(cfg.classes.filter((c) => !c.system && c.lsValue).map((c) => c.code));
        const rows = Object.entries(stats.byClass as Record<string, { total: number; confirmed: number }>)
          .filter(([, v]) => v.confirmed > 0)
          .sort((a, b) => b[1].confirmed - a[1].confirmed);
        const go = rows.filter(([k]) => inDataset.has(k));
        const skip = rows.filter(([k]) => !inDataset.has(k));
        const chip = ([k, v]: [string, { confirmed: number }], dim = false) => (
          <span key={k} className={`recog-dataset-chip ${dim ? 'dim' : ''}`}
            style={dim ? undefined : { color: cfg.classes.find((c) => c.code === k)?.color || '#64748b' }}>
            {k}: {v.confirmed}
          </span>
        );
        return (
          <>
            {go.length > 0 && (
              <div className="recog-dataset-classes">
                <span className="recog-dataset-grouplabel">в датасет:</span>
                {go.map((r) => chip(r))}
              </div>
            )}
            {skip.length > 0 && (
              <div className="recog-dataset-classes">
                <span className="recog-dataset-grouplabel">не выгружаются (служебные и старая разметка):</span>
                {skip.map((r) => chip(r, true))}
              </div>
            )}
          </>
        );
      })()}

      <div className="recog-dataset-actions">
        <label>с <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn-primary" onClick={downloadZip} disabled={exporting}
          title="Готовый датасет: картинки + разметка в формате YOLO + data.yaml + Label Studio JSON">
          {exporting ? 'Выгружаем…' : 'Скачать датасет (ZIP)'}
        </button>
        <button className="btn-outline" onClick={download} disabled={exporting}
          title="Только разметка, картинки ссылками на сервер">
          JSON для Label Studio
        </button>
        <button className="btn-outline" onClick={() => document.getElementById('recog-import-input')?.click()}
          title="JSON-экспорт из Label Studio: проверенная разметка станет эталоном (verified)">
          Импорт проверенной разметки
        </button>
        <input id="recog-import-input" type="file" accept=".json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); (e.target as HTMLInputElement).value = ''; }} />
        <button className="btn-outline" onClick={() => setCfgOpen((v) => !v)}>
          {cfgOpen ? 'Скрыть конфиг' : 'Обновить классы (конфиг LS)'}
        </button>
      </div>

      {cfgOpen && (
        <div className="recog-dataset-cfg">
          <p>Вставьте XML-конфиг разметки из Label Studio (Settings → Labeling Interface → Code) —
            классы обновятся во всей системе без деплоя. Сейчас классов: {cfg.classes.filter((c) => !c.system).length}.</p>
          <textarea
            rows={8}
            placeholder="<View>…</View>"
            value={xml}
            onChange={(e) => setXml(e.target.value)}
          />
          <button className="btn-primary" disabled={!xml.trim() || savingCfg} onClick={saveCfg}>
            {savingCfg ? 'Сохраняем…' : 'Сохранить конфиг'}
          </button>
        </div>
      )}

      <p className="recog-dataset-note">
        В выгрузку попадают подтверждённые и исправленные рамки классов Label Studio (служебные cable/load/panel
        в датасет Zeus не входят). ZIP готов и для импорта в Label Studio, и для обучения ultralytics
        (yolo train data=data.yaml). Импорт принимает JSON-экспорт Label Studio: рамки матчатся с нашими по IoU,
        проверенные помечаются «verified» и не понижаются автоматикой.
      </p>
    </div>
  );
}

/* ── Модель Zeus: версии, режим распознавания, теневые прогоны ── */
const MODE_INFO: Record<string, { label: string; hint: string }> = {
  llm: { label: 'LLM (Gemini)', hint: 'Рамки, классы и параметры читает языковая модель. Режим по умолчанию.' },
  shadow: { label: 'Теневой (LLM + Zeus)', hint: 'Пользователь видит результат LLM, Zeus работает параллельно — сравнение копится ниже.' },
  cascade: { label: 'Каскад (Zeus → LLM)', hint: 'Zeus находит рамки и классы, LLM дочитывает параметры. Целевая схема.' },
  yolo: { label: 'Только Zeus', hint: 'Быстро и бесплатно, но без параметров (тип/номинал не читаются).' },
  twostage: {
    label: 'Двухступенчатый (детектор → классификатор)',
    hint: 'Первая модель находит элементы, вторая определяет класс по каждой найденной области.',
  },
};

/** Роль модели в конвейере */
const ROLE_INFO: Record<string, string> = {
  single: 'Одна модель (рамки + классы)',
  detector: 'Детектор — ищет элементы',
  classifier: 'Классификатор — определяет класс области',
};
/** то же коротко — для строк списка версий */
const ROLE_SHORT: Record<string, string> = {
  single: 'одна модель',
  detector: 'детектор',
  classifier: 'классификатор',
};

function ModelPanel() {
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState('');
  const [role, setRole] = useState('single');
  const [tiled, setTiled] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    recognitionApi.listModels().then(({ data: d }) => setData(d)).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function upload(f: File) {
    setUploading(true);
    try {
      await recognitionApi.uploadModel(f, note, role, tiled);
      setNote('');
      toast.success('Версия загружена — активируйте её, чтобы включить');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось загрузить модель');
    } finally {
      setUploading(false);
    }
  }
  async function sendClassMap(id: number, f: File) {
    try {
      const { data } = await recognitionApi.uploadClassMap(id, f);
      const unknown: string[] = data?.unknown || [];
      toast.success(`Классы загружены: ${data?.classes ?? '?'}`);
      // молчать о нестыковке нельзя: такие классы уйдут в «Прочее»
      if (unknown.length) {
        toast(`Нет в конфиге классов: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ` и ещё ${unknown.length - 3}` : ''}`,
          { duration: 8000 });
      }
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось загрузить файл классов');
    }
  }
  async function patchModel(id: number, patch: { role?: string; tiled?: boolean }) {
    try {
      const { data: d } = await recognitionApi.updateModel(id, patch);
      setData(d);
      if (patch.role) toast.success(`Роль: ${ROLE_INFO[patch.role] || patch.role}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось изменить модель');
    }
  }
  async function activate(id: number) {
    setBusy(true);
    try {
      const { data: d } = await recognitionApi.activateModel(id);
      setData(d);
      toast.success('Версия активирована');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось активировать');
    } finally { setBusy(false); }
  }
  async function removeVersion(id: number) {
    if (!confirm('Удалить эту версию модели?')) return;
    try {
      await recognitionApi.deleteModel(id);
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить');
    }
  }
  async function changeMode(mode: string) {
    try {
      await recognitionApi.setMode(mode);
      setData((d: any) => ({ ...d, mode }));
      toast.success(`Режим: ${MODE_INFO[mode]?.label || mode}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сменить режим');
    }
  }

  const models: any[] = data?.models || [];
  const mode: string = data?.mode || 'llm';
  const runs: any[] = data?.shadowRuns || [];
  /* какие роли активны — от этого зависит доступность режимов */
  const activeRoles = new Set(models.filter((m) => m.active).map((m) => m.role || 'single'));
  const hasSingle = activeRoles.has('single');
  const hasDetector = activeRoles.has('detector');
  const hasActive = models.some((m) => m.active);
  /** режим недоступен, пока нет нужной модели */
  const modeBlocked = (m: string) =>
    m === 'twostage' ? !hasDetector : m !== 'llm' ? !hasSingle : false;
  const blockedHint = (m: string) =>
    m === 'twostage' ? 'Загрузите модель с ролью «Детектор» и активируйте её'
      : 'Загрузите модель с ролью «Одна модель» и активируйте её';

  return (
    <div className="recog-dataset">
      <div className="recog-dataset-head">
        <b>Модель Zeus и режим распознавания</b>
        <span className="recog-dataset-sub">
          {models.length
            ? `версий: ${models.length}${hasActive
                ? ` · активны: ${[...activeRoles].map((r) => ROLE_SHORT[r] || r).join(', ')}`
                : ' · нет активной'}`
            : 'модель ещё не загружалась — работает LLM'}
        </span>
      </div>

      {/* режим */}
      <div className="recog-mode">
        {Object.entries(MODE_INFO).map(([m, info]) => (
          <label key={m} className={`recog-mode-opt ${mode === m ? 'on' : ''} ${modeBlocked(m) ? 'dis' : ''}`}
            title={modeBlocked(m) ? blockedHint(m) : info.hint}>
            <input
              type="radio" name="recog-mode" value={m}
              checked={mode === m}
              disabled={modeBlocked(m)}
              onChange={() => changeMode(m)}
            />
            <span><b>{info.label}</b><small>{info.hint}</small></span>
          </label>
        ))}
      </div>

      {/* загрузка версии: роль в конвейере + нарезка на тайлы */}
      <div className="recog-dataset-actions">
        <input
          placeholder="Заметка к версии (напр. Detector v1)"
          value={note} onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1, minWidth: 160, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 13 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          title="Роль модели в конвейере распознавания"
          style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 13 }}>
          {Object.entries(ROLE_INFO).map(([r, label]) => <option key={r} value={r}>{label}</option>)}
        </select>
        <label className="recog-tiles-check" title="Резать лист на квадраты размером со вход модели (Zeus 640, Vision 1280). Нужно моделям, обученным на тайлах">
          <input type="checkbox" checked={tiled} onChange={(e) => setTiled(e.target.checked)} />
          нарезка на тайлы
        </label>
        <button className="btn-primary" disabled={uploading}
          onClick={() => document.getElementById('recog-model-input')?.click()}>
          {uploading ? 'Загружаем…' : 'Загрузить модель (.onnx)'}
        </button>
        <input id="recog-model-input" type="file" accept=".onnx" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); (e.target as HTMLInputElement).value = ''; }} />
      </div>

      {/* версии */}
      {models.length > 0 && (
        <div className="recog-models">
          {models.map((m) => (
            <div key={m.id} className={`recog-model-row ${m.active ? 'on' : ''}`}>
              <span className="recog-model-name">
                {m.orig_name || m.filename}
                {m.note && <small> — {m.note}</small>}
              </span>
              <select className="recog-model-role" value={m.role || 'single'}
                title="Роль модели в конвейере"
                onChange={(e) => patchModel(m.id, { role: e.target.value })}>
                {Object.entries(ROLE_SHORT).map(([r, label]) => (
                  <option key={r} value={r} title={ROLE_INFO[r]}>{label}</option>
                ))}
              </select>
              <label className="recog-tiles-check" title="Резать вход на тайлы размером со вход модели">
                <input type="checkbox" checked={!!m.tiled}
                  onChange={(e) => patchModel(m.id, { tiled: e.target.checked })} />
                тайлы
              </label>
              {/* class_mapping.json нужен сети-классификатору: в её ONNX имён
                  классов нет, только номера выходов */}
              <label className="recog-tiles-check" title="class_mapping.json: номер выхода сети → класс. Нужен модели-классификатору по кропу">
                <input type="file" accept=".json,application/json" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) sendClassMap(m.id, f); e.target.value = ''; }} />
                <span className={`recog-classmap ${m.class_map ? 'on' : ''}`}>
                  {m.class_map ? 'классы ✓' : '+ файл классов'}
                </span>
              </label>
              <span className="recog-model-date">{new Date(m.createdAt).toLocaleString('ru-RU')}</span>
              {m.active
                ? <span className="recog-pill st-confirmed">активна</span>
                : (
                  <>
                    <button className="btn-outline" disabled={busy} onClick={() => activate(m.id)}>
                      {activeRoles.has(m.role || 'single') ? 'Откатиться на эту' : 'Активировать'}
                    </button>
                    <button className="recog-docdel" title="Удалить версию" onClick={() => removeVersion(m.id)}><Icon.cross /></button>
                  </>
                )}
            </div>
          ))}
        </div>
      )}

      {/* классы активной модели — сразу видно, знает ли их система */}
      {Array.isArray(data?.modelClasses) && data.modelClasses.length > 0 && (
        <div className="recog-shadow">
          <div className="recog-dataset-sub" style={{ marginBottom: 6 }}>
            Классы активной модели ({data.modelClasses.length}) — серые система не знает, они придут как «Прочее»:
          </div>
          <div className="recog-dataset-classes">
            {data.modelClasses.map((c: any, i: number) => (
              <span key={`${c.name}-${i}`} className={`recog-dataset-chip ${c.known ? '' : 'dim'}`}
                title={c.known ? 'Класс есть в конфиге' : 'Класса нет в конфиге — добавьте его в «Обновить классы»'}>
                {i}: {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* теневые прогоны */}
      {runs.length > 0 && (
        <div className="recog-shadow">
          <div className="recog-dataset-sub" style={{ marginBottom: 6 }}>Теневые прогоны (последние {runs.length}) — сравнение LLM и Zeus:</div>
          {runs.map((r) => (
            <div key={r.id} className="recog-shadow-row">
              <span>{new Date(r.createdAt).toLocaleString('ru-RU')}</span>
              <span>LLM: <b>{r.llm_count}</b> рамок · {(r.llm_ms / 1000).toFixed(1)} c</span>
              <span className={r.yolo_error ? 'err' : ''}>
                Zeus: <b>{r.yolo_count}</b> рамок · {(r.yolo_ms / 1000).toFixed(1)} c{r.yolo_error ? ` · ${r.yolo_error}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
