'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { projectsApi, sheetsApi, trashApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

const MAX_UNDO = 30;
const PAGE_SIZE = 10;

type Snapshot = { projects: any[] };

export default function ProjectsPage() {
  const router = useRouter();
  const { setActive, user } = useAppStore();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeName, setWelcomeName] = useState('');
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: 'project' | 'sheet'; id: number; projId?: number } | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameType, setRenameType] = useState<'project' | 'sheet'>('project');
  const [renameValue, setRenameValue] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [trashItems, setTrashItems] = useState<any[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);

  // ── Drag & Drop ──────────────────────────────────────────────
  const [dragItem, setDragItem] = useState<{ type: 'project' | 'sheet'; id: number; projId?: number } | null>(null);
  const [dropZone, setDropZone] = useState<{ type: 'project' | 'sheet'; id: number; projId?: number; half: 'top' | 'bottom' } | null>(null);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    try {
      const { data } = await projectsApi.getAll();
      setProjects(data);
      if (data.length === 0) setShowWelcome(true);
    } catch { toast.error('Ошибка загрузки проектов'); }
    finally { setLoading(false); }
  }

  function saveSnapshot(currentProjects: any[]) {
    const snap: Snapshot = { projects: JSON.parse(JSON.stringify(currentProjects)) };
    setUndoStack(s => { const next = [...s, snap]; return next.length > MAX_UNDO ? next.slice(1) : next; });
    setRedoStack([]);
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, { projects: JSON.parse(JSON.stringify(projects)) }]);
    setUndoStack(s => s.slice(0, -1));
    setProjects(snap.projects);
    toast('Действие отменено');
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const snap = redoStack[redoStack.length - 1];
    setUndoStack(s => [...s, { projects: JSON.parse(JSON.stringify(projects)) }]);
    setRedoStack(r => r.slice(0, -1));
    setProjects(snap.projects);
    toast('Действие повторено');
  }

  async function createProject() {
    const name = welcomeName.trim() || 'Проект1';
    try {
      const { data } = await projectsApi.create(name);
      saveSnapshot(projects);
      setProjects(p => [data, ...p]);
      setShowWelcome(false);
      setWelcomeName('');
      toast.success(`Проект «${name}» создан`);
    } catch { toast.error('Ошибка создания проекта'); }
  }

  async function addProject() {
    try {
      const { data } = await projectsApi.create('');
      saveSnapshot(projects);
      setProjects(p => [data, ...p]);
      startRename('project', data.id, '');
    } catch { toast.error('Ошибка'); }
  }

  async function deleteProject(id: number) {
    if (!confirm('Вы уверены? Проект будет удалён.')) return;
    saveSnapshot(projects);
    setProjects(p => p.filter(x => x.id !== id));
    await projectsApi.remove(id);
    toast.success('Проект удалён');
    closeCtx();
  }

  async function duplicateProject(id: number) {
    const { data } = await projectsApi.duplicate(id);
    saveSnapshot(projects);
    setProjects(p => { const idx = p.findIndex(x => x.id === id); const next = [...p]; next.splice(idx + 1, 0, data); return next; });
    toast.success('Проект дублирован');
    closeCtx();
  }

  async function addSheet(projId: number) {
    const { data } = await sheetsApi.create(projId);
    saveSnapshot(projects);
    setProjects(p => p.map(pr => pr.id === projId ? { ...pr, sheets: [...(pr.sheets || []), data] } : pr));
  }

  async function deleteSheet(projId: number, sheetId: number) {
    if (!confirm('Удалить лист?')) return;
    saveSnapshot(projects);
    setProjects(p => p.map(pr => pr.id === projId ? { ...pr, sheets: pr.sheets.filter((s: any) => s.id !== sheetId) } : pr));
    await sheetsApi.remove(sheetId);
    closeCtx();
  }

  async function duplicateSheet(projId: number, sheetId: number) {
    const { data } = await sheetsApi.duplicate(sheetId);
    saveSnapshot(projects);
    setProjects(p => p.map(pr => pr.id === projId ? { ...pr, sheets: [...(pr.sheets || []), data] } : pr));
    closeCtx();
  }

  function openSheet(projId: number, sheetId: number) {
    setActive(projId, sheetId);
    window.dispatchEvent(new Event('navigation:start'));
    router.push(`/spec/${sheetId}`);
  }

  function startRename(type: 'project' | 'sheet', id: number, current: string) {
    setRenamingId(id); setRenameType(type); setRenameValue(current); closeCtx();
  }

  async function commitRename() {
    const val = renameValue.trim();
    if (!val || !renamingId) { setRenamingId(null); return; }
    saveSnapshot(projects);
    if (renameType === 'project') {
      await projectsApi.update(renamingId, { name: val });
      setProjects(p => p.map(pr => pr.id === renamingId ? { ...pr, name: val } : pr));
    } else {
      await sheetsApi.update(renamingId, { name: val });
      setProjects(p => p.map(pr => ({ ...pr, sheets: pr.sheets?.map((s: any) => s.id === renamingId ? { ...s, name: val } : s) })));
    }
    setRenamingId(null);
  }

  function handleSearch(q: string) {
    setSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const lq = q.toLowerCase();
    const res: any[] = [];
    projects.forEach(p => {
      if (p.name.toLowerCase().includes(lq)) res.push({ label: 'Проект', name: p.name, projId: p.id, sheetId: null });
      p.sheets?.forEach((s: any) => { if (s.name.toLowerCase().includes(lq)) res.push({ label: 'Лист', name: s.name, projId: p.id, sheetId: s.id }); });
    });
    setSearchResults(res.slice(0, 8));
  }

  function closeCtx() { setCtxMenu(null); }

  function toggleCollapse(id: number) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function onDragStart(e: React.DragEvent, type: 'project' | 'sheet', id: number, projId?: number) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    setDragItem({ type, id, projId });
  }

  function onDragOver(e: React.DragEvent, type: 'project' | 'sheet', id: number, projId?: number) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const half = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
    setDropZone(prev => {
      if (prev?.id === id && prev?.half === half) return prev;
      return { type, id, projId, half };
    });
  }

  function onDragLeave(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropZone(null);
    }
  }

  function onDragEnd() {
    setDragItem(null);
    setDropZone(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragItem || !dropZone || dragItem.id === dropZone.id) { onDragEnd(); return; }

    saveSnapshot(projects);

    if (dragItem.type === 'project' && dropZone.type === 'project') {
      // Reorder projects
      setProjects(prev => {
        const next = [...prev];
        const fromIdx = next.findIndex(p => p.id === dragItem.id);
        const [item] = next.splice(fromIdx, 1);
        let toIdx = next.findIndex(p => p.id === dropZone.id);
        if (dropZone.half === 'bottom') toIdx++;
        next.splice(toIdx, 0, item);
        return next;
      });

    } else if (dragItem.type === 'sheet') {
      const srcProjId = dragItem.projId!;

      if (dropZone.type === 'sheet') {
        const dstProjId = dropZone.projId!;

        if (srcProjId === dstProjId) {
          // Reorder sheets within same project
          setProjects(prev => prev.map(p => {
            if (p.id !== srcProjId) return p;
            const sheets = [...(p.sheets || [])];
            const fromIdx = sheets.findIndex((s: any) => s.id === dragItem.id);
            const [item] = sheets.splice(fromIdx, 1);
            let toIdx = sheets.findIndex((s: any) => s.id === dropZone.id);
            if (dropZone.half === 'bottom') toIdx++;
            sheets.splice(toIdx, 0, item);
            return { ...p, sheets };
          }));
        } else {
          // Move sheet to different project
          let movedSheet: any = null;
          setProjects(prev => {
            const p1 = prev.map(p => {
              if (p.id !== srcProjId) return p;
              const sheets = (p.sheets || []).filter((s: any) => {
                if (s.id === dragItem.id) { movedSheet = s; return false; }
                return true;
              });
              return { ...p, sheets };
            });
            if (!movedSheet) return p1;
            return p1.map(p => {
              if (p.id !== dstProjId) return p;
              const sheets = [...(p.sheets || [])];
              let toIdx = sheets.findIndex((s: any) => s.id === dropZone.id);
              if (dropZone.half === 'bottom') toIdx++;
              sheets.splice(toIdx, 0, { ...movedSheet, projectId: dstProjId });
              return { ...p, sheets };
            });
          });
          sheetsApi.update(dragItem.id, { projectId: dstProjId }).catch(() => {});
        }

      } else if (dropZone.type === 'project' && dropZone.id !== srcProjId) {
        // Drop sheet onto project header → append to that project
        let movedSheet: any = null;
        setProjects(prev => {
          const p1 = prev.map(p => {
            if (p.id !== srcProjId) return p;
            const sheets = (p.sheets || []).filter((s: any) => {
              if (s.id === dragItem.id) { movedSheet = s; return false; }
              return true;
            });
            return { ...p, sheets };
          });
          if (!movedSheet) return p1;
          return p1.map(p => {
            if (p.id !== dropZone.id) return p;
            return { ...p, sheets: [...(p.sheets || []), { ...movedSheet, projectId: dropZone.id }] };
          });
        });
        sheetsApi.update(dragItem.id, { projectId: dropZone.id }).catch(() => {});
      }
    }

    onDragEnd();
  }

  const formatMoney = (n: number) => n ? n.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽' : '–';
  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('ru-RU') : '';

  const filteredProjects = search.length >= 2
    ? projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sheets?.some((s: any) => s.name.toLowerCase().includes(search.toLowerCase()))
      )
    : projects;

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const pagedProjects = filteredProjects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <div style={{ paddingTop: 100, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>;

  return (
    <>
      <Header
        breadcrumb="Проекты"
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        undoCount={undoStack.length}
      />

      <div className="projects-screen" onClick={closeCtx}>
        <div className="projects-content">

          {/* Welcome modal */}
          {showWelcome && (
            <div className="modal-overlay">
              <div className="welcome-modal">
                <h2>Добро пожаловать в INDEXALL</h2>
                <p>Создавайте проекты, собирайте спецификации, подбирайте оборудование из каталогов.</p>
                <label>Введите название проекта</label>
                <input value={welcomeName} onChange={e => setWelcomeName(e.target.value)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') && createProject()}
                  placeholder="Проект1" autoFocus />
                <button className="btn-primary" style={{ width: '100%', padding: 12, justifyContent: 'center', fontSize: 15 }} onClick={createProject}>
                  Создать проект
                </button>
              </div>
            </div>
          )}

          <div className="projects-title">Все проекты</div>

          {/* Toolbar */}
          <div className="projects-toolbar">
            <div className="search-box">
              <span className="search-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </span>
              <input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Название проекта содержит…" />
              {searchResults.length > 0 && (
                <div className="search-dropdown">
                  {searchResults.map((r, i) => (
                    <div key={i} className="search-item" onClick={() => {
                      setSearch(''); setSearchResults([]);
                      if (r.sheetId) openSheet(r.projId, r.sheetId);
                    }}>
                      <div className="search-item-label">{r.label}</div>
                      <div>{r.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-create" onClick={addProject}>+ Создать проект</button>
            <button className="btn-outline" onClick={async () => {
        setShowTrash(true);
        setTrashLoading(true);
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

            {filteredProjects.length === 0 && (
              <div className="empty-state">
                <h3>Нет проектов</h3>
                <p>Создайте первый проект, нажав «+ Создать проект»</p>
              </div>
            )}

            {pagedProjects.map(proj => {
              const isCollapsed = collapsed.has(proj.id);
              const sheets: any[] = proj.sheets || [];
              const isDraggingThisProj = dragItem?.type === 'project' && dragItem.id === proj.id;
              const projDropClass =
                dropZone?.type === 'project' && dropZone.id === proj.id
                  ? (dragItem?.type === 'sheet' ? ' drop-into' : dropZone.half === 'top' ? ' drop-before' : ' drop-after')
                  : '';
              return (
                <div key={proj.id}>
                  {/* Project row */}
                  <div
                    className={`project-row project-header${isDraggingThisProj ? ' is-dragging' : ''}${projDropClass}`}
                    draggable
                    onDragStart={e => onDragStart(e, 'project', proj.id)}
                    onDragOver={e => onDragOver(e, 'project', proj.id)}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onDragEnd={onDragEnd}
                    onDoubleClick={() => toggleCollapse(proj.id)}
                  >
                    <div className="project-name">
                      <span className="drag-handle" title="Переместить">⠿</span>
                      <button
                        className="collapse-btn"
                        onClick={e => { e.stopPropagation(); toggleCollapse(proj.id); }}
                        title={isCollapsed ? 'Раскрыть' : 'Свернуть'}
                      >
                        {isCollapsed ? '▼' : '▲'}
                      </button>
                      <span className="project-icon">📁</span>
                      {renamingId === proj.id && renameType === 'project'
                        ? <input className="inline-input" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                            onBlur={commitRename} onKeyDown={e => e.key === 'Enter' && commitRename()} autoFocus />
                        : <span onDoubleClick={e => { e.stopPropagation(); startRename('project', proj.id, proj.name); }}>{proj.name}</span>
                      }
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(proj.updated_at)}</div>
                    <div style={{ fontSize: 12 }}>{formatMoney(proj.total)}</div>
                    <div>
                      <button className="more-btn" onClick={e => { e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'project', id: proj.id }); }}>···</button>
                    </div>
                  </div>

                  {/* Sheet rows + add-sheet — hidden when collapsed */}
                  {!isCollapsed && (
                    <>
                      {sheets.map((sheet: any, si: number) => {
                        const isLast = si === sheets.length - 1;
                        const isDraggingThisSheet = dragItem?.type === 'sheet' && dragItem.id === sheet.id;
                        const sheetDropClass =
                          dropZone?.type === 'sheet' && dropZone.id === sheet.id
                            ? (dropZone.half === 'top' ? ' drop-before' : ' drop-after')
                            : '';
                        return (
                          <div
                            key={sheet.id}
                            className={`project-row sheet-row${isDraggingThisSheet ? ' is-dragging' : ''}${sheetDropClass}`}
                            draggable
                            onDragStart={e => onDragStart(e, 'sheet', sheet.id, proj.id)}
                            onDragOver={e => onDragOver(e, 'sheet', sheet.id, proj.id)}
                            onDragLeave={onDragLeave}
                            onDrop={onDrop}
                            onDragEnd={onDragEnd}
                            onDoubleClick={() => openSheet(proj.id, sheet.id)}
                            onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'sheet', id: sheet.id, projId: proj.id }); }}
                          >
                            <div className="project-name">
                              <span className="drag-handle" title="Переместить">⠿</span>
                              <span className="sheet-tree-line">{isLast ? '└' : '├'}</span>
                              <span className="sheet-icon">≡</span>
                              {renamingId === sheet.id && renameType === 'sheet'
                                ? <input className="inline-input" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                                    onBlur={commitRename} onKeyDown={e => e.key === 'Enter' && commitRename()} autoFocus />
                                : <span>{sheet.name}</span>
                              }
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(sheet.updated_at)}</div>
                            <div style={{ fontSize: 12 }}>{formatMoney(sheet.total)}</div>
                            <div></div>
                          </div>
                        );
                      })}
                      <div className="add-sheet-row" onClick={() => addSheet(proj.id)}>
                        <span className="sheet-tree-line" style={{ marginRight: 4 }}>└</span>
                        <span>+</span> добавить лист
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="projects-pagination">
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
          {ctxMenu.type === 'project' ? (
            <>
              <div className="context-item" onClick={() => startRename('project', ctxMenu.id, projects.find(p => p.id === ctxMenu.id)?.name || '')}>Переименовать</div>
              <div className="context-item" onClick={() => duplicateProject(ctxMenu.id)}>Дублировать</div>
              <div className="context-item danger" onClick={() => deleteProject(ctxMenu.id)}>Удалить</div>
            </>
          ) : (
            <>
              <div className="context-item" onClick={() => { toast('Лист добавлен в Мои шаблоны'); closeCtx(); }}>Добавить в шаблоны</div>
              <div className="context-item" onClick={() => startRename('sheet', ctxMenu.id, '')}>Переименовать</div>
              <div className="context-item" onClick={() => duplicateSheet(ctxMenu.projId!, ctxMenu.id)}>Дублировать</div>
              <div className="context-item danger" onClick={() => deleteSheet(ctxMenu.projId!, ctxMenu.id)}>Удалить</div>
            </>
          )}
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
                        loadProjects();
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
