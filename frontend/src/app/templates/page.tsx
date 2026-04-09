'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { foldersApi, templatesApi, sheetsApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

const SHIELD_TYPES = ['ГРЩ', 'ВРУ', 'ВП', 'РП', 'ПЭСПЗ', 'ЩО', 'ЩС'];

type FolderNode = { id: number; name: string; children: FolderNode[]; items: any[] };

export default function TemplatesPage() {
  const router = useRouter();
  const { activeSheetId, activeProjectId } = useAppStore();
  const [templates, setTemplates] = useState<any[]>([]);
  const [folderTree, setFolderTree] = useState<{ children: FolderNode[]; items: any[] }>({ children: [], items: [] });
  const [selected, setSelected] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [applyModalOpen, setApplyModalOpen] = useState(false);

  // Folder tree UI
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Folder CRUD
  const [ctx, setCtx] = useState<any | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; type: 'folder' | 'template'; val: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const [moveTarget, setMoveTarget] = useState<{ type: 'folder' | 'template'; id: number } | null>(null);
  const [moveDest, setMoveDest] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([loadTemplates(), loadFolderTree()]).finally(() => setLoading(false));
  }, []);

  async function loadTemplates() {
    const { data } = await templatesApi.getAll({ search, ...filters });
    setTemplates(data);
    if (data.length > 0 && !selected) setSelected(data[0]);
  }

  async function loadFolderTree() {
    try {
      const { data } = await foldersApi.getTree('templates');
      setFolderTree(data);
      setExpandedFolders(new Set(data.children.map((f: FolderNode) => f.id)));
    } catch { /* folder feature may not be used yet */ }
  }

  async function reload() {
    await Promise.all([loadTemplates(), loadFolderTree()]);
  }

  // ── Template actions ──────────────────────────────────────────
  async function applyTemplate(mode: 'new' | 'replace' | 'append') {
    if (!selected) { toast.error('Выберите шаблон'); return; }
    const rows = (selected.rows || []).map((r: any, i: number) => ({ ...r, row_number: i + 1 }));
    try {
      if (mode === 'new') {
        if (!activeProjectId) { toast.error('Сначала откройте проект'); return; }
        const { data: newSheet } = await sheetsApi.create(activeProjectId, selected.name);
        if (rows.length > 0) await sheetsApi.saveRows(newSheet.id, rows);
        toast.success('Шаблон вставлен на новый лист');
        setApplyModalOpen(false);
        router.push(`/spec/${newSheet.id}`);
        return;
      }
      if (!activeSheetId) { toast.error('Сначала откройте лист'); return; }
      if (mode === 'replace') {
        await sheetsApi.saveRows(activeSheetId, rows);
        toast.success('Лист заменён шаблоном');
      } else {
        const { data: sh } = await sheetsApi.getOne(activeSheetId);
        const existing = (sh.rows || []).filter((r: any) => r.name);
        await sheetsApi.saveRows(activeSheetId, [...existing, ...rows]);
        toast.success('Шаблон добавлен в конец листа');
      }
      setApplyModalOpen(false);
      router.push(`/spec/${activeSheetId}`);
    } catch { toast.error('Ошибка применения шаблона'); }
  }

  async function deleteTemplate(tmpl?: any) {
    const t = tmpl || selected;
    if (!t) return;
    if (t.scope === 'common') { toast.error('Общие шаблоны нельзя удалить'); return; }
    if (!confirm(`Удалить шаблон «${t.name}»?`)) return;
    try {
      await templatesApi.remove(t.id);
      await reload();
      if (selected?.id === t.id) setSelected(null);
      toast.success('Шаблон удалён');
    } catch { toast.error('Ошибка удаления'); }
  }

  function patchFolderTree(tree: { children: FolderNode[]; items: any[] }, id: number, patch: any): { children: FolderNode[]; items: any[] } {
    function patchNode(n: FolderNode): FolderNode {
      return { ...n, children: n.children.map(patchNode), items: n.items.map(t => t.id === id ? { ...t, ...patch } : t) };
    }
    return { children: tree.children.map(patchNode), items: tree.items.map(t => t.id === id ? { ...t, ...patch } : t) };
  }

  async function toggleFavorite(tmpl?: any) {
    const target = tmpl || selected;
    if (!target) return;
    try {
      await templatesApi.toggleFavorite(target.id);
      const patch = { is_favorite: !target.is_favorite };
      const updated = { ...target, ...patch };
      if (selected?.id === target.id) setSelected(updated);
      setTemplates(prev => prev.map(t => t.id === target.id ? updated : t));
      setFolderTree(prev => patchFolderTree(prev, target.id, patch));
      toast.success(updated.is_favorite ? 'Добавлено в избранное' : 'Убрано из избранного');
    } catch { toast.error('Ошибка'); }
  }

  // ── Folder CRUD ───────────────────────────────────────────────
  async function renameFolder(id: number, name: string) {
    if (!name.trim()) return;
    try { await foldersApi.rename(id, name.trim()); await loadFolderTree(); }
    catch { toast.error('Ошибка переименования'); }
  }

  async function renameTemplateItem(id: number, name: string) {
    if (!name.trim()) return;
    try { await templatesApi.update(id, { name: name.trim() }); await reload(); }
    catch { toast.error('Ошибка переименования'); }
  }

  async function deleteFolder(id: number, name: string) {
    if (!confirm(`Удалить папку «${name}»? Шаблоны внутри останутся без папки.`)) return;
    try { await foldersApi.remove(id); await loadFolderTree(); toast.success('Папка удалена'); }
    catch { toast.error('Ошибка удаления папки'); }
  }

  function startRename(id: number, type: 'folder' | 'template', val: string) {
    setRenaming({ id, type, val });
    setCtx(null);
    setTimeout(() => renameRef.current?.focus(), 50);
  }

  async function commitRename() {
    if (!renaming) return;
    const { id, type, val } = renaming;
    setRenaming(null);
    if (type === 'folder') await renameFolder(id, val);
    else await renameTemplateItem(id, val);
  }

  async function confirmMove() {
    if (!moveTarget) return;
    try {
      if (moveTarget.type === 'folder') {
        await foldersApi.move(moveTarget.id, moveDest);
      } else {
        await foldersApi.moveTemplate(moveTarget.id, moveDest);
      }
      setMoveTarget(null); setMoveDest(null);
      await loadFolderTree();
      toast.success('Перемещено');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка перемещения');
    }
  }

  function toggleFolderExpand(id: number) {
    setExpandedFolders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function collectFoldersList(nodes: FolderNode[], depth = 0): { id: number; name: string; depth: number }[] {
    const res: { id: number; name: string; depth: number }[] = [];
    for (const n of nodes) {
      res.push({ id: n.id, name: n.name, depth });
      res.push(...collectFoldersList(n.children, depth + 1));
    }
    return res;
  }

  // ── Render ────────────────────────────────────────────────────
  function renderFolderNode(node: FolderNode, depth: number): React.ReactNode {
    const isOpen = expandedFolders.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="template-item folder-item"
          style={{ paddingLeft: 8 + depth * 14, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          onClick={() => toggleFolderExpand(node.id)}
          onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, type: 'folder', id: node.id, name: node.name }); }}
        >
          <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 10 }}>{isOpen ? '▼' : '▶'}</span>
          <span>📁</span>
          {renaming?.id === node.id && renaming.type === 'folder' ? (
            <input
              ref={renameRef}
              style={{ flex: 1, fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--accent)', borderRadius: 3, padding: '1px 4px', color: 'var(--text)' }}
              value={renaming.val}
              onChange={e => setRenaming(r => r ? { ...r, val: e.target.value } : null)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span style={{ flex: 1, fontSize: 12 }}>{node.name}</span>
          )}
        </div>
        {isOpen && (
          <>
            {node.children.map(child => renderFolderNode(child, depth + 1))}
            {node.items.map(t => renderTemplateItem(t, depth + 1))}
          </>
        )}
      </div>
    );
  }

  function renderTemplateItem(t: any, depth = 0): React.ReactNode {
    return (
      <div
        key={t.id}
        className={`template-item${selected?.id === t.id ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setSelected(t)}
        onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, type: 'template', id: t.id, name: t.name, scope: t.scope }); }}
      >
        <button className={`tmpl-star-btn${t.is_favorite ? ' is-fav' : ''}`}
          onClick={e => { e.stopPropagation(); toggleFavorite(t); }}
          title={t.is_favorite ? 'Убрать из избранного' : 'В избранное'}>
          {t.is_favorite ? '★' : '☆'}
        </button>
        <span className="tmpl-item-name">{t.name}</span>
      </div>
    );
  }

  const filtered = templates.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  const groups = [
    { key: 'my',     label: 'Мои шаблоны',  filter: (t: any) => t.scope === 'my' },
    { key: 'fav',    label: 'Избранное',     filter: (t: any) => !!t.is_favorite },
    { key: 'common', label: 'Общие шаблоны', filter: (t: any) => t.scope === 'common' },
  ];

  const allFolders = collectFoldersList(folderTree.children);
  const hasFolders = folderTree.children.length > 0;

  if (loading) return <div style={{ paddingTop: 100, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>;

  return (
    <>
      <Header breadcrumb="Шаблоны" />
      <div className="templates-screen" onClick={() => setCtx(null)}>
        {/* Top toolbar */}
        <div className="templates-toolbar">
          <div className="templates-search">
            <span style={{ color: 'var(--muted)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию шаблонов" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-back" onClick={() => router.back()}>← Вернуться на лист</button>
          </div>
        </div>

        {/* Shield filters */}
        <div className="shield-filters">
          {SHIELD_TYPES.map(st => (
            <button key={st} className={`shield-chip${filters.shieldType === st ? ' active' : ''}`}
              onClick={() => setFilters((f: any) => ({ ...f, shieldType: f.shieldType === st ? undefined : st }))}>
              {st}
            </button>
          ))}
        </div>

        <div className="templates-body">
          {/* Left — template list */}
          <div className="templates-left">
            {hasFolders ? (
              /* Folder tree view — shown automatically when folders exist */
              <>
                <div className="template-group-title" style={{ userSelect: 'none' }}>
                  <span>📂 Мои шаблоны</span>
                </div>
                {folderTree.children.map(f => renderFolderNode(f, 0))}
                {folderTree.items.map(t => renderTemplateItem(t, 0))}
                {/* Common templates below folders */}
                {filtered.filter((t: any) => t.scope === 'common').length > 0 && (
                  <div className="template-group">
                    <div className="template-group-title" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleGroup('common')}>
                      <span>{collapsedGroups.has('common') ? '▶' : '▼'} 📁</span>
                      <span>Общие шаблоны <span className="template-group-count">({filtered.filter((t: any) => t.scope === 'common').length})</span></span>
                    </div>
                    {!collapsedGroups.has('common') && filtered.filter((t: any) => t.scope === 'common').map((t: any) => renderTemplateItem(t))}
                  </div>
                )}
              </>
            ) : (
              /* Flat group view */
              groups.map(g => {
                const items = filtered.filter(g.filter);
                const isCollapsed = collapsedGroups.has(g.key);
                return (
                  <div key={g.key} className="template-group">
                    <div
                      className="template-group-title"
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleGroup(g.key)}
                    >
                      <span>{isCollapsed ? '▶' : '▼'} 📁</span>
                      <span>{g.label} <span className="template-group-count">({items.length})</span></span>
                    </div>
                    {!isCollapsed && items.map(t => renderTemplateItem(t))}
                  </div>
                );
              })
            )}
          </div>

          {/* Right — preview */}
          <div className="templates-right">
            {selected ? (
              <>
                <div className="template-preview-name">{selected.name}</div>
                <div className="template-preview-meta">
                  {selected.scope === 'common' ? 'Общий шаблон' : 'Мой шаблон'}
                  {selected.is_favorite ? ' · ★ Избранное' : ''}
                </div>
                <div className="template-actions">
                  <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setApplyModalOpen(true)}>
                    + Добавить в лист
                  </button>
                  <button className="btn-outline" style={{ fontSize: 12 }} onClick={() => toggleFavorite()}>
                    {selected.is_favorite ? '★' : '☆'} В избранное
                  </button>
                  {selected.scope !== 'common' && (
                    <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => deleteTemplate()}>
                      🗑 Удалить
                    </button>
                  )}
                </div>
                <table className="template-table">
                  <thead>
                    <tr>{['№', 'Название', 'Бренд', 'Артикул', 'Кол-во'].map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(selected.rows || []).map((r: any, i: number) => (
                      <tr key={i}>
                        <td>{r.row_number}</td>
                        <td>{r.name}</td>
                        <td>{r.brand}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.article}</td>
                        <td>{r.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="empty-state">Выберите шаблон</div>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {ctx && (
        <div className="context-menu" style={{ left: ctx.x, top: ctx.y }} onClick={e => e.stopPropagation()}>
          {ctx.type === 'folder' && (
            <>
              <div className="context-item" onClick={() => startRename(ctx.id, 'folder', ctx.name)}>
                Переименовать
              </div>
              <div className="context-item danger" onClick={() => { deleteFolder(ctx.id, ctx.name); setCtx(null); }}>
                Удалить
              </div>
            </>
          )}
          {ctx.type === 'template' && (
            <>
              <div className="context-item" onClick={() => startRename(ctx.id, 'template', ctx.name)}>
                Переименовать
              </div>
              <div className="context-item" onClick={() => { setMoveTarget({ type: 'template', id: ctx.id }); setMoveDest(null); setCtx(null); }}>
                В папку
              </div>
              {ctx.scope !== 'common' && (
                <div className="context-item danger" onClick={() => { deleteTemplate({ id: ctx.id, name: ctx.name, scope: ctx.scope }); setCtx(null); }}>
                  Удалить
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Move modal */}
      {moveTarget && (
        <div className="modal-overlay" onClick={() => setMoveTarget(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Переместить {moveTarget.type === 'folder' ? 'папку' : 'шаблон'}</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Выберите папку назначения:</p>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 16 }}>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, background: moveDest === null ? 'var(--accent-subtle)' : 'transparent' }}
                onClick={() => setMoveDest(null)}
              >
                📁 Без папки (корень)
              </div>
              {allFolders.filter(f => f.id !== moveTarget.id).map(f => (
                <div
                  key={f.id}
                  style={{ padding: '8px 12px', paddingLeft: 12 + f.depth * 14, cursor: 'pointer', fontSize: 13, background: moveDest === f.id ? 'var(--accent-subtle)' : 'transparent' }}
                  onClick={() => setMoveDest(f.id)}
                >
                  📁 {f.name}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setMoveTarget(null)}>Отмена</button>
              <button className="btn-primary" onClick={confirmMove}>Переместить</button>
            </div>
          </div>
        </div>
      )}

      {/* Apply modal */}
      {applyModalOpen && (
        <div className="modal-overlay" onClick={() => setApplyModalOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Как применить шаблон?</div>
            <div className="modal-option" onClick={() => applyTemplate('new')}>📄 Вставить на новый лист</div>
            <div className="modal-option" onClick={() => applyTemplate('replace')}>🔄 Заменить текущий лист</div>
            <div className="modal-option" onClick={() => applyTemplate('append')}>➕ Добавить в конец листа</div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setApplyModalOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
