'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { catalogApi, sheetsApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

export default function CatalogPage() {
  const router = useRouter();
  const { activeSheetId } = useAppStore();
  const [mode, setMode] = useState<'manuf' | 'filter'>('filter');

  // ── Manufacturers mode ─────────────────────────────────────
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [manufExpanded, setManufExpanded] = useState<Set<number>>(new Set());
  const [manufTrees, setManufTrees] = useState<Record<number, any[]>>({});
  const [manufTreeLoading, setManufTreeLoading] = useState<Set<number>>(new Set());
  const [catExpanded, setCatExpanded] = useState<Set<number>>(new Set());
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [breadcrumbPath, setBreadcrumbPath] = useState<string[]>([]);

  // ── Filter mode ────────────────────────────────────────────
  const [tiles, setTiles] = useState<any[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [filterProducts, setFilterProducts] = useState<any[]>([]);
  const [loadingFilter, setLoadingFilter] = useState(false);
  // Dynamic filter options loaded from bot_database.db per slug
  const [dynamicFilters, setDynamicFilters] = useState<{ label: string; opts: string[] }[]>([]);
  const [loadingFilters, setLoadingFilters] = useState(false);

  // ── Shared ─────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showSelectSheet, setShowSelectSheet] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    catalogApi.getManufacturers().then(r => setManufacturers(r.data)).catch(() => {});
    catalogApi.getTiles().then(r => setTiles(r.data)).catch(() => {});
  }, []);

  // ── Manufacturer tree ──────────────────────────────────────
  async function toggleManuf(m: any) {
    const id = m.id;
    const willExpand = !manufExpanded.has(id);
    setManufExpanded(prev => {
      const next = new Set(prev);
      willExpand ? next.add(id) : next.delete(id);
      return next;
    });
    if (willExpand && !manufTrees[id]) {
      setManufTreeLoading(prev => new Set(prev).add(id));
      try {
        const { data } = await catalogApi.getTree(id);
        setManufTrees(prev => ({ ...prev, [id]: data }));
      } catch { toast.error('Ошибка загрузки каталога'); }
      finally { setManufTreeLoading(prev => { const n = new Set(prev); n.delete(id); return n; }); }
    }
  }

  function toggleCat(id: number) {
    setCatExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function findNodePath(nodes: any[], targetId: number, path: string[] = []): string[] | null {
    for (const node of nodes) {
      const p = [...path, node.name];
      if (node.id === targetId) return p;
      if (node.children?.length) {
        const found = findNodePath(node.children, targetId, p);
        if (found) return found;
      }
    }
    return null;
  }

  async function selectCat(node: any, manufId: number, manufName: string) {
    setSelectedCatId(node.id);
    setSelectedProduct(null);
    setSearch('');
    const tree = manufTrees[manufId] || [];
    const nodePath = findNodePath(tree, node.id) || [node.name];
    setBreadcrumbPath([manufName, ...nodePath]);
    try {
      const { data } = await catalogApi.getProducts(node.id);
      setProducts(data);
    } catch { toast.error('Ошибка загрузки товаров'); }
  }

  function renderTree(nodes: any[], manufId: number, manufName: string, depth = 0): JSX.Element[] {
    return nodes.flatMap(node => [
      <div key={node.id}
        className={`tree-item${selectedCatId === node.id ? ' selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => selectCat(node, manufId, manufName)}
        onDoubleClick={e => { e.stopPropagation(); if (node.children?.length) toggleCat(node.id); }}
      >
        <button className="tree-toggle" onClick={e => { e.stopPropagation(); toggleCat(node.id); }}>
          {node.children?.length ? (catExpanded.has(node.id) ? '▼' : '▶') : ' '}
        </button>
        <span className="tree-folder">📁</span>
        <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>{node.name}</span>
      </div>,
      ...(catExpanded.has(node.id) && node.children
        ? renderTree(node.children, manufId, manufName, depth + 1) : []),
    ]);
  }

  // ── Filter mode ────────────────────────────────────────────
  const fetchFilterProducts = useCallback(async (slug: string, filters: Record<string, string[]>) => {
    setLoadingFilter(true);
    try {
      const brands = filters['Производитель'] || [];
      const { data } = await catalogApi.filterProducts(
        slug,
        brands.length ? brands : undefined,
        filters,
      );
      setFilterProducts(data);
    } catch { toast.error('Ошибка загрузки товаров'); }
    finally { setLoadingFilter(false); }
  }, []);

  async function selectCategorySlug(slug: string) {
    setSelectedSlug(slug); setActiveFilters({}); setFilterProducts([]);
    setSelectedProduct(null); setSearch('');
    // Load dynamic filter options and products in parallel
    setLoadingFilters(true);
    try {
      const { data } = await catalogApi.getFilterOptions(slug);
      setDynamicFilters(data);
    } catch {
      setDynamicFilters([]);
    } finally {
      setLoadingFilters(false);
    }
    fetchFilterProducts(slug, {});
  }

  function backToCategoryTiles() {
    setSelectedSlug(null); setActiveFilters({}); setFilterProducts([]);
    setSelectedProduct(null); setSearch(''); setDynamicFilters([]);
  }

  function toggleFilter(group: string, val: string) {
    setActiveFilters(prev => {
      const next = { ...prev };
      const cur = next[group] || [];
      next[group] = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
      if (selectedSlug) fetchFilterProducts(selectedSlug, next);
      return next;
    });
  }

  function clearAllFilters() {
    setActiveFilters({});
    if (selectedSlug) fetchFilterProducts(selectedSlug, {});
  }

  function clearFilterGroup(group: string) {
    setActiveFilters(prev => {
      const next = { ...prev, [group]: [] };
      if (selectedSlug) fetchFilterProducts(selectedSlug, next);
      return next;
    });
  }

  function getDisplayedFilterProducts() {
    // Parametric filtering is handled on the backend; here we only apply the text search bar
    if (!search.trim()) return filterProducts;
    const q = search.toLowerCase();
    return filterProducts.filter(p =>
      p.name.toLowerCase().includes(q) || (p.article || '').toLowerCase().includes(q)
    );
  }

  function switchMode(m: 'manuf' | 'filter') {
    setMode(m); setSearch(''); setSelectedProduct(null);
    if (m === 'manuf') { setSelectedSlug(null); setActiveFilters({}); setFilterProducts([]); }
    else { setSelectedCatId(null); setProducts([]); }
  }

  // ── Product helpers ────────────────────────────────────────
  function selectProduct(p: any) {
    setSelectedProduct((prev: any) => prev?.id === p.id ? null : p);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  async function addToSheet(product: any) {
    if (!activeSheetId) { setShowSelectSheet(true); return; }
    try {
      const { data: sh } = await sheetsApi.getOne(activeSheetId);
      const existing = (sh.rows || []).filter((r: any) => r.name || r.article);
      await sheetsApi.saveRows(activeSheetId, [...existing, {
        row_number: existing.length + 1,
        name: product.name, brand: product.manufacturer?.name || '',
        article: product.article || '', unit: product.unit || 'шт',
        price: product.price ? String(product.price) : '',
        store: 'ЭТМ', qty: '1', coef: '1',
      }]);
      toast.success(`«${product.name.slice(0, 40)}» добавлен в лист`);
    } catch { toast.error('Ошибка добавления в лист'); }
  }

  const filteredManufProducts = search
    ? products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.article || '').toLowerCase().includes(search.toLowerCase()))
    : products;

  const displayedFilterProducts = getDisplayedFilterProducts();
  const selectedTile = tiles.find(t => t.slug === selectedSlug);

  // ── Inline product detail ──────────────────────────────────
  function inlineDetail(p: any) {
    if (!selectedProduct || selectedProduct.id !== p.id) return null;
    return (
      <div ref={detailRef} className="product-detail-inline">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
          {selectedProduct.article && (
            <div>Артикул: <strong>{selectedProduct.article}</strong></div>
          )}
          {selectedProduct.price && (
            <div>Цена: <strong>{selectedProduct.price} ₽</strong></div>
          )}
          {selectedProduct.unit && (
            <div>Ед. изм.: {selectedProduct.unit}</div>
          )}
          {selectedProduct.manufacturer?.name && (
            <div>Производитель: {selectedProduct.manufacturer.name}</div>
          )}
        </div>
        <button
          className="btn-add-to-list"
          style={{ marginTop: 10, alignSelf: 'flex-start' }}
          onClick={e => { e.stopPropagation(); addToSheet(selectedProduct); }}
        >
          + Добавить в лист
        </button>
      </div>
    );
  }

  return (
    <>
      <Header breadcrumb="Каталог" />
      <div className="catalog-screen">

        {/* ── Toolbar ── */}
        <div className="catalog-toolbar">
          <div className="toggle-group">
            <button className={`toggle-btn${mode === 'filter' ? ' active' : ''}`} onClick={() => switchMode('filter')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              {mode === 'filter' ? ' Подбор по категориям' : ' Выбор по фильтрам'}
            </button>
            <button className={`toggle-btn${mode === 'manuf' ? ' active' : ''}`} onClick={() => switchMode('manuf')}>
              Каталоги производителей
            </button>
          </div>
          <div className="catalog-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={mode === 'filter' ? 'Поиск по всем разделам' : 'Поиск по выбранному разделу'}
            />
          </div>
          <button className="btn-back-to-sheet" onClick={() => router.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 010 8h-1"/>
            </svg>
            Вернуться на лист
          </button>
        </div>

        {/* ── Body ── */}
        <div className="catalog-body">

          {/* Left panel */}
          <div className="catalog-left">

            {/* Manufacturers mode: all-in-one tree */}
            {mode === 'manuf' && (
              manufacturers.filter(m => m.is_active).length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <p>Нет загруженных прайс-листов.</p>
                  <p style={{ marginTop: 8 }}>Загрузите прайсы в <strong>Админ-панели</strong>.</p>
                </div>
              ) : (
                manufacturers.filter(m => m.is_active).map(m => (
                  <div key={m.id}>
                    <div className="manuf-header-row" onClick={() => toggleManuf(m)}>
                      <span className="manuf-toggle">{manufExpanded.has(m.id) ? '▼' : '▶'}</span>
                      <span className="tree-folder">📁</span>
                      <span className="manuf-name">{m.name}</span>
                      {manufTreeLoading.has(m.id) && (
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>…</span>
                      )}
                    </div>
                    {manufExpanded.has(m.id) && manufTrees[m.id] &&
                      renderTree(manufTrees[m.id], m.id, m.name)
                    }
                  </div>
                ))
              )
            )}

            {/* Filter mode */}
            {mode === 'filter' && (
              !selectedSlug ? (
                <div className="category-tiles-ref">
                  {tiles.map((tile, idx) => (
                    <div
                      key={tile.id}
                      className={`category-tile-ref${tile.is_large || idx === 0 ? ' large' : ''}`}
                      onClick={() => selectCategorySlug(tile.slug)}
                    >
                      {tile.image_path
                        ? <img
                            src={`/uploads/${tile.image_path.split(/[\\/]/).pop()}`}
                            alt={tile.name}
                            className="category-tile-img"
                          />
                        : <div className="category-tile-icon" style={{ fontSize: 36 }}>{tile.icon}</div>
                      }
                      <div className="category-tile-name-ref">{tile.name}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="filter-panel">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div className="filter-back" onClick={backToCategoryTiles}>← Категории</div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }} onClick={clearAllFilters}>
                      Сбросить все
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{selectedTile?.name}</div>
                  {loadingFilters && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>Загрузка фильтров…</div>
                  )}
                  {!loadingFilters && dynamicFilters.map((fg) => (
                    <div key={fg.label} className="filter-group">
                      <div className="filter-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{fg.label}</span>
                        {(activeFilters[fg.label]?.length > 0) && (
                          <span style={{ fontSize: 10, color: 'var(--yellow)', cursor: 'pointer' }} onClick={() => clearFilterGroup(fg.label)}>
                            ✕ сбросить
                          </span>
                        )}
                      </div>
                      <div className="filter-options">
                        {fg.opts.map((opt: string) => {
                          const checked = (activeFilters[fg.label] || []).includes(opt);
                          return (
                            <label key={opt} className="filter-option" onClick={() => toggleFilter(fg.label, opt)}>
                              <div className={`filter-checkbox${checked ? ' checked' : ''}`} />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Right panel */}
          <div className="catalog-right">

            {mode === 'manuf' && (
              <>
                {breadcrumbPath.length > 0 && (
                  <div className="catalog-breadcrumb-ref">{breadcrumbPath.join('/')}</div>
                )}
                {filteredManufProducts.map((p, i) => (
                  <div key={p.id}>
                    <div
                      className={`product-item-ref${selectedProduct?.id === p.id ? ' selected' : ''}`}
                      onClick={() => selectProduct(p)}
                    >
                      <span className="product-num">{i + 1}</span>
                      <div className="product-info">
                        <div className="product-name">{p.name}</div>
                        <div className="product-article">Артикул {p.article}</div>
                      </div>
                      <button className="btn-add-to-list" onClick={e => { e.stopPropagation(); addToSheet(p); }}>
                        + Добавить в лист
                      </button>
                    </div>
                    {inlineDetail(p)}
                  </div>
                ))}
                {!selectedCatId && (
                  <div className="empty-state">Выберите раздел в дереве слева</div>
                )}
              </>
            )}

            {mode === 'filter' && (
              <>
                <div className="catalog-breadcrumb-ref">
                  Каталог/{selectedTile ? selectedTile.name : ''}
                </div>
                {loadingFilter && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Загрузка…</div>
                )}
                {!loadingFilter && displayedFilterProducts.map((p, i) => (
                  <div key={p.id}>
                    <div
                      className={`product-item-ref${selectedProduct?.id === p.id ? ' selected' : ''}`}
                      onClick={() => selectProduct(p)}
                    >
                      <span className="product-num">{i + 1}</span>
                      <div className="product-info">
                        <div className="product-name">{p.name}</div>
                        <div className="product-article">
                          Артикул {p.article}
                          {p.manufacturer?.name && (
                            <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{p.manufacturer.name}</span>
                          )}
                        </div>
                      </div>
                      <button className="btn-add-to-list" onClick={e => { e.stopPropagation(); addToSheet(p); }}>
                        + Добавить в лист
                      </button>
                    </div>
                    {inlineDetail(p)}
                  </div>
                ))}
                {!selectedSlug && !loadingFilter && displayedFilterProducts.length === 0 && (
                  <div className="empty-state">Выберите категорию слева</div>
                )}
                {selectedSlug && !loadingFilter && displayedFilterProducts.length === 0 && (
                  <div className="empty-state">Нет товаров по выбранным фильтрам</div>
                )}
              </>
            )}

          </div>
        </div>
      </div>

      {showSelectSheet && (
        <div className="modal-overlay" onClick={() => setShowSelectSheet(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Нет открытого листа</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Сначала откройте лист спецификации, затем вернитесь в каталог.
            </p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowSelectSheet(false)}>Закрыть</button>
              <button className="btn-primary" onClick={() => { setShowSelectSheet(false); router.push('/projects'); }}>
                К проектам
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
