'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { foldersApi, sheetsApi, trashApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

const formatMoney = (n: number) =>
  n ? n.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽' : '–';

/** Returns adjusted {x, y} so the context menu (approx 180×220px) stays inside the viewport */
function safeMenuPos(clientX: number, clientY: number, menuW = 184, menuH = 220) {
  const x = clientX + menuW > window.innerWidth  ? clientX - menuW : clientX;
  const y = clientY + menuH > window.innerHeight ? clientY - menuH : clientY;
  return { x: Math.max(4, x), y: Math.max(4, y) };
}
const formatDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('ru-RU') : '';

// ── Types ──────────────────────────────────────────────────────
type FolderNode = {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  updatedAt: string;
  children: FolderNode[];
  items: SheetItem[];
};
type SheetItem = {
  id: number;
  name: string;
  total: number;
  folder_id: number | null;
  updatedAt: string;
};

export default function ProjectsPage() {
  const router = useRouter();
  const { setActive } = useAppStore();

  const [tree, setTree] = useState<{ children: FolderNode[]; items: SheetItem[] }>({ children: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');

  // Renaming
  const [renaming, setRenaming] = useState<{ id: number; type: 'folder' | 'sheet'; val: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Context menu
  const [ctx, setCtx] = useState<{
    x: number; y: number;
    type: 'folder' | 'sheet';
    id: number;
    folderId?: number;
    name: string;
  } | null>(null);

  // New folder modal
  const [newFolderParent, setNewFolderParent] = useState<number | null | 'root'>('root');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  // Move modal
  const [moveTarget, setMoveTarget] = useState<{ type: 'folder' | 'sheet'; id: number } | null>(null);
  const [moveDest, setMoveDest] = useState<number | null>(null);

  // Welcome modal
  const [showWelcome, setShowWelcome] = useState(false);

  // Trash
  const [showTrash, setShowTrash] = useState(false);
  const [trashItems, setTrashItems] = useState<any[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);

  // Drag & drop
  const [drag, setDrag] = useState<{ type: 'folder' | 'sheet'; id: number; folderId?: number | null } | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);
  const [dropHalf, setDropHalf] = useState<'top' | 'bottom' | 'inside'>('inside');

  useEffect(() => { loadTree(); }, []);

  async function loadTree() {
    try {
      const { data } = await foldersApi.getTree('projects');
      setTree(data);
      if (data.children.length === 0 && data.items.length === 0) setShowWelcome(true);
      // Auto-expand root folders
      setExpanded(new Set(data.children.map((f: FolderNode) => f.id)));
    } catch { toast.error('Ошибка загрузки проектов'); }
    finally { setLoading(false); }
  }

  // ── Expand / collapse ─────────────────────────────────────────
  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Folder CRUD ───────────────────────────────────────────────
  async function createFolder(parentId: number | null) {
    const name = newFolderName.trim() || 'Новая папка';
    try {
      await foldersApi.create(name, parentId, 'projects');
      setShowNewFolder(false);
      setNewFolderName('');
      await loadTree();
      toast.success(`Папка «${name}» создана`);
    } catch { toast.error('Ошибка создания папки'); }
  }

  async function renameFolder(id: number, name: string) {
    if (!name.trim()) return;
    try {
      await foldersApi.rename(id, name.trim());
      await loadTree();
    } catch { toast.error('Ошибка переименования'); }
  }

  async function deleteFolder(id: number, name: string) {
    if (!confirm(`Удалить папку «${name}» со всем содержимым? Это действие необратимо.`)) return;
    try {
      await foldersApi.remove(id);
      await loadTree();
      toast.success('Папка удалена');
    } catch { toast.error('Ошибка удаления папки'); }
  }

  // ── Sheet CRUD ────────────────────────────────────────────────
  async function createSheet(folderId: number) {
    try {
      const { data } = await foldersApi.createSheet(folderId);
      await loadTree();
      setExpanded(prev => new Set([...prev, folderId]));
      startRename(data.id, 'sheet', '');
    } catch { toast.error('Ошибка создания листа'); }
  }

  async function renameSheet(id: number, name: string) {
    if (!name.trim()) return;
    try {
      await sheetsApi.update(id, { name: name.trim() });
      await loadTree();
    } catch { toast.error('Ошибка переименования'); }
  }

  async function duplicateSheet(id: number) {
    try {
      await sheetsApi.duplicate(id);
      await loadTree();
      toast.success('Лист дублирован');
    } catch { toast.error('Ошибка дублирования'); }
  }

  async function deleteSheet(id: number, name: string) {
    if (!confirm(`Удалить лист «${name}»?`)) return;
    try {
      await sheetsApi.remove(id);
      await loadTree();
      toast.success('Лист удалён');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка удаления');
    }
  }

  function openSheet(folderId: number, sheetId: number) {
    setActive(folderId, sheetId);
    window.dispatchEvent(new Event('navigation:start'));
    router.push(`/spec/${sheetId}`);
  }

  // ── Renaming ──────────────────────────────────────────────────
  function startRename(id: number, type: 'folder' | 'sheet', val: string) {
    setRenaming({ id, type, val });
    setCtx(null);
    setTimeout(() => renameRef.current?.focus(), 50);
  }

  async function commitRename() {
    if (!renaming) return;
    const { id, type, val } = renaming;
    setRenaming(null);
    if (type === 'folder') await renameFolder(id, val);
    else await renameSheet(id, val);
  }

  // ── Move ─────────────────────────────────────────────────────
  async function confirmMove() {
    if (!moveTarget) return;
    try {
      if (moveTarget.type === 'folder') {
        await foldersApi.move(moveTarget.id, moveDest);
      } else {
        if (moveDest === null) { toast.error('Выберите папку назначения'); return; }
        await foldersApi.moveSheet(moveTarget.id, moveDest!);
      }
      setMoveTarget(null);
      setMoveDest(null);
      await loadTree();
      toast.success('Перемещено');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка перемещения');
    }
  }

  // ── Search ────────────────────────────────────────────────────
  function collectAll(nodes: FolderNode[], depth = 0): any[] {
    const result: any[] = [];
    for (const n of nodes) {
      result.push({ type: 'folder', id: n.id, name: n.name, depth });
      for (const s of n.items) result.push({ type: 'sheet', id: s.id, name: s.name, folderId: n.id, depth: depth + 1 });
      result.push(...collectAll(n.children, depth + 1));
    }
    for (const s of tree.items) result.push({ type: 'sheet', id: s.id, name: s.name, folderId: null, depth: 0 });
    return result;
  }

  const searchResults = search.length >= 2
    ? collectAll(tree.children).filter(r => r.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : [];

  // ── Drag & Drop ───────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, type: 'folder' | 'sheet', id: number, folderId?: number | null) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    setDrag({ type, id, folderId });
  }

  function onDragOver(e: React.DragEvent, id: number, acceptInside = true) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const half = y < rect.height * 0.3 ? 'top' : y > rect.height * 0.7 ? 'bottom' : (acceptInside ? 'inside' : 'bottom');
    if (dropId !== id || dropHalf !== half) { setDropId(id); setDropHalf(half); }
  }

  function onDragLeave(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropId(null);
  }

  async function onDrop(e: React.DragEvent, targetType: 'folder' | 'sheet', targetId: number, targetFolderId?: number | null) {
    e.preventDefault();
    e.stopPropagation();
    if (!drag || drag.id === targetId) { setDrag(null); setDropId(null); return; }

    try {
      if (drag.type === 'sheet') {
        // Move sheet to target folder
        const destFolder = dropHalf === 'inside' && targetType === 'folder'
          ? targetId
          : targetFolderId ?? null;
        if (destFolder !== null && destFolder !== drag.folderId) {
          await foldersApi.moveSheet(drag.id, destFolder);
          await loadTree();
        }
      } else if (drag.type === 'folder' && targetType === 'folder') {
        if (dropHalf === 'inside') {
          await foldersApi.move(drag.id, targetId);
        } else {
          // Move as sibling
          // Find the parent of targetId and move drag there
          const findParent = (nodes: FolderNode[]): number | null => {
            for (const n of nodes) {
              if (n.children.some(c => c.id === targetId)) return n.id;
              const found = findParent(n.children);
              if (found !== null) return found;
            }
            return null;
          };
          const parent = findParent(tree.children);
          await foldersApi.move(drag.id, parent);
          await loadTree();
        }
        await loadTree();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка перемещения');
    }

    setDrag(null);
    setDropId(null);
  }

  // ── Collect all folders flat (for move modal) ─────────────────
  function collectFolders(nodes: FolderNode[], depth = 0): { id: number; name: string; depth: number }[] {
    const result: { id: number; name: string; depth: number }[] = [];
    for (const n of nodes) {
      result.push({ id: n.id, name: n.name, depth });
      result.push(...collectFolders(n.children, depth + 1));
    }
    return result;
  }

  // ── Render folder + its contents ──────────────────────────────
  function renderFolder(folder: FolderNode, depth: number): React.ReactNode {
    const isOpen = expanded.has(folder.id);
    const isDragging = drag?.type === 'folder' && drag.id === folder.id;
    const isDropTarget = dropId === folder.id;
    const dropClass = isDropTarget
      ? (dropHalf === 'inside' ? ' drop-into' : dropHalf === 'top' ? ' drop-before' : ' drop-after')
      : '';

    return (
      <div key={folder.id}>
        {/* Folder row */}
        <div
          className={`project-row project-header${isDragging ? ' is-dragging' : ''}${dropClass}`}
          style={{ paddingLeft: 8 + depth * 18 }}
          draggable
          onDragStart={e => onDragStart(e, 'folder', folder.id)}
          onDragOver={e => onDragOver(e, folder.id, true)}
          onDragLeave={onDragLeave}
          onDrop={e => onDrop(e, 'folder', folder.id)}
          onDragEnd={() => { setDrag(null); setDropId(null); }}
        >
          <div className="project-name">
            <span className="drag-handle" title="Переместить">⠿</span>
            <button
              className="collapse-btn"
              onClick={e => { e.stopPropagation(); toggle(folder.id); }}
            >
              {isOpen ? '▼' : '▶'}
            </button>
            <span className="project-icon">📁</span>
            {renaming?.id === folder.id && renaming.type === 'folder' ? (
              <input
                ref={renameRef}
                className="inline-input"
                value={renaming.val}
                onChange={e => setRenaming(r => r ? { ...r, val: e.target.value } : null)}
                onBlur={commitRename}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
              />
            ) : (
              <span onDoubleClick={e => { e.stopPropagation(); startRename(folder.id, 'folder', folder.name); }}>
                {folder.name}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(folder.updatedAt)}</div>
          <div></div>
          <div>
            <button className="more-btn" onClick={e => {
              e.stopPropagation();
              setCtx({ ...safeMenuPos(e.clientX, e.clientY), type: 'folder', id: folder.id, name: folder.name });
            }}>···</button>
          </div>
        </div>

        {/* Expanded content */}
        {isOpen && (
          <>
            {folder.children.map(child => renderFolder(child, depth + 1))}
            {folder.items.map((sheet, si) => renderSheet(sheet, folder.id, depth + 1, si === folder.items.length - 1 && folder.children.length === 0))}
            <div
              className="add-sheet-row"
              style={{ paddingLeft: 20 + (depth + 1) * 18 }}
              onClick={() => createSheet(folder.id)}
            >
              <span>+</span> добавить лист
            </div>
          </>
        )}
      </div>
    );
  }

  function renderSheet(sheet: SheetItem, folderId: number | null, depth: number, isLast = false): React.ReactNode {
    const isDragging = drag?.type === 'sheet' && drag.id === sheet.id;
    const isDropTarget = dropId === sheet.id;
    const dropClass = isDropTarget
      ? (dropHalf === 'top' ? ' drop-before' : ' drop-after')
      : '';
    return (
      <div
        key={sheet.id}
        className={`project-row sheet-row${isDragging ? ' is-dragging' : ''}${dropClass}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        draggable
        onDragStart={e => onDragStart(e, 'sheet', sheet.id, folderId)}
        onDragOver={e => onDragOver(e, sheet.id, false)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, 'sheet', sheet.id, folderId)}
        onDragEnd={() => { setDrag(null); setDropId(null); }}
        onDoubleClick={() => folderId !== null && openSheet(folderId, sheet.id)}
        onContextMenu={e => { e.preventDefault(); setCtx({ ...safeMenuPos(e.clientX, e.clientY), type: 'sheet', id: sheet.id, folderId, name: sheet.name }); }}
      >
        <div className="project-name">
          <span className="drag-handle" title="Переместить">⠿</span>
          <span className="sheet-tree-line">{isLast ? '└' : '├'}</span>
          <span className="sheet-icon">≡</span>
          {renaming?.id === sheet.id && renaming.type === 'sheet' ? (
            <input
              ref={renameRef}
              className="inline-input"
              value={renaming.val}
              onChange={e => setRenaming(r => r ? { ...r, val: e.target.value } : null)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
            />
          ) : (
            <span onDoubleClick={e => { e.stopPropagation(); startRename(sheet.id, 'sheet', sheet.name); }}>
              {sheet.name}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(sheet.updatedAt)}</div>
        <div style={{ fontSize: 12 }}>{formatMoney(sheet.total)}</div>
        <div></div>
      </div>
    );
  }

  if (loading) return <div style={{ paddingTop: 100, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>;

  const allFolders = collectFolders(tree.children);

  return (
    <>
      <Header breadcrumb="Проекты" />

      <div className="projects-screen" onClick={() => setCtx(null)}>
        <div className="projects-content">

          {/* Welcome modal */}
          {showWelcome && (
            <div className="modal-overlay">
              <div className="welcome-modal">
                <h2>Добро пожаловать в INDEXALL</h2>
                <p>Создавайте папки, собирайте спецификации, подбирайте оборудование из каталогов.</p>
                <label>Название первой папки</label>
                <input
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (() => { createFolder(null); setShowWelcome(false); })()}
                  placeholder="Проект 1"
                  autoFocus
                />
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: 12, justifyContent: 'center', fontSize: 15 }}
                  onClick={() => { createFolder(null); setShowWelcome(false); }}
                >
                  Создать папку
                </button>
              </div>
            </div>
          )}

          <div className="projects-title">Все проекты</div>

          {/* Toolbar */}
          <div className="projects-toolbar">
            <div className="search-box" style={{ position: 'relative' }}>
              <span className="search-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по проектам…"
              />
              {searchResults.length > 0 && (
                <div className="search-dropdown">
                  {searchResults.map((r, i) => (
                    <div key={i} className="search-item" onClick={() => {
                      setSearch('');
                      if (r.type === 'sheet' && r.folderId) openSheet(r.folderId, r.id);
                    }}>
                      <div className="search-item-label">{r.type === 'folder' ? '📁 Папка' : '≡ Лист'}</div>
                      <div>{r.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-create" onClick={() => { setNewFolderParent(null); setNewFolderName(''); setShowNewFolder(true); }}>
              + Создать папку
            </button>
            <button className="btn-outline" onClick={async () => {
              setShowTrash(true); setTrashLoading(true);
              try { const { data } = await trashApi.getAll(); setTrashItems(data); }
              catch { toast.error('Ошибка загрузки корзины'); }
              finally { setTrashLoading(false); }
            }}>🗑 Корзина</button>
          </div>

          {/* Table */}
          <div className="projects-table">
            <div className="table-header">
              <div>Название</div>
              <div>Дата изменения</div>
              <div>Сумма</div>
              <div></div>
            </div>

            {tree.children.length === 0 && tree.items.length === 0 && !loading && (
              <div className="empty-state">
                <h3>Нет проектов</h3>
                <p>Создайте первую папку, нажав «+ Создать папку»</p>
              </div>
            )}

            {/* Root-level folders */}
            {tree.children.map(folder => renderFolder(folder, 0))}

            {/* Root-level sheets (orphans / legacy) */}
            {tree.items.map((sheet, i) => renderSheet(sheet, null, 0, i === tree.items.length - 1))}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {ctx && (
        <div className="context-menu" style={{ left: ctx.x, top: ctx.y }} onClick={e => e.stopPropagation()}>
          {ctx.type === 'folder' ? (
            <>
              <div className="context-item" onClick={() => { setNewFolderParent(ctx.id); setNewFolderName(''); setShowNewFolder(true); setCtx(null); }}>
                + Создать подпапку
              </div>
              <div className="context-item" onClick={() => { createSheet(ctx.id); setCtx(null); }}>
                + Добавить лист
              </div>
              <div className="context-item" onClick={() => startRename(ctx.id, 'folder', ctx.name)}>
                Переименовать
              </div>
              <div className="context-item" onClick={() => { setMoveTarget({ type: 'folder', id: ctx.id }); setMoveDest(null); setCtx(null); }}>
                Переместить
              </div>
              <div className="context-item danger" onClick={() => { deleteFolder(ctx.id, ctx.name); setCtx(null); }}>
                Удалить
              </div>
            </>
          ) : (
            <>
              <div className="context-item" onClick={() => { if (ctx.folderId) openSheet(ctx.folderId, ctx.id); setCtx(null); }}>
                Открыть
              </div>
              <div className="context-item" onClick={() => startRename(ctx.id, 'sheet', ctx.name)}>
                Переименовать
              </div>
              <div className="context-item" onClick={() => { duplicateSheet(ctx.id); setCtx(null); }}>
                Дублировать
              </div>
              <div className="context-item" onClick={() => { setMoveTarget({ type: 'sheet', id: ctx.id }); setMoveDest(null); setCtx(null); }}>
                Переместить
              </div>
              <div className="context-item danger" onClick={() => { deleteSheet(ctx.id, ctx.name); setCtx(null); }}>
                Удалить
              </div>
            </>
          )}
        </div>
      )}

      {/* New folder modal */}
      {showNewFolder && (
        <div className="modal-overlay" onClick={() => setShowNewFolder(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {newFolderParent === null ? 'Новая корневая папка' : 'Новая подпапка'}
            </div>
            <input
              className="modal-input"
              style={{ width: '100%', marginBottom: 16, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }}
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="Название папки"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && createFolder(typeof newFolderParent === 'number' ? newFolderParent : null)}
            />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowNewFolder(false)}>Отмена</button>
              <button className="btn-primary" onClick={() => createFolder(typeof newFolderParent === 'number' ? newFolderParent : null)}>
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move modal */}
      {moveTarget && (
        <div className="modal-overlay" onClick={() => setMoveTarget(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              Переместить {moveTarget.type === 'folder' ? 'папку' : 'лист'}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Выберите папку назначения:
            </p>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 16 }}>
              {moveTarget.type === 'folder' && (
                <div
                  className={`move-folder-item${moveDest === null ? ' selected' : ''}`}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, background: moveDest === null ? 'var(--accent-subtle)' : 'transparent' }}
                  onClick={() => setMoveDest(null)}
                >
                  📁 Корневой уровень
                </div>
              )}
              {allFolders
                .filter(f => f.id !== moveTarget.id)
                .map(f => (
                  <div
                    key={f.id}
                    className="move-folder-item"
                    style={{
                      padding: '8px 12px',
                      paddingLeft: 12 + f.depth * 14,
                      cursor: 'pointer',
                      fontSize: 13,
                      background: moveDest === f.id ? 'var(--accent-subtle)' : 'transparent',
                    }}
                    onClick={() => setMoveDest(f.id)}
                  >
                    📁 {f.name}
                  </div>
                ))
              }
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setMoveTarget(null)}>Отмена</button>
              <button className="btn-primary" onClick={confirmMove}>Переместить</button>
            </div>
          </div>
        </div>
      )}

      {/* Trash modal */}
      {showTrash && (
        <div className="modal-overlay" onClick={() => setShowTrash(false)}>
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">🗑 Корзина</div>
            <div className="trash-modal-list">
              {trashLoading && <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Загрузка…</p>}
              {!trashLoading && trashItems.length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Корзина пуста</p>
              )}
              {trashItems.map(item => (
                <div key={item.id} className="trash-item">
                  <span className="trash-item-icon">{item.entity_type === 'project' ? '📁' : '≡'}</span>
                  <div className="trash-item-info">
                    <div className="trash-item-name">{item.name || `${item.entity_type} #${item.entity_id}`}</div>
                    <div className="trash-item-meta">Удалён: {new Date(item.deleted_at).toLocaleDateString('ru-RU')}</div>
                  </div>
                  <div className="trash-item-actions">
                    <button className="trash-restore-btn" onClick={async () => {
                      try {
                        await trashApi.restore(item.id);
                        setTrashItems(prev => prev.filter(i => i.id !== item.id));
                        toast.success('Восстановлено');
                        loadTree();
                      } catch { toast.error('Ошибка восстановления'); }
                    }}>↺ Восстановить</button>
                    <button className="btn-danger" style={{ fontSize: 12, padding: '4px 10px' }} onClick={async () => {
                      if (!confirm('Удалить навсегда?')) return;
                      await trashApi.permanentDelete(item.id);
                      setTrashItems(prev => prev.filter(i => i.id !== item.id));
                      toast.success('Удалено навсегда');
                    }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowTrash(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
