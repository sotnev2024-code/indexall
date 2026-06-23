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
import { catalogApi, sheetsApi, storesApi, activityApi } from '@/lib/api';
import { usePageTracker } from '@/hooks/usePageTracker';
import { useAppStore } from '@/store/app.store';
import RequireSubscription from '@/components/RequireSubscription';
import SectionOnboarding from '@/components/SectionOnboarding';

export default function CatalogPage() {
  return <RequireSubscription><CatalogPageInner /></RequireSubscription>;
}

function CatalogPageInner() {
  const router = useRouter();
  const { activeSheetId, user } = useAppStore();
  usePageTracker('Подбор по каталогу');
  const isAdmin = user?.plan === 'admin';
  const [adminInfo, setAdminInfo] = useState<{ loading: boolean; data: any | null; productName: string } | null>(null);

  async function openAdminInfo(p: any) {
    // Search results carry _source; for tile/manuf views infer from current mode.
    const source = p._source === 'tile'
      ? 'tile'
      : (p._source === 'catalog' ? 'catalog' : (mode === 'filter' ? 'tile' : 'catalog'));
    setAdminInfo({ loading: true, data: null, productName: p.name || '' });
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || '/api'}/catalog/admin/product-info/${source}/${p.id}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } },
      );
      const data = await res.json();
      setAdminInfo({ loading: false, data, productName: p.name || '' });
    } catch (e: any) {
      setAdminInfo({ loading: false, data: { error: e?.message || 'Ошибка запроса' }, productName: p.name || '' });
    }
  }

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
  // ETM data (price + term) for visible product rows, keyed by article/etm_code.
  // Price comes from batch load (debounced); term is added when user expands the card.
  const [rowEtmData, setRowEtmData] = useState<Record<string, { price: number | null; term: string | null }>>({});
  // Ref mirror of rowEtmData so the debounced effect can read the latest state
  // without having rowEtmData in deps (which would reset the timer on every fetch).
  const rowEtmDataRef = useRef<Record<string, { price: number | null; term: string | null }>>({});
  useEffect(() => { rowEtmDataRef.current = rowEtmData; }, [rowEtmData]);
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
  // Enriched accessories from DB (image, site_url, description, attributes) keyed by article
  const [accItemDetails, setAccItemDetails] = useState<Record<string, any>>({});
  // Zoomed image URL (accessories and product thumbnails)
  const [accZoomImg, setAccZoomImg] = useState<string | null>(null);
  const [productZoomImg, setProductZoomImg] = useState<string | null>(null);
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
    activityApi.logEvent('open_catalog', `${manufName} / ${nodePath.join(' / ')}`);
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
    const isSameSlug = selectedSlug === slug;
    setSelectedSlug(slug);
    setSelectedProduct(null); setSearch('');
    if (!isSameSlug) activityApi.logEvent('open_catalog', `filter: ${slug}`);

    if (!isSameSlug) {
      // New category — reset filters and reload
      setActiveFilters({}); setFilterProducts([]);
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
    } else {
      // Same category — reuse existing filters, refetch products with saved filters
      fetchFilterProducts(slug, activeFilters);
    }
  }

  function backToCategoryTiles() {
    // Keep activeFilters and dynamicFilters so they persist when user returns to same category
    setSelectedSlug(null); setFilterProducts([]);
    setSelectedProduct(null); setSearch('');
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

  // Fetch enriched accessory details from DB (image, site_url, description, attributes)
  useEffect(() => {
    if (accView === 'closed' || !selectedProduct) return;
    if (Object.keys(accItemDetails).length > 0) return; // already loaded
    const tileId = tiles.find((t: any) => t.slug === selectedSlug)?.id;
    if (!tileId) return;
    (async () => {
      try {
        const { data: groups } = await catalogApi.getTileProductAccessories(tileId, selectedProduct.id);
        const details: Record<string, any> = {};
        for (const g of groups) {
          for (const item of g.items) {
            if (item.article) details[item.article] = item;
          }
        }
        setAccItemDetails(details);
      } catch { /* silently ignore — image/desc just won't show */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accView, selectedProduct?.id, selectedSlug]);

  // Global search across all products (catalog + tiles) with 300ms debounce.
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

  // Fetch ETM prices for the first 50 visible product rows after user stops interacting.
  // Picks the correct row set based on current view:
  //   - search active  → global search results
  //   - manuf mode     → products of selected category
  //   - filter mode    → tile products with active filters
  // ETM /price allows up to 50 articles per batch, so we cap at first 50.
  // 3.5s debounce: avoids firing on every keystroke, filter toggle, or folder click.
  // Note: rowEtmData is intentionally NOT in deps — otherwise a completed fetch would
  // clear the timer on the next render. We read it via ref at fire time instead.
  useEffect(() => {
    const rows =
      search.trim().length >= 2 ? globalSearchResults :
      mode === 'manuf' ? products :
      filterProducts;
    if (!rows || rows.length === 0) return;

    // ETM lookup is keyed strictly on the manufacturer article. The stored
    // etm_code is the manufacturer-directory code in ETM and goes only as
    // a disambiguator (mnf= query param) — never as a standalone identifier.
    // Items without an article are skipped: ETM has no way to return a
    // product price for "manufacturer only".
    const allItems = rows
      .slice(0, 50)
      .map(r => ({ article: r.article, etmCode: r.etm_code }))
      .filter(it => it.article && it.article.trim());
    if (allItems.length === 0) return;

    const t = setTimeout(async () => {
      // At fire time, filter out items already fetched (cache key = article).
      const current = rowEtmDataRef.current;
      const items = allItems.filter(it => {
        const key = (it.article || '').trim();
        return key && current[key] === undefined;
      });
      if (items.length === 0) return;
      try {
        const { data } = await storesApi.getEtmPricesByItems(items);
        setRowEtmData(prev => {
          const next = { ...prev };
          for (const [k, price] of Object.entries(data)) {
            next[k] = { price: price as number | null, term: next[k]?.term ?? null };
          }
          return next;
        });
      } catch { /* silent — ETM may be unavailable */ }
    }, 3500);
    return () => clearTimeout(t);
    // `search` is intentionally omitted — globalSearchResults already settles
    // 300ms after typing stops, so watching it is enough. Including `search` would
    // reset the 3.5s price timer on every keystroke and prices would never load.
  }, [globalSearchResults, filterProducts, products, mode]);

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
    setAccItemDetails({});
    // ETM lookup only when an mnf article is actually present. The product's
    // etm_code (manufacturer directory code) is passed as the `mnf=` query
    // disambiguator so ETM resolves the right brand if multiple share an
    // article number.
    const article = (p.article || '').trim();
    const etmCode = (p.etm_code || '').trim() || undefined;
    if (!isToggleOff && article) {
      const cached = rowEtmDataRef.current[article];
      // Price already known from batch load — only fetch the delivery term
      if (cached?.price != null && cached.price > 0) {
        setEtmData({ price: cached.price, term: cached.term || '' });
        if (!cached.term) {
          setEtmLoading(true);
          storesApi.getEtmTerm(article, etmCode)
            .then(({ data }) => {
              const term = data?.term || '';
              setEtmData(prev => prev ? { ...prev, term } : prev);
              setRowEtmData(prev => ({ ...prev, [article]: { price: cached.price, term } }));
            })
            .catch(() => {})
            .finally(() => setEtmLoading(false));
        }
      } else {
        // No cached price — fetch both price and term via the structured items
        // endpoint so it goes through the same code path as the list batch.
        setEtmLoading(true);
        storesApi.getEtmPricesByItems([{ article, etmCode }])
          .then(async ({ data }) => {
            const price = data[article];
            if (price != null && price > 0) {
              const termRes = await storesApi.getEtmTerm(article, etmCode).catch(() => null);
              const term = termRes?.data?.term || '';
              setEtmData({ price, term });
              setRowEtmData(prev => ({ ...prev, [article]: { price, term: term || null } }));
            } else {
              // ETM doesn't have this article — leave catalog price alone, no ghost prices.
              setEtmData(null);
              setRowEtmData(prev => ({ ...prev, [article]: { price: null, term: null } }));
            }
          })
          .catch(() => {})
          .finally(() => setEtmLoading(false));
      }
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

      // Price priority: ETM > catalog > empty.
      // ETM is queried ONLY when the product has an mnf article. Without an
      // article we never go to ETM (the etm_code alone causes false matches).
      // Source column ("ЭТМ" / "—") reflects where the price actually came
      // from — never hardcoded to ЭТМ when the value is from the price-list.
      let etmPrice: number | null = null;
      let etmTerm = 'нет';
      if (article) {
        const cached = rowEtmDataRef.current[article];
        if (cached?.price != null && cached.price > 0) {
          etmPrice = cached.price;
          etmTerm = cached.term || 'нет';
        } else if (cached === undefined) {
          // Pass the manufacturer's ETM directory code as the mnf disambiguator
          // when present, so ETM can resolve the right brand if multiple share
          // this article number.
          const etmCode = (product.etm_code || '').trim() || undefined;
          try {
            const { data: prices } = await storesApi.getEtmPricesByItems([{ article, etmCode }]);
            const p = prices[article];
            if (p != null && p > 0) {
              etmPrice = p;
              const termRes = await storesApi.getEtmTerm(article, etmCode).catch(() => null);
              etmTerm = termRes?.data?.term || 'нет';
            }
            setRowEtmData(prev => ({ ...prev, [article]: { price: p ?? null, term: etmTerm === 'нет' ? null : etmTerm } }));
          } catch { /* silent — leave defaults */ }
        }
      }

      const catalogPrice = product.price && Number(product.price) > 0 ? Number(product.price) : null;
      const finalPrice = etmPrice != null
        ? String(etmPrice)
        : (catalogPrice != null ? String(catalogPrice) : '');
      // Empty string maps to "—" in the spec table's store dropdown.
      const finalStore = etmPrice != null ? 'ЭТМ' : '';
      const finalDeadline = etmPrice != null ? etmTerm : '';

      await sheetsApi.saveRows(activeSheetId, [...existing, {
        row_number: existing.length + 1,
        name: product.name, brand: product.manufacturer?.name || '',
        article, etm_code: product.etm_code || '',
        unit: product.unit || 'шт',
        price: finalPrice,
        store: finalStore, qty: '1', coef: '1',
        deadline: finalDeadline,
      }]);
      activityApi.logEvent('add_from_catalog', `${product.name?.slice(0, 60)}, article: ${article}`);
      toast.success(`«${product.name.slice(0, 40)}» добавлен в лист`);
    } catch { toast.error('Ошибка добавления в лист'); }
    finally { addingRef.current = false; }
  }

  // Deduplicate by (article, brand) — duplicates occur when the same price list
  // was uploaded twice or Excel has repeated rows. Prefer row with external_url set.
  /** Return a safe absolute URL or null. Guards against stored paths like "info"
   *  being resolved relatively (which would open service.indexall.ru/info). */
  function safeUrl(raw: string | null | undefined): string | null {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/\./.test(s) && !/\s/.test(s)) return `https://${s}`;
    return null;
  }

  function dedupeProducts(arr: any[]): any[] {
    const seen = new Map<string, any>();
    for (const p of arr) {
      const article = (p.article || '').trim().toLowerCase();
      const etmCode = (p.etm_code || '').trim().toLowerCase();
      const brand   = (p.manufacturer?.name || p.brand || '').trim().toLowerCase();
      // Identifier preference: explicit article → ETM code → unique product id.
      // The old logic keyed only on article+brand, so price lists without
      // article column (like Алюр / ЭлПром) collapsed all 3000 cables into a
      // single row per brand because every entry hashed to "|<brand>" and
      // only the first one was kept. Falling through to etm_code keeps wires
      // that differ by colour/section/length distinct.
      const idPart = article || etmCode || `id-${p.id}`;
      const key = `${idPart}|${brand}`;
      const existing = seen.get(key);
      if (!existing) seen.set(key, p);
      // If new copy has external_url/image_url and the existing one doesn't — prefer the new one
      else if (!existing.external_url && p.external_url) seen.set(key, p);
      else if (!existing.image_url && p.image_url) seen.set(key, p);
    }
    return [...seen.values()];
  }

  const filteredManufProducts = dedupeProducts(
    search
      ? products.filter(p =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.article || '').toLowerCase().includes(search.toLowerCase()))
      : products
  );

  const displayedFilterProducts = dedupeProducts(getDisplayedFilterProducts());
  const selectedTile = tiles.find(t => t.slug === selectedSlug);

  // ── Inline product detail ──────────────────────────────────
  /** Render a single product row: thumbnail + info + ETM price + link + add button */
  function renderProductRow(p: any, i: number, keyPrefix = '') {
    const pAttrs = p.attributes || {};
    const pAttrEntries = Object.entries(pAttrs).filter(([, v]) => v);
    const key = (p.article || p.etm_code || '').trim();
    const etmEntry = key ? rowEtmData[key] : undefined;
    const etmPrice = etmEntry?.price;
    const etmTerm = etmEntry?.term;
    return (
      <div key={`${keyPrefix}${p.id}-${i}`}>
        <div className={`product-item-ref${selectedProduct?.id === p.id ? ' selected' : ''}`} onClick={() => selectProduct(p)}>
          <span className="product-num">{i + 1}</span>
          {/* Thumbnail */}
          {p.image_url ? (
            <img
              src={p.image_url} alt=""
              style={{ width: 80, height: 80, objectFit: 'contain', marginRight: 8, borderRadius: 6, flexShrink: 0, cursor: 'zoom-in', background: '#f5f5f5' }}
              onClick={e => { e.stopPropagation(); setProductZoomImg(p.image_url); }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div style={{ width: 80, height: 80, marginRight: 8, background: '#f5f5f5', borderRadius: 6, flexShrink: 0 }} />
          )}
          <div className="product-info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="product-name">{p.name}</div>
              {p.accessories?.length > 0 && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    // Open the product if not already open, then jump straight
                    // to the accessories category list.
                    if (selectedProduct?.id !== p.id) selectProduct(p);
                    setAccView('types');
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#fff', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    padding: '3px 10px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Аксессуары ({p.accessories.length})
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
            </div>
            <div className="product-article">
              {p.article && <span>Артикул {p.article}</span>}
              {p.manufacturer?.name && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{p.manufacturer.name}</span>}
            </div>
            {pAttrEntries.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 2 }}>
                {pAttrEntries.map(([k, v]) => (
                  <span key={k} style={{ fontSize: 11, color: 'var(--muted)' }}>{k}: {String(v)}</span>
                ))}
              </div>
            )}
          </div>
          {/* ETM price + term inline */}
          {etmPrice != null && etmPrice > 0 && (
            <div style={{ marginRight: 8, whiteSpace: 'nowrap', textAlign: 'right', fontSize: 12, lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>Цена ЭТМ: {etmPrice.toLocaleString('ru-RU')} ₽</div>
              {etmTerm && (
                <div style={{ color: 'var(--muted)' }}>Срок: {etmTerm}</div>
              )}
            </div>
          )}
          {/* External link */}
          {(() => {
            const href = safeUrl(p.external_url);
            if (!href) return null;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  background: '#fff', color: '#1976d2', border: '1px solid #1976d2',
                  borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
                  textDecoration: 'none', marginRight: 6, whiteSpace: 'nowrap',
                }}>
                Сайт
              </a>
            );
          })()}
          <button className="btn-add-to-list" onClick={e => { e.stopPropagation(); addToSheet(p); }}>+ Добавить в лист</button>
        </div>
        {inlineDetail(p)}
      </div>
    );
  }

  function inlineDetail(p: any) {
    if (!selectedProduct || selectedProduct.id !== p.id) return null;
    const attrs = selectedProduct.attributes || {};
    const attrEntries = Object.entries(attrs).filter(([, v]) => v);
    return (
      <div ref={detailRef} className="product-detail-inline">
        <div style={{ display: 'flex', gap: 12 }}>
          {selectedProduct.image_url && (
            <img
              src={selectedProduct.image_url} alt=""
              style={{ width: 160, height: 160, objectFit: 'contain', background: '#f5f5f5', borderRadius: 6, flexShrink: 0, cursor: 'zoom-in' }}
              onClick={e => { e.stopPropagation(); setProductZoomImg(selectedProduct.image_url); }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, flex: 1 }}>
          {selectedProduct.article && (
            <div>Артикул: <strong>{selectedProduct.article}</strong></div>
          )}
          {selectedProduct.manufacturer?.name && (
            <div>Производитель: {selectedProduct.manufacturer.name}</div>
          )}
          {selectedProduct.price && (
            <div>Цена каталога: <strong>{selectedProduct.price} ₽</strong></div>
          )}
          {(() => {
            const href = safeUrl(selectedProduct.external_url);
            if (!href) return null;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  background: '#1976d2', color: '#fff', borderRadius: 4,
                  padding: '5px 12px', fontSize: 12, fontWeight: 500,
                  textDecoration: 'none', display: 'inline-block', width: 'fit-content', marginTop: 2,
                }}>
                Открыть на сайте →
              </a>
            );
          })()}
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
          {(() => {
            const accs: any[] = selectedProduct.accessories || [];
            if (accs.length === 0) {
              return (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                  Аксессуаров нет
                </div>
              );
            }
            const types = [...new Set(accs.map((a: any) => a.type).filter(Boolean))];
            return (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                {accView === 'closed' && (
                  <button className="btn-outline"
                    style={{ fontSize: 12, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={e => { e.stopPropagation(); setAccView('types'); }}>
                    Аксессуары ({accs.length})
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {listAccs.map((acc: any, ai: number) => {
                          const etm = acc.article ? accEtm[acc.article] : undefined;
                          const detail = acc.article ? accItemDetails[acc.article] : undefined;
                          const imgUrl = detail?.image_url || null;
                          const siteUrl = detail?.site_url || null;
                          const description = detail?.description || null;
                          const extraAttrs = detail?.attributes ? Object.entries(detail.attributes as Record<string, string>).filter(([, v]) => v) : [];
                          const displayName = acc.name || detail?.db_name || '';
                          return (
                            <div key={ai} style={{ background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', padding: '12px 14px', fontSize: 13 }}>
                              {/* Header: name + article + ETM + button */}
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{displayName}</div>
                                  {acc.article && (
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{acc.article}</div>
                                  )}
                                  {/* ETM price row */}
                                  <div style={{ marginTop: 6, fontSize: 12 }}>
                                    {etm?.loading && <span style={{ color: 'var(--muted)' }}>Загрузка цены…</span>}
                                    {etm && !etm.loading && (
                                      <span style={{ background: '#fffbe6', border: '1px solid #f5c800', borderRadius: 4, padding: '3px 8px', display: 'inline-flex', gap: 12, fontSize: 12 }}>
                                        {etm.price != null && etm.price > 0
                                          ? <span>Цена ЭТМ: <strong>{etm.price.toLocaleString('ru-RU')} ₽</strong></span>
                                          : <span style={{ color: 'var(--muted)' }}>Цена ЭТМ: нет</span>}
                                        {etm.term && <span>Срок: <strong>{etm.term}</strong></span>}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button className="btn-add-to-list" style={{ padding: '5px 12px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
                                  onClick={e => { e.stopPropagation(); addToSheet({ name: displayName, article: acc.article, manufacturer: selectedProduct.manufacturer }); }}>
                                  + В лист
                                </button>
                              </div>

                              {/* Body: image + characteristics */}
                              {(imgUrl || extraAttrs.length > 0 || description) && (
                                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                                  {/* Photo */}
                                  {imgUrl && (
                                    <img
                                      src={imgUrl} alt=""
                                      style={{ width: 110, height: 110, objectFit: 'contain', flexShrink: 0, borderRadius: 6, background: '#f5f5f5', cursor: 'zoom-in', border: '1px solid var(--border)' }}
                                      onClick={e => { e.stopPropagation(); setAccZoomImg(imgUrl); }}
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  )}

                                  {/* Characteristics */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    {(extraAttrs.length > 0 || description) && (
                                      <>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                          Основные характеристики
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                          <tbody>
                                            {description && (
                                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)', width: '45%', verticalAlign: 'top' }}>Описание</td>
                                                <td style={{ padding: '4px 0', fontWeight: 500 }}>{description}</td>
                                              </tr>
                                            )}
                                            {extraAttrs.map(([k, v]) => (
                                              <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)', width: '45%', verticalAlign: 'top' }}>{k}</td>
                                                <td style={{ padding: '4px 0', fontWeight: 500 }}>{v}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </>
                                    )}
                                    {siteUrl && (
                                      <a href={siteUrl} target="_blank" rel="noopener noreferrer"
                                        style={{ display: 'inline-block', marginTop: 8, color: 'var(--yellow)', textDecoration: 'none', fontSize: 12 }}
                                        onClick={e => e.stopPropagation()}>
                                        Сайт производителя ↗
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
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
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button
            className="btn-add-to-list"
            style={{ alignSelf: 'flex-start' }}
            onClick={e => { e.stopPropagation(); addToSheet(selectedProduct); }}
          >
            + Добавить в лист
          </button>
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); openAdminInfo(selectedProduct); }}
              style={{
                background: '#fff', color: '#1976d2', border: '1px solid #1976d2',
                borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
              title="Сравнить данные из загруженного прайса с ответом ETM (видно только администратору)"
            >
              Информация
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Header breadcrumb="Каталог" />
      <SectionOnboarding section="catalog" />
      <div className={`catalog-screen${mode === 'filter' && !selectedSlug ? ' catalog-screen--tiles' : ''}`}>

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
              Прайс-листы производителей
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

        {/* ── Full-width tiles view when no category selected in filter mode ── */}
        {mode === 'filter' && !selectedSlug && (
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            {search.trim().length >= 2 ? (
              <>
                <div className="catalog-breadcrumb-ref" style={{ marginBottom: 12 }}>Поиск: «{search.trim()}»</div>
                {globalSearchLoading && <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Поиск…</div>}
                {!globalSearchLoading && globalSearchResults.length === 0 && <div className="empty-state">Ничего не найдено</div>}
                {!globalSearchLoading && dedupeProducts(globalSearchResults).map((p, i) => renderProductRow(p, i, 'gs-'))}
              </>
            ) : (
              <div className="category-tiles-ref" style={{ maxWidth: 900, margin: '0 auto' }}>
                {tiles.map((tile) => {
                  const w = tile.width ?? (tile.is_large ? 2 : 1);
                  const h = tile.height ?? 1;
                  return (
                    <div key={tile.id} className="category-tile-ref"
                      style={{ gridColumn: `span ${w}`, gridRow: `span ${h}`, aspectRatio: 'auto' }}
                      onClick={() => selectCategorySlug(tile.slug)}>
                      {tile.image_path
                        ? <img src={`${process.env.NEXT_PUBLIC_API_URL}/uploads/${tile.image_path.split(/[\\/]/).pop()}`} alt={tile.name} className="category-tile-img" />
                        : <div className="category-tile-icon" style={{ fontSize: 36 }}>{tile.icon}</div>}
                      <div className="category-tile-name-ref">{tile.name}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Body (two-column layout for manuf mode or when category is selected) ── */}
        {!(mode === 'filter' && !selectedSlug) && (
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
                  {tiles.map((tile) => {
                    const w = tile.width ?? (tile.is_large ? 2 : 1);
                    const h = tile.height ?? 1;
                    return (
                      <div
                        key={tile.id}
                        className="category-tile-ref"
                        style={{ gridColumn: `span ${w}`, gridRow: `span ${h}`, aspectRatio: 'auto' }}
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
                    );
                  })}
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
                {!globalSearchLoading && globalSearchResults.map((p, i) => renderProductRow(p, i, 'gs2-'))}
              </>
            )}

            {search.trim().length < 2 && mode === 'manuf' && (
              <>
                {breadcrumbPath.length > 0 && (
                  <div className="catalog-breadcrumb-ref">{breadcrumbPath.join('/')}</div>
                )}
                {filteredManufProducts.map((p, i) => renderProductRow(p, i, 'mf-'))}
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
                {!loadingFilter && displayedFilterProducts.map((p, i) => renderProductRow(p, i, 'dfp-'))}
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
        )}
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

      {/* Admin-only debug modal: row data from DB + raw ETM API responses */}
      {adminInfo && (
        <div className="modal-overlay" onClick={() => setAdminInfo(null)}>
          <div className="modal-box" style={{ maxWidth: 900, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Информация о товаре (админ)</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.4 }}>
              {adminInfo.productName}
            </p>
            {adminInfo.loading && <div style={{ padding: 24, textAlign: 'center' }}>Загрузка…</div>}
            {!adminInfo.loading && adminInfo.data && (() => {
              const row = adminInfo.data.row || {};
              const etm = adminInfo.data.etm || {};
              const summary = etm.summary || {};
              const catalogPrice = row.price && Number(row.price) > 0 ? Number(row.price) : null;
              // Resolve final values exactly as addToSheet would: ETM personal first, then catalog.
              const finalPrice = summary.personal != null ? summary.personal
                               : summary.retail   != null ? summary.retail
                               : catalogPrice     != null ? catalogPrice
                               : null;
              const finalSource = summary.personal != null || summary.retail != null ? 'ЭТМ' : '—';
              const finalDeadline = (summary.personal != null || summary.retail != null) && summary.date ? summary.date : '';
              const fmtPrice = (v: number | null) => v != null ? `${v.toLocaleString('ru-RU')} ₽` : '—';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* What gets pulled into the spec sheet */}
                  <section>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#1a1a1a' }}>
                      Что попадёт в лист спецификации
                    </h3>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', background: '#f8f9fa', borderRadius: 6 }}>
                      <tbody>
                        {[
                          ['Название', row.name || '—'],
                          ['Бренд', row.brand || row.manufacturer?.name || '—'],
                          ['Артикул', row.article || '—'],
                          ['ETM-код', row.etm_code || '—'],
                          ['Цена', fmtPrice(finalPrice)],
                          ['Источник', finalSource],
                          ['Срок', finalDeadline || '—'],
                        ].map(([label, value]) => (
                          <tr key={label} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px 12px', color: 'var(--muted)', width: 140 }}>{label}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1a1a1a' }}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {/* Source-of-price comparison */}
                  <section>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#1a1a1a' }}>
                      Источники цены
                    </h3>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', background: '#f8f9fa', borderRadius: 6 }}>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--muted)', width: 200 }}>Каталожная цена (из прайса)</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: catalogPrice != null ? '#1a1a1a' : '#aaa' }}>
                            {fmtPrice(catalogPrice)}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>Личная цена ЭТМ</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: summary.personal != null ? '#1a1a1a' : '#aaa' }}>
                            {fmtPrice(summary.personal ?? null)}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>Ритейл цена ЭТМ</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: summary.retail != null ? '#1a1a1a' : '#aaa' }}>
                            {fmtPrice(summary.retail ?? null)}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>Срок ЭТМ</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: summary.date ? '#1a1a1a' : '#aaa' }}>
                            {summary.date || '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {etm?.error && (
                      <div style={{ marginTop: 8, padding: 10, background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
                        {etm.error}
                      </div>
                    )}
                  </section>
                </div>
              );
            })()}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-cancel" onClick={() => setAdminInfo(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Image zoom modal (accessories + product thumbnails) ── */}
      {(accZoomImg || productZoomImg) && (() => {
        const src = accZoomImg || productZoomImg!;
        const close = () => { setAccZoomImg(null); setProductZoomImg(null); };
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
            onClick={close}
          >
            <img
              src={src} alt=""
              style={{ width: 300, height: 300, objectFit: 'contain', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.6)', background: '#fff' }}
              onClick={e => e.stopPropagation()}
            />
          </div>
        );
      })()}
    </>
  );
}
