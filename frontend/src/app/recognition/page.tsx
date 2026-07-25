'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import SectionOnboarding from '@/components/SectionOnboarding';
import {
  authApi, catalogApi, recognitionApi,
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

export default function RecognitionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /* null — ещё грузится; [] — пусто */
  const [docs, setDocs] = useState<any[] | null>(null);
  const [docsError, setDocsError] = useState(false);
  const [clsCfg, setClsCfg] = useState<RecogClassConfig>(DEFAULT_CFG);
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
  const [isFs, setIsFs] = useState(false);
  const workRef = useRef<HTMLDivElement>(null);

  /* пан/зум */
  const [view, setView] = useState({ x: 40, y: 40, z: 0.5 });
  const viewRef = useRef(view); viewRef.current = view;
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<any>(null);
  const [zoneDraft, setZoneDraft] = useState<Zone | null>(null);
  /* результат последнего распознавания зоны: id рамок + зона — для
     кнопок «Подтвердить все» / «Удалить» */
  const [batch, setBatch] = useState<{ ids: number[]; zone: Zone } | null>(null);
  /* подтверждённая рамка «запекается»; редактируется только этот id */
  const [editingId, setEditingId] = useState<number | null>(null);
  const lastDownRef = useRef({ t: 0, x: 0, y: 0 });

  const loadDocs = useCallback(() => {
    recognitionApi.list()
      .then(({ data: d }) => { setDocs(Array.isArray(d) ? d : []); setDocsError(false); })
      .catch((e) => {
        console.error('recognition: список документов не загрузился', e);
        setDocsError(true);
        toast.error('Не удалось загрузить список документов');
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
        recognitionApi.listModels().then(({ data: d }) => { if (d?.mode) setRecogMode(d.mode); }).catch(() => {});
        // Приоритет: ?doc=&page= (переход с листа спецификации), иначе —
        // восстановление после F5 из sessionStorage
        const qDoc = Number(searchParams.get('doc'));
        const qPage = Number(searchParams.get('page'));
        if (qDoc) {
          reloadDoc(qDoc)
            .then(() => { if (qPage) setPageId(qPage); })
            .catch(() => toast.error('Схема не найдена'));
          return;
        }
        try {
          const saved = JSON.parse(sessionStorage.getItem('recogState') || 'null');
          if (saved?.docId) {
            reloadDoc(saved.docId)
              .then(() => { if (saved.pageId) setPageId(saved.pageId); })
              .catch(() => sessionStorage.removeItem('recogState'));
          }
        } catch { /* повреждённое состояние — игнорируем */ }
      })
      .catch(() => router.replace('/projects'));
  }, [router, loadDocs, reloadDoc]);

  /* запоминаем открытый документ/лист для восстановления после F5 */
  useEffect(() => {
    try {
      if (doc) sessionStorage.setItem('recogState', JSON.stringify({ docId: doc.id, pageId }));
      else sessionStorage.removeItem('recogState');
    } catch { /* приватный режим и т.п. */ }
  }, [doc?.id, pageId]);

  /* динамическая таксономия: код класса → карточка */
  const classByCode = useMemo(
    () => new Map<string, RecogClass>(clsCfg.classes.map((c) => [c.code, c])),
    [clsCfg],
  );
  const classColor = useCallback((el: Pick<RecogElement, 'klass' | 'color'>) =>
    el.color || classByCode.get(el.klass)?.color || '#64748b', [classByCode]);
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

  /* выбрали другую рамку — режим редактирования прежней снимается */
  useEffect(() => {
    setEditingId((cur) => (cur !== null && cur !== selId ? null : cur));
  }, [selId]);

  /* Esc: выход из режима выделения / снятие выбора рамки */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMode((m) => {
        if (m !== 'pan') return 'pan';
        setSelId(null);
        return m;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  useEffect(() => { openAt100(); setBatch(null); /* eslint-disable-next-line */ }, [page?.id, page?.width, isFs]);

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

  /* Ctrl+V вставка картинки: на стартовом экране — новый документ,
     внутри документа — добавление листа */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || [])[0];
      if (!f || !/^(image\/|application\/pdf)/.test(f.type)) return;
      if (doc) addPagesFile(f);
      else uploadFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadFile, addPagesFile, doc]);

  /* ── пан/зум/зона ── */
  const toPagePoint = (clientX: number, clientY: number) => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  };

  /* «режим руки»: колесо — прокрутка (Shift — вбок), зум — только Ctrl+колесо */
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const v = viewRef.current;
    if (e.ctrlKey || e.metaKey) {
      const r = vpRef.current!.getBoundingClientRect();
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

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.recog-el, .recog-handle, .recog-zone-confirm')) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
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
      setBatch(null);
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
      if (b.w > 0.004 && b.h > 0.004) patchElementLocal(selEl.id, { bbox: clampB(b) });
    }
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'zone' && zoneDraft && page) {
      const z: Zone = {
        x: zoneDraft.x / page.width, y: zoneDraft.y / page.height,
        w: zoneDraft.w / page.width, h: zoneDraft.h / page.height,
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

  const clampB = (b: Zone): Zone => ({
    x: Math.max(0, Math.min(0.999, b.x)),
    y: Math.max(0, Math.min(0.999, b.y)),
    w: Math.max(0.004, Math.min(1 - Math.max(0, b.x), b.w)),
    h: Math.max(0.004, Math.min(1 - Math.max(0, b.y), b.h)),
  });

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
    setBatch(null);
    try {
      const { data } = await recognitionApi.detect(page.id, zone);
      setDoc((d) => d ? { ...d, elements: [...d.elements, ...data.elements] } : d);
      if (data.elements.length === 0) toast('В выбранной зоне ничего не нашлось — попробуйте другую область');
      else {
        toast.success(`Распознано элементов: ${data.elements.length}`);
        setBatch({ ids: data.elements.map((e) => e.id), zone });
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Распознавание не удалось, попробуйте ещё раз');
    } finally {
      setDetecting(false);
    }
  }

  /** «Подтвердить все» для рамок последнего распознавания */
  async function confirmBatch() {
    if (!batch || !page) return;
    const ids = batch.ids;
    setBatch(null);
    const results = await Promise.all(ids.map((id) =>
      recognitionApi.updateElement(id, { status: 'confirmed' } as any).then((r) => r.data).catch(() => null)));
    setDoc((d) => d ? {
      ...d,
      elements: d.elements.map((e) => {
        const u: any = results.find((r: any) => r && r.id === e.id);
        return u ? { ...e, ...u } : e;
      }),
    } : d);
    const ok = results.filter(Boolean).length;
    toast.success(page.sheet_id ? `Подтверждено: ${ok} — лист обновлён` : `Подтверждено: ${ok}`);
    if (page.sheet_id) recognitionApi.createSheetForPage(page.id).catch(() => {});
  }

  /** «Удалить» — убрать все рамки последнего распознавания */
  async function deleteBatch() {
    if (!batch) return;
    const ids = new Set(batch.ids);
    setBatch(null);
    await Promise.all([...ids].map((id) => recognitionApi.removeElement(id).catch(() => {})));
    setDoc((d) => d ? { ...d, elements: d.elements.filter((e) => !ids.has(e.id)) } : d);
    setSelId((cur) => (cur !== null && ids.has(cur) ? null : cur));
    toast.success('Результат распознавания удалён');
    if (page?.sheet_id) recognitionApi.createSheetForPage(page.id).catch(() => {});
  }

  async function createManual(zone: Zone) {
    if (!page) return;
    try {
      const { data } = await recognitionApi.createElement(page.id, { klass: 'other', bbox: zone, fields: {} });
      setDoc((d) => d ? { ...d, elements: [...d.elements, data] } : d);
      // сразу в режим редактирования — иначе рамка «запечётся» и станет
      // невидимой («рамка не фиксируется — исчезает»)
      setSelId(data.id);
      setEditingId(data.id);
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
      if (status === 'confirmed' || status === 'corrected') {
        setEditingId(null); // рамка «запекается» обратно в схему
        silentSheetSync(el);
      }
    } catch { toast.error('Не удалось сохранить'); }
  }

  async function deleteElement(el: RecogElement) {
    try {
      await recognitionApi.removeElement(el.id);
      setDoc((d) => d ? { ...d, elements: d.elements.filter((e) => e.id !== el.id) } : d);
      setSelId(null);
      setEditingId(null);
      silentSheetSync(el);
    } catch { toast.error('Не удалось удалить'); }
  }

  /** товар каталога выбран в пикере (пункт 9): привязка + автозаполнение параметров */
  async function applyProduct(elId: number, p: PickedProduct) {
    try {
      const el = (doc?.elements || []).find((e) => e.id === elId);
      // параметры товара дополняют/перезаписывают поля рамки
      const merged = { ...(el?.fields || {}), ...(p.fields || {}) };
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

          <div className="recog-doclist">
            <div className="recog-doclist-title">Мои документы</div>
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
            {(docs || []).map((d) => (
                <div key={d.id} className="recog-docitem" onClick={() => reloadDoc(d.id).then(() => { setPageId(null); setSelId(null); })}>
                  <span className="recog-docname">{d.filename}</span>
                  <span className="recog-docmeta">{d.page_count} стр. · {new Date(d.createdAt).toLocaleDateString('ru-RU')}</span>
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
        <div className={`recog-work ${pickerElId != null ? 'with-catalog' : ''}`} ref={workRef}>
          {/* левая колонка: схемы */}
          <aside className="recog-pages">
            <div className="recog-pages-head">
              <button className="btn-outline recog-back" onClick={() => { setDoc(null); setSelId(null); }}>
                <Icon.back /> Документы
              </button>
              <div className="recog-doc-title" title={doc.filename}>{doc.filename}</div>
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
              {recogMode !== 'llm' && (
                <span className="recog-modebadge"
                  title="Режим распознавания меняется в панели «Модель YOLO и режим распознавания» на экране документов">
                  {recogMode === 'yolo' ? 'Только YOLO' : recogMode === 'cascade' ? 'Каскад YOLO→LLM' : 'Теневой режим'}
                </span>
              )}
            </div>

            <div
              ref={vpRef}
              className={`recog-viewport ${mode !== 'pan' ? 'crosshair' : ''}`}
              onWheel={onWheel}
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
                    const c = classColor(el);
                    const sel = el.id === selId;
                    const inv = 1 / view.z; // компенсация масштаба
                    /* подтверждённая рамка «запечена»: невидима (не перекрывает
                       схему), проявляется при наведении/выборе; не двигается,
                       пока в инспекторе не нажали «Редактировать» */
                    const locked = el.status !== 'auto' && el.id !== editingId;
                    return (
                      <div
                        key={el.id}
                        className={`recog-el ${sel ? 'sel' : ''} ${el.status === 'auto' ? 'auto' : ''} ${locked ? 'locked' : ''}`}
                        style={{
                          left: el.bbox.x * page.width, top: el.bbox.y * page.height,
                          width: el.bbox.w * page.width, height: el.bbox.h * page.height,
                          // как в Label Studio: полупрозрачная заливка + тонкая рамка
                          // цвета класса; без второго контура у выбранной рамки
                          borderWidth: Math.max(1, (sel ? 2 : 1.5) * inv),
                          borderColor: c,
                          background: sel ? `${c}3d` : locked ? `${c}20` : `${c}14`,
                          borderRadius: Math.max(2, 4 * inv),
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelId(el.id);
                          if (sel && !locked) {
                            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                            drag.current = { kind: 'move', start: toPagePoint(e.clientX, e.clientY), bbox: { ...el.bbox } };
                          }
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      >
                        <span className="recog-el-chip"
                          style={{ color: c, borderColor: c, transform: `scale(${inv})`, transformOrigin: 'left bottom' }}>
                          {el.klass} {Math.round((el.confidence || 0) * 100)}%
                        </span>
                        {sel && !locked && ['nw','n','ne','e','se','s','sw','w'].map((h) => (
                          <span
                            key={h} className={`recog-handle rh-${h}`}
                            style={{ width: 10 * inv, height: 10 * inv, borderWidth: Math.max(1, 2 * inv) }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                              drag.current = { kind: 'resize', h, start: toPagePoint(e.clientX, e.clientY), bbox: { ...el.bbox } };
                            }}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                          />
                        ))}
                      </div>
                    );
                  })}
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

              {/* действия над результатом распознавания зоны */}
              {batch && page && !detecting && (
                <div
                  className="recog-zone-confirm"
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    left: view.x + (batch.zone.x + batch.zone.w / 2) * page.width * view.z,
                    top: view.y + (batch.zone.y + batch.zone.h) * page.height * view.z + 10,
                  }}
                >
                  <span className="recog-batch-t">Найдено: {batch.ids.length}</span>
                  <button className="btn-primary" onClick={confirmBatch}
                    title="Подтвердить все распознанные рамки — попадут в лист спецификации">
                    Подтвердить все
                  </button>
                  <button className="btn-outline" onClick={deleteBatch}
                    title="Удалить все рамки этого распознавания">
                    Удалить
                  </button>
                  <button className="btn-outline" onClick={() => setBatch(null)} title="Закрыть (оставить как есть)"><Icon.cross /></button>
                </div>
              )}

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

          {/* правая колонка: инспектор */}
          <aside className="recog-inspector">
            {!selEl ? (
              <div className="recog-insp-empty">
                <b>Инспектор элемента</b>
                <p>Кликните рамку на схеме — здесь появятся класс и параметры.</p>
                <p>«Распознать зону» — выделите область, ИИ разметит её автоматически.</p>
              </div>
            ) : (
              <InspectorPanel
                key={`${selEl.id}-${selEl.id === editingId ? 'edit' : 'view'}-${selEl.product_name || ''}-${selEl.article || ''}`}
                el={selEl}
                cfg={clsCfg}
                editing={selEl.status === 'auto' || selEl.id === editingId}
                onEdit={() => setEditingId(selEl.id)}
                onClose={() => setSelId(null)}
                onSave={(patch, status) => saveElement(selEl, patch, status)}
                onDelete={() => deleteElement(selEl)}
                onPickCatalog={() => setPickerElId(selEl.id)}
                onClearProduct={() => applyProduct(selEl.id, { product_name: '', brand: '', article: '', etm_code: '', price: '' })}
              />
            )}
          </aside>

          {/* панель каталога — справа от инспектора, канвас остаётся видимым */}
          {pickerElId != null && (
            <CatalogPanel
              onClose={() => setPickerElId(null)}
              onPick={(p) => applyProduct(pickerElId, p)}
            />
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
function InspectorPanel({ el, cfg, editing, onEdit, onClose, onSave, onDelete, onPickCatalog, onClearProduct }: {
  el: RecogElement;
  cfg: RecogClassConfig;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSave: (patch: Partial<RecogElement>, status?: string) => void;
  onDelete: () => void;
  onPickCatalog: () => void;
  onClearProduct: () => void;
}) {
  const [klass, setKlass] = useState(el.klass);
  const [designation, setDesignation] = useState(el.designation || '');
  const [fields, setFields] = useState<Record<string, string>>({ ...(el.fields || {}) });
  const [color, setColor] = useState(el.color || '');
  const [newKey, setNewKey] = useState('');
  /** параметры, переведённые на ручной ввод («Своё значение…») */
  const [manualKeys, setManualKeys] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [k, v] of Object.entries(el.fields || {})) {
      if (PARAM_OPTIONS[k] && v && !PARAM_OPTIONS[k].includes(v)) s.add(k);
    }
    return s;
  });

  const byCode = new Map<string, RecogClass>(cfg.classes.map((c) => [c.code, c]));
  const collect = (): Partial<RecogElement> => ({ klass, designation, fields, color });
  const warn = el.confidence > 0 && el.confidence < 0.7 && el.status === 'auto';

  const productBlock = el.product_name ? (
    <div className="recog-product">
      <div className="recog-product-t">Товар из базы</div>
      <div className="recog-product-name">{el.product_name}</div>
      <div className="recog-product-meta">
        {[el.brand, el.article && `арт. ${el.article}`, el.price && el.price !== '0' && `${el.price} ₽`]
          .filter(Boolean).join(' · ')}
      </div>
      {editing && (
        <div className="recog-product-acts">
          <button className="btn-outline" onClick={onPickCatalog}>Заменить</button>
          <button className="btn-outline" onClick={onClearProduct}>Убрать</button>
        </div>
      )}
    </div>
  ) : null;

  /* Подтверждённая рамка «уложена в схему» — просмотр без правок,
     редактирование только после явной кнопки. */
  if (!editing) {
    return (
      <div className="recog-insp">
        <div className="recog-insp-head">
          <b>{el.designation || byCode.get(el.klass)?.nameRu || 'Элемент'}</b>
          <button onClick={onClose} title="Закрыть"><Icon.cross /></button>
        </div>
        <div className="recog-insp-status">
          <span className={`recog-pill st-${el.status}`}>
            {el.status === 'confirmed' ? 'Подтверждён' : 'Исправлен'}
          </span>
        </div>
        {productBlock}
        <div className="recog-insp-view">
          <div className="recog-insp-viewrow">
            <span>Класс</span><b>{el.klass} — {byCode.get(el.klass)?.nameRu || ''}</b>
          </div>
          {el.designation && (
            <div className="recog-insp-viewrow"><span>Обозначение</span><b>{el.designation}</b></div>
          )}
          {Object.entries(el.fields || {}).map(([k, v]) => (
            <div key={k} className="recog-insp-viewrow"><span>{k}</span><b>{v || '—'}</b></div>
          ))}
        </div>
        <div className="recog-insp-btns">
          <button className="btn-primary" onClick={onEdit}>Редактировать</button>
        </div>
        <p className="recog-insp-hint">
          Рамка зафиксирована на схеме: перемещение и изменение размера отключены.
          Нажмите «Редактировать», чтобы изменить класс, параметры или рамку.
        </p>
      </div>
    );
  }

  return (
    <div className="recog-insp">
      <div className="recog-insp-head">
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

      {productBlock}
      {!el.product_name && (
        <button className="btn-outline recog-frombase" onClick={onPickCatalog}
          title="Выбрать оборудование из каталога — наименование, бренд и артикул подтянутся автоматически">
          Добавить из базы
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

      {Object.entries(fields).map(([k, v]) => {
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
              <button title="Убрать параметр" onClick={() => setFields((f) => { const n = { ...f }; delete n[k]; return n; })}><Icon.cross /></button>
            </div>
          </div>
        );
      })}
      <div className="recog-addfield">
        <input placeholder="Новый параметр (напр. Номинал, А)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <button className="btn-outline" disabled={!newKey.trim()}
          onClick={() => { setFields((f) => ({ ...f, [newKey.trim()]: '' })); setNewKey(''); }}><Icon.plus /></button>
      </div>

      {/* пункт 7: 15 популярных цветов + кнопка «добавить свой» */}
      <label>Цвет рамки</label>
      <div className="recog-swatches">
        {SWATCHES.map((c) => (
          <button key={c}
            className={`recog-swatch ${color === c ? 'on' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => setColor(c)}
          />
        ))}
        <button className="recog-swatch recog-swatch-add" title="Выбрать свой цвет из палитры"
          onClick={() => document.getElementById('recog-custom-color')?.click()}>
          <Icon.plus />
        </button>
        <input id="recog-custom-color" type="color" hidden
          value={color || byCode.get(klass)?.color || '#64748b'}
          onChange={(e) => setColor(e.target.value)} />
        {color && <button className="btn-outline recog-swatch-reset" onClick={() => setColor('')}>Цвет класса</button>}
      </div>

      <div className="recog-insp-btns">
        <button className="btn-primary" onClick={() => onSave(collect(), 'confirmed')}>Подтвердить</button>
        <button className="btn-outline" onClick={() => onSave(collect(), 'corrected')}>Сохранить</button>
      </div>
      <button className="recog-insp-del" onClick={onDelete}>Удалить элемент</button>
      <p className="recog-insp-hint">
        Подтверждённые и исправленные рамки попадают в лист спецификации и копятся в датасет для дообучения модели.
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

/** Характеристики товара для карточки: до 5 значимых строк */
function productSpecLines(p: any): string[] {
  const { fields } = productAttrs(p);
  return Object.entries(fields).slice(0, 5).map(([k, v]) => `${k}: ${v}`);
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

  return (
    <aside className="recog-catalog">
      <div className="recog-catalog-head">
        <b>Добавить из базы</b>
        <button className="recog-modal-x" onClick={onClose} title="Закрыть панель"><Icon.cross /></button>
      </div>

      <input
        className="recog-catalog-search"
        placeholder="Поиск по названию или артикулу…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      {/* категории / фильтры выбранной категории */}
      {!slug && !q.trim() && (
        <div className="recog-catalog-cats">
          <div className="recog-catalog-t">Категории</div>
          {tiles.filter((t) => t?.slug).map((t) => (
            <button key={t.slug} className="recog-picker-cat" onClick={() => openCategory(t.slug)}>
              {sv(t.name) || t.slug}
            </button>
          ))}
        </div>
      )}

      {slug && (
        <div className="recog-catalog-filters">
          <div className="recog-catalog-crumbs">
            <button className="recog-picker-backbtn"
              onClick={() => { setSlug(''); setFilters([]); setSel({}); setItems([]); }}>
              <Icon.back /> Категории
            </button>
            {Object.keys(sel).length > 0 && (
              <button className="recog-catalog-reset" onClick={() => applyFilters({})}>Сбросить все</button>
            )}
          </div>
          <div className="recog-catalog-cat">{catName}</div>
          {filters.map((f, fi) => {
            const label = filterLabel(f);
            const opts = filterOpts(f);
            if (!label || !opts.length) return null;
            const open = openFilters[label] ?? fi < 2;
            return (
              <div key={`${label}-${fi}`} className="recog-picker-filter">
                <button className="recog-catalog-filter-h"
                  onClick={() => setOpenFilters((s) => ({ ...s, [label]: !open }))}>
                  {label}
                  {(sel[label]?.length ? ` (${sel[label].length})` : '')}
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
        </div>
      )}

      {/* товары карточками */}
      <div className="recog-catalog-items">
        {loading && <div className="recog-picker-note">Загрузка…</div>}
        {!loading && items.length === 0 && (
          <div className="recog-picker-note">
            {q.trim().length >= 2 ? 'Ничего не нашлось — попробуйте другой запрос'
              : slug ? 'Нет товаров по выбранным фильтрам'
              : 'Введите запрос или выберите категорию'}
          </div>
        )}
        {!loading && items.slice(0, 100).map((p, i) => (
          <div key={`${sv(p?.id) || sv(p?.article)}-${i}`} className="recog-prodcard">
            <div className="recog-prodcard-name">{sv(p?.name) || '—'}</div>
            <div className="recog-prodcard-meta">
              {[sv(p?.article) && `Артикул ${sv(p.article)}`,
                sv(p?.brand) || sv(p?.manufacturer) || sv(p?.manufacturer?.name)]
                .filter(Boolean).join(' · ')}
            </div>
            {productSpecLines(p).map((line) => (
              <div key={line} className="recog-prodcard-spec">{line}</div>
            ))}
            <div className="recog-prodcard-foot">
              {sv(p?.price) && <span className="recog-prodcard-price">{sv(p.price)} ₽</span>}
              <button className="btn-primary recog-picker-pick" onClick={() => pick(p)}>Выбрать</button>
            </div>
          </div>
        ))}
      </div>

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
      toast.success('ZIP готов: images + labels (YOLO) + data.yaml + labelstudio.json');
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
        <b>Датасет для обучения YOLO</b>
        <span className="recog-dataset-sub">
          {stats ? `${stats.documents} докум. · ${stats.pages} страниц · подтверждено рамок: ${confirmedTotal}` : 'Загрузка…'}
        </span>
      </div>

      {stats && confirmedTotal > 0 && (
        <div className="recog-dataset-classes">
          {Object.entries(stats.byClass as Record<string, { total: number; confirmed: number }>)
            .filter(([, v]) => v.confirmed > 0)
            .sort((a, b) => b[1].confirmed - a[1].confirmed)
            .map(([k, v]) => (
              <span key={k} className="recog-dataset-chip"
                style={{ color: cfg.classes.find((c) => c.code === k)?.color || '#64748b' }}>
                {k}: {v.confirmed}
              </span>
            ))}
        </div>
      )}

      <div className="recog-dataset-actions">
        <label>с <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn-primary" onClick={downloadZip} disabled={exporting}
          title="Готовый датасет: картинки + YOLO-разметка + data.yaml + Label Studio JSON">
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
        в датасет YOLO не входят). ZIP готов и для импорта в Label Studio, и для обучения ultralytics
        (yolo train data=data.yaml). Импорт принимает JSON-экспорт Label Studio: рамки матчатся с нашими по IoU,
        проверенные помечаются «verified» и не понижаются автоматикой.
      </p>
    </div>
  );
}

/* ── Модель YOLO: версии, режим распознавания, теневые прогоны ── */
const MODE_INFO: Record<string, { label: string; hint: string }> = {
  llm: { label: 'LLM (Gemini)', hint: 'Рамки, классы и параметры читает языковая модель. Режим по умолчанию.' },
  shadow: { label: 'Теневой (LLM + YOLO)', hint: 'Пользователь видит результат LLM, YOLO работает параллельно — сравнение копится ниже.' },
  cascade: { label: 'Каскад (YOLO → LLM)', hint: 'YOLO находит рамки и классы, LLM дочитывает параметры. Целевая схема.' },
  yolo: { label: 'Только YOLO', hint: 'Быстро и бесплатно, но без параметров (тип/номинал не читаются).' },
};

function ModelPanel() {
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    recognitionApi.listModels().then(({ data: d }) => setData(d)).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function upload(f: File) {
    setUploading(true);
    try {
      await recognitionApi.uploadModel(f, note);
      setNote('');
      toast.success('Версия загружена — активируйте её, чтобы включить');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось загрузить модель');
    } finally {
      setUploading(false);
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
  const hasActive = !!data?.activeId;
  const mode: string = data?.mode || 'llm';
  const runs: any[] = data?.shadowRuns || [];

  return (
    <div className="recog-dataset">
      <div className="recog-dataset-head">
        <b>Модель YOLO и режим распознавания</b>
        <span className="recog-dataset-sub">
          {models.length ? `версий: ${models.length}${hasActive ? '' : ' · нет активной'}` : 'модель ещё не загружалась — работает LLM'}
        </span>
      </div>

      {/* режим */}
      <div className="recog-mode">
        {Object.entries(MODE_INFO).map(([m, info]) => (
          <label key={m} className={`recog-mode-opt ${mode === m ? 'on' : ''} ${m !== 'llm' && !hasActive ? 'dis' : ''}`}
            title={m !== 'llm' && !hasActive ? 'Сначала загрузите и активируйте модель' : info.hint}>
            <input
              type="radio" name="recog-mode" value={m}
              checked={mode === m}
              disabled={m !== 'llm' && !hasActive}
              onChange={() => changeMode(m)}
            />
            <span><b>{info.label}</b><small>{info.hint}</small></span>
          </label>
        ))}
      </div>

      {/* загрузка версии */}
      <div className="recog-dataset-actions">
        <input
          placeholder="Заметка к версии (напр. v1 — 48 схем)"
          value={note} onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1, minWidth: 180, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 13 }}
        />
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
              <span className="recog-model-date">{new Date(m.createdAt).toLocaleString('ru-RU')}</span>
              {m.active
                ? <span className="recog-pill st-confirmed">активна</span>
                : (
                  <>
                    <button className="btn-outline" disabled={busy} onClick={() => activate(m.id)}>
                      {hasActive ? 'Откатиться на эту' : 'Активировать'}
                    </button>
                    <button className="recog-docdel" title="Удалить версию" onClick={() => removeVersion(m.id)}><Icon.cross /></button>
                  </>
                )}
            </div>
          ))}
        </div>
      )}

      {/* теневые прогоны */}
      {runs.length > 0 && (
        <div className="recog-shadow">
          <div className="recog-dataset-sub" style={{ marginBottom: 6 }}>Теневые прогоны (последние {runs.length}) — сравнение LLM и YOLO:</div>
          {runs.map((r) => (
            <div key={r.id} className="recog-shadow-row">
              <span>{new Date(r.createdAt).toLocaleString('ru-RU')}</span>
              <span>LLM: <b>{r.llm_count}</b> рамок · {(r.llm_ms / 1000).toFixed(1)} c</span>
              <span className={r.yolo_error ? 'err' : ''}>
                YOLO: <b>{r.yolo_count}</b> рамок · {(r.yolo_ms / 1000).toFixed(1)} c{r.yolo_error ? ` · ${r.yolo_error}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
