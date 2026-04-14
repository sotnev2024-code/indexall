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
  if (plan === 'admin') return 'Admin';
  if (plan === 'base' || plan === 'pro') return 'Pro';
  if (plan === 'trial') return 'Trial';
  return 'Free';
}

function extractActuality(fileName: string): string {
  const m = fileName.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return '—';
  const [, d, mo, y] = m;
  return `${mo}.${y.length === 2 ? '20' + y : y}`;
}

/** Convert column input: accepts letter (A,B,C) or number (1,2,3) → always returns letter */
function normalizeCol(val: string): string {
  const trimmed = val.trim();
  if (!trimmed) return '';
  // If it's a pure number, convert to Excel column letter (1→A, 2→B, 26→Z, 27→AA)
  if (/^\d+$/.test(trimmed)) {
    let n = parseInt(trimmed, 10);
    if (n <= 0) return '';
    let result = '';
    while (n > 0) { n--; result = String.fromCharCode(65 + (n % 26)) + result; n = Math.floor(n / 26); }
    return result;
  }
  return trimmed.toUpperCase();
}

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAppStore();
  const [tab, setTab] = useState<Tab>('users');
  const [mounted, setMounted] = useState(false);

  // Pricelists (Каталог: Прайс-листы)
  const [pricelists, setPricelists] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mapping, setMapping] = useState({ firstRow: '2', g1: '', g2: '', g3: '', g4: '', g5: '', g6: '', nameCol: '', artCol: '', priceCol: '' });
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
  const [tmplTree, setTmplTree] = useState<{ users: any[]; common: any[] }>({ users: [], common: [] });
  const [tmplSearch, setTmplSearch] = useState('');
  const [tmplUserFilter, setTmplUserFilter] = useState('');
  const [tmplPreview, setTmplPreview] = useState<any | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());

  // Tiles (Каталог: База)
  const [tiles, setTiles] = useState<any[]>([]);
  const [editTile, setEditTile] = useState<any | null>(null);
  const [tilesManagerOpen, setTilesManagerOpen] = useState(false);
  const [managedTiles, setManagedTiles] = useState<any[]>([]);
  const [newTileName, setNewTileName] = useState('');

  // Tile data upload
  const [tileDataModal, setTileDataModal] = useState<any | null>(null); // tile being configured
  const [tileFile, setTileFile] = useState<File | null>(null);
  const [tilePreview, setTilePreview] = useState<{ headers: string[]; rows: any[][] } | null>(null);
  const [tileMapping, setTileMapping] = useState({ firstRow: '2', nameCol: '', articleCol: '', priceCol: '', unitCol: '', brandCol: '', accessoriesStartCol: '' });
  const [tileFilterCols, setTileFilterCols] = useState<{ col: string; label: string }[]>([]);
  const [tileUploading, setTileUploading] = useState(false);

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
    try {
      const [{ data: list }, { data: tree }] = await Promise.all([
        adminApi.getAdminTemplates(),
        adminApi.getAdminTemplatesTree(),
      ]);
      setAdminTemplates(list);
      setTmplTree(tree);
    } catch { toast.error('Ошибка загрузки шаблонов'); }
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

  async function handleChangePassword(userId: number, userEmail: string) {
    const newPassword = prompt(`Новый пароль для ${userEmail}:`);
    if (!newPassword) return;
    if (newPassword.length < 6) { toast.error('Пароль должен быть не короче 6 символов'); return; }
    try {
      await adminApi.updateUserPassword(userId, newPassword);
      toast.success('Пароль обновлён');
    } catch { toast.error('Ошибка обновления пароля'); }
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
      if (tmplPreview?.id === id) setTmplPreview(null);
      loadAdminTemplates();
    } catch { toast.error('Ошибка удаления шаблона'); }
  }

  async function handlePublishTemplate(t: any) {
    if (t.scope === 'common') { toast('Шаблон уже в общих'); return; }
    if (!confirm(`Добавить «${t.name}» в Общие шаблоны?\nСоздастся независимая копия — оригинал останется у пользователя.`)) return;
    try {
      await adminApi.publishTemplate(t.id);
      toast.success('Шаблон добавлен в Общие');
      loadAdminTemplates();
    } catch { toast.error('Ошибка публикации шаблона'); }
  }

  async function handlePublishFolder(folder: any) {
    if (!confirm(`Опубликовать папку «${folder.name}» со всем содержимым в Общие шаблоны?\nСоздастся независимая копия — оригинал останется у пользователя.`)) return;
    try {
      await adminApi.publishFolderAsCommon(folder.id);
      toast.success('Папка опубликована в Общие');
      loadAdminTemplates();
    } catch { toast.error('Ошибка публикации папки'); }
  }

  async function handleToggleTemplateActive(t: any) {
    try {
      const { data } = await adminApi.toggleTemplateActive(t.id);
      toast.success(data.is_active ? 'Шаблон показан' : 'Шаблон скрыт из общих');
      setAdminTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: data.is_active } : x));
      if (tmplPreview?.id === t.id) setTmplPreview((p: any) => ({ ...p, is_active: data.is_active }));
    } catch { toast.error('Ошибка'); }
  }

  function handleCopyTemplateRows(t: any) {
    const rows = (t.rows || []).filter((r: any) => r.name || r.article);
    if (rows.length === 0) { toast.error('Шаблон пустой'); return; }
    const header = ['Название', 'Бренд', 'Артикул', 'Кол-во', 'Ед.', 'Цена', 'Источник', 'Коэф.', 'Срок'];
    const lines = [header.join('\t')];
    rows.forEach((r: any) => {
      lines.push([r.name, r.brand, r.article, r.qty, r.unit, r.price, r.store, r.coef, r.deadline].map((v: any) => v ?? '').join('\t'));
    });
    const text = lines.join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast.success(`Скопировано ${rows.length} строк`),
        () => fallbackCopy(text, rows.length),
      );
    } else {
      fallbackCopy(text, rows.length);
    }
  }

  function fallbackCopy(text: string, rowCount: number) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast.success(`Скопировано ${rowCount} строк`);
    } catch {
      toast.error('Не удалось скопировать');
    }
    document.body.removeChild(ta);
  }

  // ── Tiles (Каталог: База) ────────────────────────────────────
  function slugify(name: string): string {
    const map: Record<string, string> = {
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
      'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
      'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y',
      'ь':'','э':'e','ю':'yu','я':'ya',
    };
    return name.toLowerCase().split('').map(c => map[c] ?? c).join('')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  }

  function openTilesManager() {
    setManagedTiles(tiles.map(t => ({ ...t })));
    setNewTileName('');
    setTilesManagerOpen(true);
  }

  function addManagedTile() {
    if (!newTileName.trim()) return;
    const name = newTileName.trim();
    const slug = slugify(name);
    setManagedTiles(prev => [...prev, {
      _isNew: true, _tempId: Date.now(),
      slug, name, icon: '', is_large: false, is_active: true,
      sort_order: prev.length, products_count: 0,
    }]);
    setNewTileName('');
  }

  function moveTile(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= managedTiles.length) return;
    const arr = [...managedTiles];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setManagedTiles(arr);
  }

  function removeManagedTile(idx: number) {
    setManagedTiles(prev => prev.filter((_, i) => i !== idx));
  }

  function toggleManagedSize(idx: number) {
    setManagedTiles(prev => prev.map((t, i) => i === idx ? { ...t, is_large: !t.is_large } : t));
  }

  function toggleManagedActive(idx: number) {
    setManagedTiles(prev => prev.map((t, i) => i === idx ? { ...t, is_active: !t.is_active } : t));
  }

  function updateManagedName(idx: number, name: string) {
    setManagedTiles(prev => prev.map((t, i) => i === idx ? { ...t, name } : t));
  }

  async function saveTilesManager() {
    try {
      // Create new tiles
      for (const t of managedTiles.filter(t => t._isNew)) {
        await catalogApi.createTile({
          slug: t.slug, name: t.name, icon: t.icon || '',
          is_large: t.is_large, is_active: t.is_active,
          sort_order: managedTiles.indexOf(t), filters: [],
        });
      }
      // Delete removed tiles
      const managedIds = new Set(managedTiles.filter(t => !t._isNew).map(t => t.id));
      for (const t of tiles) {
        if (!managedIds.has(t.id)) {
          await catalogApi.deleteTile(t.id);
        }
      }
      // Update existing tiles (order, size, active, name)
      for (let i = 0; i < managedTiles.length; i++) {
        const t = managedTiles[i];
        if (t._isNew) continue;
        const orig = tiles.find(o => o.id === t.id);
        if (!orig || orig.name !== t.name || orig.is_large !== t.is_large || orig.is_active !== t.is_active || orig.sort_order !== i) {
          await catalogApi.updateTile(t.id, {
            name: t.name, is_large: t.is_large, is_active: t.is_active, sort_order: i,
            slug: t.slug, icon: t.icon,
          });
        }
      }
      toast.success('Сохранено');
      setTilesManagerOpen(false);
      loadTiles();
    } catch { toast.error('Ошибка сохранения'); }
  }

  async function handleDeleteTile(id: number) {
    if (!confirm('Удалить категорию и все её товары?')) return;
    try { await catalogApi.deleteTile(id); toast.success('Удалено'); loadTiles(); }
    catch { toast.error('Ошибка удаления'); }
  }

  async function handleSaveTile() {
    if (!editTile) return;
    try {
      await catalogApi.updateTile(editTile.id, {
        slug: editTile.slug, name: editTile.name, icon: editTile.icon,
        is_large: editTile.is_large, sort_order: editTile.sort_order,
        is_active: editTile.is_active,
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

  // ── Tile data upload ────────────────────────────────────────
  function openTileDataModal(tile: any) {
    setTileDataModal(tile);
    setTileFile(null);
    setTilePreview(null);
    setTileFilterCols(tile.column_mapping?.filters || []);
    setTileMapping({
      firstRow: String(tile.column_mapping?.firstRow || 2),
      nameCol: tile.column_mapping?.nameCol || '',
      articleCol: tile.column_mapping?.articleCol || '',
      priceCol: tile.column_mapping?.priceCol || '',
      unitCol: tile.column_mapping?.unitCol || '',
      brandCol: tile.column_mapping?.brandCol || '',
      accessoriesStartCol: tile.column_mapping?.accessoriesStartCol || '',
    });
  }

  function handleTileFileChange(f: File | null) {
    setTileFile(f);
    setTilePreview(null);
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
        setTilePreview({ headers, rows });
      } catch { toast.error('Не удалось прочитать файл'); }
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleUploadTileData() {
    if (!tileDataModal || !tileFile) return;
    if (!tileMapping.nameCol) { toast.error('Укажите столбец названия'); return; }
    setTileUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', tileFile);
      fd.append('firstRow', tileMapping.firstRow);
      fd.append('nameCol', tileMapping.nameCol);
      fd.append('articleCol', tileMapping.articleCol);
      if (tileMapping.priceCol) fd.append('priceCol', tileMapping.priceCol);
      if (tileMapping.unitCol) fd.append('unitCol', tileMapping.unitCol);
      if (tileMapping.brandCol) fd.append('brandCol', tileMapping.brandCol);
      if (tileMapping.accessoriesStartCol) fd.append('accessoriesStartCol', tileMapping.accessoriesStartCol);
      fd.append('filters', JSON.stringify(tileFilterCols.filter(f => f.col && f.label)));
      const { data } = await catalogApi.uploadTileData(tileDataModal.id, fd);
      toast.success(`Загружено ${data.productsCount} товаров`);
      setTileDataModal(null);
      loadTiles();
    } catch { toast.error('Ошибка загрузки данных'); }
    finally { setTileUploading(false); }
  }

  async function handleDeleteTileData(id: number) {
    if (!confirm('Удалить все товары этой категории?')) return;
    try {
      await catalogApi.deleteTileData(id);
      toast.success('Данные удалены');
      loadTiles();
    } catch { toast.error('Ошибка удаления данных'); }
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
    if (!file || !mapping.nameCol || !mapping.artCol) { toast.error('Заполните столбец названия и артикула'); return; }
    const fd = new FormData(); fd.append('file', file);
    Object.entries(mapping).forEach(([k, v]) => v && fd.append(k, v));
    setUploading(true);
    try {
      await catalogApi.uploadPriceList(fd);
      toast.success('Загружено, обрабатывается…');
      setFile(null); setPreview(null);
      setMapping({ firstRow: '2', g1: '', g2: '', g3: '', g4: '', g5: '', g6: '', nameCol: '', artCol: '', priceCol: '' });
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
      setMapping({ firstRow: '2', g1: '', g2: '', g3: '', g4: '', g5: '', g6: '', nameCol: '', artCol: '', priceCol: '' });
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
                      <th>Действия</th>
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
                        <td>
                          <button className="btn-outline" style={{ padding: '3px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                            onClick={() => handleChangePassword(u.id, u.email)}
                            title="Сменить пароль пользователя">
                            Сменить пароль
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет пользователей</td></tr>
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
                      {tariffConfigs.filter((cfg: any) => cfg.is_active).map(cfg => {
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
          {tab === 'templates' && (() => {
            const COLS = ['name', 'brand', 'article', 'qty', 'unit', 'price', 'store', 'coef', 'total', 'deadline'];
            const COL_LABELS: Record<string, string> = { name: 'Название', brand: 'Бренд', article: 'Артикул', qty: 'Кол-во', unit: 'Ед.', price: 'Цена', store: 'Источник', coef: 'Коэф.', total: 'Итого', deadline: 'Срок' };

            const matchName = (name: string) => !tmplSearch || name.toLowerCase().includes(tmplSearch.toLowerCase());

            const toggleUser = (uid: number) => {
              setExpandedUsers(prev => {
                const next = new Set(prev);
                if (next.has(uid)) next.delete(uid); else next.add(uid);
                return next;
              });
            };
            const toggleFolder = (fid: number) => {
              setExpandedFolders(prev => {
                const next = new Set(prev);
                if (next.has(fid)) next.delete(fid); else next.add(fid);
                return next;
              });
            };

            const renderFolder = (folder: any, depth: number) => {
              const isOpen = expandedFolders.has(folder.id);
              const visibleItems = folder.items.filter((it: any) => matchName(it.name));
              const hasMatchingChildren = (f: any): boolean =>
                f.items.some((it: any) => matchName(it.name)) || f.children.some(hasMatchingChildren);
              if (tmplSearch && !hasMatchingChildren(folder)) return null;
              return (
                <div key={folder.id} style={{ marginLeft: depth * 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0, width: 16 }}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>📁 {folder.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>({visibleItems.length})</span>
                    <button
                      className="btn-primary"
                      style={{ fontSize: 10, padding: '2px 8px', marginLeft: 8 }}
                      onClick={() => handlePublishFolder(folder)}
                      title="Опубликовать всю папку в Общие шаблоны"
                    >
                      → В общие
                    </button>
                  </div>
                  {isOpen && (
                    <div style={{ marginLeft: 22 }}>
                      {folder.children.map((c: any) => renderFolder(c, depth + 1))}
                      {visibleItems.map((t: any) => renderTemplateItem(t))}
                    </div>
                  )}
                </div>
              );
            };

            const renderTemplateItem = (t: any) => (
              <div
                key={t.id}
                onClick={() => setTmplPreview(tmplPreview?.id === t.id ? null : t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px',
                  cursor: 'pointer', borderRadius: 4,
                  background: tmplPreview?.id === t.id ? 'var(--bg)' : 'transparent',
                  fontSize: 12,
                }}
              >
                <span>📄</span>
                <span style={{ flex: 1 }}><strong>{t.name}</strong></span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t.rowCount} стр.</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap',
                  background: t.scope === 'common' ? (t.is_active ? '#d1fae5' : '#fee2e2') : '#fef9c3',
                  color: t.scope === 'common' ? (t.is_active ? '#065f46' : '#991b1b') : '#78350f',
                }}>
                  {t.scope === 'common' ? (t.is_active ? 'Общий' : 'Скрыт') : 'Личный'}
                </span>
                <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                  {t.scope !== 'common' && (
                    <button className="btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => handlePublishTemplate(t)}>→ В общие</button>
                  )}
                  {t.scope === 'common' && (
                    <button className="btn-outline" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => handleToggleTemplateActive(t)}>
                      {t.is_active ? 'Скрыть' : 'Показать'}
                    </button>
                  )}
                </span>
              </div>
            );

            return (
              <>
                <div className="admin-section-title">Шаблоны пользователей</div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    value={tmplSearch}
                    onChange={e => setTmplSearch(e.target.value)}
                    placeholder="Поиск по названию…"
                    style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, width: 240 }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: tmplPreview ? '1fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

                  {/* Left: tree */}
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                    {/* Common templates section */}
                    {tmplTree.common.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#065f46' }}>🌐 Общие шаблоны</div>
                        {tmplTree.common.filter((t: any) => matchName(t.name)).map(renderTemplateItem)}
                      </div>
                    )}

                    {/* Per-user trees */}
                    {tmplTree.users.map(u => {
                      const isOpen = expandedUsers.has(u.userId);
                      const looseFiltered = u.looseTemplates.filter((t: any) => matchName(t.name));
                      const folderHasMatch = (f: any): boolean =>
                        f.items.some((it: any) => matchName(it.name)) || f.children.some(folderHasMatch);
                      const visibleFolders = tmplSearch ? u.folders.filter(folderHasMatch) : u.folders;
                      if (tmplSearch && visibleFolders.length === 0 && looseFiltered.length === 0) return null;
                      return (
                        <div key={u.userId} style={{ marginBottom: 6, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                          <div
                            onClick={() => toggleUser(u.userId)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 0' }}
                          >
                            <span style={{ fontSize: 14 }}>{isOpen ? '▾' : '▸'}</span>
                            <span style={{ fontSize: 14 }}>👤</span>
                            <strong style={{ fontSize: 13 }}>{u.userName || u.userEmail || `User ${u.userId}`}</strong>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {u.userEmail && u.userName ? u.userEmail : ''}
                            </span>
                          </div>
                          {isOpen && (
                            <div style={{ marginLeft: 22, marginTop: 4 }}>
                              {visibleFolders.map((f: any) => renderFolder(f, 0))}
                              {looseFiltered.map(renderTemplateItem)}
                              {visibleFolders.length === 0 && looseFiltered.length === 0 && (
                                <div style={{ fontSize: 12, color: 'var(--muted)', padding: 4 }}>Нет шаблонов</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {tmplTree.users.length === 0 && tmplTree.common.length === 0 && (
                      <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Нет шаблонов</div>
                    )}
                  </div>

                  {/* Right: preview panel */}
                  {tmplPreview && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: '#fff', padding: 16, minHeight: 200 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{tmplPreview.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {tmplPreview.userId ? `${fmtId(tmplPreview.userId)} ${tmplPreview.userName || ''}` : 'Общий шаблон'} · {fmtDate(tmplPreview.createdAt)}
                          </div>
                        </div>
                        <button onClick={() => setTmplPreview(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
                      </div>

                      {(tmplPreview.rows || []).filter((r: any) => r.name || r.article).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', fontSize: 13 }}>Шаблон пустой</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: 'var(--bg)' }}>
                                <th style={{ padding: '5px 8px', border: '1px solid var(--border)', textAlign: 'left', fontWeight: 600 }}>№</th>
                                {COLS.map(c => (
                                  <th key={c} style={{ padding: '5px 8px', border: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{COL_LABELS[c]}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(tmplPreview.rows || []).filter((r: any) => r.name || r.article).map((r: any, i: number) => (
                                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                                  <td style={{ padding: '4px 8px', border: '1px solid var(--border)', color: 'var(--muted)' }}>{i + 1}</td>
                                  {COLS.map(c => (
                                    <td key={c} style={{ padding: '4px 8px', border: '1px solid var(--border)', maxWidth: c === 'name' ? 200 : 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {r[c] ?? ''}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn-outline" style={{ fontSize: 12 }} onClick={() => handleCopyTemplateRows(tmplPreview)}>
                          📋 Скопировать
                        </button>
                        {tmplPreview.scope !== 'common' && (
                          <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => handlePublishTemplate(tmplPreview)}>
                            → В Общие шаблоны
                          </button>
                        )}
                        {tmplPreview.scope === 'common' && (
                          <button className="btn-outline" style={{ fontSize: 12 }} onClick={() => handleToggleTemplateActive(tmplPreview)}>
                            {tmplPreview.is_active ? '🚫 Скрыть из общих' : '👁 Показать в общих'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

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
                    <input value={mapping.nameCol} onChange={e => setMapping(m => ({ ...m, nameCol: normalizeCol(e.target.value) }))} placeholder="D или 4" />
                  </div>
                  <div className="form-col">
                    <label>Столбец артикула *</label>
                    <input value={mapping.artCol} onChange={e => setMapping(m => ({ ...m, artCol: normalizeCol(e.target.value) }))} placeholder="C или 3" />
                  </div>
                  <div className="form-col">
                    <label>Столбец цены</label>
                    <input value={mapping.priceCol} onChange={e => setMapping(m => ({ ...m, priceCol: normalizeCol(e.target.value) }))} placeholder="F или 6" />
                  </div>
                </div>
                <div className="categories-bg">
                  <div className="categories-bg-title">Столбцы категорий (плоский формат)</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                    Если категории — отдельные строки (без артикула), оставьте пустыми — определится автоматически
                  </div>
                  <div className="form-row-3">
                    {['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((k, i) => (
                      <div key={k} className="form-col">
                        <label>{`Столбец ${i + 1} группы`}</label>
                        <input value={(mapping as any)[k]} onChange={e => setMapping(m => ({ ...m, [k]: normalizeCol(e.target.value) }))} placeholder="Необяз." />
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div className="admin-section-title" style={{ margin: 0 }}>Каталог: База</div>
                <button className="btn-secondary" style={{ fontSize: 13, padding: '6px 14px' }}
                  onClick={openTilesManager}>Управление плитками</button>
              </div>

              {tiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                  Нет категорий. Нажмите "Управление плитками" чтобы добавить.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  {tiles.map(tile => (
                    <div key={tile.id} style={{
                      gridColumn: tile.is_large ? '1 / -1' : undefined,
                      border: '1px solid var(--border)', borderRadius: 8, padding: 16,
                      background: tile.is_active ? 'var(--card-bg, #fff)' : '#f9f9f9',
                      opacity: tile.is_active ? 1 : 0.6,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        {tile.image_path
                          ? <img src={`${process.env.NEXT_PUBLIC_API_URL}/uploads/${tile.image_path.split(/[\\/]/).pop()}`}
                              alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                          : tile.icon
                            ? <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: '#f5f5f5', borderRadius: 6 }}>{tile.icon}</div>
                            : <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, background: '#f5c800', color: '#fff', borderRadius: 6 }}>{tile.name[0]}</div>
                        }
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{tile.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 12 }}>
                            <span>{tile.products_count || 0} товаров</span>
                            {tile.data_file_name && <span>{tile.data_file_name}</span>}
                            {!tile.is_active && <span style={{ color: 'var(--danger)' }}>скрыта</span>}
                            {tile.is_large && <span>широкая</span>}
                          </div>
                        </div>
                        <span className={tile.is_active ? 'badge badge-green' : 'badge badge-gray'} style={{ fontSize: 11 }}>
                          {tile.is_active ? 'видна' : 'скрыта'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn-primary" style={{ fontSize: 12, padding: '5px 12px' }}
                          onClick={() => openTileDataModal(tile)}>
                          {tile.products_count > 0 ? 'Обновить данные' : 'Загрузить Excel'}
                        </button>
                        <label className="btn-outline" style={{ fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}>
                          Обложка
                          <input type="file" accept="image/*" style={{ display: 'none' }}
                            onChange={e => e.target.files?.[0] && handleUploadTileImage(tile.id, e.target.files[0])} />
                        </label>
                        <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                          onClick={() => setEditTile({ ...tile })}>
                          Настройки
                        </button>
                        {tile.products_count > 0 && (
                          <button className="btn-outline" style={{ fontSize: 12, padding: '5px 12px', color: 'var(--danger)' }}
                            onClick={() => handleDeleteTileData(tile.id)}>
                            Очистить
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                <input value={mapping.nameCol} onChange={e => setMapping(m => ({ ...m, nameCol: normalizeCol(e.target.value) }))} placeholder="D или 4" />
              </div>
              <div className="form-col">
                <label>Столбец артикула *</label>
                <input value={mapping.artCol} onChange={e => setMapping(m => ({ ...m, artCol: normalizeCol(e.target.value) }))} placeholder="C или 3" />
              </div>
              <div className="form-col">
                <label>Столбец цены</label>
                <input value={mapping.priceCol} onChange={e => setMapping(m => ({ ...m, priceCol: normalizeCol(e.target.value) }))} placeholder="F или 6" />
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

      {/* ── Modal: Tiles manager ── */}
      {tilesManagerOpen && (
        <div className="modal-overlay" onClick={() => setTilesManagerOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 600, width: '90vw', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-title">Управление плитками</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Добавляйте, удаляйте, меняйте порядок и размер плиток каталога.
            </div>

            {/* Tile list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {managedTiles.map((t, idx) => (
                <div key={t.id || t._tempId} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px',
                  background: t.is_active ? '#fff' : '#f9f9f9',
                  opacity: t.is_active ? 1 : 0.5,
                }}>
                  {/* Arrows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => moveTile(idx, -1)} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 14, color: idx === 0 ? '#ddd' : '#666', padding: 0, lineHeight: 1 }}>
                      ▲
                    </button>
                    <button onClick={() => moveTile(idx, 1)} disabled={idx === managedTiles.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === managedTiles.length - 1 ? 'default' : 'pointer', fontSize: 14, color: idx === managedTiles.length - 1 ? '#ddd' : '#666', padding: 0, lineHeight: 1 }}>
                      ▼
                    </button>
                  </div>

                  {/* Name (editable) */}
                  <input className="admin-input" value={t.name} style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
                    onChange={e => updateManagedName(idx, e.target.value)} />

                  {/* Size toggle */}
                  <button onClick={() => toggleManagedSize(idx)}
                    title={t.is_large ? 'Широкая плитка' : 'Обычная плитка'}
                    style={{
                      background: t.is_large ? '#f5c800' : '#eee', color: t.is_large ? '#fff' : '#999',
                      border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 11,
                      cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                    {t.is_large ? 'Широкая' : 'Обычная'}
                  </button>

                  {/* Active toggle */}
                  <button onClick={() => toggleManagedActive(idx)}
                    style={{
                      background: t.is_active ? '#22c55e' : '#ccc', color: '#fff',
                      border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 11,
                      cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                    {t.is_active ? 'Видна' : 'Скрыта'}
                  </button>

                  {/* Delete */}
                  <button onClick={() => removeManagedTile(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#e55', padding: '0 4px' }}>
                    ✕
                  </button>
                </div>
              ))}
              {managedTiles.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 13 }}>Нет плиток</div>
              )}
            </div>

            {/* Add new */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input className="admin-input" placeholder="Название новой плитки" value={newTileName}
                onChange={e => setNewTileName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addManagedTile()}
                style={{ flex: 1 }} />
              <button className="btn-primary" style={{ padding: '6px 16px', whiteSpace: 'nowrap' }}
                onClick={addManagedTile} disabled={!newTileName.trim()}>
                + Добавить
              </button>
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setTilesManagerOpen(false)}>Отмена</button>
              <button className="btn-primary" onClick={saveTilesManager}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Edit tile settings ── */}
      {editTile && (
        <div className="modal-overlay" onClick={() => setEditTile(null)}>
          <div className="modal-box" style={{ maxWidth: 520, width: '90vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Настройки категории</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Slug</div>
                <input className="admin-input" value={editTile.slug} onChange={e => setEditTile((p: any) => ({ ...p, slug: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Иконка</div>
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
            {editTile.filters?.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Текущие фильтры (автоматические из Excel)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {editTile.filters.map((fg: any, i: number) => (
                    <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
                      {fg.label} ({fg.opts?.length || 0})
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setEditTile(null)}>Отмена</button>
              <button className="btn-primary" onClick={handleSaveTile}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Tile data upload ── */}
      {tileDataModal && (
        <div className="modal-overlay" onClick={() => setTileDataModal(null)}>
          <div className="modal-box" style={{ maxWidth: 900, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {tileDataModal.products_count > 0 ? 'Обновить данные' : 'Загрузить данные'}: {tileDataModal.name}
            </div>
            {tileDataModal.products_count > 0 && (
              <div style={{ background: '#fff8e1', border: '1px solid #f5c800', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 13 }}>
                Сейчас загружено {tileDataModal.products_count} товаров. При загрузке нового файла старые данные будут полностью заменены.
              </div>
            )}

            {/* File upload */}
            <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: tileFile ? '#f0fdf4' : undefined }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {tileFile ? tileFile.name : 'Выберите .xlsx файл'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Нажмите для выбора файла</div>
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => handleTileFileChange(e.target.files?.[0] || null)} />
            </label>

            {/* Preview table */}
            {tilePreview && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Предпросмотр (первые 7 строк)</div>
                <div style={{ overflowX: 'auto', marginBottom: 16, border: '1px solid var(--border)', borderRadius: 6 }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '4px 6px', background: '#f5f5f5', fontWeight: 700, borderBottom: '1px solid var(--border)', position: 'sticky', left: 0 }}>#</th>
                        {tilePreview.headers.map(h => (
                          <th key={h} style={{ padding: '4px 8px', background: '#f5f5f5', fontWeight: 700, borderBottom: '1px solid var(--border)', minWidth: 60 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tilePreview.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: ri + 1 < Number(tileMapping.firstRow) ? '#f9f9f9' : undefined }}>
                          <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee', fontWeight: 600, color: 'var(--muted)' }}>{ri + 1}</td>
                          {row.map((cell: string, ci: number) => (
                            <td key={ci} style={{ padding: '3px 8px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Column mapping */}
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Маппинг столбцов</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Первая строка данных *</div>
                    <input className="admin-input" type="number" value={tileMapping.firstRow}
                      onChange={e => setTileMapping(m => ({ ...m, firstRow: e.target.value }))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Название *</div>
                    <input className="admin-input" placeholder="напр. B" value={tileMapping.nameCol}
                      onChange={e => setTileMapping(m => ({ ...m, nameCol: normalizeCol(e.target.value) }))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Артикул</div>
                    <input className="admin-input" placeholder="напр. C" value={tileMapping.articleCol}
                      onChange={e => setTileMapping(m => ({ ...m, articleCol: normalizeCol(e.target.value) }))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Цена</div>
                    <input className="admin-input" placeholder="напр. F" value={tileMapping.priceCol}
                      onChange={e => setTileMapping(m => ({ ...m, priceCol: normalizeCol(e.target.value) }))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Ед. изм.</div>
                    <input className="admin-input" placeholder="напр. E" value={tileMapping.unitCol}
                      onChange={e => setTileMapping(m => ({ ...m, unitCol: normalizeCol(e.target.value) }))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Бренд</div>
                    <input className="admin-input" placeholder="напр. D" value={tileMapping.brandCol}
                      onChange={e => setTileMapping(m => ({ ...m, brandCol: normalizeCol(e.target.value) }))} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Аксессуары с</div>
                    <input className="admin-input" placeholder="напр. P или 16" value={tileMapping.accessoriesStartCol}
                      onChange={e => setTileMapping(m => ({ ...m, accessoriesStartCol: normalizeCol(e.target.value) }))} style={{ width: '100%' }} />
                  </div>
                </div>

                {/* Filter columns */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Столбцы-фильтры</div>
                    <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
                      onClick={() => setTileFilterCols(f => [...f, { col: '', label: '' }])}>+ Фильтр</button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                    Укажите букву столбца и название фильтра, которое увидят пользователи. Значения фильтра вычислятся автоматически.
                  </div>
                  {tileFilterCols.map((fc, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                      <input className="admin-input" placeholder="Столбец (G)" value={fc.col} style={{ width: 80 }}
                        onChange={e => {
                          const arr = [...tileFilterCols];
                          arr[i] = { ...arr[i], col: normalizeCol(e.target.value) };
                          setTileFilterCols(arr);
                        }} />
                      <input className="admin-input" placeholder="Название фильтра (Ток, А)" value={fc.label} style={{ flex: 1 }}
                        onChange={e => {
                          const arr = [...tileFilterCols];
                          arr[i] = { ...arr[i], label: e.target.value };
                          setTileFilterCols(arr);
                        }} />
                      <button style={{ fontSize: 13, color: 'var(--danger)', cursor: 'pointer', background: 'none', border: 'none', padding: '4px' }}
                        onClick={() => setTileFilterCols(f => f.filter((_, fi) => fi !== i))}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setTileDataModal(null)}>Отмена</button>
              <button className="btn-primary" onClick={handleUploadTileData}
                disabled={!tileFile || !tileMapping.nameCol || tileUploading}>
                {tileUploading ? 'Загрузка...' : 'Загрузить данные'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
