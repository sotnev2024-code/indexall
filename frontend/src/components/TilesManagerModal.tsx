'use client';
import { useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function getImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const filename = String(path).split(/[\\/]/).pop();
  return `${process.env.NEXT_PUBLIC_API_URL}/uploads/${filename}`;
}

interface Props {
  tiles: any[];
  newTileName: string;
  setNewTileName: (v: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onSetSize: (idx: number, w: number, h: number) => void;
  onToggleActive: (idx: number) => void;
  onUpdateName: (idx: number, name: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onClose: () => void;
  onSave: () => void;
  onUploadImage: (id: number, f: File) => Promise<void>;
}

const SIZES: { label: string; w: number; h: number }[] = [
  { label: '1×1', w: 1, h: 1 },
  { label: '2×1', w: 2, h: 1 },
  { label: '1×2', w: 1, h: 2 },
  { label: '2×2', w: 2, h: 2 },
];

function SortableTile({
  tile, idx, onRemove, onSetSize, onToggleActive, onUpdateName, onUploadImage,
}: {
  tile: any; idx: number;
  onRemove: (idx: number) => void;
  onSetSize: (idx: number, w: number, h: number) => void;
  onToggleActive: (idx: number) => void;
  onUpdateName: (idx: number, name: string) => void;
  onUploadImage: (id: number, f: File) => Promise<void>;
}) {
  const id = tile.id ? `t-${tile.id}` : `new-${tile._tempId}`;
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id });

  const [editingName, setEditingName] = useState(false);
  const [localName, setLocalName] = useState(tile.name);

  const w = tile.width ?? 1;
  const h = tile.height ?? 1;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${w}`,
    gridRow: `span ${h}`,
    opacity: isDragging ? 0.5 : (tile.is_active ? 1 : 0.55),
    zIndex: isDragging ? 100 : 'auto',
  };

  const imgSrc = getImageUrl(tile.image_path);

  const isActiveSize = (sw: number, sh: number) => w === sw && h === sh;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
        background: imgSrc ? '#fff' : '#eee',
        cursor: isDragging ? 'grabbing' : 'grab',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
      className="tm-tile"
    >
      {/* Drag area — cover the whole tile except hover controls */}
      <div
        {...attributes}
        {...listeners}
        style={{ position: 'absolute', inset: 0, cursor: 'grab' }}
      >
        {imgSrc ? (
          <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#999', pointerEvents: 'none' }}>
            {tile.icon || '🗂'}
          </div>
        )}
      </div>

      {/* Top-left: name (editable) */}
      <div
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 6, left: 6, right: 6,
          background: 'rgba(0,0,0,0.5)', color: '#fff',
          padding: '3px 8px', borderRadius: 4,
          fontSize: 11, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {editingName ? (
          <input
            autoFocus
            value={localName}
            onChange={e => setLocalName(e.target.value)}
            onBlur={() => { onUpdateName(idx, localName); setEditingName(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onUpdateName(idx, localName); setEditingName(false); }
              if (e.key === 'Escape') { setLocalName(tile.name); setEditingName(false); }
            }}
            style={{ flex: 1, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)', padding: '0 4px', fontSize: 11, outline: 'none' }}
          />
        ) : (
          <span
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
            onDoubleClick={() => { setLocalName(tile.name); setEditingName(true); }}
            title="Двойной клик — переименовать"
          >
            {tile.name}
          </span>
        )}
      </div>

      {/* Top-right: delete */}
      <button
        onClick={e => { e.stopPropagation(); if (confirm(`Удалить плитку «${tile.name}»?`)) onRemove(idx); }}
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

      {/* Bottom toolbar (hover) */}
      <div
        className="tm-tile-toolbar"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: 4, display: 'flex', gap: 3, alignItems: 'center',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
        }}
      >
        {/* Size buttons */}
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

        {/* Image upload */}
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
              onChange={e => e.target.files?.[0] && onUploadImage(tile.id, e.target.files[0])} />
          </label>
        )}

        {/* Active toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggleActive(idx); }}
          title={tile.is_active ? 'Видна пользователям' : 'Скрыта'}
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

export default function TilesManagerModal(props: Props) {
  const {
    tiles, newTileName, setNewTileName, onAdd, onRemove, onSetSize,
    onToggleActive, onUpdateName, onReorder, onClose, onSave, onUploadImage,
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
        style={{ maxWidth: 960, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-title">Управление плитками</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          Перетаскивайте плитки мышкой для изменения порядка. При наведении — кнопки размера, обложки и удаления.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridAutoRows: '130px',
                gridAutoFlow: 'dense',
                gap: 8,
                background: '#E3E3E3',
                padding: 12,
                borderRadius: 8,
                minHeight: 260,
              }}>
                {tiles.map((t, idx) => (
                  <SortableTile
                    key={t.id || t._tempId}
                    tile={t}
                    idx={idx}
                    onRemove={onRemove}
                    onSetSize={onSetSize}
                    onToggleActive={onToggleActive}
                    onUpdateName={onUpdateName}
                    onUploadImage={onUploadImage}
                  />
                ))}
                {tiles.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
                    Нет плиток — добавьте первую ниже
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Add new */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input className="admin-input" placeholder="Название новой плитки" value={newTileName}
            onChange={e => setNewTileName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onAdd()}
            style={{ flex: 1 }} />
          <button className="btn-primary" style={{ padding: '6px 16px', whiteSpace: 'nowrap' }}
            onClick={onAdd} disabled={!newTileName.trim()}>
            + Добавить плитку
          </button>
        </div>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-cancel" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={onSave}>Сохранить всё</button>
        </div>
      </div>

      {/* Hover CSS for toolbar visibility */}
      <style jsx global>{`
        .tm-tile .tm-tile-toolbar { opacity: 0; transition: opacity 0.15s; }
        .tm-tile:hover .tm-tile-toolbar { opacity: 1; }
        .tm-tile .tm-tile-action { opacity: 0; transition: opacity 0.15s; }
        .tm-tile:hover .tm-tile-action { opacity: 1; }
      `}</style>
    </div>
  );
}
