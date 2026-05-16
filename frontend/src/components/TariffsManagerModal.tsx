'use client';
import { useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function getImageUrl(path: string | null | undefined, bust?: number): string | null {
  if (!path) return null;
  const filename = String(path).split(/[\\/]/).pop();
  const url = `${process.env.NEXT_PUBLIC_API_URL}/uploads/${filename}`;
  // Cache-bust after re-upload — same filename can be reused on quick retry
  // (Date.now() collisions are unlikely but possible) and Next.js images get
  // aggressively cached by the browser.
  return bust ? `${url}?v=${bust}` : url;
}

export interface TariffTile {
  id?: number;
  _tempId?: string;
  plan_key?: string;
  name: string;
  price: number;
  duration_value: number;
  duration_unit: 'day' | 'month' | string;
  description?: string;
  is_active: boolean;
  sort_order: number;
  width: number;
  height: number;
  parent_id?: number | null;
  image_path?: string | null;
  /** 0 = unlimited; N = max times one user can activate this tariff */
  max_activations_per_user?: number;
}

interface Props {
  tiles: TariffTile[];
  onAddMain: () => void;
  onAddChild: (parentId: number) => void;
  onRemove: (idx: number) => void;
  onSetSize: (idx: number, w: number, h: number) => void;
  onToggleActive: (idx: number) => void;
  onUpdateField: (idx: number, patch: Partial<TariffTile>) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onUploadImage: (id: number, f: File) => Promise<void>;
  onDeleteImage: (id: number) => Promise<void>;
  onClose: () => void;
  onSave: () => void;
}

// Vertical-column-first sizes (the client wants tariffs as long vertical
// columns) within a 4-column grid. Heights run 1..4.
const SIZES: { label: string; w: number; h: number }[] = [
  { label: '1×1', w: 1, h: 1 },
  { label: '1×2', w: 1, h: 2 },
  { label: '1×3', w: 1, h: 3 },
  { label: '1×4', w: 1, h: 4 },
  { label: '2×2', w: 2, h: 2 },
  { label: '2×3', w: 2, h: 3 },
];

function fmt(n: number) { return Number(n).toLocaleString('ru-RU'); }
function durationLabel(t: TariffTile) {
  const v = Number(t.duration_value);
  if (t.duration_unit === 'month') {
    if (v === 1) return '/месяц';
    if (v === 12) return '/год';
    return `/${v} мес`;
  }
  if (v === 30) return '/месяц';
  if (v === 365) return '/год';
  if (v === 7) return '/неделя';
  return `/${v} дн`;
}

function SortableTariff({
  tile, idx, onRemove, onSetSize, onToggleActive, onUpdateField, onUploadImage, onDeleteImage, onAddChild,
}: {
  tile: TariffTile; idx: number;
  onRemove: (idx: number) => void;
  onSetSize: (idx: number, w: number, h: number) => void;
  onToggleActive: (idx: number) => void;
  onUpdateField: (idx: number, patch: Partial<TariffTile>) => void;
  onUploadImage: (id: number, f: File) => Promise<void>;
  onDeleteImage: (id: number) => Promise<void>;
  onAddChild: (parentId: number) => void;
}) {
  const id = tile.id ? `t-${tile.id}` : `new-${tile._tempId}`;
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id });

  const [editingField, setEditingField] = useState<null | 'name' | 'price' | 'duration' | 'maxAct'>(null);
  const [localName, setLocalName] = useState(tile.name);
  const [localPrice, setLocalPrice] = useState(String(tile.price));
  const [localDur, setLocalDur] = useState(String(tile.duration_value));
  const [localDurUnit, setLocalDurUnit] = useState(tile.duration_unit || 'day');
  const [localMaxAct, setLocalMaxAct] = useState(String(tile.max_activations_per_user ?? 0));

  const w = tile.width ?? 1;
  const h = tile.height ?? 3;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${w}`,
    gridRow: `span ${h}`,
    opacity: isDragging ? 0.5 : (tile.is_active ? 1 : 0.55),
    zIndex: isDragging ? 100 : 'auto',
  };

  // Bust HTTP cache on every render derived from the tile data — when the
  // admin re-uploads / removes an image the URL string flips, forcing the
  // browser to refetch instead of showing the previous image.
  const imgSrc = getImageUrl(tile.image_path, tile.image_path ? tile.image_path.length : 0);
  const isChild = tile.parent_id != null;
  const isActiveSize = (sw: number, sh: number) => w === sw && h === sh;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        background: imgSrc ? '#fff' : '#1a1a1a',
        cursor: isDragging ? 'grabbing' : 'grab',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.25)' : '0 1px 3px rgba(0,0,0,0.08)',
        border: isChild ? '2px dashed rgba(245,200,0,0.7)' : 'none',
      }}
      className="tm-tile"
    >
      <div
        {...attributes}
        {...listeners}
        style={{ position: 'absolute', inset: 0, cursor: 'grab' }}
      >
        {imgSrc ? (
          <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', pointerEvents: 'none', padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, opacity: 0.95 }}>{tile.name || 'Без названия'}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f5c800' }}>{fmt(Number(tile.price))} ₽</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{durationLabel(tile)}</div>
          </div>
        )}
      </div>

      {/* Top: editable name + delete */}
      <div
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 6, left: 6, right: 32,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          padding: '3px 8px', borderRadius: 4,
          fontSize: 11, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {editingField === 'name' ? (
          <input
            autoFocus
            value={localName}
            onChange={e => setLocalName(e.target.value)}
            onBlur={() => { onUpdateField(idx, { name: localName }); setEditingField(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onUpdateField(idx, { name: localName }); setEditingField(null); }
              if (e.key === 'Escape') { setLocalName(tile.name); setEditingField(null); }
            }}
            style={{ flex: 1, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)', padding: '0 4px', fontSize: 11, outline: 'none' }}
          />
        ) : (
          <span
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
            onDoubleClick={() => { setLocalName(tile.name); setEditingField('name'); }}
            title="Двойной клик — переименовать"
          >
            {tile.name || 'Без названия'}
          </span>
        )}
      </div>

      <button
        onClick={e => { e.stopPropagation(); if (confirm(`Удалить тариф «${tile.name}»?`)) onRemove(idx); }}
        onPointerDown={e => e.stopPropagation()}
        title="Удалить"
        className="tm-tile-action"
        style={{
          position: 'absolute', top: 6, right: 6,
          width: 22, height: 22, borderRadius: '50%',
          background: 'rgba(255,0,0,0.75)', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>

      {/* Middle: price + duration editors (visible on hover via tm-tile-meta) */}
      <div
        className="tm-tile-meta"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: 6, right: 6, top: 36,
          display: 'flex', flexDirection: 'column', gap: 4,
          background: 'rgba(0,0,0,0.55)', borderRadius: 4, padding: 6,
          color: '#fff', fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ minWidth: 38, opacity: 0.7 }}>Цена</span>
          {editingField === 'price' ? (
            <input
              autoFocus type="number" value={localPrice}
              onChange={e => setLocalPrice(e.target.value)}
              onBlur={() => { onUpdateField(idx, { price: Number(localPrice) }); setEditingField(null); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { onUpdateField(idx, { price: Number(localPrice) }); setEditingField(null); }
                if (e.key === 'Escape') { setLocalPrice(String(tile.price)); setEditingField(null); }
              }}
              style={{ flex: 1, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '0 4px', fontSize: 11, outline: 'none' }}
            />
          ) : (
            <span
              onDoubleClick={() => { setLocalPrice(String(tile.price)); setEditingField('price'); }}
              style={{ flex: 1, cursor: 'text', fontWeight: 700, color: '#f5c800' }}
              title="Двойной клик — изменить"
            >
              {fmt(Number(tile.price))} ₽
            </span>
          )}
        </div>
        {/* Max activations per user — relevant for free tariffs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ minWidth: 38, opacity: 0.7 }}>Акт.</span>
          {editingField === 'maxAct' ? (
            <input
              autoFocus type="number" min={0} value={localMaxAct}
              onChange={e => setLocalMaxAct(e.target.value)}
              onBlur={() => { onUpdateField(idx, { max_activations_per_user: Number(localMaxAct) }); setEditingField(null); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { onUpdateField(idx, { max_activations_per_user: Number(localMaxAct) }); setEditingField(null); }
                if (e.key === 'Escape') { setLocalMaxAct(String(tile.max_activations_per_user ?? 0)); setEditingField(null); }
              }}
              style={{ width: 50, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '0 4px', fontSize: 11, outline: 'none' }}
            />
          ) : (
            <span
              onDoubleClick={() => { setLocalMaxAct(String(tile.max_activations_per_user ?? 0)); setEditingField('maxAct'); }}
              style={{ flex: 1, cursor: 'text', opacity: 0.9 }}
              title="Двойной клик — изменить лимит активаций (0 = неограничено)"
            >
              {Number(tile.max_activations_per_user) > 0 ? `макс ${tile.max_activations_per_user}×` : '∞'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ minWidth: 38, opacity: 0.7 }}>Срок</span>
          {editingField === 'duration' ? (
            <>
              <input
                autoFocus type="number" min={1} value={localDur}
                onChange={e => setLocalDur(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onUpdateField(idx, { duration_value: Number(localDur), duration_unit: localDurUnit });
                    setEditingField(null);
                  }
                  if (e.key === 'Escape') {
                    setLocalDur(String(tile.duration_value));
                    setLocalDurUnit(tile.duration_unit);
                    setEditingField(null);
                  }
                }}
                style={{ width: 50, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '0 4px', fontSize: 11, outline: 'none' }}
              />
              <select
                value={localDurUnit}
                onChange={e => setLocalDurUnit(e.target.value)}
                style={{ background: '#222', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', fontSize: 11 }}
              >
                <option value="day">дн</option>
                <option value="month">мес</option>
              </select>
              <button
                onClick={() => {
                  onUpdateField(idx, { duration_value: Number(localDur), duration_unit: localDurUnit });
                  setEditingField(null);
                }}
                style={{ background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 3, padding: '1px 6px', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}
              >
                ✓
              </button>
            </>
          ) : (
            <span
              onDoubleClick={() => { setLocalDur(String(tile.duration_value)); setLocalDurUnit(tile.duration_unit); setEditingField('duration'); }}
              style={{ flex: 1, cursor: 'text' }}
              title="Двойной клик — изменить"
            >
              {tile.duration_value} {tile.duration_unit === 'month' ? 'мес' : 'дн'}
            </span>
          )}
        </div>
      </div>

      {/* Bottom toolbar */}
      <div
        className="tm-tile-toolbar"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: 4, display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
        }}
      >
        {SIZES.map(s => (
          <button
            key={s.label}
            onClick={e => { e.stopPropagation(); onSetSize(idx, s.w, s.h); }}
            style={{
              background: isActiveSize(s.w, s.h) ? '#f5c800' : 'rgba(255,255,255,0.9)',
              color: isActiveSize(s.w, s.h) ? '#1a1a1a' : '#555',
              border: 'none', borderRadius: 3, padding: '2px 5px',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
              minWidth: 26,
            }}
          >
            {s.label}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {tile.id && !isChild && (
          <button
            onClick={e => { e.stopPropagation(); onAddChild(tile.id!); }}
            title="Добавить мини-блок под этим столбцом (например, вариант на 60 дней / год)"
            style={{
              background: 'rgba(255,255,255,0.9)', color: '#555',
              borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
            }}
          >
            + мини
          </button>
        )}

        {tile.id && (
          <label
            title="Загрузить обложку"
            style={{
              background: 'rgba(255,255,255,0.9)', color: '#555',
              borderRadius: 3, padding: '2px 5px', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
            }}
          >
            📷
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && onUploadImage(tile.id!, e.target.files[0])} />
          </label>
        )}

        {tile.id && tile.image_path && (
          <button
            onClick={e => {
              e.stopPropagation();
              if (confirm('Удалить обложку?')) onDeleteImage(tile.id!);
            }}
            title="Удалить обложку"
            style={{
              background: 'rgba(255,255,255,0.9)', color: '#991b1b',
              border: 'none', borderRadius: 3, padding: '2px 5px',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            🗑
          </button>
        )}

        <button
          onClick={e => { e.stopPropagation(); onToggleActive(idx); }}
          title={tile.is_active ? 'Виден пользователям' : 'Скрыт'}
          style={{
            background: tile.is_active ? '#22c55e' : '#ccc',
            color: '#fff', border: 'none', borderRadius: 3,
            padding: '2px 6px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {tile.is_active ? '✓' : '✕'}
        </button>
      </div>
    </div>
  );
}

export default function TariffsManagerModal(props: Props) {
  const {
    tiles, onAddMain, onAddChild, onRemove, onSetSize,
    onToggleActive, onUpdateField, onReorder, onClose, onSave, onUploadImage, onDeleteImage,
  } = props;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const ids = tiles.map(t => t.id ? `t-${t.id}` : `new-${t._tempId}`);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    onReorder(oldIdx, newIdx);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: 1100, width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-title">Управление тарифами</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
          Перетаскивайте плитки мышкой для изменения порядка. При наведении — кнопки размера, обложки, удаления.
          Двойной клик по названию / цене / сроку — редактировать. Кнопка <code>+ мини</code> добавляет
          мини-блок (например, вариант на 60 дней) внутри выбранной колонки.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              <div style={{
                display: 'grid',
                // 4-column grid; row height auto-stretches via gridAutoRows.
                // gridAutoFlow: 'dense' lets multi-cell tiles slot in earlier
                // gaps, so the height of the canvas is determined by the
                // tiles you place — no fixed row count.
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridAutoRows: '110px',
                gridAutoFlow: 'dense',
                gap: 8,
                background: '#E3E3E3',
                padding: 12,
                borderRadius: 8,
                minHeight: 360,
              }}>
                {tiles.map((t, idx) => (
                  <SortableTariff
                    key={t.id || t._tempId}
                    tile={t}
                    idx={idx}
                    onRemove={onRemove}
                    onSetSize={onSetSize}
                    onToggleActive={onToggleActive}
                    onUpdateField={onUpdateField}
                    onUploadImage={onUploadImage}
                    onDeleteImage={onDeleteImage}
                    onAddChild={onAddChild}
                  />
                ))}
                {tiles.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>
                    Нет тарифов — добавьте первый ниже
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn-primary" style={{ padding: '6px 16px', whiteSpace: 'nowrap' }}
            onClick={onAddMain}>
            + Добавить столбец
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            «Мини-блок» добавляется кнопкой на самой плитке.
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-cancel" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={onSave}>Сохранить всё</button>
        </div>
      </div>

      <style jsx global>{`
        .tm-tile .tm-tile-toolbar { opacity: 0; transition: opacity 0.15s; }
        .tm-tile:hover .tm-tile-toolbar { opacity: 1; }
        .tm-tile .tm-tile-action { opacity: 0; transition: opacity 0.15s; }
        .tm-tile:hover .tm-tile-action { opacity: 1; }
        .tm-tile .tm-tile-meta { opacity: 0; transition: opacity 0.15s; }
        .tm-tile:hover .tm-tile-meta { opacity: 1; }
      `}</style>
    </div>
  );
}
