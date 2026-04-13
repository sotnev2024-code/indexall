'use client';
import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';

const SPEC_FIELDS = [
  { key: 'name',     label: 'Название' },
  { key: 'brand',    label: 'Бренд' },
  { key: 'article',  label: 'Артикул' },
  { key: 'qty',      label: 'Кол-во' },
  { key: 'unit',     label: 'Ед.изм' },
  { key: 'price',    label: 'Цена' },
  { key: 'store',    label: 'Источник' },
  { key: 'coef',     label: 'Коэф.' },
  { key: 'deadline', label: 'Срок' },
] as const;

type SpecField = typeof SPEC_FIELDS[number]['key'];

// Auto-mapping: lowercase header → spec field
const AUTO_MAP: Record<string, SpecField> = {
  'название': 'name', 'наименование': 'name', 'наименование товара': 'name',
  'позиция': 'name', 'описание': 'name', 'товар': 'name', 'name': 'name',
  'наим.': 'name', 'наим': 'name',
  'бренд': 'brand', 'производитель': 'brand', 'марка': 'brand', 'brand': 'brand',
  'артикул': 'article', 'арт': 'article', 'код': 'article', 'код товара': 'article',
  'article': 'article', 'арт.': 'article', 'part number': 'article', 'партномер': 'article',
  'каталожный номер': 'article', 'тнвэд': 'article',
  'кол-во': 'qty', 'количество': 'qty', 'кол': 'qty', 'qty': 'qty', 'кол.': 'qty',
  'ед.изм': 'unit', 'ед. изм': 'unit', 'ед.изм.': 'unit', 'единица': 'unit',
  'unit': 'unit', 'ед': 'unit', 'ед.': 'unit', 'единицы': 'unit',
  'цена': 'price', 'стоимость': 'price', 'price': 'price', 'цена без ндс': 'price',
  'цена с ндс': 'price', 'прайс': 'price', 'розничная цена': 'price',
  'цена руб': 'price', 'цена, руб': 'price', 'цена руб.': 'price',
  'магазин': 'store', 'поставщик': 'store', 'store': 'store', 'склад': 'store',
  'коэф': 'coef', 'коэф.': 'coef', 'коэффициент': 'coef', 'coef': 'coef',
  'срок': 'deadline', 'срок поставки': 'deadline', 'deadline': 'deadline', 'поставка': 'deadline',
};

interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: (string | number | null)[][];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (rows: any[], mode: 'append' | 'replace') => void;
}

export default function ImportModal({ open, onClose, onImport }: Props) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<(SpecField | '')[]>([]);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  // Row range (1-indexed, user-facing)
  const [rowFrom, setRowFrom] = useState(1);
  const [rowTo, setRowTo] = useState(1000);

  const reset = () => { setParsed(null); setMapping([]); setRowFrom(1); setRowTo(1000); };

  const close = () => { reset(); onClose(); };

  const parseFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error('Поддерживаются только .xlsx, .xls и .csv файлы');
      return;
    }
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1, defval: '', raw: false,
      }) as (string | number | null)[][];

      // Find header row: first row with 3+ non-empty cells
      let headerRow = 0;
      for (let i = 0; i < Math.min(raw.length, 15); i++) {
        const nonEmpty = raw[i].filter(c => c !== '' && c !== null && c !== undefined).length;
        if (nonEmpty >= 3) { headerRow = i; break; }
      }

      const headers = raw[headerRow].map(h => String(h ?? '').trim());
      const dataRows = raw
        .slice(headerRow + 1)
        .filter(r => r.some(c => c !== '' && c !== null && c !== undefined));

      // Auto-map
      const autoMapping: (SpecField | '')[] = headers.map(h => {
        const key = h.toLowerCase().trim();
        return AUTO_MAP[key] || '';
      });

      const limitedRows = dataRows.slice(0, 1000);
      setParsed({ fileName: file.name, headers, rows: limitedRows });
      setMapping(autoMapping);
      setRowFrom(1);
      setRowTo(limitedRows.length);
    } catch {
      toast.error('Не удалось прочитать файл. Убедитесь, что это .xlsx, .xls или .csv');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    e.target.value = '';
  };

  const mappedCount = mapping.filter(m => m !== '').length;
  const hasName = mapping.some(m => m === 'name') || mapping.some(m => m === 'article');

  // Clamp and normalize the range (1-indexed → 0-indexed slice)
  const clampFrom = Math.max(1, Math.min(rowFrom, parsed?.rows.length ?? 1));
  const clampTo   = Math.max(clampFrom, Math.min(rowTo, parsed?.rows.length ?? 1));
  const selectedRows = parsed ? parsed.rows.slice(clampFrom - 1, clampTo) : [];

  const doImport = () => {
    if (!parsed) return;
    const processedRows = selectedRows
      .map(row => {
        const r: any = { coef: '1', store: 'ЭТМ' };
        mapping.forEach((field, ci) => {
          if (field && ci < row.length) {
            const val = row[ci];
            r[field] = val !== null && val !== undefined ? String(val).trim() : '';
          }
        });
        return r;
      })
      .filter(r => r.name || r.article);

    if (processedRows.length === 0) {
      toast.error('В выбранном диапазоне нет строк с данными. Проверьте диапазон и маппинг колонок.');
      return;
    }
    onImport(processedRows, mode);
    close();
  };

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40, paddingBottom: 40, overflowY: 'auto' }}
      onClick={close}
    >
      <div className="import-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="import-modal-header">
          <h3>Загрузить прайс-лист</h3>
          <button className="import-modal-close" onClick={close}>×</button>
        </div>

        {!parsed ? (
          /* ── Drop zone ── */
          <div
            className={`import-dropzone${dragging ? ' dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            {loading ? (
              <p style={{ color: 'var(--muted)', margin: 0 }}>Читаю файл…</p>
            ) : (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 15 }}>Перетащите файл сюда</p>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)' }}>или выберите вручную</p>
                <label className="btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Выбрать файл
                  <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileInput} />
                </label>
                <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--muted)' }}>Поддерживаются: Excel (.xlsx, .xls), CSV</p>
              </>
            )}
          </div>
        ) : (
          /* ── Mapping & preview ── */
          <>
            {/* File info bar */}
            <div className="import-file-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span style={{ fontWeight: 600 }}>{parsed.fileName}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· {parsed.rows.length} строк</span>
              <button className="import-change-file" onClick={reset}>Изменить файл</button>
            </div>

            {/* Row range */}
            <div className="import-range-row">
              <span className="import-range-label">Диапазон строк:</span>
              <span className="import-range-group">
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>с</span>
                <input
                  type="number"
                  className="import-range-input"
                  min={1}
                  max={parsed.rows.length}
                  value={rowFrom}
                  onChange={e => {
                    const v = Math.max(1, Math.min(Number(e.target.value) || 1, parsed.rows.length));
                    setRowFrom(v);
                    if (rowTo < v) setRowTo(v);
                  }}
                />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>по</span>
                <input
                  type="number"
                  className="import-range-input"
                  min={rowFrom}
                  max={parsed.rows.length}
                  value={rowTo}
                  onChange={e => {
                    const v = Math.max(rowFrom, Math.min(Number(e.target.value) || rowFrom, parsed.rows.length));
                    setRowTo(v);
                  }}
                />
              </span>
              <span className="import-range-hint">
                {clampTo - clampFrom + 1} строк из {parsed.rows.length}
              </span>
              {(clampFrom !== 1 || clampTo !== parsed.rows.length) && (
                <button
                  className="import-change-file"
                  onClick={() => { setRowFrom(1); setRowTo(parsed.rows.length); }}
                >
                  Сбросить
                </button>
              )}
            </div>

            {/* Column mapping */}
            <p className="import-section-label">Сопоставьте колонки файла с полями спецификации:</p>
            <div className="import-mapping-grid">
              {parsed.headers.map((h, ci) => (
                <div key={ci} className="import-mapping-row">
                  <span className="import-col-name" title={h}>{h || `Колонка ${ci + 1}`}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" style={{ flexShrink: 0 }}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  <select
                    value={mapping[ci] || ''}
                    onChange={e => {
                      const m = [...mapping];
                      m[ci] = e.target.value as SpecField | '';
                      setMapping(m);
                    }}
                  >
                    <option value="">— не импортировать —</option>
                    {SPEC_FIELDS.map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <p className="import-section-label" style={{ marginTop: 18 }}>
              Превью (строки {clampFrom}–{Math.min(clampFrom + 2, clampTo)}):
            </p>
            <div className="import-preview-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ color: 'var(--muted)', fontWeight: 500, minWidth: 32 }}>#</th>
                    {parsed.headers.map((_, ci) => (
                      <th key={ci}>
                        {mapping[ci]
                          ? SPEC_FIELDS.find(f => f.key === mapping[ci])?.label
                          : <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontWeight: 400 }}>—</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.slice(0, 3).map((row, ri) => (
                    <tr key={ri}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{clampFrom + ri}</td>
                      {parsed.headers.map((_, ci) => (
                        <td key={ci} style={{ opacity: mapping[ci] ? 1 : 0.3 }}>
                          {String(row[ci] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mode */}
            <div className="import-mode-row">
              <label>
                <input type="radio" name="imode" value="append" checked={mode === 'append'} onChange={() => setMode('append')} />
                &nbsp;Добавить к текущим строкам
              </label>
              <label>
                <input type="radio" name="imode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                &nbsp;Заменить все строки листа
              </label>
            </div>

            {/* Footer */}
            <div className="import-modal-footer">
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {mappedCount} кол. сопоставлено · строки {clampFrom}–{clampTo} ({clampTo - clampFrom + 1} шт.)
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-outline" onClick={close}>Отмена</button>
                <button className="btn-primary" onClick={doImport} disabled={!hasName}>
                  Импортировать
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
