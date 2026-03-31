'use client';
import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { sheetsApi, projectsApi, catalogApi, exportApi, storesApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

const MAX_UNDO = 30;

const STATIC_BRANDS = ['IEK', 'EKF', 'Chint', 'КЗАЗ', 'DEKraft', 'DKC', 'TDM'];

function fmtNum(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function calcTotal(price: string, qty: string, coef: string) {
  const p = parseFloat(price) || 0;
  const q = parseFloat(qty) || 0;
  const c = parseFloat(coef) || 1;
  return p && q ? fmtNum(p * q * c) : '';
}

// ── SpecRow ────────────────────────────────────────────────────
interface RowProps {
  row: any;
  idx: number;
  isFirst: boolean;
  onUpdate: (i: number, field: string, value: any) => void;
  onSearch: (q: string, rowIdx: number, field: string, el: HTMLInputElement) => void;
  onKeyDown: (e: React.KeyboardEvent, rowIdx: number) => void;
  onStoreClick: (rowIdx: number, el: HTMLSelectElement) => void;
  inputRef: (el: HTMLInputElement | null, key: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

const SpecRow = memo(function SpecRow({
  row, idx, isFirst, onUpdate, onSearch, onKeyDown, onStoreClick, inputRef, onFocus, onBlur,
}: RowProps) {
  return (
    <tr>
      <td className="col-num">{idx + 1}</td>
      <td className="col-name" style={{ position: 'relative' }}>
        <input
          ref={el => inputRef(el, `name-${idx}`)}
          value={row.name || ''}
          placeholder={isFirst ? 'Можно вводить текст здесь и система подберёт варианты' : ''}
          onChange={e => { onUpdate(idx, 'name', e.target.value); onSearch(e.target.value, idx, 'name', e.target as HTMLInputElement); }}
          onKeyDown={e => onKeyDown(e, idx)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-brand">
        <input
          value={row.brand || ''}
          onChange={e => onUpdate(idx, 'brand', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-article">
        <input
          value={row.article || ''}
          onChange={e => { onUpdate(idx, 'article', e.target.value); onSearch(e.target.value, idx, 'article', e.target as HTMLInputElement); }}
          onKeyDown={e => onKeyDown(e, idx)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-qty">
        <input
          value={row.qty || ''}
          onChange={e => onUpdate(idx, 'qty', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-unit">
        <input
          value={row.unit || ''}
          onChange={e => onUpdate(idx, 'unit', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-price">
        <input
          value={row.price || ''}
          onChange={e => { onUpdate(idx, 'price', e.target.value); onUpdate(idx, 'auto_price', false); }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-store">
        <select
          value={row.store ?? ''}
          onChange={e => onUpdate(idx, 'store', e.target.value)}
          onClick={e => onStoreClick(idx, e.target as HTMLSelectElement)}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value="ЭТМ">ЭТМ</option>
          <option value="EKF">EKF</option>
          <option value="">—</option>
        </select>
      </td>
      <td className="col-coef">
        <input
          value={row.coef || '1'}
          onChange={e => onUpdate(idx, 'coef', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
      <td className="col-total">{row.total && row.total !== 'NaN' ? row.total : ''}</td>
      <td className="col-deadline">
        <input
          value={row.deadline || ''}
          placeholder="—"
          onChange={e => onUpdate(idx, 'deadline', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </td>
    </tr>
  );
});

// ── Page ──────────────────────────────────────────────────────
export default function SpecPage() {
  const { id: _routeId } = useParams();
  const router = useRouter();
  const { activeProjectId, setUnsaved: _setUnsaved, setActive } = useAppStore();

  // Active sheet ID — drives all data loading without URL navigation
  const [currentId, setCurrentId] = useState(() => Number(_routeId));
  const currentIdRef = useRef(Number(_routeId));
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);

  const setUnsaved = useCallback((v: boolean) => {
    _setUnsaved(v);
    hasUnsavedRef.current = v;
    if (v) {
      // Debounced auto-save: 3s after last change
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        if (!hasUnsavedRef.current) return;
        const toSave = rowsRef.current.filter((r: any) => r.name || r.article);
        try {
          await sheetsApi.saveRows(currentIdRef.current, toSave);
          hasUnsavedRef.current = false;
          _setUnsaved(false);
        } catch { /* silent, user can save manually */ }
      }, 3000);
    }
  }, [_setUnsaved]);
  const [sheet, setSheet] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acDrops, setAcDrops] = useState<{ rowIdx: number; field: string; results: any[]; rect: DOMRect } | null>(null);
  const [acFocus, setAcFocus] = useState(-1);
  const [storeDropdown, setStoreDropdown] = useState<{ rowIdx: number; rect: DOMRect; offers: any[] } | null>(null);

  // Brand filter + global search
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [brands, setBrands] = useState<string[]>(STATIC_BRANDS);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<any[]>([]);
  const globalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sheet tabs renaming
  const [renamingSheetId, setRenamingSheetId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // Paste modal (fallback for HTTP — no clipboard API access)
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Undo / Redo stacks — persisted in sessionStorage per sheet
  const undoKey = `undo_${currentId}`;
  const redoKey = `redo_${currentId}`;
  const [undoStack, setUndoStack] = useState<any[][]>(() => {
    try { const s = sessionStorage.getItem(`undo_${Number(_routeId)}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [redoStack, setRedoStack] = useState<any[][]>(() => {
    try { const s = sessionStorage.getItem(`redo_${Number(_routeId)}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef<any[]>([]);
  const hasUnsavedRef = useRef(false);
  const focusSnapshotRef = useRef<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Persist undo/redo stacks to sessionStorage on every change
  useEffect(() => {
    try { sessionStorage.setItem(undoKey, JSON.stringify(undoStack)); } catch { /* quota exceeded — ignore */ }
  }, [undoStack, undoKey]);
  useEffect(() => {
    try { sessionStorage.setItem(redoKey, JSON.stringify(redoStack)); } catch { /* quota exceeded — ignore */ }
  }, [redoStack, redoKey]);

  const setInputRef = useCallback((el: HTMLInputElement | null, key: string) => {
    if (el) inputRefs.current.set(key, el);
  }, []);

  const pushHistorySnapshot = useCallback((snap: any[]) => {
    const clone = JSON.parse(JSON.stringify(snap));
    setUndoStack((u) => {
      const last = u[u.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(clone)) return u;
      return [...u, clone].slice(-MAX_UNDO);
    });
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const snap = stack[stack.length - 1];
      setRedoStack((r) => [...r, JSON.parse(JSON.stringify(rowsRef.current))]);
      setRows(snap);
      setUnsaved(true);
      toast('↩ Действие отменено', { icon: '' });
      return stack.slice(0, -1);
    });
  }, [setUnsaved]);

  const handleRedo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const snap = stack[stack.length - 1];
      setUndoStack((s) => [...s, JSON.parse(JSON.stringify(rowsRef.current))]);
      setRows(snap);
      setUnsaved(true);
      toast('↪ Действие повторено', { icon: '' });
      return stack.slice(0, -1);
    });
  }, [setUnsaved]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  // Auto-save: save on page hide/unload
  useEffect(() => {
    async function autoSaveNow() {
      if (!hasUnsavedRef.current) return;
      const toSave = rowsRef.current.filter((r: any) => r.name || r.article);
      try {
        await sheetsApi.saveRows(currentIdRef.current, toSave);
        hasUnsavedRef.current = false;
        _setUnsaved(false);
      } catch { /* silent */ }
    }
    const handleVisibility = () => { if (document.visibilityState === 'hidden') autoSaveNow(); };
    const handleUnload = () => autoSaveNow();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      autoSaveNow(); // save on component unmount (navigation)
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [_setUnsaved]);

  useEffect(() => {
    loadData();
    if (currentId === Number(_routeId)) loadBrands(); // only on first mount
    const close = () => { setAcDrops(null); setStoreDropdown(null); setGlobalResults([]); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [currentId]);

  async function loadBrands() {
    try {
      const { data } = await catalogApi.getManufacturers();
      const names: string[] = (data as any[])
        .filter((m: any) => m.is_active)
        .map((m: any) => m.name)
        .slice(0, 12);
      if (names.length > 0) setBrands(names);
    } catch { /* keep static list */ }
  }

  async function loadData() {
    try {
      setLoading(true);
      const { data: s } = await sheetsApi.getOne(currentIdRef.current);
      setSheet(s);
      const dbRows = s.rows || [];
      const cleanNum = (v: any, fallback = '') => {
        if (v === null || v === undefined || v === '') return fallback;
        const n = parseFloat(String(v));
        return isNaN(n) ? fallback : String(n);
      };
      const normalizedRows = dbRows.map((r: any) => {
        const qty   = cleanNum(r.qty);
        const price = cleanNum(r.price);
        const coef  = cleanNum(r.coef, '1') || '1';
        return { ...r, qty, price, coef, total: calcTotal(price, qty, coef) };
      });
      const padded = [...normalizedRows];
      while (padded.length < 25) {
        padded.push({ row_number: padded.length + 1, name: '', brand: '', article: '', qty: '', unit: '', price: '', store: 'ЭТМ', coef: '1', total: '', deadline: '' });
      }
      setRows(padded);
      rowsRef.current = padded;
      // Restore undo/redo from sessionStorage for this sheet
      try {
        const u = sessionStorage.getItem(`undo_${currentIdRef.current}`);
        const r = sessionStorage.getItem(`redo_${currentIdRef.current}`);
        setUndoStack(u ? JSON.parse(u) : []);
        setRedoStack(r ? JSON.parse(r) : []);
      } catch {
        setUndoStack([]);
        setRedoStack([]);
      }
      // Load project — use activeProjectId from store or fall back to sheet's projectId
      const projId = activeProjectId || s.projectId;
      if (projId) {
        const { data: p } = await projectsApi.getOne(projId);
        setProject(p);
        // Always keep store in sync so catalog page can find the open sheet after refresh
        setActive(projId, currentIdRef.current);
      }
    } catch { toast.error('Ошибка загрузки листа'); }
    finally { setLoading(false); }
  }

  const handleCellFocus = useCallback(() => {
    focusSnapshotRef.current = JSON.parse(JSON.stringify(rowsRef.current));
  }, []);

  const handleCellBlur = useCallback(() => {
    if (!focusSnapshotRef.current) return;
    if (JSON.stringify(rowsRef.current) !== JSON.stringify(focusSnapshotRef.current)) {
      pushHistorySnapshot(focusSnapshotRef.current);
    }
    focusSnapshotRef.current = null;
  }, [pushHistorySnapshot]);

  const updateRow = useCallback((i: number, field: string, value: any) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (['price', 'qty', 'coef'].includes(field)) {
        const r = next[i];
        next[i].total = calcTotal(r.price, r.qty, r.coef);
      }
      return next;
    });
    setUnsaved(true);
  }, [setUnsaved]);

  const applyProduct = useCallback((i: number, p: any) => {
    const snap = focusSnapshotRef.current ?? JSON.parse(JSON.stringify(rowsRef.current));
    pushHistorySnapshot(snap);
    focusSnapshotRef.current = null;
    setRows((prev) => {
      const next = [...prev];
      const q = next[i].qty;
      const c = next[i].coef;
      next[i] = {
        ...next[i],
        name: p.name,
        brand: p.manufacturer?.name || p.brand || '',
        article: p.article || '',
        unit: p.unit || '',
        price: p.price ? String(p.price) : '',
        store: 'ЭТМ',
        auto_price: true,
        total: calcTotal(p.price ? String(p.price) : '', q, c),
      };
      return next;
    });
    setAcDrops(null);
    setUnsaved(true);
  }, [pushHistorySnapshot, setUnsaved]);

  // Add product from global search to the next empty row
  const addProductFromSearch = useCallback((p: any) => {
    pushHistorySnapshot(rowsRef.current);
    setRows((prev) => {
      const next = [...prev];
      const emptyIdx = next.findIndex(r => !r.name && !r.article);
      const targetIdx = emptyIdx >= 0 ? emptyIdx : next.length - 1;
      next[targetIdx] = {
        ...next[targetIdx],
        name: p.name,
        brand: p.manufacturer?.name || p.brand || '',
        article: p.article || '',
        unit: p.unit || '',
        price: p.price ? String(p.price) : '',
        store: 'ЭТМ',
        auto_price: true,
        total: calcTotal(p.price ? String(p.price) : '', next[targetIdx].qty || '', next[targetIdx].coef || '1'),
      };
      return next;
    });
    setGlobalSearch('');
    setGlobalResults([]);
    setUnsaved(true);
  }, [pushHistorySnapshot, setUnsaved]);

  async function searchCatalog(q: string, rowIdx: number, field: string, el: HTMLInputElement) {
    if (!q || q.length < 2) { setAcDrops(null); return; }
    const { data } = await catalogApi.search(q);
    let results = data as any[];
    if (brandFilter !== 'all') {
      results = results.filter((p: any) =>
        (p.manufacturer?.name || p.brand || '').toLowerCase() === brandFilter.toLowerCase()
      );
    }
    if (results.length === 0) { setAcDrops(null); return; }
    setAcDrops({ rowIdx, field, results, rect: el.getBoundingClientRect() });
    setAcFocus(-1);
  }

  const debouncedSearch = useCallback((q: string, rowIdx: number, field: string, el: HTMLInputElement) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchCatalog(q, rowIdx, field, el), 300);
  }, [brandFilter]);

  async function handleGlobalSearch(q: string) {
    setGlobalSearch(q);
    if (globalSearchTimer.current) clearTimeout(globalSearchTimer.current);
    if (!q || q.length < 2) { setGlobalResults([]); return; }
    globalSearchTimer.current = setTimeout(async () => {
      try {
        const { data } = await catalogApi.search(q);
        let results = data as any[];
        if (brandFilter !== 'all') {
          results = results.filter((p: any) =>
            (p.manufacturer?.name || p.brand || '').toLowerCase() === brandFilter.toLowerCase()
          );
        }
        setGlobalResults(results.slice(0, 10));
      } catch { setGlobalResults([]); }
    }, 300);
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent, rowIdx: number) => {
    setAcDrops(current => {
      if (!current || current.rowIdx !== rowIdx) return current;
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcFocus(f => Math.min(f + 1, current.results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setAcFocus(f => Math.max(f - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        setAcFocus(f => { if (f >= 0) applyProduct(rowIdx, current.results[f]); return f; });
      }
      else if (e.key === 'Escape') return null;
      return current;
    });
  }, [applyProduct]);

  const openStoreDropdown = useCallback(async (rowIdx: number, el: HTMLSelectElement) => {
    const article = rowsRef.current[rowIdx]?.article;
    if (!article) return;
    try {
      const { data } = await storesApi.getOffersByArticle(article);
      if (data.length > 0) setStoreDropdown({ rowIdx, rect: el.getBoundingClientRect(), offers: data });
    } catch { /* no offers */ }
  }, []);

  function applyStoreOffer(rowIdx: number, offer: any) {
    pushHistorySnapshot(rowsRef.current);
    setRows((prev) => {
      const next = [...prev];
      const r = { ...next[rowIdx], store: offer.store_name };
      if (offer.price) {
        r.price = String(offer.price);
        r.auto_price = false;
        r.total = calcTotal(r.price, r.qty, r.coef);
      }
      next[rowIdx] = r;
      return next;
    });
    setStoreDropdown(null);
    setUnsaved(true);
  }

  async function addSheet() {
    if (!activeProjectId) return;
    try {
      const { data } = await sheetsApi.create(activeProjectId);
      setProject((p: any) => p ? { ...p, sheets: [...(p.sheets || []), data] } : p);
      toast.success('Лист добавлен');
    } catch { toast.error('Ошибка'); }
  }

  function startRenameSheet(s: any) {
    setRenamingSheetId(s.id);
    setRenameVal(s.name);
  }

  async function commitRenameSheet() {
    if (!renamingSheetId || !renameVal.trim()) { setRenamingSheetId(null); return; }
    try {
      await sheetsApi.update(renamingSheetId, { name: renameVal.trim() });
      setProject((p: any) => p ? {
        ...p,
        sheets: p.sheets?.map((s: any) => s.id === renamingSheetId ? { ...s, name: renameVal.trim() } : s),
      } : p);
      if (sheet?.id === renamingSheetId) setSheet((s: any) => s ? { ...s, name: renameVal.trim() } : s);
    } catch { toast.error('Ошибка переименования'); }
    setRenamingSheetId(null);
  }

  async function saveRows() {
    try {
      const toSave = rows.filter(r => r.name || r.article);
      await sheetsApi.saveRows(currentIdRef.current, toSave);
      setUnsaved(false);
      toast.success('Сохранено');
    } catch { toast.error('Ошибка сохранения'); }
  }

  // ── Clipboard: copy sheet as TSV ──────────────────────────────
  function copySheetToClipboard() {
    const COLS = ['Название', 'Бренд', 'Артикул', 'Кол-во', 'Ед.изм', 'Цена', 'Магазин', 'Коэф.', 'Итого'];
    const dataRows = rows.filter(r => r.name || r.article);
    const lines = [COLS.join('\t')];
    dataRows.forEach(r => {
      lines.push([
        r.name || '', r.brand || '', r.article || '',
        r.qty || '', r.unit || '', r.price || '',
        r.store || '', r.coef || '1', r.total || '',
      ].join('\t'));
    });
    const tsv = lines.join('\n');

    // Try modern API first, fall back to execCommand
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(tsv)
        .then(() => toast.success(`Скопировано ${dataRows.length} строк — вставьте в Excel или Google Таблицы`))
        .catch(() => execCopy(tsv, dataRows.length));
    } else {
      execCopy(tsv, dataRows.length);
    }
  }

  function execCopy(text: string, count: number) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      toast.success(`Скопировано ${count} строк — вставьте в Excel или Google Таблицы`);
    } catch {
      toast.error('Не удалось скопировать. Выделите таблицу вручную (Ctrl+A) и скопируйте (Ctrl+C)');
    } finally {
      document.body.removeChild(ta);
    }
  }

  // ── Clipboard: paste TSV from Excel / Google Sheets ───────────
  const HEADER_MAP: Record<string, string> = {
    'название': 'name', 'name': 'name', 'наименование': 'name',
    'бренд': 'brand', 'brand': 'brand', 'производитель': 'brand',
    'артикул': 'article', 'article': 'article', 'арт': 'article',
    'кол-во': 'qty', 'количество': 'qty', 'qty': 'qty', 'кол': 'qty',
    'ед.изм': 'unit', 'ед. изм': 'unit', 'единица': 'unit', 'unit': 'unit',
    'цена': 'price', 'price': 'price',
    'магазин': 'store', 'store': 'store', 'поставщик': 'store',
    'коэф.': 'coef', 'коэф': 'coef', 'коэффициент': 'coef', 'coef': 'coef',
  };
  const DEFAULT_ORDER = ['name', 'brand', 'article', 'qty', 'unit', 'price', 'store', 'coef'];

  function parseTSV(text: string): any[] {
    const lines = text.split('\n').map(l => l.replace(/\r$/, '').split('\t'));
    if (lines.length === 0) return [];

    // Detect if first row is headers
    let fieldMap: string[] = DEFAULT_ORDER;
    let startRow = 0;
    const firstRow = lines[0].map(h => h.trim().toLowerCase());
    const matchedCount = firstRow.filter(h => HEADER_MAP[h]).length;
    if (matchedCount >= 2) {
      fieldMap = firstRow.map(h => HEADER_MAP[h] || '');
      startRow = 1;
    }

    return lines.slice(startRow)
      .filter(cols => cols.some(c => c.trim()))
      .map(cols => {
        const row: any = { name: '', brand: '', article: '', qty: '', unit: 'шт', price: '', store: '', coef: '1' };
        fieldMap.forEach((field, ci) => {
          if (field && cols[ci] !== undefined) row[field] = cols[ci].trim();
        });
        row.total = calcTotal(row.price, row.qty, row.coef);
        return row;
      });
  }

  function applyParsedRows(text: string) {
    if (!text.trim()) { toast('Буфер обмена пуст'); return; }
    const parsed = parseTSV(text);
    if (parsed.length === 0) { toast('Не удалось распознать данные — убедитесь, что скопированы строки из Excel или Google Таблиц'); return; }
    pushHistorySnapshot(rowsRef.current);
    setRows(prev => {
      const existing = prev.filter(r => r.name || r.article);
      const merged = [...existing, ...parsed];
      while (merged.length < 25) merged.push({ name: '', brand: '', article: '', qty: '', unit: '', price: '', store: 'ЭТМ', coef: '1', total: '' });
        return merged;
      });
      setUnsaved(true);
      setShowPasteModal(false);
    setPasteText('');
    toast.success(`Вставлено ${parsed.length} строк`);
  }

  async function pasteFromClipboard() {
    // Try modern Clipboard API (works on HTTPS)
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        applyParsedRows(text);
        return;
      } catch { /* fall through to modal */ }
    }
    // Fallback: show modal where user pastes manually
    setPasteText('');
    setShowPasteModal(true);
  }

  // Handle Ctrl+V on the table body — paste if clipboard has multi-column TSV
  async function handleTablePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t')) return; // single cell — let browser handle it
    const parsed = parseTSV(text);
    if (parsed.length === 0) return;
    e.preventDefault();
    pushHistorySnapshot(rowsRef.current);
    setRows(prev => {
      const existing = prev.filter(r => r.name || r.article);
      const merged = [...existing, ...parsed];
      while (merged.length < 25) merged.push({ name: '', brand: '', article: '', qty: '', unit: '', price: '', store: 'ЭТМ', coef: '1', total: '' });
      return merged;
    });
    setUnsaved(true);
    toast.success(`Вставлено ${parsed.length} строк`);
  }

  async function handleExport() {
    if (!activeProjectId) return;
    const choice = confirm('Экспортировать весь проект?\nОК — весь проект, Отмена — только этот лист');
    try {
      const { data } = await exportApi.xlsx(activeProjectId, choice ? undefined : currentIdRef.current);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a'); a.href = url; a.download = 'спецификация.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Ошибка экспорта'); }
  }

  async function handleRefreshPrices() {
    const targets = rowsRef.current
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.article && r.auto_price !== false);
    if (targets.length === 0) { toast('Нет строк с артикулом для обновления цены'); return; }
    setRefreshing(true);
    let updated = 0;
    const snap = JSON.parse(JSON.stringify(rowsRef.current));
    for (const { r, i } of targets) {
      try {
        const { data: offers } = await storesApi.getOffersByArticle(r.article);
        const offer = (offers as any[]).find((o: any) => o.price);
        if (offer?.price) {
          setRows(prev => {
            const next = [...prev];
            const price = String(offer.price);
            next[i] = { ...next[i], price, total: calcTotal(price, next[i].qty, next[i].coef), store: offer.store_name || next[i].store };
            return next;
          });
          updated++;
        }
      } catch { /* skip this row */ }
    }
    setRefreshing(false);
    if (updated > 0) {
      pushHistorySnapshot(snap);
      setUnsaved(true);
      toast.success(`Обновлено цен: ${updated} из ${targets.length}`);
    } else {
      toast('Актуальные цены не найдены');
    }
  }

  const sheetTotal = rows.reduce((s, r) => {
    const p = parseFloat(r.price) || 0, q = parseFloat(r.qty) || 0, c = parseFloat(r.coef) || 1;
    return s + p * q * c;
  }, 0);

  const projectSheets: any[] = project?.sheets || [];

  if (loading) return <div style={{ paddingTop: 80, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>;

  return (
    <>
      <Header
        breadcrumb={`Проект: ${project?.name || '…'}`}
        projectCost={project ? `Стоимость: ${fmtNum(project.total || 0)} ₽` : ''}
        showSave
        onSave={saveRows}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        undoCount={undoStack.length > 0 ? undoStack.length : undefined}
      />

      <div className="spec-screen">
        {/* ── Main toolbar ── */}
        <div className="spec-toolbar">
          <button className="btn-primary" onClick={() => router.push('/catalog')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            Добавить из каталога
          </button>
          <button className="btn-outline" onClick={() => router.push('/templates')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Вставить шаблон
          </button>
          <button className="btn-outline" title="Скопировать лист как таблицу (для Excel / Google Таблиц)" onClick={copySheetToClipboard}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Копировать
          </button>
          <button className="btn-outline" title="Вставить строки из Excel / Google Таблиц (Ctrl+V)" onClick={pasteFromClipboard}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            Вставить
          </button>
          <div style={{ flex: 1 }} />
          <div className="spec-summary">
            <span className="spec-summary-item">
              <span className="spec-summary-label">Сумма листа:</span>
              <span className="spec-summary-value">{fmtNum(sheetTotal)} ₽</span>
            </span>
            <span className="spec-summary-sep">|</span>
            <span className="spec-summary-item">
              <span className="spec-summary-label">Срок:</span>
              <span className="spec-summary-value">0 дн.</span>
            </span>
            <button className="btn-outline" style={{ marginLeft: 8, padding: '5px 10px', fontSize: 12 }} onClick={handleExport}>
              ↓ Excel
            </button>
            <button
              className="btn-outline"
              style={{ marginLeft: 6, padding: '5px 10px', fontSize: 12 }}
              onClick={handleRefreshPrices}
              disabled={refreshing}
              title="Обновить цены по артикулам из ЭТМ"
            >
              {refreshing ? '…' : '↻ Цены'}
            </button>
          </div>
        </div>

        {/* ── Brand filter chips ── */}
        <div className="spec-brand-bar">
          <button
            className={`brand-chip${brandFilter === 'all' ? ' active' : ''}`}
            onClick={() => setBrandFilter('all')}
          >
            Все бренды
          </button>
          {brands.map(b => (
            <button
              key={b}
              className={`brand-chip${brandFilter === b ? ' active' : ''}`}
              onClick={() => setBrandFilter(brandFilter === b ? 'all' : b)}
            >
              {b}
            </button>
          ))}
          <button className="brand-chip" style={{ color: 'var(--muted)' }}>+ добавить фильтр</button>
        </div>

        {/* ── Global catalog search ── */}
        <div className="spec-search-bar" onClick={e => e.stopPropagation()}>
          <div className="spec-search-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={globalSearch}
              onChange={e => handleGlobalSearch(e.target.value)}
              placeholder="Введите название, артикул, или ключевые параметры. Например: ВА47 25А С или АВДТ 9Р-N 30мА С16"
            />
            {globalSearch && (
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, padding: '0 4px' }} onClick={() => { setGlobalSearch(''); setGlobalResults([]); }}>×</button>
            )}
          </div>
          {globalResults.length > 0 && (
            <div className="global-search-dropdown">
              {globalResults.map((p: any) => (
                <div key={p.id} className="ac-item" onMouseDown={e => e.preventDefault()} onClick={() => addProductFromSearch(p)}>
                  <span className="ac-item-brand">{p.manufacturer?.name || ''}</span>
                  <span className="ac-item-name">{p.name}</span>
                  <span className="ac-item-article">{p.article}</span>
                  {p.price && <span className="ac-item-meta">{p.price} ₽</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sheet tabs ── */}
        {projectSheets.length > 0 && (
          <div className="sheet-tabs">
            {projectSheets.map((s: any) => (
              <div key={s.id} className={`sheet-tab${currentId === s.id ? ' active' : ''}`}>
                {renamingSheetId === s.id ? (
                  <input
                    className="sheet-tab-rename"
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onBlur={commitRenameSheet}
                    onKeyDown={e => e.key === 'Enter' && commitRenameSheet()}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={async () => {
                      if (currentId === s.id) return;
                      // Auto-save current sheet before switching
                      if (hasUnsavedRef.current) {
                        const toSave = rowsRef.current.filter((r: any) => r.name || r.article);
                        try { await sheetsApi.saveRows(currentIdRef.current, toSave); hasUnsavedRef.current = false; _setUnsaved(false); } catch {}
                      }
                      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
                      setCurrentId(s.id);
                      window.history.replaceState(null, '', `/spec/${s.id}`);
                    }}
                    onDoubleClick={() => startRenameSheet(s)}
                  >
                    {s.name}
                  </span>
                )}
                {currentId === s.id && (
                  <button className="sheet-tab-edit" title="Переименовать" onClick={e => { e.stopPropagation(); startRenameSheet(s); }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                )}
              </div>
            ))}
            <button className="sheet-tab-add" title="Добавить лист" onClick={addSheet}>+</button>
          </div>
        )}

        {/* ── Table ── */}
        <div className="spec-table-wrap">
          <table className="spec-table">
            <thead>
              <tr>
                <th className="col-num">№</th>
                <th className="col-name">Название</th>
                <th className="col-brand">Бренд</th>
                <th className="col-article">Артикул</th>
                <th className="col-qty">Кол-во</th>
                <th className="col-unit">Ед.изм</th>
                <th className="col-price">Цена</th>
                <th className="col-store">Магазин</th>
                <th className="col-coef">Коэф.</th>
                <th className="col-total">Итого</th>
                <th className="col-deadline">Срок</th>
              </tr>
            </thead>
            <tbody onPaste={handleTablePaste}>
              {rows.map((row, i) => (
                <SpecRow
                  key={i}
                  row={row}
                  idx={i}
                  isFirst={i === 0}
                  onUpdate={updateRow}
                  onSearch={debouncedSearch}
                  onKeyDown={handleKeyDown}
                  onStoreClick={openStoreDropdown}
                  inputRef={setInputRef}
                  onFocus={handleCellFocus}
                  onBlur={handleCellBlur}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Autocomplete dropdown */}
      {acDrops && (
        <div
          className="ac-dropdown"
          style={{ top: acDrops.rect.bottom + 2, left: acDrops.rect.left }}
          onMouseDown={e => e.preventDefault()}
        >
          {acDrops.results.map((p, i) => (
            <div
              key={p.id}
              className={`ac-item${i === acFocus ? ' focused' : ''}`}
              onClick={() => applyProduct(acDrops.rowIdx, p)}
            >
              <span className="ac-item-brand">{p.manufacturer?.name || ''}</span>
              <span className="ac-item-name">{p.name}</span>
              <span className="ac-item-article">{p.article}</span>
              {p.price && <span className="ac-item-meta">{p.price} ₽</span>}
            </div>
          ))}
        </div>
      )}

      {/* Store offers dropdown */}
      {storeDropdown && (
        <div
          className="store-dropdown"
          style={{ top: storeDropdown.rect.bottom + 2, left: storeDropdown.rect.left }}
          onMouseDown={e => e.preventDefault()}
        >
          {storeDropdown.offers.map((o, i) => (
            <div key={i} className="store-offer-item" onClick={() => applyStoreOffer(storeDropdown.rowIdx, o)}>
              <span className="store-offer-name">{o.store_name}</span>
              <span className="store-offer-price">{o.price ? `${o.price} ₽` : '—'}</span>
              <span className="store-offer-avail">{o.availability || ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Paste modal — fallback for HTTP (no clipboard API) */}
      {showPasteModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowPasteModal(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 28, width: 560, maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>Вставить из Excel / Google Таблиц</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)' }}>
              Скопируйте строки в Excel или Google Таблицах (Ctrl+C), затем нажмите в поле ниже и вставьте (Ctrl+V):
            </p>
            <textarea
              autoFocus
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              onPaste={e => {
                const text = e.clipboardData.getData('text/plain');
                e.preventDefault();
                setPasteText(text);
                setTimeout(() => applyParsedRows(text), 0);
              }}
              placeholder="Нажмите сюда и вставьте данные (Ctrl+V)"
              style={{ width: '100%', minHeight: 120, fontSize: 12, fontFamily: 'monospace', border: '1px solid var(--border)', borderRadius: 6, padding: 10, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setShowPasteModal(false)}>Отмена</button>
              <button className="btn-primary" onClick={() => applyParsedRows(pasteText)}>Вставить</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
