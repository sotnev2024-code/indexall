'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { catalogApi, adminApi, templatesApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

type Tab = 'pricelists' | 'base' | 'templates' | 'users' | 'conversions' | 'tariffs' | 'stats' | 'tiles';

function getBackendOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').origin;
  } catch {
    return 'http://localhost:4000';
  }
}

interface PreviewData {
  headers: string[];
  rows: string[][];
}

function fmtId(id: number) {
  return 'AA' + String(id).padStart(3, '0');
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function planLabel(plan: string) {
  if (plan === 'admin') return 'Base';
  if (plan === 'base') return 'Base';
  if (plan === 'pro') return 'Base';
  if (plan === 'trial') return 'Trial';
  return 'Free';
}

function extractActuality(fileName: string): string {
  const m = fileName.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return '—';
  const [, d, mo, y] = m;
  return `${mo}.${y.length === 2 ? '20' + y : y}`;
}

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAppStore();
  const [tab, setTab] = useState<Tab>('users');
  const [mounted, setMounted] = useState(false);

  // Pricelists (Каталог: Прайс-листы)
  const [pricelists, setPricelists] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mapping, setMapping] = useState({ firstRow: '2', g1: '', g2: '', g3: '', g4: '', g5: '', g6: '', nameCol: '', artCol: '' });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<number | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);

  // Users
  const [users, setUsers] = useState<any[]>([]);
  const [editSubExp, setEditSubExp] = useState<{ id: number; val: string } | null>(null);

  // Conversions
  const [conversions, setConversions] = useState<any[]>([]);

  // Tariff operations
  const [tariffOps, setTariffOps] = useState<any[]>([]);
  const [newTariff, setNewTariff] = useState({
    userId: '', operator: 'Admin', plan: 'Base', amount: '0', status: 'none-active', expiresAt: '', comment: '',
  });

  // Tariff configs (plan editor)
  const [tariffConfigs, setTariffConfigs] = useState<any[]>([]);
  const [editingConfig, setEditingConfig] = useState<Record<number, any>>({});

  // Stats
  const [stats, setStats] = useState<any>(null);

  // Templates
  const [adminTemplates, setAdminTemplates] = useState<any[]>([]);

  // Tiles (Каталог: База)
  const [tiles, setTiles] = useState<any[]>([]);
  const [editTile, setEditTile] = useState<any | null>(null);
  const [newTile, setNewTile] = useState({ slug: '', name: '', icon: '⚡', is_large: false, sort_order: 0 });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    const token = localStorage.getItem('token');
    if (!token) { router.replace('/auth/login'); return; }
    if (user === null) return;
    if (user.plan !== 'admin') {
      toast.error('Доступ запрещён');
      router.replace('/projects');
    }
  }, [mounted, user, router]);

  useEffect(() => {
    if (tab === 'pricelists') loadPricelists();
    else if (tab === 'users') loadUsers();
    else if (tab === 'conversions') loadConversions();
    else if (tab === 'tariffs') loadTariffOps();
    else if (tab === 'stats') loadStats();
    else if (tab === 'templates') loadAdminTemplates();
    else if (tab === 'base') loadTiles();
    else if (tab === 'tiles') loadTiles();
  }, [tab]);

  async function loadPricelists() {
    try { const { data } = await adminApi.getPricelists(); setPricelists(data); }
    catch { toast.error('Ошибка загрузки прайс-листов'); }
  }
  async function loadUsers() {
    try { const { data } = await adminApi.getUsers(); setUsers(data); }
    catch { toast.error('Ошибка загрузки пользователей'); }
  }
  async function loadConversions() {
    try { const { data } = await adminApi.getConversions(); setConversions(data); }
    catch { toast.error('Ошибка загрузки конверсий'); }
  }
  async function loadTariffOps() {
    try {
      const [{ data: ops }, { data: us }, { data: cfgs }] = await Promise.all([
        adminApi.getTariffOperations(),
        users.length === 0 ? adminApi.getUsers() : Promise.resolve({ data: users }),
        adminApi.getTariffConfigs(),
      ]);
      setTariffOps(ops);
      if (users.length === 0) setUsers(us);
      setTariffConfigs(cfgs);
      const initial: Record<number, any> = {};
      cfgs.forEach((c: any) => {
        initial[c.id] = {
          name: c.name,
          price: String(c.price),
          price_annual: c.price_annual != null ? String(c.price_annual) : '',
          description: c.description || '',
        };
      });
      setEditingConfig(initial);
    } catch { toast.error('Ошибка загрузки тарифных операций'); }
  }

  async function saveTariffConfig(id: number) {
    const data = editingConfig[id];
    if (!data) return;
    try {
      const { data: updated } = await adminApi.updateTariffConfig(id, {
        name: data.name,
        price: Number(data.price),
        price_annual: data.price_annual !== '' ? Number(data.price_annual) : null,
        description: data.description,
      });
      setTariffConfigs(prev => prev.map(c => c.id === id ? updated : c));
      toast.success('Тариф обновлён');
    } catch { toast.error('Ошибка сохранения тарифа'); }
  }
  async function loadStats() {
    try { const { data } = await adminApi.getStats(); setStats(data); }
    catch { toast.error('Ошибка загрузки статистики'); }
  }
  async function loadAdminTemplates() {
    try { const { data } = await adminApi.getAdminTemplates(); setAdminTemplates(data); }
    catch { toast.error('Ошибка загрузки шаблонов'); }
  }
  async function loadTiles() {
    try { const { data } = await catalogApi.getTilesAll(); setTiles(data); }
    catch { toast.error('Ошибка загрузки категорий'); }
  }

  // ── User actions ─────────────────────────────────────────────
  async function handlePlanChange(userId: number, plan: string) {
    try {
      await adminApi.updateUserPlan(userId, plan);
      setUsers(us => us.map(u => u.id === userId ? { ...u, plan } : u));
      toast.success('Тариф обновлён');
    } catch { toast.error('Ошибка обновления тарифа'); }
  }

  async function handleStatusChange(userId: number, status: string) {
    try {
      await adminApi.updateUserStatus(userId, status);
      setUsers(us => us.map(u => u.id === userId ? { ...u, status } : u));
      toast.success('Статус обновлён');
    } catch { toast.error('Ошибка обновления статуса'); }
  }

  async function handleVerifiedToggle(userId: number, current: boolean) {
    try {
      await adminApi.updateUserVerified(userId, !current);
      setUsers(us => us.map(u => u.id === userId ? { ...u, emailVerified: !current } : u));
      toast.success('Email верификация обновлена');
    } catch { toast.error('Ошибка обновления'); }
  }

  async function handleSaveSubExp(userId: number, val: string) {
    try {
      await adminApi.updateUserSubscription(userId, val || null);
      setUsers(us => us.map(u => u.id === userId ? { ...u, subscriptionExpiresAt: val || null } : u));
      setEditSubExp(null);
      toast.success('Срок подписки обновлён');
    } catch { toast.error('Ошибка обновления срока'); }
  }

  // ── Tariff operations ────────────────────────────────────────
  async function handleCreateTariffOp() {
    if (!newTariff.userId) { toast.error('Выберите пользователя'); return; }
    try {
      await adminApi.createTariffOperation({
        userId: Number(newTariff.userId),
        operator: newTariff.operator,
        plan: newTariff.plan,
        amount: Number(newTariff.amount),
        status: newTariff.status,
        expiresAt: newTariff.expiresAt || undefined,
        comment: newTariff.comment || undefined,
      });
      toast.success('Операция добавлена');
      setNewTariff({ userId: '', operator: 'Admin', plan: 'Base', amount: '0', status: 'none-active', expiresAt: '', comment: '' });
      loadTariffOps();
    } catch { toast.error('Ошибка добавления операции'); }
  }

  async function handleDeleteTariffOp(id: number) {
    if (!confirm('Удалить операцию?')) return;
    try {
      await adminApi.deleteTariffOperation(id);
      toast.success('Удалено');
      loadTariffOps();
    } catch { toast.error('Ошибка удаления'); }
  }

  // ── Admin templates ──────────────────────────────────────────
  async function handleDeleteAdminTemplate(id: number) {
    if (!confirm('Удалить шаблон?')) return;
    try {
      await adminApi.deleteAdminTemplate(id);
      toast.success('Шаблон удалён');
      loadAdminTemplates();
    } catch { toast.error('Ошибка удаления шаблона'); }
  }

  // ── Tiles (Каталог: База) ────────────────────────────────────
  async function handleCreateTile() {
    if (!newTile.slug || !newTile.name) { toast.error('Заполните slug и название'); return; }
    try {
      await catalogApi.createTile({ ...newTile, filters: [] });
      toast.success('Категория создана');
      setNewTile({ slug: '', name: '', icon: '⚡', is_large: false, sort_order: 0 });
      loadTiles();
    } catch { toast.error('Ошибка создания'); }
  }

  async function handleDeleteTile(id: number) {
    if (!confirm('Удалить категорию?')) return;
    try { await catalogApi.deleteTile(id); toast.success('Удалено'); loadTiles(); }
    catch { toast.error('Ошибка удаления'); }
  }

  async function handleSaveTile() {
    if (!editTile) return;
    try {
      await catalogApi.updateTile(editTile.id, {
        slug: editTile.slug, name: editTile.name, icon: editTile.icon,
        is_large: editTile.is_large, sort_order: editTile.sort_order,
        is_active: editTile.is_active, filters: editTile.filters,
      });
      toast.success('Сохранено');
      setEditTile(null);
      loadTiles();
    } catch { toast.error('Ошибка сохранения'); }
  }

  async function handleUploadTileImage(id: number, f: File) {
    const fd = new FormData(); fd.append('file', f);
    try { await catalogApi.uploadTileImage(id, fd); toast.success('Обложка загружена'); loadTiles(); }
    catch { toast.error('Ошибка загрузки обложки'); }
  }

  // ── Filter group helpers ─────────────────────────────────────
  function addFilterGroup() {
    if (!editTile) return;
    setEditTile({ ...editTile, filters: [...(editTile.filters || []), { label: '', opts: [] }] });
  }
  function removeFilterGroup(gi: number) {
    if (!editTile) return;
    setEditTile({ ...editTile, filters: editTile.filters.filter((_: any, i: number) => i !== gi) });
  }
  function updateFilterGroupLabel(gi: number, label: string) {
    if (!editTile) return;
    const f = [...editTile.filters]; f[gi] = { ...f[gi], label };
    setEditTile({ ...editTile, filters: f });
  }
  function addFilterOption(gi: number) {
    if (!editTile) return;
    const f = [...editTile.filters];
    f[gi] = { ...f[gi], opts: [...(f[gi].opts || []), ''] };
    setEditTile({ ...editTile, filters: f });
  }
  function updateFilterOption(gi: number, oi: number, val: string) {
    if (!editTile) return;
    const f = [...editTile.filters]; const opts = [...f[gi].opts]; opts[oi] = val;
    f[gi] = { ...f[gi], opts }; setEditTile({ ...editTile, filters: f });
  }
  function removeFilterOption(gi: number, oi: number) {
    if (!editTile) return;
    const f = [...editTile.filters];
    f[gi] = { ...f[gi], opts: f[gi].opts.filter((_: any, i: number) => i !== oi) };
    setEditTile({ ...editTile, filters: f });
  }

  // ── Pricelist upload / replace ───────────────────────────────
  function handleFileChange(f: File | null) {
    setFile(f); setPreview(null);
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const ref = ws['!ref'];
        const range = ref ? XLSX.utils.decode_range(ref) : null;
        const maxCol = range ? range.e.c : 30;
        const headers = Array.from({ length: maxCol + 1 }, (_, i) => XLSX.utils.encode_col(i));
        const rows = raw.slice(0, 7).map(r => headers.map((_, ci) => String(r[ci] ?? '')));
        setPreview({ headers, rows });
      } catch { toast.error('Не удалось прочитать файл'); }
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleUpload() {
    if (!file || !mapping.g1 || !mapping.nameCol || !mapping.artCol) { toast.error('Заполните обязательные поля'); return; }
    const fd = new FormData(); fd.append('file', file);
    Object.entries(mapping).forEach(([k, v]) => v && fd.append(k, v));
    setUploading(true);
    try {
      await catalogApi.uploadPriceList(fd);
      toast.success('Загружено, обрабатывается…');
      setFile(null); setPreview(null);
      setMapping({ firstRow: '2', g1: '', g2: '', g3: '', g4: '', g5: '', g6: '', nameCol: '', artCol: '' });
      loadPricelists();
    } catch { toast.error('Ошибка загрузки'); }
    finally { setUploading(false); }
  }

  async function handleReplace(id: number) {
    if (!replaceFile) { toast.error('Выберите файл для замены'); return; }
    const fd = new FormData(); fd.append('file', replaceFile);
    Object.entries(mapping).forEach(([k, v]) => v && fd.append(k, v));
    setUploading(true);
    try {
      await catalogApi.replacePriceList(id, fd);
      toast.success('Прайс заменён, обрабатывается…');
      setReplaceTarget(null); setReplaceFile(null);
      setMapping({ firstRow: '2', g1: '', g2: '', g3: '', g4: '', g5: '', g6: '', nameCol: '', artCol: '' });
      loadPricelists();
    } catch { toast.error('Ошибка замены'); }
    finally { setUploading(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm('Удалить прайс-лист? Все категории и товары будут удалены.')) return;
    try {
      await catalogApi.deletePriceList(id);
      toast.success('Прайс-лист удалён');
      setPricelists(ps => ps.filter(p => p.id !== id));
    } catch { toast.error('Ошибка удаления'); }
  }

  async function handleToggleStatus(pl: any) {
    const activate = pl.status !== 'active';
    try {
      const { data } = await catalogApi.setPriceListStatus(pl.id, activate);
      setPricelists(ps => ps.map(p => p.id === pl.id ? data : p));
      toast.success(activate ? 'Прайс активирован' : 'Прайс отключён');
    } catch { toast.error('Ошибка изменения статуса'); }
  }

  async function handleDownload(pl: any) {
    try {
      const { data } = await catalogApi.downloadPriceList(pl.id);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a'); a.href = url; a.download = pl.file_name; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Файл не найден'); }
  }

  const navItems: { key: Tab; label: string }[] = [
    { key: 'users',     label: 'Пользователи' },
    { key: 'conversions', label: 'Конверсии' },
    { key: 'tariffs',   label: 'Тарифы и их операции' },
    { key: 'templates', label: 'Шаблоны' },
    { key: 'pricelists', label: 'Каталог: Прайс-листы' },
    { key: 'base',      label: 'Каталог: База' },
    { key: 'stats',     label: 'Статистика' },
  ];

  if (!mounted) return <div style={{ paddingTop: 120, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>;
  if (!localStorage.getItem('token')) return null;
  if (!user) return <div style={{ paddingTop: 120, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div>;
  if (user.plan !== 'admin') return <div style={{ paddingTop: 120, textAlign: 'center', color: 'var(--muted)' }}>Нет доступа. Перенаправление…</div>;

  return (
    <>
      <header className="admin-header">
        <div className="logo-icon" style={{ cursor: 'pointer' }} onClick={() => router.push('/projects')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2.5" width="18" height="18">
            <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
          </svg>
        </div>
        <span className="admin-header-title">INDEXALL — Администратор</span>
      </header>

      <div className="admin-layout">
        <div className="admin-sidebar">
          <div className="admin-sidebar-title">Администратор</div>
          <nav className="admin-nav">
            {navItems.map(n => (
              <div key={n.key} className={`admin-nav-item${tab === n.key ? ' active' : ''}`} onClick={() => setTab(n.key)}>
                {n.label}
              </div>
            ))}
          </nav>
          <div className="admin-sidebar-footer">
            <button className="admin-back-btn" onClick={() => router.push('/projects')}>← К проектам</button>
          </div>
        </div>

        <div className="admin-content">

          {/* ── Пользователи ── */}
          {tab === 'users' && (
            <>
              <div className="admin-section-title">Пользователи</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Никнейм</th>
                      <th>Email</th>
                      <th>Роль</th>
                      <th>Check email</th>
                      <th>Тариф</th>
                      <th>Срок до</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtId(u.id)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{u.name || '—'}</td>
                        <td style={{ fontSize: 12 }}>{u.email}</td>
                        <td>
                          <select
                            value={u.plan === 'admin' ? 'admin' : 'user'}
                            onChange={e => handlePlanChange(u.id, e.target.value === 'admin' ? 'admin' : (u.plan === 'admin' ? 'free' : u.plan))}
                            style={{ padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                          >
                            <option value="admin">Admin</option>
                            <option value="user">User</option>
                          </select>
                        </td>
                        <td>
                          <button
                            onClick={() => handleVerifiedToggle(u.id, !!u.emailVerified)}
                            style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 11, border: 'none', cursor: 'pointer',
                              background: u.emailVerified ? '#d1fae5' : u.email ? '#fef9c3' : '#f3f4f6',
                              color: u.emailVerified ? '#065f46' : '#78350f',
                            }}
                          >
                            {u.emailVerified ? 'done' : 'in process'}
                          </button>
                        </td>
                        <td>
                          <select
                            value={u.plan}
                            onChange={e => handlePlanChange(u.id, e.target.value)}
                            style={{ padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                          >
                            <option value="free">Free</option>
                            <option value="trial">Trial</option>
                            <option value="base">Base</option>
                            <option value="pro">Pro</option>
                            <option value="admin">Base (Admin)</option>
                          </select>
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {editSubExp?.id === u.id && editSubExp ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input
                                type="datetime-local"
                                value={editSubExp.val}
                                onChange={e => setEditSubExp({ id: u.id, val: e.target.value })}
                                style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3 }}
                              />
                              <button className="btn-primary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => handleSaveSubExp(u.id, editSubExp.val)}>✓</button>
                              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }} onClick={() => setEditSubExp(null)}>✕</button>
                            </div>
                          ) : (
                            <span
                              style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                              title="Нажмите для редактирования"
                              onClick={() => setEditSubExp({ id: u.id, val: u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toISOString().slice(0, 16) : '' })}
                            >
                              {u.subscriptionExpiresAt ? fmtDate(u.subscriptionExpiresAt) : 'дд.мм.гггг ——'}
                            </span>
                          )}
                        </td>
                        <td>
                          <select
                            value={u.status || 'active'}
                            onChange={e => handleStatusChange(u.id, e.target.value)}
                            style={{ padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                            <option value="sleep">sleep</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет пользователей</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Конверсии ── */}
          {tab === 'conversions' && (
            <>
              <div className="admin-section-title">Конверсии</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table" style={{ minWidth: 1000 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Никнейм</th>
                      <th>Шаг1</th>
                      <th>Шаг2</th>
                      <th>Шаг3</th>
                      <th>Trial</th>
                      <th>Шаблоны</th>
                      <th>Проекты</th>
                      <th>Спеки</th>
                      <th>ЭТМ</th>
                      <th>Рус.св.</th>
                      <th>Тарифы</th>
                      <th>Акция</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversions.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{fmtId(c.id)}</td>
                        <td>{c.name || '—'}</td>
                        <td style={{ textAlign: 'center', color: c.step1 ? '#059669' : '#dc2626' }}>{c.step1 ? 'Да' : 'Нет'}</td>
                        <td style={{ textAlign: 'center', color: c.step2 ? '#059669' : '#dc2626' }}>{c.step2 ? 'Да' : 'Нет'}</td>
                        <td style={{ textAlign: 'center', color: c.step3 ? '#059669' : '#dc2626' }}>{c.step3 ? 'Да' : 'Нет'}</td>
                        <td style={{ textAlign: 'center', color: c.trial ? '#059669' : '#dc2626' }}>{c.trial ? 'Да' : 'Нет'}</td>
                        <td style={{ textAlign: 'center' }}>{c.templates}</td>
                        <td style={{ textAlign: 'center' }}>{c.projects}</td>
                        <td style={{ textAlign: 'center' }}>{c.specs}</td>
                        <td style={{ textAlign: 'center', color: c.etm ? '#059669' : '#dc2626' }}>{c.etm ? 'Да' : 'Нет'}</td>
                        <td style={{ textAlign: 'center', color: c.rusSv ? '#059669' : '#dc2626' }}>{c.rusSv ? 'Да' : 'Нет'}</td>
                        <td style={{ textAlign: 'center' }}>{c.tariffs}</td>
                        <td style={{ textAlign: 'center', color: c.promo ? '#059669' : '#dc2626' }}>{c.promo ? 'Да' : 'Нет'}</td>
                      </tr>
                    ))}
                    {conversions.length === 0 && (
                      <tr><td colSpan={13} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет данных</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Тарифы и их операции ── */}
          {tab === 'tariffs' && (
            <>
              <div className="admin-section-title">Тарифы и их операции</div>

              {/* ── Tariff plan editor ── */}
              <div className="admin-form" style={{ marginBottom: 32 }}>
                <div className="admin-form-title">Редактор тарифных планов</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="admin-table" style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th>Ключ</th>
                        <th>Название</th>
                        <th>Цена ₽/мес</th>
                        <th>Цена ₽/год</th>
                        <th>Описание</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tariffConfigs.map(cfg => {
                        const ed = editingConfig[cfg.id] || {
                          name: cfg.name,
                          price: String(cfg.price),
                          price_annual: cfg.price_annual != null ? String(cfg.price_annual) : '',
                          description: cfg.description || '',
                        };
                        return (
                          <tr key={cfg.id}>
                            <td><code style={{ fontSize: 12, background: 'var(--bg2)', padding: '2px 6px', borderRadius: 4 }}>{cfg.plan_key}</code></td>
                            <td>
                              <input
                                value={ed.name}
                                onChange={e => setEditingConfig(p => ({ ...p, [cfg.id]: { ...ed, name: e.target.value } }))}
                                style={{ width: '100%', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                value={ed.price}
                                onChange={e => setEditingConfig(p => ({ ...p, [cfg.id]: { ...ed, price: e.target.value } }))}
                                style={{ width: 90, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                value={ed.price_annual}
                                onChange={e => setEditingConfig(p => ({ ...p, [cfg.id]: { ...ed, price_annual: e.target.value } }))}
                                style={{ width: 90, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
                                placeholder="—"
                              />
                            </td>
                            <td>
                              <input
                                value={ed.description}
                                onChange={e => setEditingConfig(p => ({ ...p, [cfg.id]: { ...ed, description: e.target.value } }))}
                                style={{ width: '100%', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
                                placeholder="Описание тарифа"
                              />
                            </td>
                            <td>
                              <button className="btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => saveTariffConfig(cfg.id)}>
                                Сохранить
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {tariffConfigs.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Загрузка…</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add form */}
              <div className="admin-form" style={{ marginBottom: 24 }}>
                <div className="admin-form-title">Добавить операцию</div>
                <div className="form-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="form-col" style={{ minWidth: 120 }}>
                    <label>Пользователь (ID) *</label>
                    <select
                      value={newTariff.userId}
                      onChange={e => setNewTariff(p => ({ ...p, userId: e.target.value }))}
                      style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, width: '100%' }}
                    >
                      <option value="">— выбрать —</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{fmtId(u.id)} {u.name || u.email}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-col">
                    <label>Оператор</label>
                    <input value={newTariff.operator} onChange={e => setNewTariff(p => ({ ...p, operator: e.target.value }))} placeholder="Admin / Юкасса" />
                  </div>
                  <div className="form-col">
                    <label>План</label>
                    <select value={newTariff.plan} onChange={e => setNewTariff(p => ({ ...p, plan: e.target.value }))}
                      style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, width: '100%' }}>
                      <option>Base</option><option>Trial</option><option>Free</option>
                    </select>
                  </div>
                  <div className="form-col">
                    <label>Сумма (RUB)</label>
                    <input type="number" value={newTariff.amount} onChange={e => setNewTariff(p => ({ ...p, amount: e.target.value }))} />
                  </div>
                  <div className="form-col">
                    <label>Статус</label>
                    <input value={newTariff.status} onChange={e => setNewTariff(p => ({ ...p, status: e.target.value }))} placeholder="none-active / active" />
                  </div>
                  <div className="form-col">
                    <label>Срок до</label>
                    <input type="datetime-local" value={newTariff.expiresAt} onChange={e => setNewTariff(p => ({ ...p, expiresAt: e.target.value }))} />
                  </div>
                  <div className="form-col" style={{ flex: 2 }}>
                    <label>Комментарий</label>
                    <input value={newTariff.comment} onChange={e => setNewTariff(p => ({ ...p, comment: e.target.value }))} placeholder="Опционально" />
                  </div>
                </div>
                <div className="form-align-right" style={{ marginTop: 8 }}>
                  <button className="btn-primary" onClick={handleCreateTariffOp}>+ Добавить операцию</button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Никнейм</th>
                      <th>Дата</th>
                      <th>Оператор</th>
                      <th>План</th>
                      <th>Сумма</th>
                      <th>Статус</th>
                      <th>Срок</th>
                      <th>Коммент</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tariffOps.map(op => (
                      <tr key={op.id}>
                        <td style={{ fontWeight: 600 }}>{fmtId(op.userId)}</td>
                        <td>{op.userName}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(op.date)}</td>
                        <td style={{ fontSize: 12 }}>{op.operator}</td>
                        <td>{op.plan}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{Number(op.amount).toLocaleString('ru-RU')} RUB</td>
                        <td><span className={op.status === 'active' ? 'badge badge-green' : 'badge badge-gray'}>{op.status}</span></td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(op.expiresAt)}</td>
                        <td style={{ fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.comment || '—'}</td>
                        <td>
                          <button className="btn-danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleDeleteTariffOp(op.id)}>Удалить</button>
                        </td>
                      </tr>
                    ))}
                    {tariffOps.length === 0 && (
                      <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет операций</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Шаблоны ── */}
          {tab === 'templates' && (
            <>
              <div className="admin-section-title">Шаблоны</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Никнейм</th>
                      <th>Дата созд.</th>
                      <th>Название</th>
                      <th>Просмотры</th>
                      <th>Использовано</th>
                      <th>Место</th>
                      <th>Статус</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminTemplates.map(t => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600 }}>{t.userId ? fmtId(t.userId) : '—'}</td>
                        <td>{t.userName || '—'}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(t.createdAt)}</td>
                        <td><strong>{t.name}</strong></td>
                        <td style={{ textAlign: 'center' }}>{t.views_count ?? 0}</td>
                        <td style={{ textAlign: 'center' }}>{t.used_count ?? t.files ?? 0}</td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {t.userId ? `/AA${String(t.userId).padStart(3, '0')}` : '/Общие'}
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11,
                            background: t.userId == null ? '#d1fae5' : '#fef9c3',
                            color: t.userId == null ? '#065f46' : '#78350f',
                          }}>
                            {t.userId == null ? 'Виден всем' : `доступен 1`}
                          </span>
                        </td>
                        <td>
                          <button className="btn-danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleDeleteAdminTemplate(t.id)}>Удалить</button>
                        </td>
                      </tr>
                    ))}
                    {adminTemplates.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет шаблонов</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Каталог: Прайс-листы ── */}
          {tab === 'pricelists' && (
            <>
              <div className="admin-section-title">Каталог: Прайс-листы</div>

              <div className="admin-form">
                <div className="admin-form-title">Загрузить новый прайс-лист</div>
                <label className="upload-zone" style={{ display: 'block', marginBottom: 12 }}>
                  <div className="upload-icon">📂</div>
                  <div className="upload-text"><strong>{file ? file.name : 'Выберите .xlsx файл'}</strong></div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Формат: Производитель-ДД.ММ.ГГ.xlsx</div>
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFileChange(e.target.files?.[0] || null)} />
                </label>

                {preview && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                      Предпросмотр (первые 7 строк):
                    </div>
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 11, whiteSpace: 'nowrap' }}>
                        <thead>
                          <tr style={{ background: '#1a1a1a', color: '#f5c800' }}>
                            <th style={{ padding: '4px 8px', border: '1px solid #333' }}>#</th>
                            {preview.headers.map(h => (
                              <th key={h} style={{ padding: '4px 8px', border: '1px solid #333', minWidth: 60 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ padding: '3px 8px', border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 600 }}>{ri + 1}</td>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{ padding: '3px 8px', border: '1px solid var(--border)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={cell}>
                                  {cell.length > 25 ? cell.slice(0, 25) + '…' : cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="form-row">
                  <div className="form-col">
                    <label>Первая строка данных *</label>
                    <input type="number" value={mapping.firstRow} onChange={e => setMapping(m => ({ ...m, firstRow: e.target.value }))} placeholder="Например: 11" />
                  </div>
                  <div className="form-col">
                    <label>Столбец названия *</label>
                    <input value={mapping.nameCol} onChange={e => setMapping(m => ({ ...m, nameCol: e.target.value.toUpperCase() }))} placeholder="T" />
                  </div>
                  <div className="form-col">
                    <label>Столбец артикула *</label>
                    <input value={mapping.artCol} onChange={e => setMapping(m => ({ ...m, artCol: e.target.value.toUpperCase() }))} placeholder="U" />
                  </div>
                </div>
                <div className="categories-bg">
                  <div className="categories-bg-title">Столбцы категорий (дерево)</div>
                  <div className="form-row-3">
                    {['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((k, i) => (
                      <div key={k} className="form-col">
                        <label>{i === 0 ? 'Столбец 1 группы *' : `Столбец ${i + 1} группы`}</label>
                        <input value={(mapping as any)[k]} onChange={e => setMapping(m => ({ ...m, [k]: e.target.value.toUpperCase() }))} placeholder={i === 0 ? 'Q' : 'Необяз.'} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="form-align-right">
                  <button className="btn-primary" onClick={handleUpload} disabled={uploading}>
                    {uploading ? 'Загружается…' : 'Загрузить'}
                  </button>
                </div>
              </div>

              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Дата загрузки</th>
                    <th>Актуальность</th>
                    <th>Статус</th>
                    <th>Посещения</th>
                    <th>Вставлено</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {pricelists.map(pl => (
                    <tr key={pl.id}>
                      <td><strong>{pl.manufacturer?.name || '—'}</strong></td>
                      <td style={{ fontSize: 12 }}>{fmtDate(pl.uploaded_at)}</td>
                      <td style={{ fontSize: 12 }}>{extractActuality(pl.file_name)}</td>
                      <td>
                        {pl.status === 'processing' ? (
                          <span className="badge badge-yellow">Обработка…</span>
                        ) : (pl.status === 'active' || pl.status === 'inactive') ? (
                          <button
                            onClick={() => handleToggleStatus(pl)}
                            className={pl.status === 'active' ? 'badge badge-green' : 'badge badge-gray'}
                            style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit', fontSize: 12 }}
                          >
                            {pl.status === 'active' ? 'виден' : 'скрыт'}
                          </button>
                        ) : (
                          <span className="badge badge-gray">{pl.status}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>{pl.visit_count ?? 0}</td>
                      <td style={{ textAlign: 'center' }}>{pl.products_count ?? 0}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn-outline"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => { setReplaceTarget(pl.id); setReplaceFile(null); }}
                          >
                            заменить
                          </button>
                          <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleDownload(pl)}>↓ Скачать</button>
                          <button className="btn-danger" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleDelete(pl.id)}>Удалить</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pricelists.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет загруженных прайс-листов</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {/* ── Каталог: База (tiles) ── */}
          {tab === 'base' && (
            <>
              <div className="admin-section-title">Каталог: База</div>

              <div className="admin-form-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                <input className="admin-input" placeholder="slug (auto, mold…)" value={newTile.slug}
                  onChange={e => setNewTile(p => ({ ...p, slug: e.target.value }))} style={{ width: 130 }} />
                <input className="admin-input" placeholder="Название категории" value={newTile.name}
                  onChange={e => setNewTile(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 200 }} />
                <input className="admin-input" placeholder="Иконка" value={newTile.icon}
                  onChange={e => setNewTile(p => ({ ...p, icon: e.target.value }))} style={{ width: 70 }} />
                <input className="admin-input" type="number" placeholder="Порядок" value={newTile.sort_order}
                  onChange={e => setNewTile(p => ({ ...p, sort_order: Number(e.target.value) }))} style={{ width: 80 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input type="checkbox" checked={newTile.is_large} onChange={e => setNewTile(p => ({ ...p, is_large: e.target.checked }))} />
                  Большая
                </label>
                <button className="btn-primary" onClick={handleCreateTile}>+ Добавить</button>
              </div>

              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Дата загрузки</th>
                    <th>Статус</th>
                    <th>Посещения</th>
                    <th>Вставлено</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {tiles.map(tile => (
                    <tr key={tile.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {tile.image_path
                            ? <img src={`${getBackendOrigin()}/uploads/${tile.image_path.split(/[\\/]/).pop()}`} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} />
                            : <span style={{ fontSize: 20 }}>{tile.icon}</span>
                          }
                          <strong>{tile.name}</strong>
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDate(tile.created_at)}</td>
                      <td>
                        <span className={tile.is_active ? 'badge badge-green' : 'badge badge-gray'}>
                          {tile.is_active ? 'виден' : 'скрыт'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>{tile.visit_count ?? 0}</td>
                      <td style={{ textAlign: 'center' }}>—</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <label className="btn-outline" style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
                            заменить
                            <input type="file" accept="image/*" style={{ display: 'none' }}
                              onChange={e => e.target.files?.[0] && handleUploadTileImage(tile.id, e.target.files[0])} />
                          </label>
                          <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => setEditTile({ ...tile, filters: tile.filters || [] })}>
                            Редактировать
                          </button>
                          <button className="btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => handleDeleteTile(tile.id)}>
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tiles.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет категорий</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {/* ── Статистика ── */}
          {tab === 'stats' && (
            <>
              <div className="admin-section-title">Статистика</div>
              {stats ? (
                <>
                  <div className="stats-grid">
                    {[
                      { v: stats.users, l: 'Пользователей' },
                      { v: stats.projects, l: 'Проектов' },
                      { v: stats.sheets, l: 'Листов' },
                      { v: stats.templates, l: 'Шаблонов' },
                      { v: stats.manufacturers, l: 'Производителей' },
                      { v: stats.catalogProducts?.toLocaleString('ru-RU'), l: 'Товаров в каталоге' },
                      { v: stats.priceListsActive, l: 'Активных прайсов' },
                    ].map(({ v, l }) => (
                      <div key={l} className="stat-card">
                        <div className="stat-card-value">{v}</div>
                        <div className="stat-card-label">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="admin-section-title" style={{ marginTop: 24 }}>Активность</div>
                  <div className="stats-grid">
                    {[
                      { v: stats.newUsersToday, l: 'Новых пользователей сегодня' },
                      { v: stats.newUsersMonth, l: 'Новых пользователей за месяц' },
                      { v: stats.newProjectsToday, l: 'Проектов создано сегодня' },
                      { v: stats.newProjectsMonth, l: 'Проектов создано за месяц' },
                    ].map(({ v, l }) => (
                      <div key={l} className="stat-card">
                        <div className="stat-card-value">{v}</div>
                        <div className="stat-card-label">{l}</div>
                      </div>
                    ))}
                  </div>
                  {stats.topUsers?.length > 0 && (
                    <>
                      <div className="admin-section-title" style={{ marginTop: 24 }}>Топ пользователей</div>
                      <table className="admin-table">
                        <thead><tr><th>Email</th><th>Проектов</th></tr></thead>
                        <tbody>
                          {stats.topUsers.map((u: any, i: number) => (
                            <tr key={i}><td>{u.email}</td><td style={{ textAlign: 'center', fontWeight: 600 }}>{Number(u.count) || 0}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              ) : (
                <p style={{ color: 'var(--muted)' }}>Загрузка…</p>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── Modal: Replace pricelist ── */}
      {replaceTarget !== null && (
        <div className="modal-overlay" onClick={() => setReplaceTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 520, width: '90vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Заменить прайс-лист</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Загрузите новый .xlsx файл. Структура должна совпадать с предыдущим.
            </p>
            <label className="upload-zone" style={{ display: 'block', marginBottom: 12 }}>
              <div className="upload-icon">📂</div>
              <div className="upload-text"><strong>{replaceFile ? replaceFile.name : 'Выберите .xlsx файл'}</strong></div>
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => setReplaceFile(e.target.files?.[0] || null)} />
            </label>
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-col">
                <label>Первая строка данных *</label>
                <input type="number" value={mapping.firstRow} onChange={e => setMapping(m => ({ ...m, firstRow: e.target.value }))} />
              </div>
              <div className="form-col">
                <label>Столбец названия *</label>
                <input value={mapping.nameCol} onChange={e => setMapping(m => ({ ...m, nameCol: e.target.value.toUpperCase() }))} />
              </div>
              <div className="form-col">
                <label>Столбец артикула *</label>
                <input value={mapping.artCol} onChange={e => setMapping(m => ({ ...m, artCol: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setReplaceTarget(null)}>Отмена</button>
              <button className="btn-primary" onClick={() => handleReplace(replaceTarget!)} disabled={!replaceFile || uploading}>
                {uploading ? 'Загружается…' : 'Заменить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Edit tile ── */}
      {editTile && (
        <div className="modal-overlay" onClick={() => setEditTile(null)}>
          <div className="modal-box" style={{ maxWidth: 640, width: '90vw', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-title">Редактировать категорию</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Slug</div>
                <input className="admin-input" value={editTile.slug} onChange={e => setEditTile((p: any) => ({ ...p, slug: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Иконка (emoji)</div>
                <input className="admin-input" value={editTile.icon} onChange={e => setEditTile((p: any) => ({ ...p, icon: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Название</div>
                <input className="admin-input" style={{ width: '100%' }} value={editTile.name} onChange={e => setEditTile((p: any) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Порядок сортировки</div>
                <input className="admin-input" type="number" value={editTile.sort_order} onChange={e => setEditTile((p: any) => ({ ...p, sort_order: Number(e.target.value) }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={editTile.is_large} onChange={e => setEditTile((p: any) => ({ ...p, is_large: e.target.checked }))} />
                  Большая плитка
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={editTile.is_active} onChange={e => setEditTile((p: any) => ({ ...p, is_active: e.target.checked }))} />
                  Активна
                </label>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Группы фильтров</div>
                <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }} onClick={addFilterGroup}>+ Группу</button>
              </div>
              {(editTile.filters || []).map((fg: any, gi: number) => (
                <div key={gi} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input className="admin-input" style={{ flex: 1 }} placeholder="Название группы фильтра"
                      value={fg.label} onChange={e => updateFilterGroupLabel(gi, e.target.value)} />
                    <button style={{ fontSize: 11, color: 'var(--danger)', cursor: 'pointer', background: 'none', border: 'none' }}
                      onClick={() => removeFilterGroup(gi)}>✕ удалить</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(fg.opts || []).map((opt: string, oi: number) => (
                      <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
                        <input style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, width: 60 }}
                          value={opt} onChange={e => updateFilterOption(gi, oi, e.target.value)} />
                        <button style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer', background: 'none', border: 'none' }}
                          onClick={() => removeFilterOption(gi, oi)}>✕</button>
                      </div>
                    ))}
                    <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => addFilterOption(gi)}>+ значение</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setEditTile(null)}>Отмена</button>
              <button className="btn-primary" onClick={handleSaveTile}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
