'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';

const SS_KEY = 'catalog_state_v1';

function loadSavedState() {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(patch: Record<string, unknown>) {
  try {
    const prev = loadSavedState() || {};
    sessionStorage.setItem(SS_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch { /* ignore */ }
}
import { catalogApi, sheetsApi, storesApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';
import RequireSubscription from '@/components/RequireSubscription';

export default function CatalogPage() {
  return <RequireSubscription><CatalogPageInner /></RequireSubscription>;
}

function CatalogPageInner() {
  const router = useRouter();
  const { activeSheetId } = useAppStore();

  // ── Restore persisted state (sync, before first render) ───
  const saved = (() => { try { return loadSavedState(); } catch { return null; } })();

  const [mode, setMode] = useState<'manuf' | 'filter'>(saved?.mode ?? 'filter');

  // ── Manufacturers mode ─────────────────────────────────────
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [manufExpanded, setManufExpanded] = useState<Set<number>>(
    new Set<number>(saved?.manufExpanded ?? [])
  );
  const [manufTrees, setManufTrees] = useState<Record<number, any[]>>({});
  const [manufTreeLoading, setManufTreeLoading] = useState<Set<number>>(new Set());
  const [catExpanded, setCatExpanded] = useState<Set<number>>(
    new Set<number>(saved?.catExpanded ?? [])
  );
  const [selectedCatId, setSelectedCatId] = useState<number | null>(saved?.selectedCatId ?? null);
  const [products, setProducts] = useState<any[]>([]);
  const [breadcrumbPath, setBreadcrumbPath] = useState<string[]>(saved?.breadcrumbPath ?? []);

  // ── Filter mode ────────────────────────────────────────────
  const [tiles, setTiles] = useState<any[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(saved?.selectedSlug ?? null);
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(saved?.activeFilters ?? {});
  const [filterProducts, setFilterProducts] = useState<any[]>([]);
  const [loadingFilter, setLoadingFilter] = useState(false);
  const [dynamicFilters, setDynamicFilters] = useState<{ label: string; opts: string[] }[]>(
    saved?.dynamicFilters ?? []
  );
  const [loadingFilters, setLoadingFilters] = useState(false);

  // ── Shared ─────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showSelectSheet, setShowSelectSheet] = useState(false);
  const addingRef = useRef(false); // prevent double-click race
  const detailRef = useRef<HTMLDivElement>(null);
  const [etmData, setEtmData] = useState<{ price: number | null; term: string } | null>(null);
  const [etmLoading, setEtmLoading] = useState(false);
  const [accView, setAccView] = useState<'closed' | 'types' | 'list'>('closed');
  const [accSelectedType, setAccSelectedType] = useState<string | null>(null);
  // ETM data for accessories keyed by article: { price, term, loading }
  const [accEtm, setAccEtm] = useState<Record<string, { price: number | null; term: string | null; loading: boolean }>>({});
  // Track whether we've done the initial restore fetch
  const restoredRef = useRef(false);

  useEffect(() => {
    catalogApi.getManufacturers().then(r => setManufacturers(r.data)).catch(() => {});
    catalogApi.getTiles().then(r => setTiles(r.data)).catch(() => {});
  }, []);

  // ── On mount: re-fetch products for restored state ─────────
  const fetchFilterProducts = useCallback(async (slug: string, filters: Record<string, string[]>) => {
    setLoadingFilter(true);
    try {
      const brands = filters['Производитель'] || [];
      const { data } = await catalogApi.filterProducts(slug, brands.length ? brands : undefined, filters);
      setFilterProducts(data);
    } catch { toast.error('Ошибка загрузки товаров'); }
    finally { setLoadingFilter(false); }
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (saved?.selectedSlug) {
      // Restore filter mode: refetch products with saved filters
      fetchFilterProducts(saved.selectedSlug, saved.activeFilters ?? {});
    } else if (saved?.selectedCatId && saved?.mode === 'manuf') {
      // Restore manuf mode: expand trees and load products
      const expandedIds: number[] = saved.manufExpanded ?? [];
      expandedIds.forEach(async (id: number) => {
        try {
          const { data } = await catalogApi.getTree(id);
          setManufTrees(prev => ({ ...prev, [id]: data }));
        } catch {}
      });
      catalogApi.getProducts(saved.selectedCatId).then(r => setProducts(r.data)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist state on change ────────────────────────────────
  useEffect(() => { saveState({ mode }); }, [mode]);
  useEffect(() => { saveState({ selectedSlug }); }, [selectedSlug]);
  useEffect(() => { saveState({ activeFilters }); }, [activeFilters]);
  useEffect(() => { saveState({ dynamicFilters }); }, [dynamicFilters]);
  useEffect(() => { saveState({ selectedCatId }); }, [selectedCatId]);
  useEffect(() => { saveState({ breadcrumbPath }); }, [breadcrumbPath]);
  useEffect(() => { saveState({ manufExpanded: [...manufExpanded] }); }, [manufExpanded]);
  useEffect(() => { saveState({ catExpanded: [...catExpanded] }); }, [catExpanded]);

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

  // Load ETM price + term for accessories when user opens a category.
  // Uses same progressive pattern as spec refresh: batch prices first, then per-article term.
  useEffect(() => {
    if (accView !== 'list' || !accSelectedType || !selectedProduct?.accessories) return;
    const listAccs = selectedProduct.accessories.filter((a: any) => a.type === accSelectedType && a.article);
    const articles = [...new Set(listAccs.map((a: any) => a.article).filter(Boolean))] as string[];
    if (articles.length === 0) return;
    // Skip articles we've already loaded (or are loading)
    const toLoad = articles.filter(a => !accEtm[a]);
    if (toLoad.length === 0) return;

    // Mark as loading
    setAccEtm(prev => {
      const next = { ...prev };
      for (const a of toLoad) next[a] = { price: null, term: null, loading: true };
      return next;
    });

    // Step 1: batch prices
    (async () => {
      try {
        const { data: prices } = await storesApi.getEtmPrices(toLoad);
        setAccEtm(prev => {
          const next = { ...prev };
          for (const a of toLoad) {
            const cur = next[a] || { price: null, term: null, loading: true };
            next[a] = { ...cur, price: prices[a] ?? null };
          }
          return next;
        });
        // Step 2: per-article terms in parallel (backend serializes them)
        const withPrice = toLoad.filter(a => prices[a] != null && prices[a]! > 0);
        await Promise.all(withPrice.map(async (article) => {
          try {
            const { data } = await storesApi.getEtmTerm(article);
            setAccEtm(prev => ({ ...prev, [article]: { ...(prev[article] || { price: null, term: null, loading: false }), term: data.term || 'нет', loading: false } }));
          } catch {
            setAccEtm(prev => ({ ...prev, [article]: { ...(prev[article] || { price: null, term: null, loading: false }), term: 'нет', loading: false } }));
          }
        }));
        // Mark no-price articles as done too
        setAccEtm(prev => {
          const next = { ...prev };
          for (const a of toLoad) {
            if (next[a]?.loading) next[a] = { ...next[a], loading: false };
          }
          return next;
        });
      } catch {
        setAccEtm(prev => {
          const next = { ...prev };
          for (const a of toLoad) next[a] = { price: null, term: null, loading: false };
          return next;
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accView, accSelectedType, selectedProduct?.id]);

  // Global search across all products (catalog + tiles) with 300ms debounce.
  // Triggers when user types in the toolbar search field — works even without
  // selected category/tile so user can find by article from anywhere.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setGlobalSearchResults([]); setGlobalSearchLoading(false); return; }
    setGlobalSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await catalogApi.search(q);
        setGlobalSearchResults((data as any[]) || []);
      } catch { setGlobalSearchResults([]); }
      finally { setGlobalSearchLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function getDisplayedFilterProducts() {
    // Parametric filtering is handled on the backend; here we only apply the text search bar
    if (!search.trim()) return filterProducts;
    const q = search.toLowerCase();
    return filterProducts.filter(p =>
      p.name.toLowerCase().includes(q) || (p.article || '').toLowerCase().includes(q)
    );
  }

  /** Compute which filter options are available based on current products.
   *  "Производитель" is always fully available; other filters disable zero-result options. */
  function getAvailableOpts(): Record<string, Set<string>> {
    const available: Record<string, Set<string>> = {};
    for (const fg of dynamicFilters) {
      if (fg.label === 'Производитель') {
        available[fg.label] = new Set(fg.opts);
        continue;
      }
      const vals = new Set<string>();
      for (const p of filterProducts) {
        const v = p.attributes?.[fg.label];
        if (v) vals.add(String(v));
      }
      available[fg.label] = vals;
    }
    return available;
  }

  const availableOpts = selectedSlug ? getAvailableOpts() : {};

  function switchMode(m: 'manuf' | 'filter') {
    setMode(m); setSearch(''); setSelectedProduct(null);
    if (m === 'manuf') { setSelectedSlug(null); setActiveFilters({}); setFilterProducts([]); }
    else { setSelectedCatId(null); setProducts([]); }
  }

  // ── Product helpers ────────────────────────────────────────
  function selectProduct(p: any) {
    const isToggleOff = selectedProduct?.id === p.id;
    setSelectedProduct(isToggleOff ? null : p);
    setEtmData(null);
    setAccView('closed');
    setAccSelectedType(null);
    setAccEtm({});
    if (!isToggleOff && p.article) {
      setEtmLoading(true);
      storesApi.getEtmPricesWithTerms([p.article])
        .then(({ data }) => {
          const entry = data[p.article];
          setEtmData(entry ? { price: entry.price, term: entry.term || '' } : null);
        })
        .catch(() => {})
        .finally(() => setEtmLoading(false));
    }
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  async function addToSheet(product: any) {
    if (!activeSheetId) { setShowSelectSheet(true); return; }
    if (addingRef.current) return; // block concurrent calls
    addingRef.current = true;
    try {
      const { data: sh } = await sheetsApi.getOne(activeSheetId);
      const existing = (sh.rows || []).filter((r: any) => r.name || r.article);
      const article = product.article || '';

      // Dedup: if same article already exists → +1 to qty
      const dupIdx = existing.findIndex((r: any) => r.article === article && article);
      if (dupIdx >= 0) {
        const cur = existing[dupIdx];
        const newQty = String((parseFloat(String(cur.qty || '0').replace(',', '.')) || 0) + 1);
        existing[dupIdx] = { ...cur, qty: newQty };
        await sheetsApi.saveRows(activeSheetId, existing);
        toast.success(`«${product.name.slice(0, 40)}» — количество увеличено`);
        return;
      }

      // Try to fetch live ETM price + delivery term
      let etmPrice: number | null = null;
      let etmTerm = 'нет';
      if (article) {
        try {
          const { data: etm } = await storesApi.getEtmPricesWithTerms([article]);
          const entry = etm[article];
          if (entry) {
            etmPrice = entry.price;
            etmTerm = entry.term || 'нет';
          }
        } catch { /* silent — leave defaults */ }
      }

      const finalPrice = etmPrice != null && etmPrice > 0
        ? String(etmPrice)
        : (product.price ? String(product.price) : '');

      await sheetsApi.saveRows(activeSheetId, [...existing, {
        row_number: existing.length + 1,
        name: product.name, brand: product.manufacturer?.name || '',
        article, etm_code: product.etm_code || '',
        unit: product.unit || 'шт',
        price: finalPrice,
        store: 'ЭТМ', qty: '1', coef: '1',
        deadline: etmTerm,
      }]);
      toast.success(`«${product.name.slice(0, 40)}» добавлен в лист`);
    } catch { toast.error('Ошибка добавления в лист'); }
    finally { addingRef.current = false; }
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
    const attrs = selectedProduct.attributes || {};
    const attrEntries = Object.entries(attrs).filter(([, v]) => v);
    return (
      <div ref={detailRef} className="product-detail-inline">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
          {selectedProduct.article && (
            <div>Артикул: <strong>{selectedProduct.article}</strong></div>
          )}
          {selectedProduct.manufacturer?.name && (
            <div>Производитель: {selectedProduct.manufacturer.name}</div>
          )}
          {selectedProduct.price && (
            <div>Цена каталога: <strong>{selectedProduct.price} ₽</strong></div>
          )}
          {selectedProduct.unit && (
            <div>Ед. изм.: {selectedProduct.unit}</div>
          )}
          {/* Filter attributes */}
          {attrEntries.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
              {attrEntries.map(([k, v]) => (
                <span key={k} style={{ color: 'var(--muted)', fontSize: 12 }}>{k}: <strong style={{ color: 'var(--text)' }}>{String(v)}</strong></span>
              ))}
            </div>
          )}
          {/* ETM price + term */}
          {etmLoading && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Загрузка цены ЭТМ...</div>
          )}
          {!etmLoading && etmData && (
            <div style={{ marginTop: 4, padding: '6px 10px', background: '#f0fdf4', borderRadius: 6, fontSize: 12 }}>
              {etmData.price != null && etmData.price > 0 && (
                <span>Цена ЭТМ: <strong>{etmData.price} ₽</strong></span>
              )}
              {etmData.term && (
                <span style={{ marginLeft: etmData.price ? 12 : 0 }}>Срок: <strong>{etmData.term}</strong></span>
              )}
              {etmData.price == null && !etmData.term && (
                <span style={{ color: 'var(--muted)' }}>Нет данных ЭТМ</span>
              )}
            </div>
          )}
          {/* Accessories */}
          {selectedProduct.accessories?.length > 0 && (() => {
            const accs: any[] = selectedProduct.accessories;
            const types = [...new Set(accs.map((a: any) => a.type).filter(Boolean))];
            return (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                {accView === 'closed' && (
                  <button className="btn-outline" style={{ fontSize: 12, padding: '5px 12px' }}
                    onClick={e => { e.stopPropagation(); setAccView('types'); }}>
                    Аксессуары ({accs.length})
                  </button>
                )}

                {accView === 'types' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--yellow)', padding: 0 }}
                        onClick={e => { e.stopPropagation(); setAccView('closed'); }}>
                        ← Назад
                      </button>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Категории аксессуаров</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {types.map((type: string) => {
                        const count = accs.filter((a: any) => a.type === type).length;
                        return (
                          <div key={type}
                            onClick={e => { e.stopPropagation(); setAccSelectedType(type); setAccView('list'); }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg)', borderRadius: 6, cursor: 'pointer', fontSize: 13, border: '1px solid var(--border)' }}>
                            <span>{type}</span>
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{count} ›</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {accView === 'list' && accSelectedType && (() => {
                  const listAccs = accs.filter((a: any) => a.type === accSelectedType);
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--yellow)', padding: 0 }}
                          onClick={e => { e.stopPropagation(); setAccView('types'); setAccSelectedType(null); }}>
                          ← Назад
                        </button>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{accSelectedType}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {listAccs.map((acc: any, ai: number) => {
                          const etm = acc.article ? accEtm[acc.article] : undefined;
                          return (
                            <div key={ai} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--border)' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 500 }}>{acc.name}</div>
                                {acc.article && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{acc.article}</div>}
                                <div style={{ fontSize: 11, marginTop: 3, color: 'var(--muted)' }}>
                                  {etm?.loading && 'Загрузка цены...'}
                                  {etm && !etm.loading && (
                                    <>
                                      {etm.price != null && etm.price > 0
                                        ? <span>Цена ЭТМ: <strong>{etm.price} ₽</strong></span>
                                        : <span>Цена: нет</span>}
                                      {etm.term && <span style={{ marginLeft: 10 }}>Срок: <strong>{etm.term}</strong></span>}
                                    </>
                                  )}
                                </div>
                              </div>
                              <button className="btn-add-to-list" style={{ padding: '3px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                                onClick={e => { e.stopPropagation(); addToSheet({ name: acc.name, article: acc.article, manufacturer: selectedProduct.manufacturer }); }}>
                                + В лист
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })()}
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
          <button className="btn-back-to-sheet" onClick={() => activeSheetId ? router.push(`/spec/${activeSheetId}`) : router.back()}>
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
                            src={`${process.env.NEXT_PUBLIC_API_URL}/uploads/${tile.image_path.split(/[\\/]/).pop()}`}
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
                  {!loadingFilters && dynamicFilters.map((fg) => {
                    const avail = availableOpts[fg.label];
                    return (
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
                            const disabled = avail && !avail.has(opt) && !checked;
                            return (
                              <label key={opt}
                                className={`filter-option${disabled ? ' disabled' : ''}`}
                                onClick={() => !disabled && toggleFilter(fg.label, opt)}
                                style={disabled ? { opacity: 0.35, cursor: 'default' } : undefined}
                              >
                                <div className={`filter-checkbox${checked ? ' checked' : ''}`} />
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* Right panel */}
          <div className="catalog-right">

            {/* Global search results — show whenever user types in the toolbar search,
                regardless of selected category/tile. Falls back to category/tile view if search is empty. */}
            {search.trim().length >= 2 && (
              <>
                <div className="catalog-breadcrumb-ref">Поиск: «{search.trim()}»</div>
                {globalSearchLoading && (
                  <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Поиск…</div>
                )}
                {!globalSearchLoading && globalSearchResults.length === 0 && (
                  <div className="empty-state">Ничего не найдено по запросу</div>
                )}
                {!globalSearchLoading && globalSearchResults.map((p, i) => (
                  <div key={`gs-${p.id}-${i}`}>
                    <div
                      className={`product-item-ref${selectedProduct?.id === p.id ? ' selected' : ''}`}
                      onClick={() => selectProduct(p)}
                    >
                      <span className="product-num">{i + 1}</span>
                      <div className="product-info">
                        <div className="product-name">{p.name}</div>
                        <div className="product-article">
                          {p.article && <span>Артикул {p.article}</span>}
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
              </>
            )}

            {search.trim().length < 2 && mode === 'manuf' && (
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

            {search.trim().length < 2 && mode === 'filter' && (
              <>
                <div className="catalog-breadcrumb-ref">
                  Каталог/{selectedTile ? selectedTile.name : ''}
                </div>
                {loadingFilter && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Загрузка…</div>
                )}
                {!loadingFilter && displayedFilterProducts.map((p, i) => {
                  const pAttrs = p.attributes || {};
                  const pAttrEntries = Object.entries(pAttrs).filter(([, v]) => v);
                  return (
                    <div key={p.id}>
                      <div
                        className={`product-item-ref${selectedProduct?.id === p.id ? ' selected' : ''}`}
                        onClick={() => selectProduct(p)}
                      >
                        <span className="product-num">{i + 1}</span>
                        <div className="product-info">
                          <div className="product-name">{p.name}</div>
                          <div className="product-article">
                            {p.article && <span>Артикул {p.article}</span>}
                            {p.manufacturer?.name && (
                              <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{p.manufacturer.name}</span>
                            )}
                          </div>
                          {pAttrEntries.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 2 }}>
                              {pAttrEntries.map(([k, v]) => (
                                <span key={k} style={{ fontSize: 11, color: 'var(--muted)' }}>{k}: {String(v)}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button className="btn-add-to-list" onClick={e => { e.stopPropagation(); addToSheet(p); }}>
                          + Добавить в лист
                        </button>
                      </div>
                      {inlineDetail(p)}
                    </div>
                  );
                })}
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
