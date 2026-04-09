'use client';
import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import ImportModal from '@/components/ImportModal';
import { sheetsApi, projectsApi, catalogApi, exportApi, storesApi, templatesApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

const MAX_UNDO = 30;
const STATIC_BRANDS = ['IEK', 'EKF', 'Chint', 'КЗАЗ', 'DEKraft', 'DKC', 'TDM'];

// Column order for the editable cells (col indices 0-8)
const EDITABLE_COLS = ['name', 'brand', 'article', 'qty', 'unit', 'price', 'store', 'coef', 'deadline'] as const;
type EditableCol = typeof EDITABLE_COLS[number];

function fmtNum(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// Accepts both "1.2" and "1,2" (Russian locale decimal separator)
function parseNum(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? fallback : n;
}

function calcTotal(price: string, qty: string, coef: string) {
  const p = parseNum(price);
  const q = parseNum(qty);
  const c = parseNum(coef, 1);
  return p && q ? fmtNum(p * q * c) : '';
}

// ── SpecRow ────────────────────────────────────────────────────
interface RowProps {
  row: any;
  idx: number;
  isFirst: boolean;
  onUpdate: (i: number, field: string, value: any) => void;
  onSearch: (q: string, rowIdx: number, field: string, el: HTMLInputElement) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => void;
  onStoreClick: (rowIdx: number, el: HTMLSelectElement) => void;
  inputRef: (el: HTMLElement | null, key: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onNonEditableMouseDown: (e: React.MouseEvent) => void;
  // Selection
  activeCellRow: number;
  activeCellCol: number;
  isEditing: boolean;
  selR1: number; selC1: number; selR2: number; selC2: number;
  onCellMouseDown: (rowIdx: number, colIdx: number, e: React.MouseEvent) => void;
  onCellMouseEnter: (rowIdx: number, colIdx: number) => void;
  onCellDoubleClick: (rowIdx: number, colIdx: number) => void;
  onRowContextMenu: (rowIdx: number, x: number, y: number) => void;
}

const SpecRow = memo(function SpecRow({
  row, idx, isFirst, onUpdate, onSearch, onInputKeyDown, onStoreClick, inputRef, onFocus, onBlur,
  onNonEditableMouseDown,
  activeCellRow, activeCellCol, isEditing, selR1, selC1, selR2, selC2,
  onCellMouseDown, onCellMouseEnter, onCellDoubleClick, onRowContextMenu,
}: RowProps) {
  const isActive = (col: number) => activeCellRow === idx && activeCellCol === col;
  const inRange = (col: number) => idx >= selR1 && idx <= selR2 && col >= selC1 && col <= selC2;
  const cellEditing = (col: number) => isActive(col) && isEditing;
  // "Итого" sits between coef (col 7) and deadline (col 8) — highlight when selection spans both sides
  const isTotalInRange = idx >= selR1 && idx <= selR2 && selC1 <= 7 && selC2 >= 8;

  const tdAttrs = (col: number, baseClass: string, extraStyle?: React.CSSProperties) => {
    const classes = [baseClass];
    if (inRange(col)) classes.push('cell-selected');
    if (isActive(col)) classes.push('cell-active');
    return {
      className: classes.join(' '),
      style: extraStyle,
      onMouseDown: (e: React.MouseEvent) => onCellMouseDown(idx, col, e),
      onMouseEnter: () => onCellMouseEnter(idx, col),
      onDoubleClick: () => onCellDoubleClick(idx, col),
    };
  };

  const inputAttrs = (col: number, field: EditableCol) => ({
    ref: (el: HTMLInputElement | null) => inputRef(el, `${field}-${idx}`),
    readOnly: !cellEditing(col),
    tabIndex: -1,
    style: { pointerEvents: cellEditing(col) ? 'auto' as const : 'none' as const },
    onFocus,
    onBlur,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => onInputKeyDown(e, idx, col),
  });

  return (
    <tr onContextMenu={e => { e.preventDefault(); onRowContextMenu(idx, e.clientX, e.clientY); }}>
      <td className="col-num" onMouseDown={onNonEditableMouseDown}>{idx + 1}</td>

      <td {...tdAttrs(0, 'col-name', { position: 'relative' })}>
        <input
          {...inputAttrs(0, 'name')}
          value={row.name || ''}
          placeholder={isFirst && !row.name ? 'Можно вводить текст здесь и система подберёт варианты' : ''}
          onChange={e => { onUpdate(idx, 'name', e.target.value); onSearch(e.target.value, idx, 'name', e.target as HTMLInputElement); }}
        />
      </td>

      <td {...tdAttrs(1, 'col-brand')}>
        <input
          {...inputAttrs(1, 'brand')}
          value={row.brand || ''}
          onChange={e => onUpdate(idx, 'brand', e.target.value)}
        />
      </td>

      <td {...tdAttrs(2, 'col-article')}>
        <input
          {...inputAttrs(2, 'article')}
          value={row.article || ''}
          onChange={e => { onUpdate(idx, 'article', e.target.value); onSearch(e.target.value, idx, 'article', e.target as HTMLInputElement); }}
        />
      </td>

      <td {...tdAttrs(3, 'col-qty')}>
        <input
          {...inputAttrs(3, 'qty')}
          value={row.qty || ''}
          onChange={e => onUpdate(idx, 'qty', e.target.value)}
        />
      </td>

      <td {...tdAttrs(4, 'col-unit')}>
        <input
          {...inputAttrs(4, 'unit')}
          value={row.unit || ''}
          onChange={e => onUpdate(idx, 'unit', e.target.value)}
        />
      </td>

      <td {...tdAttrs(5, 'col-price')}>
        <input
          {...inputAttrs(5, 'price')}
          value={row.price || ''}
          onChange={e => { onUpdate(idx, 'price', e.target.value); onUpdate(idx, 'auto_price', false); }}
        />
      </td>

      <td {...tdAttrs(6, 'col-store')}>
        <select
          ref={el => inputRef(el, `store-${idx}`)}
          value={row.store ?? ''}
          tabIndex={-1}
          style={{ pointerEvents: cellEditing(6) ? 'auto' : 'none' }}
          onChange={e => onUpdate(idx, 'store', e.target.value)}
          onClick={e => cellEditing(6) && onStoreClick(idx, e.target as HTMLSelectElement)}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value="ЭТМ">ЭТМ</option>
          <option value="EKF">EKF</option>
          <option value="">—</option>
        </select>
      </td>

      <td {...tdAttrs(7, 'col-coef')}>
        <input
          {...inputAttrs(7, 'coef')}
          value={row.coef || '1'}
          onChange={e => onUpdate(idx, 'coef', e.target.value)}
        />
      </td>

      <td className={`col-total${isTotalInRange ? ' cell-selected' : ''}`}>
        {row.total && row.total !== 'NaN' ? row.total : ''}
      </td>

      <td {...tdAttrs(8, 'col-deadline')}>
        <input
          {...inputAttrs(8, 'deadline')}
          value={row.deadline || ''}
          placeholder="—"
          onChange={e => onUpdate(idx, 'deadline', e.target.value)}
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

  const [currentId, setCurrentId] = useState(() => Number(_routeId));
  const currentIdRef = useRef(Number(_routeId));
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);

  // Normalize decimal separators (comma→dot) in numeric fields before saving
  const normRowForSave = (r: any) => ({
    ...r,
    qty:   String(r.qty   ?? '').replace(',', '.'),
    price: String(r.price ?? '').replace(',', '.'),
    coef:  String(r.coef  ?? '1').replace(',', '.'),
  });

  const setUnsaved = useCallback((v: boolean) => {
    _setUnsaved(v);
    hasUnsavedRef.current = v;
    if (v) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        if (!hasUnsavedRef.current) return;
        const toSave = rowsRef.current.filter((r: any) => r.name || r.article).map(normRowForSave);
        try {
          await sheetsApi.saveRows(currentIdRef.current, toSave);
          hasUnsavedRef.current = false;
          _setUnsaved(false);
        } catch { /* silent */ }
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

  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [brands, setBrands] = useState<string[]>(STATIC_BRANDS);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<any[]>([]);
  const globalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [renamingSheetId, setRenamingSheetId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // ── Row context menu ──────────────────────────────────────────
  const [rowCtxMenu, setRowCtxMenu] = useState<{ rowIdx: number; x: number; y: number } | null>(null);

  // ── Sheet tab context menu ────────────────────────────────────
  const [tabMenu, setTabMenu] = useState<{ id: number; x: number; y: number } | null>(null);

  // ── Save as template modal ────────────────────────────────────
  const [tplModal, setTplModal] = useState<{ sheetId: number } | null>(null);
  const [tplName, setTplName] = useState('');

  // ── Sheet tab drag-and-drop ───────────────────────────────────
  const [tabDrag, setTabDrag] = useState<number | null>(null);
  const [tabDropSide, setTabDropSide] = useState<{ id: number; side: 'left' | 'right' } | null>(null);

  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importModalOpen, setImportModalOpen] = useState(false);

  const undoKey = `undo_${currentId}`;
  const redoKey = `redo_${currentId}`;
  const [undoStack, setUndoStack] = useState<any[][]>(() => {
    try { const s = sessionStorage.getItem(`undo_${Number(_routeId)}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [redoStack, setRedoStack] = useState<any[][]>(() => {
    try { const s = sessionStorage.getItem(`redo_${Number(_routeId)}`); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  // ── Cell selection state ──────────────────────────────────────
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [selAnchor, setSelAnchor] = useState<{ row: number; col: number } | null>(null);
  const [selFocus, setSelFocus] = useState<{ row: number; col: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const activeCellRef = useRef<{ row: number; col: number } | null>(null);
  const selAnchorRef = useRef<{ row: number; col: number } | null>(null);
  const selFocusRef  = useRef<{ row: number; col: number } | null>(null);
  const isEditingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const inputRefs = useRef<Map<string, HTMLElement>>(new Map());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef<any[]>([]);
  const hasUnsavedRef = useRef(false);
  const focusSnapshotRef = useRef<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Sync helpers: update both React state AND ref synchronously
  function updSelAnchor(cell: { row: number; col: number } | null) {
    selAnchorRef.current = cell;
    setSelAnchor(cell);
  }
  function updSelFocus(cell: { row: number; col: number } | null) {
    selFocusRef.current = cell;
    setSelFocus(cell);
  }

  useEffect(() => {
    try { sessionStorage.setItem(undoKey, JSON.stringify(undoStack)); } catch { /* quota exceeded */ }
  }, [undoStack, undoKey]);
  useEffect(() => {
    try { sessionStorage.setItem(redoKey, JSON.stringify(redoStack)); } catch { /* quota exceeded */ }
  }, [redoStack, redoKey]);

  const setInputRef = useCallback((el: HTMLElement | null, key: string) => {
    if (el) inputRefs.current.set(key, el); else inputRefs.current.delete(key);
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

  // ── Global keydown: Ctrl+Z/Y/C/V ─────────────────────────────
  // Use e.code (physical key position) instead of e.key to support
  // non-Latin keyboard layouts (Russian, etc.) where e.key = 'с'/'я'/etc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const code = e.code;
      if ((code === 'KeyZ') && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if ((code === 'KeyY') || (code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
      else if (code === 'KeyC' && !isEditingRef.current && activeCellRef.current) {
        e.preventDefault();
        copyRangeWithRefs();
      }
      // Ctrl+V: do NOT preventDefault — let the browser fire the native paste event
      // which is caught by onPaste on the tableWrapRef (clipboard API needs no permissions there)
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleUndo, handleRedo]);

  // ── Global mouseup — end drag selection ──────────────────────
  useEffect(() => {
    const onMouseUp = () => { isDraggingRef.current = false; };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  // ── Auto-save on hide/unload ──────────────────────────────────
  useEffect(() => {
    async function autoSaveNow() {
      if (!hasUnsavedRef.current) return;
      const toSave = rowsRef.current.filter((r: any) => r.name || r.article).map(normRowForSave);
      try {
        await sheetsApi.saveRows(currentIdRef.current, toSave);
        hasUnsavedRef.current = false;
        _setUnsaved(false);
      } catch { /* silent */ }
    }
    const handleVisibility = () => { if (document.visibilityState === 'hidden') autoSaveNow(); };
    const handleUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedRef.current) {
        e.preventDefault();
        e.returnValue = '';
        autoSaveNow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      autoSaveNow();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [_setUnsaved]);

  // ── Load data on sheet change ─────────────────────────────────
  useEffect(() => {
    loadData();
    if (currentId === Number(_routeId)) loadBrands();
    const close = (e: Event) => {
      setAcDrops(null); setStoreDropdown(null); setGlobalResults([]);
      const t = e.target as HTMLElement;
      if (!t.closest('.sheet-tab-menu-btn') && !t.closest('.sheet-tab-ctx-menu')) {
        setTabMenu(null);
      }
      if (!t.closest('.row-ctx-menu')) {
        setRowCtxMenu(null);
      }
    };
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
        const n = parseFloat(String(v).replace(',', '.'));
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
      try {
        const u = sessionStorage.getItem(`undo_${currentIdRef.current}`);
        const r = sessionStorage.getItem(`redo_${currentIdRef.current}`);
        setUndoStack(u ? JSON.parse(u) : []);
        setRedoStack(r ? JSON.parse(r) : []);
      } catch {
        setUndoStack([]);
        setRedoStack([]);
      }
      const projId = activeProjectId || s.projectId;
      if (projId) {
        const { data: p } = await projectsApi.getOne(projId);
        setProject(p);
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

  // ── Import from price-list file ──────────────────────────────
  function handleImport(importedRows: any[], importMode: 'append' | 'replace') {
    pushHistorySnapshot(rowsRef.current);
    const MIN_ROWS = 25;
    const emptyRowPad = (i: number) => ({ row_number: i + 1, name: '', brand: '', article: '', qty: '', unit: '', price: '', store: 'ЭТМ', coef: '1', total: '', deadline: '' });

    const processed = importedRows.map(r => ({
      ...r,
      coef:  r.coef  || '1',
      store: r.store || 'ЭТМ',
      qty:   r.qty   || '',
      price: r.price || '',
      total: calcTotal(r.price || '', r.qty || '', r.coef || '1'),
    }));

    setRows(prev => {
      let next: any[];
      if (importMode === 'replace') {
        next = [...processed];
      } else {
        const existing = prev.filter((r: any) => r.name || r.article);
        next = [...existing, ...processed];
      }
      while (next.length < MIN_ROWS) next.push(emptyRowPad(next.length));
      return next;
    });
    setUnsaved(true);
    toast.success(`Импортировано ${processed.length} строк`);
  }

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

  // ── Delete sheet ─────────────────────────────────────────────
  async function deleteSheet(sheetId: number) {
    const s = projectSheets.find((x: any) => x.id === sheetId);
    if (!confirm(`Удалить лист «${s?.name || sheetId}»? Это действие необратимо.`)) return;
    try {
      await sheetsApi.remove(sheetId);
      setProject((p: any) => p ? { ...p, sheets: p.sheets.filter((x: any) => x.id !== sheetId) } : p);
      // If deleted the active sheet, switch to first remaining one
      if (currentId === sheetId) {
        const remaining = projectSheets.filter((x: any) => x.id !== sheetId);
        if (remaining.length > 0) {
          setCurrentId(remaining[0].id);
          window.history.replaceState(null, '', `/spec/${remaining[0].id}`);
        } else {
          router.push('/projects');
        }
      }
      toast.success('Лист удалён');
    } catch { toast.error('Ошибка удаления листа'); }
  }

  // ── Save as template ─────────────────────────────────────────
  async function saveAsTemplate() {
    if (!tplName.trim() || !tplModal) return;
    try {
      // Load the sheet's rows, then create a template storing them in `meta`
      const { data: sheetData } = await sheetsApi.getOne(tplModal.sheetId);
      const rows = (sheetData.rows || []).map((r: any) => ({
        name: r.name || '',
        brand: r.brand || '',
        article: r.article || '',
        qty: r.qty || '',
        unit: r.unit || '',
        price: r.price || '',
        store: r.store || '',
        coef: r.coef || '1',
        deadline: r.deadline || '',
      })).filter((r: any) => r.name || r.article);
      await templatesApi.create({ name: tplName.trim(), rows });
      toast.success(`Шаблон «${tplName.trim()}» сохранён`);
      setTplModal(null);
      setTplName('');
    } catch { toast.error('Ошибка сохранения шаблона'); }
  }

  // ── Sheet tab drag-and-drop ───────────────────────────────────
  function onTabDragStart(e: React.DragEvent, id: number) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    setTabDrag(id);
  }

  function onTabDragOver(e: React.DragEvent, id: number) {
    e.preventDefault();
    e.stopPropagation();
    if (tabDrag === id) { setTabDropSide(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    setTabDropSide(prev => prev?.id === id && prev?.side === side ? prev : { id, side });
  }

  function onTabDragLeave(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setTabDropSide(null);
    }
  }

  function onTabDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!tabDrag || !tabDropSide || tabDrag === tabDropSide.id) { onTabDragEnd(); return; }
    setProject((prev: any) => {
      if (!prev) return prev;
      const sheets = [...(prev.sheets || [])];
      const fromIdx = sheets.findIndex((s: any) => s.id === tabDrag);
      const [item] = sheets.splice(fromIdx, 1);
      let toIdx = sheets.findIndex((s: any) => s.id === tabDropSide.id);
      if (tabDropSide.side === 'right') toIdx++;
      sheets.splice(toIdx, 0, item);
      projectsApi.reorderSheets(prev.id, sheets.map((s: any) => s.id)).catch(() => {});
      return { ...prev, sheets };
    });
    onTabDragEnd();
  }

  function onTabDragEnd() {
    setTabDrag(null);
    setTabDropSide(null);
  }

  async function saveRows() {
    try {
      const toSave = rows.filter(r => r.name || r.article).map(normRowForSave);
      await sheetsApi.saveRows(currentIdRef.current, toSave);
      setUnsaved(false);
      toast.success('Сохранено');
    } catch { toast.error('Ошибка сохранения'); }
  }

  // ── Selection helpers ─────────────────────────────────────────
  function normalizeRange(a: { row: number; col: number }, b: { row: number; col: number }) {
    return {
      r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row),
      c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col),
    };
  }

  // Returns selection bounds from React state (for rendering)
  function getSelBounds() {
    if (!selAnchor || !selFocus) {
      if (!activeCell) return { r1: -1, c1: -1, r2: -2, c2: -2 };
      return { r1: activeCell.row, c1: activeCell.col, r2: activeCell.row, c2: activeCell.col };
    }
    return normalizeRange(selAnchor, selFocus);
  }

  // Returns selection bounds from refs (for event handlers — avoids stale closures)
  function getSelBoundsFromRefs() {
    const anchor = selAnchorRef.current;
    const focus  = selFocusRef.current;
    const cell   = activeCellRef.current;
    if (!anchor || !focus) {
      if (!cell) return { r1: -1, c1: -1, r2: -2, c2: -2 };
      return { r1: cell.row, c1: cell.col, r2: cell.row, c2: cell.col };
    }
    return normalizeRange(anchor, focus);
  }

  // Move active cell (navigation mode)
  const moveTo = useCallback((row: number, col: number, extend = false) => {
    const maxRow = rowsRef.current.length - 1;
    const maxCol = EDITABLE_COLS.length - 1;
    // Wrap columns across rows
    let r = row, c = col;
    if (c < 0) { c = maxCol; r -= 1; }
    if (c > maxCol) { c = 0; r += 1; }
    r = Math.max(0, Math.min(maxRow, r));
    c = Math.max(0, Math.min(maxCol, c));

    const cell = { row: r, col: c };
    setActiveCell(cell);
    activeCellRef.current = cell;
    setIsEditing(false);
    isEditingRef.current = false;

    if (extend && selAnchorRef.current) {
      updSelFocus(cell);
    } else {
      updSelAnchor(cell);
      updSelFocus(cell);
    }
    setTimeout(() => tableWrapRef.current?.focus(), 0);
  }, []);

  // Enter edit mode for the active cell
  const enterEditMode = useCallback((initialChar?: string) => {
    if (!activeCellRef.current) return;
    const { row, col } = activeCellRef.current;
    const field = EDITABLE_COLS[col];

    if (field !== 'store' && initialChar !== undefined) {
      // Clear current value and start typing
      updateRow(row, field, initialChar);
    }

    setIsEditing(true);
    isEditingRef.current = true;

    const key = `${field}-${row}`;
    setTimeout(() => {
      const el = inputRefs.current.get(key);
      if (!el) return;
      el.focus();
      if (el instanceof HTMLInputElement) {
        if (initialChar !== undefined) {
          el.setSelectionRange(1, 1);
        } else {
          el.select();
        }
      }
    }, 0);
  }, [updateRow]);

  function exitEditMode() {
    // Normalize dot → comma in numeric fields on exit (Russian locale display)
    if (activeCellRef.current) {
      const { row, col } = activeCellRef.current;
      const field = EDITABLE_COLS[col] as string;
      if (['price', 'qty', 'coef'].includes(field)) {
        const val = String(rowsRef.current[row]?.[field] ?? '');
        const normalized = val.replace('.', ',');
        if (normalized !== val) {
          setRows(prev => {
            const next = [...prev];
            next[row] = { ...next[row], [field]: normalized };
            return next;
          });
        }
      }
    }
    setIsEditing(false);
    isEditingRef.current = false;
    setTimeout(() => tableWrapRef.current?.focus(), 0);
  }

  // Clear values in selected range (Delete/Backspace)
  function clearRange() {
    const { r1, c1, r2, c2 } = getSelBoundsFromRefs();
    if (r1 < 0) return;
    pushHistorySnapshot(rowsRef.current);
    setRows(prev => {
      const next = [...prev];
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const field = EDITABLE_COLS[c];
          next[r] = { ...next[r], [field]: '' };
          if (['price', 'qty', 'coef'].includes(field)) {
            next[r].total = calcTotal(next[r].price, next[r].qty, next[r].coef);
          }
        }
      }
      return next;
    });
    setUnsaved(true);
  }

  const emptyRow = (idx: number) => ({ row_number: idx + 1, name: '', brand: '', article: '', qty: '', unit: '', price: '', store: 'ЭТМ', coef: '1', total: '', deadline: '' });

  const isRowEmpty = (row: any) => !row.name && !row.article && !row.brand && !row.price && !row.qty;

  // Two-step delete for selected rows:
  // Step 1 — if any selected row has content → clear all selected rows (stay in place)
  // Step 2 — if all selected rows are already empty → remove them with shift-up
  function deleteSelectedRows() {
    const { r1, r2 } = getSelBoundsFromRefs();
    if (r1 < 0) return;
    const current = rowsRef.current;
    const selectedRows = current.slice(r1, r2 + 1);
    const allEmpty = selectedRows.every(isRowEmpty);
    const count = r2 - r1 + 1;
    pushHistorySnapshot(current);

    if (!allEmpty) {
      // Step 1: clear content, rows stay in place
      setRows(prev => {
        const next = [...prev];
        for (let i = r1; i <= r2; i++) next[i] = emptyRow(i);
        return next;
      });
      setUnsaved(true);
      const hint = count === 1 ? 'Строка очищена' : `Очищено строк: ${count}`;
      toast(hint + ' — удалите ещё раз, чтобы убрать', { icon: '🗑' });
    } else {
      // Step 2: remove empty rows, shift up
      setRows(prev => {
        const next = prev.filter((_, i) => i < r1 || i > r2);
        while (next.length < 25) next.push(emptyRow(next.length));
        return next;
      });
      setActiveCell(null);
      activeCellRef.current = null;
      updSelAnchor(null);
      updSelFocus(null);
      setUnsaved(true);
      toast.success(count === 1 ? 'Строка удалена' : `Удалено строк: ${count}`);
    }
  }

  // Single-row delete used by keyboard flow
  function deleteRow(rowIdx: number) {
    pushHistorySnapshot(rowsRef.current);
    setRows(prev => {
      const next = prev.filter((_, i) => i !== rowIdx);
      while (next.length < 25) next.push(emptyRow(next.length));
      return next;
    });
    setUnsaved(true);
    toast.success('Строка удалена');
  }

  const handleRowContextMenu = useCallback((rowIdx: number, x: number, y: number) => {
    setRowCtxMenu({ rowIdx, x, y });
  }, []);

  // Copy selected range as TSV — uses state (called from JSX handlers)
  function copyRange() {
    copyRangeWithRefs();
  }

  // Copy using refs — safe to call from global event listeners (no stale closure)
  function copyRangeWithRefs() {
    const { r1, c1, r2, c2 } = getSelBoundsFromRefs();
    if (r1 < 0) return;
    const lines: string[] = [];
    // "Итого" sits between coef (col 7) and deadline (col 8) in the DOM but
    // is not in EDITABLE_COLS — inject it when selection spans both sides
    const includeTotal = c1 <= 7 && c2 >= 8;
    for (let r = r1; r <= r2; r++) {
      const cells: string[] = [];
      for (let c = c1; c <= c2; c++) {
        cells.push(String(rowsRef.current[r]?.[EDITABLE_COLS[c]] ?? ''));
        if (c === 7 && includeTotal) {
          cells.push(String(rowsRef.current[r]?.total ?? ''));
        }
      }
      lines.push(cells.join('\t'));
    }
    const text = lines.join('\n');
    const visibleColCount = c2 - c1 + 1 + (includeTotal ? 1 : 0);
    const rowCount = r2 - r1 + 1, colCount = visibleColCount;

    const showToast = () => toast.success(
      rowCount === 1 && colCount === 1
        ? 'Ячейка скопирована'
        : `Скопировано: ${rowCount} × ${colCount}`
    );

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(showToast)
        .catch(() => {
          // Clipboard API blocked (HTTP / permissions) — fallback
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          try { document.execCommand('copy'); showToast(); } catch { toast.error('Не удалось скопировать'); }
          document.body.removeChild(ta);
        });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); showToast(); } catch { toast.error('Не удалось скопировать'); }
      document.body.removeChild(ta);
    }
  }

  // onPaste handler for the tableWrapRef div (works when cells are selected, not editing)
  // Uses e.clipboardData — no browser permission needed, always available in paste events
  function handleWrapPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (isEditingRef.current) return; // input handles its own paste
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    e.preventDefault();
    if (activeCellRef.current) {
      applyPasteAt(text, activeCellRef.current.row, activeCellRef.current.col);
    } else {
      setPasteText(text);
      setShowPasteModal(true);
    }
  }

  // Legacy: kept for pasteFromClipboard fallback modal path
  async function pasteAtActiveCell() {
    if (!activeCellRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      applyPasteAt(text, activeCellRef.current.row, activeCellRef.current.col);
    } catch {
      setPasteText('');
      setShowPasteModal(true);
    }
  }

  function applyPasteAt(text: string, startRow: number, startCol: number) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, '').split('\t'));
    if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) return;
    pushHistorySnapshot(rowsRef.current);
    setRows(prev => {
      const next = [...prev];
      // Ensure we have enough rows
      const neededRows = startRow + lines.length;
      while (next.length < neededRows) {
        next.push({ row_number: next.length + 1, name: '', brand: '', article: '', qty: '', unit: '', price: '', store: 'ЭТМ', coef: '1', total: '', deadline: '' });
      }
      lines.forEach((cells, ri) => {
        cells.forEach((val, ci) => {
          const r = startRow + ri;
          const c = startCol + ci;
          if (r < next.length && c < EDITABLE_COLS.length) {
            const field = EDITABLE_COLS[c];
            next[r] = { ...next[r], [field]: val.trim() };
            if (['price', 'qty', 'coef'].includes(field)) {
              next[r].total = calcTotal(next[r].price, next[r].qty, next[r].coef);
            }
          }
        });
      });
      return next;
    });
    setUnsaved(true);
    const rCount = lines.length, cCount = Math.max(...lines.map(l => l.length));
    toast.success(`Вставлено: ${rCount} × ${cCount}`);
  }

  // ── Cell mouse events ─────────────────────────────────────────
  const handleCellMouseDown = useCallback((rowIdx: number, colIdx: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // prevent native focus on input
    isDraggingRef.current = true;

    if (e.shiftKey && selAnchorRef.current) {
      const cell = { row: rowIdx, col: colIdx };
      setActiveCell(cell);
      activeCellRef.current = cell;
      updSelFocus(cell);
      setIsEditing(false);
      isEditingRef.current = false;
      tableWrapRef.current?.focus();
    } else {
      const cell = { row: rowIdx, col: colIdx };
      setActiveCell(cell);
      activeCellRef.current = cell;
      updSelAnchor(cell);
      updSelFocus(cell);
      setIsEditing(false);
      isEditingRef.current = false;
      tableWrapRef.current?.focus();
    }
  }, []);

  const handleCellMouseEnter = useCallback((rowIdx: number, colIdx: number) => {
    if (!isDraggingRef.current) return;
    const cell = { row: rowIdx, col: colIdx };
    setActiveCell(cell);
    activeCellRef.current = cell;
    updSelFocus(cell);
  }, []);

  const handleCellDoubleClick = useCallback((rowIdx: number, colIdx: number) => {
    const cell = { row: rowIdx, col: colIdx };
    setActiveCell(cell);
    activeCellRef.current = cell;
    updSelAnchor(cell);
    updSelFocus(cell);
    setIsEditing(false);
    isEditingRef.current = false;
    enterEditMode();
  }, [enterEditMode]);

  // Non-editable columns (col-num, col-total): clicking them clears selection
  const handleNonEditableCellMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setActiveCell(null);
    activeCellRef.current = null;
    updSelAnchor(null);
    updSelFocus(null);
    setIsEditing(false);
    isEditingRef.current = false;
    isDraggingRef.current = false;
    tableWrapRef.current?.focus();
  }, []);

  // ── Keyboard handler for the table wrapper (navigation mode) ──
  function handleTableWrapKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (isEditing) return; // let inputs handle it
    const cell = activeCellRef.current;
    if (!cell) return;

    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl) {
      // Use e.code (physical key) to support non-Latin layouts (Russian, etc.)
      const code = e.code;
      if (code === 'KeyC') { e.preventDefault(); copyRange(); }
      // Ctrl+V: don't prevent default — let native paste event fire, caught by onPaste on tableWrapRef
      else if (code === 'KeyA') {
        e.preventDefault();
        const first = { row: 0, col: 0 };
        const last  = { row: rowsRef.current.length - 1, col: EDITABLE_COLS.length - 1 };
        setActiveCell(first);
        activeCellRef.current = first;
        updSelAnchor(first);
        updSelFocus(last);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); moveTo(cell.row, cell.col + 1, e.shiftKey); break;
      case 'ArrowLeft':  e.preventDefault(); moveTo(cell.row, cell.col - 1, e.shiftKey); break;
      case 'ArrowDown':  e.preventDefault(); moveTo(cell.row + 1, cell.col, e.shiftKey); break;
      case 'ArrowUp':    e.preventDefault(); moveTo(cell.row - 1, cell.col, e.shiftKey); break;
      case 'Tab':
        e.preventDefault();
        moveTo(cell.row, cell.col + (e.shiftKey ? -1 : 1));
        break;
      case 'Enter': case 'F2':
        e.preventDefault();
        enterEditMode();
        break;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        clearRange();
        break;
      case 'Escape':
        setActiveCell(null);
        activeCellRef.current = null;
        updSelAnchor(null);
        updSelFocus(null);
        break;
      default:
        // Printable char → enter edit mode immediately
        if (e.key.length === 1 && !isCtrl) {
          enterEditMode(e.key);
        }
    }
  }

  // ── Input keydown handler (edit mode) ────────────────────────
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    // Autocomplete navigation takes priority
    if (acDrops && acDrops.rowIdx === rowIdx) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcFocus(f => Math.min(f + 1, acDrops.results.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcFocus(f => Math.max(f - 1, 0)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        setAcFocus(f => { if (f >= 0) applyProduct(rowIdx, acDrops.results[f]); return f; });
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setAcDrops(null); return; }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      setAcDrops(null);
      exitEditMode();
      moveTo(rowIdx, colIdx + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setAcDrops(null);
      exitEditMode();
      moveTo(rowIdx + 1, colIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAcDrops(null);
      exitEditMode();
    }
  }, [acDrops, applyProduct, moveTo]);

  // ── Clipboard: copy whole sheet as TSV (toolbar button) ───────
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
    ta.focus(); ta.select();
    try {
      document.execCommand('copy');
      toast.success(`Скопировано ${count} строк — вставьте в Excel или Google Таблицы`);
    } catch {
      toast.error('Не удалось скопировать');
    } finally {
      document.body.removeChild(ta);
    }
  }

  // ── Clipboard: paste TSV from Excel (toolbar button / modal) ──
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
    if (parsed.length === 0) { toast('Не удалось распознать данные'); return; }
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
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        // If an active cell is selected, paste at that position
        if (activeCellRef.current) {
          const lines = text.split('\n');
          const hasMultiCols = lines.some(l => l.includes('\t'));
          if (hasMultiCols) {
            applyPasteAt(text, activeCellRef.current.row, activeCellRef.current.col);
            return;
          }
        }
        applyParsedRows(text);
        return;
      } catch { /* fall through */ }
    }
    setPasteText('');
    setShowPasteModal(true);
  }

  // tbody onPaste — fires when an input/cell inside tbody is focused
  // This handles paste into a specific cell (e.g., while editing), including plain text
  async function handleTablePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    // Only intercept if we have an active cell; otherwise let the input handle it normally
    if (!activeCellRef.current) return;
    // Single-value paste into the focused input (no tabs, no newlines) — let input handle natively
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    applyPasteAt(text, activeCellRef.current.row, activeCellRef.current.col);
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

    // Check ETM is configured
    try {
      const { data: status } = await storesApi.getEtmStatus();
      if (!status.configured) {
        toast.error('ЭТМ не настроен. Укажите ETM_LOGIN и ETM_PASSWORD на сервере.');
        return;
      }
    } catch { toast.error('Не удалось проверить статус ЭТМ'); return; }

    setRefreshing(true);
    setRefreshProgress({ done: 0, total: targets.length });
    const snap = JSON.parse(JSON.stringify(rowsRef.current));
    const articles = targets.map(({ r }) => r.article as string);

    try {
      // Single request — backend handles 1 req/sec throttling internally
      const { data: prices } = await storesApi.getEtmPrices(articles);

      // Count updates synchronously before setRows (setRows callback is async)
      let updated = 0;
      for (const { r } of targets) {
        const price = prices[r.article];
        if (price != null && price > 0) updated++;
      }

      setRows(prev => {
        const next = [...prev];
        for (const { r, i } of targets) {
          const price = prices[r.article];
          if (price != null && price > 0) {
            const priceStr = String(price);
            next[i] = {
              ...next[i],
              price: priceStr,
              store: 'ЭТМ',
              total: calcTotal(priceStr, next[i].qty, next[i].coef),
            };
          }
        }
        return next;
      });

      if (updated > 0) {
        pushHistorySnapshot(snap);
        setUnsaved(true);
        toast.success(`ЭТМ: обновлено ${updated} из ${targets.length} цен`);
      } else {
        toast('ЭТМ: цены не найдены. Проверьте артикулы в строках.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Ошибка запроса к ЭТМ';
      toast.error(msg);
    } finally {
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }

  const sheetTotal = rows.reduce((s, r) => {
    return s + parseNum(r.price) * parseNum(r.qty) * parseNum(r.coef, 1);
  }, 0);

  const projectSheets: any[] = project?.sheets || [];

  // Compute selection bounds once for rendering
  const selBounds = getSelBounds();

  if (loading) return (
    <div className="spec-screen">
      <div className="spec-toolbar">
        {[140, 120, 90, 80].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 32, borderRadius: 6 }} />
        ))}
        <div style={{ flex: 1 }} />
        <div className="skeleton" style={{ width: 260, height: 20, borderRadius: 4 }} />
      </div>
      <div className="spec-brand-bar">
        {[70, 50, 55, 70, 65, 55, 65, 50].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 26, borderRadius: 13 }} />
        ))}
      </div>
      <div className="sheet-tabs">
        {[90, 80, 100].map((w, i) => (
          <div key={i} style={{ padding: '8px 14px', display: 'flex', alignItems: 'center' }}>
            <div className="skeleton" style={{ width: w, height: 16, borderRadius: 4 }} />
          </div>
        ))}
      </div>
      <div className="spec-table-wrap">
        <div style={{ display: 'flex', gap: 1, padding: '8px 6px', borderBottom: '2px solid var(--border)', background: 'var(--white)' }}>
          {[30, 360, 90, 120, 60, 60, 80, 90, 80, 90].map((w, i) => (
            <div key={i} className="skeleton" style={{ width: w, height: 14, borderRadius: 3, flexShrink: 0 }} />
          ))}
        </div>
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 1, padding: '7px 6px', background: i % 2 === 0 ? 'var(--row-odd)' : 'var(--row-even)', borderBottom: '1px solid #f0f0f0' }}>
            <div className="skeleton" style={{ width: 30, height: 13, borderRadius: 3, flexShrink: 0, opacity: 0.5 }} />
            <div className="skeleton" style={{ width: 360 - (i % 3) * 40, height: 13, borderRadius: 3, flexShrink: 0 }} />
            <div className="skeleton" style={{ width: 90, height: 13, borderRadius: 3, flexShrink: 0, opacity: i % 4 === 0 ? 0 : 0.7 }} />
            <div className="skeleton" style={{ width: 120 - (i % 2) * 30, height: 13, borderRadius: 3, flexShrink: 0, opacity: i % 3 === 0 ? 0.4 : 1 }} />
            {[60, 60, 80, 90, 80, 90].map((w, j) => (
              <div key={j} className="skeleton" style={{ width: w, height: 13, borderRadius: 3, flexShrink: 0, opacity: i % 4 === 0 && j > 2 ? 0 : 0.6 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="page-fade-in">
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
            Копировать лист
          </button>
          <button className="btn-outline" title="Загрузить прайс-лист из файла (.xlsx, .csv)" onClick={() => setImportModalOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            Прайс-лист
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
              title="Обновить цены по артикулам из ЭТМ (1 арт/сек)"
            >
              {refreshing
                ? (refreshProgress ? `↻ ~${refreshProgress.total} арт…` : '↻ …')
                : '↻ Цены ЭТМ'}
            </button>
          </div>
        </div>

        {/* ── Brand filter chips ── */}
        <div className="spec-brand-bar">
          <button className={`brand-chip${brandFilter === 'all' ? ' active' : ''}`} onClick={() => setBrandFilter('all')}>
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
            {projectSheets.map((s: any) => {
              const isDraggingThis = tabDrag === s.id;
              const dropClass = tabDropSide?.id === s.id ? ` drop-${tabDropSide.side}` : '';
              return (
                <div
                  key={s.id}
                  className={`sheet-tab${currentId === s.id ? ' active' : ''}${isDraggingThis ? ' tab-dragging' : ''}${dropClass}`}
                  draggable
                  onDragStart={e => onTabDragStart(e, s.id)}
                  onDragOver={e => onTabDragOver(e, s.id)}
                  onDragLeave={onTabDragLeave}
                  onDrop={onTabDrop}
                  onDragEnd={onTabDragEnd}
                >
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
                        if (hasUnsavedRef.current) {
                          const shouldSave = confirm('В текущем листе есть несохранённые изменения.\nСохранить перед переходом?');
                          if (shouldSave) {
                            const toSave = rowsRef.current.filter((r: any) => r.name || r.article).map(normRowForSave);
                            try { await sheetsApi.saveRows(currentIdRef.current, toSave); hasUnsavedRef.current = false; _setUnsaved(false); } catch { toast.error('Ошибка сохранения'); }
                          } else {
                            hasUnsavedRef.current = false;
                            _setUnsaved(false);
                          }
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
                  <button
                    className="sheet-tab-menu-btn"
                    title="Действия с листом"
                    onClick={e => {
                      e.stopPropagation();
                      setTabMenu(prev => prev?.id === s.id ? null : { id: s.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                    </svg>
                  </button>
                </div>
              );
            })}
            <button className="sheet-tab-add" title="Добавить лист" onClick={addSheet}>+</button>
          </div>
        )}

        {/* ── Table ── */}
        <div
          ref={tableWrapRef}
          className="spec-table-wrap"
          tabIndex={0}
          onKeyDown={handleTableWrapKeyDown}
          onPaste={handleWrapPaste}
          style={{ outline: 'none' }}
        >
          <table className="spec-table" style={{ userSelect: 'none' }}>
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
                  onInputKeyDown={handleInputKeyDown}
                  onStoreClick={openStoreDropdown}
                  inputRef={setInputRef}
                  onFocus={handleCellFocus}
                  onBlur={handleCellBlur}
                  onNonEditableMouseDown={handleNonEditableCellMouseDown}
                  activeCellRow={activeCell?.row ?? -1}
                  activeCellCol={activeCell?.col ?? -1}
                  isEditing={isEditing}
                  selR1={selBounds.r1}
                  selC1={selBounds.c1}
                  selR2={selBounds.r2}
                  selC2={selBounds.c2}
                  onCellMouseDown={handleCellMouseDown}
                  onCellMouseEnter={handleCellMouseEnter}
                  onCellDoubleClick={handleCellDoubleClick}
                  onRowContextMenu={handleRowContextMenu}
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

      {/* ── Row context menu ── */}
      {rowCtxMenu && (
        <div
          className="row-ctx-menu"
          style={{ top: rowCtxMenu.y, left: rowCtxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="row-ctx-item row-ctx-item--danger"
            onClick={() => {
              setRowCtxMenu(null);
              deleteSelectedRows();
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, flexShrink: 0 }}>
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
            {(() => {
              const { r1, r2 } = getSelBoundsFromRefs();
              const count = r1 >= 0 ? r2 - r1 + 1 : 1;
              return count > 1 ? `Удалить строки (${count})` : 'Удалить строку';
            })()}
          </div>
        </div>
      )}

      {/* ── Sheet tab context menu ── */}
      {tabMenu && (
        <div
          className="sheet-tab-ctx-menu"
          style={{ top: tabMenu.y + 4, left: tabMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="sheet-tab-ctx-item"
            onClick={() => {
              const s = projectSheets.find((x: any) => x.id === tabMenu.id);
              if (s) startRenameSheet(s);
              setTabMenu(null);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, flexShrink: 0 }}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Переименовать
          </div>
          <div
            className="sheet-tab-ctx-item"
            onClick={() => {
              const s = projectSheets.find((x: any) => x.id === tabMenu.id);
              setTplName(s?.name || '');
              setTplModal({ sheetId: tabMenu.id });
              setTabMenu(null);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, flexShrink: 0 }}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Сохранить как шаблон
          </div>
          <div
            className="sheet-tab-ctx-item"
            style={{ color: '#e53935', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}
            onClick={() => {
              const id = tabMenu.id;
              setTabMenu(null);
              deleteSheet(id);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Удалить лист
          </div>
        </div>
      )}

      {/* ── Save as template modal ── */}
      {tplModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setTplModal(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 28, width: 420, maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Сохранить как шаблон</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' }}>Введите название шаблона</p>
            <input
              autoFocus
              value={tplName}
              onChange={e => setTplName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveAsTemplate(); if (e.key === 'Escape') setTplModal(null); }}
              placeholder="Название шаблона"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setTplModal(null)}>Отмена</button>
              <button className="btn-primary" onClick={saveAsTemplate} disabled={!tplName.trim()}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Paste modal */}
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

      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImport}
      />
    </div>
  );
}
