'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import SectionOnboarding from '@/components/SectionOnboarding';
import { authApi, recognitionApi, RecogDocument, RecogElement, RecogPage } from '@/lib/api';

/* ── Классы оборудования ── */
const CLASSES: Record<string, { name: string; color: string }> = {
  mcb:       { name: 'Модульный автомат',        color: '#1e7e34' },
  mccb:      { name: 'Автомат в литом корпусе',  color: '#0d9488' },
  rcbo:      { name: 'Дифавтомат',               color: '#7c3aed' },
  rcd:       { name: 'УЗО',                      color: '#9333ea' },
  contactor: { name: 'Контактор / пускатель',    color: '#c2410c' },
  relay:     { name: 'Реле',                     color: '#a16207' },
  meter:     { name: 'Прибор учёта',             color: '#0369a1' },
  busbar:    { name: 'Шина',                     color: '#52616f' },
  panel:     { name: 'Щит / распредпункт',       color: '#334155' },
  cable:     { name: 'Кабель / провод',          color: '#1d4ed8' },
  load:      { name: 'Электроприёмник',          color: '#be185d' },
  other:     { name: 'Прочее',                   color: '#64748b' },
};
const classColor = (el: Pick<RecogElement, 'klass' | 'color'>) =>
  el.color || CLASSES[el.klass]?.color || '#64748b';

const FUN_PHRASES = [
  'Нейросеть в шоке…',
  'Нейросеть усиленно работает…',
  'Ещё немного усилий…',
  'Ну почти получилось…',
  'Ща-ща…',
];

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
const imgUrl = (p: RecogPage) => (p.image_url ? `${API_ORIGIN}${p.image_url}` : '');

type Zone = { x: number; y: number; w: number; h: number };
type Mode = 'pan' | 'zone' | 'draw';

export default function RecognitionPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<any[]>([]);
  const [doc, setDoc] = useState<RecogDocument | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('pan');
  const [detecting, setDetecting] = useState(false);
  const [phrase, setPhrase] = useState(FUN_PHRASES[0]);
  const [uploading, setUploading] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [configured, setConfigured] = useState(true);

  /* пан/зум */
  const [view, setView] = useState({ x: 40, y: 40, z: 0.5 });
  const viewRef = useRef(view); viewRef.current = view;
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<any>(null);
  const [zoneDraft, setZoneDraft] = useState<Zone | null>(null);

  /* ── загрузка данных (раздел пока только для администратора) ── */
  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.push('/auth/login');
      return;
    }
    authApi.me()
      .then(({ data }) => {
        if (data?.plan !== 'admin') {
          router.replace('/projects');
          return;
        }
        recognitionApi.list().then(({ data: d }) => setDocs(d)).catch(() => {});
        recognitionApi.status().then(({ data: d }) => setConfigured(d.configured)).catch(() => {});
      })
      .catch(() => router.replace('/projects'));
  }, [router]);

  const reloadDoc = useCallback(async (id: number) => {
    const { data } = await recognitionApi.getOne(id);
    setDoc(data);
    return data;
  }, []);

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
  const page = useMemo(() => visiblePages.find((p) => p.id === pageId) || visiblePages[0] || null, [visiblePages, pageId]);
  const pageElements = useMemo(() => (doc?.elements || []).filter((e) => page && e.page_id === page.id), [doc, page]);
  const selEl = useMemo(() => pageElements.find((e) => e.id === selId) || null, [pageElements, selId]);

  /* вписать страницу в окно */
  const fitPage = useCallback((p?: RecogPage | null) => {
    const pg = p || page;
    const vp = vpRef.current;
    if (!pg || !vp || !pg.width) return;
    const r = vp.getBoundingClientRect();
    const z = Math.min((r.width - 60) / pg.width, (r.height - 60) / pg.height, 1.5);
    setView({ x: (r.width - pg.width * z) / 2, y: (r.height - pg.height * z) / 2, z });
  }, [page]);

  useEffect(() => { fitPage(); /* eslint-disable-next-line */ }, [page?.id, page?.width]);

  /* ── загрузка файла ── */
  const uploadFile = useCallback(async (file: File) => {
    if (uploading) return;
    setUploading(true);
    try {
      const { data } = await recognitionApi.upload(file);
      setDoc(data);
      setPageId(null);
      setSelId(null);
      recognitionApi.list().then(({ data: d }) => setDocs(d)).catch(() => {});
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось загрузить файл');
    } finally {
      setUploading(false);
    }
  }, [uploading]);

  /* Ctrl+V вставка картинки */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || [])[0];
      if (f && /^(image\/|application\/pdf)/.test(f.type)) uploadFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadFile]);

  /* ── пан/зум/зона ── */
  const toPagePoint = (clientX: number, clientY: number) => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const k = Math.exp(-e.deltaY * 0.0013);
    const z = Math.max(0.05, Math.min(4, v.z * k));
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView({ x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z, z });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.recog-el, .recog-handle')) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    if ((mode === 'zone' || mode === 'draw') && page?.image_url) {
      const p = toPagePoint(e.clientX, e.clientY);
      drag.current = { kind: 'zone', start: p };
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
      if (z.w < 0.01 || z.h < 0.01) return;
      if (mode === 'zone') await runDetect(z);
      if (mode === 'draw') await createManual(z);
      setMode('pan');
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

  /* ── действия ── */
  async function runDetect(zone: Zone) {
    if (!page) return;
    setDetecting(true);
    try {
      const { data } = await recognitionApi.detect(page.id, zone);
      setDoc((d) => d ? { ...d, elements: [...d.elements, ...data.elements] } : d);
      if (data.elements.length === 0) toast('В выбранной зоне ничего не нашлось — попробуйте другую область', { icon: '🤔' });
      else toast.success(`Распознано элементов: ${data.elements.length}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Распознавание не удалось, попробуйте ещё раз');
    } finally {
      setDetecting(false);
    }
  }

  async function createManual(zone: Zone) {
    if (!page) return;
    try {
      const { data } = await recognitionApi.createElement(page.id, { klass: 'other', bbox: zone, fields: {} });
      setDoc((d) => d ? { ...d, elements: [...d.elements, data] } : d);
      setSelId(data.id);
    } catch { toast.error('Не удалось добавить рамку'); }
  }

  async function saveElement(el: RecogElement, patch: Partial<RecogElement>, status?: string) {
    try {
      const { data } = await recognitionApi.updateElement(el.id, { ...patch, ...(status ? { status } : {}) } as any);
      if (data) patchElementLocal(el.id, data as any);
      if (status === 'confirmed') toast.success('Подтверждено — попадёт в лист спецификации');
    } catch { toast.error('Не удалось сохранить'); }
  }

  async function deleteElement(el: RecogElement) {
    try {
      await recognitionApi.removeElement(el.id);
      setDoc((d) => d ? { ...d, elements: d.elements.filter((e) => e.id !== el.id) } : d);
      setSelId(null);
    } catch { toast.error('Не удалось удалить'); }
  }

  async function hidePage(p: RecogPage) {
    if (!confirm(`Убрать страницу ${p.page_index} из документа? Вернуть её будет нельзя.`)) return;
    await recognitionApi.updatePage(p.id, { hidden: true });
    setDoc((d) => d ? { ...d, pages: d.pages.map((x) => (x.id === p.id ? { ...x, hidden: true } : x)) } : d);
    if (page?.id === p.id) setPageId(null);
  }

  async function togglePageConfirmed(p: RecogPage) {
    const { data } = await recognitionApi.updatePage(p.id, { confirmed: !p.confirmed });
    setDoc((d) => d ? { ...d, pages: d.pages.map((x) => (x.id === p.id ? { ...x, ...data } : x)) } : d);
  }

  /* ── лист спецификации ── */
  const specRows = useMemo(() => {
    if (!doc) return [];
    const visibleIds = new Set(visiblePages.map((p) => p.id));
    const els = doc.elements.filter((e) =>
      visibleIds.has(e.page_id) && (e.status === 'confirmed' || e.status === 'corrected') &&
      e.klass !== 'load' && e.klass !== 'other');
    const map = new Map<string, { name: string; klass: string; qty: number; unit: string }>();
    for (const el of els) {
      const f = el.fields || {};
      let name: string, unit = 'шт', add = 1;
      if (el.klass === 'cable') {
        name = `Кабель ${f['Марка'] || ''} ${f['Жилы×сечение'] || ''}`.replace(/\s+/g, ' ').trim();
        unit = 'м';
        add = parseFloat(String(f['Длина, м'] || '').replace(',', '.')) || 0;
      } else {
        const t = f['Тип'] || '', p = f['Полюса'] || '', ch = f['Хар-ка'] || '', a = f['Номинал, А'] || '';
        const kindName: Record<string, string> = {
          rcbo: 'Дифавтомат', rcd: 'УЗО', contactor: 'Контактор', relay: 'Реле',
          meter: 'Счётчик', busbar: 'Шина', panel: 'Щит',
        };
        name = `${kindName[el.klass] || 'Автоматический выключатель'} ${t} ${p}${ch ? `, хар. ${ch}` : ''}${a ? `, ${a} А` : ''}`
          .replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
      }
      const cur = map.get(name) || { name, klass: el.klass, qty: 0, unit };
      cur.qty += add;
      map.set(name, cur);
    }
    return [...map.values()];
  }, [doc, visiblePages]);

  const confirmedCount = useMemo(() =>
    (doc?.elements || []).filter((e) => e.status !== 'auto').length, [doc]);

  async function createSheet() {
    if (!doc) return;
    setCreatingSheet(true);
    try {
      const { data } = await recognitionApi.createSheet(doc.id);
      toast.success(`Лист создан (${data.rowCount} позиций) — папка «Распознавание»`);
      router.push(`/spec/${data.sheetId}`);
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
        /* ── экран выбора/загрузки документа ── */
        <div className="recog-home">
          {!configured && (
            <div className="recog-warn">Распознавание пока не настроено администратором — загрузка и разметка работают, автораспознавание будет недоступно.</div>
          )}
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
            <div className="recog-drop-icon">⇪</div>
            <div className="recog-drop-title">{uploading ? 'Загружаем…' : 'Перетащите PDF или изображение схемы'}</div>
            <div className="recog-drop-sub">или нажмите, чтобы выбрать файл · можно вставить через Ctrl+V · PDF до 200 МБ</div>
            <button className="btn-primary" disabled={uploading}>Загрузить файл</button>
          </div>

          {docs.length > 0 && (
            <div className="recog-doclist">
              <div className="recog-doclist-title">Мои документы</div>
              {docs.map((d) => (
                <div key={d.id} className="recog-docitem" onClick={() => reloadDoc(d.id).then(() => { setPageId(null); setSelId(null); })}>
                  <span className="recog-docname">{d.filename}</span>
                  <span className="recog-docmeta">{d.page_count} стр. · {new Date(d.createdAt).toLocaleDateString('ru-RU')}</span>
                  <button
                    className="recog-docdel" title="Удалить документ"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm('Удалить документ со всей разметкой?')) return;
                      await recognitionApi.remove(d.id);
                      setDocs((list) => list.filter((x) => x.id !== d.id));
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── рабочее пространство документа ── */
        <div className="recog-work">
          {/* левая колонка: страницы */}
          <aside className="recog-pages">
            <div className="recog-pages-head">
              <button className="btn-outline recog-back" onClick={() => { setDoc(null); setSelId(null); }}>← Документы</button>
              <div className="recog-doc-title" title={doc.filename}>{doc.filename}</div>
            </div>
            {visiblePages.map((p) => (
              <div key={p.id} className={`recog-pageitem ${page?.id === p.id ? 'on' : ''}`} onClick={() => { setPageId(p.id); setSelId(null); }}>
                <div className="recog-pagethumb">
                  {p.image_url
                    ? <img src={imgUrl(p)} alt={`Страница ${p.page_index}`} loading="lazy" />
                    : <div className="recog-pagewait">⏳</div>}
                </div>
                <div className="recog-pageinfo">
                  <b>Стр. {p.page_index}</b>
                  <span>{(doc.elements || []).filter((e) => e.page_id === p.id).length} рамок</span>
                  {p.confirmed && <span className="recog-pageok">✓ проверена</span>}
                </div>
                <div className="recog-pageacts">
                  <button title={p.confirmed ? 'Снять отметку' : 'Подтвердить страницу'}
                    className={p.confirmed ? 'ok' : ''}
                    onClick={(e) => { e.stopPropagation(); togglePageConfirmed(p); }}>✓</button>
                  <button title="Убрать страницу (безвозвратно скрыть)"
                    onClick={(e) => { e.stopPropagation(); hidePage(p); }}>×</button>
                </div>
              </div>
            ))}
            {doc.status === 'rendering' && <div className="recog-render-note">Готовим страницы… {visiblePages.filter((p) => p.image_url).length}/{doc.page_count}</div>}
          </aside>

          {/* центр: канвас */}
          <div className="recog-canvas-wrap">
            <div className="recog-canvas-toolbar">
              <button className={mode === 'zone' ? 'btn-primary' : 'btn-outline'}
                disabled={!page?.image_url || detecting || !configured}
                title={configured ? 'Выделите область схемы — ИИ найдёт в ней оборудование' : 'Распознавание не настроено (нет ключа API)'}
                onClick={() => setMode(mode === 'zone' ? 'pan' : 'zone')}>
                ⚡ Распознать зону
              </button>
              <button className={mode === 'draw' ? 'btn-primary' : 'btn-outline'}
                disabled={!page?.image_url}
                title="Нарисовать рамку вручную"
                onClick={() => setMode(mode === 'draw' ? 'pan' : 'draw')}>
                ▭ Добавить рамку
              </button>
              <span className="recog-toolhint">
                {mode === 'zone' ? 'Выделите зону мышкой — распознавание запустится автоматически'
                  : mode === 'draw' ? 'Нарисуйте рамку вокруг элемента'
                  : 'Колесо — масштаб · зажать и тянуть — перемещение'}
              </span>
              <span className="recog-toolspacer" />
              <button className="btn-outline" onClick={() => fitPage()} disabled={!page}>Вписать</button>
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
                    : <div className="recog-pageloading">Страница готовится…</div>}
                  {/* рамки */}
                  {page.width > 0 && pageElements.map((el) => {
                    const c = classColor(el);
                    const sel = el.id === selId;
                    return (
                      <div
                        key={el.id}
                        className={`recog-el ${sel ? 'sel' : ''} ${el.status === 'auto' ? 'auto' : ''}`}
                        style={{
                          left: el.bbox.x * page.width, top: el.bbox.y * page.height,
                          width: el.bbox.w * page.width, height: el.bbox.h * page.height,
                          borderColor: c, background: `${c}14`,
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelId(el.id);
                          if (sel) {
                            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                            drag.current = { kind: 'move', start: toPagePoint(e.clientX, e.clientY), bbox: { ...el.bbox } };
                          }
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      >
                        <span className="recog-el-chip" style={{ color: c, borderColor: c }}>
                          {el.klass} {Math.round((el.confidence || 0) * 100)}%
                          {el.status === 'confirmed' ? ' ✓' : el.status === 'corrected' ? ' ✎' : ''}
                        </span>
                        {sel && ['nw','n','ne','e','se','s','sw','w'].map((h) => (
                          <span
                            key={h} className={`recog-handle rh-${h}`}
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
                  {/* зона выделения */}
                  {zoneDraft && (
                    <div className="recog-zonedraft" style={{ left: zoneDraft.x, top: zoneDraft.y, width: zoneDraft.w, height: zoneDraft.h }} />
                  )}
                </div>
              ) : (
                <div className="recog-nopage">Нет видимых страниц</div>
              )}

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

            {/* нижняя плашка листа спецификации */}
            <div className="recog-specbar" onClick={() => setSpecOpen(true)} role="button" tabIndex={0}>
              <span className="recog-specbar-chev">▲</span>
              <span className="recog-specbar-t">Лист спецификации</span>
              <span className="recog-specbar-m">
                {specRows.length} позиций из подтверждённых рамок · подтверждено {confirmedCount} из {(doc.elements || []).length}
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
                <p>«⚡ Распознать зону» — выделите область, ИИ разметит её автоматически.</p>
              </div>
            ) : (
              <InspectorPanel
                key={selEl.id}
                el={selEl}
                onClose={() => setSelId(null)}
                onSave={(patch, status) => saveElement(selEl, patch, status)}
                onDelete={() => deleteElement(selEl)}
              />
            )}
          </aside>
        </div>
      )}

      {/* модалка листа спецификации */}
      {specOpen && doc && (
        <div className="recog-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSpecOpen(false); }}>
          <div className="recog-modal">
            <div className="recog-modal-head">
              <b>Лист спецификации — {doc.filename}</b>
              <button onClick={() => setSpecOpen(false)}>×</button>
            </div>
            {specRows.length === 0 ? (
              <div className="recog-modal-empty">
                Пока пусто. Подтвердите рамки на схеме (кнопка «Подтвердить» в инспекторе) — подтверждённые элементы попадут сюда.
              </div>
            ) : (
              <table className="recog-spectable">
                <thead><tr><th>№</th><th>Наименование</th><th>Класс</th><th>Кол-во</th><th>Ед.</th></tr></thead>
                <tbody>
                  {specRows.map((r, i) => (
                    <tr key={r.name}>
                      <td>{i + 1}</td>
                      <td>{r.name}</td>
                      <td><span className="recog-klasstag" style={{ color: CLASSES[r.klass]?.color }}>{r.klass}</span></td>
                      <td>{Math.round(r.qty * 100) / 100}</td>
                      <td>{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="recog-modal-note">
              Электроприёмники (класс load) в лист не переносятся. После создания листа цены подтянутся штатно — кнопкой «Цены и сроки».
            </div>
            <div className="recog-modal-foot">
              <button className="btn-outline" onClick={() => setSpecOpen(false)}>Закрыть</button>
              <button className="btn-primary" disabled={!specRows.length || creatingSheet} onClick={createSheet}>
                {creatingSheet ? 'Создаём…' : 'Создать лист в ИНДЕКСАЛЛ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Инспектор ── */
function InspectorPanel({ el, onClose, onSave, onDelete }: {
  el: RecogElement;
  onClose: () => void;
  onSave: (patch: Partial<RecogElement>, status?: string) => void;
  onDelete: () => void;
}) {
  const [klass, setKlass] = useState(el.klass);
  const [designation, setDesignation] = useState(el.designation || '');
  const [fields, setFields] = useState<Record<string, string>>({ ...(el.fields || {}) });
  const [color, setColor] = useState(el.color || '');
  const [newKey, setNewKey] = useState('');

  const collect = (): Partial<RecogElement> => ({ klass, designation, fields, color });
  const warn = el.confidence > 0 && el.confidence < 0.7 && el.status === 'auto';

  return (
    <div className="recog-insp">
      <div className="recog-insp-head">
        <b>{designation || CLASSES[klass]?.name || 'Элемент'}</b>
        <button onClick={onClose} title="Закрыть">×</button>
      </div>
      <div className="recog-insp-status">
        <span className={`recog-pill st-${el.status}`}>
          {el.status === 'auto' ? 'ИИ' : el.status === 'confirmed' ? 'Подтверждён' : 'Исправлен'}
        </span>
        {el.confidence > 0 && (
          <span className={`recog-conf ${warn ? 'warn' : ''}`}>уверенность {Math.round(el.confidence * 100)}%{warn ? ' — проверьте' : ''}</span>
        )}
      </div>

      <label>Класс оборудования</label>
      <select value={klass} onChange={(e) => setKlass(e.target.value)}>
        {Object.entries(CLASSES).map(([k, c]) => <option key={k} value={k}>{k} — {c.name}</option>)}
      </select>

      <label>Обозначение (QF1, Гр.2…)</label>
      <input value={designation} onChange={(e) => setDesignation(e.target.value)} />

      {Object.entries(fields).map(([k, v]) => (
        <div key={k} className="recog-fieldrow">
          <label>{k}</label>
          <div className="recog-fieldline">
            <input value={v} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))} />
            <button title="Убрать параметр" onClick={() => setFields((f) => { const n = { ...f }; delete n[k]; return n; })}>×</button>
          </div>
        </div>
      ))}
      <div className="recog-addfield">
        <input placeholder="Новый параметр (напр. Номинал, А)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <button className="btn-outline" disabled={!newKey.trim()}
          onClick={() => { setFields((f) => ({ ...f, [newKey.trim()]: '' })); setNewKey(''); }}>+</button>
      </div>

      <label>Цвет рамки</label>
      <div className="recog-colorline">
        <input type="color" value={color || CLASSES[klass]?.color || '#64748b'} onChange={(e) => setColor(e.target.value)} />
        {color && <button className="btn-outline" onClick={() => setColor('')}>Цвет класса</button>}
      </div>

      <div className="recog-insp-btns">
        <button className="btn-primary" onClick={() => onSave(collect(), 'confirmed')}>✓ Подтвердить</button>
        <button className="btn-outline" onClick={() => onSave(collect(), 'corrected')}>Сохранить</button>
      </div>
      <button className="recog-insp-del" onClick={onDelete}>Удалить элемент</button>
      <p className="recog-insp-hint">
        Подтверждённые и исправленные рамки попадают в лист спецификации и копятся в датасет для дообучения модели.
      </p>
    </div>
  );
}
