'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { templatesApi, sheetsApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

const SHIELD_TYPES = ['ГРЩ', 'ВРУ', 'ВП', 'РП', 'ПЭСПЗ', 'ЩО', 'ЩС'];

export default function TemplatesPage() {
  const router = useRouter();
  const { activeSheetId, activeProjectId } = useAppStore();
  const [templates, setTemplates] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ group: string; tmpl: any } | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  useEffect(() => { loadTemplates(); }, []);

  const sel = selected?.tmpl || null;

  async function loadTemplates() {
    try {
      const { data } = await templatesApi.getAll({ search, ...filters });
      setTemplates(data);
      if (data.length > 0 && !selected) {
        const first = data[0];
        setSelected({ group: first.scope === 'common' ? 'common' : 'my', tmpl: first });
      }
    } finally { setLoading(false); }
  }

  async function applyTemplate(mode: 'new' | 'replace' | 'append') {
    if (!sel) { toast.error('Выберите шаблон'); return; }
    const rows = (sel.rows || []).map((r: any, i: number) => ({ ...r, row_number: i + 1 }));
    try {
      if (mode === 'new') {
        if (!activeProjectId) { toast.error('Сначала откройте проект'); return; }
        const { data: newSheet } = await sheetsApi.create(activeProjectId, sel.name);
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

  async function deleteTemplate() {
    if (!sel) return;
    if (sel.scope === 'common') { toast.error('Общие шаблоны нельзя удалить'); return; }
    if (!confirm(`Удалить шаблон «${sel.name}»?`)) return;
    try {
      await templatesApi.remove(sel.id);
      const next = templates.filter(t => t.id !== sel.id);
      setTemplates(next);
      setSelected(next.length > 0 ? { group: 'my', tmpl: next[0] } : null);
      toast.success('Шаблон удалён');
    } catch { toast.error('Ошибка удаления'); }
  }

  async function toggleFavorite(tmpl?: any) {
    const target = tmpl || sel;
    if (!target) return;
    try {
      await templatesApi.toggleFavorite(target.id);
      const updated = { ...target, is_favorite: !target.is_favorite };
      if (sel?.id === target.id) setSelected(prev => prev ? { ...prev, tmpl: updated } : null);
      setTemplates(prev => prev.map(t => t.id === target.id ? updated : t));
      toast.success(updated.is_favorite ? 'Добавлено в избранное' : 'Убрано из избранного');
    } catch { toast.error('Ошибка'); }
  }

  const groups = [
    { key: 'my',     label: 'Мои шаблоны',    filter: (t: any) => t.scope === 'my' },
    { key: 'fav',    label: 'Избранное',       filter: (t: any) => !!t.is_favorite },
    { key: 'common', label: 'Общие шаблоны',   filter: (t: any) => t.scope === 'common' },
  ];

  const filtered = templates
    .filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Header breadcrumb="Шаблоны" />
      <div className="templates-screen">
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
          <button className="btn-back" onClick={() => router.back()}>← Вернуться на лист</button>
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
            {groups.map(g => {
              const items = filtered.filter(g.filter);
              const isGroupCollapsed = collapsedGroups.has(g.key);
              return (
                <div key={g.key} className="template-group">
                  <div
                    className="template-group-title"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => toggleGroup(g.key)}
                    title={isGroupCollapsed ? 'Раскрыть' : 'Свернуть'}
                  >
                    <span>{isGroupCollapsed ? '▶' : '▼'} 📁</span>
                    <span>{g.label} <span className="template-group-count">({items.length})</span></span>
                  </div>
                  {!isGroupCollapsed && items.map(t => (
                    <div
                      key={`${g.key}-${t.id}`}
                      className={`template-item${selected?.group === g.key && selected?.tmpl?.id === t.id ? ' active' : ''}`}
                      onClick={() => setSelected({ group: g.key, tmpl: t })}
                    >
                      <button
                        className={`tmpl-star-btn${t.is_favorite ? ' is-fav' : ''}`}
                        onClick={e => { e.stopPropagation(); toggleFavorite(t); }}
                        title={t.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                      >
                        {t.is_favorite ? '★' : '☆'}
                      </button>
                      <span className="tmpl-item-name">{t.name}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Right — preview */}
          <div className="templates-right">
            {sel ? (
              <>
                <div className="template-preview-name">{sel.name}</div>
                <div className="template-preview-meta">
                  {sel.scope === 'common' ? 'Общий шаблон' : 'Мой шаблон'}
                  {sel.is_favorite ? ' · ★ Избранное' : ''}
                </div>
                <div className="template-actions">
                  <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setApplyModalOpen(true)}>
                    + Добавить в лист
                  </button>
                  <button className="btn-outline" style={{ fontSize: 12 }} onClick={() => toggleFavorite()}>
                    {sel.is_favorite ? '★' : '☆'} В избранное
                  </button>
                  {sel.scope !== 'common' && (
                    <button className="btn-danger" style={{ fontSize: 12 }} onClick={deleteTemplate}>
                      🗑 Удалить
                    </button>
                  )}
                </div>
                <table className="template-table">
                  <thead>
                    <tr>{['№', 'Название', 'Бренд', 'Артикул', 'Кол-во'].map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(sel.rows || []).map((r: any, i: number) => (
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
